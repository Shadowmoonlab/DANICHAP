// tests/gestion-listas.test.mjs — importación de listas de precios en planilla
// La planilla de prueba imita el formato real de Cavila: encabezado de descripción vacío, secciones por
// vehículo, encabezado repetido (a veces sin "Precio") y leyenda "PRECIO NETO SIN IVA" al pie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aNumero, parsearLista, aFilasDePrecio, detectarColumnas } from '../gestion/listas.js';

const PLANILLA = [
  ['', 'DISTRIBUIDORA DE EJEMPLO S.R.L.', '', '', ''],
  ['', 'TEL (011) 4000-0000', '', '', ''],
  ['', '', '', 'LISTA DE PRECIOS Nº 7', ''],
  ['', '', '', 'Peugeot 504', ''],
  ['', 'Còdigo', 'Mano', '', 'Precio'],
  ['', 523, '   *', 'C/ENS P504 SR', 58300],
  ['', 515, '   *', 'C/ENS DEL P504 GAS', '58.300'],
  ['', '', '', '', ''],
  ['', '', '', 'Fiat 128', ''],
  ['', 'Còdigo', 'Mano', '', ''],
  ['', 'A-10', '', 'GUARDABARRO DEL 128', '24.824,67'],
  ['', 'A-11', '', 'GUARDABARRO SIN PRECIO', ''],
  ['', 'PRECIO NETO SIN IVA', '', '', ''],
];

test('aNumero: formatos argentinos y con $', () => {
  assert.equal(aNumero(58300), 58300);
  assert.equal(aNumero('58.300'), 58300);
  assert.equal(aNumero('24.824,67'), 24824.67);
  assert.equal(aNumero('$ 1.234.567'), 1234567);
  assert.equal(aNumero('1,5'), 1.5);
  assert.equal(aNumero('12,345'), 12345);
  assert.equal(aNumero(''), null);
  assert.equal(aNumero('consultar'), null);
});

test('detecta columnas aunque la descripción no tenga encabezado', () => {
  assert.deepEqual(detectarColumnas(PLANILLA), { encabezado: 4, codigo: 1, precio: 4, descripcion: 3 });
});

test('parsea productos, secciones como rubro y la leyenda sin IVA', () => {
  const r = parsearLista(PLANILLA);
  assert.equal(r.productos.length, 3);
  assert.deepEqual(r.productos[0], { codigo: '523', descripcion: 'C/ENS P504 SR', rubro: 'Peugeot 504', precio: 58300 });
  assert.equal(r.productos[2].rubro, 'Fiat 128');
  assert.equal(r.productos[2].precio, 24824.67);
  assert.deepEqual(r.secciones, ['Peugeot 504', 'Fiat 128']);
  assert.equal(r.preciosSinIva, true);
  assert.equal(r.descartadas, 1);   // el renglón sin precio se informa, no se inventa
});

test('planilla sin columnas reconocibles devuelve vacío', () => {
  const r = parsearLista([['hola', 'mundo'], ['1', '2']]);
  assert.equal(r.columnas, null);
  assert.equal(r.productos.length, 0);
});

test('aFilasDePrecio: IVA y descuento', () => {
  const [f] = aFilasDePrecio([{ codigo: 'X', descripcion: 'Y', rubro: null, precio: 1000 }], { sumarIva: true, descuentoPct: 10 });
  assert.equal(f.precio_lista, 1210);
  assert.equal(f.precio_neto, 1089);
});
