import { RobleApiClient } from '../index';

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

const ultima = () => mockEnviadas[mockEnviadas.length - 1];

beforeEach(() => {
  mockEnviadas.length = 0;
  mockResponder = () => ({ status: 200, data: {} });
});

describe('base de datos JSON', () => {
  it('la coleccion y sus hijos van en la ruta', async () => {
    await cliente().json.read('mensajes/abc/texto');

    expect(ultima().url).toBe('/realtime/proyecto_ab12/mensajes/abc/texto');
  });

  it('escapa cada segmento por separado', async () => {
    await cliente().json.read('mensajes/a b?c');

    // Sin escapar, el `/` partiria la ruta y el `?` se llevaria por delante el
    // resto de la URL.
    expect(ultima().url).toBe('/realtime/proyecto_ab12/mensajes/a%20b%3Fc');
  });

  it('listar colecciones apunta a la raiz, sin barra final', async () => {
    mockResponder = () => ({ status: 200, data: ['mensajes', 'salas'] });

    const nombres = await cliente().json.collections();

    expect(nombres).toEqual(['mensajes', 'salas']);
    expect(ultima().url).toBe('/realtime/proyecto_ab12');
  });

  it('push devuelve la clave que genero el servidor', async () => {
    mockResponder = () => ({ status: 200, data: { name: '-Nabc123' } });

    const id = await cliente().json.push('mensajes', { texto: 'hola' });

    expect(id).toBe('-Nabc123');
    expect(ultima().method).toBe('POST');
  });

  it('update usa PATCH, que respeta las claves que no vienen', async () => {
    await cliente().json.update('mensajes/abc', { leido: true });

    // Con PUT se perderia el texto del mensaje.
    expect(ultima().method).toBe('PATCH');
  });

  it('shallow viaja como query', async () => {
    await cliente().json.read('mensajes', true);

    expect(ultima().params).toEqual({ shallow: 'true' });
  });

});

describe('consulta guardada por nombre', () => {
  it('va por su nombre, escapado', async () => {
    mockResponder = () => ({ status: 200, data: { success: true, rows: [] } });

    await cliente().executeQueryByName('productos sin inventario');

    // Por nombre y no por UUID: el nombre se lee en la consola y sobrevive a
    // recrear la consulta.
    expect(ultima().url).toBe(
      '/database/proyecto_ab12/saved-queries/by-name/productos%20sin%20inventario/execute'
    );
  });

  it('un nombre vacio se rechaza antes de salir a la red', async () => {
    await expect(cliente().executeQueryByName('  ')).rejects.toThrow(
      /no puede estar vacio/
    );
    expect(mockEnviadas).toHaveLength(0);
  });

  it('normaliza la respuesta', async () => {
    mockResponder = () => ({
      status: 200,
      data: { success: true, rowCount: '2', rows: [{ a: 1 }, { a: 2 }] },
    });

    const res = await cliente().executeQueryByName('x');

    // rowCount llega como texto cuando Postgres lo cuenta con bigint.
    expect(res.rowCount).toBe(2);
    expect(res.rows).toHaveLength(2);
    expect(res.fields).toEqual([]);
  });
});

describe('proveedores', () => {
  const proveedores = [
    { name: 'google', displayName: 'Google', autoLinkSupported: true, clientId: 'cid' },
    { name: 'github', displayName: 'GitHub' },
  ];

  it('los lista sin token: son publicos', async () => {
    mockResponder = () => ({ status: 200, data: proveedores });

    const lista = await cliente().listProviders();

    expect(lista.map((p) => p.name)).toEqual(['google', 'github']);
    expect(ultima().skipAuth).toBe(true);
  });

  it('rellena lo que el servidor no manda', async () => {
    mockResponder = () => ({ status: 200, data: proveedores });

    const github = (await cliente().listProviders())[1]!;

    // Un servidor anterior a que se devolviera el clientId no debe romper la
    // lista entera.
    expect(github.clientId).toBeNull();
    expect(github.autoLinkSupported).toBe(false);
  });

  it('el clientId se busca por proveedor', async () => {
    mockResponder = () => ({ status: 200, data: proveedores });

    const db = cliente();
    expect(await db.providerClientId('google')).toBe('cid');
    expect(await db.providerClientId('microsoft')).toBeNull();
  });
});

describe('id_token', () => {
  const sesion = {
    status: 200,
    data: { accessToken: 'at', refreshToken: 'rt' },
  };

  it('lo canjea y deja la sesion iniciada', async () => {
    mockResponder = (cfg) =>
      cfg.url.endsWith('/me')
        ? { status: 200, data: { email: 'ana@correo.com' } }
        : sesion;

    const user = await cliente().signInWithIdToken({
      provider: 'google',
      idToken: 'tok',
      nonce: 'n1',
    });

    expect(user.email).toBe('ana@correo.com');
    const canje = mockEnviadas[0];
    expect(JSON.parse(canje.data)).toEqual({
      provider: 'google',
      token: 'tok',
      nonce: 'n1',
    });
  });

  it('sin nonce no lo inventa', async () => {
    mockResponder = (cfg) =>
      cfg.url.endsWith('/me') ? { status: 200, data: {} } : sesion;

    await cliente().signInWithIdToken({ provider: 'google', idToken: 'tok' });

    // Mandar uno que el proveedor no vio haria fallar la comprobacion.
    expect(JSON.parse(mockEnviadas[0].data).nonce).toBeUndefined();
  });

  it('un token vacio se rechaza antes de salir a la red', async () => {
    await expect(
      cliente().signInWithIdToken({ provider: 'google', idToken: '' })
    ).rejects.toThrow(/vacio/);
    expect(mockEnviadas).toHaveLength(0);
  });

  it('una respuesta sin access token se denuncia', async () => {
    mockResponder = () => ({ status: 200, data: { algo: 'otra cosa' } });

    await expect(
      cliente().signInWithIdToken({ provider: 'google', idToken: 'tok' })
    ).rejects.toThrow(/access token/);
  });
});
