// gestion/core.js — Base compartida del panel: DOM, formato, modal, configuración, proveedores, búsqueda
// Usa los globales de supabase.js (_supabase) y toast.js (showToast), que cargan antes como scripts clásicos.
import { normalizar, normalizarAmbos, palabras, relevancia, coincidePalabras, escaparRegex, esNumero, sinPalabrasVacias, conTodosLosProveedores, separarMarcas, patron } from './texto.js?v=36';

export const db = window._supabase ?? _supabase;
// Avisos del panel: los de éxito duran 4 s (se alcanzan a leer) y los errores quedan hasta cerrarlos
export const toast = (msg, tipo = 'success', duracion) => {
  const t = tipo === 'error' ? 'error' : 'success';
  if (!window.toast?.[t]) return window.showToast(msg, tipo);
  return window.toast[t](msg, { duration: duracion ?? (t === 'error' ? 0 : 4000) });
};

/** Error de la base en palabras de Daniel: qué pasó y qué hacer (el detalle técnico va al final, por las dudas). */
export function errorAmigable(error, queNoSeHizo, queHacer = 'probá de nuevo') {
  const m = String(error?.message ?? error ?? '');
  if (/failed to fetch|network|load failed|conexi/i.test(m)) return `${queNoSeHizo}: no hay internet. Revisá la conexión y ${queHacer}.`;
  if (/jwt|token|sesi[oó]n/i.test(m)) return `${queNoSeHizo}: se venció la sesión. Volvé a entrar y ${queHacer}.`;
  return `${queNoSeHizo}. ${queHacer[0].toUpperCase()}${queHacer.slice(1)}; si sigue pasando, avisá (detalle: ${m.slice(0, 120)})`;
}
export const $ = id => document.getElementById(id);

/* ── DOM sin innerHTML (los datos vienen de distribuidores y usuarios: nunca HTML) ── */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else if (k === 'style') el.style.cssText = v;   // CSSOM: permitido por la CSP de _headers (el atributo style no)
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const icon = name => h('span', { class: 'ms', 'aria-hidden': 'true' }, name);
export const vacio = (ic, ...texto) => h('div', { class: 'empty' }, icon(ic), ...texto);

