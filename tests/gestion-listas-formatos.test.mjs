// tests/gestion-listas-formatos.test.mjs — Formatos reales de proveedores: sin encabezado (Francar, Chriva),
// encabezado corrido (Reposiciones), código pegado a la descripción y PDF (Liqui Moly, Mello), varias hojas (Senesa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearLista, parsearLibro, filasDePdf, aNumero } from '../gestion/listas.js';

test('Francar: sin encabezado, código | descripción | (nuevo) | precio, títulos de modelo', () => {
  const filas = [
    ['', 'AUTOPARTES', '', ''], ['', ' FRANCAR SRL', '', 1], ['', 'Tel: 5770-1307', '', ''],
    ['', 'CITROEN C3', '', ''],
    ['C3-001', 'ALMA DE PARAGOLPE DELANTERA C3 2013/2023', '', 56250],
    ['', 'CHEVROLET AGILE', '', ''],
    ['CHEAGI-001', 'ALMA DE PARAGOLPE DELANTERA AGILE C/AIRBAG', '', 52000],
    ['CHEAGI-002', 'ALMA DE PARAGOLPE DELANTERA AGILE S/AIRBAG', '', 52000],
    ['FCRONOS-001', 'CAPOT FIAT CRONOS', 'NUEVO', 150000],
  ];
  const r = parsearLista(filas);
  assert.equal(r.productos.length, 4);
  assert.deepEqual(r.productos[0], { codigo: 'C3-001', descripcion: 'ALMA DE PARAGOLPE DELANTERA C3 2013/2023', rubro: 'CITROEN C3', precio: 56250 });
  assert.equal(r.productos[2].rubro, 'CHEVROLET AGILE');
  assert.equal(r.productos[3].descripcion, 'CAPOT FIAT CRONOS NUEVO');
});

test('Chriva: código numérico, el título del modelo en otra columna', () => {
  const filas = [
    ['', '', '', '', '03 de Agosto de 2026', '', '', 'Nº3'],
    ['', '', '', '', 'FIAT 128', '', '', ''],
    ['', 35, 'GUARDABARRO TRASERO', '', '', '', '', 64900],
    ['', 29, 'PISO DELANTERO', '', '', '', '', 20000],
    ['', 1341, 'GUIAS DE PISO', '', '', '', '', 4200],
    ['', '', '', '', 'FIAT 147', '', '', ''],
    ['', 1310, 'PISO COMPLETO CON GUIAS DE ASIENTO', '', '', '', '', 50500],
  ];
  const r = parsearLista(filas);
  assert.deepEqual(r.productos.map(p => [p.codigo, p.rubro, p.precio]),
    [['35', 'FIAT 128', 64900], ['29', 'FIAT 128', 20000], ['1341', 'FIAT 128', 4200], ['1310', 'FIAT 147', 50500]]);
});

test('Encabezado corrido sin título de código (Reposiciones): código, tipo + detalle y precio', () => {
  const filas = [
    ['REPOSICIONES', '', '', '', '', ''],
    ['', 'DESC_STOCK', 'DESCRIPCION', 'DESTINO', 'PRECIO', 'MARCA'],
    ['3032', 'VOLKSWAGEN DODGE 1500 D 78/80', '', '', 8688.22, 'DAEMA'],
    ['3209', 'AVANCE AL VACIO', 'VOLKSWAGEN DODGE 1500 1,8', '', 6077.42, 'DAEMA'],
    ['WR78', 'BUJIAS DE ENCENDIDO', 'EQUIV. BOSCH WR78', '', 11464.51, 'EKTION'],
    ['HR78', 'BUJIAS DE ENCENDIDO', 'EQUIV. BOSCH HR78', '', 11464.51, 'EKTION'],
  ];
  const r = parsearLista(filas);
  assert.equal(r.productos.length, 4);
  assert.deepEqual(r.productos[2], { codigo: 'WR78', descripcion: 'BUJIAS DE ENCENDIDO EQUIV. BOSCH WR78', rubro: 'REPOSICIONES', precio: 11464.51 });
});

