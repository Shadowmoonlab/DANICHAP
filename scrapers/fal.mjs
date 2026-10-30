// fal.mjs — Autopartes Fal (autopartesfal.com, WordPress + WooCommerce)
// La web no muestra precios sin login (la API de WooCommerce devuelve 0), pero ofrece la lista completa en
// Excel (Dropbox) a los clientes. El robot entra, toma el link vigente de "Lista de precios" y la lee.
// Hoja "LISTA PRECIOS GESTION AL DIA": codigo | descripcion | precio1 | familia (~1.600 artículos).
import { correrScraper, env } from './lib/db.mjs';
import { crearSesion } from './lib/sesion.mjs';
import { leerPlanilla } from './lib/planilla.mjs';

const BASE = 'https://autopartesfal.com';
// Link de respaldo por si el sitio cambia de lugar el botón: va en el secret FAL_LISTA_URL (opcional),
// nunca en el código: el repo es público y ese link da la lista de precios de clientes sin login.
const LISTA_RESPALDO = process.env.FAL_LISTA_URL?.trim() || null;

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
  let link = null, errorLogin;
  try { link = await linkDeLista(); }
  catch (e) {
    if (!LISTA_RESPALDO) throw e;   // sin link de respaldo no hay de dónde leer: que se vea el error real (ej. clave mal)
    errorLogin = e;
    console.warn(`[fal] ${e.message}. Uso el link de respaldo.`);
  }
  if (!link && !LISTA_RESPALDO) throw new Error('No encontré el link de "Lista de precios" en la web de Fal (se puede cargar uno de respaldo en el secret FAL_LISTA_URL)');

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
  throw new Error(`No pude leer la lista de Fal: ${(ultimoError ?? errorLogin).message}`);
}

await correrScraper('fal', scrape);
