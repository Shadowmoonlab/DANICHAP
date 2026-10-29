// gestion/mostrador.js — Venta por teclado: buscar (F2) → Enter agrega → F9 cobra. Presupuestos por WhatsApp.
import {
  $, h, icon, vacio, db, toast, money, fecha, PAGOS, debounce, estado, nombreProveedor, precioVenta,
  buscarPrecios, buscarStock, openModal, closeModal, confirmar, copiar, linkWhatsApp, registrarVista,
  actualizarBadgeRepo, unaVez,
} from './core.js';
import { presupuesto as textoPresupuesto } from './plantillas.js';
import { imprimirComprobante } from './comprobante.js';
import { editarCliente } from './clientes.js';

let resultados = [];
let selIdx = -1;
let venta = [];            // renglones de la venta actual
let presupuestoId = null;  // si la venta se cargó desde un presupuesto

const buscador = () => $('pos-search');

/* ── Búsqueda ────────────────────────────────────────────────────────── */
const ejecutarBusqueda = debounce(async () => {
  const q = buscador().value.trim();
  if (q.length < 2) { renderResultados(null); return; }
  const [stock, dist] = await Promise.all([buscarStock(q), buscarPrecios(q)]);
  if (buscador().value.trim() !== q) return; // llegó tarde: el usuario siguió escribiendo
  const costoMin = Math.min(...dist.map(d => d.precio_neto ?? Infinity));
  resultados = [
    ...stock.map(p => ({
      tipo: 'stock', key: `p-${p.id}`, producto_id: p.id, codigo: p.costo?.codigo_proveedor || '',
      descripcion: p.nombre, origen: 'Mi stock', precio: p.precio, costo: p.costo?.costo ?? null,
      extra: p.stock_cantidad != null ? `${p.stock_cantidad} u.` : (p.stock ? 'Con stock' : 'Sin stock'),
      sinStock: p.stock === false || p.stock_cantidad === 0,
    })),
    ...dist.map(d => ({
      tipo: 'dist', key: `d-${d.id}`, precio_distribuidor_id: d.id, distribuidor: d.distribuidor,
      codigo: d.codigo, descripcion: d.descripcion, origen: nombreProveedor(d.distribuidor),
      precio: precioVenta(d.precio_neto, d.distribuidor), costo: d.precio_neto,
      extra: [d.marca, d.rubro].filter(Boolean).join(' · '), masBarato: dist.length > 1 && d.precio_neto === costoMin,
      subio: d.precio_anterior != null && d.precio_neto > d.precio_anterior,
    })),
  ];
  selIdx = resultados.length ? 0 : -1;
  renderResultados(q);
}, 220);

/* ── Buscar en las webs: proveedores que no salieron en esta búsqueda (los que el robot no lee, o sin coincidencias) ── */
function renderWebs(q) {
  const box = $('pos-webs');
  const conResultados = new Set(resultados.filter(r => r.tipo === 'dist').map(r => r.distribuidor));
  const webs = q == null ? [] : estado.proveedores.filter(p => p.activo && p.web && !conResultados.has(p.slug));
  box.classList.toggle('hidden', !webs.length);
  if (!webs.length) { box.replaceChildren(); return; }
  box.replaceChildren(
    h('span', { class: 'muted' }, icon('travel_explore'), ` Buscá "${q}" en sus webs: se copia lo que escribiste y se abre la página, pegalo en su buscador.`),
    h('div', { class: 'pos-webs-lista' }, ...webs.map(p => h('button', { class: 'btn btn-sm', title: `Abrir ${p.web}`, onclick: () => abrirWeb(p, q) },
      icon('open_in_new'), p.nombre))));
}

function abrirWeb(p, q) {
  // Copiar y abrir en el mismo clic: el navegador bloquea las pestañas que se abren después de esperar algo
  navigator.clipboard?.writeText(q).catch(() => {});
  window.open(p.busqueda_url ? p.busqueda_url.replace('{q}', encodeURIComponent(q)) : p.web, '_blank', 'noopener');
  toast(p.busqueda_url ? `Buscando en ${p.nombre}` : `Copiado "${q}": pegalo (Ctrl+V) en el buscador de ${p.nombre}`, 'success');
}

