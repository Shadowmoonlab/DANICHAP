// dev/prueba-cuentas.mjs — Cuenta corriente de proveedores: que la plata cierre, contra la base LOCAL (npm run dev en otra terminal).
// Cada caso corre como el administrador dentro de una transacción que se deshace al final: no deja nada en la base.
// Uso: npm run test:cuentas
import { createRequire } from 'node:module';
import { PORTS, PG_SUPERUSER, DEV_USERS } from './config.mjs';

const { Client } = createRequire(import.meta.url)('pg');
const db = new Client({ host: '127.0.0.1', port: PORTS.postgres, user: PG_SUPERUSER.user, password: PG_SUPERUSER.password, database: 'postgres' });
try { await db.connect(); } catch { console.error('Primero corré "npm run dev" en otra terminal.'); process.exit(1); }

const PROV = 'tytsa';   // proveedor del seed; cada caso arranca con su cuenta vacía (dentro de la transacción)
let fallas = 0;
const revisar = (ok, texto) => { console.log(`${ok ? '✅' : '❌'} ${texto}`); if (!ok) fallas++; };
const uno = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const num = v => Number(v ?? 0);

/** Corre fn como admin en una transacción que siempre se deshace. Un error inesperado cuenta como falla. */
async function caso(nombre, fn) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: DEV_USERS.admin.id, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    await db.query(`delete from public.pagos_proveedor where proveedor = $1`, [PROV]);
    await db.query(`delete from public.notas_proveedor where proveedor = $1`, [PROV]);
    await db.query(`delete from public.recepciones where proveedor = $1`, [PROV]);
    await fn();
  } catch (e) {
    revisar(false, `${nombre}: error inesperado — ${e.message}`);
  } finally {
    await db.query('rollback');
  }
}
const compra = async (fecha, total, prov = PROV) => (await uno(`select public.confirmar_recepcion($1::jsonb) as id`, [JSON.stringify({
  proveedor: prov, nro_comprobante: `T${Math.random().toString().slice(2, 8)}`, fecha, total, origen: 'manual',
  items: [{ descripcion: 'Prueba cuenta', cantidad: 1, costo_unit: total, accion: 'solo' }] })])).id;
const pago = async p => (await uno(`select public.registrar_pago_proveedor($1::jsonb) as id`, [JSON.stringify({ proveedor: PROV, medio: 'efectivo', ...p })])).id;
const cuenta = async (hoy = '2026-11-13') => uno(`select * from public.cc_proveedores($1::date) where proveedor = $2`, [hoy, PROV]);
const saldoRec = async id => num((await uno(`select public.saldo_recepcion($1) as s`, [id])).s);
const libro = async (d, h) => (await db.query(`select * from public.libro_resumen($1::date, $2::date, 'month')`, [d, h])).rows
  .reduce((t, r) => ({ caja: t.caja + num(r.compras_caja), pagos: t.pagos + num(r.pagos_proveedores) }), { caja: 0, pagos: 0 });

// 1. Redondeo: el panel suma en JavaScript (3 × 1,10 = 3,3000000000000003) y la base guarda centavos
await caso('Pagado al contado con total de JavaScript', async () => {
  const total = 3 * 1.1;   // 3.3000000000000003: así llega el total de una carga a mano de 3 unidades a $ 1,10
  const rid = await compra('2026-11-13', total);
  let ok = true, msg = '';
  try { await pago({ fecha: '2026-11-13', monto: total, aplicaciones: [{ recepcion_id: rid, monto: total }] }); }
  catch (e) { ok = false; msg = e.message; }
  revisar(ok && await saldoRec(rid) === 0, `pago al contado de ${total} aplicado a una compra de $ 3,30 → ${ok ? `queda debiendo ${await saldoRec(rid)}` : msg}`);
});

