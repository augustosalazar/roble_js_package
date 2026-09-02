import {
  RobleNotifications,
  RobleNotificationsSocket,
  type RobleNotificationEvent,
} from '../notifications';

type Manejador = (...args: any[]) => void;

/** Socket de mentira: apunta lo emitido y deja al test entregar eventos. */
class SocketFalso {
  connected = true;
  cerrado = false;
  readonly emitidos: Array<{ event: string; data: any }> = [];
  private readonly handlers = new Map<string, Manejador[]>();

  readonly io = {
    opts: { query: {} as Record<string, any> },
    on: (event: string, h: Manejador) => this.onIo(event, h),
  };
  private readonly ioHandlers = new Map<string, Manejador[]>();

  on(event: string, handler: Manejador) {
    const lista = this.handlers.get(event) ?? [];
    lista.push(handler);
    this.handlers.set(event, lista);
    return this;
  }

  private onIo(event: string, handler: Manejador) {
    const lista = this.ioHandlers.get(event) ?? [];
    lista.push(handler);
    this.ioHandlers.set(event, lista);
  }

  emit(event: string, data?: any) {
    this.emitidos.push({ event, data });
    return this;
  }

  close() {
    this.cerrado = true;
    this.connected = false;
  }

  entregar(event: string, payload?: any) {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(payload);
  }

  reconectando() {
    for (const h of [...(this.ioHandlers.get('reconnect_attempt') ?? [])]) h();
  }
}

const notificacion = (over: Record<string, any> = {}) => ({
  id: 'n-1',
  dbName: 'proyecto_abc',
  recipientId: 'user-1',
  senderId: 'user-2',
  topic: null,
  title: 'Hola',
  body: null,
  data: {},
  readAt: null,
  createdAt: '2026-09-02T10:00:00.000Z',
  expiresAt: null,
  ...over,
});

function crearSocket(token: string | null = 't') {
  const sockets: { url: string; opts: any; socket: SocketFalso }[] = [];
  const cliente = new RobleNotificationsSocket({
    origin: 'https://api.roble',
    dbName: 'proyecto_abc',
    token: () => token,
    ioFactory: (url, opts) => {
      const socket = new SocketFalso();
      sockets.push({ url, opts, socket });
      return socket as any;
    },
  });
  return { cliente, sockets };
}

