// db.mjs — Escritura en Supabase para los scrapers (service_role, solo en GitHub Actions)
// Habla directo con la API REST de Supabase (sin @supabase/supabase-js): los robots no necesitan npm install.
import fs from 'node:fs';
import { enParalelo } from './sesion.mjs';
import { aNumero } from '../../gestion/listas.js';

const LOTE = 500;
const LOTES_SIMULTANEOS = 2;   // con 7 robots a la vez, más guardados en paralelo traban la base (plan gratis)
const MINIMO_LEIDO = 0.7;   // si se lee menos del 70 % de lo que había, no se da de baja nada (lectura cortada)
const PRECIO_MAX = 1e9;   // la columna es numeric(12,2): un precio absurdo del sitio no debe tirar abajo toda la corrida

// Un precio en 0 es "sin precio" (artículo sin cotizar), no un precio válido: no debe pisar el anterior
function precioValido(v) {
  return Number.isFinite(v) && v > 0 && v < PRECIO_MAX ? v : null;
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

// Errores que no se arreglan reintentando: clave mal, cuenta bloqueada o el sitio pidiendo que bajemos el ritmo.
// Reintentar justo eso es lo que hace que un distribuidor bloquee la cuenta.
export const esErrorDefinitivo = err => /^Login rechazado|HTTP (401|403|429)/.test(err?.message ?? '');

// Reintenta ante caídas momentáneas del sitio del distribuidor (espera 30 s y 90 s)
export async function conReintentos(fn, { intentos = 3, esperasMs = [30_000, 90_000], etiqueta = '' } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (err) {
      if (i >= intentos || esErrorDefinitivo(err)) throw err;
      const espera = esperasMs[Math.min(i - 1, esperasMs.length - 1)];
      console.warn(`[${etiqueta}] intento ${i} falló (${err.message}). Reintento en ${espera / 1000} s…`);
      await new Promise(ok => setTimeout(ok, espera));
    }
  }
}

// Guarda un lote; si la base corta por tiempo, lo parte a la mitad y reintenta (nunca pierde la corrida por eso)
async function guardarLote(rpc, lote, visto, intento = 1) {
  try {
    return await rest(`rpc/${rpc}`, { body: { p_rows: lote, p_visto: visto } });
  } catch (err) {
    if (lote.length > 50 && /timeout|canceling statement/i.test(err.message)) {
      const mitad = Math.ceil(lote.length / 2);
      return (await guardarLote(rpc, lote.slice(0, mitad), visto)) + (await guardarLote(rpc, lote.slice(mitad), visto));
    }
    if (intento < 5 && !esFuncionInexistente(err)) {   // corte momentáneo de la base: espera 2, 4, 8 y 16 s
      await new Promise(ok => setTimeout(ok, 1000 * 2 ** intento));
      return guardarLote(rpc, lote, visto, intento + 1);
    }
    throw err;
  }
}

// PGRST202 "Could not find the function ... in the schema cache" (no confundir con "Could not query ... schema cache", que es pasajero)
const esFuncionInexistente = err => /Could not find the function/i.test(err.message);

// Guarda todas las filas y da de baja lo que el distribuidor ya no lista.
// Con docs/robots-sincronizar.sql solo se escriben las filas que cambiaron; sin ese SQL todavía aplicado,
// usa las funciones anteriores (reescribe todo): los robots funcionan igual en los dos casos.
async function sincronizar(distribuidor, filas, visto) {
  const lotes = Array.from({ length: Math.ceil(filas.length / LOTE) }, (_, i) => filas.slice(i * LOTE, (i + 1) * LOTE));
  let rpc = 'sincronizar_precios';
  let cambios;
  try {
    cambios = await guardarLote(rpc, lotes[0], visto);
  } catch (err) {
    if (!esFuncionInexistente(err)) throw err;
    console.warn(`[${distribuidor}] sin docs/robots-sincronizar.sql en la base: guardo con upsert_precios`);
    rpc = 'upsert_precios';
    cambios = await guardarLote(rpc, lotes[0], visto);
  }
  cambios += (await enParalelo(lotes.slice(1), LOTES_SIMULTANEOS, lote => guardarLote(rpc, lote, visto)))
    .reduce((a, b) => a + b, 0);

  // Freno: si el sitio devolvió solo una parte (página que falló, API cortada), no se da de baja el resto del catálogo
  const activos = await contarActivos(distribuidor);
  if (activos == null || filas.length < activos * MINIMO_LEIDO) {
    const motivo = activos == null ? 'no pude contar los activos' : `leí ${filas.length} de ${activos} activos`;
    console.warn(`[${distribuidor}] ${motivo}: esta vez no doy de baja ninguno`);
    return { cambios, bajas: 0, sinBajas: motivo };
  }
  const bajas = rpc === 'sincronizar_precios'
    ? await rest('rpc/desactivar_ausentes', { body: { p_distribuidor: distribuidor, p_codigos: filas.map(f => f.codigo) } })
    : await rest('rpc/desactivar_no_vistos', { body: { p_distribuidor: distribuidor, p_visto: visto } });
  return { cambios, bajas };
}

// Cuántos artículos activos tiene hoy el distribuidor (null si no se pudo saber: entonces no se da de baja nada)
async function contarActivos(distribuidor) {
  try {
    const res = await fetch(`${URL_API}/precios_distribuidor?select=codigo&activo=is.true&distribuidor=eq.${encodeURIComponent(distribuidor)}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
    });
    if (!res.ok && res.status !== 206) return null;
    const total = Number(res.headers.get('content-range')?.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch { return null; }
}

// Corre un scraper, guarda sus filas y deja registro en scraper_runs.
// `scrape` devuelve [{ codigo, descripcion, marca, rubro, origen, precio_lista, precio_neto, imagen_url }]
export async function correrScraper(distribuidor, scrape) {
  const visto = new Date().toISOString();
  const run = (await rest('scraper_runs?select=id', { body: { distribuidor, inicio: visto }, prefer: 'return=representation' })
    .catch(() => null))?.[0];

  try {
    const leidas = (await conReintentos(scrape, { etiqueta: distribuidor })).map(f => ({
      ...f, distribuidor, codigo: String(f.codigo ?? '').trim(),
      precio_lista: precioValido(f.precio_lista), precio_neto: precioValido(f.precio_neto),
    })).filter(f => f.codigo);
    const filas = [...new Map(leidas.map(f => [f.codigo, f])).values()];   // un código repetido rompe el upsert
    if (filas.length === 0) throw new Error('El distribuidor no devolvió productos');
    const raros = filas.filter(f => f.precio_lista == null && f.precio_neto == null).length;
    if (raros) console.warn(`[${distribuidor}] ${raros} artículos sin precio válido (se guardan sin precio)`);

    const { cambios, bajas, sinBajas } = await sincronizar(distribuidor, filas, visto);

    await terminarRun(run?.id, { ok: true, productos: filas.length });
    console.log(`[${distribuidor}] OK — ${filas.length} productos (${cambios} nuevos o con cambios), ${bajas} dados de baja`);
    resumen(`✅ **${distribuidor}**: ${filas.length} productos (${cambios} nuevos o con cambios), ${sinBajas ? `sin bajas (${sinBajas})` : `${bajas} dados de baja`}`);
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

// Mismo lector que las planillas: "1.234,56", "1,234.56", "$ 10.021" y números ya numéricos
export const numero = aNumero;
