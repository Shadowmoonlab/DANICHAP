// gestion/reposicion.js — Carrito de reposición agrupado por proveedor, con logística (días de visita,
// pedido mínimo) y envío del pedido por WhatsApp.
import {
  $, h, icon, vacio, db, toast, money, fecha, estado, proveedor, nombreProveedor, DIAS_LARGO, debounce,
  buscarPrecios, openModal, closeModal, copiar, linkWhatsApp, pedirNumero, registrarVista, actualizarBadgeRepo,
  mostrarVista,
} from './core.js';
import { palabras } from './texto.js';
import { pedidoProveedor } from './plantillas.js';

let repoEstado = 'pendiente';

/** Días hasta la próxima visita del proveedor (0 = hoy), o null si no tiene días cargados. */
export function diasHastaVisita(prov, hoy = new Date().getDay()) {
  const dias = prov?.dias_visita || [];
  if (!dias.length) return null;
  return Math.min(...dias.map(d => (d - hoy + 7) % 7));
}

function etiquetaVisita(prov) {
  const n = diasHastaVisita(prov);
  if (n === null) return h('span', { class: 'chip chip-gray', title: 'Cargá los días en la pestaña Proveedores' }, 'sin días de visita');
  if (n === 0) return h('span', { class: 'chip chip-stock' }, '● pasa hoy');
  if (n === 1) return h('span', { class: 'chip' }, 'pasa mañana');
  return h('span', { class: 'chip' }, `pasa el ${DIAS_LARGO[(new Date().getDay() + n) % 7]}`);
}

async function cargar() {
  const box = $('repo-list');
  const { data, error } = await db.from('reposicion_items')
    .select('id, codigo, descripcion, cantidad, estado, created_at, pedido_at, precio_distribuidor_id, precio:precios_distribuidor(id, distribuidor, codigo, descripcion, precio_neto, activo)')
    .eq('estado', repoEstado)
    .order('created_at', { ascending: true });
  if (error) { box.replaceChildren(h('div', { class: 'card empty' }, error.message)); return; }
  if (!data.length) {
    box.replaceChildren(h('div', { class: 'card' }, vacio(repoEstado === 'pendiente' ? 'task_alt' : 'local_shipping',
      repoEstado === 'pendiente' ? 'No hay nada para pedir. ¡Todo repuesto!' : 'No hay pedidos en camino.')));
    return;
  }

  const grupos = new Map();
  for (const it of data) {
    const k = it.precio?.distribuidor || '_sin';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(it);
  }
  // Primero los que pasan hoy, después por cercanía de visita; "sin proveedor" al final
  const orden = [...grupos.keys()].sort((a, b) => {
    if (a === '_sin' || b === '_sin') return (a === '_sin') - (b === '_sin');
    const da = diasHastaVisita(proveedor(a)) ?? 99, dbb = diasHastaVisita(proveedor(b)) ?? 99;
    return da - dbb || nombreProveedor(a).localeCompare(nombreProveedor(b));
  });

  box.replaceChildren(h('div', { class: 'prov-grid' }, ...orden.map(k => tarjetaProveedor(k, grupos.get(k)))));
}

