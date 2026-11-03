// gestion/clientes.js — Agenda simple de clientes: datos de contacto (presupuestos por WhatsApp) y qué compró.
import {
  $, h, icon, vacio, db, toast, money, fecha, fechaCorta, estado, hoyISO, openModal, closeModal,
  registrarVista, PAGOS, unaVez,
} from './core.js?v=34';

export async function cargarClientes() {
  const { data, error } = await db.from('clientes_resumen').select('*').order('nombre');
  if (error) { console.warn('[gestion] clientes:', error.message); return; }
  estado.clientes = data;
  $('dl-clientes').replaceChildren(...data.map(c => h('option', { value: c.nombre })));
  render();
}

function render() {
  const q = $('cli-search').value.trim().toLowerCase();
  const lista = estado.clientes.filter(c => !q || [c.nombre, c.cuit_dni, c.telefono].some(x => (x || '').toLowerCase().includes(q)));

  const body = $('cli-body');
  if (!lista.length) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: 4 }, vacio('group', estado.clientes.length ? 'Ningún cliente coincide.' : 'Todavía no cargaste clientes.'))));
    return;
  }
  body.replaceChildren(...lista.map(c => h('tr', { class: 'clickable', tabindex: 0, onclick: () => fichaCliente(c), onkeydown: e => { if (e.key === 'Enter') fichaCliente(c); } },
    h('td', {}, h('b', {}, c.nombre)),
    h('td', {}, c.telefono || h('span', { class: 'muted' }, '—')),
    h('td', {}, c.ultima_compra ? fechaCorta(c.ultima_compra) : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'right num' }, money(c.total_comprado)))));
}

/* ── Alta / edición ──────────────────────────────────────────────────── */
export function editarCliente(c, alGuardar) {
  const campos = [['nombre', 'Nombre o taller *'], ['telefono', 'Teléfono / WhatsApp'], ['cuit_dni', 'CUIT o DNI'],
                  ['email', 'Mail'], ['direccion', 'Dirección'], ['notas', 'Notas']];
  const inputs = {};
  const form = h('div', {}, ...campos.map(([k, l]) => h('div', { class: 'field' }, h('label', { class: 'label' }, l),
    inputs[k] = k === 'notas' ? h('textarea', { class: 'input', rows: 2 }, c?.[k] || '')
                              : h('input', { class: 'input', value: c?.[k] || '', type: k === 'email' ? 'email' : k === 'telefono' ? 'tel' : 'text' }))));
  const guardar = unaVez(async () => {
    const datos = Object.fromEntries(campos.map(([k]) => [k, inputs[k].value.trim() || null]));
    if (!datos.nombre) { toast('Falta el nombre', 'error'); inputs.nombre.focus(); return; }
    datos.updated_at = new Date().toISOString();
    const q = c ? db.from('clientes').update(datos).eq('id', c.id) : db.from('clientes').insert(datos);
    const { data, error } = await q.select().single();
    if (error) { toast(error.message, 'error'); return; }
    closeModal(); toast(c ? 'Cliente actualizado' : 'Cliente creado', 'success');
    await cargarClientes();
    alGuardar?.(data);
  });
  openModal({ title: c ? 'Editar cliente' : 'Nuevo cliente', body: form,
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar')] });
  inputs.nombre.focus();
}

/* ── Ficha: datos y compras ──────────────────────────────────────────── */
async function fichaCliente(c) {
  const { data: ventas } = await db.from('ventas').select('id, created_at, total, medio_pago, anulada')
    .eq('cliente_id', c.id).order('created_at', { ascending: false }).limit(60);
  const compras = (ventas || []).filter(v => !v.anulada);
  openModal({
    title: c.nombre, wide: true,
    body: h('div', {},
      h('div', { class: 'ficha-top' },
        h('div', { class: 'muted' }, [c.telefono, c.email, c.cuit_dni].filter(Boolean).join(' · ') || 'Sin datos de contacto',
          c.notas ? h('div', {}, c.notas) : null)),
      compras.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Compra'), h('th', { class: 'right' }, 'Total'))),
        h('tbody', {}, ...compras.map(v => h('tr', {},
          h('td', {}, fecha(v.created_at)), h('td', {}, `Nº ${v.id} · ${PAGOS[v.medio_pago] || v.medio_pago}`),
          h('td', { class: 'right num' }, money(v.total))))))) : h('p', { class: 'muted' }, 'Todavía no compró.')),
    foot: [h('button', { class: 'btn', onclick: () => editarCliente(c) }, icon('edit'), 'Editar')],
  });
}

function exportar() {
  const cols = [['nombre', 'Nombre'], ['telefono', 'Teléfono'], ['email', 'Mail'], ['cuit_dni', 'CUIT/DNI'], ['direccion', 'Dirección'],
                ['total_comprado', 'Total comprado'], ['notas', 'Notas']];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(c => c[1]).join(';'), ...estado.clientes.map(c => cols.map(([k]) => esc(c[k])).join(';'))].join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `clientes-danichap-${hoyISO()}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

export function iniciarClientes() {
  $('cli-search').addEventListener('input', render);
  $('cli-nuevo').addEventListener('click', () => editarCliente(null));
  $('cli-export').addEventListener('click', exportar);
  registrarVista('clientes', cargarClientes);
}