/* ── Formato ─────────────────────────────────────────────────────────── */
const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const money = n => fmt.format(Math.round(Number(n) || 0));
export const fecha = iso => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// "2026-10-23" (solo fecha) se interpreta como día local: new Date() lo tomaría en UTC y en Argentina mostraría el 22
const aFecha = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v));
export const fechaCorta = iso => aFecha(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
export const hoyISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const PAGOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', debito: 'Débito', credito: 'Crédito', cuenta_corriente: 'Cuenta corriente' };
export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ── Modal genérico ──────────────────────────────────────────────────── */
// Si el diálogo se cierra con Esc, la X o tocando afuera, el que esperaba una respuesta recibe "cancelar"
// (si no, la promesa no terminaba nunca y un botón con unaVez quedaba trabado hasta recargar).
let alCerrar = null;
// Mientras se importa una lista la ventana no se cierra (Esc, la X o tocar afuera): se vería que se cortó y no
let modalBloqueado = false;
export function bloquearModal(si) {
  modalBloqueado = si;
  $('modal-close').disabled = si;
}
export function openModal({ title, body, foot = [], wide = false, onClose = null }) {
  bloquearModal(false);
  const anterior = alCerrar; alCerrar = onClose;
  anterior?.();   // un diálogo que reemplaza a otro cancela al anterior
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(body);
  $('modal-foot').replaceChildren(...foot.filter(Boolean));
  $('modal-foot').classList.toggle('hidden', foot.filter(Boolean).length === 0);
  $('modal').classList.toggle('wide', wide);
  $('modal-bg').classList.remove('hidden');
}
export function closeModal(forzar) {
  if (modalBloqueado && forzar !== true) return;
  $('modal-bg').classList.add('hidden');
  const f = alCerrar; alCerrar = null; f?.();
}
export const modalAbierto = () => !$('modal-bg').classList.contains('hidden');

/** Diálogo de confirmación propio (confirm() nativo se bloquea en algunos contextos). */
export function confirmar(titulo, texto, { ok = 'Confirmar', peligro = false } = {}) {
  return new Promise(resolve => {
    const cerrar = v => { resolve(v); closeModal(); };   // resolve primero: el onClose de abajo ya no cambia nada
    openModal({
      title: titulo, onClose: () => resolve(false),
      body: h('p', { style: 'margin:0;font-size:15px' }, texto),
      foot: [h('button', { class: 'btn', onclick: () => cerrar(false) }, 'Cancelar'),
             h('button', { class: `btn ${peligro ? 'btn-danger' : 'btn-primary'}`, onclick: () => cerrar(true) }, ok)],
    });
  });
}

/** Pide un número con un diálogo propio. Devuelve null si cancela. */
export function pedirNumero(titulo, etiqueta, inicial = 1) {
  return new Promise(resolve => {
    const input = h('input', { class: 'input', type: 'number', min: 1, value: inicial, inputmode: 'numeric' });
    const cerrar = v => { resolve(v); closeModal(); };
    const aceptar = () => { const n = parseInt(input.value, 10); cerrar(n > 0 ? n : null); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') aceptar(); });
    openModal({
      title: titulo, onClose: () => resolve(null),
      body: h('div', { class: 'field' }, h('label', { class: 'label' }, etiqueta), input),
      foot: [h('button', { class: 'btn', onclick: () => cerrar(null) }, 'Cancelar'),
             h('button', { class: 'btn btn-primary', onclick: aceptar }, 'Aceptar')],
    });
    setTimeout(() => input.select(), 0);
  });
}

/* ── Estado compartido ───────────────────────────────────────────────── */
export const estado = {
  config: { ganancia_pct: 82, ganancias_distribuidor: {}, redondeo: 1, nombre_negocio: 'DANICHAP',
            leyenda_comprobante: 'Documento no válido como factura' },
  proveedores: [],   // filas de la tabla proveedores
  clientes: [],      // filas de clientes_resumen
};

export async function cargarConfig() {
  const { data, error } = await db.from('config_negocio').select('*').eq('id', 1).maybeSingle();
  if (error) { console.warn('[gestion] config:', error.message); toast('Falta correr los SQL de gestión en Supabase', 'error'); return; }
  if (data) estado.config = data;
}

export async function cargarProveedores() {
  const { data, error } = await db.from('proveedores').select('*').order('orden').order('nombre');
  if (error) { console.warn('[gestion] proveedores:', error.message); return; }
  estado.proveedores = data;
  // Último mes con precios buenos (robot o lista importada): el mes de la lista si el proveedor no tiene lista_mes
  const { data: runs } = await db.from('scraper_runs').select('distribuidor, inicio').eq('ok', true)
    .order('inicio', { ascending: false }).limit(400);
  estado.ultimaCarga = {};
  for (const r of runs || []) estado.ultimaCarga[r.distribuidor] ??= r.inicio;
}
export const proveedor = slug => estado.proveedores.find(p => p.slug === slug);
export const nombreProveedor = slug => proveedor(slug)?.nombre || slug;
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/**
 * De cuándo son los precios de un proveedor, para verlo en cada resultado:
 * - lista cargada a mano (lista_mes, docs/gestion-v7.sql): "lista ago 2026", vieja con 2 meses o más;
 * - robot diario (sin lista_mes): "precios del 29/10" según la última corrida buena, viejo con más de 2 días
 *   (si el robot falla, Daniel lo ve en el buscador, no solo en Proveedores).
 */
export function mesListaDe(slug, hoy = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(proveedor(slug)?.lista_mes ?? '');
  if (m) {
    const atras = hoy.getFullYear() * 12 + hoy.getMonth() + 1 - (+m[1] * 12 + +m[2]);
    return { mes: m[0], texto: `lista ${MESES_CORTOS[+m[2] - 1]} ${m[1]}`, vieja: atras >= 2 };
  }
  const carga = estado.ultimaCarga?.[slug];
  // Tiene precios pero ninguna carga buena registrada (ej. robot con la cuenta desactivada): que se note
  if (!carga) return { mes: null, texto: 'precios sin actualizar', vieja: true };
  const d = new Date(carga), dias = (hoy - d) / 864e5;
  return { mes: null, texto: dias < 1 && d.getDate() === hoy.getDate() ? 'precios de hoy' : `precios del ${d.getDate()}/${d.getMonth() + 1}`, vieja: dias > 2 };
}

/** Ganancia (%) que se aplica a un proveedor: la suya si tiene, si no la general de Ajustes. */
export function gananciaDe(distribuidor) {
  const { config } = estado;
  return Number(config.ganancias_distribuidor?.[distribuidor] ?? config.ganancia_pct);
}

/** Precio de venta para un costo; con `pct` se usa esa ganancia (la que Daniel elige en el ticket). */
export function precioVenta(costo, distribuidor, pct = gananciaDe(distribuidor)) {
  if (costo == null) return null;
  const r = Number(estado.config.redondeo) || 1;
  return Math.round((costo * (1 + pct / 100)) / r) * r;
}

/** Ganancia (%) que deja un precio sobre su costo (para mostrarla cuando el precio se cambia a mano). */
export const gananciaDePrecio = (precio, costo) => (costo > 0 ? Math.round(((precio / costo) - 1) * 1000) / 10 : null);

// Listas en otra moneda (La Primera Alternativa en dólares): se guardan como vienen y se pasan a pesos acá,
// con la cotización de Ajustes. Así, cambiar la cotización actualiza todos los precios al instante.
const COTIZACION = { USD: 'cotizacion_usd', EUR: 'cotizacion_eur' };
export const monedaDe = slug => proveedor(slug)?.moneda || 'ARS';
export function aPesos(precio, slug) {
  if (precio == null) return null;
  const campo = COTIZACION[monedaDe(slug)];
  const cotizacion = campo ? Number(estado.config[campo]) : 1;
  return campo && cotizacion > 0 ? Math.round(precio * cotizacion * 100) / 100 : precio;
}

/* ── WhatsApp ────────────────────────────────────────────────────────── */
export { telefonoWhatsApp, linkWhatsApp } from './texto.js?v=36';
export async function copiar(texto, aviso = 'Copiado') {
  try { await navigator.clipboard.writeText(texto); toast(aviso, 'success'); return true; }
  catch { openModal({ title: 'Copiá el texto', body: h('textarea', { class: 'input', rows: 12, readonly: true }, texto) }); return false; }
}

/** Envuelve un guardado: mientras corre, los clics repetidos se ignoran (un doble clic no duplica pagos ni registros). */
export function unaVez(fn) {
  let corriendo = false;
  return async (...args) => {
    if (corriendo) return undefined;
    corriendo = true;
    try { return await fn(...args); } finally { corriendo = false; }
  };
}

/* ── Excel (leer listas, exportar el libro diario) ───────────────────── */
// SheetJS 0.20.3 servido desde el propio sitio (la 0.18.5 de npm tiene CVE-2023-30533); se carga recién al usarlo
const SHEETJS = 'vendor/xlsx-0.20.3.full.min.js';
export function cargarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, mal) => {
    const s = Object.assign(document.createElement('script'), { src: SHEETJS, onload: () => ok(window.XLSX), onerror: () => mal(new Error('No se pudo cargar el lector de Excel')) });
    document.head.append(s);
  });
}

