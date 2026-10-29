// tests/planilla.test.mjs — lectura de planillas de los robots (scrapers/lib/planilla.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { leerPlanilla, deducirColumnas, leerCsv } from '../scrapers/lib/planilla.mjs';

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

test('CSV con encabezado y separador | (Goicoechea "códigos corridos")', () => {
  const csv = 'Codigo|Descripcion|Marca|Linea|Precio Lista|Precio Neto\r\nA-1|BOMBA DE AGUA|SKF|MOTOR|1000,50|800,40\r\nA-2|FILTRO|MANN|FILTROS|200|150\r\n';
  const filas = leerCsv(csv);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], { codigo: 'A-1', descripcion: 'BOMBA DE AGUA', marca: 'SKF', rubro: 'MOTOR', origen: null,
    precio_lista: 1000.5, precio_neto: 800.4, imagen_url: null });
});

test('tabla HTML con tablas anidadas por grupo (formato Otero: Marca | Modelo | Subrubro | Código | Nombre | Precio)', () => {
  const grupo = (m, filas) => `<tr><td>${m}</td><td>145/146</td><td>ACCESORIOS</td><td colspan="5"><table>${filas}</table></td></tr>`;
  const prod = (c, n, p) => `<tr><td></td><td></td><td></td><td>${c}</td><td>${n}</td><td>$ ${p}</td><td></td><td><img src="x.jpg"></td></tr>`;
  const html = `<html><head><meta charset="utf-8"></head><body><table><tr><td>Autopartes Otero</td></tr>
    <tr><th>Marca</th><th>Modelo</th><th>Subrubro</th><th>C&oacute;digo</th><th>Nombre</th><th>Precio</th><th></th><th>Foto</th></tr>
    ${grupo('ALFA ROMEO', prod('OT1', 'PARAGOLPE DEL', '12.345,50') + prod('OT2', 'FARO IZQ', '9.000'))}
    ${grupo('FIAT', prod('OT3', 'ESPEJO DER', '1.234,00'))}</table></body></html>`;
  const { filas } = leerPlanilla(Buffer.from(html.padEnd(5000, ' ')));
  assert.deepEqual(filas.map(f => [f.codigo, f.precio_lista]), [['OT1', 12345.5], ['OT2', 9000], ['OT3', 1234]]);
});
