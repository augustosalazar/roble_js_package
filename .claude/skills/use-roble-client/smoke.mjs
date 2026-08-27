import { RobleApiClient } from 'roble-client';

const BASE = process.env.ROBLE_BASE_URL ?? 'https://roble-api.test-openlab.uninorte.edu.co';
const CONTRACT = process.env.ROBLE_CONTRACT_ID;
if (!CONTRACT) { console.error('Falta ROBLE_CONTRACT_ID'); process.exit(1); }

const memoria = new Map();
const db = new RobleApiClient({
  baseUrl: BASE, contractId: CONTRACT,
  storage: { getItem: (k) => memoria.get(k) ?? null,
             setItem: (k, v) => memoria.set(k, v),
             removeItem: (k) => memoria.delete(k) },
});

const ok = (m) => console.log('  ok  ', m);
let creado = false;

try {
  console.log('sin sesión');
  ok(`proveedores: ${(await db.listProviders()).map((p) => p.name).join(', ') || '(ninguno)'}`);

  const correo = `smoke-${Date.now()}@ejemplo.test`;
  console.log('cuenta desechable');
  await db.register({ email: correo, password: 'SmokeClave!1', name: 'Smoke' });
  creado = true;
  ok(`registrada ${correo}`);

  const user = await db.login({ email: correo, password: 'SmokeClave!1' });
  ok(`login -> userId=${user.userId} role=${user.role ?? 'null'}`);

  console.log('árbol JSON');
  const col = `_smoke_${Date.now()}`;
  const recibidos = [];
  const parar = db.json.watch(col, (c) => recibidos.push(c));
  await new Promise((r) => setTimeout(r, 1500));      // deja abrir el socket

  const id = await db.json.push(col, { texto: 'hola' });
  ok(`push -> ${id}`);
  ok(`read -> ${JSON.stringify(await db.json.read(col))}`);

  await new Promise((r) => setTimeout(r, 2500));      // deja llegar el evento
  console.log(recibidos.length ? '  ok   tiempo real: llegó el cambio'
                               : '  AVISO tiempo real: no llegó ningún cambio');
  parar();

  await db.json.remove(col);
  ok('colección borrada');
} catch (e) {
  console.error('FALLÓ:', e.constructor?.name, e.statusCode ?? '', e.message);
  process.exitCode = 1;
} finally {
  if (creado) {
    try { await db.deleteAccount(); console.log('  ok   cuenta desechable eliminada'); }
    catch (e) { console.error('  AVISO no se pudo borrar la cuenta:', e.message); }
  }
  db.realtime.close();
}
