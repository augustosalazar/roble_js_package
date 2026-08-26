# Changelog

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
