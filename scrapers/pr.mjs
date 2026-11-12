// pr.mjs — PR Autopartes (prautopartes.com.ar, app Angular con API JSON)
// Login: POST /api/Login/authenticate {user, password} → { token, ... }
// Artículos: POST /api/Articulos/Buscar (Bearer) { idMarcas, idRubros, busqueda, pagina, ... } → { totalPages, currentPage, items }
import { correrScraper, env, numero } from './lib/db.mjs';
import { enParalelo, TIEMPO_MAX_MS } from './lib/sesion.mjs';

const BASE = 'https://prautopartes.com.ar';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SIMULTANEOS = 8;   // páginas a la vez (36 por página, sin opción de más): más pedidos arriesgan que bloqueen la cuenta
const MAX_PAGINAS = 3000;

async function api(ruta, body, token) {
  const res = await fetch(`${BASE}/api/${ruta}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIEMPO_MAX_MS),   // un sitio colgado no traba el robot hasta que GitHub lo corta
  });
  if (!res.ok) throw new Error(`${ruta} HTTP ${res.status}`);
  return res.json();
}

// La descripción viene en distintos lugares según el artículo (texto, objeto o lista): se toma el primero con texto.
// Antes se leía solo descripciones.descripcion y los 28.660 artículos quedaban sin descripción (no se encontraban)
const textoDe = v => {
  if (v == null || v === false) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (Array.isArray(v)) return v.map(textoDe).filter(Boolean).join(' ').trim();
  if (typeof v === 'object') {
    const conocido = textoDe(v.descripcion ?? v.descripcionLarga ?? v.nombre ?? v.texto ?? v.detalle ?? v.valor);
    // Campo con otro nombre: todos sus textos (no números ni códigos sueltos)
    return conocido || Object.values(v).filter(x => typeof x === 'string' && /[a-z]{3}/i.test(x)).map(x => x.trim()).join(' ');
  }
  return '';
};
const descripcionDe = it => [it.descripciones, it.descripcion, it.descripcionLarga, it.descripcionCorta, it.nombre,
  it.detalle, it.titulo, it.aplicacion, it.aplicaciones].map(textoDe).find(Boolean) || '';

function mapear(it) {
  const fotos = Array.isArray(it.fotos) ? it.fotos : [];
  const foto = fotos[0]?.url ?? fotos[0]?.nombre ?? fotos[0];
  return {
    codigo:       String(it.codigo ?? it.id).trim(),
    descripcion:  descripcionDe(it),
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

  // No se confía en el total que informa la API (la 1ª corrida trajo solo 1 página de 36):
  // se piden páginas hasta que vengan vacías o repitan artículos ya vistos.
  const pagina = n => api('Articulos/Buscar', {
    idMarcas: 0, idRubros: 0, busqueda: '', pagina: n,
    isNovedades: false, isOfertas: false, equivalencia: '',
  }, login.token);

  const primera = await pagina(1);
  if (!Array.isArray(primera?.items)) throw new Error(`Articulos/Buscar: formato inesperado ${JSON.stringify(primera).slice(0, 300)}`);
  console.log(`[pr] totalPages informado: ${primera.totalPages}`);
  // Qué campos manda la API (solo los nombres y de qué tipo son: nada de precios ni datos de la cuenta)
  const muestra = primera.items[0] || {};
  console.log(`[pr] campos del artículo: ${Object.entries(muestra).map(([k, v]) => `${k}:${Array.isArray(v) ? 'lista' : typeof v}`).join(', ')}`);
  // Cómo viene la lista "descripciones" y otros textos (nombres de productos, nada de la cuenta ni precios)
  console.log(`[pr] descripciones[0]: ${JSON.stringify(muestra.descripciones?.[0] ?? null).slice(0, 300)}`);
  console.log(`[pr] artprov: ${JSON.stringify(muestra.artprov ?? null).slice(0, 120)} · posicion: ${JSON.stringify(muestra.posicion ?? null)} · equivalencia: ${JSON.stringify(muestra.equivalencia ?? null).slice(0, 120)}`);
  console.log(`[pr] descripción leída del primero: ${JSON.stringify(descripcionDe(muestra)).slice(0, 200)}`);

  const filas = primera.items.map(mapear).filter(f => f.codigo);
  const vistos = new Set(filas.map(f => f.codigo));
  const sumar = items => {
    const nuevas = items.map(mapear).filter(f => f.codigo && !vistos.has(f.codigo));
    nuevas.forEach(f => { vistos.add(f.codigo); filas.push(f); });
    return nuevas.length;
  };

  // Las páginas que informa la API, en paralelo sin esperas entre tandas
  const informadas = Math.min(Number(primera.totalPages) || 1, MAX_PAGINAS);
  const reintentar = n => pagina(n).catch(() => pagina(n));
  await enParalelo(Array.from({ length: informadas - 1 }, (_, i) => i + 2), SIMULTANEOS,
    async n => sumar((await reintentar(n)).items ?? []));
  console.log(`[pr] ${informadas} páginas: ${filas.length} artículos`);

  // Por si la API informa menos páginas de las que tiene: seguir de a tandas hasta que no aparezca nada nuevo
  for (let desde = informadas + 1; desde <= MAX_PAGINAS; desde += SIMULTANEOS) {
    const tanda = await Promise.all(Array.from({ length: SIMULTANEOS }, (_, i) => reintentar(desde + i)));
    if (sumar(tanda.flatMap(r => r.items ?? [])) === 0) break;
  }
  console.log(`[pr] total: ${filas.length} artículos`);

  // Un mismo código puede repetirse entre páginas: me quedo con el último
  return [...new Map(filas.filter(f => f.codigo).map(f => [f.codigo, f])).values()];
}

await correrScraper('prautopartes', scrape);
