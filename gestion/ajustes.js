// gestion/ajustes.js — Ganancia, redondeo, datos del comprobante y lectura con IA (límite y consumo).
import { $, h, db, toast, money, estado, registrarVista, confirmar, cargarSheetJS, hoyISO, unaVez } from './core.js?v=14';

// USD por millón de tokens (entrada / salida). Misma tabla que MODELOS en supabase/functions/_shared/leer-factura.js
const PRECIOS_IA = {
  'claude-opus-5-5':   { entrada: 4,   salida: 20 },
  'claude-sonnet-5-5': { entrada: 2,   salida: 10 },
  'claude-haiku-5-5':  { entrada: 0.1, salida: 0.5 },
};
const costoLectura = r => {
  if (String(r.modelo).startsWith('gemini')) return 0;   // plan gratuito de Google AI Studio
  const p = PRECIOS_IA[r.modelo] || PRECIOS_IA['claude-opus-5-5'];
  return (r.input_tokens * p.entrada + r.output_tokens * p.salida) / 1e6;
};
// Fijo: no se configura desde el panel (la base y la función de lectura también lo imponen)
const LIMITE_FACTURAS_DIA = 4;
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
  const limite = LIMITE_FACTURAS_DIA;
  const usd = data.reduce((s, r) => s + costoLectura(r), 0);
  $('cfg-ia').replaceChildren(
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, `${hoy} de ${limite}`), h('span', {}, 'facturas leídas hoy')),
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, data.length), h('span', {}, 'este mes')),
    h('div', { class: 'ia-stat' }, h('b', { class: 'num' }, `US$ ${usd.toFixed(2)}`), h('span', {}, 'costo del mes')),
    h('p', { class: 'hint' }, data.length ? `Promedio: US$ ${(usd / data.length).toFixed(3)} por factura.` : 'Cada factura leída cuesta unos centavos de dólar.'));
}

async function guardar() {
  // Una ganancia vacía o en 0 haría que el Mostrador venda todo al costo: nunca en silencio
  const pctTexto = $('cfg-ganancia').value.trim();
  if (pctTexto === '') { toast('Poné la ganancia general (%)', 'error'); $('cfg-ganancia').focus(); return; }
  if (Number(pctTexto) <= 0 && !(await confirmar('Ganancia en 0 %', 'Con 0 % se vende todo al precio de costo. ¿Guardar igual?', { ok: 'Guardar igual', peligro: true }))) return;
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
  cargarConsumoIA();
}

/* ── Copia de seguridad ──────────────────────────────────────────────── */
// El plan gratis de Supabase no guarda respaldos: esta es la copia del negocio. Los precios de proveedores
// no van (son ~160.000 filas y los robots los vuelven a traer solos cada mañana).
const TABLAS_COPIA = [
  ['ventas', 'Ventas'], ['venta_items', 'Ventas - artículos'], ['clientes', 'Clientes'], ['pagos_clientes', 'Pagos de clientes'],
  ['recepciones', 'Compras'], ['recepcion_items', 'Compras - artículos'], ['movimientos', 'Gastos e ingresos'],
  ['cierres_caja', 'Cierres de caja'], ['presupuestos', 'Presupuestos'], ['reposicion_items', 'Reposición'],
  ['productos', 'Productos web'], ['productos_costos', 'Costos', 'producto_id'], ['proveedores', 'Proveedores', 'slug'], ['config_negocio', 'Ajustes'],
];

// Tabla que todavía no existe (falta correr su SQL): se avisa y se sigue. Cualquier otro error (red, permisos)
// corta la copia: una copia incompleta que dice "Listo" es peor que ninguna.
const esTablaInexistente = e => e?.code === 'PGRST205' || e?.code === '42P01' || /does not exist|Could not find the table/i.test(e?.message ?? '');

async function leerTabla(tabla, clave = 'id') {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from(tabla).select('*').order(clave).range(desde, desde + 999);
    if (error) return { filas, error, falta: esTablaInexistente(error) };
    filas.push(...data);
    if (data.length < 1000) return { filas };
  }
}

const descargarCopia = unaVez(async () => {
  const estadoEl = $('cfg-backup-estado');
  try {
    const XLSX = await cargarSheetJS();
    const wb = XLSX.utils.book_new();
    let total = 0;
    const faltan = [];
    for (const [tabla, hoja, clave] of TABLAS_COPIA) {
      estadoEl.textContent = `Copiando ${hoja.toLowerCase()}…`;
      const { filas, error, falta } = await leerTabla(tabla, clave);
      if (error && falta) { faltan.push(hoja); continue; }
      if (error) throw new Error(`no pude leer ${hoja.toLowerCase()} (${error.message}). La copia NO se descargó: probá de nuevo en un rato`);
      // Objetos y listas (ej. artículos de un presupuesto) como texto, para que entren en una celda
      const planas = filas.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v])));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(planas.length ? planas : [{ '(sin datos)': '' }]), hoja.slice(0, 31));
      total += filas.length;
    }
    XLSX.writeFile(wb, `danichap-copia-${hoyISO()}.xlsx`);
    estadoEl.textContent = `Listo: ${total.toLocaleString('es-AR')} registros copiados.` + (faltan.length ? ` (Sin datos todavía: ${faltan.join(', ')})` : '');
    toast('Copia de seguridad descargada', 'success');
  } catch (e) {
    estadoEl.textContent = '';
    toast('No se pudo armar la copia: ' + e.message, 'error');
  }
});

export function iniciarAjustes() {
  $('cfg-backup').addEventListener('click', descargarCopia);
  $('cfg-guardar').addEventListener('click', guardar);
  $('cfg-ganancia').addEventListener('input', ejemploGanancia);
  registrarVista('ajustes', render);
}
