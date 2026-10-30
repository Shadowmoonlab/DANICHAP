// tests/gestion-texto.test.mjs — búsqueda normalizada y teléfonos para WhatsApp
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { palabras, normalizar, telefonoWhatsApp, linkWhatsApp } from '../gestion/texto.js';

test('normalizar: F-100 y F100 quedan iguales, sin acentos', () => {
  assert.equal(normalizar('Aro Faro F-100'), 'aro faro f100');
  assert.equal(normalizar('Óptica Gol 97/01'), 'optica gol 9701');
});

test('palabras: sin plural, sin caracteres que rompen el filtro, máximo 6', () => {
  assert.deepEqual(palabras('Paragolpes Siena'), ['paragolpe', 'siena']);
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
