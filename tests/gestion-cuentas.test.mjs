// tests/gestion-cuentas.test.mjs — cuenta corriente de proveedores (gestion/cuentas-calc.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repartirPago, ordenarCuentas, diasVencido, textoResumen, totalAdeudado } from '../gestion/cuentas-calc.js';

const REMITOS = [
  { id: 7, fecha: '2026-10-20', pendiente: 30000 },
  { id: 3, fecha: '2026-09-01', pendiente: 10000 },
  { id: 5, fecha: '2026-10-01', pendiente: 25000 },
];

test('repartirPago: aplica primero al remito más viejo', () => {
  const r = repartirPago(20000, REMITOS);
  assert.deepEqual(r.aplicaciones, [{ recepcion_id: 3, monto: 10000 }, { recepcion_id: 5, monto: 10000 }]);
  assert.equal(r.aCuenta, 0);
});

test('repartirPago: si sobra plata, queda a cuenta', () => {
  const r = repartirPago(70000, REMITOS);
  assert.deepEqual(r.aplicaciones.map(a => a.monto), [10000, 25000, 30000]);
  assert.equal(r.aCuenta, 5000);
});

test('repartirPago: misma fecha → el de número más chico primero', () => {
  const r = repartirPago(5, [{ id: 9, fecha: '2026-10-01', pendiente: 5 }, { id: 2, fecha: '2026-10-01', pendiente: 5 }]);
  assert.deepEqual(r.aplicaciones, [{ recepcion_id: 2, monto: 5 }]);
});

test('repartirPago: ignora remitos ya pagados y montos inválidos', () => {
  assert.deepEqual(repartirPago(100, [{ id: 1, fecha: '2026-01-01', pendiente: 0 }, { id: 2, fecha: '2026-01-02', pendiente: -50 }]),
    { aplicaciones: [], aCuenta: 100 });
  assert.deepEqual(repartirPago(0, REMITOS), { aplicaciones: [], aCuenta: 0 });
  assert.deepEqual(repartirPago(null, REMITOS), { aplicaciones: [], aCuenta: 0 });
});

test('repartirPago: centavos sin errores de redondeo', () => {
  const r = repartirPago(100.3, [{ id: 1, fecha: '2026-01-01', pendiente: 33.1 }, { id: 2, fecha: '2026-01-02', pendiente: 33.1 }]);
  assert.deepEqual(r.aplicaciones.map(a => a.monto), [33.1, 33.1]);
  assert.equal(r.aCuenta, 34.1);
});

test('repartirPago: no modifica la lista que recibe', () => {
  const copia = structuredClone(REMITOS);
  repartirPago(20000, REMITOS);
  assert.deepEqual(REMITOS, copia);
});

test('ordenarCuentas: primero los que tienen saldo (mayor a menor), después el resto por nombre', () => {
  const filas = [
    { nombre: 'Zeta', saldo: 0 }, { nombre: 'Beta', saldo: 5000 }, { nombre: 'Alfa', saldo: 0 },
    { nombre: 'Gama', saldo: 90000 }, { nombre: 'Delta', saldo: -2000 },
  ];
  assert.deepEqual(ordenarCuentas(filas).map(f => f.nombre), ['Gama', 'Beta', 'Delta', 'Alfa', 'Zeta']);
});

test('totalAdeudado: suma solo lo que se debe (un saldo a favor no resta)', () => {
  assert.equal(totalAdeudado([{ saldo: 1000 }, { saldo: '2500.5' }, { saldo: -800 }, { saldo: 0 }]), 3500.5);
});

test('diasVencido: días pasados del vencimiento (0 o negativo = al día; sin vencimiento = null)', () => {
  assert.equal(diasVencido('2026-10-01', '2026-10-31'), 30);
  assert.equal(diasVencido('2026-11-10', '2026-11-01'), -9);
  assert.equal(diasVencido(null, '2026-11-01'), null);
});

test('textoResumen: saldo y remitos impagos, en texto simple para WhatsApp', () => {
  const t = textoResumen({
    negocio: 'DANICHAP', proveedor: 'Cromosol', saldo: 35000, hoy: '2026-11-13',
    remitos: [{ nro_comprobante: 'A-1', fecha: '2026-10-01', pendiente: 20000 }, { nro_comprobante: null, fecha: '2026-11-01', pendiente: 15000 }],
  });
  assert.match(t, /Cromosol/);
  assert.match(t, /DANICHAP/);
  assert.match(t, /13\/11\/2026/);
  assert.match(t, /\$\s?35\.000/);
  assert.match(t, /Nº A-1.*01\/10\/2026.*\$\s?20\.000/);
  assert.match(t, /sin número.*01\/11\/2026.*\$\s?15\.000/);
  assert.doesNotMatch(t, /[<>*_]/);   // sin negritas ni HTML: se lee igual en cualquier celular
});

test('textoResumen: sin deuda lo dice claro', () => {
  assert.match(textoResumen({ negocio: 'DANICHAP', proveedor: 'DM', saldo: 0, hoy: '2026-11-13', remitos: [] }), /no le debemos nada/i);
  assert.match(textoResumen({ negocio: 'DANICHAP', proveedor: 'DM', saldo: -5000, hoy: '2026-11-13', remitos: [] }), /a favor.*5\.000/i);
});