describe('RobleNotificationsSocket', () => {
  it('conecta al namespace de notificaciones, no al de datos', () => {
    const { cliente, sockets } = crearSocket();
    cliente.watch(() => undefined);

    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe('https://api.roble/notifications');
    expect(sockets[0]!.opts.query).toEqual({
      token: 't',
      dbName: 'proyecto_abc',
    });
  });

  it('no abre socket sin sesion', () => {
    const { cliente, sockets } = crearSocket(null);
    expect(() => cliente.watch(() => undefined)).toThrow(/iniciar sesion/i);
    expect(sockets).toHaveLength(0);
  });

  it('no manda ningun subscribe: conectarse es todo el protocolo', () => {
    const { cliente, sockets } = crearSocket();
    cliente.watch(() => undefined);
    expect(sockets[0]!.socket.emitidos).toHaveLength(0);
  });

  it('toma el contador que llega al conectar', () => {
    const { cliente, sockets } = crearSocket();
    const vistos: number[] = [];
    cliente.onUnreadCount = (n) => vistos.push(n);
    cliente.watch(() => undefined);

    sockets[0]!.socket.entregar('connected', { unread: 4 });

    expect(cliente.unread).toBe(4);
    expect(cliente.status).toBe('connected');
    expect(vistos).toEqual([4]);
  });

  it('reparte las notificaciones a todas las escuchas', () => {
    const { cliente, sockets } = crearSocket();
    const a: RobleNotificationEvent[] = [];
    const b: RobleNotificationEvent[] = [];
    cliente.watch((e) => a.push(e));
    cliente.watch((e) => b.push(e));

    sockets[0]!.socket.entregar('notification', {
      type: 'created',
      notification: notificacion(),
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.notification.title).toBe('Hola');
  });

  it('una sola conexion aunque haya varias escuchas', () => {
    const { cliente, sockets } = crearSocket();
    cliente.watch(() => undefined);
    cliente.watch(() => undefined);
    expect(sockets).toHaveLength(1);
  });

  it('cierra el socket cuando se va la ultima escucha', () => {
    const { cliente, sockets } = crearSocket();
    const parar1 = cliente.watch(() => undefined);
    const parar2 = cliente.watch(() => undefined);

    parar1();
    expect(sockets[0]!.socket.cerrado).toBe(false);

    parar2();
    expect(sockets[0]!.socket.cerrado).toBe(true);
    expect(cliente.status).toBe('disconnected');
  });

  it('cancelar dos veces no rompe nada', () => {
    const { cliente } = crearSocket();
    const parar = cliente.watch(() => undefined);
    parar();
    expect(() => parar()).not.toThrow();
  });

  it('lleva el token de ahora al reconectar, no el de la primera vez', () => {
    let token = 'viejo';
    const sockets: SocketFalso[] = [];
    const cliente = new RobleNotificationsSocket({
      origin: 'https://api.roble',
      dbName: 'proyecto_abc',
      token: () => token,
      ioFactory: () => {
        const s = new SocketFalso();
        sockets.push(s);
        return s as any;
      },
    });
    cliente.watch(() => undefined);

    token = 'nuevo';
    sockets[0]!.reconectando();

    expect(sockets[0]!.io.opts.query).toEqual({
      token: 'nuevo',
      dbName: 'proyecto_abc',
    });
  });

  it('entrega los errores del servidor a quien los pidio', () => {
    const { cliente, sockets } = crearSocket();
    const errores: unknown[] = [];
    cliente.watch(() => undefined, { onError: (e) => errores.push(e) });

    sockets[0]!.socket.entregar('error', {
      code: 'NOTIFICATIONS_UNAUTHORIZED',
      message: 'Token invalido o expirado',
    });

    expect((errores[0] as Error).message).toBe('Token invalido o expirado');
  });

  it('avisa por consola si nadie recoge el error', () => {
    const { cliente, sockets } = crearSocket();
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    cliente.watch(() => undefined);

    sockets[0]!.socket.entregar('exception', { message: 'algo paso' });

    expect(warn).toHaveBeenCalledWith('[roble] notificaciones: algo paso');
    warn.mockRestore();
  });
});

describe('RobleNotifications', () => {
  function api() {
    const llamadas: { method: string; endpoint: string; opts: any }[] = [];
    let respuesta: any = {};
    const notifications = new RobleNotifications(
      async (method, endpoint, opts) => {
        llamadas.push({ method, endpoint, opts });
        return respuesta;
      },
      () => ({}) as any
    );
    return {
      notifications,
      llamadas,
      responde: (r: any) => {
        respuesta = r;
      },
    };
  }

  it('envia a un solo destinatario como lista', async () => {
    const { notifications, llamadas, responde } = api();
    responde([notificacion()]);

    await notifications.send({ to: 'user-1', title: 'Hola', data: { a: 1 } });

    expect(llamadas[0]!.method).toBe('POST');
    expect(llamadas[0]!.endpoint).toBe('');
    expect(llamadas[0]!.opts.body.recipients).toEqual(['user-1']);
    expect(llamadas[0]!.opts.body.data).toEqual({ a: 1 });
  });

  it('deja mandar a todo el proyecto con el comodin', async () => {
    const { notifications, llamadas, responde } = api();
    responde([notificacion({ recipientId: '*' })]);

    await notifications.send({ to: '*', title: 'Aviso' });

    expect(llamadas[0]!.opts.body.recipients).toEqual(['*']);
  });

  it('manda unread como cadena, que es lo que lee el servidor', async () => {
    const { notifications, llamadas, responde } = api();
    responde([]);

    await notifications.list({ unread: true, topic: 'chat', limit: 10 });

    expect(llamadas[0]!.opts.query).toEqual({
      unread: 'true',
      topic: 'chat',
      limit: 10,
      before: undefined,
    });
  });

  it('omite unread cuando no se pide', async () => {
    const { notifications, llamadas, responde } = api();
    responde([]);
    await notifications.list();
    expect(llamadas[0]!.opts.query.unread).toBeUndefined();
  });

  it('devuelve el contador como numero', async () => {
    const { notifications, responde } = api();
    responde({ count: 5 });
    expect(await notifications.unreadCount()).toBe(5);
  });

  it('escapa el id en la ruta', async () => {
    const { notifications, llamadas, responde } = api();
    responde(notificacion());
    await notifications.markRead('a/b');
    expect(llamadas[0]!.endpoint).toBe('a%2Fb/read');
  });

  it('apunta el aparato con su plataforma', async () => {
    const { notifications, llamadas, responde } = api();
    responde({ token: 'tok-1', platform: 'android' });

    await notifications.registerDevice('tok-1', 'android');

    expect(llamadas[0]!.method).toBe('POST');
    expect(llamadas[0]!.endpoint).toBe('devices');
    expect(llamadas[0]!.opts.body).toEqual({
      token: 'tok-1',
      platform: 'android',
    });
  });

  it('escapa el token del aparato en la ruta al soltarlo', async () => {
    const { notifications, llamadas, responde } = api();
    responde({ success: true });

    await notifications.unregisterDevice('a/b+c');

    expect(llamadas[0]!.method).toBe('DELETE');
    expect(llamadas[0]!.endpoint).toBe('devices/a%2Fb%2Bc');
  });

  it('marcar todas devuelve cuantas cambiaron', async () => {
    const { notifications, responde } = api();
    responde({ marked: 3 });
    expect(await notifications.markAllRead()).toBe(3);
  });
});
