# Changelog

## 3.9.0

### Añadido

- **`db.notifications`: avisos que se guardan y llegan al momento.** Función
  aparte del árbol JSON: no hay colección que crear ni ruta que elegir, el
  destinatario es un usuario del proyecto y va por su propio socket.

  ```js
  const parar = db.notifications.watch(({ type, notification }) => {
    if (type === 'created') mostrarAviso(notification.title);
  });

  await db.notifications.send({ to: otroUsuarioId, title: 'Te toca' });
  ```

  `send({ to: '*' })` va a todo el proyecto, y cada persona la marca leída por
  su cuenta: leerla no la marca para los demás.

  `list()`, `unreadCount()`, `markRead()`, `markAllRead()` y `remove()` para lo
  que ya estaba ahí —el socket solo trae lo que llegue a partir de ahora—, y
  `notifications.connection.onUnreadCount` para el globito, que el servidor
  manda al conectar sin que haya que pedirlo.

- **`registerDevice(token, platform)`: notificaciones con la app cerrada.** El
  token lo da el SDK de Firebase en tu app; este paquete solo lo guarda para que
  Roble pueda mandar el push.

  ```js
  const token = await getToken(messaging, { vapidKey });
  await db.notifications.registerDevice(token, 'web');
  ```

  Hacen falta **tus** credenciales de Firebase, subidas en la consola de Roble:
  un token de FCM está atado al proyecto de Firebase con el que registraste la
  app, así que Roble no puede enviarle push con las suyas.

  `unregisterDevice(token)` antes de cerrar sesión; si no, ese aparato sigue
  recibiendo los avisos de esa cuenta.

### Corregido

- Salir de la sesión cierra el socket de notificaciones. Quedaba abierto y
  autenticado como quien acababa de salir, así que la siguiente persona en usar
  la app recibía lo que llegara para la anterior.


## 3.8.0

### Añadido

- **`db.onAuthStateChanged(cb)`: la sesión y cada cambio que le pase.** Llama al
  escuchador ya, con el estado actual, y luego en cada cambio: al entrar, al
  recuperar una sesión guardada, al salir y cuando se cae sola.

  ```js
  const dejarDeEscuchar = db.onAuthStateChanged((estado) => {
    setUsuario(estado.isSignedIn ? estado.user : null);
  });
  ```

  Cada estado dice **por qué** cambió (`RobleAuthReason`), que es lo que un
  `user | null` a secas no cuenta: `signedOut` y `expired` dejan los dos sin
  sesión, pero solo uno merece un «tu sesión caducó». `restored` se distingue de
  `signedIn` porque recuperar una sesión guardada no es que alguien acabe de
  entrar.

  `db.authState` da el estado de ahora mismo sin suscribirse.

  Mismo comportamiento que `authStateChanges` del paquete de Flutter (1.8.0).

### Cambiado

- `onSessionExpired` pasa a ser un filtro de `onAuthStateChanged`, no otro
  mecanismo. Mismo comportamiento que en 3.7.0, y sigue sin repartir el estado
  actual al suscribirse: es un aviso de lo que pase a partir de ahora.

- `restoreSession()` pide el perfil al comprobar que la sesión sigue viva, para
  poder emitirlo con el estado. Una app que ya lo pedía por su cuenta al
  arrancar puede dejar de hacerlo.

- Borrar la cuenta emite `signedOut`, que antes se quedaba sin avisar.

## 3.7.0

### Añadido

- **`db.onSessionExpired(cb)`: aviso cuando la sesión se cae sola.** Avisa
  cuando el servidor rechaza el access token y el de refresco tampoco vale, que
  es el punto en el que ya no hay forma de seguir.

  ```js
  const dejarDeEscuchar = db.onSessionExpired(() => navigate('/login'));
  ```

  Antes esto solo se podía deducir cazando `RobleApiAuthException`, y
  únicamente si alguien hacía una llamada y la capturaba en el sitio correcto:
  una sesión caducada se quedaba enseñando el error en cada pantalla mientras
  la app seguía creyéndose dentro. El cliente es quien primero lo sabe, porque
  es el código al que le acaba de fallar el refresco.

  La sesión ya está descartada cuando avisa —`isLoggedIn` es `false`—, avisa
  una sola vez aunque fallen a la vez varias llamadas, se rearma al entrar de
  nuevo, y no avisa en `logout()`.

  Devuelve cómo darse de baja, para soltarlo al desmontar el componente: sin
  eso, cada montaje deja un escuchador más sobre el mismo cliente.

## 3.6.0

### Añadido

