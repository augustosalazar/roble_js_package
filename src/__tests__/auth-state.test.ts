import { RobleApiClient, RobleAuthState } from '../index';

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

const contractId = 'proyecto_ab12';

/** Almacen en memoria: en Node no hay localStorage. */
const storage = (inicial?: Record<string, string>) => {
  const datos = new Map<string, string>(Object.entries(inicial ?? {}));
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
};

/** Lo que dejo guardado una sesion anterior. */
const sesionGuardada = () => ({
  [`roble.session.${contractId}`]: JSON.stringify({
    accessToken: 'at-viejo',
    refreshToken: 'rt-viejo',
  }),
});

const cliente = (almacen?: Record<string, string>) =>
  new RobleApiClient({
    baseUrl: 'https://roble-api.test',
    contractId,
    storage: storage(almacen),
  });

const perfil = { userId: 'u1', email: 'ana@correo.com', name: 'Ana' };
const sesion = { accessToken: 'at-1', refreshToken: 'rt-1' };

/** Responde el login y luego el perfil. */
const respondeEntrada = () => {
  mockResponder = (cfg: any) =>
    cfg.url.endsWith('/me')
      ? { status: 200, data: perfil }
      : { status: 200, data: sesion };
};

/** Todo 401: ni el token vale ni el refresco. */
const todoCaducado = () => {
  mockResponder = () => ({ status: 401, data: { message: 'Unauthorized' } });
};

const entrar = async (db: RobleApiClient) => {
  respondeEntrada();
  await db.login({ email: 'ana@correo.com', password: 'secreto' });
};

/** El estado en esa posicion, fallando claro si no se emitio. */
const enPos = (estados: RobleAuthState[], i: number): RobleAuthState => {
  const estado = estados[i];
  if (!estado) throw new Error(`no se emitio ningun estado en la posicion ${i}`);
  return estado;
};

const ultimo = (estados: RobleAuthState[]): RobleAuthState =>
  enPos(estados, estados.length - 1);

beforeEach(() => {
  mockEnviadas.length = 0;
  mockResponder = () => ({ status: 200, data: {} });
});

describe('estado inicial', () => {
  it('el escuchador recibe el de ahora, sin esperar a nada', () => {
    const estados: RobleAuthState[] = [];
    cliente().onAuthStateChanged((e) => estados.push(e));

    expect(estados).toHaveLength(1);
    expect(enPos(estados, 0).isSignedIn).toBe(false);
    expect(enPos(estados, 0).reason).toBe('signedOut');
  });

  it('y se puede mirar sin suscribirse', () => {
    expect(cliente().authState.isSignedIn).toBe(false);
  });
});

describe('entrar', () => {
  it('emite signedIn con el perfil', async () => {
    const db = cliente();
    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    await entrar(db);

    // El primero es el estado inicial que se reparte al suscribirse.
    expect(estados.map((e) => e.reason)).toEqual(['signedOut', 'signedIn']);
    expect(enPos(estados, 1).user?.email).toBe('ana@correo.com');
    expect(enPos(estados, 1).isSignedIn).toBe(true);
  });

  it('el login social emite lo mismo', async () => {
    const db = cliente();
    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    respondeEntrada();
    await db.signInWithIdToken({ provider: 'google', idToken: 'tok' });

    expect(ultimo(estados).reason).toBe('signedIn');
    expect(ultimo(estados).user?.email).toBe('ana@correo.com');
  });
});

describe('arrancar con una sesion guardada', () => {
  it('emite restored, no signedIn: no ha entrado nadie ahora', async () => {
    const db = cliente(sesionGuardada());
    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    mockResponder = (cfg: any) =>
      cfg.url.endsWith('/me')
        ? { status: 200, data: perfil }
        : { status: 200, data: { accessToken: 'at-2' } };
    expect(await db.restoreSession()).toBe(true);

    expect(ultimo(estados).reason).toBe('restored');
    expect(ultimo(estados).user?.email).toBe('ana@correo.com');
  });

  it('sin verificar hay sesion pero todavia no hay perfil', async () => {
    const db = cliente(sesionGuardada());
    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    expect(await db.restoreSession({ verify: false })).toBe(true);

    expect(ultimo(estados).isSignedIn).toBe(true);
    expect(ultimo(estados).user).toBeNull();
  });

  it('una sesion guardada que ya no vale no es una caida', async () => {
    // Nadie estaba dentro: decirle a quien abre la app que «su sesion caduco»
    // antes de ensenarle nada no ayuda.
    const db = cliente(sesionGuardada());
    const caidas: number[] = [];
    db.onSessionExpired(() => caidas.push(1));
    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    mockResponder = () => ({ status: 401, data: { message: 'Revocado' } });
    expect(await db.restoreSession()).toBe(false);

    expect(caidas).toHaveLength(0);
    expect(estados.map((e) => e.reason)).toEqual(['signedOut']);
  });
});

describe('salir', () => {
  it('emite signedOut sin perfil', async () => {
    const db = cliente();
    await entrar(db);

    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    mockResponder = () => ({ status: 200, data: {} });
    await db.logout();

    const fin = ultimo(estados);
    expect(fin.reason).toBe('signedOut');
    expect(fin.user).toBeNull();
    expect(fin.isSignedIn).toBe(false);
  });

  it('salir de donde no se estaba no emite nada', async () => {
    // Pasa al arrancar sin sesion guardada; repetirlo haria que una app
    // pintara la entrada dos veces.
    const db = cliente();
    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    await expect(db.logout()).rejects.toThrow();

    expect(estados).toHaveLength(1); // solo el inicial
  });
});

describe('caerse sola', () => {
  it('emite expired, que no es lo mismo que signedOut', async () => {
    const db = cliente();
    await entrar(db);

    const estados: RobleAuthState[] = [];
    db.onAuthStateChanged((e) => estados.push(e));

    todoCaducado();
    await expect(db.read('productos')).rejects.toThrow();

    const fin = ultimo(estados);
    expect(fin.reason).toBe('expired');
    expect(fin.hasExpired).toBe(true);
    expect(fin.isSignedIn).toBe(false);
  });

  it('quien llega tarde no se encuentra la caida de antes', async () => {
    // onAuthStateChanged reparte el estado actual, pero onSessionExpired es un
    // aviso: repetirlo mandaria a la entrada a alguien que ya esta en ella.
    const db = cliente();
    await entrar(db);
    todoCaducado();
    await expect(db.read('productos')).rejects.toThrow();

    const caidas: number[] = [];
    db.onSessionExpired(() => caidas.push(1));

    expect(caidas).toHaveLength(0);
    // Pero el estado sigue disponible para quien lo pregunte.
    expect(db.authState.hasExpired).toBe(true);
  });
});