function renderResultados(q) {
  renderWebs(q);
  const box = $('pos-results');
  if (q == null) {
    box.replaceChildren(vacio('manage_search', 'Escribí lo que te piden.', h('br'), 'Busca en tu stock y en todos los distribuidores a la vez.'));
    return;
  }
  if (!resultados.length) {
    box.replaceChildren(vacio('search_off', `No encontré nada con "${q}".`, h('br'), 'Probá con menos palabras o con el código.'));
    return;
  }
  box.replaceChildren(...resultados.map((r, i) => h('div', {
    class: 'res' + (i === selIdx ? ' sel' : ''), 'data-i': i, role: 'option', 'aria-selected': i === selIdx ? 'true' : 'false',
    onclick: () => { selIdx = i; agregarSeleccionado(); },
  },
    h('div', { class: 'desc' }, r.descripcion),
    h('div', { class: 'price' },
      h('div', { class: 'pv num' }, r.precio != null ? money(r.precio) : 'Sin precio'),
      r.costo != null ? h('div', { class: 'pc num' }, `costo ${money(r.costo)}`) : null),
    h('div', { class: 'meta' },
      h('span', { class: 'chip' + (r.tipo === 'stock' ? ' chip-stock' : '') }, r.origen),
      r.codigo ? h('span', {}, r.codigo) : null,
      r.extra ? h('span', {}, r.extra) : null,
      r.sinStock ? h('span', { class: 'chip chip-gray' }, 'sin stock') : null,
      r.masBarato ? h('span', { class: 'best' }, '★ más barato') : null,
      r.subio ? h('span', { class: 'chip chip-amber' }, 'subió') : null),
  )));
}

function moverSeleccion(delta) {
  if (!resultados.length) return;
  selIdx = (selIdx + delta + resultados.length) % resultados.length;
  document.querySelectorAll('#pos-results .res').forEach((el, i) => {
    el.classList.toggle('sel', i === selIdx);
    el.setAttribute('aria-selected', i === selIdx ? 'true' : 'false');
  });
  document.querySelector(`#pos-results .res[data-i="${selIdx}"]`)?.scrollIntoView({ block: 'nearest' });
}

function agregarSeleccionado() {
  const r = resultados[selIdx];
  if (!r) return;
  const ya = venta.find(v => v.key === r.key);
  if (ya) ya.cantidad++;
  else venta.push({
    key: r.key, producto_id: r.producto_id || null, precio_distribuidor_id: r.precio_distribuidor_id || null,
    codigo: r.codigo, descripcion: r.descripcion, origen: r.origen,
    cantidad: 1, precio_unit: r.precio ?? 0, costo_unit: r.costo,
  });
  renderVenta();
  buscador().select();
  toast(`Agregado: ${r.descripcion.slice(0, 40)}`);
}

/* ── Venta actual ────────────────────────────────────────────────────── */
function renderVenta() {
  const box = $('pos-items');
  if (!venta.length) {
    box.replaceChildren(vacio('shopping_cart', 'Todavía no agregaste nada.'));
  } else {
    box.replaceChildren(...venta.map(v => {
      const qty = h('input', { value: v.cantidad, inputmode: 'numeric', 'aria-label': 'Cantidad',
        onchange: e => { v.cantidad = Math.max(1, parseInt(e.target.value, 10) || 1); renderVenta(); } });
      const pr = h('input', { class: 'pr num', value: v.precio_unit, inputmode: 'decimal', 'aria-label': 'Precio',
        onchange: e => { v.precio_unit = Math.max(0, parseFloat(e.target.value.replace(',', '.')) || 0); renderVenta(); } });
      return h('div', { class: 'ti' },
        h('div', {}, h('div', { class: 'd' }, v.descripcion), h('div', { class: 'src' }, [v.origen, v.codigo].filter(Boolean).join(' · '))),
        h('button', { class: 'btn btn-icon btn-red', title: 'Quitar', 'aria-label': 'Quitar', onclick: () => { venta = venta.filter(x => x !== v); renderVenta(); } }, icon('close')),
        h('div', { class: 'ctrl' },
          h('div', { class: 'qty' },
            h('button', { onclick: () => { v.cantidad = Math.max(1, v.cantidad - 1); renderVenta(); }, 'aria-label': 'Menos' }, '−'),
            qty,
            h('button', { onclick: () => { v.cantidad++; renderVenta(); }, 'aria-label': 'Más' }, '+')),
          h('span', { class: 'muted' }, '×'), pr),
        h('div', { class: 'sub num' }, money(v.cantidad * v.precio_unit)));
    }));
  }
  const total = venta.reduce((s, v) => s + v.cantidad * v.precio_unit, 0);
  const conCosto = venta.filter(v => v.costo_unit != null);
  const ganancia = conCosto.reduce((s, v) => s + v.cantidad * (v.precio_unit - v.costo_unit), 0);
  $('pos-total').textContent = money(total);
  $('pos-gain').textContent = conCosto.length
    ? `Ganancia: ${money(ganancia)}${conCosto.length < venta.length ? ' (sin contar artículos sin costo)' : ''}` : '';
  $('pos-cobrar').disabled = !venta.length;
  $('pos-presu').disabled = !venta.length;
  $('pos-presu-badge').classList.toggle('hidden', !presupuestoId);
  $('pos-presu-badge').textContent = presupuestoId ? `Presupuesto Nº ${presupuestoId}` : '';
}