function tarjetaProveedor(slug, items) {
  const sin = slug === '_sin';
  const prov = proveedor(slug);
  const total = items.reduce((s, it) => s + it.cantidad * (it.precio?.precio_neto || 0), 0);
  const minimo = Number(prov?.pedido_minimo) || 0;

  return h('div', { class: 'card' },
    h('div', { class: 'prov-head' + (sin ? ' none' : '') },
      h('div', {},
        h('h3', {}, sin ? 'Sin proveedor elegido' : nombreProveedor(slug)),
        !sin && repoEstado === 'pendiente' ? h('div', { style: 'margin-top:4px' }, etiquetaVisita(prov)) : null),
      h('div', { class: 'prov-tot' }, `${items.length} artículo${items.length > 1 ? 's' : ''}`,
        sin ? '' : [' · costo ', h('b', { class: 'num' }, money(total))])),
    !sin && minimo && repoEstado === 'pendiente' ? h('div', { class: 'minimo' },
      h('div', { class: 'minimo-bar' }, h('span', { style: `width:${Math.min(100, (total / minimo) * 100)}%` })),
      h('span', { class: total >= minimo ? 'ok' : 'falta' },
        total >= minimo ? `Supera el mínimo de ${money(minimo)}` : `Faltan ${money(minimo - total)} para el mínimo de ${money(minimo)}`)) : null,
    ...items.map(it => h('div', { class: 'ri' },
      h('div', { class: 'q' }, it.cantidad),
      h('div', {},
        h('div', { class: 'd' }, it.precio?.descripcion || it.descripcion),
        h('div', { class: 'm' },
          it.precio ? `${it.precio.codigo} · ${money(it.precio.precio_neto)} c/u` : (it.codigo || 'Elegí dónde comprarlo con "Comparar"'),
          it.precio && !it.precio.activo ? ' · ⚠ ya no figura en el distribuidor' : '',
          repoEstado === 'pedido' && it.pedido_at ? ` · pedido ${fecha(it.pedido_at)}` : '')),
      h('div', { class: 'acts' },
        repoEstado === 'pendiente'
          ? [h('button', { class: 'btn btn-sm', onclick: () => compararPrecios(it) }, icon('compare_arrows'), 'Comparar'),
             h('button', { class: 'btn btn-sm btn-icon btn-red', title: 'Quitar (no hace falta reponer)', 'aria-label': 'Quitar', onclick: () => cambiarEstado([it.id], 'descartado') }, icon('close'))]
          : h('button', { class: 'btn btn-sm btn-green', onclick: () => cambiarEstado([it.id], 'recibido') }, icon('check'), 'Llegó')))),
    h('div', { class: 'prov-foot' },
      repoEstado === 'pendiente' && !sin ? [
        h('button', { class: 'btn btn-sm btn-green', onclick: () => enviarPedido(slug, items) }, icon('send'),
          prov?.whatsapp ? 'Enviar pedido por WhatsApp' : 'Pedido por WhatsApp'),
        h('button', { class: 'btn btn-sm', onclick: () => copiar(textoPedido(slug, items), 'Pedido copiado') }, icon('content_copy'), 'Copiar'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => cambiarEstado(items.map(i => i.id), 'pedido') }, icon('done'), 'Ya lo pedí'),
      ] : null,
      repoEstado === 'pedido' ? [
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => { sessionStorage.setItem('danichap-recepcion-prov', sin ? '' : slug); mostrarVista('recepcion'); } },
          icon('document_scanner'), 'Cargar la factura'),
        h('button', { class: 'btn btn-sm btn-green', onclick: () => cambiarEstado(items.map(i => i.id), 'recibido') }, icon('done_all'), 'Llegó todo'),
      ] : null));
}

const textoPedido = (slug, items) => pedidoProveedor({
  proveedor: nombreProveedor(slug), negocio: estado.config,
  items: items.map(it => ({ cantidad: it.cantidad, codigo: it.precio?.codigo || it.codigo, descripcion: it.precio?.descripcion || it.descripcion })),
});

function enviarPedido(slug, items) {
  window.open(linkWhatsApp(proveedor(slug)?.whatsapp, textoPedido(slug, items)), '_blank', 'noopener');
  openModal({
    title: '¿Mandaste el pedido?',
    body: h('p', { style: 'margin:0' }, `Si ya lo enviaste a ${nombreProveedor(slug)}, lo paso a "Pedidos en camino" para que sepas qué falta llegar.`),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Todavía no'),
           h('button', { class: 'btn btn-primary', onclick: () => { closeModal(); cambiarEstado(items.map(i => i.id), 'pedido'); } }, 'Sí, marcar como pedido')],
  });
}

