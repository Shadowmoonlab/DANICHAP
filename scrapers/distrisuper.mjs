// distrisuper.mjs — Distrisuper "Lupa" (lupa.distrisuper.com, Next.js, ~25.000 artículos)
// Login:     POST https://apidistri.distrisuper.com/api/auth/login {email: nº de cliente, password} → access_token
// Artículos: GET  https://api-lupa.uc.r.appspot.com/lupa/articles?page=N (Bearer) → { data, hasMore, totalArticles }
// Descuentos del cliente: GET /lupa/clients?particularCode=… → general_discount + descuento por marca.
import { correrScraper, env, numero } from './lib/db.mjs';
import { UA, enParalelo } from './lib/sesion.mjs';

const AUTH = 'https://apidistri.distrisuper.com';
const API = 'https://api-lupa.uc.r.appspot.com/lupa';
const SIMULTANEOS = 12;
const POR_PAGINA = 500;   // la API acepta limit (por defecto 10): 25.000 artículos en ~50 pedidos

async function pedir(url, { token, method = 'GET', json, intentos = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { method, headers: {
        'User-Agent': UA, Accept: 'application/json',
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, body: json ? JSON.stringify(json) : undefined });
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`${url} HTTP ${res.status}`), { final: true });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.final || i >= intentos) throw err;
      await new Promise(ok => setTimeout(ok, 2000 * i));
    }
  }
}

async function scrape() {
  const usuario = env('DISTRISUPER_USER');
  // Solo un 401/403 es clave mal; una caída del sitio (5xx, red) sale tal cual y se reintenta más tarde
  const login = await pedir(`${AUTH}/api/auth/login`, { method: 'POST', json: { email: usuario, password: env('DISTRISUPER_PASSWORD') } })
    .catch(err => { if (/HTTP (401|403)/.test(err.message)) return null; throw err; });
  const token = login?.access_token;
  if (!token) throw new Error('Login rechazado: revisar DISTRISUPER_USER / DISTRISUPER_PASSWORD');

  // Descuentos del cliente, nombres de rubro y la 1ª página, a la vez
  const url = n => `${API}/articles?search=&page=${n}&rubroCodes=&brandCar=&modelCar=&brandCodes=&limit=${POR_PAGINA}`;
  const [cli, superRubros, primera] = await Promise.all([
    pedir(`${API}/clients?particularCode=${encodeURIComponent(usuario)}`, { token }).catch(() => null),
    pedir(`${API}/articles/getSuperRubros`, { token }).catch(() => null),
    pedir(url(1), { token }),
  ]);

  // Descuento del cliente: el de la marca si tiene uno propio, si no el general
  const c = Array.isArray(cli?.data) ? cli.data[0] : (cli?.data ?? cli);
  const general = numero(c?.general_discount) ?? 0;
  const porMarca = new Map((c?.BrandClientsDiscounts ?? []).map(d => [String(d.brand_code), numero(d.percentage)]));
  console.log(`[distrisuper] descuento general ${general}%, ${porMarca.size} marcas con descuento propio`);

  // Nombre de rubro: los artículos traen solo el código ("00109"); getSuperRubros agrupa códigos con nombre
  const nombreRubro = new Map();
  for (const sr of (superRubros?.data ?? superRubros ?? [])) for (const cod of sr.RUBROS ?? []) nombreRubro.set(cod, sr.DESCRIPCION);

  if (!Array.isArray(primera?.data)) throw new Error('lupa/articles: formato inesperado');
  if (primera.canViewPrices === false) throw new Error('La cuenta no tiene permiso para ver precios');
  const porPagina = Math.max(primera.data.length, 1);
  const paginas = Math.ceil((Number(primera.totalArticles) || porPagina) / porPagina);
  console.log(`[distrisuper] ${primera.totalArticles} artículos en ${paginas} páginas`);

  const resto = await enParalelo(Array.from({ length: paginas - 1 }, (_, i) => i + 2), SIMULTANEOS, async n => {
    const r = await pedir(url(n), { token });
    if (n % 10 === 0) console.log(`[distrisuper] página ${n}/${paginas}`);
    return r.data ?? [];
  });

  const filas = [primera.data, ...resto].flat().filter(a => a.active !== 0).map(a => {
    const lista = numero(a.price_list);
    const desc = porMarca.get(String(a.brand_code)) ?? general;
    return {
      codigo:       String(a.particular_code || a.article_code).trim(),
      descripcion:  String(a.description ?? '').trim(),
      marca:        a.Brand?.brand_name || null,
      rubro:        nombreRubro.get(a.rubro_code) || a.rubro_code || null,
      origen:       null,
      precio_lista: lista,
      precio_neto:  lista == null ? null : Math.round(lista * (1 - desc / 100) * 100) / 100,
      imagen_url:   a.url_photo || null,
    };
  }).filter(f => f.codigo && f.descripcion);
  return [...new Map(filas.map(f => [f.codigo, f])).values()];
}

await correrScraper('distrisuper', scrape);
