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