- **`db.files`: archivos en el bucket del proyecto.** `upload`, `list`,
  `getDownloadUrl` y `remove`.

  Los bytes **no pasan por Roble**: el cliente pide una URL firmada y sube o
  baja directo contra el bucket S3 del proyecto. Por eso no hay límite de
  tamaño impuesto por el paquete —el que manda es el del bucket— y el archivo
  no consume el ancho de banda del servidor.

  ```ts
  const fileId = await db.files.upload({ file, folder: 'facturas' });
  const { downloadUrl } = await db.files.getDownloadUrl(fileId);
  ```

  El proyecto necesita un bucket conectado desde la consola, en
  **Configuración → Almacenamiento**. Sin él, el servidor responde diciendo
  eso mismo y dónde hacerlo.

  Requiere `app-roble` v1.9.1 o superior y `db-service-roble` v1.8.0 o
  superior.

## 3.5.0

### Cambiado

- **El tiempo real escucha colecciones del árbol JSON, no tablas SQL.** El
  servidor dejó de replicar tablas: emitía a cualquiera con sesión sin pasar
  por los permisos por rol, y compartía espacio de nombres con las
  colecciones, así que una tabla homónima se entregaba a quien escuchaba la
  colección. Requiere `realtime` v0.10.1.

- **Un fallo del tiempo real ya no se pierde cuando no hay `onError`.** Como
  es opcional, quien no lo pasaba se quedaba con una suscripción muda y sin
  nada en ninguna parte que dijera por qué. Ahora sale por `console.warn`. Si
  pasas `onError`, no cambia nada: no se duplica.

### Obsoleto

- **`watchTable` y `watchRecord`.** El servidor rechaza esas suscripciones con
  `REALTIME_UNKNOWN_COLLECTION`, así que ya no entregan nada. Usa `json.watch`
  sobre la colección correspondiente.

  No se borran: dejarlas hace que llegue el error del servidor explicando qué
  usar, mientras que quitarlas daría un `TypeError` sin pista.

## 3.4.0

### Añadido

- **`RobleUser.role`**: el rol asignado en la consola, o `null` si no tiene.
  Llega en cualquier forma de entrar. Requiere `auth-service` v1.7.8.

### Documentación

- El README dice ahora **qué devuelve cada método**, con el perfil completo
  del login escrito, y avisa de que `id` y `userId` no son lo mismo.

## 3.3.0

### Añadido

- **Vuelve el tiempo real.** Se retiró en la 3.1.0 porque el servicio no estaba
  listo; ya lo está. Vuelve `socket.io-client` como dependencia.
- **`db.watchTable(tabla, cb)`** y **`db.watchRecord(tabla, id, cb)`**:
  cambios de una tabla SQL. Devuelven la función que cancela.
- **`db.json.watch(ruta, cb)`**: cambios del árbol JSON, incluidos los escritos
  *por encima* de la rama escuchada —reemplazar un padre cambia al hijo—.
- **`db.realtime`**: estado de la conexión y cierre.

### Notas

- Los filtros viajan **planos**. Anidados el servidor lee el operador vacío y
  deja pasar todo, con lo que el filtro parece funcionar sin filtrar nada.
- Una sola conexión y una sola suscripción por tabla, aunque escuchen varios:
  el servidor las cuenta contra la cuota del proyecto. Si una escucha nueva
  necesita más que la vigente —otro evento, o ningún filtro donde había uno—,
  la suscripción se rehace.
- El token se lee en cada conexión, no una vez. Reconectar con uno caducado
  deja el socket rechazado sin decir por qué.

## 3.2.0

Traído del paquete de Flutter, que iba por delante. Todo es HTTP: no entra
ninguna dependencia nueva.

### Añadido

- **Base de datos JSON (`db.json`).** Un árbol por proyecto, al estilo de
  Firebase Realtime Database: `collections`, `read` (con `shallow`), `write`,
  `update`, `push` y `remove`. No hay esquema que declarar —la estructura nace
  al escribir— y el árbol vive fuera del esquema del proyecto, así que no
  aparece entre sus tablas. Es lo que corresponde a un chat o una partida.
- **`executeQueryByName(nombre)`**: ejecuta una consulta guardada por su
  nombre. El nombre se lee en la consola y sobrevive a recrear la consulta,
  mientras que el UUID cambia.
- **`listProviders()`** y **`providerClientId(nombre)`**: los proveedores de
  login social configurados, para pintar solo los botones que van a funcionar
  y para que la app no lleve una segunda copia del Client ID.
- **`signInWithIdToken()`**: canjea un `id_token` que ya obtuvo un SDK nativo
  —Google Identity Services en el navegador, el módulo nativo en React
  Native—. No abre ninguna ventana.

### Notas

