// gestion/clientes.js — Agenda simple de clientes con cuenta corriente (fiado): saldo, pagos y recordatorio.
import {
  $, h, icon, vacio, db, toast, money, fecha, fechaCorta, estado, hoyISO, openModal, closeModal, confirmar,
  linkWhatsApp, registrarVista, PAGOS,
} from './core.js';
import { recordatorioSaldo } from './plantillas.js';

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
  const deuda = estado.clientes.reduce((s, c) => s + Math.max(0, Number(c.saldo)), 0);
  $('cli-deuda').textContent = deuda > 0.5 ? `Te deben ${money(deuda)} en cuenta corriente` : '';

  const body = $('cli-body');
  if (!lista.length) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: 5 }, vacio('group', estado.clientes.length ? 'Ningún cliente coincide.' : 'Todavía no cargaste clientes.'))));
    return;
  }
  body.replaceChildren(...lista.map(c => h('tr', { class: 'clickable', tabindex: 0, onclick: () => fichaCliente(c), onkeydown: e => { if (e.key === 'Enter') fichaCliente(c); } },
    h('td', {}, h('b', {}, c.nombre)),
    h('td', {}, c.telefono || h('span', { class: 'muted' }, '—')),
    h('td', {}, c.ultima_compra ? fechaCorta(c.ultima_compra) : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'right num' }, money(c.total_comprado)),
    h('td', { class: 'right num' }, Number(c.saldo) > 0.5 ? h('b', { class: 'saldo' }, money(c.saldo)) : h('span', { class: 'muted' }, '—')))));
}

