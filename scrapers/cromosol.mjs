// cromosol.mjs — Grupo Cromosol "Sla Web" (slaweb.cromosol.com, Spring + buscador Fess/Elasticsearch, ~187.000 aplicaciones)
// Solo HTTP: el lado HTTPS del sitio queda colgado. Con fetch común anda desde GitHub (lo que fallaba era Chrome headless,
//        que bloqueaba las páginas http con ERR_BLOCKED_BY_CLIENT).
// Login: GET /login (cookie de sesión) y POST /login form-urlencoded username, password, remember-me=on (Spring Security:
//        el formulario no tiene CSRF ni campos ocultos). Si rechaza vuelve a /login?error; si entra redirige a /.
// Lista: GET /api/products?page=N&size=S&sort=codeSort,asc (sin sesión responde 302 a /login) → { total, hits: [{ _source }] }.
//        Cada hit es una APLICACIÓN (código × vehículo): el mismo código se repite por cada modelo, así que se agrupa por
//        código y los vehículos distintos se suman al nombre. La web pagina de a 36; se prueba primero un size grande.
// Precio: precio_neto = priceNet, el "Precio Neto" que la ficha del producto muestra al cliente logueado (igual a priceListOne,
//        el "Precio de lista": en Mi cuenta la cuenta Cromosol tiene Descuento 0 % y Bonificación 0 %).
//        formatClientFinalPrice = neto × (1 + Rentabilidad 50 % que carga el cliente) es el precio de venta sugerido, y
//        priceLists {"51": …} es otra lista (entre +5 % y +23 %) que la web no muestra en ningún lado: no se usan.
// Fotos: solo hay links firmados de S3 que vencen a los 30 s (imagePreSigned): no se guardan.
import { correrScraper, env, numero, esErrorDefinitivo } from './lib/db.mjs';
import { crearSesion, enParalelo } from './lib/sesion.mjs';

