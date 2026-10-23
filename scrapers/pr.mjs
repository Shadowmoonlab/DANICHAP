// pr.mjs — PR Autopartes (prautopartes.com.ar, app Angular con API JSON)
// Login: POST /api/Login/authenticate {user, password} → { token, ... }
// Artículos: POST /api/Articulos/Buscar (Bearer) { idMarcas, idRubros, busqueda, pagina, ... } → { totalPages, currentPage, items }
import { correrScraper, env, numero } from './lib/db.mjs';

const BASE = 'https://prautopartes.com.ar';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PAUSA_MS = 300;   // entre páginas, para no saturar el sitio
const MAX_PAGINAS = 2000;

async function api(ruta, body, token) {
  const res = await fetch(`${BASE}/api/${ruta}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${ruta} HTTP ${res.status}`);
  return res.json();
}

function mapear(it) {
  const fotos = Array.isArray(it.fotos) ? it.fotos : [];
  const foto = fotos[0]?.url ?? fotos[0]?.nombre ?? fotos[0];
  return {
    codigo:       String(it.codigo ?? it.id).trim(),
    descripcion:  String(it.descripciones?.descripcion ?? it.descripcion ?? '').trim(),
    marca:        it.marca || null,
    rubro:        it.rubro || it.rubroDescuento || null,
    origen:       it.origen || null,
    precio_lista: numero(it.precioLista),
    precio_neto:  numero(it.precioCosto),
    imagen_url:   typeof foto === 'string' && foto ? (foto.startsWith('http') ? foto : `${BASE}/Fotos/${foto}`) : null,
  };
}

async function scrape() {
  const login = await api('Login/authenticate', { user: env('PR_USER'), password: env('PR_PASSWORD') });
  if (!login?.token) throw new Error('Login rechazado: revisar PR_USER / PR_PASSWORD');

  const filas = [];
  let pagina = 1, total = 1;
  do {
    const r = await api('Articulos/Buscar', {
      idMarcas: 0, idRubros: 0, busqueda: '', pagina,
      isNovedades: false, isOfertas: false, equivalencia: '',
    }, login.token);
    if (pagina === 1) {
      if (!Array.isArray(r?.items)) throw new Error(`Articulos/Buscar: formato inesperado ${JSON.stringify(r).slice(0, 300)}`);
      console.log('[pr] ejemplo de artículo:', JSON.stringify(r.items[0]).slice(0, 600));
    }
    total = r.totalPages ?? total;
    filas.push(...r.items.map(mapear));
    pagina++;
    await new Promise(ok => setTimeout(ok, PAUSA_MS));
  } while (pagina <= total && pagina <= MAX_PAGINAS);

  // Un mismo código puede repetirse entre páginas: me quedo con el último
  return [...new Map(filas.filter(f => f.codigo).map(f => [f.codigo, f])).values()];
}

await correrScraper('prautopartes', scrape);
