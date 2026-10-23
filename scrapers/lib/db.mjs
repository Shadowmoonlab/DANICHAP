// db.mjs — Escritura en Supabase para los scrapers (service_role, solo en GitHub Actions)
import { createClient } from '@supabase/supabase-js';

const LOTE = 1000;

export function env(nombre) {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_KEY'), {
  auth: { persistSession: false },
});

// Corre un scraper, guarda sus filas y deja registro en scraper_runs.
// `scrape` devuelve [{ codigo, descripcion, marca, rubro, origen, precio_lista, precio_neto, imagen_url }]
export async function correrScraper(distribuidor, scrape) {
  const visto = new Date().toISOString();
  const { data: run } = await db.from('scraper_runs')
    .insert({ distribuidor, inicio: visto }).select('id').single();

  try {
    const filas = (await scrape()).map(f => ({ ...f, distribuidor }));
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
  } catch (err) {
    await terminarRun(run?.id, { ok: false, error: String(err.message || err).slice(0, 1000) });
    console.error(`[${distribuidor}] ERROR — ${err.message || err}`);
    process.exitCode = 1;
  }
}

async function terminarRun(id, datos) {
  if (!id) return;
  await db.from('scraper_runs').update({ ...datos, fin: new Date().toISOString() }).eq('id', id);
}

export function numero(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
