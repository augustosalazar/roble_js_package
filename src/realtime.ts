import { io, type Socket } from 'socket.io-client';

/** Operación que originó un evento Realtime. */
export type RobleRealtimeOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Cambio recibido por el WebSocket de Realtime.
 *
 * Ojo con la asimetría del servidor en el árbol JSON: en `INSERT`, `path`
 * apunta al **padre** y el id del nuevo hijo es la clave dentro de `newValue`.
 * En `UPDATE` y `DELETE`, `path` apunta al nodo afectado.
 *
 * Los cambios de una tabla SQL traen `path` vacío: allí la fila la identifica
 * `primaryKey`.
 */
export interface RobleRealtimeEvent {
  eventId: string;
  subscriptionId: string;
  /** Tabla, o colección si el cambio viene del árbol JSON. */
  table: string;
  /** Ruta como lista de segmentos. Vacía en una tabla SQL. */
  path: string[];
  /** Ruta como string, p. ej. `'mensajes/general'`. */
  pathString: string;
  operation: RobleRealtimeOperation;
  /** Clave primaria de la fila. Vacía en el árbol JSON. */
  primaryKey: Record<string, any>;
  /** Valor anterior. `null` en `INSERT`. */
  oldValue: any;
  /** Valor nuevo. `null` en `DELETE`. */
  newValue: any;
  commitTimestamp: string;
  /** Payload crudo tal cual lo envió el servidor. */
  raw: Record<string, any>;
}

/** Estado de la conexión WebSocket. */
export type RobleRealtimeStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/** Cancela una suscripción. Llamarla varias veces es seguro. */
export type RobleUnsubscribe = () => void;

/**
 * Comparación que el servidor aplica antes de mandar el cambio.
 *
 * Filtrar aquí y no en la app ahorra el viaje de todo lo que no interesa, que
 * en una tabla movida es casi todo.
 */
export interface RobleFilter {
  column: string;
  /** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`… */
  operator: string;
  value: unknown;
}

/** Lo que se pide escuchar. */
export interface RobleWatchRequest {
  /** Tabla SQL, o colección del árbol JSON. */
  table: string;
  /** Ruta dentro de la colección, solo para el árbol JSON. */
  path?: string;
  events?: RobleRealtimeOperation[];
  filters?: RobleFilter[];
  onEvent: (event: RobleRealtimeEvent) => void;
  onError?: (error: unknown) => void;
}

interface Listener extends RobleWatchRequest {
  segments: string[];
}

/** Fábrica del socket, sustituible en pruebas. */
export type RobleSocketFactory = (
  url: string,
  opts: Record<string, any>
) => Socket;

const TODAS: RobleRealtimeOperation[] = ['INSERT', 'UPDATE', 'DELETE'];

/** Los segmentos vacíos se descartan: `/a//b/` es `['a','b']`. */
function segmentsOf(path: string): string[] {
  return (path ?? '').split('/').filter((s) => s.length > 0);
}

/**
 * Dos rutas se tocan si una es prefijo de la otra: da igual cuál sea más
 * profunda. Un cambio escrito *por encima* de lo que se escucha también
 * importa, porque reemplazar un padre cambia al hijo aunque nadie lo nombre.
 */
