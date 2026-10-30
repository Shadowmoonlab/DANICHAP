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

function baseFalsa(previas, limite = 4) {
  const filas = Array.from({ length: previas }, (_, i) => ({ id: i + 1, modelo: 'x' }));
  let sig = previas + 1;
  return {
    filas,
    limite: async () => limite,
    contarHoy: async (_desde, hastaId) => filas.filter(r => !hastaId || r.id <= hastaId).length,
    reservar: async () => { const id = sig++; filas.push({ id, modelo: 'leyendo' }); return id; },
    liberar: async id => { filas.splice(filas.findIndex(r => r.id === id), 1); },
    completar: async (id, fila) => { Object.assign(filas.find(r => r.id === id), fila); },
  };
}
const nuevas = b => b.filas.filter(r => r.modelo !== 'x').map(({ id, ...r }) => r);

test('límite diario: bloquea sin llamar a la API y registra el consumo cuando lee', async () => {
  const c = clienteFalso(ok(DATOS));
  const llena = baseFalsa(4);
  await assert.rejects(leerFacturaConLimite(c, { archivo: B64, media_type: 'image/png' }, { base: llena }), e => e.codigo === 'limite_diario');
  assert.equal(c.llamadas.length, 0);
  assert.equal(llena.filas.length, 4);
  const b = baseFalsa(2);
  const r = await leerFacturaConLimite(c, { archivo: B64, media_type: 'image/png' }, { base: b });
  assert.equal(r.lecturas_hoy, 3);
  assert.deepEqual(nuevas(b), [{ modelo: MODELO, input_tokens: 10, output_tokens: 20 }]);
});

test('límite diario: dos lecturas a la vez con 3 usadas → solo una pasa', async () => {
  const b = baseFalsa(3);
  let leidas = 0;
  const lector = async () => { leidas++; await new Promise(ok => setTimeout(ok, 5)); return { modelo: 'm', datos: {}, uso: {} }; };
  const pedido = () => leerFacturaConLimite(null, { archivo: B64, media_type: 'image/png' }, { base: b, lector });
  const res = await Promise.allSettled([pedido(), pedido()]);
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(res.find(r => r.status === 'rejected').reason.codigo, 'limite_diario');
  assert.equal(leidas, 1);
  assert.equal(b.filas.length, 4);
});

test('límite diario: si la lectura falla, libera el cupo', async () => {
  const b = baseFalsa(1);
  const lector = async () => { throw new ErrorLectura('demoró', 'demora'); };
  await assert.rejects(leerFacturaConLimite(null, { archivo: B64, media_type: 'image/png' }, { base: b, lector }), e => e.codigo === 'demora');
  assert.equal(b.filas.length, 1);
});

test('el día se cuenta en hora argentina', () => {
  assert.equal(inicioDelDiaArgentina(Date.parse('2026-10-24T02:30:00Z')), '2026-10-23T03:00:00.000Z'); // 23:30 del 23 en ARG
  assert.equal(inicioDelDiaArgentina(Date.parse('2026-10-24T03:30:00Z')), '2026-10-24T03:00:00.000Z'); // 00:30 del 24 en ARG
});

// ── Gemini (plan gratuito de Google AI Studio) ────────────────────────────
import { leerFacturaGemini, MODELO_GEMINI, MODELO_GEMINI_RESPALDO } from '../supabase/functions/_shared/leer-factura.js';

const respGemini = (datos, extra = {}) => ({ ok: true, status: 200, json: async () => ({
  modelVersion: 'gemini-2.5-flash', usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 700 },
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(datos) }] } }], ...extra }) });
const fetchFalso = respuesta => { const llamadas = []; const f = async (url, init) => { llamadas.push({ url, init }); return respuesta; }; f.llamadas = llamadas; return f; };

test('Gemini: arma el pedido REST (modelo, clave en header, archivo inline, JSON) y normaliza la salida', async () => {
  const f = fetchFalso(respGemini(DATOS));
  const r = await leerFacturaGemini('CLAVE', { archivo: B64, media_type: 'application/pdf', proveedor: 'DM' }, { fetchFn: f });
  const { url, init } = f.llamadas[0];
  assert.match(url, new RegExp(`/models/${MODELO_GEMINI}:generateContent$`));
  assert.equal(init.headers['x-goog-api-key'], 'CLAVE');
  assert.equal(url.includes('CLAVE'), false);               // la clave nunca va en la URL
  const body = JSON.parse(init.body);
  assert.equal(body.contents[0].parts[0].inline_data.mime_type, 'application/pdf');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.match(body.contents[0].parts[1].text, /proveedor "DM"/);
  assert.equal(r.datos.renglones.length, 1);
  assert.deepEqual(r.uso, { input_tokens: 1500, output_tokens: 700 });
});