function clienteElegido() {
  const nombre = $('pos-cliente').value.trim();
  return { nombre, cliente: estado.clientes.find(c => c.nombre.toLowerCase() === nombre.toLowerCase()) || null };
}

function itemsParaGuardar() {
  return venta.map(v => ({
    producto_id: v.producto_id, precio_distribuidor_id: v.precio_distribuidor_id, codigo: v.codigo,
    descripcion: v.descripcion, origen: v.origen, cantidad: v.cantidad, precio_unit: v.precio_unit, costo_unit: v.costo_unit,
  }));
}

function limpiarVenta() {
  venta = []; presupuestoId = null;
  $('pos-cliente').value = '';
  $('pos-print').checked = false;
  $('pos-pago').value = 'efectivo';
  renderVenta();
}

async function cobrar() {
  if (!venta.length) return;
  const { nombre, cliente } = clienteElegido();
  const medio = $('pos-pago').value;
  if (medio === 'cuenta_corriente' && !cliente) {
    toast('Para fiar, elegí un cliente cargado (o creálo con el botón +)', 'error');
    $('pos-cliente').focus();
    return;
  }
  const btn = $('pos-cobrar');
  btn.disabled = true;
  const imprimir = $('pos-print').checked;
  const payload = {
    cliente_id: cliente?.id ?? null, cliente_nombre: cliente?.nombre ?? (nombre || null),
    medio_pago: medio, impreso: imprimir, presupuesto_id: presupuestoId, items: itemsParaGuardar(),
  };
  const { data: ventaId, error } = await db.rpc('registrar_venta', { p_venta: payload });
  if (error) { btn.disabled = false; toast('No se pudo registrar la venta: ' + error.message, 'error'); return; }
  if (imprimir) imprimirComprobante({ id: ventaId, created_at: new Date().toISOString(), cliente_nombre: payload.cliente_nombre, medio_pago: medio, items: payload.items });
  toast(`Venta Nº ${ventaId} registrada${medio === 'cuenta_corriente' ? ' en cuenta corriente' : ''}`, 'success');
  limpiarVenta();
  actualizarBadgeRepo();
  if (payload.presupuesto_id) actualizarBadgePresupuestos();
  buscador().value = '';
  renderResultados(null);
  buscador().focus();
}

/* ── Presupuestos ────────────────────────────────────────────────────── */
async function presupuestoWhatsApp() {
  if (!venta.length) return;
  const { nombre, cliente } = clienteElegido();
  const texto = textoPresupuesto({ cliente: cliente?.nombre || nombre, items: venta, negocio: estado.config });
  const area = h('textarea', { class: 'input', rows: 14 }, texto);
  const guardar = unaVez(async () => {
    const total = venta.reduce((s, v) => s + v.cantidad * v.precio_unit, 0);
    const valido = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    const datos = { cliente_id: cliente?.id ?? null, cliente_nombre: cliente?.nombre ?? (nombre || null), items: itemsParaGuardar(), total, valido_hasta: valido };
    const q = presupuestoId ? db.from('presupuestos').update(datos).eq('id', presupuestoId) : db.from('presupuestos').insert(datos);
    const { data, error } = await q.select('id').single();
    if (error) { toast(error.message, 'error'); return null; }
    presupuestoId = data.id; renderVenta(); actualizarBadgePresupuestos();
    return data.id;
  });
  openModal({
    title: 'Presupuesto por WhatsApp', wide: true,
    body: h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' }, cliente?.telefono
        ? `Se abre WhatsApp con ${cliente.nombre} (${cliente.telefono}). Podés editar el texto antes.`
        : 'Sin teléfono cargado: WhatsApp te va a pedir elegir el contacto. Podés editar el texto antes.'),
      area),
    foot: [
      h('button', { class: 'btn', onclick: async () => { if (await guardar()) { closeModal(); toast('Presupuesto guardado', 'success'); } } }, icon('save'), 'Solo guardar'),
      h('button', { class: 'btn', onclick: () => copiar(area.value, 'Presupuesto copiado') }, icon('content_copy'), 'Copiar'),
      h('button', { class: 'btn btn-green', onclick: async () => {
        if (!(await guardar())) return;
        window.open(linkWhatsApp(cliente?.telefono, area.value), '_blank', 'noopener');
        closeModal(); toast('Presupuesto guardado y abierto en WhatsApp', 'success');
      } }, icon('send'), 'Guardar y enviar'),
    ],
  });
}