- `db.json` no trae `watch`: escuchar necesita el socket, que la 3.1.0 retiró
  a propósito. La parte HTTP del árbol no lo necesita.
- El árbol JSON cuelga de `/realtime` en el mismo host que la API. No vuelve
  `realtimeBaseUrl`.

## 3.1.0

### Cambios incompatibles

- **El servicio Realtime sale de la API pública.** Se retiran `db.realtime` y
  los tipos `RobleRealtime*` mientras se estabiliza, junto con la dependencia
  `socket.io-client` y el campo `realtimeBaseUrl`. El código sigue en el
  historial (`v3.0.0`) para reincorporarlo más adelante.

- **La sesión deja de ser manipulable desde fuera.** Desaparecen
  `accessToken`, `refreshToken`, `setTokens()`, `clearTokens()` y
  `onTokenUpdate`. En su lugar hay un único miembro de consulta,
  `isLoggedIn`. Los métodos que mutan la sesión pasan a campos privados de
  JavaScript (`#`), así que tampoco son alcanzables desde JS, no solo desde
  TypeScript.

  | Antes | Ahora |
  | --- | --- |
  | `db.accessToken !== null` | `db.isLoggedIn` |
  | `db.setTokens(...)` | pasar `storage` y `restoreSession()` |
  | `db.clearTokens()` | `logout()` |

- **Se recorta la superficie de datos a lo esencial.** Desaparecen
  `createTable()` y `getTableData()` —usaban endpoints que ROBLE no
  documenta—, `createTableFromTemplate()` (las tablas se crean en la consola)
  y los envoltorios `getAll()` y `getWhere()`, que eran `read()` con otro
  nombre. Se mantiene `getById()`.

  | Antes | Ahora |
  | --- | --- |
  | `getAll(tabla)` | `read(tabla)` |
  | `getWhere(tabla, col, valor)` | `read(tabla, {col: valor})` |

- **`currentUser()` devuelve el perfil del usuario, no los datos del token.**
  Pasa de `GET /verify-token` a `GET /me`: `userId`, `email`, `name`, el
  `extra` del registro y las fechas. Antes devolvía los claims del JWT
  (`sub`, `role`, `sessionId`), que son detalle interno de la autenticación.
  Si leías `user.sub`, usa `user.userId`. La librería ya no llama a
  `/verify-token`.

- **`login()` devuelve ese mismo perfil, no los tokens.** Si la llamada a
  `/me` falla, la sesión **sigue activa**: el error se propaga pero
  `isLoggedIn` ya es `true`, así que se puede distinguir un fallo de
  credenciales de uno de perfil y reintentar con `currentUser()`.

### Añadido

- **`register({autoLogin: true})`** inicia sesión al terminar el registro y
  devuelve el perfil, igual que `login`. Por defecto es `false` y se sigue
  devolviendo el mensaje del servidor. `registerWithVerification` no lo
  admite: hasta validar el código del correo la cuenta no puede entrar.
- **`login({persistSession: false})`** mantiene la sesión solo en memoria y
  **borra la que hubiera guardada**, para no dejar una sesión anterior
  recuperable. El valor se respeta también en los refrescos posteriores.
- **`createMany(..., {strict: true})`** lanza `RoblePartialInsertException` si
  el servidor rechaza alguna fila. La excepción conserva el resultado
  completo, así que se sabe qué sí llegó a escribirse.
- **`restoreSession()` comprueba que la sesión siga viva**: además de cargar
  los tokens guardados, renueva el access token contra el servidor. Si el
  refresh token caducó, limpia la sesión y devuelve `false`. Los fallos de red
  se propagan en lugar de borrarla. Con `{verify: false}` solo lee el
  almacenamiento.
- **Persistencia de sesión opcional**: la interfaz `RobleStorage` y el campo
  `storage`. En el navegador usa `localStorage` si no se indica nada; en Node
  y React Native hay que pasarlo.
- **`createRobleClient` valida su configuración** y lanza `Error` si `baseUrl`
  no es una URL o si el `contractId` está vacío o sigue siendo un valor de
  ejemplo.
- **Pista en el `500` de autenticación**: es lo que devuelve Roble cuando el
  contrato no existe, así que el mensaje ahora lo sugiere.

### Corregido

- Si el servidor rotara el refresh token al refrescar, ahora se conserva en
  lugar de descartarse. Hoy `/refresh-token` solo devuelve `accessToken`, así
  que es prevención.

## 3.0.0

### Añadido

- **Servicio Realtime** (`db.realtime`): árbol JSON por proyecto con API al
  estilo Firebase — `ref()`, `child()`, `parent`, `key`, `get({shallow})`,
  `set()`, `update()`, `push()`, `remove()`, más `collections()` y `health()`.
  Cubre `GET/PUT/PATCH/POST/DELETE /realtime/{db}/{path}`.
