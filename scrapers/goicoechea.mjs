// goicoechea.mjs — Goicoechea Hnos. (goicoechea.com.ar, PHP + jQuery, ~70.000 artículos)
// Login: POST /account/log/login  (username, password, remember)  → {"success":true}
// Lista: GET /account/downloads/exportExcel/8/csv → lista completa del cliente en un solo archivo (separador |),
//        con el precio neto "calculado y actualizado al momento de la descarga" (página Mi cuenta → Descargas).
// Un solo pedido por día a propósito: recorrer las ~3.500 páginas del buscador son miles de pedidos y el sitio
// empezó a rechazar la cuenta después de dos corridas así. Si el CSV falla, se reintenta en la corrida de las 12/18.
import { correrScraper, env } from './lib/db.mjs';
import { crearSesion } from './lib/sesion.mjs';
import { leerCsv } from './lib/planilla.mjs';

const BASE = 'https://goicoechea.com.ar';
const AJAX = { 'X-Requested-With': 'XMLHttpRequest' };
const MINIMO_CSV = 10_000;

async function scrape() {
  const s = crearSesion(BASE);
  await s.pedir('/');
  const login = await s.json('/account/log/login', { method: 'POST', headers: AJAX,
    form: { username: env('GOICOECHEA_USER'), password: env('GOICOECHEA_PASSWORD'), remember: 'true' } });
  if (login?.success !== true) {
    const motivo = String(login?.message ?? login?.error ?? login?.msg ?? '').slice(0, 120);
    throw new Error(`Login rechazado${motivo ? ` ("${motivo}")` : ''}: revisar GOICOECHEA_USER / GOICOECHEA_PASSWORD`);
  }

  try {
    const archivo = await s.binario('/account/downloads/exportExcel/8/csv');
    let texto = archivo.toString('utf8');
    if (texto.includes('�')) texto = archivo.toString('latin1');
    if (/^\s*<(!doctype|html)/i.test(texto)) throw new Error('el sitio devolvió una página en vez de la lista CSV');
    const filas = leerCsv(texto);   // sin fotos: upsert_precios conserva las que ya había
    if (filas.length < MINIMO_CSV) throw new Error(`la lista CSV trajo solo ${filas.length} artículos`);
    console.log(`[goicoechea] CSV: ${filas.length} artículos`);
    return [...new Map(filas.map(f => [f.codigo, f])).values()];
  } finally {
    await s.pedir('/account/log/logout').catch(() => {});   // no dejar sesiones abiertas en la cuenta de Daniel
  }
}

await correrScraper('goicoechea', scrape);
