# roble-client

Cliente de JavaScript para **Roble**, la plataforma de Uninorte OpenLab.

Con este paquete tu app puede tener cuentas de usuario, guardar datos y
enterarse de los cambios al momento, sin que escribas backend. Funciona en el
navegador, en React, en React Native y en Node.

---

## Instalación

```bash
npm install roble-client
```

---

## Tu primer minuto

Necesitas dos datos de la consola de Roble: la **URL** y el **id de tu
proyecto** (el «contrato»).

```js
import { RobleApiClient } from 'roble-client';

const db = new RobleApiClient({
  baseUrl: 'https://roble-api.test-openlab.uninorte.edu.co',
  contractId: 'miproyecto_ab12cd34',
});

// Crear una cuenta
await db.register({
  email: 'ana@correo.com',
  password: 'MiClave!1',
  name: 'Ana García',
});

// Entrar. Devuelve el perfil.
const usuario = await db.login({
  email: 'ana@correo.com',
  password: 'MiClave!1',
});
console.log(`Hola ${usuario.name}`);
```

Crea `db` **una sola vez** y expórtalo. Si lo creas de nuevo en cada
componente, cada copia tendrá su propia sesión.

---

## Cuentas de usuario

### Entrar y salir

```js
await db.login({ email, password });
await db.logout();

if (db.isLoggedIn) console.log('Hay alguien dentro');

const perfil = await db.currentUser();
```

### Que la sesión sobreviva a recargar

En el navegador la sesión se guarda sola en `localStorage`. Al arrancar,
pregúntale a Roble si sigue valiendo:

```js
if (await db.restoreSession()) {
  // Muestra la pantalla principal
} else {
  // Muestra el login
}
```

En **Node** o **React Native** no hay `localStorage`, así que le dices dónde
guardar:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

const db = new RobleApiClient({
  baseUrl: '…',
  contractId: '…',
  storage: AsyncStorage, // getItem / setItem / removeItem
});
```

Sin `storage`, la sesión vive solo en memoria y se pierde al reiniciar.

### Registro con código por correo

```js
await db.registerWithVerification({
  email: 'ana@correo.com',
  password: 'MiClave!1',
  name: 'Ana García',
});

// Ana recibe un código y lo escribe en tu formulario
await db.verifyEmail({ email: 'ana@correo.com', code: '123456' });
```

`resendCode({ email })` lo manda otra vez si no llegó.

### Contraseña olvidada

```js
await db.forgotPassword({ email: 'ana@correo.com' });
await db.resetPassword({ token: '123456', newPassword: 'OtraClave!2' });
```

---

## Entrar con Google

El token lo consigue el SDK de Google —Google Identity Services en el
navegador, el módulo nativo en React Native— y aquí solo se canjea:

```js
const usuario = await db.signInWithIdToken({
  provider: 'google',
  idToken: tokenQueDioGoogle,
  nonce, // el mismo que le pasaste a Google
});
```

El Client ID no lo escribas en tu código: pídeselo a Roble, que es donde se
configura.

```js
const clientId = await db.providerClientId('google');
```

Así no hay dos copias que puedan separarse. Cuando se separan, el fallo sale
como un 401 que parece un problema del token y no de la configuración.

Para pintar solo los botones que funcionan:

```js
for (const p of await db.listProviders()) {
  console.log(p.displayName); // "Google", "Microsoft"…
}
```

---

## Guardar datos: tablas

Una tabla es como una hoja de cálculo: la creas en la consola con sus columnas,
y desde la app la llenas.

```js
// Crear
const producto = await db.create('Product', { name: 'Café', quantity: 12 });

// Leer todo
const todos = await db.read('Product');

// Leer con filtro (igualdad)
const agotados = await db.read('Product', { quantity: 0 });

// Uno solo, por su id
const uno = await db.getById('Product', producto._id);

// Cambiar
await db.update('Product', producto._id, { quantity: 11 });

// Borrar
await db.delete('Product', producto._id);
```

Cada registro trae un `_id` que pone Roble. Es lo que usas para cambiarlo o
borrarlo.

### Varios de golpe

```js
const res = await db.createMany('Product', [
  { name: 'Té', quantity: 5 },
  { name: 'Pan', quantity: 0 },
]);
console.log(`Guardados: ${res.inserted.length}, rechazados: ${res.skipped.length}`);
```

### Consultas más complicadas

`read` solo filtra por igualdad. Para juntar tablas, sumar o paginar, guarda la
consulta SQL en la consola y llámala **por su nombre**:

```js
const res = await db.executeQueryByName('productosSinInventario');
for (const fila of res.rows) console.log(fila);
```

Usa el nombre, no el UUID: el nombre sobrevive si recreas la consulta.

### Una tabla que todos pueden leer

Si marcas una tabla como pública en la consola, se puede leer **sin haber
iniciado sesión**:

```js
const catalogo = await db.publicRead('Product');
```

Ojo: público es público. Cualquiera con el id del proyecto puede leerla.

---

## Guardar datos: árbol JSON

A veces no vale la pena declarar una tabla: un chat, un tablero, una partida.
Para eso está el árbol JSON. **No declaras nada**: la estructura nace cuando
escribes el primer dato.

```js
// Añadir, con clave que genera el servidor
const id = await db.json.push('mensajes', {
  texto: 'hola',
  de: 'ana@correo.com',
});

