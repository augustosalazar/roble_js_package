---
name: use-roble-client
description: Integrar roble-client (Roble de Uninorte OpenLab) en un proyecto JavaScript o TypeScript — Node, navegador, React o React Native. Usar para añadir autenticación, base de datos, árbol JSON o tiempo real de Roble, para empezar un proyecto desde cero, o para migrar desde fetch/axios crudos o desde una versión anterior del paquete. Incluye un smoke que verifica la conexión contra el servidor real.
---

# Integrar `roble-client`

Cliente de Roble para JS/TS. Este documento es para **añadirlo a un proyecto
que no lo tiene**, o para migrar uno que ya habla con Roble a mano.

**Empieza preguntando**, porque el camino cambia mucho:

1. ¿**Desde cero** o **migrando** algo que ya existe?
2. Si migra: ¿desde `fetch`/`axios` crudos, o desde una versión anterior de
   `roble-client`?
3. ¿Qué necesita: solo cuentas, datos, tiempo real, o todo?
4. ¿Dónde corre: navegador, Node, React Native?

La respuesta a la 4 decide el almacenamiento de sesión, que es donde más
gente se atasca (ver Gotchas).

## Instalar

```bash
npm install roble-client
```

Verificado con `roble-client@3.4.0` y Node v25.1.0.

## Verificar que funciona: el smoke

**Hazlo antes de escribir nada de la app.** Prueba conexión, cuentas, árbol
JSON y tiempo real de una pasada, contra el servidor real, y **limpia lo que
crea**: registra una cuenta desechable y la borra al terminar.

`smoke.mjs` está **junto a este SKILL.md**. Cópialo a la raíz del proyecto que
estás integrando y córrelo desde ahí:

```bash
cp "$SKILL_DIR/smoke.mjs" ./smoke.mjs
ROBLE_CONTRACT_ID=tu_contrato node smoke.mjs
```

**Ojo:** esta skill **no viaja dentro del paquete de npm**. Vive en el repo
`github.com/augustosalazar/roble_js_package`, en
`.claude/skills/use-roble-client/`. Si la necesitas en otro proyecto, cópiala
de ahí.

Salida real de una corrida buena:

```
sin sesión
  ok   proveedores: google
cuenta desechable
  ok   registrada smoke-1787847569756@ejemplo.test
  ok   login -> userId=514a751d-7288-4715-97db-baf275b80af0 role=user
árbol JSON
  ok   push -> mtbqa7c4_CHoZ31t38nVuIr1AjqY7
  ok   read -> {"mtbqa7c4_CHoZ31t38nVuIr1AjqY7":{"texto":"hola"}}
  ok   tiempo real: llegó el cambio
  ok   colección borrada
  ok   cuenta desechable eliminada
```

`ROBLE_BASE_URL` cambia el host; por omisión apunta al de pruebas de OpenLab.

Si el smoke pasa, el problema que venga después está en el código de la app,
no en la conexión. Eso ahorra la mitad de la depuración.

## Empezar desde cero

Un cliente, **creado una sola vez** y exportado:

```js
import { RobleApiClient } from 'roble-client';

export const db = new RobleApiClient({
  baseUrl: 'https://roble-api.test-openlab.uninorte.edu.co',
  contractId: 'miproyecto_ab12cd34',
});
```

Crearlo en cada componente da a cada copia su propia sesión.

Lo demás —cuentas, tablas, árbol JSON, tiempo real, qué devuelve cada
método— está en el README del paquete. No lo repitas aquí.

## Migrar desde `fetch`/`axios` crudos

Sustitución directa, en este orden:

| Lo que había | Pasa a ser |
|---|---|
| `POST /auth/{c}/login` + guardar tokens a mano | `db.login({email, password})` |
| Refresco del token en un interceptor | nada: el paquete lo hace solo |
| `GET /auth/{c}/me` | `db.currentUser()` |
| `GET /database/{c}/read?tableName=X` | `db.read('X')` |
| `POST /database/{c}/insert-one` | `db.create('X', {...})` |

**Borra el interceptor de refresco.** El paquete reintenta una vez ante un
401 por su cuenta; dos capas haciéndolo compiten y producen refrescos
duplicados.

**Deja de guardar los tokens tú.** El paquete los persiste y los recupera con
`restoreSession()`. Que dos sitios escriban la sesión es una fuente de fallos
que solo aparecen al recargar.

## Migrar desde una versión anterior del paquete

- **3.0.0 quitó el acceso a la sesión**: `accessToken`, `refreshToken`,
  `setTokens()`, `clearTokens()` y `onTokenUpdate` ya no existen. Queda
  `isLoggedIn` para consultar y `restoreSession()` para recuperar. Si el
  código llama a `setTokens()`, no compila.
- **3.1.0 quitó el tiempo real y 3.3.0 lo devolvió**, con otra forma:
  `db.watchTable(tabla, cb)` devuelve la función que cancela. Si venías de
  3.0.0, la API vieja (`db.realtime.ref(...)`) ya no está.
- **3.2.0 trajo `db.json`** (árbol JSON) y `executeQueryByName`.
- **3.4.0 trajo `role` en el perfil.** Necesita `auth-service` v1.7.8 o más;
  contra uno anterior llega `null`.

Después de subir de versión, corre el smoke antes de tocar la app.

## Gotchas

- **En Node la sesión no persiste, y nadie te avisa.** Node 25 define un
  `localStorage` global, así que el paquete lo da por bueno — pero sin
  `--localstorage-file` no guarda nada. `restoreSession()` devuelve `false`
  para siempre, sin lanzar. El único indicio es un aviso de Node que parece
  de otra cosa:

  ```
  Warning: `--localstorage-file` was provided without a valid path
  ```

  **Pasa `storage` explícitamente** fuera del navegador:

  ```js
  const memoria = new Map();
  new RobleApiClient({
    baseUrl, contractId,
    storage: {
      getItem: (k) => memoria.get(k) ?? null,
      setItem: (k, v) => memoria.set(k, v),
      removeItem: (k) => memoria.delete(k),
    },
  });
  ```

  En React Native, `@react-native-async-storage/async-storage` sirve tal cual.

- **El tiempo real necesita ~1,5 s para abrir el socket.** Si escribes
  inmediatamente después de `watch()`, el evento se pierde: la suscripción
  aún no existía. El smoke espera a propósito antes de hacer `push`.

- **Escuchar exige sesión iniciada.** `watch()` sin sesión lanza al conectar,
  no al registrarse.

- **`register()` puede crear la cuenta sin verificar el correo.** Depende de
  la configuración del proyecto; en el de pruebas entra directa. No asumas
  que hace falta el código.

- **`role` es `null` si nadie asignó rol.** No es un error, y no significa
  que el backend esté viejo.

- **`id` y `userId` no son lo mismo** en el perfil. `userId` es el del
  usuario, el que referencian tus tablas; `id` es el de la fila del perfil.

## Troubleshooting

| Síntoma | Causa | Arreglo |
|---|---|---|
| `restoreSession()` siempre `false` en Node | el `localStorage` de Node no guarda | pasa `storage` explícito |
| El smoke falla en «proveedores» | `contractId` o `baseUrl` mal | cópialos de la consola de Roble |
| `AVISO tiempo real: no llegó ningún cambio` | el socket no llegó a suscribirse | sube la espera antes del `push` |
| 401 en todo tras un rato | sesión caducada | `restoreSession()`; si da `false`, vuelve a pedir login |
| 403 en `publicRead` | la tabla no está marcada como pública | márcala en la consola |
| 404 en `executeQueryByName` | no existe esa consulta guardada | créala en la consola, por nombre |