test('PDF (Liqui Moly): código al principio de la descripción y precio sin IVA (la columna de la izquierda)', () => {
  const pag = [
    { x: 153, y: 767, s: 'Deutsche Autoteile und Zubehör (Argentina) S.A.' },
    { x: 34, y: 689, s: 'ACEITES SINTÉTICOS PARA MOTORES' },
    { x: 48, y: 664, s: '8909 SYNTHOIL RACE TECH GT1 10W-60' }, { x: 409, y: 664, s: '5 l' }, { x: 440, y: 664, s: '4' },
    { x: 460, y: 664, s: '- 153,639 €- -' }, { x: 528, y: 664, s: '185,903-' },
    { x: 48, y: 652, s: '1856 SYNTHOIL HIGH TECH 5W-40' }, { x: 409, y: 652, s: '5 l' }, { x: 440, y: 652, s: '4' },
    { x: 460, y: 652, s: '- 137,465 €- -' }, { x: 528, y: 652, s: '166,332-' },
    { x: 48, y: 640, s: '2595 LEICHTLAUF HIGH TECH 5W-40' }, { x: 409, y: 640, s: '4 l' }, { x: 440, y: 640, s: '4' },
    { x: 460, y: 640, s: '-' }, { x: 472, y: 640, s: '79,529 €- -' }, { x: 533, y: 640, s: '96,230-' },
  ];
  const r = parsearLista(filasDePdf([pag]));
  assert.deepEqual(r.productos.map(p => [p.codigo, p.descripcion, p.precio, p.rubro]), [
    ['8909', 'SYNTHOIL RACE TECH GT1 10W-60 5 l', 153639, 'ACEITES SINTÉTICOS PARA MOTORES'],
    ['1856', 'SYNTHOIL HIGH TECH 5W-40 5 l', 137465, 'ACEITES SINTÉTICOS PARA MOTORES'],
    ['2595', 'LEICHTLAUF HIGH TECH 5W-40 4 l', 79529, 'ACEITES SINTÉTICOS PARA MOTORES'],
  ]);
});

test('PDF (ofertas Mello): sin código, "$ | 15 500", títulos de modelo', () => {
  const pag = [
    { x: 150, y: 771, s: 'OFERTAS FIAT / SEPTIEMBRE 2026' },
    { x: 53, y: 738, s: 'FIAT 600' },
    { x: 53, y: 724, s: 'OP.Fiat 600' }, { x: 384, y: 724, s: '$' }, { x: 506, y: 724, s: '15 500' },
    { x: 53, y: 712, s: 'Aro Fiat 600 Cromado' }, { x: 384, y: 712, s: '$' }, { x: 511, y: 712, s: '4 250' },
    { x: 53, y: 700, s: 'Giro Del F.600' }, { x: 384, y: 700, s: '$' }, { x: 511, y: 700, s: '7 500' },
  ];
  const r = parsearLista(filasDePdf([pag]));
  assert.deepEqual(r.productos.map(p => [p.codigo, p.precio, p.rubro]),
    [['OP.Fiat 600', 15500, 'FIAT 600'], ['Aro Fiat 600 Cromado', 4250, 'FIAT 600'], ['Giro Del F.600', 7500, 'FIAT 600']]);
});

test('Libro con varias hojas (Senesa): junta todo y el nombre de la hoja es el rubro', () => {
  const enc = ['', 'Descripcion', 'Lado', 'Codigo', 'Unitario S / IVA'];
  const hojas = [
    { nombre: 'PORTAMAZAS', filas: [['ESTOS PRECIOS NO INCLUYEN IVA', '', '', '', ''], enc,
      ['', 'CLIO I SIN ABS', 'Izq', 'PM-0371', 128000], ['', 'CLIO I SIN ABS', 'Der', 'PM-0372', 128000]] },
    { nombre: 'PUNTAS DE EJE', filas: [enc, ['', 'PUNTA DE EJE DUSTER', 'I/D', 'PE-0411', 65000]] },
    { nombre: 'Hoja1', filas: [enc, ['', 'CLIO I SIN ABS', 'Izq', 'PM-0371', 128000]] },   // repetido: queda uno
  ];
  const r = parsearLibro(hojas);
  assert.deepEqual(r.productos.map(p => [p.codigo, p.descripcion, p.rubro]), [
    ['PM-0371', 'CLIO I SIN ABS Izq', 'PORTAMAZAS'], ['PM-0372', 'CLIO I SIN ABS Der', 'PORTAMAZAS'],
    ['PE-0411', 'PUNTA DE EJE DUSTER I/D', 'PUNTAS DE EJE'],
  ]);
  assert.equal(r.preciosSinIva, true);
});

test('aNumero: "153,639 €-", "15 500", "185,903-"', () => {
  assert.equal(aNumero('- 153,639 €- -'), 153639);
  assert.equal(aNumero('15 500'), 15500);
  assert.equal(aNumero('185,903-'), 185903);
});

test('arreglarAcentos: repara texto UTF-8 leído como Windows-1252 y no toca el texto sano', async () => {
  const { arreglarAcentos } = await import('../gestion/listas.js');
  assert.equal(arreglarAcentos('AGR\u00c3\u008dCOLA'), 'AGRÍCOLA');
  assert.equal(arreglarAcentos('\u00c3\u2018ANDU'), 'ÑANDU');
  assert.equal(arreglarAcentos('ÓPTICA CORSA PIÑÓN'), 'ÓPTICA CORSA PIÑÓN');
});