const BASE = 'http://slaweb.cromosol.com';
const API = { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' };
const TAMANIOS = [500, 200, 108, 36];   // 36/72/108 son los que ofrece la web; si no acepta uno grande se baja
const SIMULTANEOS = 4;
const INTENTOS_PAGINA = 3;
const NOMBRE_MAX = 200;
// En la muestra (página 0) 36 aplicaciones eran 25 códigos (0,69). Se exige mucho menos (0,15) por si en otras partes
// del catálogo cada código tiene más vehículos, y nunca menos de 20.000 códigos.
const MINIMO_CODIGOS = 20_000;
const MINIMO_POR_APLICACION = 0.15;
const MINIMO_LEIDO = 0.98;   // aplicaciones leídas / total que informa la API (el índice se rehace a diario: margen chico)
const esperar = ms => new Promise(ok => setTimeout(ok, ms));
// Errores que no se arreglan reintentando (clave, cuenta, el sitio pidiendo bajar el ritmo, sesión que no se sostiene).
// Se repite el patrón de esErrorDefinitivo de db.mjs porque ahí la regex quedó con un carácter de control y no reconoce 401/403/429.
const esDefinitivo = err => esErrorDefinitivo(err) || err?.definitivo === true || /HTTP (401|403|429)(\D|$)/.test(err?.message ?? '');

const limpiar = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const texto = v => { const t = limpiar(v); return /^(0|null|undefined|-)?$/i.test(t) ? '' : t; };
const norm = s => s.toLocaleLowerCase('es');
const empiezaCon = (a, b) => norm(a).startsWith(norm(b));

/** Total de la respuesta: número (formato Fess de este sitio) o { value } (Elasticsearch 7+). */
export function totalDe(r) {
  const t = Number(typeof r?.total === 'object' ? r.total?.value : r?.total);
  return Number.isFinite(t) && t >= 0 ? t : null;
}

const aPrecio = (v, formato) => {
  const n = Number(v);
  if (v != null && v !== '' && Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  const f = numero(formato);   // "$7.393,55"
  return f != null && f > 0 ? f : null;
};

/** Precios de un _source: neto = priceNet ("Precio Neto" de la web), lista = priceListOne ("Precio de lista"). */
export function preciosDe(s) {
  const neto = aPrecio(s?.priceNet, s?.formatPriceNet);
  const lista = aPrecio(s?.priceListOne ?? s?.priceList, s?.formatPriceList);
  return { precio_lista: lista ?? neto, precio_neto: neto };
}

/** Vehículo de una aplicación sin la marca: "P.UP D-100 Sweptline 56/61" (version suele traer modelo + años). */
export function vehiculoDe(s) {
  const modelo = texto(s?.model), version = texto(s?.version);
  if (!version) return modelo;
  if (!modelo || norm(version).includes(norm(modelo))) return version;
  return `${modelo} ${version}`;
}

/** Datos de una aplicación que hacen falta para el nombre (se guarda esto y no el hit entero: son ~187.000). */
function aplicacionDe(s) {
  return {
    rubro: texto(s.line), adicional: texto(s.additionalDescription), lado: texto(s.side), posicion: texto(s.position),
    marcaVehiculo: texto(s.vehicleBrand), vehiculo: vehiculoDe(s), descripcion: texto(s.description) || texto(s.descriptionForTooltip),
  };
}

/**
 * Nombre buscable de un código a partir de sus aplicaciones: rubro + adicional + lado/posición + vehículos por marca.
 * "Casco de optica Base Delantero Dodge P.UP D-100 Sweptline 56/61, P.UP D-100 61/65 y 1 más" (hasta ~200 caracteres).
 */
export function armarNombre(apps, codigo = '', max = NOMBRE_MAX) {
  const vistos = new Set();
  const cabeza = [];
  for (const campo of ['rubro', 'adicional', 'lado', 'posicion']) {
    for (const a of apps) {
      const v = a[campo];
      if (v && !vistos.has(norm(v))) { vistos.add(norm(v)); cabeza.push(v); }
    }
  }
  const porMarca = new Map();
  for (const a of apps) {
    if (!a.marcaVehiculo && !a.vehiculo) continue;
    if (!porMarca.has(a.marcaVehiculo)) porMarca.set(a.marcaVehiculo, new Set());
    if (a.vehiculo) porMarca.get(a.marcaVehiculo).add(a.vehiculo);
  }
  // Piezas en orden: cada vehículo lleva delante la marca (la primera vez) o la coma; "Universal Livianos" no repite "Universal"
  const piezas = [];
  for (const [marca, vehiculos] of porMarca) {
    const lista = [...vehiculos];
    if (!lista.length) { piezas.push({ sep: piezas.length ? '; ' : ' ', txt: marca }); continue; }
    lista.forEach((v, i) => {
      const conMarca = marca && !empiezaCon(v, marca) ? `${marca} ${v}` : v;
      piezas.push(i === 0 ? { sep: piezas.length ? '; ' : ' ', txt: conMarca } : { sep: ', ', txt: v });
    });
  }
  let nombre = cabeza.join(' ');
  if (!cabeza.length) nombre = apps.find(a => a.descripcion)?.descripcion ?? '';
  if (!cabeza.length && nombre) piezas.length = 0;   // sin rubro: la descripción del sitio ya trae el vehículo
  nombre = nombre.slice(0, max);
  for (let i = 0; i < piezas.length; i++) {
    const resto = piezas.length - i - 1;
    const agregado = (nombre ? piezas[i].sep : '') + piezas[i].txt;
    const cola = resto ? ` y ${resto} más`.length : 0;
    if ((nombre + agregado).length + cola > max) {
      if (i > 0) nombre += ` y ${piezas.length - i} más`;
      else nombre = (nombre + agregado).slice(0, max).trim();
      break;
    }
    nombre += agregado;
  }
  nombre = limpiar(nombre);
  return nombre && norm(nombre) !== norm(limpiar(codigo)) ? nombre : '';
}

/** Suma los hits de una página al mapa código → { fuente (1er hit), apps, precios distintos }. */
export function agruparHits(hits, porCodigo = new Map()) {
  for (const h of hits ?? []) {
    const s = h?._source ?? h;
    const codigo = limpiar(s?.code);
    if (!codigo) continue;
    let g = porCodigo.get(codigo);
    if (!g) porCodigo.set(codigo, g = { fuente: s, apps: [], precios: new Set() });
    g.apps.push(aplicacionDe(s));
    const neto = preciosDe(s).precio_neto;
    if (neto != null) g.precios.add(neto);
  }
  return porCodigo;
}

/** Una fila por código, en el formato de correrScraper. */
export function filasDe(porCodigo) {
  return [...porCodigo].map(([codigo, g]) => ({
    codigo,
    descripcion:  armarNombre(g.apps, codigo),   // vacío → correrScraper lo marca "Sin descripción" y avisa
    marca:        texto(g.fuente.providerBrand) || null,
    rubro:        texto(g.fuente.line) || null,
    origen:       null,
    ...preciosDe(g.fuente),
    imagen_url:   null,
  }));
}

/**
 * Recorre /api/products. `pedirPagina(page, size)` devuelve { total, hits }. Prueba los tamaños de mayor a menor y usa el
 * primero que el servidor respeta (hits.length = min(size, total)); si recorta a otro número, prueba ese. Después pide las
 * páginas 1…⌈total/size⌉−1 de a `simultaneos`, con reintentos; una página vacía antes del final corta el recorrido.
 */
export async function recorrerCatalogo(pedirPagina, { tamanios = TAMANIOS, simultaneos = SIMULTANEOS, alHits = () => {},
  intentos = INTENTOS_PAGINA, esperaMs = 3000, log = console.log, limite = Infinity, soloSondear = false, previa = null } = {}) {
  const conReintento = async (page, size) => {
    for (let i = 1; ; i++) {
      try {
        const r = await pedirPagina(page, size);
        if (!Array.isArray(r?.hits)) throw new Error(`/api/products página ${page}: formato inesperado (sin hits)`);
        return r;
      } catch (err) {
        if (i >= intentos || esDefinitivo(err)) throw err;
        await esperar(esperaMs * i);
      }
    }
  };

  let size = previa?.size ?? null, primera = previa?.primera ?? null, total = previa?.total ?? null;
  const pendientes = previa ? [] : [...tamanios];
  while (pendientes.length && !size) {
    const t = pendientes.shift();
    let r;
    try { r = await conReintento(0, t); } catch (err) {
      if (esDefinitivo(err)) throw err;
      log(`[cromosol] size=${t} falló (${err.message}): pruebo uno menor`);
      continue;
    }
    total = totalDe(r);
    if (total == null) throw new Error('/api/products no informa el total');
    const n = r.hits.length;
    if (n === Math.min(t, total)) { size = t; primera = r; break; }
    log(`[cromosol] size=${t}: el servidor devolvió ${n} de ${total}`);
    const minimo = Math.min(...tamanios);
    if (n > minimo && n < t && !pendientes.includes(n)) pendientes.unshift(n);   // el tope real del servidor
  }
  if (!size) throw new Error('/api/products no devolvió una primera página válida con ningún tamaño');
  if (soloSondear) return { total, size, primera };

  const paginas = Math.max(1, Math.ceil(Math.min(total, limite) / size));
  if (!previa) log(`[cromosol] ${total} aplicaciones, size=${size}: ${paginas} páginas`);
  let leidos = primera.hits.length, corte = null;
  alHits(primera.hits, 0);
  const resto = Array.from({ length: paginas - 1 }, (_, i) => i + 1);
  await enParalelo(resto, simultaneos, async page => {
    if (corte != null && page > corte) return;   // ya vino una vacía: lo que sigue también
    const r = await conReintento(page, size);
    if (!r.hits.length) { corte = Math.min(corte ?? Infinity, page); return; }
    leidos += r.hits.length;
    alHits(r.hits, page);
    if (page % 50 === 0) log(`[cromosol] página ${page}/${paginas}`);
  });
  return { total, size, paginas, leidos, corte };
}

// El buscador (Elasticsearch) no pagina más allá de 10.000 resultados por búsqueda: con size 500 la página 21 da HTTP 500
// (03/11). Por eso el catálogo (~187.000 aplicaciones) se pide línea por línea, y una línea que sola pase el tope, por marca.
export const LIMITE_VENTANA = 10_000;

const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í',
  oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü' };
const decodificar = s => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10))
  : ENTIDADES[e] ?? m);

