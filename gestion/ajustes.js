// gestion/ajustes.js — Ganancia, redondeo, datos del comprobante y consumo de la lectura con IA.
import { $, h, db, toast, money, estado, registrarVista } from './core.js';

// Precio por millón de tokens del modelo de lectura (claude-opus-5-5), en USD
const PRECIO_IA = { input: 4, output: 20 };

function render() {
  const { config } = estado;
  $('cfg-ganancia').value = config.ganancia_pct;
  $('cfg-redondeo').value = String(config.redondeo || 1);
  $('cfg-nombre').value = config.nombre_negocio || '';
  $('cfg-dir').value = config.direccion || '';
  $('cfg-tel').value = config.telefono || '';
  $('cfg-alias').value = config.alias_transferencia || '';
  $('cfg-leyenda').value = config.leyenda_comprobante || '';
  $('cfg-dist').replaceChildren(
    h('p', { class: 'hint', style: 'margin-top:4px' }, 'Opcional: ganancia distinta por proveedor (vacío = usa la general).'),
    h('div', { class: 'grid2' }, ...estado.proveedores.map(p => h('div', { class: 'field' },
      h('label', { class: 'label' }, p.nombre),
      h('input', { class: 'input', type: 'number', min: 0, step: 0.5, 'data-dist': p.slug, placeholder: String(config.ganancia_pct),
        value: config.ganancias_distribuidor?.[p.slug] ?? '' })))));
  ejemploGanancia();
  cargarConsumoIA();
}

function ejemploGanancia() {
  const pct = Number($('cfg-ganancia').value) || 0;
  $('cfg-ejemplo').textContent = `Ejemplo: un repuesto que te cuesta $100.000 se vende a ${money(100000 * (1 + pct / 100))}.`;
}

async function cargarConsumoIA() {
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const { data, error } = await db.from('lecturas_ia').select('input_tokens, output_tokens').gte('created_at', inicioMes.toISOString());
  if (error) { $('cfg-ia').textContent = ''; return; }
  const ent = data.reduce((s, r) => s + r.input_tokens, 0);
  const sal = data.reduce((s, r) => s + r.output_tokens, 0);
  const usd = (ent * PRECIO_IA.input + sal * PRECIO_IA.output) / 1e6;
  $('cfg-ia').replaceChildren(
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, data.length), h('span', {}, 'facturas leídas este mes')),
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, `US$ ${usd.toFixed(2)}`), h('span', {}, 'costo estimado de la IA')),
    h('p', { class: 'hint', style: 'margin:8px 0 0' }, data.length ? `Promedio: US$ ${(usd / data.length).toFixed(3)} por factura.` : 'Cada factura leída cuesta unos centavos de dólar.'));
}

async function guardar() {
  const porDist = {};
  document.querySelectorAll('#cfg-dist input[data-dist]').forEach(i => { if (i.value !== '') porDist[i.dataset.dist] = Number(i.value); });
  const datos = {
    ganancia_pct: Number($('cfg-ganancia').value) || 0,
    ganancias_distribuidor: porDist,
    redondeo: Number($('cfg-redondeo').value) || 1,
    nombre_negocio: $('cfg-nombre').value.trim() || 'DANICHAP',
    direccion: $('cfg-dir').value.trim() || null,
    telefono: $('cfg-tel').value.trim() || null,
    alias_transferencia: $('cfg-alias').value.trim() || null,
    leyenda_comprobante: $('cfg-leyenda').value.trim() || 'Documento no válido como factura',
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('config_negocio').update(datos).eq('id', 1);
  if (error) { toast(error.message, 'error'); return; }
  estado.config = { ...estado.config, ...datos };
  toast('Ajustes guardados', 'success');
}

export function iniciarAjustes() {
  $('cfg-guardar').addEventListener('click', guardar);
  $('cfg-ganancia').addEventListener('input', ejemploGanancia);
  registrarVista('ajustes', render);
}
