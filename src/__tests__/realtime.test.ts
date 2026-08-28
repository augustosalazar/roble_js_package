import { RobleRealtimeSocket } from '../realtime';

/** Socket de mentira: apunta lo emitido y deja al test entregar eventos. */
class SocketFalso {
  connected = true;
  cerrado = false;
  readonly emitidos: Array<{ event: string; data: any }> = [];
  readonly acks: Function[] = [];
  private readonly handlers = new Map<string, Function[]>();

  readonly io = {
    opts: { query: {} as Record<string, any> },
    on: (event: string, h: Function) => this.onIo(event, h),
  };
  private readonly ioHandlers = new Map<string, Function[]>();

  on(event: string, handler: Function) {
    const lista = this.handlers.get(event) ?? [];
    lista.push(handler);
    this.handlers.set(event, lista);
    return this;
  }

  private onIo(event: string, handler: Function) {
    const lista = this.ioHandlers.get(event) ?? [];
    lista.push(handler);
    this.ioHandlers.set(event, lista);
  }

  emit(event: string, data?: any, ack?: Function) {
    this.emitidos.push({ event, data });
    if (ack) this.acks.push(ack);
    return this;
  }

  close() {
    this.cerrado = true;
    this.connected = false;
  }

  /** Lo que hace el servidor cuando manda algo. */
  entregar(event: string, payload?: any) {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(payload);
  }

  reconectando() {
    for (const h of [...(this.ioHandlers.get('reconnect_attempt') ?? [])]) h();
  }

  /** Acepta la suscripción pendiente. */
  aceptar(id = 'sub-1') {
    this.acks.shift()?.({ type: 'subscription_created', subscriptionId: id });
  }

  suscripciones() {
    return this.emitidos.filter((e) => e.event === 'subscribe');
  }
}

const cambio = (over: Record<string, any> = {}) => ({
  eventId: 'e1',
  subscriptionId: 'sub-1',
  table: 'mensajes',
  operation: 'INSERT',
  commitTimestamp: '2026-08-26T12:00:00.000Z',
  primaryKey: {},
  old: null,
  new: { k1: { texto: 'hola' } },
  path: ['mensajes'],
  ...over,
});

function construir(token: string | null = 'at-1') {
  let socket!: SocketFalso;
  const rt = new RobleRealtimeSocket({
    origin: 'https://roble-api.test',
    dbName: 'proyecto_ab12',
    token: () => token,
    ioFactory: ((url: string, opts: any) => {
      socket = new SocketFalso();
      (socket as any).url = url;
      (socket as any).opts = opts;
      return socket as any;
    }) as any,
  });
  return { rt, socket: () => socket };
}

describe('conexión', () => {
  it('cuelga del host, con token y proyecto', () => {
    const { rt, socket } = construir();

    rt.watch({ table: 'mensajes', onEvent: () => {} });

    expect((socket() as any).url).toBe('https://roble-api.test/stream');
    expect((socket() as any).opts.query).toEqual({
      token: 'at-1',
      dbName: 'proyecto_ab12',
    });
    // Sin long-polling no hacen falta sesiones pegajosas con varios workers.
    expect((socket() as any).opts.transports).toEqual(['websocket']);
  });

  it('sin sesión avisa en vez de conectar', () => {
    const { rt } = construir(null);

    expect(() => rt.watch({ table: 'x', onEvent: () => {} })).toThrow(
      /iniciar sesión/
    );
  });

  it('al reconectar lleva el token vigente', () => {
    let token = 'at-1';
    const rt = new RobleRealtimeSocket({
      origin: 'https://roble-api.test',
      dbName: 'proyecto_ab12',
      token: () => token,
      ioFactory: (() => s as any) as any,
    });
    const s = new SocketFalso();

    rt.watch({ table: 'mensajes', onEvent: () => {} });
    token = 'at-2';
    s.reconectando();

    // Reconectar con el token de hace media hora deja el socket rechazado sin
    // decir por qué.
    expect(s.io.opts.query).toEqual({ token: 'at-2', dbName: 'proyecto_ab12' });
  });
});

describe('suscripciones', () => {
  it('pide una sola por tabla aunque escuchen varios', () => {
    const { rt, socket } = construir();

    rt.watch({ table: 'mensajes', onEvent: () => {} });
    rt.watch({ table: 'mensajes', onEvent: () => {} });

    // El servidor cuenta suscripciones contra la cuota del proyecto.
    expect(socket().suscripciones()).toHaveLength(1);
  });

  it('manda los filtros planos', () => {
    const { rt, socket } = construir();

    rt.watch({
      table: 'products',
      filters: [{ column: '_id', operator: 'eq', value: 'p1' }],
      onEvent: () => {},
    });

    // Envueltos en `simple`, el servidor lee el operador vacío y deja pasar
    // todo: el filtro parece funcionar y no filtra nada.
    expect(socket().suscripciones()[0]!.data.filters).toEqual([
      { column: '_id', operator: 'eq', value: 'p1' },
    ]);
  });

  it('no aplica el filtro de uno a los demás', () => {
    const { rt, socket } = construir();

    rt.watch({
      table: 'products',
      filters: [{ column: '_id', operator: 'eq', value: 'p1' }],
      onEvent: () => {},
    });
    rt.watch({ table: 'products', onEvent: () => {} });

    // Comparten suscripción, así que la vigente es la última pedida: quedarse
    // con el filtro del primero dejaría al segundo sin sus cambios.
    expect(socket().suscripciones().at(-1)!.data.filters).toEqual([]);
  });

  it('se rehacen al reconectar', () => {
    const { rt, socket } = construir();
    rt.watch({ table: 'mensajes', onEvent: () => {} });
    socket().aceptar();

    socket().entregar('disconnect');
    socket().entregar('connect');

    // El servidor no recuerda nada tras una caída.
    expect(socket().suscripciones()).toHaveLength(2);
  });

  it('cancelar la última cierra el socket', () => {
    const { rt, socket } = construir();
    const parar = rt.watch({ table: 'mensajes', onEvent: () => {} });
    socket().aceptar();

    parar();

    expect(socket().cerrado).toBe(true);
    expect(rt.status).toBe('disconnected');
  });

  it('cancelar dos veces es seguro', () => {
    const { rt } = construir();
    const parar = rt.watch({ table: 'mensajes', onEvent: () => {} });

    parar();
    expect(() => parar()).not.toThrow();
  });
});

