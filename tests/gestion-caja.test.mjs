// tests/gestion-caja.test.mjs — cierre de caja con arqueo (gestion/caja-calc.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCierre, leerDiferencia } from '../gestion/caja-calc.js';

const DIA = [
  { medio: 'efectivo', ventas: 50000, cobros: 8000, ingresos: 0, gastos: 3000, retiros: 10000 },
  { medio: 'transferencia', ventas: 22000, cobros: 0, ingresos: 0, gastos: 1500, retiros: 0 },
  { medio: 'debito', ventas: 9000, cobros: 0, ingresos: 0, gastos: 0, retiros: 0 },
];

test('efectivo esperado = cambio inicial + lo que entró en efectivo − lo que salió en efectivo', () => {
  const c = calcularCierre(DIA, 5000);
  assert.equal(c.entra, 58000);
  assert.equal(c.sale, 13000);
  assert.equal(c.esperado, 5000 + 58000 - 13000);
  assert.deepEqual(c.otros, { transferencia: 20500, debito: 9000 });   // no se cuentan en la caja
});

test('día sin efectivo: el esperado es el cambio inicial', () => {
  assert.equal(calcularCierre([{ medio: 'debito', ventas: 1000 }], 2000).esperado, 2000);
  assert.equal(calcularCierre([], 0).esperado, 0);
});

test('lectura de la diferencia', () => {
  assert.deepEqual(leerDiferencia(50000, 50000.4), { tipo: 'ok', texto: 'La caja cierra justa' });
  assert.equal(leerDiferencia(49000, 50000).tipo, 'falta');
  assert.match(leerDiferencia(49000, 50000).texto, /Faltan \$1\.000/);
  assert.match(leerDiferencia(50500, 50000).texto, /Sobran \$500/);
});

// docs/gestion-v18.sql: caja_del_dia trae lo pagado a proveedores y las compras sin proveedor (desde el 14/11)
test('pago a proveedor en efectivo baja lo esperado; por transferencia no toca la caja', () => {
  const dia = [
    { medio: 'efectivo', ventas: 100000, cobros: 0, ingresos: 0, gastos: 0, retiros: 0, pagos_proveedores: 30000, compras: 0 },
    { medio: 'transferencia', ventas: 0, cobros: 0, ingresos: 0, gastos: 0, retiros: 0, pagos_proveedores: 50000, compras: 0 },
  ];
  const c = calcularCierre(dia, 0);
  assert.equal(c.entra, 100000);
  assert.equal(c.sale, 30000);
  assert.equal(c.esperado, 70000);
  assert.equal(leerDiferencia(70000, c.esperado).tipo, 'ok');   // contó 70.000: sin faltante
  assert.deepEqual(c.otros, { transferencia: -50000 });          // la transferencia sale del banco, no de la caja
});

test('compra sin proveedor (pagada en el momento) sale del efectivo', () => {
  const c = calcularCierre([{ medio: 'efectivo', ventas: 20000, cobros: 0, ingresos: 0, gastos: 0, retiros: 0, pagos_proveedores: 0, compras: 5000 }], 1000);
  assert.equal(c.sale, 5000);
  assert.equal(c.esperado, 16000);
});
