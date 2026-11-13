// PL Autopartes (robot nuevo, API RediRedi) y la protección del importador contra "precios" que son códigos de pieza (RIDA)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PL_SOLO_FUNCIONES = '1';
process.env.SUPABASE_URL ??= 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
const { filaDe } = await import('../scrapers/plautopartes.mjs');
const { separarPreciosRaros } = await import('../gestion/listas.js');

test('PL Autopartes: arma la fila con sku, título, rubro, precio y foto', () => {
  const f = filaDe({ id: 'abc', title: 'x', brand: '', category: { name: 'Chevrolet' }, pictures: ['https://img/1.jpg'],
    baseVariant: { sku: 'RR0192', title: 'Alma  delantera corsa', price: { amount: 12600, currency: 'ARS' } } });
  assert.deepEqual(f, { codigo: 'RR0192', descripcion: 'Alma delantera corsa', marca: null, rubro: 'Chevrolet', origen: null,
    precio_lista: 12600, precio_neto: 11340, imagen_url: 'https://img/1.jpg' });
});

test('PL Autopartes: sin precio queda en null (no en 0)', () => {
  const f = filaDe({ id: 'abc', title: 'Bisagra', baseVariant: { sku: 'RR1', price: { amount: 0 } } });
  assert.equal(f.precio_neto, null);
});

test('Importador: separa los precios que son códigos de pieza (caso RIDA)', () => {
  const normales = Array.from({ length: 40 }, (_, i) => ({ codigo: String(i), descripcion: 'Moldura ' + i, precio: 900 + i * 37.5 }));
  const raros = [
    { codigo: '667', descripcion: 'Adaptación Soporte Paragolpe Symbol', precio: 8200699903 },
    { codigo: '700', descripcion: 'Adaptación Rejilla Inferior', precio: 742212 },
  ];
  const r = separarPreciosRaros([...normales, ...raros]);
  assert.equal(r.productos.length, 40);
  assert.deepEqual(r.raros.map(p => p.codigo), ['667', '700']);
});

test('Importador: un precio caro con centavos no se toma como código', () => {
  const lista = [{ codigo: 'a', precio: 1000 }, { codigo: 'b', precio: 1200 }, { codigo: 'c', precio: 950000.5 }];
  assert.equal(separarPreciosRaros(lista).raros.length, 0);
});
