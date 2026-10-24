// tests/leer-factura.test.mjs — lectura de comprobantes con un cliente simulado (no gasta tokens)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerFactura, leerFacturaConLimite, inicioDelDiaArgentina, validarArchivo, normalizarDatos, ErrorLectura, MODELO } from '../supabase/functions/_shared/leer-factura.js';

const B64 = Buffer.from('%PDF-1.4 prueba').toString('base64');

function clienteFalso(respuesta) {
  const llamadas = [];
  return { llamadas, beta: { messages: { create: async params => { llamadas.push(params); return respuesta; } } } };
}
const ok = datos => ({ model: MODELO, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 },
  content: [{ type: 'text', text: JSON.stringify(datos) }] });

const DATOS = {
  tipo_documento: 'factura', proveedor_nombre: 'DM', proveedor_cuit: '30-70609966-6', numero: '0103-00006041',
  fecha: '2026-10-16', subtotal: 104160, iva: 21873.6, total: 126033.6, precios_con_iva: false,
  renglones: [{ codigo: '02/027/072', descripcion: 'PARAGOLPES SIENA 97/01 TRASERO NEGRO', cantidad: 1, precio_unitario: 104160, legible: true, nota: null }],
  advertencias: [],
};

test('arma el pedido: modelo, fallback, salida estructurada y PDF como document', async () => {
  const c = clienteFalso(ok(DATOS));
  const r = await leerFactura(c, { archivo: B64, media_type: 'application/pdf', proveedor: 'DM' });
  const p = c.llamadas[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.effort, 'medium');
  assert.equal(p.messages[0].content[0].type, 'document');
  assert.match(p.messages[0].content[1].text, /proveedor "DM"/);
  assert.equal('temperature' in p, false);
  assert.equal(r.datos.renglones.length, 1);
  assert.equal(r.uso.output_tokens, 20);
});

test('las fotos van como bloque image', async () => {
  const c = clienteFalso(ok(DATOS));
  await leerFactura(c, { archivo: B64, media_type: 'image/jpeg' });
  assert.equal(c.llamadas[0].messages[0].content[0].type, 'image');
});

test('valida formato y tamaño antes de llamar a la API', () => {
  assert.throws(() => validarArchivo({ archivo: B64, media_type: 'text/html' }), ErrorLectura);
  assert.throws(() => validarArchivo({ archivo: '', media_type: 'image/png' }), /Falta el archivo/);
  assert.throws(() => validarArchivo({ archivo: 'A'.repeat(28_000_000), media_type: 'image/png' }), /demasiado grande/);
});

test('rechazo y corte por largo se informan como error de lectura', async () => {
  await assert.rejects(leerFactura(clienteFalso({ stop_reason: 'refusal', content: [] }), { archivo: B64, media_type: 'image/png' }), e => e.codigo === 'rechazo');
  await assert.rejects(leerFactura(clienteFalso({ stop_reason: 'max_tokens', content: [] }), { archivo: B64, media_type: 'image/png' }), e => e.codigo === 'largo');
  await assert.rejects(leerFactura(clienteFalso({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no es json' }] }), { archivo: B64, media_type: 'image/png' }), e => e.codigo === 'formato');
});

test('normalizar: nunca deja números inventados ni negativos y avisa si la suma no cierra', () => {
  const d = normalizarDatos({ ...DATOS, subtotal: 200000, renglones: [
    { codigo: 'A', descripcion: 'X', cantidad: 2, precio_unitario: 50000, legible: true, nota: null },
    { codigo: 'B', descripcion: 'Y', cantidad: -1, precio_unitario: null, legible: true, nota: null },
    { codigo: 'C', descripcion: '  ', cantidad: 1, precio_unitario: 1, legible: true, nota: null },
  ] });
  assert.equal(d.renglones.length, 2);                 // el renglón sin descripción se descarta
  assert.equal(d.renglones[1].cantidad, null);
  assert.equal(d.renglones[1].legible, false);         // sin precio → a revisar
  assert.match(d.advertencias.at(-1), /no coincide con el subtotal/);
});

test('Haiku va sin fallback (no lo soporta) y un modelo desconocido cae en el de defecto', async () => {
  const c = clienteFalso(ok(DATOS));
  await leerFactura(c, { archivo: B64, media_type: 'image/png' }, { modelo: 'claude-haiku-5-5' });
  assert.equal(c.llamadas[0].model, 'claude-haiku-5-5');
  assert.equal('fallbacks' in c.llamadas[0], false);
  assert.equal('betas' in c.llamadas[0], false);
  await leerFactura(c, { archivo: B64, media_type: 'image/png' }, { modelo: 'gpt-loquesea' });
  assert.equal(c.llamadas[1].model, MODELO);
});

test('límite diario: bloquea sin llamar a la API y registra el consumo cuando lee', async () => {
  const registros = [];
  const base = (usadas, limite = 4) => ({ limite: async () => limite, contarHoy: async () => usadas, registrar: async f => { registros.push(f); } });
  const c = clienteFalso(ok(DATOS));
  await assert.rejects(leerFacturaConLimite(c, { archivo: B64, media_type: 'image/png' }, { base: base(4) }), e => e.codigo === 'limite_diario');
  assert.equal(c.llamadas.length, 0);
  const r = await leerFacturaConLimite(c, { archivo: B64, media_type: 'image/png' }, { base: base(2) });
  assert.equal(r.lecturas_hoy, 3);
  assert.deepEqual(registros, [{ modelo: MODELO, input_tokens: 10, output_tokens: 20 }]);
});

test('el día se cuenta en hora argentina', () => {
  assert.equal(inicioDelDiaArgentina(Date.parse('2026-10-24T02:30:00Z')), '2026-10-23T03:00:00.000Z'); // 23:30 del 23 en ARG
  assert.equal(inicioDelDiaArgentina(Date.parse('2026-10-24T03:30:00Z')), '2026-10-24T03:00:00.000Z'); // 00:30 del 24 en ARG
});
