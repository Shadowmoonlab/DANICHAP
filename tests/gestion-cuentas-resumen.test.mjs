// tests/gestion-cuentas-resumen.test.mjs — comparación con el resumen del proveedor y movimientos de la planilla (gestion/cuentas-calc.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararResumen, mismoComprobante, tituloMovimiento } from '../gestion/cuentas-calc.js';

test('mismoComprobante: mismo número escrito distinto (ceros, prefijos, punto de venta)', () => {
  assert.equal(mismoComprobante('FC A 0001-00000106', '106'), true);
  assert.equal(mismoComprobante('FC A 0001-00000106', '0001-00000106'), true);
  assert.equal(mismoComprobante('FA-000000101', 'A 101'), true);
  assert.equal(mismoComprobante('FC A 0001-00000106', '107'), false);
  assert.equal(mismoComprobante('FC A 0001-00000106', null), false);
  assert.equal(mismoComprobante('X 12', '12'), false);   // números de menos de 3 cifras no alcanzan para decir que es el mismo
});

const DOCS = [
  { comprobante: 'FC A 0001-00000106', fecha: '2026-01-20', saldo: 1000 },
  { comprobante: 'FC A 0001-00000105', fecha: '2026-01-18', saldo: 500 },
  { comprobante: 'NC A 0001-00000019', fecha: '2026-01-10', saldo: -200 },
];
const REMITOS = [
  { id: 1, nro_comprobante: '106', fecha: '2026-01-20', pendiente: 1000 },
  { id: 2, nro_comprobante: '0001-00000099', fecha: '2026-01-02', pendiente: 300 },
  { id: 3, nro_comprobante: null, fecha: '2026-01-03', pendiente: 50 },
];

test('compararResumen: saldos, diferencia y comprobantes que están de un solo lado', () => {
  const r = compararResumen({ saldoProveedor: 1300, saldoSistema: 1350, docsProveedor: DOCS, remitosSistema: REMITOS });
  assert.equal(r.diferencia, -50);
  assert.equal(r.coinciden, false);
  assert.deepEqual(r.docs.map(d => [d.comprobante, d.enSistema]), [
    ['NC A 0001-00000019', false], ['FC A 0001-00000105', false], ['FC A 0001-00000106', true],
  ]);
  assert.deepEqual(r.soloProveedor.map(d => d.comprobante), ['NC A 0001-00000019', 'FC A 0001-00000105']);
  assert.deepEqual(r.soloSistema.map(x => x.id), [2, 3]);
});

test('compararResumen: diferencia de centavos = coinciden; sin detalle no falla', () => {
  const r = compararResumen({ saldoProveedor: '1000.40', saldoSistema: 1000, docsProveedor: null, remitosSistema: [] });
  assert.equal(r.coinciden, true);
  assert.equal(r.diferencia, 0.4);
  assert.deepEqual(r.docs, []);
  assert.deepEqual(r.soloSistema, []);
});

test('compararResumen: comprobantes en cero o remitos pagados no cuentan', () => {
  const r = compararResumen({ saldoProveedor: 0, saldoSistema: 0, docsProveedor: [{ comprobante: 'FC 1234', saldo: 0 }],
    remitosSistema: [{ id: 9, nro_comprobante: '555', fecha: '2026-01-01', pendiente: 0 }] });
  assert.deepEqual(r.docs, []);
  assert.deepEqual(r.soloSistema, []);
});

test('tituloMovimiento: las notas de la planilla se muestran como compra o pago', () => {
  assert.deepEqual(tituloMovimiento({ tipo: 'nota_debito', detalle: 'Planilla · Compra · RTO 123' }), { titulo: 'Compra (planilla)', detalle: 'RTO 123' });
  assert.deepEqual(tituloMovimiento({ tipo: 'nota_credito', detalle: 'Planilla · Pago' }), { titulo: 'Pago (planilla)', detalle: '' });
  assert.deepEqual(tituloMovimiento({ tipo: 'nota_credito', detalle: 'devolución' }), { titulo: 'Nota de crédito', detalle: 'devolución' });
  assert.deepEqual(tituloMovimiento({ tipo: 'compra', detalle: 'Remito Nº 5' }), { titulo: 'Compra', detalle: 'Remito Nº 5' });
  assert.deepEqual(tituloMovimiento({ tipo: 'pago', detalle: null }), { titulo: 'Pago', detalle: '' });
  // Un pago cargado en el panel con la nota "Planilla · …" no se toca (solo las notas)
  assert.deepEqual(tituloMovimiento({ tipo: 'pago', detalle: 'Planilla · x' }), { titulo: 'Pago', detalle: 'Planilla · x' });
});
