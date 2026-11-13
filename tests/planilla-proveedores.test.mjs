// tests/planilla-proveedores.test.mjs — importación de la planilla de proveedores (dev/planilla-proveedores.mjs)
// Todo con datos inventados: nombres genéricos y montos de ejemplo (la planilla real no se sube al repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarNombre, proponerSlug, slugNuevo, armarEquivalencias, extraerProveedores,
  parsearFecha, parsearMonto, parsearRemito, filasDesdeMatriz, procesarFilas, generarSql,
  aCsv, leerCsv, informe,
} from '../dev/planilla-proveedores.mjs';

const PROVEEDORES = [
  { slug: 'goicoechea', nombre: 'Goicoechea Hnos.' },
  { slug: 'prautopartes', nombre: 'PR Autopartes' },
  { slug: 'plautopartes', nombre: 'PL Autopartes' },
  { slug: 'delviso', nombre: 'Metalúrgica del Viso' },
  { slug: 'cavila', nombre: 'Cavila (Lagostena)' },
  { slug: 'liquimoly', nombre: 'Liqui Moly (DAZ)' },
  { slug: 'distriferr', nombre: 'Distriferr Hnos.' },
  { slug: 'gomeztorralba', nombre: 'Gómez Torralba' },
  { slug: 'opticaslam', nombre: 'Ópticas LAM' },
  { slug: 'dm', nombre: 'DM' },
  { slug: 'otero', nombre: 'Autopartes Otero' },
];
const OPC = { desde: '2024-01-01', hasta: '2026-11-13' };

/* ── Nombres y equivalencias ─────────────────────────────────────────── */
test('normalizarNombre: mayúsculas, sin tildes ni espacios de más', () => {
  assert.equal(normalizarNombre('  leo  cávila '), 'LEO CAVILA');
  assert.equal(normalizarNombre('Gómez\tTorralva'), 'GOMEZ TORRALVA');
  assert.equal(normalizarNombre(null), '');
});

test('proponerSlug: casos del plan (GOICOCHEA HNOS → goicoechea, PR REPUESTO → prautopartes)', () => {
  assert.equal(proponerSlug('GOICOCHEA HNOS', PROVEEDORES).slug, 'goicoechea');
  assert.equal(proponerSlug('Goicochea hnos', PROVEEDORES).slug, 'goicoechea');
  assert.equal(proponerSlug('PR REPUESTO', PROVEEDORES).slug, 'prautopartes');
});

test('proponerSlug: nombres escritos de otra forma', () => {
  const casos = { 'DEL VISO': 'delviso', DELVISO: 'delviso', CAVILA: 'cavila', 'DIAZ LIQUI MOLY': 'liquimoly', DISTRIFER: 'distriferr',
    'GOMEZ TORRALVA': 'gomeztorralba', LAM: 'opticaslam', 'LAM RTO': 'opticaslam', 'DM RTO': 'dm', OTERO: 'otero' };
  for (const [nombre, slug] of Object.entries(casos)) assert.equal(proponerSlug(nombre, PROVEEDORES).slug, slug, nombre);
  assert.equal(proponerSlug('DM', PROVEEDORES).confianza, 'alta');
});

test('proponerSlug: parecido pero dudoso queda "media"; sin parecido, nuevo', () => {
  const leo = proponerSlug('LEO CAVILA', PROVEEDORES);
  assert.equal(leo.slug, 'cavila');
  assert.equal(leo.confianza, 'media');
  const nuevo = proponerSlug('ACME REPUESTOS', PROVEEDORES);
  assert.equal(nuevo.slug, null);
  assert.equal(nuevo.confianza, 'nueva');
  // PL y PR no se confunden
  assert.equal(proponerSlug('PL', PROVEEDORES).slug, 'plautopartes');
});

test('slugNuevo: solo letras y números en minúscula', () => {
  assert.equal(slugNuevo('BETA CHICO'), 'betachico');
  assert.equal(slugNuevo('Ñandú S.R.L.'), 'nandu');
  assert.match(slugNuevo('???'), /^[a-z0-9_]+$/);
});

test('armarEquivalencias: agrupa nombres nuevos parecidos y respeta lo que corrigió Daniel', () => {
  const nombres = [{ nombre: 'ACME', renglones: 10 }, { nombre: 'ACMES', renglones: 2 }, { nombre: 'GOICOCHEA HNOS', renglones: 3 },
    { nombre: 'ZETA', renglones: 4 }];
  const previas = new Map([['ZETA', { slug_final: 'dm' }]]);
  const eq = armarEquivalencias(nombres, PROVEEDORES, previas);
  const por = Object.fromEntries(eq.map(e => [e.nombre_planilla, e]));
  assert.equal(por.ACME.slug_propuesto, 'acme');
  assert.equal(por.ACMES.slug_propuesto, 'acme');
  assert.equal(por.ACME.confianza, 'nueva');
  assert.equal(por['GOICOCHEA HNOS'].slug_propuesto, 'goicoechea');
  assert.equal(por.ZETA.slug_final, 'dm');
  assert.equal(eq[0].nombre_planilla, 'ACME');   // el de más renglones primero
});