// Leer la colección entera
const todos = await db.json.read('mensajes');

// Cambiar solo una clave
await db.json.update(`mensajes/${id}`, { leido: true });

// Borrar
await db.json.remove(`mensajes/${id}`);
```

Una ruta es `coleccion/hijo/nieto`. El primer trozo es la colección.

Las claves de `push` salen ordenadas por tiempo, así que ordenarlas ordena los
mensajes — sin depender del reloj de cada navegador.

### ¿Tabla o árbol JSON?

| Usa una **tabla** cuando | Usa el **árbol JSON** cuando |
|---|---|
| Los datos tienen forma fija | La forma cambia o no importa |
| Quieres consultas SQL | Solo lees y escribes por ruta |
| Son datos del negocio | Son datos que van y vienen |

---

## Enterarse de los cambios al momento

Escuchar te avisa cuando **otro** usuario cambia algo, sin que tengas que
recargar. Cada escucha devuelve la función que la cancela.

```js
// Una tabla
const parar = db.watchTable('Product', (cambio) => {
  console.log(cambio.operation, cambio.newValue);
});

// Un solo registro
db.watchRecord('Product', id, (cambio) => { … });

// El árbol JSON
db.json.watch('mensajes', (cambio) => {
  // En un push, `newValue` trae {claveNueva: dato}
  for (const [id, dato] of Object.entries(cambio.newValue ?? {})) {
    console.log(id, dato);
  }
});

// Al desmontar el componente
parar();
```

En React:

```jsx
useEffect(() => db.watchTable('Product', recargar), []);
```

Devolver `parar` desde el `useEffect` ya cancela al desmontar.

Tres cosas que conviene saber:

- **No trae lo que ya existe**, solo lo que cambie de ahora en adelante. Para
  pintar la lista, léela primero y aplica encima lo que llegue.
- **Cancela al desmontar.** Si no, el socket sigue abierto.
- **Hace falta sesión iniciada.**

Puedes pedir solo algunos cambios, o filtrar en el servidor:

```js
db.watchTable('Product', pintar, {
  events: ['INSERT'],
  filters: [{ column: 'quantity', operator: 'eq', value: 0 }],
});
```

Filtrar aquí ahorra el viaje de todo lo que no te interesa.

---

## Cuando algo falla

Todo lanza alguna subclase de `RobleApiException`:

```js
import { RobleApiHttpException, RobleApiNetworkException } from 'roble-client';

try {
  await db.login({ email, password });
} catch (e) {
  if (e instanceof RobleApiHttpException && e.statusCode === 401) {
    mostrar('Correo o contraseña incorrectos');
  } else if (e instanceof RobleApiNetworkException) {
    mostrar('Sin conexión');
  } else {
    mostrar(e.message);
  }
}
```

| Excepción | Qué pasó |
|---|---|
| `RobleApiHttpException` | El servidor respondió con error. Mira `statusCode` |
| `RobleApiNetworkException` | No se pudo llegar al servidor |
| `RobleApiTimeoutException` | Tardó demasiado |
| `RobleApiAuthException` | Problema de sesión o de login social |
| `RobleApiFormatException` | La respuesta no tenía la forma esperada |
| `RoblePartialInsertException` | Un `createMany` estricto rechazó registros |

Los números que más vas a ver:

- **401** — no hay sesión, o las credenciales están mal.
- **403** — la tabla no es pública (en `publicRead`).
- **404** — no existe esa consulta guardada.

---

## Referencia rápida

**Sesión** · `isLoggedIn` · `restoreSession()` · `logout()`

**Cuentas** · `register()` · `registerWithVerification()` · `verifyEmail()` ·
`resendCode()` · `login()` · `currentUser()` · `forgotPassword()` ·
`resetPassword()` · `deleteAccount()`

**Login social** · `signInWithIdToken()` · `listProviders()` ·
`providerClientId()`

**Tablas** · `create()` · `createMany()` · `read()` · `getById()` · `update()` ·
`delete()` · `publicRead()` · `executeQuery()` · `executeQueryByName()`

**Árbol JSON** · `json.collections()` · `json.read()` · `json.write()` ·
`json.update()` · `json.push()` · `json.remove()` · `json.watch()`

**Tiempo real** · `watchTable()` · `watchRecord()` · `realtime.status` ·
`realtime.close()`

---

## Licencia

MIT
