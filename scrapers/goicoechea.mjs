// goicoechea.mjs — Goicoechea Hnos. (goicoechea.com.ar, PHP + jQuery, ~70.000 artículos)
// Login:     POST /account/log/login  (username, password, remember)  → {"success":true}
// Artículos: POST /account/products/searcherTextProducts/?pageNumber=N  → { full_row_amount, list: [...] }
// Cada artículo trae el precio de lista y PRICE_WITH_DISCOUNT (ya con el descuento de cliente de Daniel).
import { correrScraper, env, numero } from './lib/db.mjs';
import { crearSesion, enParalelo } from './lib/sesion.mjs';

const BASE = 'https://goicoechea.com.ar';
const AJAX = { 'X-Requested-With': 'XMLHttpRequest' };
const SIMULTANEOS = 4;   // páginas pedidas a la vez: rápido sin saturar el sitio

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

async function scrape() {
  const s = crearSesion(BASE);
  await s.pedir('/');
  const login = await s.json('/account/log/login', { method: 'POST', headers: AJAX,
    form: { username: env('GOICOECHEA_USER'), password: env('GOICOECHEA_PASSWORD'), remember: 'true' } });
  if (login?.success !== true) {
    const motivo = String(login?.message ?? login?.error ?? login?.msg ?? '').slice(0, 120);
    throw new Error(`Login rechazado${motivo ? ` ("${motivo}")` : ''}: revisar GOICOECHEA_USER / GOICOECHEA_PASSWORD`);
  }

  const pagina = n => s.json(`/account/products/searcherTextProducts/?order=&pageNumber=${n}`,
    { method: 'POST', headers: AJAX, form: { all_words: '1', fromUser: 'FALSE' } });

  const primera = await pagina(1);
  if (!Array.isArray(primera?.list)) throw new Error('searcherTextProducts: formato inesperado');
  const total = Number(primera.full_row_amount?.full_row_amount) || primera.list.length;
  const paginas = Math.ceil(total / Math.max(primera.list.length, 1));
  console.log(`[goicoechea] ${total} artículos en ${paginas} páginas`);

  const resto = await enParalelo(Array.from({ length: paginas - 1 }, (_, i) => i + 2), SIMULTANEOS, async n => {
    const r = await pagina(n);
    if (n % 250 === 0) console.log(`[goicoechea] página ${n}/${paginas}`);
    return r.list ?? [];
  });
  const filas = [primera.list, ...resto].flat().map(mapear).filter(f => f.codigo && f.descripcion);
  return [...new Map(filas.map(f => [f.codigo, f])).values()];
}

await correrScraper('goicoechea', scrape);
