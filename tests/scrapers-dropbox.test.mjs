// tests/scrapers-dropbox.test.mjs — link de la lista de Fal (Dropbox) a descarga directa
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksDeDescarga } from '../scrapers/lib/dropbox.mjs';

test('linksDeDescarga: decodifica &#038; de WordPress y pide el archivo, no la vista previa', () => {
  const [dl, raw, directo] = linksDeDescarga('https://www.dropbox.com/scl/fi/abc/F066-LISTA-DE-PRECIOS.xls?rlkey=K1&#038;st=S2&#038;dl=0');
  assert.equal(dl, 'https://www.dropbox.com/scl/fi/abc/F066-LISTA-DE-PRECIOS.xls?rlkey=K1&st=S2&dl=1');
  assert.equal(raw, 'https://www.dropbox.com/scl/fi/abc/F066-LISTA-DE-PRECIOS.xls?rlkey=K1&st=S2&raw=1');
  assert.equal(directo, 'https://dl.dropboxusercontent.com/scl/fi/abc/F066-LISTA-DE-PRECIOS.xls?rlkey=K1&st=S2');
});

test('linksDeDescarga: &amp; y links sin dl', () => {
  assert.equal(linksDeDescarga('https://www.dropbox.com/s/x/lista.xlsx?rlkey=a&amp;e=1')[0], 'https://www.dropbox.com/s/x/lista.xlsx?rlkey=a&e=1&dl=1');
  assert.deepEqual(linksDeDescarga('https://otro.com/lista.xls?a=1'), ['https://otro.com/lista.xls?a=1']);
});