test('extraerProveedores: lee slug y nombre de los insert de docs/*.sql', () => {
  const sql = `insert into public.proveedores (slug, nombre, orden) values
  ('uno',  'Uno SA', 10),
  ('dos', 'Dos (Tres)', 20)
on conflict (slug) do nothing;
insert into public.proveedores (slug, nombre, whatsapp, web, activo, orden)
values ('cuatro', 'Cuatro', '11', 'https://x', true, 1) on conflict (slug) do update set nombre = excluded.nombre;`;
  assert.deepEqual(extraerProveedores(sql), [{ slug: 'uno', nombre: 'Uno SA' }, { slug: 'dos', nombre: 'Dos (Tres)' }, { slug: 'cuatro', nombre: 'Cuatro' }]);
});

/* ── Fechas ──────────────────────────────────────────────────────────── */
test('parsearFecha: número de serie de Excel', () => {
  assert.deepEqual(parsearFecha(45901, OPC), { fecha: '2025-09-01', estado: 'ok' });
  assert.equal(parsearFecha(45901.75, OPC).fecha, '2025-09-01');   // con hora
});

test('parsearFecha: texto dd/mm/aa y dd/mm/aaaa', () => {
  assert.deepEqual(parsearFecha('1/09/2025', OPC), { fecha: '2025-09-01', estado: 'ok' });
  assert.deepEqual(parsearFecha('05/10/25', OPC), { fecha: '2025-10-05', estado: 'ok' });
});

test('parsearFecha: errores típicos que se corrigen solos (quedan anotados)', () => {
  for (const [txt, iso] of [['08/08//25', '2025-08-08'], ['03//09/25', '2025-09-03'], ['1/09/0925', '2025-09-01'], ['0511/25', '2025-11-05']]) {
    const r = parsearFecha(txt, OPC);
    assert.equal(r.fecha, iso, txt);
    assert.equal(r.estado, 'corregida', txt);
    assert.ok(r.motivo, txt);
  }
});

test('parsearFecha: lo dudoso o fuera de rango se marca para revisar (nunca se inventa la fecha)', () => {
  for (const v of ['25/09/0112', '25/09/0128', null, '', 'ayer', 123721.51, 37515, '31/02/25', '10/12/26']) {
    const r = parsearFecha(v, OPC);
    assert.equal(r.estado, 'revisar', String(v));
    assert.equal(r.fecha, null, String(v));
  }
});

/* ── Montos ──────────────────────────────────────────────────────────── */
test('parsearMonto: números, vacíos y textos con formato roto', () => {
  assert.deepEqual(parsearMonto(1500.5), { monto: 1500.5, estado: 'ok' });
  assert.deepEqual(parsearMonto(null), { monto: null, estado: 'vacio' });
  assert.deepEqual(parsearMonto(0), { monto: null, estado: 'vacio' });
  assert.deepEqual(parsearMonto('  '), { monto: null, estado: 'vacio' });
  assert.equal(parsearMonto(-200).monto, -200);
  assert.deepEqual(parsearMonto('1234.56'), { monto: 1234.56, estado: 'corregido', motivo: 'monto escrito como texto' });
  for (const [txt, n] of [['123,456,78', 123456.78], [' $123,456,78', 123456.78], ['12345,,67', 12345.67]]) {
    const r = parsearMonto(txt);
    assert.equal(r.monto, n, txt);
    assert.equal(r.estado, 'corregido', txt);
  }
});

test('parsearMonto: ambiguo o con palabras → revisar', () => {
  for (const txt of ['$123.456', 'debe $10,000', 'a/c $1,000 faro', 'texto suelto', 'FACTURA!!']) {
    const r = parsearMonto(txt);
    assert.equal(r.estado, 'revisar', txt);
    assert.equal(r.monto, null, txt);
  }
});