/* ── Alta / edición ──────────────────────────────────────────────────── */
export function editarCliente(c, alGuardar) {
  const campos = [['nombre', 'Nombre o taller *'], ['telefono', 'Teléfono / WhatsApp'], ['cuit_dni', 'CUIT o DNI'],
                  ['email', 'Mail'], ['direccion', 'Dirección'], ['notas', 'Notas']];
  const inputs = {};
  const form = h('div', {}, ...campos.map(([k, l]) => h('div', { class: 'field' }, h('label', { class: 'label' }, l),
    inputs[k] = k === 'notas' ? h('textarea', { class: 'input', rows: 2 }, c?.[k] || '')
                              : h('input', { class: 'input', value: c?.[k] || '', type: k === 'email' ? 'email' : k === 'telefono' ? 'tel' : 'text' }))));
  const guardar = async () => {
    const datos = Object.fromEntries(campos.map(([k]) => [k, inputs[k].value.trim() || null]));
    if (!datos.nombre) { toast('Falta el nombre', 'error'); inputs.nombre.focus(); return; }
    datos.updated_at = new Date().toISOString();
    const q = c ? db.from('clientes').update(datos).eq('id', c.id) : db.from('clientes').insert(datos);
    const { data, error } = await q.select().single();
    if (error) { toast(error.message, 'error'); return; }
    closeModal(); toast(c ? 'Cliente actualizado' : 'Cliente creado', 'success');
    await cargarClientes();
    alGuardar?.(data);
  };
  openModal({ title: c ? 'Editar cliente' : 'Nuevo cliente', body: form,
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar')] });
  inputs.nombre.focus();
}

/* ── Ficha: cuenta corriente ─────────────────────────────────────────── */
async function fichaCliente(c) {
  const [{ data: ventas }, { data: pagos }] = await Promise.all([
    db.from('ventas').select('id, created_at, total, medio_pago, anulada').eq('cliente_id', c.id).order('created_at', { ascending: false }).limit(60),
    db.from('pagos_clientes').select('id, created_at, monto, medio, notas, anulado').eq('cliente_id', c.id).order('created_at', { ascending: false }).limit(60),
  ]);
  const movimientos = [
    ...(ventas || []).filter(v => !v.anulada).map(v => ({ fecha: v.created_at, tipo: 'venta', detalle: `Compra Nº ${v.id} · ${PAGOS[v.medio_pago]}`,
      debe: v.medio_pago === 'cuenta_corriente' ? Number(v.total) : 0, total: Number(v.total) })),
    ...(pagos || []).filter(p => !p.anulado).map(p => ({ fecha: p.created_at, tipo: 'pago', detalle: `Pago en ${(PAGOS[p.medio] || p.medio).toLowerCase()}${p.notas ? ' · ' + p.notas : ''}`,
      haber: Number(p.monto), id: p.id })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const saldo = Number(c.saldo) || 0;

  openModal({
    title: c.nombre, wide: true,
    body: h('div', {},
      h('div', { class: 'ficha-top' },
        h('div', { class: 'muted' }, [c.telefono, c.email, c.cuit_dni].filter(Boolean).join(' · ') || 'Sin datos de contacto',
          c.notas ? h('div', {}, c.notas) : null),
        h('div', { class: 'ficha-saldo' + (saldo > 0.5 ? ' debe' : '') }, h('span', { class: 'label' }, saldo > 0.5 ? 'Te debe' : 'Saldo'), h('b', { class: 'num' }, money(saldo)))),
      movimientos.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Detalle'), h('th', { class: 'right' }, 'Fiado'), h('th', { class: 'right' }, 'Pagó'), h('th', {}))),
        h('tbody', {}, ...movimientos.map(m => h('tr', {},
          h('td', {}, fecha(m.fecha)), h('td', {}, m.detalle, m.tipo === 'venta' && !m.debe ? h('span', { class: 'muted' }, ` · ${money(m.total)}`) : null),
          h('td', { class: 'right num' }, m.debe ? money(m.debe) : ''),
          h('td', { class: 'right num ganancia' }, m.haber ? money(m.haber) : ''),
          h('td', {}, m.tipo === 'pago' ? h('button', { class: 'btn btn-icon btn-sm btn-red', title: 'Anular pago', 'aria-label': 'Anular pago', onclick: async () => {
            closeModal();
            if (!(await confirmar('Anular pago', `¿Anular el pago de ${money(m.haber)}? El saldo vuelve a subir.`, { ok: 'Anular', peligro: true }))) return;
            await db.from('pagos_clientes').update({ anulado: true }).eq('id', m.id);
            await cargarClientes(); fichaCliente(estado.clientes.find(x => x.id === c.id));
          } }, icon('undo')) : null)))))) : h('p', { class: 'muted' }, 'Todavía no compró.')),
    foot: [
      h('button', { class: 'btn', onclick: () => editarCliente(c) }, icon('edit'), 'Editar'),
      saldo > 0.5 ? h('button', { class: 'btn', onclick: () => window.open(linkWhatsApp(c.telefono,
        recordatorioSaldo({ cliente: c.nombre, saldo, negocio: estado.config, alias: estado.config.alias_transferencia })), '_blank', 'noopener') },
        icon('chat'), 'Recordar saldo por WhatsApp') : null,
      h('button', { class: 'btn btn-green', onclick: () => registrarPago(c) }, icon('payments'), 'Registrar pago'),
    ],
  });
}

function registrarPago(c) {
  const monto = h('input', { class: 'input num', type: 'number', min: 1, inputmode: 'decimal', value: Number(c.saldo) > 0 ? Math.round(c.saldo) : '' });
  const medio = h('select', { class: 'select' }, ...['efectivo', 'transferencia', 'debito', 'credito'].map(m => h('option', { value: m }, PAGOS[m])));
  const guardar = async () => {
    const n = parseFloat(monto.value);
    if (!(n > 0)) { toast('Poné el monto', 'error'); return; }
    const { error } = await db.from('pagos_clientes').insert({ cliente_id: c.id, monto: n, medio: medio.value });
    if (error) { toast(error.message, 'error'); return; }
    closeModal(); toast(`Pago de ${money(n)} registrado`, 'success');
    await cargarClientes();
  };
  openModal({
    title: `Pago de ${c.nombre}`,
    body: h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Monto'), monto),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Cómo pagó'), medio)),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-green', onclick: guardar }, icon('payments'), 'Registrar pago')],
  });
  setTimeout(() => monto.select(), 0);
}

function exportar() {
  const cols = [['nombre', 'Nombre'], ['telefono', 'Teléfono'], ['email', 'Mail'], ['cuit_dni', 'CUIT/DNI'], ['direccion', 'Dirección'],
                ['total_comprado', 'Total comprado'], ['saldo', 'Saldo'], ['notas', 'Notas']];
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
