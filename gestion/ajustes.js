// gestion/ajustes.js — Ganancia, redondeo, datos del comprobante y lectura con IA (límite y consumo).
import { $, h, db, toast, money, estado, registrarVista } from './core.js';

// USD por millón de tokens (entrada / salida). Misma tabla que MODELOS en supabase/functions/_shared/leer-factura.js
const PRECIOS_IA = {
  'claude-opus-5-5':   { entrada: 4,   salida: 20 },
  'claude-sonnet-5-5': { entrada: 2,   salida: 10 },
  'claude-haiku-5-5':  { entrada: 0.1, salida: 0.5 },
};
const costoLectura = r => {
  const p = PRECIOS_IA[r.modelo] || PRECIOS_IA['claude-opus-5-5'];
  return (r.input_tokens * p.entrada + r.output_tokens * p.salida) / 1e6;
};
const inicioDiaArgentina = () => `${new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)}T03:00:00.000Z`;

function render() {
  const { config } = estado;
  $('cfg-ganancia').value = config.ganancia_pct;
  $('cfg-redondeo').value = String(config.redondeo || 1);
  $('cfg-nombre').value = config.nombre_negocio || '';
  $('cfg-dir').value = config.direccion || '';
  $('cfg-tel').value = config.telefono || '';
  $('cfg-alias').value = config.alias_transferencia || '';
  $('cfg-leyenda').value = config.leyenda_comprobante || '';
  $('cfg-limite-ia').value = config.lecturas_ia_por_dia ?? 4;
  $('cfg-dist').replaceChildren(
    h('p', { class: 'hint' }, 'Opcional: ganancia distinta por proveedor (vacío = usa la general).'),
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
  const { data, error } = await db.from('lecturas_ia').select('modelo, input_tokens, output_tokens, created_at').gte('created_at', inicioMes.toISOString());
  if (error) { $('cfg-ia').textContent = ''; return; }
  // Comparar como fechas: Postgres puede devolver "…-03:00" y el inicio del día está en "…Z"
  const desde = Date.parse(inicioDiaArgentina());
  const hoy = data.filter(r => Date.parse(r.created_at) >= desde).length;
  const limite = estado.config.lecturas_ia_por_dia ?? 4;
  const usd = data.reduce((s, r) => s + costoLectura(r), 0);
  $('cfg-ia').replaceChildren(
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, `${hoy} de ${limite}`), h('span', {}, 'facturas leídas hoy')),
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, data.length), h('span', {}, 'este mes')),
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, `US$ ${usd.toFixed(2)}`), h('span', {}, 'costo del mes')),
    h('p', { class: 'hint' }, data.length ? `Promedio: US$ ${(usd / data.length).toFixed(3)} por factura.` : 'Cada factura leída cuesta unos centavos de dólar.'));
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
    lecturas_ia_por_dia: Math.min(100, Math.max(0, parseInt($('cfg-limite-ia').value, 10) || 0)),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('config_negocio').update(datos).eq('id', 1);
  if (error) { toast(error.message, 'error'); return; }
  estado.config = { ...estado.config, ...datos };
  toast('Ajustes guardados', 'success');
  cargarConsumoIA();
}

export function iniciarAjustes() {
  $('cfg-guardar').addEventListener('click', guardar);
  $('cfg-guardar-ia').addEventListener('click', guardar);
  $('cfg-ganancia').addEventListener('input', ejemploGanancia);
  registrarVista('ajustes', render);
}