/* ── Remitos ─────────────────────────────────────────────────────────── */
test('parsearRemito: formatos reales ("RTO 132863", "N10455", número solo, N/C)', () => {
  assert.deepEqual(parsearRemito('RTO 132863'), { texto: 'RTO 132863', tipo: 'RTO', numero: '132863', notaCredito: false });
  assert.deepEqual(parsearRemito('N10455'), { texto: 'N 10455', tipo: 'N', numero: '10455', notaCredito: false });
  assert.deepEqual(parsearRemito(224947), { texto: '224947', tipo: null, numero: '224947', notaCredito: false });
  assert.equal(parsearRemito('N/C 21894').notaCredito, true);
  assert.equal(parsearRemito('NOTA CRED').notaCredito, true);
  assert.equal(parsearRemito('NC2991').notaCredito, true);
  assert.deepEqual(parsearRemito('RTO '), { texto: 'RTO', tipo: 'RTO', numero: null, notaCredito: false });
  assert.deepEqual(parsearRemito(null), { texto: '', tipo: null, numero: null, notaCredito: false });
  assert.equal(parsearRemito('insignia (x)').texto, 'insignia (x)');
});

/* ── Renglones ───────────────────────────────────────────────────────── */
const MATRIZ = [
  [null, null, null],
  ['FECHA', 'PROVEDOR', 'REMITO ', 'IMPORTE', 'PAGOS', 'PAGOS TOTALES'],
  [45900, 'ACME', 'RTO 100', 1000, 1000],          // fila 3: compra pagada en el mismo renglón
  [45901, 'acme ', 'RTO 101', 500, null],          // fila 4: compra sin pagar
  ['08/08//25', 'ACME', 'N/C 7', null, 200],       // fila 5: nota de crédito con fecha corregida
  ['25/09/0112', 'ACME', 'RTO 102', 300, null],    // fila 6: fecha dudosa → revisar
  [45902, 'ACME', 'RTO 103', 'debe $50', null],    // fila 7: monto con palabras → revisar
  [45903, 'BETA', 104, -100, -100],                // fila 8: negativos (se anulan entre sí)
  [null, null, null, null, null],                  // vacío: se ignora
  [45904, 'ZETA', 'RTO 1', 999, null],             // fila 10: proveedor marcado "ignorar"
  [45905, 'BETA', 'RTO 2', null, null],            // fila 11: sin montos → se ignora
];

test('filasDesdeMatriz: encuentra el encabezado y numera como Excel', () => {
  const filas = filasDesdeMatriz(MATRIZ);
  assert.equal(filas.length, 8);
  assert.deepEqual(filas[0], { fila: 3, fecha: 45900, proveedor: 'ACME', remito: 'RTO 100', importe: 1000, pagos: 1000 });
  assert.equal(filas.at(-1).fila, 11);
  assert.throws(() => filasDesdeMatriz([['a', 'b']]), /encabezado/);
});

test('procesarFilas: compras, pagos, notas, negativos y renglones a revisar', () => {
  const equivalencias = new Map([['ACME', 'acme'], ['BETA', 'beta'], ['ZETA', 'ignorar']]);
  const r = procesarFilas(filasDesdeMatriz(MATRIZ), { equivalencias, ...OPC });
  const de = fila => r.movimientos.filter(m => m.fila === fila).map(m => [m.tipo, m.monto, m.motivo]);
  assert.deepEqual(de(3), [['debito', 1000, 'Planilla · Compra · RTO 100'], ['credito', 1000, 'Planilla · Pago · RTO 100']]);
  assert.deepEqual(de(4), [['debito', 500, 'Planilla · Compra · RTO 101']]);
  assert.deepEqual(de(5), [['credito', 200, 'Planilla · Nota de crédito · N/C 7']]);
  assert.equal(r.movimientos.find(m => m.fila === 5).fecha, '2025-08-08');
  assert.deepEqual(de(8), [['credito', 100, 'Planilla · Compra en negativo · 104'], ['debito', 100, 'Planilla · Pago en negativo · 104']]);
  assert.deepEqual(de(6), []);
  assert.deepEqual(de(7), []);
  assert.deepEqual(de(10), []);
  assert.deepEqual(r.revisar.map(x => [x.fila, x.estado]), [[5, 'corregida'], [6, 'revisar'], [7, 'revisar']]);
  // saldo de la planilla (como la suma de Excel: ignora celdas con texto) vs lo importado
  const acme = r.porProveedor.get('acme');
  assert.equal(acme.saldoPlanilla, 1000 + 500 + 300 - 1000 - 200);
  assert.equal(acme.saldoImportado, 1000 + 500 - 1000 - 200);
  assert.equal(acme.renglonesRevisar, 2);
  assert.equal(r.porProveedor.get('beta').saldoImportado, 0);
  assert.equal(r.ignorados, 1);
  assert.equal(r.leidos, 8);
});

