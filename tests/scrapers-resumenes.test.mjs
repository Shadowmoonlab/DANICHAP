// tests/scrapers-resumenes.test.mjs — robots de resumen de cuenta (scrapers/resumen-cromosol.mjs y resumen-distrisuper.mjs), sin red
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// db.mjs exige estas variables al cargar (no se usan: no hay red en los tests). Los robots no corren al importarlos.
process.env.SUPABASE_URL ??= 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_KEY ??= 'sin-uso';
process.env.CROMOSOL_SOLO_FUNCIONES = '1';
const { leerEmpresa, resumenDeTransacciones, EMPRESAS } = await import('../scrapers/resumen-cromosol.mjs');
const { resumenDeCtacte, codigoDeSesion } = await import('../scrapers/resumen-distrisuper.mjs');

const leer = nombre => JSON.parse(fs.readFileSync(new URL(nombre, import.meta.url), 'utf8'));
const CROMOSOL = leer('./resumen-cromosol.fixture.json');
const DISTRISUPER = leer('./resumen-distrisuper.fixture.json');

test('fixtures: sin datos del cliente reales', () => {
  for (const f of [CROMOSOL, DISTRISUPER]) assert.doesNotMatch(JSON.stringify(f), /OCULTO|DANICHAP/i);
});

/* ── Cromosol ────────────────────────────────────────────────────────── */
test('cromosol: recorre las 4 empresas', () => assert.deepEqual(EMPRESAS, [1, 2, 3, 4]));

test('cromosol leerEmpresa: pide páginas hasta una con menos de las que entran', async () => {
  const pedidas = [];
  const datos = CROMOSOL.empresa1;   // 6 comprobantes, de a 4 por página → páginas 0 y 1
  const r = await leerEmpresa(async (empresa, page) => { pedidas.push([empresa, page]); return datos.slice(page * 4, page * 4 + 4); }, 1, { porPagina: 4 });
  assert.equal(r.length, 6);
  assert.deepEqual(pedidas, [[1, 0], [1, 1]]);
});

test('cromosol leerEmpresa: página exacta → pide una más (vacía) y corta', async () => {
  const pedidas = [];
  const r = await leerEmpresa(async (e, page) => { pedidas.push(page); return page === 0 ? CROMOSOL.empresa1.slice(0, 3) : []; }, 2, { porPagina: 3 });
  assert.equal(r.length, 3);
  assert.deepEqual(pedidas, [0, 1]);
});

test('cromosol leerEmpresa: si el sitio ignora "page" (repite la misma), corta con error en vez de leer para siempre', async () => {
  await assert.rejects(leerEmpresa(async () => CROMOSOL.empresa1.slice(0, 3), 1, { porPagina: 3 }), /repite/);
  await assert.rejects(leerEmpresa(async () => ({ error: 'x' }), 1), /formato inesperado/);
});

test('cromosol resumenDeTransacciones: saldo = suma de balance; detalle = lo que tiene algo pendiente', () => {
  const r = resumenDeTransacciones([[1, CROMOSOL.empresa1], [2, []], [3, CROMOSOL.empresa3], [4, []]]);
  assert.equal(r.saldo, 1000.5 + 500 - 200.25 + 700);
  assert.deepEqual(r.detalle.map(d => [d.comprobante, d.saldo, d.empresa]), [
    ['FC A 0003-00000007', 700, '3'],
    ['NC A 0001-00000019', -200.25, '1'],
    ['FC A 0001-00000105', 500, '1'],
    ['FC A 0001-00000106', 1000.5, '1'],
  ]);
  assert.deepEqual(r.detalle[3], { comprobante: 'FC A 0001-00000106', tipo: 'FC A', numero: '0001-00000106', fecha: '2026-01-20',
    vence: '2026-02-19', total: 1000.5, saldo: 1000.5, empresa: '1' });
  assert.deepEqual(r.datos, { comprobantes_leidos: 7, por_empresa: { 1: 6, 2: 0, 3: 1, 4: 0 } });
  assert.doesNotMatch(JSON.stringify(r), /client|DEVOLUCION/);   // ni el nº de cliente ni las notas internas
});

test('cromosol resumenDeTransacciones: un balance que no es número es un cambio de formato → error', () => {
  assert.throws(() => resumenDeTransacciones([[1, [{ ...CROMOSOL.empresa1[0], balance: 'x' }]]]), /balance/);
});

/* ── Distrisuper ─────────────────────────────────────────────────────── */
test('distrisuper codigoDeSesion: el código particular de /auth/me, o el usuario si no viene', () => {
  assert.equal(codigoDeSesion({ codigoparticular: ' 123 ' }, '999'), '123');
  assert.equal(codigoDeSesion(null, '999'), '999');
  assert.equal(codigoDeSesion({ codigoparticular: '' }, '999'), '999');
});

test('distrisuper resumenDeCtacte: saldo de la cabecera y comprobantes con saldo', () => {
  const r = resumenDeCtacte(DISTRISUPER);
  assert.equal(r.saldo, 1750.5);
  assert.deepEqual(r.detalle, [
    { comprobante: 'FA-000000101', tipo: 'FA', numero: '000000101', fecha: '2026-01-03', vence: null, total: 1000, pagado: 0, saldo: 1000,
      empresa: 'DIMES', condicion: 'PPAL', dias: 17 },
    { comprobante: 'FA-000000000102', tipo: 'FA', numero: '000000000102', fecha: '2026-01-10', vence: null, total: 1000.5, pagado: 250, saldo: 750.5,
      empresa: 'DIMES', condicion: 'DS', dias: 10 },
  ]);
  assert.deepEqual(r.datos, { dias: 17, estado: 'AUTORIZADO', actualizado: '2026-01-20T02:00:00.000Z', suma_detalle: 1750.5 });
  assert.doesNotMatch(JSON.stringify(r), /CLIENTE DE PRUEBA|VENDEDOR|000000"/);   // sin razón social, vendedor ni nº de cliente
});

test('distrisuper resumenDeCtacte: respuesta rara → error claro', () => {
  assert.throws(() => resumenDeCtacte({ ok: 0 }), /ctacte/);
  assert.throws(() => resumenDeCtacte({ ok: 1, data: { saldo: 'x', data: [] } }), /saldo/);
  assert.deepEqual(resumenDeCtacte({ ok: 1, data: { saldo: 0, data: [] } }).detalle, []);
});
