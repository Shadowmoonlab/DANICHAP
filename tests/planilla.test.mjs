// tests/planilla.test.mjs — lectura de planillas de los robots (scrapers/lib/planilla.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { leerPlanilla, deducirColumnas } from '../scrapers/lib/planilla.mjs';

const XLSX = createRequire(import.meta.url)('../vendor/xlsx-0.20.3.full.min.js');
const aXls = filas => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

// Planilla sin encabezados (como algunas exportaciones PHP): se deduce por el contenido
const SIN_ENCABEZADO = [
  ['AUTOPARTES EJEMPLO'],
  ...Array.from({ length: 12 }, (_, i) => [`OT-${100 + i}`, `FARO DELANTERO MODELO ${i} IZQUIERDO`, 'NISSAN', 2 + i, 15000.5 + i * 1000]),
];

test('deduce código, descripción y precio sin encabezado', () => {
  assert.deepEqual(deducirColumnas(SIN_ENCABEZADO), { codigo: 0, descripcion: 1, precio: 4 });
  const { filas } = leerPlanilla(aXls(SIN_ENCABEZADO));
  assert.equal(filas.length, 12);
  assert.equal(filas[0].codigo, 'OT-100');
  assert.equal(filas[0].precio_lista, 15000.5);
});

test('con encabezado usa el detector del panel', () => {
  const { filas } = leerPlanilla(aXls([['Código', 'Descripción', 'Precio'], ['A1', 'BOMBA DE AGUA', '24.824,67']]));
  assert.equal(filas[0].precio_lista, 24824.67);
});

test('una página web en vez de la planilla da un error claro', () => {
  assert.throws(() => leerPlanilla(Buffer.from('<!DOCTYPE html><html><body>Ingresar</body></html>')), /página web/);
});
