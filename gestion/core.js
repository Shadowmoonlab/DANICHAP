// gestion/core.js — Base compartida del panel: DOM, formato, modal, configuración, proveedores, búsqueda
// Usa los globales de supabase.js (_supabase) y toast.js (showToast), que cargan antes como scripts clásicos.
import { normalizar, palabras } from './texto.js';

export const db = window._supabase ?? _supabase;
export const toast = (msg, tipo) => window.showToast(msg, tipo);
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
export function openModal({ title, body, foot = [], wide = false }) {
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(body);
  $('modal-foot').replaceChildren(...foot.filter(Boolean));
  $('modal-foot').classList.toggle('hidden', foot.filter(Boolean).length === 0);
  $('modal').classList.toggle('wide', wide);
  $('modal-bg').classList.remove('hidden');
}
export function closeModal() { $('modal-bg').classList.add('hidden'); }
export const modalAbierto = () => !$('modal-bg').classList.contains('hidden');

/** Diálogo de confirmación propio (confirm() nativo se bloquea en algunos contextos). */
export function confirmar(titulo, texto, { ok = 'Confirmar', peligro = false } = {}) {
  return new Promise(resolve => {
    const cerrar = v => { closeModal(); resolve(v); };
    openModal({
      title: titulo,
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
    const cerrar = v => { closeModal(); resolve(v); };
    const aceptar = () => { const n = parseInt(input.value, 10); cerrar(n > 0 ? n : null); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') aceptar(); });
    openModal({
      title: titulo,
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
}
export const proveedor = slug => estado.proveedores.find(p => p.slug === slug);
export const nombreProveedor = slug => proveedor(slug)?.nombre || slug;

export function precioVenta(costo, distribuidor) {
  if (costo == null) return null;
  const { config } = estado;
  const pct = Number(config.ganancias_distribuidor?.[distribuidor] ?? config.ganancia_pct);
  const r = Number(config.redondeo) || 1;
  return Math.round((costo * (1 + pct / 100)) / r) * r;
}

/* ── WhatsApp ────────────────────────────────────────────────────────── */
export { telefonoWhatsApp, linkWhatsApp } from './texto.js';
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

/* ── Búsqueda en precios de distribuidores y stock propio ────────────── */
export async function buscarPrecios(q, limite = 40) {
  const ws = palabras(normalizar(q));
  if (!ws.length) return [];
  let query = db.from('precios_distribuidor')
    .select('id, distribuidor, codigo, descripcion, marca, rubro, precio_neto, precio_anterior, precio_cambio_at')
    .eq('activo', true);
  for (const w of ws) query = query.ilike('busqueda', `%${w}%`);
  const { data, error } = await query.order('precio_neto', { ascending: true, nullsFirst: false }).limit(limite);
  if (error) { console.warn('[gestion] buscarPrecios:', error.message); return []; }
  return data;
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
  if (error) { console.warn('[gestion] buscarStock:', error.message); return []; }
  const claves = ws.map(normalizar);
  return data
    .filter(p => { const t = normalizar([p.nombre, p.modelo, p.marca_rep].join(' ')); return claves.every(w => t.includes(w)); })
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