function pathsOverlap(a: string[], b: string[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Conexión al servicio Realtime y reparto de los cambios a quien escucha.
 *
 * Una sola conexión y una sola suscripción por tabla, aunque haya varias
 * escuchas: el servidor cuenta suscripciones contra la cuota del proyecto.
 */
export class RobleRealtimeSocket {
  private socket: Socket | null = null;
  private readonly listeners = new Set<Listener>();

  /**
   * tabla -> suscripcion viva. `spec` es lo que se le pidio al servidor, para
   * saber si sigue sirviendo cuando entra una escucha nueva.
   */
  private readonly subscriptions = new Map<
    string,
    { id: string; spec: string }
  >();

  private statusValue: RobleRealtimeStatus = 'disconnected';

  /** Se invoca en cada cambio de estado de la conexión. */
  onStatusChange?: (status: RobleRealtimeStatus) => void;

  constructor(
    private readonly opts: {
      /** Origen del servicio, sin ruta: el socket cuelga del host. */
      origin: string;
      dbName: string;
      /** Se lee en cada conexión, para no reconectar con un token caduco. */
      token: () => string | null;
      ioFactory?: RobleSocketFactory;
    }
  ) {}

  get status(): RobleRealtimeStatus {
    return this.statusValue;
  }

  /** `true` si hay socket abierto. */
  get isConnected(): boolean {
    return this.socket?.connected === true;
  }

  /**
   * Empieza a escuchar. Devuelve la función que cancela.
   *
   * El stream **no** trae el estado actual, solo lo que cambie a partir de
   * ahora: para pintar lo que ya hay, léelo y aplica encima lo que llegue.
   */
  watch(request: RobleWatchRequest): RobleUnsubscribe {
    const listener: Listener = {
      ...request,
      segments: segmentsOf(request.path ?? ''),
    };
    this.listeners.add(listener);

    try {
      const socket = this.ensureSocket();
      if (socket.connected) this.resubscribeIfNeeded(listener.table);
    } catch (e) {
      this.listeners.delete(listener);
      throw e;
    }

    let cancelada = false;
    return () => {
      if (cancelada) return;
      cancelada = true;
      this.listeners.delete(listener);

      // La suscripción se suelta solo cuando ya nadie escucha esa tabla.
      if (!this.tablasActivas().has(listener.table)) {
        this.unsubscribeTable(listener.table);
      }
      if (this.listeners.size === 0) this.close();
    };
  }

  /** Cierra el socket y cancela todas las escuchas. */
  close(): void {
    this.listeners.clear();
    this.subscriptions.clear();
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected');
  }

  // ---- internos ----

  private setStatus(status: RobleRealtimeStatus) {
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
        'Hay que iniciar sesión antes de escuchar cambios en tiempo real.'
      );
    }

    this.setStatus('connecting');

    const crear = this.opts.ioFactory ?? ((url, o) => io(url, o));
    const socket = crear(`${this.opts.origin}/stream`, {
      // Sin respaldo de long-polling no hacen falta sesiones pegajosas cuando
      // el servidor corre con varios workers.
      transports: ['websocket'],
      query: this.query(),
    });

    socket.on('connect', () => {
      this.setStatus('connected');
      // Al reconectar el servidor no recuerda nada: hay que rehacerlas.
      this.subscriptions.clear();
      for (const table of this.tablasActivas()) this.subscribeTable(table);
    });

    socket.on('disconnect', () => {
      this.subscriptions.clear();
      this.setStatus('disconnected');
    });

    socket.on('connect_error', () => this.setStatus('error'));

    // Nest manda las WsException por `exception`, no por `error`.
    for (const canal of ['error', 'exception']) {
      socket.on(canal, (payload: any) => this.fallo(payload));
    }

    socket.on('data_change', (payload: any) => {
      for (const raw of Array.isArray(payload) ? payload : [payload]) {
        this.dispatch(raw);
      }
    });

    // El token pudo cambiar desde la última conexión: reconectar con el viejo
    // deja el socket rechazado sin decir por qué.
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
        : 'Error del servicio de tiempo real';
    for (const l of this.listeners) l.onError?.(new Error(mensaje));
  }

  private tablasActivas(): Set<string> {
    const set = new Set<string>();
    for (const l of this.listeners) if (l.table) set.add(l.table);
    return set;
  }

  /** Lo que esa tabla necesita ahora mismo, con todas sus escuchas juntas. */
  private specDe(table: string) {
    return {
      events: this.eventosDe(table),
      // Planos, no envueltos: el servidor los lee así, y anidarlos deja el
      // operador vacío y hace que pase todo.
      filters: this.filtrosDe(table),
    };
  }

  /**
   * Rehace la suscripción si la que hay se quedó corta.
   *
   * Una escucha nueva puede necesitar más de lo que se pidió —otro evento, o
   * ningún filtro donde antes había uno—, y quedarse con la vieja la dejaría
   * sin sus cambios sin que nada lo avise.
   */
  private resubscribeIfNeeded(table: string) {
    const viva = this.subscriptions.get(table);
    if (!viva) return this.subscribeTable(table);

    if (viva.spec === JSON.stringify(this.specDe(table))) return;

    this.unsubscribeTable(table);
    this.subscribeTable(table);
  }

  private subscribeTable(table: string) {
    const socket = this.socket;
    if (!socket?.connected || this.subscriptions.has(table)) return;

    const spec = this.specDe(table);

    // Se marca antes del ack: sin esto, dos escuchas registradas en el mismo
    // tick piden la misma suscripción dos veces y gastan cuota de más.
    this.subscriptions.set(table, { id: '', spec: JSON.stringify(spec) });

    socket.emit(
      'subscribe',
      {
        type: 'subscribe',
        requestId: `${table}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
        table,
        ...spec,
      },
      (ack: any) => {
        if (ack?.subscriptionId) {
          this.subscriptions.set(table, {
            id: ack.subscriptionId,
            spec: JSON.stringify(spec),
          });
        } else {
          this.subscriptions.delete(table);
          this.fallo(ack);
        }
      }
    );
  }

  /** La unión de lo que pide cada escucha de esa tabla. */
  private eventosDe(table: string): RobleRealtimeOperation[] {
    const pedidos = new Set<RobleRealtimeOperation>();
    for (const l of this.listeners) {
      if (l.table !== table) continue;
      // Una escucha sin `events` los quiere todos, y eso manda sobre el resto.
      if (!l.events?.length) return TODAS;
      for (const e of l.events) pedidos.add(e);
    }
    return pedidos.size ? [...pedidos] : TODAS;
  }

  /**
   * Solo se mandan al servidor si **todas** las escuchas de la tabla piden lo
   * mismo: filtrar por una dejaría a las demás sin sus cambios.
   */
  private filtrosDe(table: string): RobleFilter[] {
    const deLaTabla = [...this.listeners].filter((l) => l.table === table);
    const primera = JSON.stringify(deLaTabla[0]?.filters ?? []);
    const todasIguales = deLaTabla.every(
      (l) => JSON.stringify(l.filters ?? []) === primera
    );
    return todasIguales ? (deLaTabla[0]?.filters ?? []) : [];
  }

  private unsubscribeTable(table: string) {
    const viva = this.subscriptions.get(table);
    this.subscriptions.delete(table);
    if (!viva?.id) return;
    this.socket?.emit('unsubscribe', {
      type: 'unsubscribe',
      subscriptionId: viva.id,
    });
  }

  private dispatch(raw: any) {
    if (!raw || typeof raw !== 'object') return;

    const path: string[] = Array.isArray(raw.path) ? raw.path.map(String) : [];
    const event: RobleRealtimeEvent = {
      eventId: String(raw.eventId ?? ''),
      subscriptionId: String(raw.subscriptionId ?? ''),
      table: String(raw.table ?? path[0] ?? ''),
      path,
      pathString: path.join('/'),
      operation: raw.operation,
      primaryKey:
        raw.primaryKey && typeof raw.primaryKey === 'object'
          ? raw.primaryKey
          : {},
      oldValue: raw.old ?? null,
      newValue: raw.new ?? null,
      commitTimestamp: String(raw.commitTimestamp ?? ''),
      raw,
    };

    for (const l of this.listeners) {
      if (l.table !== event.table) continue;
      // El primer segmento es la colección, que ya decidió la suscripción.
      if (!pathsOverlap(l.segments, path.slice(1))) continue;

      try {
        l.onEvent(event);
      } catch (e) {
        l.onError?.(e);
      }
    }
  }
}
