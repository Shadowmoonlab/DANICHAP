// plan.mjs — Imprime la lista de robots activos para la matriz del workflow (lista=[...] en GITHUB_OUTPUT).
// Con SOLO_PENDIENTES=true (corridas de reintento de la tarde) deja solo los que no terminaron bien en las
// últimas 20 h: si un sitio estaba caído a la mañana, se vuelve a intentar sin repetir los que ya cargaron.
// Los que fallaron por clave mal o cuenta bloqueada NO se reintentan en el día (cada intento es un login fallido más).
// También cierra las corridas que quedaron abiertas (trabajo cancelado o cortado por tiempo en GitHub).
import fs from 'node:fs';
import { DISTRIBUIDORES } from './distribuidores.mjs';

let activos = DISTRIBUIDORES.filter(d => d.activo && fs.existsSync(new URL(`./${d.archivo}.mjs`, import.meta.url)));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY: KEY } = process.env;
const api = (ruta, opciones = {}) => fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
  ...opciones, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
});

if (SUPABASE_URL && KEY) {
  const haceDosHoras = new Date(Date.now() - 2 * 3600_000).toISOString();
  await api(`scraper_runs?fin=is.null&inicio=lt.${haceDosHoras}`, { method: 'PATCH',
    body: JSON.stringify({ ok: false, fin: new Date().toISOString(), error: 'Corrida cortada (cancelada o sin terminar a tiempo)' }) })
    .catch(() => {});
}

if (process.env.SOLO_PENDIENTES === 'true') {
  const desde = new Date(Date.now() - 20 * 3600_000).toISOString();
  const res = await api(`scraper_runs?select=distribuidor,ok,error&fin=gte.${desde}`).catch(() => null);
  if (res?.ok) {
    const corridas = await res.json();
    const listos = new Set(corridas.filter(r => r.ok).map(r => r.distribuidor));
    const bloqueados = new Set(corridas.filter(r => !r.ok && /^Login rechazado|HTTP (401|403|429)/.test(r.error ?? '')).map(r => r.distribuidor));
    if (bloqueados.size) console.log(`Sin reintento hoy (clave o cuenta): ${[...bloqueados].join(', ')}`);
    activos = activos.filter(d => !listos.has(d.slug) && !bloqueados.has(d.slug));
  } else {
    // Sin saber quién ya cargó, no se corre nada: repetir todos (PR son miles de pedidos) es peor que esperar a mañana
    console.warn(`No pude leer scraper_runs (HTTP ${res?.status}): no corre ninguno en este reintento`);
    activos = [];
  }
}

const lista = JSON.stringify(activos.map(d => ({ slug: d.slug, archivo: d.archivo })));
console.log(`Robots a correr: ${activos.map(d => d.slug).join(', ') || 'ninguno (todos al día)'}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `lista=${lista}\n`);
