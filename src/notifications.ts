import { io, type Socket } from 'socket.io-client';
import type { RobleSocketFactory, RobleUnsubscribe } from './realtime';

/** Que le paso a la notificacion. */
export type RobleNotificationEventType = 'created' | 'read' | 'deleted';

/** Una notificacion tal como la manda el servidor. */
export interface RobleNotification {
  id: string;
  /** Proyecto al que pertenece. */
  dbName: string;
  /** Usuario destinatario, o `'*'` si va a todo el proyecto. */
  recipientId: string;
  /** Quien la envio, si se sabe. */
  senderId: string | null;
  /** Etiqueta libre para agrupar o filtrar (`'chat'`, `'tareas'`...). */
  topic: string | null;
  title: string;
  body: string | null;
  /** Carga util libre: lo que la app necesite para abrir la pantalla correcta. */
  data: Record<string, any>;
  /** Cuando la marco leida **este** usuario, o `null`. */
  readAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** Lo que llega por el socket. */
export interface RobleNotificationEvent {
  type: RobleNotificationEventType;
  notification: RobleNotification;
}

/** Estado de la conexion de notificaciones. */
export type RobleNotificationsStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/** Lo que hace falta para enviar. */
export interface RobleSendNotification {
  /**
   * Destinatarios. Un id, una lista de ids, o `'*'` para todo el proyecto.
   * El comodin no se mezcla con ids concretos: el servidor lo rechaza.
   */
  to: string | string[];
  title: string;
  body?: string;
  topic?: string;
  data?: Record<string, any>;
  /** Fecha ISO a partir de la cual deja de entregarse y de listarse. */
  expiresAt?: string;
}

/** Sistema del aparato que recibe el push. */
export type RobleDevicePlatform = 'android' | 'ios' | 'web';

/** Un aparato apuntado para recibir push. */
export interface RobleDevice {
  dbName: string;
  userId: string;
  /** El token de FCM del aparato. */
  token: string;
  platform: RobleDevicePlatform;
  createdAt: string;
  lastSeenAt: string;
}

/** Cada cuanto se repite un envio programado. */
export type RobleRepeat = 'none' | 'daily' | 'weekly';

/** Un envio programado. */
export interface RobleScheduledNotification {
  id: string;
  dbName: string;
  /** Cuando toca el proximo envio. */
  sendAt: string;
  repeat: RobleRepeat;
  recipients: string[];
  title: string;
  body: string | null;
  topic: string | null;
  data: Record<string, any>;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  /** Cuantas veces se ha enviado ya. Interesa en las repetidas. */
  runs: number;
  lastRunAt: string | null;
  /** Por que fallo, si fallo. Una repetida que falla se para. */
  lastError: string | null;
  senderId: string | null;
  senderKind: 'user' | 'console' | 'service';
  createdAt: string;
}

/** Lo que hace falta para programar. */
export interface RobleScheduleNotification extends RobleSendNotification {
  /** Cuando enviarla. Tiene que estar en el futuro. */
  at: Date | string;
  /** Si se repite. Por defecto no. */
  repeat?: RobleRepeat;
}

/** Filtros del listado. */
export interface RobleListNotifications {
  unread?: boolean;
  topic?: string;
  /** Entre 1 y 100. Por defecto 50. */
  limit?: number;
  /** Devuelve las anteriores a esta fecha ISO, para paginar hacia atras. */
  before?: string;
}

type Request = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  endpoint: string,
  opts?: { body?: any; query?: Record<string, any> }
) => Promise<any>;

/**
 * Conexion al canal de notificaciones.
 *
 * Es un socket aparte del de tiempo real, contra el namespace
 * `/notifications`. No hay nada que suscribir: el destinatario es quien firma
 * el token, asi que conectarse ya es todo el protocolo.
 */
export class RobleNotificationsSocket {
  private socket: Socket | null = null;
  private readonly listeners = new Set<{
    onEvent: (event: RobleNotificationEvent) => void;
    onError?: (error: unknown) => void;
  }>();

  private statusValue: RobleNotificationsStatus = 'disconnected';

  /** Ultimo contador que mando el servidor al conectar. */
  private unreadValue = 0;

  /** Se invoca en cada cambio de estado de la conexion. */
  onStatusChange?: (status: RobleNotificationsStatus) => void;

  /** Se invoca con el contador que llega al conectar. */
  onUnreadCount?: (count: number) => void;

  constructor(
    private readonly opts: {
      origin: string;
      dbName: string;
      token: () => string | null;
      ioFactory?: RobleSocketFactory;
    }
  ) {}

  get status(): RobleNotificationsStatus {
    return this.statusValue;
  }

  get isConnected(): boolean {
    return this.socket?.connected === true;
  }

