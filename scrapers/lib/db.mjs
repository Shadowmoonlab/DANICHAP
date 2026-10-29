// db.mjs — Escritura en Supabase para los scrapers (service_role, solo en GitHub Actions)
// Habla directo con la API REST de Supabase (sin @supabase/supabase-js): los robots no necesitan npm install.
import fs from 'node:fs';
import { enParalelo } from './sesion.mjs';

const LOTE = 500;
const LOTES_SIMULTANEOS = 2;   // con 7 robots a la vez, más guardados en paralelo traban la base (plan gratis)
const PRECIO_MAX = 1e9;   // la columna es numeric(12,2): un precio absurdo del sitio no debe tirar abajo toda la corrida

function precioValido(v) {
  return Number.isFinite(v) && v >= 0 && v < PRECIO_MAX ? v : null;
}

export function env(nombre) {
  const v = process.env[nombre]?.trim();   // un espacio o salto de línea pegado con el secret rompe el login
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

const URL_API = `${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1`;
const KEY = env('SUPABASE_SERVICE_KEY');

async function rest(ruta, { method = 'POST', body, prefer } = {}) {
  const res = await fetch(`${URL_API}/${ruta}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  if (!res.ok) {
    let motivo = texto.slice(0, 200);
    try { motivo = JSON.parse(texto).message ?? motivo; } catch {}
    throw new Error(`${ruta.split('?')[0]}: ${motivo}`);
  }
  return texto ? JSON.parse(texto) : null;
}

// Reintenta ante caídas momentáneas del sitio del distribuidor (espera 30 s y 90 s)
export async function conReintentos(fn, { intentos = 3, esperasMs = [30_000, 90_000], etiqueta = '' } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (err) {
      if (i >= intentos || /^Login rechazado/.test(err.message)) throw err;   // una clave mal no se arregla reintentando
      const espera = esperasMs[Math.min(i - 1, esperasMs.length - 1)];
      console.warn(`[${etiqueta}] intento ${i} falló (${err.message}). Reintento en ${espera / 1000} s…`);
      await new Promise(ok => setTimeout(ok, espera));
    }
  }
}

// Guarda un lote; si la base corta por tiempo, lo parte a la mitad y reintenta (nunca pierde la corrida por eso)
async function guardarLote(lote, visto, intento = 1) {
  try {
    return await rest('rpc/upsert_precios', { body: { p_rows: lote, p_visto: visto } });
  } catch (err) {
    if (lote.length > 50 && /timeout|canceling statement/i.test(err.message)) {
      const mitad = Math.ceil(lote.length / 2);
      return (await guardarLote(lote.slice(0, mitad), visto)) + (await guardarLote(lote.slice(mitad), visto));
    }
    if (intento < 5) {   // corte momentáneo de la base: espera 2, 4, 8 y 16 s
      await new Promise(ok => setTimeout(ok, 1000 * 2 ** intento));
      return guardarLote(lote, visto, intento + 1);
    }
    throw err;
  }
}

// Corre un scraper, guarda sus filas y deja registro en scraper_runs.
// `scrape` devuelve [{ codigo, descripcion, marca, rubro, origen, precio_lista, precio_neto, imagen_url }]
export async function correrScraper(distribuidor, scrape) {
  const visto = new Date().toISOString();
  const run = (await rest('scraper_runs?select=id', { body: { distribuidor, inicio: visto }, prefer: 'return=representation' })
    .catch(() => null))?.[0];

  try {
    const filas = (await conReintentos(scrape, { etiqueta: distribuidor })).map(f => ({
      ...f, distribuidor, precio_lista: precioValido(f.precio_lista), precio_neto: precioValido(f.precio_neto),
    }));
    if (filas.length === 0) throw new Error('El distribuidor no devolvió productos');
    const raros = filas.filter(f => f.precio_lista == null && f.precio_neto == null).length;
    if (raros) console.warn(`[${distribuidor}] ${raros} artículos sin precio válido (se guardan sin precio)`);

    const lotes = Array.from({ length: Math.ceil(filas.length / LOTE) }, (_, i) => filas.slice(i * LOTE, (i + 1) * LOTE));
    const guardados = (await enParalelo(lotes, LOTES_SIMULTANEOS, lote => guardarLote(lote, visto)))
      .reduce((a, b) => a + b, 0);

    const inactivos = await rest('rpc/desactivar_no_vistos', { body: { p_distribuidor: distribuidor, p_visto: visto } });

    await terminarRun(run?.id, { ok: true, productos: guardados });
    console.log(`[${distribuidor}] OK — ${guardados} productos, ${inactivos} desactivados`);
    resumen(`✅ **${distribuidor}**: ${guardados} productos actualizados, ${inactivos} dados de baja`);
  } catch (err) {
    await terminarRun(run?.id, { ok: false, error: [err.message || String(err), err.detalle].filter(Boolean).join('\n').slice(0, 4000) });
    console.error(`[${distribuidor}] ERROR — ${err.message || err}`);
    resumen(`❌ **${distribuidor}**: ${String(err.message || err).slice(0, 300)}`);
    process.exitCode = 1;
  }
}

// Resumen visible en la página de la corrida de GitHub Actions
function resumen(linea) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, linea + '\n');
}

async function terminarRun(id, datos) {
  if (!id) return;
  await rest(`scraper_runs?id=eq.${id}`, { method: 'PATCH', body: { ...datos, fin: new Date().toISOString() } }).catch(() => {});
}

export function numero(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
