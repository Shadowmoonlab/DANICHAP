// gestion/comprobante.js — Comprobante interno imprimible (no fiscal)
import { $, h, money, estado, PAGOS } from './core.js?v=12';

export function imprimirComprobante(v) {
  const { config } = estado;
  const total = v.items.reduce((s, i) => s + i.cantidad * i.precio_unit, 0);
  $('print-area').replaceChildren(h('div', { class: 'cmp' },
    h('div', { class: 'cmp-head' },
      h('div', {}, h('h1', {}, config.nombre_negocio || 'DANICHAP'),
        config.direccion ? h('div', {}, config.direccion) : null,
        config.telefono ? h('div', {}, `Tel: ${config.telefono}`) : null),
      h('div', { style: 'text-align:right' }, h('b', {}, `Comprobante Nº ${String(v.id).padStart(6, '0')}`),
        h('div', {}, new Date(v.created_at).toLocaleString('es-AR')),
        h('div', {}, `Cliente: ${v.cliente_nombre || 'Consumidor final'}`),
        h('div', {}, `Pago: ${PAGOS[v.medio_pago] || v.medio_pago}`))),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Cant.'), h('th', {}, 'Descripción'), h('th', { style: 'text-align:right' }, 'P. unit.'), h('th', { style: 'text-align:right' }, 'Subtotal'))),
      h('tbody', {}, ...v.items.map(i => h('tr', {},
        h('td', {}, i.cantidad), h('td', {}, i.descripcion),
        h('td', { style: 'text-align:right' }, money(i.precio_unit)),
        h('td', { style: 'text-align:right' }, money(i.cantidad * i.precio_unit)))))),
    h('div', { class: 'tot' }, `TOTAL ${money(total)}`),
    h('div', { class: 'leg' }, config.leyenda_comprobante || 'Documento no válido como factura')));
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}
