// plan.mjs — Imprime la lista de robots activos para la matriz del workflow (lista=[...] en GITHUB_OUTPUT).
// Con SOLO_PENDIENTES=true (corridas de reintento de la tarde) deja solo los que no terminaron bien en las
// últimas 20 h: si un sitio estaba caído a la mañana, se vuelve a intentar sin repetir los que ya cargaron.
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
  const res = await api(`scraper_runs?select=distribuidor&ok=is.true&fin=gte.${desde}`).catch(() => null);
  if (res?.ok) {
    const listos = new Set((await res.json()).map(r => r.distribuidor));
    activos = activos.filter(d => !listos.has(d.slug));
  } else {
    console.warn(`No pude leer scraper_runs (HTTP ${res?.status}): corren todos`);
  }
}

const lista = JSON.stringify(activos.map(d => ({ slug: d.slug, archivo: d.archivo })));
console.log(`Robots a correr: ${activos.map(d => d.slug).join(', ') || 'ninguno (todos al día)'}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `lista=${lista}\n`);