async function cambiarEstado(ids, nuevo) {
  const campos = { estado: nuevo };
  if (nuevo === 'pedido') campos.pedido_at = new Date().toISOString();
  if (nuevo === 'recibido') campos.recibido_at = new Date().toISOString();
  const { error } = await db.from('reposicion_items').update(campos).in('id', ids);
  if (error) { toast(error.message, 'error'); return; }
  toast({ pedido: 'Pasado a pedidos en camino', recibido: 'Marcado como recibido', descartado: 'Quitado de la lista' }[nuevo] || 'Actualizado', 'success');
  cargar(); actualizarBadgeRepo();
}

/** Busca el mismo repuesto en todos los distribuidores, del más barato al más caro. */
export async function compararPrecios(it, alElegir) {
  const base = it.precio?.descripcion || it.descripcion || '';
  const input = h('input', { class: 'input', value: palabras(base).slice(0, 4).join(' '), placeholder: 'Buscar…', 'aria-label': 'Buscar repuesto' });
  const lista = h('div', {}, vacio('hourglass_top', 'Buscando…'));

  const correr = async () => {
    const q = input.value;
    const res = await buscarPrecios(q, 30);
    if (input.value !== q) return; // respuesta vieja: ya se escribió otra cosa
    if (!res.length) { lista.replaceChildren(vacio('search_off', 'Sin resultados. Probá con menos palabras.')); return; }
    lista.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Proveedor'), h('th', {}, 'Código'), h('th', {}, 'Descripción'), h('th', { class: 'right' }, 'Costo'), h('th', {}))),
      h('tbody', {}, ...res.map((r, i) => h('tr', {},
        h('td', {}, h('span', { class: 'chip' }, nombreProveedor(r.distribuidor)), h('div', { style: 'margin-top:3px' }, etiquetaVisita(proveedor(r.distribuidor)))),
        h('td', { class: 'muted' }, r.codigo),
        h('td', {}, r.descripcion, i === 0 && res.length > 1 ? h('span', { class: 'best', style: 'margin-left:6px' }, '★ más barato') : null),
        h('td', { class: 'right num' }, h('b', {}, money(r.precio_neto))),
        h('td', {}, h('button', { class: 'btn btn-sm btn-primary', onclick: () => elegir(r) },
          r.id === it.precio_distribuidor_id ? 'Elegido' : 'Elegir'))))))));
  };
  const elegir = async r => {
    if (alElegir) { closeModal(); alElegir(r); return; }
    const { error } = await db.from('reposicion_items').update({ precio_distribuidor_id: r.id }).eq('id', it.id);
    if (error) { toast(error.message, 'error'); return; }
    closeModal(); toast(`Se pide a ${nombreProveedor(r.distribuidor)}`, 'success'); cargar();
  };

  input.addEventListener('input', debounce(correr, 300));
  openModal({ title: alElegir ? 'Agregar faltante' : 'Comparar precios', wide: true,
    body: h('div', {}, h('div', { class: 'field' }, input), lista) });
  input.focus();
  correr();
}

export function iniciarReposicion() {
  $('repo-agregar').addEventListener('click', () => compararPrecios({ descripcion: '' }, async r => {
    const cant = await pedirNumero('Agregar faltante', `¿Cuántas unidades de "${r.descripcion}"?`, 1);
    if (!cant) return;
    const { error } = await db.from('reposicion_items').insert({ codigo: r.codigo, descripcion: r.descripcion, cantidad: cant, precio_distribuidor_id: r.id });
    if (error) { toast(error.message, 'error'); return; }
    toast('Agregado a la lista para pedir', 'success'); cargar(); actualizarBadgeRepo();
  }));
  document.querySelectorAll('#view-reposicion .subtab').forEach(b => b.addEventListener('click', () => {
    repoEstado = b.dataset.estado;
    document.querySelectorAll('#view-reposicion .subtab').forEach(x => x.classList.toggle('active', x === b));
    $('repo-agregar').classList.toggle('hidden', repoEstado !== 'pendiente');
    cargar();
  }));
  registrarVista('reposicion', cargar);
}