// 2. Más viejo primero, pago parcial, a cuenta y antigüedad
await caso('Aplicación, parcial, a cuenta y tramos', async () => {
  await db.query(`update public.proveedores set plazo_dias = 30 where slug = $1`, [PROV]);
  const vieja = await compra('2026-08-01', 1000);   // vence 31/08 → +60 días al 13/11
  const media = await compra('2026-10-01', 500);    // vence 31/10 → 1-30
  const nueva = await compra('2026-11-10', 300);    // vence 10/12 → al día
  await pago({ fecha: '2026-11-13', monto: 400, aplicaciones: [{ recepcion_id: vieja, monto: 400 }] });
  await pago({ fecha: '2026-11-13', monto: 700 });  // a cuenta: cancela lo más viejo (lo que queda de la vieja y 100 de la media)
  const c = await cuenta();
  revisar(num(c.saldo) === 700 && num(c.a_cuenta) === 700, `saldo 1800 − 1100 = 700 (dio ${c.saldo}), a cuenta 700 (dio ${c.a_cuenta})`);
  revisar(num(c.vencido_mas) === 0 && num(c.vencido_30) === 400 && num(c.al_dia) === 300,
    `tramos: +60 = 0 (${c.vencido_mas}), 1-30 = 400 (${c.vencido_30}), al día = 300 (${c.al_dia}), más viejo impago ${c.impago_desde?.toISOString?.().slice(0, 10)}`);
  revisar(num(c.al_dia) + num(c.vencido_30) + num(c.vencido_60) + num(c.vencido_mas) === num(c.saldo), 'la suma de los tramos es el saldo');
  const ultimo = await uno(`select saldo from public.cc_movimientos($1) limit 1`, [PROV]);
  revisar(num(ultimo.saldo) === num(c.saldo), `el saldo del último movimiento (${ultimo.saldo}) es el de la lista (${c.saldo})`);
  let msg = '';
  try { await pago({ fecha: '2026-11-13', monto: 1000, aplicaciones: [{ recepcion_id: media, monto: 600 }] }); } catch (e) { msg = e.message; }
  revisar(/le faltan pagar/.test(msg), `aplicar más de lo que falta de un remito se rechaza → "${msg}"`);
  void nueva;
});

// 3. Notas y anulaciones
await caso('Notas de crédito/débito y anular', async () => {
  const rid = await compra('2026-11-01', 1000);
  const nc = (await uno(`select public.registrar_nota_proveedor($1::jsonb) as id`, [JSON.stringify({ proveedor: PROV, tipo: 'credito', monto: 1200, recepcion_id: rid })])).id;
  let c = await cuenta();
  revisar(num(c.saldo) === -200 && num(c.al_dia) === 0, `nota de crédito más grande que el remito → a favor 200 (saldo ${c.saldo})`);
  await uno(`select public.anular_nota_proveedor($1)`, [nc]);
  const p = await pago({ fecha: '2026-11-13', monto: 1000, aplicaciones: [{ recepcion_id: rid, monto: 1000 }] });
  await uno(`select public.anular_pago_proveedor($1)`, [p]);
  c = await cuenta();
  revisar(num(c.saldo) === 1000 && await saldoRec(rid) === 1000, `anular la nota y el pago → vuelve a deber 1000 (saldo ${c.saldo})`);
  let msg = '';
  try { await uno(`select public.anular_pago_proveedor($1)`, [p]); } catch (e) { msg = e.message; }
  revisar(/ya estaba anulado/.test(msg), 'anular dos veces el mismo pago se rechaza');
});

// 4. Anular o corregir un remito con pagos aplicados: la plata no se pierde
await caso('Anular y corregir remito con pagos', async () => {
  const rid = await compra('2026-11-01', 1000);
  await pago({ fecha: '2026-11-13', monto: 600, aplicaciones: [{ recepcion_id: rid, monto: 600 }] });
  const nuevo = (await uno(`select public.corregir_recepcion($1, $2::jsonb) as id`, [rid, JSON.stringify({ proveedor: PROV, nro_comprobante: 'C1',
    fecha: '2026-11-01', total: 400, origen: 'manual', items: [{ descripcion: 'x', cantidad: 1, costo_unit: 400, accion: 'solo' }] })])).id;
  let c = await cuenta();
  revisar(await saldoRec(nuevo) === 0 && num(c.saldo) === -200 && num(c.a_cuenta) === 200,
    `corregir 1000 → 400 con 600 pagados: remito saldado, 200 a cuenta/a favor (saldo ${c.saldo}, a cuenta ${c.a_cuenta})`);
  await uno(`select public.anular_recepcion($1)`, [nuevo]);
  c = await cuenta();
  revisar(num(c.saldo) === -600 && num(c.a_cuenta) === 600, `anular el remito → los 600 pagados quedan a cuenta (saldo ${c.saldo})`);
});

