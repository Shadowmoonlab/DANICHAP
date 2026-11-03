// tests/gestion-texto.test.mjs — búsqueda normalizada y teléfonos para WhatsApp
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { palabras, normalizar, normalizarAmbos, coincidePalabras, telefonoWhatsApp, linkWhatsApp } from '../gestion/texto.js';

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

test('palabras: plurales en -es y -ces ("rulemanes", "luces")', () => {
  assert.deepEqual(palabras('rulemanes'), ['ruleman']);
  assert.deepEqual(palabras('sensores oxigeno'), ['sensor', 'oxigeno']);
  assert.deepEqual(palabras('luces'), ['luz']);
  assert.deepEqual(palabras('radiadores'), ['radiad']);
  assert.ok(coincidePalabras(normalizarAmbos('RULEMAN RUEDA DEL. GOL'), palabras('rulemanes gol')));
  assert.ok(coincidePalabras(normalizarAmbos('SENSOR OXIGENO CORSA'), palabras('sensores corsa')));
});

test('palabras: abreviaturas con . / - escritas en el buscador ("OPT.DEL.IZQ", "p/400", "F-100")', () => {
  assert.deepEqual(palabras('OPT.DEL.IZQ'), ['opt', 'izq']);
  assert.deepEqual(palabras('malacate p/400'), ['malacate', '400']);
  assert.deepEqual(palabras('aro faro F-100'), ['aro', 'faro', 'f100']);   // la "f" sola no sirve: queda pegado
  assert.deepEqual(palabras('faro renault 9'), ['faro', 'renault', '9']);   // un número de un dígito es un modelo
  assert.ok(coincidePalabras(normalizarAmbos('OPTICA DELANTERA IZQUIERDA CORSA'), palabras('OPT.DEL.IZQ corsa')));
  assert.ok(coincidePalabras(normalizarAmbos('AMORT. FIAT 400'), palabras('amortiguador p/400')));
  assert.ok(coincidePalabras(normalizarAmbos('ARO FARO FORD F-100'), palabras('aro F-100')));
});

test('buscador: los 2 mejores de cada proveedor siempre entran (las listas chicas no quedan tapadas)', async () => {
  const { conTodosLosProveedores } = await import('../gestion/texto.js');
  const fila = (prov, n) => ({ d: { distribuidor: prov, id: `${prov}-${n}` } });
  const orden = [...Array(50)].map((_, n) => fila(n % 2 ? 'dm' : 'otero', n)).concat([fila('francar', 1), fila('francar', 2), fila('francar', 3), fila('chriva', 1)]);
  const quedan = orden.filter(conTodosLosProveedores(40));
  assert.equal(quedan.filter(x => x.d.distribuidor === 'francar').length, 2);
  assert.equal(quedan.filter(x => x.d.distribuidor === 'chriva').length, 1);
  assert.equal(quedan.length, 43);
  assert.deepEqual(quedan.slice(0, 40), orden.slice(0, 40));   // el orden se mantiene
});

test('marca opcional: "optica peugeot 206" encuentra "OPTICA 206…" aunque no diga Peugeot', async () => {
  const { separarMarcas } = await import('../gestion/texto.js');
  const s = separarMarcas(palabras('optica peugeot 206'));
  assert.deepEqual(s, { duras: ['opt', '206'], blandas: ['peugeot'] });
  assert.ok(coincidePalabras(normalizarAmbos('OPTICA 206 VIDRIO LISO PARABOLA DOBLE'), s.duras));
  assert.deepEqual(separarMarcas(palabras('parrilla vw gol')).duras, ['parrilla', 'gol']);
});

test('marca obligatoria si no queda un modelo claro ("faro peugeot", "cerradura renault 9")', async () => {
  const { separarMarcas } = await import('../gestion/texto.js');
  assert.deepEqual(separarMarcas(palabras('faro peugeot')), { duras: ['faro', 'peugeot'], blandas: [] });
  assert.deepEqual(separarMarcas(palabras('cerradura renault 9')).blandas, []);   // un "9" solo traería cualquier código
  assert.deepEqual(separarMarcas(palabras('optica 206')).blandas, []);
});

test('"farol" busca "faro" (los proveedores escriben FARO TRASERO)', () => {
  assert.deepEqual(palabras('farol trasero clio'), ['faro', 'tras', 'clio']);
  assert.ok(coincidePalabras(normalizarAmbos('FARO TRASERO RENAULT CLIO'), palabras('farol trasero clio')));
});
