import { RobleApiClient, RobleApiAuthException } from '../index';

/**
 * El cliente solo usa `axios.create`, el interceptor de peticion, `request` y
 * `isAxiosError`, asi que se puede sustituir entero sin traer una libreria de
 * dobles.
 */
const mockEnviadas: any[] = [];
let mockResponder: (cfg: any) => { status: number; data: any };

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: () => ({
      interceptors: { request: { use: () => {} } },
      request: async (cfg: any) => {
        mockEnviadas.push(cfg);
        const { status, data } = mockResponder(cfg);
        return { status, data, config: cfg, headers: {}, statusText: '' };
      },
    }),
    isAxiosError: () => false,
  },
}));

/** Almacen en memoria: en Node no hay localStorage. */
const storage = () => {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
};

const cliente = () =>
  new RobleApiClient({
    baseUrl: 'https://roble-api.test',
    contractId: 'proyecto_ab12',
    storage: storage(),
  });

const sesion = { accessToken: 'at-1', refreshToken: 'rt-1' };

/** Un cliente con la sesion ya iniciada. */
const conSesion = async () => {
  mockResponder = (cfg: any) =>
    cfg.url.endsWith('/me')
      ? { status: 200, data: { email: 'ana@correo.com' } }
      : { status: 200, data: sesion };

  const db = cliente();
  await db.login({ email: 'ana@correo.com', password: 'secreto' });
  return db;
};

/** Todo devuelve 401: el access token no vale y el refresco tampoco. */
const todoCaducado = () => {
  mockResponder = () => ({ status: 401, data: { message: 'Unauthorized' } });
};

beforeEach(() => {
  mockEnviadas.length = 0;
  mockResponder = () => ({ status: 200, data: {} });
});

describe('sesion caducada', () => {
  it('avisa cuando el refresco falla', async () => {
    const db = await conSesion();
    const avisos: number[] = [];
    db.onSessionExpired(() => avisos.push(1));

    todoCaducado();
    await expect(db.read('productos')).rejects.toBeInstanceOf(
      RobleApiAuthException
    );

    expect(avisos).toHaveLength(1);
  });

  it('con la sesion ya descartada cuando avisa', async () => {
    // Quien escucha va a mandar a esa persona a la pantalla de entrada; si el
    // cliente todavia se creyera dentro, esa pantalla arrancaria con una
    // sesion muerta guardada.
    const db = await conSesion();
    expect(db.isLoggedIn).toBe(true);

    let estabaDentro = true;
    db.onSessionExpired(() => {
      estabaDentro = db.isLoggedIn;
    });

    todoCaducado();
    await expect(db.read('productos')).rejects.toThrow();

    expect(estabaDentro).toBe(false);
    expect(db.isLoggedIn).toBe(false);
  });

  it('una sola vez aunque fallen varias llamadas a la vez', async () => {
    // Una app pide la lista, el perfil y el chat al entrar. Las tres fallan
    // con el mismo 401 y no hay que avisar tres veces.
    const db = await conSesion();
    const avisos: number[] = [];
    db.onSessionExpired(() => avisos.push(1));

    todoCaducado();
    await Promise.all([
      db.read('productos').catch(() => []),
      db.read('pedidos').catch(() => []),
      db.read('clientes').catch(() => []),
    ]);

    expect(avisos).toHaveLength(1);
  });

  it('avisa a todos los que escuchan', async () => {
    const db = await conSesion();
    const avisados: string[] = [];
    db.onSessionExpired(() => avisados.push('cabecera'));
    db.onSessionExpired(() => avisados.push('router'));

    todoCaducado();
    await expect(db.read('productos')).rejects.toThrow();

    expect(avisados).toEqual(['cabecera', 'router']);
  });

  it('darse de baja deja de recibir', async () => {
    // Es el caso de un componente que se desmonta: sin esto, cada montaje
    // dejaria un escuchador mas sobre el mismo cliente.
    const db = await conSesion();
    const avisos: number[] = [];
    const dejarDeEscuchar = db.onSessionExpired(() => avisos.push(1));

    dejarDeEscuchar();

    todoCaducado();
    await expect(db.read('productos')).rejects.toThrow();

    expect(avisos).toHaveLength(0);
  });

  it('un escuchador que revienta no se lleva a los demas por delante', async () => {
    const db = await conSesion();
    const avisos: string[] = [];
    db.onSessionExpired(() => {
      throw new Error('el router no estaba listo');
    });
    db.onSessionExpired(() => avisos.push('segundo'));

    todoCaducado();
    // Y el error que sube sigue siendo el de la sesion, no el del escuchador.
    await expect(db.read('productos')).rejects.toBeInstanceOf(
      RobleApiAuthException
    );

    expect(avisos).toEqual(['segundo']);
  });

  it('no avisa al cerrar sesion a proposito', async () => {
    const db = await conSesion();
    const avisos: number[] = [];
    db.onSessionExpired(() => avisos.push(1));

    mockResponder = () => ({ status: 200, data: {} });
    await db.logout();

    expect(avisos).toHaveLength(0);
  });

  it('no avisa mientras el refresco funcione', async () => {
    const db = await conSesion();
    const avisos: number[] = [];
    db.onSessionExpired(() => avisos.push(1));

    let primeraLlamada = true;
    mockResponder = (cfg: any) => {
      if (cfg.url.includes('refresh-token')) {
        return {
          status: 200,
          data: { accessToken: 'at-2', refreshToken: 'rt-2' },
        };
      }
      if (primeraLlamada) {
        primeraLlamada = false;
        return { status: 401, data: { message: 'Unauthorized' } };
      }
      return { status: 200, data: [] };
    };

    await db.read('productos');

    expect(avisos).toHaveLength(0);
    expect(db.isLoggedIn).toBe(true);
  });

  it('una sesion nueva vuelve a armar el aviso', async () => {
    const db = await conSesion();
    const avisos: number[] = [];
    db.onSessionExpired(() => avisos.push(1));

    todoCaducado();
    await expect(db.read('productos')).rejects.toThrow();
    expect(avisos).toHaveLength(1);

    // Se vuelve a entrar y se vuelve a caer: el segundo aviso tiene que salir.
    mockResponder = (cfg: any) =>
      cfg.url.endsWith('/me')
        ? { status: 200, data: { email: 'ana@correo.com' } }
        : { status: 200, data: sesion };
    await db.login({ email: 'ana@correo.com', password: 'secreto' });

    todoCaducado();
    await expect(db.read('productos')).rejects.toThrow();

    expect(avisos).toHaveLength(2);
  });
});
