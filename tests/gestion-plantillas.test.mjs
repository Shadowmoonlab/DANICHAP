// tests/gestion-plantillas.test.mjs — mensajes de WhatsApp
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presupuesto, recordatorioSaldo, pedidoProveedor } from '../gestion/plantillas.js';

const negocio = { nombre_negocio: 'DANICHAP', direccion: 'Av. Hipólito Yrigoyen 19608, Longchamps' };
const items = [{ cantidad: 2, descripcion: 'Lámpara H4', precio_unit: 6650 }, { cantidad: 1, descripcion: 'Óptica Gol', precio_unit: 96240 }];

test('presupuesto: renglones, total, validez y cierre', () => {
  const t = presupuesto({ cliente: 'Juan Pérez', items, negocio });
  assert.match(t, /^Hola Juan! 👋/);
  assert.match(t, /• 2 x Lámpara H4 — \$13\.300/);
  assert.match(t, /\*Total: \$109\.540\*/);
  assert.match(t, /válidos por 48 hs/);
  assert.match(t, /Longchamps/);
});

test('saludo usa la razón social completa para talleres y omite nombre vacío', () => {
  assert.match(presupuesto({ cliente: 'Taller Gómez', items, negocio }), /^Hola Taller Gómez!/);
  assert.match(presupuesto({ cliente: '', items, negocio }), /^Hola! 👋/);
});

test('recordatorio de saldo: monto y alias si existe', () => {
  const t = recordatorioSaldo({ cliente: 'Taller Gómez', saldo: 127000, negocio, alias: 'DANICHAP.REPUESTOS' });
  assert.match(t, /\*\$127\.000\*/);
  assert.match(t, /alias \*DANICHAP\.REPUESTOS\*/);
  assert.doesNotMatch(recordatorioSaldo({ cliente: 'X', saldo: 1, negocio }), /alias/);
});

test('pedido a proveedor con códigos', () => {
  const t = pedidoProveedor({ proveedor: 'DM', negocio, items: [{ cantidad: 3, codigo: '01/001/018', descripcion: 'AROS DE FARO' }] });
  assert.match(t, /Pedido de DANICHAP para DM/);
  assert.match(t, /• 3 x 01\/001\/018 — AROS DE FARO/);
});