  /** Lo que el servidor dijo al conectar. Se refresca en cada reconexion. */
  get unread(): number {
    return this.unreadValue;
  }

  /**
   * Empieza a escuchar. Devuelve la funcion que cancela.
   *
   * El socket se abre con la primera escucha y se cierra con la ultima.
   */
  watch(
    onEvent: (event: RobleNotificationEvent) => void,
    opts: { onError?: (error: unknown) => void } = {}
  ): RobleUnsubscribe {
    const listener = { onEvent, onError: opts.onError };
    this.listeners.add(listener);

    try {
      this.ensureSocket();
    } catch (e) {
      this.listeners.delete(listener);
      throw e;
    }

    let cancelada = false;
    return () => {
      if (cancelada) return;
      cancelada = true;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  }

  /** Cierra el socket y cancela todas las escuchas. */
  close(): void {
    this.listeners.clear();
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected');
  }

  // ---- internos ----

  private setStatus(status: RobleNotificationsStatus) {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.onStatusChange?.(status);
  }

  private query() {
    return { token: this.opts.token() ?? '', dbName: this.opts.dbName };
  }

  private ensureSocket(): Socket {
    if (this.socket) return this.socket;

    if (!this.opts.token()) {
      throw new Error(
        'Hay que iniciar sesion antes de escuchar notificaciones.'
      );
    }

    this.setStatus('connecting');

    const crear = this.opts.ioFactory ?? ((url, o) => io(url, o));
    const socket = crear(`${this.opts.origin}/notifications`, {
      transports: ['websocket'],
      query: this.query(),
    });

    socket.on('connected', (payload: any) => {
      this.setStatus('connected');
      // El servidor manda el contador al conectar, para que el badge se pinte
      // sin una llamada REST de mas.
      this.unreadValue = Number(payload?.unread ?? 0);
      this.onUnreadCount?.(this.unreadValue);
    });

    socket.on('disconnect', () => this.setStatus('disconnected'));
    socket.on('connect_error', () => this.setStatus('error'));

    // Nest manda las WsException por `exception`, no por `error`.
    for (const canal of ['error', 'exception']) {
      socket.on(canal, (payload: any) => this.fallo(payload));
    }

    socket.on('notification', (payload: any) => this.dispatch(payload));

    // El token pudo cambiar desde la ultima conexion: reconectar con el viejo
    // deja el socket rechazado sin decir por que.
    socket.io?.on?.('reconnect_attempt', () => {
      if (socket.io.opts) socket.io.opts.query = this.query();
    });

    this.socket = socket;
    return socket;
  }

  private fallo(payload: any) {
    const mensaje =
      typeof payload?.message === 'string'
        ? payload.message
        : 'Error del servicio de notificaciones';

    const error = new Error(mensaje);
    let entregado = false;
    for (const l of this.listeners) {
      if (!l.onError) continue;
      l.onError(error);
      entregado = true;
    }
    if (!entregado) console.warn(`[roble] notificaciones: ${mensaje}`);
  }

  private dispatch(payload: any) {
    if (!payload?.notification) return;

    const event: RobleNotificationEvent = {
      type: payload.type,
      notification: payload.notification as RobleNotification,
    };

    for (const l of this.listeners) {
      try {
        l.onEvent(event);
      } catch (e) {
        l.onError?.(e);
      }
    }
  }
}

/**
 * Notificaciones del proyecto: enviarlas, listarlas y escucharlas.
 *
 * Es una funcion aparte del arbol JSON: no son colecciones, no hay que crear
 * nada antes, y su socket es otro.
 *
 * ```ts
 * const parar = db.notifications.watch(({ type, notification }) => {
 *   if (type === 'created') mostrar(notification.title);
 * });
 *
 * await db.notifications.send({ to: otroUsuarioId, title: 'Te toca' });
 * ```
 */
export class RobleNotifications {
  constructor(
    private readonly request: Request,
    private readonly socket: () => RobleNotificationsSocket
  ) {}

  /** Envia una notificacion. Devuelve una por destinatario. */
  async send(params: RobleSendNotification): Promise<RobleNotification[]> {
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    return this.request('POST', '', {
      body: {
        recipients,
        title: params.title,
        body: params.body,
        topic: params.topic,
        data: params.data,
        expiresAt: params.expiresAt,
      },
    });
  }

  /**
   * Las notificaciones visibles para quien tiene la sesion abierta: las suyas
   * y las del proyecto, de la mas reciente a la mas antigua.
   */
  async list(opts: RobleListNotifications = {}): Promise<RobleNotification[]> {
    return this.request('GET', '', {
      query: {
        // El servidor lee la cadena, no el booleano.
        unread: opts.unread ? 'true' : undefined,
        topic: opts.topic,
        limit: opts.limit,
        before: opts.before,
      },
    });
  }

