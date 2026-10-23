// dm.mjs — DM Distribuidora (dmcompras.com)
// Login: GET /login?cod=<email>&cod2=<clave> → cookie "id"
// Catálogo completo: GET /getProductos → JSON (doblemente codificado) { data: [[...26 columnas]] }
import { correrScraper, env, numero } from './lib/db.mjs';

const BASE = 'https://dmcompras.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Columnas de cada fila de /getProductos (ver js/productos.js del sitio)
const COL = { codigo: 0, descripcion: 1, origen: 2, lista: 3, rubro: 4, marca: 5, imagenes: 9, venta: 14, neto: 15, segunda: 23, serie: 24 };

// Los artículos de "segunda" (outlet con fallas) repiten el código del nuevo: se distinguen por serie
function codigoDe(f) {
  const codigo = String(f[COL.codigo]).trim();
  return f[COL.segunda] === 'essegunda' ? `${codigo}#${f[COL.serie]}` : codigo;
}

async function login() {
  const qs = new URLSearchParams({ cod: env('DM_EMAIL'), cod2: env('DM_PASSWORD') });
  // DM_COOKIE_ID (opcional): cookie "id" de un navegador ya activado, por si DM exige el equipo registrado
  const headers = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' };
  if (process.env.DM_COOKIE_ID) headers.Cookie = `id=${process.env.DM_COOKIE_ID}`;

  const res = await fetch(`${BASE}/login?${qs}`, { headers });
  const cuerpo = (await res.text()).trim();
  if (!res.ok || cuerpo === '' || cuerpo === '0') {
    throw new Error(`Login rechazado (HTTP ${res.status}). Revisar DM_EMAIL / DM_PASSWORD o activar el equipo (DM_COOKIE_ID).`);
  }

  const cookies = res.headers.getSetCookie().map(c => c.split(';')[0]);
  if (!cookies.some(c => c.startsWith('id=')) && process.env.DM_COOKIE_ID) {
    cookies.push(`id=${process.env.DM_COOKIE_ID}`);
  }
  if (cookies.length === 0) throw new Error('Login sin cookie de sesión');
  return cookies.join('; ');
}

async function scrape() {
  const cookie = await login();
  const res = await fetch(`${BASE}/getProductos`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Cookie: cookie },
  });
  if (!res.ok) throw new Error(`getProductos HTTP ${res.status}`);

  let json = JSON.parse(await res.text());
  if (typeof json === 'string') json = JSON.parse(json);
  if (!Array.isArray(json?.data)) throw new Error('getProductos: formato inesperado (¿sesión vencida?)');

  return json.data
    .filter(f => Array.isArray(f) && f[COL.codigo])
    .map(f => ({
      codigo:       codigoDe(f),
      descripcion:  String(f[COL.descripcion] ?? '').trim(),
      marca:        f[COL.marca] || null,
      rubro:        f[COL.rubro] || null,
      origen:       f[COL.origen] || null,
      precio_lista: numero(f[COL.lista]),
      precio_neto:  numero(f[COL.neto]),
      imagen_url:   Array.isArray(f[COL.imagenes]) ? (f[COL.imagenes][0] || null) : null,
    }));
}

await correrScraper('dm', scrape);