// pdf.js 4.10 (Mozilla) servido desde el propio sitio, para leer listas en PDF; también se carga recién al usarlo
const PDFJS = new URL('../vendor/pdfjs-4.10.38/', import.meta.url);
let pdfjs = null;
export async function cargarPdfJs() {
  if (!pdfjs) {
    pdfjs = await import(new URL('pdf.min.mjs', PDFJS).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PDFJS).href;
  }
  return pdfjs;
}

/** Texto de un PDF como pedazos con su posición (lo que necesita filasDePdf de listas.js). */
export async function leerTextoPdf(archivo) {
  const lib = await cargarPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
  try {
    const paginas = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { items } = await (await doc.getPage(n)).getTextContent();
      paginas.push(items.map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str })));
    }
    return paginas;
  } finally {
    doc.destroy();   // libera la memoria del PDF (listas grandes)
  }
}

/* ── Búsqueda en precios de distribuidores y stock propio ────────────── */
// Cada palabra tiene que coincidir con el COMIENZO de una palabra (\m en Postgres): "gol" encuentra "GOL TREND"
// pero no "paraGOLpe". Usa el mismo índice trigram de la columna busqueda.
// Solo números ("400", "128", "1500": modelos y medidas) van en cualquier parte: "p/400" queda "p400" en la búsqueda.
// (escaparRegex, esNumero y coincidePalabras viven en texto.js: son puras y tienen tests)