  /** Cuantas lleva sin leer. Es lo que pinta el badge. */
  async unreadCount(): Promise<number> {
    const res = await this.request('GET', 'unread-count');
    return Number(res?.count ?? 0);
  }

  /** Marca una como leida. Marcarla dos veces no cambia nada. */
  async markRead(id: string): Promise<RobleNotification> {
    return this.request('PATCH', `${encodeURIComponent(id)}/read`);
  }

  /** Marca todas. Devuelve cuantas cambiaron de estado. */
  async markAllRead(): Promise<number> {
    const res = await this.request('PATCH', 'read-all');
    return Number(res?.marked ?? 0);
  }

  /**
   * Borra una notificacion dirigida.
   *
   * Las de proyecto no se pueden borrar desde un cliente: la fila es
   * compartida. Marcalas leidas.
   */
  async remove(id: string): Promise<void> {
    await this.request('DELETE', encodeURIComponent(id));
  }

  /**
   * Programa un envio para mas tarde.
   *
   * Lo manda el servidor cuando llegue la hora, aunque nadie tenga la app
   * abierta. Con `repeat` se repite a diario o cada semana, que es como se
   * hace un "buenos dias" sin montar un cron.
   *
   * ```ts
   * await db.notifications.schedule({
   *   to: usuarioId,
   *   title: 'Tu cita es en una hora',
   *   at: new Date(Date.now() + 3600_000),
   * });
   * ```
   *
   * Quien puede enviar tambien decide quien puede programar: se comprueba al
   * programar y otra vez al enviar, porque para entonces puede haber cambiado.
   */
  async schedule(
    params: RobleScheduleNotification
  ): Promise<RobleScheduledNotification> {
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    return this.request('POST', 'schedule', {
      body: {
        recipients,
        title: params.title,
        body: params.body,
        topic: params.topic,
        data: params.data,
        expiresAt: params.expiresAt,
        sendAt: params.at instanceof Date ? params.at.toISOString() : params.at,
        repeat: params.repeat,
      },
    });
  }

  /**
   * Los envios que tienes programados.
   *
   * Solo los tuyos: lo que otra persona tenga preparado no se ve desde aqui.
   * Por defecto los pendientes; con `all` tambien los ya enviados, cancelados
   * y fallidos.
   */
  async scheduled(
    opts: { all?: boolean } = {}
  ): Promise<RobleScheduledNotification[]> {
    return this.request('GET', 'schedule', {
      query: { all: opts.all ? 'true' : undefined },
    });
  }

  /** Cancela uno pendiente. No lo borra: queda como cancelado. */
  async cancelScheduled(id: string): Promise<void> {
    await this.request('DELETE', `schedule/${encodeURIComponent(id)}`);
  }

  /**
   * Apunta este aparato para recibir push cuando la app este cerrada.
   *
   * El `token` lo da el SDK de Firebase dentro de tu app —este paquete no lo
   * pide ni lo genera—, y el push solo sale si el proyecto tiene subidas sus
   * credenciales de Firebase en la consola de Roble.
   *
   * Llamarlo otra vez con el mismo token no duplica nada: solo refresca la
   * fecha, que es justo lo que conviene hacer en cada arranque.
   *
   * ```ts
   * const token = await getToken(messaging, { vapidKey });
   * await db.notifications.registerDevice(token, 'web');
   * ```
   */
  async registerDevice(
    token: string,
    platform: RobleDevicePlatform
  ): Promise<RobleDevice> {
    return this.request('POST', 'devices', { body: { token, platform } });
  }

  /**
   * Deja de recibir push en este aparato.
   *
   * Llamalo **antes** de cerrar sesion: despues ya no hay token con el que
   * pedirlo, y el aparato seguiria recibiendo los avisos de esa cuenta.
   */
  async unregisterDevice(token: string): Promise<void> {
    await this.request('DELETE', `devices/${encodeURIComponent(token)}`);
  }

  /** Los aparatos que esta cuenta tiene apuntados. */
  async devices(): Promise<RobleDevice[]> {
    return this.request('GET', 'devices');
  }

  /**
   * Escucha lo que vaya llegando. Devuelve la funcion que cancela.
   *
   * No trae lo que ya hay: para pintar la lista, `list()` y encima lo que
   * llegue.
   */
  watch(
    onEvent: (event: RobleNotificationEvent) => void,
    opts: { onError?: (error: unknown) => void } = {}
  ): RobleUnsubscribe {
    return this.socket().watch(onEvent, opts);
  }

  /** La conexion: estado, contador al conectar y cierre. */
  get connection(): RobleNotificationsSocket {
    return this.socket();
  }
}
