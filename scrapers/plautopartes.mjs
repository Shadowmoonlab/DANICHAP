// plautopartes.mjs — PL Autopartes (pl-autopartes.rdi.store, tienda armada en la plataforma RediRedi)
// La vitrina es pública: no hay login. La web pide los productos a la API de RediRedi con el id de la tienda
// en el encabezado X-RR-Store-ID: GET /inventory/storefront/v2/items?sortBy=title.asc&perPage=100&page=N
// → { data: [{ title, sku, category.name, brand, baseVariant.price.amount, pictures[] }], meta: { total } } (~410 artículos).
// precio_lista = el que muestra la tienda (en pesos); precio_neto = con el descuento de cliente de Daniel.
import { correrScraper } from './lib/db.mjs';

const API = 'https://api.rediredi.com';
const TIENDA = '29645753-b33c-4379-a6f5-729595fac8ce';   // id público de la tienda (viene en el HTML de la web)
const POR_PAGINA = 100;
const MINIMO = 200;
const DESCUENTO = 0.10;   // Daniel tiene 10% de descuento en la tienda (12/11): su costo es lista − 10%   // si trae menos, algo cambió en la API: mejor fallar que borrar media lista

async function pagina(n) {
  const qs = new URLSearchParams({ sortBy: 'title.asc', perPage: String(POR_PAGINA), page: String(n), query: '' });
  const res = await fetch(`${API}/inventory/storefront/v2/items?${qs}`, {
    headers: { 'X-RR-Store-ID': TIENDA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`API de RediRedi: HTTP ${res.status} en la página ${n}`);
  return res.json();
}

/** Una fila por artículo, en el formato de correrScraper. */
export function filaDe(it) {
  const v = it.baseVariant ?? {};
  const precio = Number(v.price?.amount);
  return {
    codigo: (v.sku || it.id || '').trim(),
    descripcion: (v.title || it.title || '').replace(/\s+/g, ' ').trim(),
    marca: (it.brand || '').trim() || null,
    rubro: it.category?.name?.trim() || null,
    origen: null,
    precio_lista: precio > 0 ? precio : null,
    precio_neto: precio > 0 ? Math.round(precio * (1 - DESCUENTO) * 100) / 100 : null,
    imagen_url: it.pictures?.[0] || v.pictures?.[0] || null,
  };
}

async function scrape() {
  const primera = await pagina(1);
  const total = Number(primera.meta?.total) || 0;
  const items = [...(primera.data ?? [])];
  for (let n = 2; items.length < total && n <= Math.ceil(total / POR_PAGINA) + 1; n++) {
    const r = await pagina(n);
    if (!r.data?.length) break;
    items.push(...r.data);
  }
  console.log(`[plautopartes] ${items.length} de ${total} artículos`);
  // Lectura cortada (faltan más del 5%) o una API que de golpe informa muy pocos artículos: mejor fallar que borrar media lista
  if (total < MINIMO) throw new Error(`La tienda informa solo ${total} artículos (antes eran más de ${MINIMO})`);
  if (items.length < total * 0.95) throw new Error(`Solo llegaron ${items.length} de ${total} artículos`);
  const filas = items.map(filaDe).filter(f => f.codigo && f.descripcion);
  return [...new Map(filas.map(f => [f.codigo, f])).values()];
}

if (process.env.PL_SOLO_FUNCIONES !== '1') await correrScraper('plautopartes', scrape);