describe('reparto', () => {
  it('entrega el cambio a quien escucha esa tabla', () => {
    const { rt, socket } = construir();
    const vistos: any[] = [];
    rt.watch({ table: 'mensajes', onEvent: (e) => vistos.push(e) });

    socket().entregar('data_change', cambio());

    expect(vistos).toHaveLength(1);
    expect(vistos[0].newValue).toEqual({ k1: { texto: 'hola' } });
    expect(vistos[0].pathString).toBe('mensajes');
  });

  it('no entrega lo de otra tabla', () => {
    const { rt, socket } = construir();
    const vistos: any[] = [];
    rt.watch({ table: 'mensajes', onEvent: (e) => vistos.push(e) });

    socket().entregar('data_change', cambio({ table: 'otra', path: ['otra'] }));

    expect(vistos).toHaveLength(0);
  });

  it('escuchando una rama no llega lo de una hermana', () => {
    const { rt, socket } = construir();
    const vistos: any[] = [];
    rt.watch({
      table: 'salas',
      path: 'general',
      onEvent: (e) => vistos.push(e),
    });

    socket().entregar('data_change', cambio({ table: 'salas', path: ['salas', 'general', 'm1'] }));
    socket().entregar('data_change', cambio({ table: 'salas', path: ['salas', 'privada', 'm2'] }));

    // La suscripción es por colección: el servidor manda las dos salas.
    expect(vistos.map((e) => e.path.at(-1))).toEqual(['m1']);
  });

  it('llega un cambio escrito por encima de la rama escuchada', () => {
    const { rt, socket } = construir();
    const vistos: any[] = [];
    rt.watch({
      table: 'salas',
      path: 'general/mensajes',
      onEvent: (e) => vistos.push(e),
    });

    socket().entregar('data_change', cambio({ table: 'salas', path: ['salas', 'general'] }));

    // Reemplazar el padre cambia al hijo aunque nadie lo nombre.
    expect(vistos).toHaveLength(1);
  });

  it('un fallo de una escucha no tumba a las demás', () => {
    const { rt, socket } = construir();
    const vistos: any[] = [];
    rt.watch({
      table: 'mensajes',
      onEvent: () => {
        throw new Error('boom');
      },
      onError: () => {},
    });
    rt.watch({ table: 'mensajes', onEvent: (e) => vistos.push(e) });

    socket().entregar('data_change', cambio());

    expect(vistos).toHaveLength(1);
  });

  it('las WsException llegan por `exception`, no solo por `error`', () => {
    const { rt, socket } = construir();
    const fallos: any[] = [];
    rt.watch({
      table: 'mensajes',
      onEvent: () => {},
      onError: (e) => fallos.push(e),
    });

    socket().entregar('exception', { message: 'Cuota superada' });

    // Nest manda las WsException por ese canal: escuchar solo `error` deja el
    // fallo en silencio.
    expect(String(fallos[0])).toContain('Cuota superada');
  });

  it('sin onError el fallo va a la consola, no al vacío', () => {
    const { rt, socket } = construir();
    const avisos: string[] = [];
    const original = console.warn;
    console.warn = (m: string) => avisos.push(m);

    try {
      // Sin `onError`, que es como lo escribe casi todo el mundo.
      rt.watch({ table: 'estudiantes', onEvent: () => {} });
      socket().entregar('exception', {
        code: 'REALTIME_UNKNOWN_COLLECTION',
        message: '"estudiantes" no es una colección de este proyecto.',
      });
    } finally {
      console.warn = original;
    }

    // Antes se perdía entero y quedaba una suscripción muda sin explicación.
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('estudiantes');
    expect(avisos[0]).toContain('[roble]');
  });

  it('con onError no duplica el aviso en consola', () => {
    const { rt, socket } = construir();
    const avisos: string[] = [];
    const original = console.warn;
    console.warn = (m: string) => avisos.push(m);

    try {
      rt.watch({ table: 'mensajes', onEvent: () => {}, onError: () => {} });
      socket().entregar('exception', { message: 'Cuota superada' });
    } finally {
      console.warn = original;
    }

    expect(avisos).toHaveLength(0);
  });
});