const COLUMNAS_PRECIO = 'id, distribuidor, codigo, descripcion, marca, rubro, origen, precio_neto, precio_anterior, precio_cambio_at';

// Con RLS el índice de búsqueda no se puede usar (3-5 s por búsqueda): la función buscar_precios
// (docs/gestion-v8.sql) verifica que sea admin y busca con el índice (~30 ms). Sin v8, la consulta de antes.
let sinFuncionBuscar = false;
// buscar_precios2 (docs/gestion-v12.sql) recibe un patrón por palabra: sinónimos y abreviaturas de cada proveedor,
// lado (-DI/-TD, D/I), números exactos, palabras cortas enteras. Sin v12, buscar_precios (v10) con las palabras.
let sinPatrones = false;
async function buscarEnBase(ws, codigo) {
  if (!sinPatrones) {
    const primera = ws.find(w => !/^\d/.test(w)) ?? null;
    const { data, error } = await db.rpc('buscar_precios2', { p_patrones: ws.map(patron), p_primera: primera, p_codigo: codigo, p_limite: 250 });
    if (!error) return data;
    if (!/buscar_precios2/.test(error.message) || !/find|exist|schema cache/i.test(error.message)) {
      console.warn('[gestion] buscarPrecios:', error.message);
      return null;
    }
    sinPatrones = true;
  }
  if (!sinFuncionBuscar) {
    const { data, error } = await db.rpc('buscar_precios', { p_palabras: ws, p_codigo: codigo, p_limite: 250 });
    if (!error) return data;
    if (!/buscar_precios/.test(error.message) || !/find|exist|schema cache/i.test(error.message)) {
      console.warn('[gestion] buscarPrecios:', error.message);
      return null;
    }
    sinFuncionBuscar = true;
  }
  let query = db.from('precios_distribuidor').select(COLUMNAS_PRECIO).eq('activo', true);
  for (const w of ws) query = esNumero(w) ? query.ilike('busqueda', `%${w}%`) : query.filter('busqueda', 'imatch', `\\m${escaparRegex(w)}`);
  const porCodigo = codigo
    ? db.from('precios_distribuidor').select(COLUMNAS_PRECIO).eq('activo', true).ilike('codigo', `${codigo}%`).limit(20)
    : Promise.resolve({ data: [] });
  const [general, codigos] = await Promise.all([query.order('precio_neto', { ascending: true, nullsFirst: false }).limit(250), porCodigo]);
  if (general.error) { console.warn('[gestion] buscarPrecios:', general.error.message); return null; }
  return [...(codigos.data || []), ...general.data];
}

export async function buscarPrecios(q, limite = 40) {
  const todas = palabras(q);
  if (!todas.length) return [];
  // La marca del auto no deja afuera a los proveedores que no la escriben (solo suma para ordenar)
  const { duras: ws, blandas } = separarMarcas(todas);
  // Una sola "palabra" puede ser un código ("128", "CHECOR-001"): se busca aparte por código, así nunca queda afuera
  // de los 250 que trae la búsqueda general aunque haya muchas coincidencias
  const qCodigo = normalizar(q).replace(/\s+/g, '');
  const codigo = !/\s/.test(q.trim()) && qCodigo.length >= 3 ? q.trim().replace(/[%_*,()]/g, '') : null;
  // Se traen más de los que se muestran y se ordenan por relevancia (lo que empieza con la primera palabra, primero);
  // antes eran los 40 más baratos y lo buscado quedaba afuera detrás de soportes y vidrios
  const filas = await buscarEnBase(ws, codigo);
  // Un error (sin internet, sesión vencida) NO es "no lo tengo": el mostrador avisa y deja reintentar
  if (!filas) throw new Error('No se pudo buscar');
  const vistos = new Set();
  const data = filas.filter(d => !vistos.has(d.id) && vistos.add(d.id));
  // Código exacto (o su comienzo) primero de todo: "CHECOR-001" → ese artículo arriba
  const escritas = normalizar(q).split(/\s+/).filter(w => w.length > 1);   // las palabras tal como se escribieron
  const puntaje = d => {
    const c = normalizar(d.codigo ?? '');
    // Comienzo de código arriba solo si parece un código (con letras o largo): "206" o "128" son modelos de auto
    const pareceCodigo = /[a-z]/.test(qCodigo) || qCodigo.length >= 5;
    const conMarca = blandas.length ? blandas.filter(b => coincidePalabras(normalizarAmbos([d.descripcion, d.marca, d.rubro].join(' ')), [b])).length * 4 : 0;
    return c === qCodigo ? -2000 : pareceCodigo && c.startsWith(qCodigo) ? -1000 : relevancia(d.descripcion, ws, escritas) - conMarca;
  };
  return data
    .filter(d => {
      const c = normalizar(d.codigo ?? '');
      return c === qCodigo || (qCodigo.length >= 3 && c.startsWith(qCodigo))
        || coincidePalabras(normalizarAmbos([d.codigo, d.descripcion, d.marca, d.rubro, d.origen].join(' ')), ws);
    })
    .map((d, i) => ({ d, puntaje: puntaje(d), i }))
    .sort((a, b) => a.puntaje - b.puntaje || a.i - b.i)
    .filter(conTodosLosProveedores(limite))
    .map(({ d }) => ({
      ...d, moneda: monedaDe(d.distribuidor), precio_original: d.precio_neto,
      precio_neto: aPesos(d.precio_neto, d.distribuidor), precio_anterior: aPesos(d.precio_anterior, d.distribuidor),
    }));
}