test('procesarFilas: una corrección a mano en revisar.csv habilita el renglón (si sigue siendo el mismo)', () => {
  const equivalencias = new Map([['ACME', 'acme'], ['BETA', 'beta'], ['ZETA', 'ignorar']]);
  const correcciones = new Map([
    [6, { proveedor: 'ACME', remito: 'RTO 102', fecha_ok: '25/09/2025', importe_ok: '', pagos_ok: '', no_importar: '' }],
    [7, { proveedor: 'OTRO', remito: 'RTO 103', fecha_ok: '', importe_ok: '50', pagos_ok: '', no_importar: '' }],   // ya no coincide
  ]);
  const r = procesarFilas(filasDesdeMatriz(MATRIZ), { equivalencias, correcciones, ...OPC });
  const f6 = r.movimientos.filter(m => m.fila === 6);
  assert.deepEqual(f6.map(m => [m.fecha, m.tipo, m.monto]), [['2025-09-25', 'debito', 300]]);
  assert.equal(r.revisar.find(x => x.fila === 6).estado, 'corregida a mano');
  assert.equal(r.movimientos.filter(m => m.fila === 7).length, 0);
  // "no importar" saca el renglón sin marcarlo para revisar
  const sin = procesarFilas(filasDesdeMatriz(MATRIZ), { equivalencias, ...OPC,
    correcciones: new Map([[7, { proveedor: 'ACME', remito: 'RTO 103', no_importar: 'si' }]]) });
  assert.equal(sin.revisar.find(x => x.fila === 7).estado, 'no se importa');
});

test('procesarFilas: proveedor sin equivalencia corta con un error claro', () => {
  assert.throws(() => procesarFilas(filasDesdeMatriz(MATRIZ), { equivalencias: new Map(), ...OPC }), /equivalencia/);
});

/* ── SQL, CSV e informe ──────────────────────────────────────────────── */
test('generarSql: idempotente (borra lo de la planilla y vuelve a cargar), escapa comillas, crea proveedores nuevos', () => {
  const sql = generarSql({
    movimientos: [{ fila: 3, proveedor: 'acme', fecha: '2025-09-01', tipo: 'debito', monto: 1000, motivo: "Planilla · Compra · RTO 'x'" }],
    proveedoresNuevos: [{ slug: 'acme', nombre: "Acme D'Uno" }],
  });
  assert.match(sql, /^begin;/m);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /delete from public\.notas_proveedor where origen = 'planilla';/);
  assert.match(sql, /insert into public\.proveedores \(slug, nombre, orden\) values\s+\('acme', 'Acme D''Uno', 500\)\s+on conflict \(slug\) do nothing;/);
  assert.match(sql, /\('acme', '2025-09-01', 'debito', 1000\.00, 'Planilla · Compra · RTO ''x''', 'planilla', 3\)/);
  assert.match(sql, /gestion-v19\.sql/);   // avisa si falta correr la v19
  assert.ok(sql.indexOf('delete from') < sql.indexOf('insert into public.notas_proveedor'));
});

test('generarSql: lotes de a 500 renglones', () => {
  const movimientos = Array.from({ length: 1001 }, (_, i) => ({ fila: i + 2, proveedor: 'a', fecha: '2025-01-01', tipo: 'debito', monto: 1, motivo: 'm' }));
  assert.equal(generarSql({ movimientos, proveedoresNuevos: [] }).match(/insert into public\.notas_proveedor/g).length, 3);
});

test('aCsv / leerCsv: ida y vuelta con ; comillas, saltos de línea y BOM', () => {
  const filas = [{ a: 'uno; dos', b: 'con "comillas"', c: 'línea\nnueva' }, { a: '', b: 7, c: null }];
  const csv = aCsv(filas, ['a', 'b', 'c']);
  assert.ok(csv.startsWith('﻿a;b;c\r\n'));
  assert.deepEqual(leerCsv(csv), [{ a: 'uno; dos', b: 'con "comillas"', c: 'línea\nnueva' }, { a: '', b: '7', c: '' }]);
  assert.deepEqual(leerCsv('x,y\n1,2\n'), [{ x: '1', y: '2' }]);   // también con coma (si Excel lo guardó así)
});

test('informe: una línea por proveedor con la diferencia y los totales', () => {
  const porProveedor = new Map([
    ['acme', { slug: 'acme', nombres: new Set(['ACME']), renglones: 5, saldoPlanilla: 600, saldoImportado: 300, renglonesRevisar: 2 }],
    ['beta', { slug: 'beta', nombres: new Set(['BETA']), renglones: 1, saldoPlanilla: 0, saldoImportado: 0, renglonesRevisar: 0 }],
  ]);
  const txt = informe({ porProveedor, leidos: 6, compras: 2, pagos: 2, revisar: 2, ignorados: 0 });
  assert.match(txt, /acme.*600.*300.*300/);
  assert.match(txt, /TOTAL.*600.*300.*300/);
  assert.match(txt, /revisar\.csv/);
});
