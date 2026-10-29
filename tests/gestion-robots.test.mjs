// tests/gestion-robots.test.mjs — estado de precios por proveedor en el panel (gestion/robots.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoPrecios } from '../gestion/robots.js';

const fecha = iso => iso.slice(5, 16).replace('T', ' ');
const AHORA = Date.parse('2026-10-29T12:00:00Z');
const run = (inicio, extra) => ({ inicio, fin: inicio, ok: true, productos: 1000, error: null, ...extra });

test('sin corridas', () => {
  assert.equal(estadoPrecios([], fecha, AHORA).tipo, 'none');
});

test('última corrida bien: precios al día con fecha y cantidad', () => {
  const e = estadoPrecios([run('2026-10-29T09:00:00Z', { productos: 32370 })], fecha, AHORA);
  assert.equal(e.tipo, 'ok');
  assert.match(e.texto, /10-29 09:00: 32\.370 artículos/);
});

test('un intento fallido no esconde los precios buenos anteriores', () => {
  const e = estadoPrecios([
    run('2026-10-29T09:00:00Z', { ok: false, error: 'DM no responde (HTTP 504)\ndetalle' }),
    run('2026-10-28T09:00:00Z'),
  ], fecha, AHORA);
  assert.equal(e.tipo, 'warn');
  assert.match(e.texto, /Precios del 10-28 09:00/);
  assert.equal(e.detalle, 'DM no responde (HTTP 504)');
});

test('corriendo ahora no es un error', () => {
  const e = estadoPrecios([run('2026-10-29T11:59:00Z', { fin: null, ok: null }), run('2026-10-28T09:00:00Z')], fecha, AHORA);
  assert.equal(e.tipo, 'run');
  assert.match(e.texto, /actualizando ahora/);
});

test('abierta hace más de 2 h cuenta como cortada', () => {
  const e = estadoPrecios([run('2026-10-29T08:00:00Z', { fin: null, ok: null })], fecha, AHORA);
  assert.equal(e.tipo, 'err');
});