/** Valores de un <select name="…"> de la página /products (filtros de línea y marca de vehículo), sin la opción vacía. */
export function opcionesDe(html, nombre) {
  const m = new RegExp(`<select[^>]*name="${nombre}"[^>]*>([\\s\\S]*?)</select>`).exec(html ?? '');
  if (!m) return [];
  return [...new Set([...m[1].matchAll(/<option[^>]*value="([^"]*)"/g)].map(x => limpiar(decodificar(x[1]))).filter(Boolean))];
}

/**
 * Recorre todo el catálogo respetando el tope de 10.000 por búsqueda. `pedir(page, size, filtro)`; filtro es '' o
 * 'filters[line]=…&' (+ 'filters[vehicleBrand]=…&'). Si el total entra en una búsqueda, la lee entera de una.
 */
export async function recorrerPorTramos(pedir, { lineas = [], marcas = [], alHits = () => {}, log = console.log,
  limite = LIMITE_VENTANA, ...op } = {}) {
  const sonda = await recorrerCatalogo((p, s) => pedir(p, s, ''), { ...op, log, soloSondear: true });
  const { total, size } = sonda;
  if (total <= limite) {
    const r = await recorrerCatalogo((p, s) => pedir(p, s, ''), { ...op, log, alHits, previa: sonda });
    return { ...r, tramos: 1, recortados: [] };
  }
  if (!lineas.length) throw new Error(`${total} aplicaciones pasan el tope de ${limite} por búsqueda y no encontré la lista de líneas para partirla`);
  log(`[cromosol] ${total} aplicaciones (más de ${limite} por búsqueda): las pido por línea (${lineas.length}), size=${size}`);

  const q = (campo, v) => `filters[${campo}]=${encodeURIComponent(v)}&`;
  let leidos = 0, tramos = 0, filtroProbado = false;
  const recortados = [];
  const leerTramo = async (filtro, etiqueta, alPasarse) => {
    const s = await recorrerCatalogo((p, t) => pedir(p, t, filtro), { ...op, log, tamanios: [size], soloSondear: true });
    tramos++;
    if (!filtroProbado) {
      // Si el filtro no hiciera nada, cada "línea" traería el catálogo entero (y repetido): mejor cortar con un error claro
      if (s.total === total) throw new Error(`el filtro por línea no filtra (${etiqueta} trae las ${total} aplicaciones)`);
      filtroProbado = true;
    }
    if (!s.total) return;
    if (s.total > limite && alPasarse) return alPasarse(s.total);
    if (s.total > limite) recortados.push(`${etiqueta} (${s.total})`);
    const r = await recorrerCatalogo((p, t) => pedir(p, t, filtro), { ...op, log, alHits, previa: s, limite });
    leidos += r.leidos;
  };

  let hechas = 0;
  for (const linea of lineas) {
    await leerTramo(q('line', linea), linea, async n => {
      log(`[cromosol] la línea "${linea}" tiene ${n}: la parto por marca de vehículo`);
      for (const marca of marcas) await leerTramo(q('line', linea) + q('vehicleBrand', marca), `${linea} / ${marca}`);
    });
    if (++hechas % 50 === 0) log(`[cromosol] líneas ${hechas}/${lineas.length}: ${leidos} aplicaciones leídas`);
  }
  if (recortados.length) log(`[cromosol] AVISO: quedaron recortados en ${limite}: ${recortados.join(', ')}`);
  return { total, size, paginas: tramos, leidos, corte: null, tramos, recortados };
}

/** Controles antes de guardar: que se haya leído casi todo y que haya códigos suficientes. */
export function controlar({ total, leidos, corte, codigos }) {
  if (leidos < total * MINIMO_LEIDO) {
    throw new Error(`lectura cortada: ${leidos} de ${total} aplicaciones${corte != null ? ` (página ${corte} vacía)` : ''}`);
  }
  const minimo = Math.max(MINIMO_CODIGOS, Math.round(total * MINIMO_POR_APLICACION));
  if (codigos < minimo) throw new Error(`solo ${codigos} códigos únicos en ${total} aplicaciones (mínimo ${minimo})`);
}

async function scrape() {
  const usuario = env('CROMOSOL_USER'), clave = env('CROMOSOL_PASSWORD');
  const s = crearSesion(BASE);
  const urlApi = (page, size, filtro = '') => `/api/products?${filtro}page=${page}&size=${size}&sort=codeSort,asc`;

  // { ok } si la API responde con la sesión; { rechazado } si Spring devolvió al formulario (/login o ?error)
  const entrar = async () => {
    await s.pedir('/login');
    const res = await s.pedir('/login', { method: 'POST', form: { username: usuario, password: clave, 'remember-me': 'on' } });
    await res.arrayBuffer().catch(() => {});
    const destino = new URL(res.url || `${BASE}/login`);
    if (/^\/login\/?$/i.test(destino.pathname) || destino.searchParams.has('error')) return { rechazado: true };
    const prueba = await s.pedir(urlApi(0, 1), { headers: API, redirect: 'manual' });
    await prueba.arrayBuffer().catch(() => {});
    return prueba.ok ? { ok: true } : { motivo: `/api/products HTTP ${prueba.status} después de entrar` };
  };
  // Un segundo intento antes de darlo por rechazado: "Login rechazado" no se reintenta en el día
  let ingreso = await entrar();
  if (!ingreso.ok) {
    console.warn('[cromosol] el ingreso no tomó, pruebo una vez más en 20 s…');
    await esperar(20_000);
    ingreso = await entrar();
  }
  if (ingreso.rechazado) throw new Error('Login rechazado: revisar CROMOSOL_USER / CROMOSOL_PASSWORD');
  if (!ingreso.ok) throw new Error(`El ingreso no habilitó la lista de productos (${ingreso.motivo})`);

  // Si la sesión se corta a mitad del recorrido (302 a /login), se vuelve a entrar (una vez para todos los pedidos en curso)
  let reingreso = null, reingresos = 0;
  const pedirPagina = async (page, size, filtro = '') => {
    for (let vuelta = 0; ; vuelta++) {
      const res = await s.pedir(urlApi(page, size, filtro), { headers: API, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        await res.arrayBuffer().catch(() => {});
        if (vuelta > 0 || (!reingreso && reingresos >= 2)) {
          throw Object.assign(new Error('La sesión de Cromosol se corta (302 a /login) en medio del recorrido'), { definitivo: true });
        }
        if (!reingreso) {
          reingresos++;
          console.warn(`[cromosol] sesión vencida en la página ${page}: vuelvo a entrar`);
          reingreso = entrar().finally(() => { reingreso = null; });
        }
        const r = await reingreso;
        if (r.rechazado) throw new Error('Login rechazado: revisar CROMOSOL_USER / CROMOSOL_PASSWORD');
        continue;
      }
      if (!res.ok) throw new Error(`/api/products?${filtro}page=${page}&size=${size} HTTP ${res.status}`);
      return res.json();
    }
  };

  try {
    const inicio = Date.now();
    const porCodigo = new Map();
    // Líneas y marcas de los filtros de la página de productos (se leen en cada corrida: si Cromosol suma una, entra sola)
    const pagina = await s.texto('/products').catch(() => '');
    const lineas = opcionesDe(pagina, 'line'), marcas = opcionesDe(pagina, 'vehicleBrand');
    console.log(`[cromosol] filtros de la web: ${lineas.length} líneas, ${marcas.length} marcas de vehículo`);
    const lectura = await recorrerPorTramos(pedirPagina, { lineas, marcas, alHits: hits => agruparHits(hits, porCodigo) });
    const filas = filasDe(porCodigo);

    const empresas = new Map();
    let conDescuento = 0, preciosDistintos = 0, sinNombre = 0;
    for (const [, g] of porCodigo) {
      const e = texto(g.fuente.company) || '?';
      empresas.set(e, (empresas.get(e) ?? 0) + 1);
      const p = preciosDe(g.fuente);
      if (p.precio_neto != null && p.precio_lista != null && p.precio_neto < p.precio_lista) conDescuento++;
      if (g.precios.size > 1) preciosDistintos++;
    }
    for (const f of filas) if (!f.descripcion) sinNombre++;
    console.log(`[cromosol] ${lectura.leidos}/${lectura.total} aplicaciones en ${lectura.paginas} páginas de ${lectura.size}`
      + ` → ${filas.length} códigos únicos (${(filas.length / Math.max(lectura.leidos, 1)).toFixed(2)} por aplicación)`
      + ` en ${Math.round((Date.now() - inicio) / 1000)} s`);
    console.log(`[cromosol] por empresa: ${[...empresas].map(([e, n]) => `${e} ${n}`).join(', ')}; neto < lista: ${conDescuento};`
      + ` códigos con precios distintos entre aplicaciones: ${preciosDistintos}; sin nombre: ${sinNombre}`);
    controlar({ ...lectura, codigos: filas.length });
    return filas;
  } finally {
    await s.pedir('/logout').catch(() => {});   // no dejar la sesión abierta en la cuenta de Daniel
  }
}

// Los tests importan las funciones de arriba sin correr el robot (CROMOSOL_SOLO_FUNCIONES=1)
if (process.env.CROMOSOL_SOLO_FUNCIONES !== '1') await correrScraper('cromosol', scrape);
