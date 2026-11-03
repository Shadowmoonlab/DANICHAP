// tests/gestion-texto.test.mjs — búsqueda normalizada y teléfonos para WhatsApp
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { palabras, normalizar, telefonoWhatsApp, linkWhatsApp } from '../gestion/texto.js';

test('normalizar: F-100 y F100 quedan iguales, sin acentos', () => {
  assert.equal(normalizar('Aro Faro F-100'), 'aro faro f100');
  assert.equal(normalizar('Óptica Gol 97/01'), 'optica gol 9701');
});

test('palabras: sin plural, sin caracteres que rompen el filtro, máximo 6', () => {
  assert.deepEqual(palabras('Paragolpes Siena'), ['parag', 'siena']);   // raíz: también encuentra "PARAG."
  assert.deepEqual(palabras('aros, (faro)*'), ['aro', 'faro']);
  assert.deepEqual(palabras('gas h4 x'), ['gas', 'h4']);          // "gas" (3 letras) no pierde la s; "x" se descarta
  assert.equal(palabras('a b c d e f g h i j k l m n ñ o p q r s t u v w y z aa bb cc dd ee ff gg').length, 6);
});

test('telefonoWhatsApp: formatos argentinos comunes', () => {
  assert.equal(telefonoWhatsApp('11 5555-1234'), '5491155551234');
  assert.equal(telefonoWhatsApp('011 15 5555-1234'), '5491155551234');
  assert.equal(telefonoWhatsApp('15 5247-5881'), '5491152475881');
  assert.equal(telefonoWhatsApp('+54 9 11 5555 1234'), '5491155551234');
  assert.equal(telefonoWhatsApp('0221 15 412-3456'), '5492214123456');
  assert.equal(telefonoWhatsApp('1145151234'), '5491145151234');   // un "15" en el medio no es prefijo
  assert.equal(telefonoWhatsApp(''), null);
  assert.equal(telefonoWhatsApp('1234'), null);
});

test('linkWhatsApp: codifica el texto y sin teléfono deja elegir contacto', () => {
  assert.equal(linkWhatsApp('11 5555-1234', 'Hola & chau'), 'https://wa.me/5491155551234?text=Hola%20%26%20chau');
  assert.equal(linkWhatsApp(null, 'x'), 'https://wa.me/?text=x');
});

test('numeroAR: precios escritos a la argentina', async () => {
  const { numeroAR } = await import('../gestion/texto.js');
  assert.equal(numeroAR('15.000'), 15000);
  assert.equal(numeroAR('1.500,50'), 1500.5);
  assert.equal(numeroAR('1.234.567'), 1234567);
  assert.equal(numeroAR('$ 12000'), 12000);
  assert.equal(numeroAR('12,5'), 12.5);
  assert.equal(numeroAR('12.5'), 12.5);
  assert.equal(numeroAR('0'), 0);
  assert.equal(numeroAR(''), null);
  assert.equal(numeroAR('abc'), null);
});

test('palabras: ignora "de/del" y usa la raíz de las abreviaturas de los proveedores', async () => {
  const { palabras, normalizar } = await import('../gestion/texto.js');
  assert.deepEqual(palabras('paragolpe de gol'), ['parag', 'gol']);
  assert.deepEqual(palabras('Parag del gol'), ['parag', 'gol']);
  assert.deepEqual(palabras(normalizar('óptica de corsa izquierda')), ['opt', 'corsa', 'izq']);
});

test('relevancia: primero lo que empieza con la primera palabra buscada', async () => {
  const { palabras, relevancia, normalizar } = await import('../gestion/texto.js');
  const ws = palabras(normalizar('óptica de corsa'));
  const orden = ['SOPORTE OPTICA CORSA', 'OPTICA CORSA 94/99 DER', 'VIDRIO OPTICA CORSA', 'OPT. CORSA CLASSIC IZQ']
    .sort((a, b) => relevancia(a, ws) - relevancia(b, ws));
  assert.deepEqual(orden.slice(0, 2).sort(), ['OPT. CORSA CLASSIC IZQ', 'OPTICA CORSA 94/99 DER']);
  assert.equal(orden.at(-1).startsWith('OPT'), false);
});

test('relevancia: la palabra tal como se escribió gana sobre su abreviatura', async () => {
  const { palabras, relevancia, normalizar } = await import('../gestion/texto.js');
  const q = 'alma paragolpe delantera';
  const ws = palabras(normalizar(q)), escritas = normalizar(q).split(/\s+/);
  const orden = ['ALMA DE PARAGOLPE DEL ONIX', 'ALMA DE PARAGOLPE DELANTERA'].sort((a, b) => relevancia(a, ws, escritas) - relevancia(b, ws, escritas));
  assert.equal(orden[0], 'ALMA DE PARAGOLPE DELANTERA');
});

test('búsqueda: encuentra palabras pegadas con "/" o "." (FARO P/GOL, OPT.DEL.IZQ) sin traer "paraGOLpe"', async () => {
  const { palabras, normalizar, normalizarAmbos, coincidePalabras } = await import('../gestion/texto.js');
  const encuentra = (q, desc) => coincidePalabras(normalizarAmbos(desc), palabras(normalizar(q)));
  assert.equal(encuentra('faro gol', 'FARO P/GOL TREND'), true);
  assert.equal(encuentra('optica delantera corsa', 'OPT.DEL.IZQ CORSA'), true);
  assert.equal(encuentra('paragolpe der', 'PARAGOLPE DEL. IZQ/DER'), true);
  assert.equal(encuentra('espejo control', 'ESPEJO C/CONTROL'), true);
  assert.equal(encuentra('f100', 'ARO DE FARO F-100'), true);        // el código pegado sigue andando
  assert.equal(encuentra('gol', 'PARAGOLPE CORSA'), false);         // "gol" no es "paraGOLpe"
  assert.equal(encuentra('aro', 'FARO TRASERO'), false);
  assert.equal(encuentra('malacate 400', 'Malacate p/400 kg'), true);
});