- **Suscripciones en tiempo real**: `ref.onValue()` y `ref.onEvent()` sobre
  WebSocket, con `RobleRealtimeEvent`, `status`, `onStatusChange` y `close()`.
  Un solo socket compartido, resuscripción automática al reconectar y
  cancelación por colección cuando no quedan escuchas. Añade la dependencia
  `socket.io-client`.
- `realtimeBaseUrl` en la configuración: en Roble el servicio de realtime vive
  en su propio host y el WebSocket solo funciona contra él.
- `register()` y `registerWithVerification()` aceptan un `extra` opcional
  (`Record<string, any>`) con campos adicionales que el backend guarda junto
  al usuario. Se envía en el campo `extra` del cuerpo, y se omite si no se
  pasa.
- Los ejemplos (`example/node` y `example/expo`) demuestran Realtime.

### Cambios incompatibles

- `signupWithVerification()` pasa a llamarse `registerWithVerification()`,
  para leerse en pareja con `register()`.

## 2.0.0

### Cambios incompatibles

- La configuración se reduce a `{baseUrl, contractId, timeoutMs?}`. Se
  eliminan `projectId`, `authHeaders`, `dataHeaders` y `pathBuilder`: ninguno
  era necesario para hablar con ROBLE, que solo requiere `Content-Type` y
  `Authorization`, y ambos los pone el cliente. `contractId` se usa ahora para
  las dos rutas, `/auth` y `/database`.

## 1.1.0

> No publicada: sus cambios salieron en 2.0.0.

Cobertura completa de la API documentada de ROBLE: de 8 a 19 endpoints.

### Añadido

- Autenticación: `registerWithVerification()` (`/signup`), `verifyEmail()`,
  `resendCode()`, `currentUser()` (`/verify-token`, el único endpoint que
  devuelve la identidad del usuario), `forgotPassword()`, `resetPassword()` y
  `deleteAccount()`.
- Datos: `createMany()` (`/insert`), `executeQuery()` (`/execute-query`, la vía
  para joins, orden y paginación), `createTableFromTemplate()` y
  `publicRead()` (`/public-read`, sin autenticación).
- Tipos `RobleInsertResult`, `RobleSkippedRecord`, `RobleQueryResult` y
  `RobleUser`.

### Corregido

- **`create()` podía informar éxito sobre una fila rechazada.** Enviaba el
  registro a `/insert`, que responde `200` con `{inserted: [], skipped: [...]}`
  cuando el servidor lo rechaza; al no haber nada en `inserted`, el método
  devolvía ese objeto como si fuera la fila creada, sin `_id` y sin error.
  Ahora usa `/insert-one`, que devuelve la fila directamente y falla con un
  error HTTP si la rechaza.
- Para insertar varios registros, `createMany()` expone `skipped` en lugar de
  descartarlo. Revisa `hasSkipped` después de cada llamada.

## 1.0.0

Primera versión publicada como `roble-client`. Sustituye a
`react-native-roble-api-database-rena`, y expone exactamente los mismos
métodos que el paquete Flutter `roble`.

### Añadido

- El paquete deja de ser específico de React Native: ya no declara `react` ni
  `react-native` como peer dependencies y se publica con builds ESM y
  CommonJS, por lo que funciona en Node.js, navegador, React, React Native y
  JavaScript sin framework.

- Jerarquía de excepciones: `RobleApiNetworkException`,
  `RobleApiTimeoutException`, `RobleApiFormatException`,
  `RobleApiHttpException` (con `statusCode`) y `RobleApiAuthException`, todas
  derivadas de `RobleApiException`.
- Los fallos de transporte de axios se traducen a excepciones del paquete: un
  timeout produce `RobleApiTimeoutException` y una petición sin respuesta
  produce `RobleApiNetworkException`. Antes escapaban como `AxiosError` crudo.
- Getters `accessToken` y `refreshToken`.
- `projectId` en la configuración: permite que el contrato de autenticación y
  el proyecto de datos usen identificadores distintos.

### Cambiado

- `register` y `login` reciben un objeto (`{email, password, name}` y
  `{email, password}`) en lugar de parámetros posicionales.
- La configuración pasa de `{baseURL, codeUrl}` a
  `{baseUrl, contractId, projectId?}`.
- `getAccessToken()` y `getRefreshToken()` se reemplazan por los getters
  `accessToken` y `refreshToken`.
- `pathBuilder` recibe el identificador ya resuelto según el tipo de ruta.

### Eliminado

- `refreshTokenManual()`. El refresco del token es interno y automático ante
  un `401`.
