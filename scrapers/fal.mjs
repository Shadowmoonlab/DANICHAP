// fal.mjs — Autopartes Fal (autopartesfal.com, WordPress + WooCommerce)
// La web no muestra precios sin login (la API de WooCommerce devuelve 0), pero ofrece la lista completa en
// Excel (Dropbox) a los clientes. El robot entra, toma el link vigente de "Lista de precios" y la lee.
// Hoja "LISTA PRECIOS GESTION AL DIA": codigo | descripcion | precio1 | familia (~1.600 artículos).
import { correrScraper, env } from './lib/db.mjs';
import { crearSesion } from './lib/sesion.mjs';
import { leerPlanilla } from './lib/planilla.mjs';

const BASE = 'https://autopartesfal.com';
// Último link conocido (oct/2026), por si el sitio cambia de lugar el botón
const LISTA_RESPALDO = 'https://www.dropbox.com/scl/fi/jhlo9gre3fkcfn7mda68e/F066-LISTA-DE-PRECIOS.xls?rlkey=n69j7xj6pq4t5v6ra8vn6vi2s&dl=1';

async function linkDeLista() {
  const s = crearSesion(BASE);
  const login = await s.texto('/mi-cuenta/');
  const nonce = login.match(/name="woocommerce-login-nonce" value="([^"]+)"/)?.[1];
  if (!nonce) throw new Error('No encontré el formulario de ingreso');
  await s.pedir('/mi-cuenta/', { method: 'POST', form: {
    username: env('FAL_USER'), password: env('FAL_PASSWORD'),
    'woocommerce-login-nonce': nonce, _wp_http_referer: '/mi-cuenta/', login: 'Acceder', rememberme: 'forever',
  } });
  const inicio = await s.texto('/');
  if (!/logout|cerrar sesi/i.test(inicio)) throw new Error('Login rechazado: revisar FAL_USER / FAL_PASSWORD');
  const link = inicio.match(/https:\/\/www\.dropbox\.com\/[^"'\s]+?\.xlsx?\?[^"'\s]+/i)?.[0];
  return link ? link.replace(/&amp;/g, '&').replace(/dl=0/, 'dl=1') : null;
}

async function scrape() {
  let link = null;
  try { link = await linkDeLista(); }
  catch (e) { console.warn(`[fal] ${e.message}. Uso el último link conocido.`); }

  // El link del sitio puede llevar a una vista previa de Dropbox (HTML) en vez del archivo: probar ambos
  let ultimoError;
  for (const url of [...new Set([link, LISTA_RESPALDO].filter(Boolean))]) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { filas, hoja, descartadas } = leerPlanilla(Buffer.from(await res.arrayBuffer()));
      console.log(`[fal] ${url.split('?')[0].split('/').pop()} — hoja "${hoja}": ${filas.length} artículos (${descartadas} filas descartadas)`);
      return filas;
    } catch (e) {
      ultimoError = e;
      console.warn(`[fal] ${url.split('?')[0].split('/').pop()}: ${e.message}`);
    }
  }
  throw new Error(`No pude leer la lista de Fal: ${ultimoError.message}`);
}

await correrScraper('fal', scrape);