test('Gemini: modelo inválido cae en el de defecto; cupo agotado, bloqueo y corte se informan', async () => {
  const f = fetchFalso(respGemini(DATOS));
  await leerFacturaGemini('K', { archivo: B64, media_type: 'image/png' }, { modelo: 'x/../y', fetchFn: f });
  assert.match(f.llamadas[0].url, new RegExp(`/models/${MODELO_GEMINI}:`));
  const e = (resp, cod) => assert.rejects(leerFacturaGemini('K', { archivo: B64, media_type: 'image/png' }, { fetchFn: fetchFalso(resp) }), x => x.codigo === cod);
  await e({ ok: false, status: 429 }, 'limite');
  await e({ ok: false, status: 500 }, 'api');
  await e({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }, 'rechazo');
  await e(respGemini(DATOS, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }), 'largo');
});

test('Gemini: respeta el límite diario y registra el consumo igual que Claude', async () => {
  const base = baseFalsa(1);
  const lector = (_c, e) => leerFacturaGemini('K', e, { fetchFn: fetchFalso(respGemini(DATOS)) });
  const r = await leerFacturaConLimite(null, { archivo: B64, media_type: 'image/png' }, { base, lector });
  assert.equal(r.lecturas_hoy, 2);
  assert.deepEqual(nuevas(base), [{ modelo: 'gemini-2.5-flash', input_tokens: 1500, output_tokens: 700 }]);
});

test('Gemini: si devuelve el objeto dentro de una lista lo desenvuelve', async () => {
  const r = await leerFacturaGemini('K', { archivo: B64, media_type: 'image/png' }, { fetchFn: fetchFalso(respGemini([DATOS])) });
  assert.equal(r.datos.renglones.length, 1);
});

test('Gemini: tolera el JSON envuelto en ```json y descarta las partes de razonamiento', async () => {
  const resp = respGemini(DATOS, { candidates: [{ finishReason: 'STOP', content: { parts: [
    { text: 'pensando…', thought: true },
    { text: '```json\n' + JSON.stringify(DATOS) + '\n```' },
  ] } }] });
  const r = await leerFacturaGemini('K', { archivo: B64, media_type: 'image/jpeg' }, { fetchFn: fetchFalso(resp) });
  assert.equal(r.datos.renglones.length, 1);
});

test('límite diario fijo en 4: aunque la base diga 50, la quinta lectura se rechaza', async () => {
  const base = baseFalsa(4, 50);
  await assert.rejects(leerFacturaConLimite(null, { archivo: B64, media_type: 'image/png' }, { base, lector: async () => ({}) }),
    e => e.codigo === 'limite_diario' && /límite 4/.test(e.message));
});

test('Gemini: si el modelo rápido falla (503), reintenta una vez con el de respaldo y lee', async () => {
  const llamadas = [];
  const f = async (url, init) => { llamadas.push(url); return llamadas.length === 1 ? { ok: false, status: 503, text: async () => '{"error":{"message":"overloaded"}}' } : respGemini(DATOS); };
  const r = await leerFacturaGemini('K', { archivo: B64, media_type: 'image/jpeg' }, { fetchFn: f });
  assert.equal(llamadas.length, 2);
  assert.match(llamadas[0], new RegExp(`/models/${MODELO_GEMINI}:`));
  assert.match(llamadas[1], new RegExp(`/models/${MODELO_GEMINI_RESPALDO}:`));
  assert.equal(r.datos.renglones.length, 1);
});

test('Gemini: si tarda más del máximo se corta (demora); el cupo agotado no se reintenta', async () => {
  const lento = (_url, init) => new Promise((_ok, mal) => init.signal.addEventListener('abort', () => mal(Object.assign(new Error('abort'), { name: 'AbortError' }))));
  await assert.rejects(leerFacturaGemini('K', { archivo: B64, media_type: 'image/jpeg' }, { fetchFn: lento, esperasMs: [20, 20] }), e => e.codigo === 'demora');
  let n = 0;
  await assert.rejects(leerFacturaGemini('K', { archivo: B64, media_type: 'image/jpeg' }, { fetchFn: async () => { n++; return { ok: false, status: 429 }; } }), e => e.codigo === 'limite');
  assert.equal(n, 1);
});

test('Gemini: el motivo del error de Google llega al mensaje', async () => {
  const f = async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"API key not valid"}}' });
  await assert.rejects(leerFacturaGemini('K', { archivo: B64, media_type: 'image/jpeg' }, { fetchFn: f }), e => e.codigo === 'api_pedido' && /API key not valid/.test(e.message));
});

test('docs/leer-factura-un-archivo.ts está al día con la función (npm run armar:funcion)', async () => {
  const fs = await import('node:fs');
  const { armarFuncion } = await import('../dev/armar-funcion.mjs');
  assert.equal(fs.readFileSync(new URL('../docs/leer-factura-un-archivo.ts', import.meta.url), 'utf8'), armarFuncion());
});
