// db.mjs — Escritura en Supabase para los scrapers (service_role, solo en GitHub Actions)
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const LOTE = 1000;

// En GitHub Actions los secrets llegan juntos en SECRETS_JSON: se pasan a process.env (sin pisar lo que ya exista)
if (process.env.SECRETS_JSON) {
  for (const [k, v] of Object.entries(JSON.parse(process.env.SECRETS_JSON))) {
    if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v;
  }
}

export function env(nombre) {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_KEY'), {
  auth: { persistSession: false },
});

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

// Corre un scraper, guarda sus filas y deja registro en scraper_runs.
// `scrape` devuelve [{ codigo, descripcion, marca, rubro, origen, precio_lista, precio_neto, imagen_url }]
export async function correrScraper(distribuidor, scrape) {
  const visto = new Date().toISOString();
  const { data: run } = await db.from('scraper_runs')
    .insert({ distribuidor, inicio: visto }).select('id').single();

  try {
    const filas = (await conReintentos(scrape, { etiqueta: distribuidor })).map(f => ({ ...f, distribuidor }));
    if (filas.length === 0) throw new Error('El distribuidor no devolvió productos');

    let guardados = 0;
    for (let i = 0; i < filas.length; i += LOTE) {
      const { data, error } = await db.rpc('upsert_precios', {
        p_rows: filas.slice(i, i + LOTE), p_visto: visto,
      });
      if (error) throw new Error(`upsert_precios: ${error.message}`);
      guardados += data;
    }

    const { data: inactivos, error } = await db.rpc('desactivar_no_vistos', {
      p_distribuidor: distribuidor, p_visto: visto,
    });
    if (error) throw new Error(`desactivar_no_vistos: ${error.message}`);

    await terminarRun(run?.id, { ok: true, productos: guardados });
    console.log(`[${distribuidor}] OK — ${guardados} productos, ${inactivos} desactivados`);
    resumen(`✅ **${distribuidor}**: ${guardados} productos actualizados, ${inactivos} dados de baja`);
  } catch (err) {
    await terminarRun(run?.id, { ok: false, error: String(err.message || err).slice(0, 1000) });
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
  await db.from('scraper_runs').update({ ...datos, fin: new Date().toISOString() }).eq('id', id);
}

export function numero(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