/**
 * Cuando la búsqueda exacta no encontró nada: artículos PARECIDOS, tolerando errores de tipeo
 * ("paragople" → "paragolpe"). Sin docs/gestion-v5.sql todavía, devuelve [] y listo.
 */
export async function buscarParecidos(q, limite = 30) {
  const texto = sinPalabrasVacias(q);   // "fraro para corsa": el "para" no tiene que parecerse a nada
  if (texto.length < 3) return [];
  const { data, error } = await db.rpc('buscar_parecidos', { p_q: texto, p_limite: limite });
  if (error) { console.warn('[gestion] buscarParecidos:', error.message); return []; }
  return (data || []).map(d => ({
    ...d, moneda: monedaDe(d.distribuidor), precio_original: d.precio_neto,
    precio_neto: aPesos(d.precio_neto, d.distribuidor), precio_anterior: aPesos(d.precio_anterior, d.distribuidor),
  }));
}

export async function buscarStock(q, limite = 15) {
  const ws = palabras(q);
  if (!ws.length) return [];
  // La base filtra por la primera palabra con las vocales como comodín ("l_mp_r_" encuentra "Lámpara");
  // el filtro exacto sin acentos se hace acá (el catálogo propio es chico)
  const patron = normalizar(ws[0]).replace(/[aeiou]/g, '_');
  const { data, error } = await db.from('productos')
    .select('id, nombre, precio, stock, stock_cantidad, marca_rep, modelo, categoria, costo:productos_costos(costo, proveedor, codigo_proveedor)')
    .or(`nombre.ilike.*${patron}*,modelo.ilike.*${patron}*,marca_rep.ilike.*${patron}*`)
    .limit(200);
  if (error) { console.warn('[gestion] buscarStock:', error.message); throw new Error('No se pudo buscar'); }
  const claves = ws.map(normalizar);
  const escritasStock = normalizar(q).split(/\s+/).filter(w => w.length > 1);
  return data
    .filter(p => coincidePalabras(normalizarAmbos([p.nombre, p.modelo, p.marca_rep].join(' ')), claves))
    .sort((a, b) => relevancia(a.nombre, ws.map(normalizar), escritasStock) - relevancia(b.nombre, ws.map(normalizar), escritasStock))
    .slice(0, limite);
}

/* ── Pestañas ────────────────────────────────────────────────────────── */
const cargadores = {};
export function registrarVista(nombre, cargar) { cargadores[nombre] = cargar; }
export function mostrarVista(vista) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === vista));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${vista}`));
  try { localStorage.setItem('danichap-vista', vista); } catch { /* modo privado */ }
  cargadores[vista]?.();
}
export const vistaActual = () => document.querySelector('.tab.active')?.dataset.view;

export async function actualizarBadgeRepo() {
  const { count } = await db.from('reposicion_items').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
  const b = $('badge-repo');
  b.textContent = count || 0;
  b.classList.toggle('hidden', !count);
}