export async function actualizarBadgePresupuestos() {
  const { count } = await db.from('presupuestos').select('id', { count: 'exact', head: true }).eq('estado', 'abierto');
  $('pos-presus-n').textContent = count ? `(${count})` : '';
}

async function verPresupuestos() {
  const { data, error } = await db.from('presupuestos')
    .select('id, cliente_nombre, items, total, valido_hasta, created_at').eq('estado', 'abierto')
    .order('created_at', { ascending: false }).limit(50);
  if (error) { toast(error.message, 'error'); return; }
  const hoy = new Date().toISOString().slice(0, 10);
  openModal({
    title: 'Presupuestos abiertos', wide: true,
    body: data.length ? h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Nº'), h('th', {}, 'Fecha'), h('th', {}, 'Cliente'), h('th', {}, 'Artículos'), h('th', { class: 'right' }, 'Total'), h('th', {}))),
      h('tbody', {}, ...data.map(p => h('tr', {},
        h('td', { class: 'num' }, p.id), h('td', {}, fecha(p.created_at),
          p.valido_hasta && p.valido_hasta < hoy ? h('span', { class: 'chip chip-gray', style: 'margin-left:6px' }, 'vencido') : null),
        h('td', {}, p.cliente_nombre || h('span', { class: 'muted' }, 'Sin nombre')),
        h('td', { class: 'muted' }, p.items.map(i => `${i.cantidad} x ${i.descripcion}`).join(', ').slice(0, 70)),
        h('td', { class: 'right num' }, h('b', {}, money(p.total))),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => cargarPresupuesto(p) }, 'Cargar'),
          h('button', { class: 'btn btn-sm btn-icon btn-red', title: 'Descartar', 'aria-label': 'Descartar', style: 'margin-left:4px', onclick: async () => {
            await db.from('presupuestos').update({ estado: 'descartado' }).eq('id', p.id);
            closeModal(); actualizarBadgePresupuestos(); verPresupuestos();
          } }, icon('close'))))))) : vacio('request_quote', 'No hay presupuestos abiertos.'),
  });
}

async function cargarPresupuesto(p) {
  if (venta.length && !(await confirmar('Reemplazar venta', 'Hay artículos en la venta actual. ¿Los reemplazo por este presupuesto?', { ok: 'Reemplazar' }))) return;
  venta = p.items.map((i, n) => ({ ...i, key: i.producto_id ? `p-${i.producto_id}` : i.precio_distribuidor_id ? `d-${i.precio_distribuidor_id}` : `x-${n}` }));
  presupuestoId = p.id;
  $('pos-cliente').value = p.cliente_nombre || '';
  closeModal(); renderVenta();
  toast(`Presupuesto Nº ${p.id} cargado. Revisá precios y cobrá con F9.`, 'success');
}

/* ── Inicio ──────────────────────────────────────────────────────────── */
export function iniciarMostrador() {
  buscador().addEventListener('input', ejecutarBusqueda);
  buscador().addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moverSeleccion(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moverSeleccion(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); agregarSeleccionado(); }
    else if (e.key === 'Escape') { buscador().value = ''; resultados = []; renderResultados(null); }
  });
  $('pos-cobrar').addEventListener('click', cobrar);
  $('pos-presu').addEventListener('click', presupuestoWhatsApp);
  $('pos-presus').addEventListener('click', verPresupuestos);
  $('pos-clear').addEventListener('click', () => { limpiarVenta(); buscador().focus(); });
  $('pos-cliente-nuevo').addEventListener('click', () => editarCliente(null, c => { $('pos-cliente').value = c.nombre; }));
  $('pos-pago').addEventListener('change', () => {
    $('pos-cc-aviso').classList.toggle('hidden', $('pos-pago').value !== 'cuenta_corriente');
  });
  renderVenta();
  actualizarBadgePresupuestos();
  registrarVista('mostrador', () => setTimeout(() => buscador().focus(), 0));
}