// 5. Libro diario: cada peso que sale de la caja cuenta una sola vez, antes y después del corte (14/11/2026)
await caso('Libro diario sin contar dos veces', async () => {
  const antes = await libro('2026-11-01', '2026-11-30');   // lo que ya hay en la base de prueba (otros proveedores)
  const movsAntes = (await db.query(`select * from public.libro_movimientos('2026-11-01', '2026-11-30')`)).rows;
  const vieja = await compra('2026-11-10', 1000);   // antes del corte: salió de la caja el 10/11
  await pago({ fecha: '2026-11-20', monto: 1000, aplicaciones: [{ recepcion_id: vieja, monto: 1000 }] });
  const nueva = await compra('2026-11-15', 500);    // después del corte: sale al pagarla
  await pago({ fecha: '2026-11-16', monto: 500, aplicaciones: [{ recepcion_id: nueva, monto: 500 }] });
  const d = await libro('2026-11-01', '2026-11-30');
  const l = { caja: d.caja - antes.caja, pagos: d.pagos - antes.pagos };
  revisar(l.caja + l.pagos === 1500, `noviembre: compras que salen ${l.caja} + pagos ${l.pagos} = ${l.caja + l.pagos} (lo pagado de verdad: 1500)`);
  const movs = (await db.query(`select * from public.libro_movimientos('2026-11-01', '2026-11-30')`)).rows;
  const egresos = rows => rows.filter(m => ['compra', 'pago_proveedor'].includes(m.tipo)).reduce((s, m) => s + num(m.egreso), 0);
  const egreso = egresos(movs) - egresos(movsAntes);
  revisar(egreso === 1500, `detalle del Libro: egresos de compras y pagos = ${egreso} (esperado 1500)`);
});

// 6. Dos cosas a la vez sobre el mismo remito (dos pestañas): un pago y una corrección. Acá sí se confirma (commit),
// con dos conexiones, y al final se borra lo creado.
{
  const otra = new Client(db.connectionParameters);
  await otra.connect();
  const comoAdmin = async c => {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: DEV_USERS.admin.id, role: 'authenticated' })]);
    await c.query('set local role authenticated');
  };
  const marca = `CONC${Date.now()}`;
  let rid = null, nuevo = null;
  try {
    await db.query('begin'); await comoAdmin(db);
    rid = (await uno(`select public.confirmar_recepcion($1::jsonb) as id`, [JSON.stringify({ proveedor: PROV, nro_comprobante: marca, fecha: '2026-11-13',
      total: 1000, origen: 'manual', items: [{ descripcion: 'Prueba cuenta', cantidad: 1, costo_unit: 1000, accion: 'solo' }] })])).id;
    await db.query('commit');
    // Pestaña 1: paga 600 del remito (todavía sin confirmar)
    await db.query('begin'); await comoAdmin(db);
    await pago({ fecha: '2026-11-13', monto: 600, nota: marca, aplicaciones: [{ recepcion_id: rid, monto: 600 }] });
    // Pestaña 2: corrige el mismo remito (espera a que la 1 termine)
    await otra.query('begin'); await comoAdmin(otra);
    const corrigiendo = otra.query(`select public.corregir_recepcion($1, $2::jsonb) as id`, [rid, JSON.stringify({ proveedor: PROV, nro_comprobante: marca,
      fecha: '2026-11-13', total: 1000, origen: 'manual', items: [{ descripcion: 'Prueba cuenta', cantidad: 1, costo_unit: 1000, accion: 'solo' }] })]);
    await new Promise(r => setTimeout(r, 300));
    await db.query('commit');
    nuevo = (await corrigiendo).rows[0].id;
    await otra.query('commit');
    await db.query('begin'); await comoAdmin(db);
    const s = await saldoRec(nuevo);
    await db.query('rollback');
    revisar(s === 400, `pago y corrección del mismo remito a la vez: el pago sigue aplicado a la corregida (falta pagar ${s}, esperado 400)`);
  } catch (e) {
    revisar(false, `pago y corrección a la vez: error inesperado — ${e.message}`);
    await db.query('rollback').catch(() => {}); await otra.query('rollback').catch(() => {});
  } finally {
    await db.query(`delete from public.pagos_proveedor where proveedor = $1 and nota = $2`, [PROV, marca]);
    await db.query(`delete from public.recepciones where proveedor = $1 and nro_comprobante = $2`, [PROV, marca]);
    await otra.end();
  }
}

await db.end();
console.log(fallas ?`\n❌ ${fallas} prueba(s) fallaron` : '\n✅ Las cuentas cierran');
process.exit(fallas ? 1 : 0);
