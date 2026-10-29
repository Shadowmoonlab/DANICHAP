// goicoechea.mjs — Goicoechea Hnos. (goicoechea.com.ar, PHP + jQuery, ~70.000 artículos)
// Login:  POST /account/log/login  (username, password, remember)  → {"success":true}
// Rápido: GET /account/downloads/exportExcel/8/csv → lista completa del cliente en un solo archivo (separador |),
//         con el precio neto "calculado y actualizado al momento de la descarga" (página Mi cuenta → Descargas).
// Respaldo: POST /account/products/searcherTextProducts/?pageNumber=N (20 por página, ~3.500 páginas) si el CSV falla.
import { correrScraper, env, numero } from './lib/db.mjs';
import { crearSesion, enParalelo } from './lib/sesion.mjs';
import { leerCsv } from './lib/planilla.mjs';

const BASE = 'https://goicoechea.com.ar';
const AJAX = { 'X-Requested-With': 'XMLHttpRequest' };
const SIMULTANEOS = 16;   // solo para el respaldo por páginas
const MINIMO_CSV = 10_000;

function mapear(p) {
  const promo = numero(p.best_discount_price);
  const neto = numero(p.PRICE_WITH_DISCOUNT);
  return {
    codigo:       String(p.prod_mscode).trim(),
    descripcion:  String(p.prod_description ?? '').trim(),
    marca:        p.fam_name || null,
    rubro:        p.lin_name || null,
    origen:       null,
    precio_lista: numero(p.prod_listprice),
    precio_neto:  promo > 0 && (neto == null || promo < neto) ? promo : neto,
    imagen_url:   p.imagesSource?.images?.[0]?.fullpath || null,
  };
}

async function porCsv(s) {
  const archivo = await s.binario('/account/downloads/exportExcel/8/csv');
  let texto = archivo.toString('utf8');
  if (texto.includes('�')) texto = archivo.toString('latin1');
  if (/^\s*<(!doctype|html)/i.test(texto)) throw new Error('el sitio devolvió una página en vez del CSV');
  const filas = leerCsv(texto);   // sin fotos: upsert_precios conserva las que ya había
  if (filas.length < MINIMO_CSV) throw new Error(`CSV con solo ${filas.length} artículos`);
  return filas;
}

async function porPaginas(s) {
  const pagina = n => s.json(`/account/products/searcherTextProducts/?order=&pageNumber=${n}`,
    { method: 'POST', headers: AJAX, form: { all_words: '1', fromUser: 'FALSE' } });

  const primera = await pagina(1);
  if (!Array.isArray(primera?.list)) throw new Error('searcherTextProducts: formato inesperado');
  const total = Number(primera.full_row_amount?.full_row_amount) || primera.list.length;
  const paginas = Math.ceil(total / Math.max(primera.list.length, 1));
  console.log(`[goicoechea] ${total} artículos en ${paginas} páginas`);

  const resto = await enParalelo(Array.from({ length: paginas - 1 }, (_, i) => i + 2), SIMULTANEOS, async n => {
    const r = await pagina(n);
    if (n % 500 === 0) console.log(`[goicoechea] página ${n}/${paginas}`);
    return r.list ?? [];
  });
  return [primera.list, ...resto].flat().map(mapear).filter(f => f.codigo && f.descripcion);
}

async function scrape() {
  const s = crearSesion(BASE);
  await s.pedir('/');
  const login = await s.json('/account/log/login', { method: 'POST', headers: AJAX,
    form: { username: env('GOICOECHEA_USER'), password: env('GOICOECHEA_PASSWORD'), remember: 'true' } });
  if (login?.success !== true) {
    const motivo = String(login?.message ?? login?.error ?? login?.msg ?? '').slice(0, 120);
    throw new Error(`Login rechazado${motivo ? ` ("${motivo}")` : ''}: revisar GOICOECHEA_USER / GOICOECHEA_PASSWORD`);
  }

  let filas;
  try {
    filas = await porCsv(s);
    console.log(`[goicoechea] CSV: ${filas.length} artículos`);
  } catch (e) {
    console.warn(`[goicoechea] CSV no disponible (${e.message}): sigo por páginas`);
    filas = await porPaginas(s);
  }
  return [...new Map(filas.map(f => [f.codigo, f])).values()];
}

await correrScraper('goicoechea', scrape);
