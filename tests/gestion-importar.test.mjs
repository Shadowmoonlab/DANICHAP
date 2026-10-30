// tests/gestion-importar.test.mjs — Importar lista: CSV con ";" y .xls-HTML con precios argentinos (como hace proveedores.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parsearLista } from '../gestion/listas.js';

const XLSX = createRequire(import.meta.url)('../vendor/xlsx-0.20.3.full.min.js');
const filasDe = wb => XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

test('CSV con ";": "58.300" es 58300 y el código 00123 no pierde los ceros', () => {
  const csv = 'Codigo;Descripcion;Precio\n00123;FARO DEL. CORSA;58.300\nA-9;ESPEJO;1.234,56\n';
  const r = parsearLista(filasDe(XLSX.read(csv, { type: 'string', FS: ';', raw: true })));
  assert.deepEqual(r.productos.map(p => [p.codigo, p.precio]), [['00123', 58300], ['A-9', 1234.56]]);
});

test('.xls que es una tabla HTML: "10.021,00" es 10021', () => {
  const html = '<table><tr><th>Codigo</th><th>Descripcion</th><th>Precio</th></tr><tr><td>0045</td><td>PARAGOLPE</td><td>10.021,00</td></tr></table>';
  const r = parsearLista(filasDe(XLSX.read(Buffer.from(html), { raw: true })));
  assert.deepEqual(r.productos.map(p => [p.codigo, p.precio]), [['0045', 10021]]);
});
