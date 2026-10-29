// gestion/libro.js — Libro diario: ventas, compras, gastos y resultado por día, mes o año; Excel para el contador.
// Los totales los calcula la base (libro_resumen / libro_movimientos, docs/add-libro-diario.sql).
import {
  $, h, icon, vacio, db, toast, money, PAGOS, hoyISO, openModal, closeModal, confirmar, registrarVista, cargarSheetJS, unaVez,
} from './core.js';
import {
  rangoPeriodo, moverPeriodo, periodoDeHoy, conResultados, totales, etiquetaFila, margen, etiquetaMovimiento,
  hojasExcel, TIPOS_MOV, CATEGORIAS,
} from './libro-calc.js';
import { verVenta } from './ventas.js';

const MEDIOS_MOV = { efectivo: 'Efectivo', transferencia: 'Transferencia', debito: 'Débito', credito: 'Crédito', otro: 'Otro' };
const hora = iso => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const estadoLibro = { modo: 'dia', ref: null, resumen: [], movimientos: [] };

/* ── Carga ─────────────────────────────────────────────────────────────── */
async function cargar() {
  const { modo } = estadoLibro;
  estadoLibro.ref ??= periodoDeHoy(modo, hoyISO());
  const p = rangoPeriodo(modo, estadoLibro.ref);
  sincronizarControles(p);

  const pedidos = [db.rpc('libro_resumen', { p_desde: p.desde, p_hasta: p.hasta, p_agrupar: p.agrupar })];
  if (modo === 'dia') pedidos.push(db.rpc('libro_movimientos', { p_desde: p.desde, p_hasta: p.hasta }));
  const [res, mov] = await Promise.all(pedidos);
  const error = res.error || mov?.error;
  if (error) {
    const falta = /libro_resumen|libro_movimientos|movimientos/.test(error.message) && /find|exist/i.test(error.message);
    $('libro-body').replaceChildren(h('tr', {}, h('td', { colspan: 8 },
      vacio('error', falta ? 'Falta activar el libro diario en la base (docs/add-libro-diario.sql).' : error.message))));
    return;
  }
  estadoLibro.resumen = res.data || [];
  estadoLibro.movimientos = mov?.data || [];
  pintarTotales(totales(estadoLibro.resumen));
  if (modo === 'dia') pintarMovimientos(); else pintarResumen(p.agrupar);
}

function sincronizarControles(p) {
  const { modo, ref } = estadoLibro;
  document.querySelectorAll('#libro-modos .subtab').forEach(b => b.classList.toggle('active', b.dataset.modo === modo));
  $('libro-titulo').textContent = p.titulo.charAt(0).toUpperCase() + p.titulo.slice(1);   // "Jueves 29 de octubre", no "De Octubre"
  for (const [id, m] of [['libro-dia', 'dia'], ['libro-mes', 'mes'], ['libro-anio', 'anio']]) {
    $(id).classList.toggle('hidden', m !== modo);
    if (m === modo) $(id).value = ref;
  }
  // No avanzar a períodos futuros
  $('libro-sig').disabled = moverPeriodo(modo, ref, 1) > periodoDeHoy(modo, hoyISO());
}

function pintarTotales(t) {
  $('lb-ventas').textContent = money(t.ventas);
  $('lb-ventas-n').textContent = `${t.cant_ventas} ${t.cant_ventas === 1 ? 'venta' : 'ventas'}`;
  $('lb-ganancia').textContent = money(t.ganancia);
  const mg = margen(t);
  $('lb-margen').textContent = mg == null ? 'sin ventas' : `margen ${String(mg).replace('.', ',')} %`;
  $('lb-compras').textContent = money(t.compras);
  $('lb-gastos').textContent = money(t.gastos);
  // Los retiros del dueño no son gasto (no bajan el resultado), pero sí salen de la caja
  $('lb-gastos-d').textContent = t.retiros ? `aparte: ${money(t.retiros)} de retiros` : 'alquiler, servicios, sueldos…';
  $('lb-resultado').textContent = money(t.resultado);
  $('lb-resultado-card').classList.toggle('good', t.resultado >= 0);
  $('lb-resultado-card').classList.toggle('bad', t.resultado < 0);
  $('libro-caja').replaceChildren(...[
    h('div', { class: 'caja-item' }, h('span', {}, 'Entró a caja'), h('b', { class: 'num' }, money(t.caja_entro))),
    h('div', { class: 'caja-item' }, h('span', {}, 'Salió de caja'), h('b', { class: 'num' }, money(t.caja_salio))),
    h('div', { class: 'caja-item ' + (t.caja_neto >= 0 ? 'caja-pos' : 'caja-neg') }, h('span', {}, 'Neto de caja'), h('b', { class: 'num' }, money(t.caja_neto))),
    t.fiado ? h('div', { class: 'caja-item fiado' }, h('span', {}, 'Vendido fiado'), h('b', { class: 'num' }, money(t.fiado))) : null,
    t.cobros ? h('div', { class: 'caja-item' }, h('span', {}, 'Cobrado de cta. cte.'), h('b', { class: 'num' }, money(t.cobros))) : null,
  ].filter(Boolean));
}

/* ── Vista día: cada movimiento ───────────────────────────────────────── */
function pintarMovimientos() {
  $('libro-head').replaceChildren(h('tr', {}, h('th', {}, 'Hora'), h('th', {}, 'Tipo'), h('th', {}, 'Detalle'), h('th', {}, 'Medio'),
    h('th', { class: 'right' }, 'Importe'), h('th', { class: 'right' }, 'Entra'), h('th', { class: 'right' }, 'Sale'), h('th', { class: 'right' }, 'Ganancia')));
  const movs = estadoLibro.movimientos;
  if (!movs.length) {
    $('libro-body').replaceChildren(h('tr', {}, h('td', { colspan: 8 }, vacio('menu_book', 'No hay movimientos este día. Las ventas del Mostrador, las compras de Recepción y los gastos que cargues aparecen acá.'))));
    return;
  }
  $('libro-body').replaceChildren(...movs.map(m => {
    const abrir = m.tipo === 'venta' ? () => verVenta({ id: m.ref_id, created_at: m.momento, cliente_nombre: m.detalle, medio_pago: m.medio, total: m.importe, anulada: m.anulado })
      : ['gasto', 'retiro', 'ingreso'].includes(m.tipo) && !m.anulado ? () => anularMovimiento(m) : null;
    return h('tr', { class: [abrir ? 'clickable' : '', m.anulado ? 'anulada' : '', `mov-${m.tipo}`].join(' ').trim(),
      onclick: abrir, tabindex: abrir ? 0 : null, onkeydown: abrir ? e => { if (e.key === 'Enter') abrir(); } : null },
      h('td', { class: 'num' }, hora(m.momento)),
      h('td', {}, h('span', { class: `chip chip-mov chip-${m.tipo}` }, etiquetaMovimiento(m))),
      h('td', {}, m.detalle, m.categoria && m.categoria !== m.detalle ? h('span', { class: 'muted' }, ` · ${m.categoria}`) : null,
        m.tipo === 'venta' && m.medio === 'cuenta_corriente' ? h('span', { class: 'muted' }, ' · fiado: entra al cobrarlo') : null),
      h('td', {}, PAGOS[m.medio] || MEDIOS_MOV[m.medio] || '—'),
      h('td', { class: 'right num' }, money(m.importe)),
      h('td', { class: 'right num ganancia' }, Number(m.ingreso) ? money(m.ingreso) : ''),
      h('td', { class: 'right num egreso' }, Number(m.egreso) ? money(m.egreso) : ''),
      h('td', { class: 'right num ganancia' }, m.ganancia == null ? '' : money(m.ganancia)));
  }));
}

/* ── Vista mes (por día) y año (por mes) ──────────────────────────────── */
function pintarResumen(agrupar) {
  $('libro-head').replaceChildren(h('tr', {}, h('th', {}, agrupar === 'month' ? 'Mes' : 'Día'), h('th', { class: 'right' }, 'Ventas'),
    h('th', { class: 'right' }, 'Ganancia'), h('th', { class: 'right' }, 'Compras'), h('th', { class: 'right' }, 'Gastos'),
    h('th', { class: 'right' }, 'Resultado'), h('th', { class: 'right' }, 'Neto de caja'), h('th', {}, '')));
  const filas = estadoLibro.resumen.map(conResultados);
  if (!filas.length) {
    $('libro-body').replaceChildren(h('tr', {}, h('td', { colspan: 8 }, vacio('menu_book', 'No hay movimientos en este período.'))));
    return;
  }
  const t = totales(estadoLibro.resumen);
  const fila = (r, total) => {
    const bajar = total ? null : () => { estadoLibro.modo = agrupar === 'month' ? 'mes' : 'dia'; estadoLibro.ref = agrupar === 'month' ? r.periodo.slice(0, 7) : r.periodo; cargar(); };
    return h('tr', { class: total ? 'fila-total' : 'clickable', onclick: bajar, tabindex: bajar ? 0 : null, onkeydown: bajar ? e => { if (e.key === 'Enter') bajar(); } : null },
      h('td', {}, total ? 'Total' : etiquetaFila(r.periodo, agrupar), !total && r.cant_ventas ? h('span', { class: 'muted' }, ` · ${r.cant_ventas} v.`) : null),
      h('td', { class: 'right num' }, money(r.ventas)),
      h('td', { class: 'right num ganancia' }, money(r.ganancia)),
      h('td', { class: 'right num' }, r.compras ? money(r.compras) : ''),
      h('td', { class: 'right num egreso', title: r.retiros ? `Además ${money(r.retiros)} de retiros del dueño (no es gasto)` : null }, r.gastos ? money(r.gastos) : ''),
      h('td', { class: 'right num ' + (r.resultado >= 0 ? 'ganancia' : 'egreso') }, h('b', {}, money(r.resultado))),
      h('td', { class: 'right num ' + (r.caja_neto >= 0 ? '' : 'egreso') }, money(r.caja_neto)),
      h('td', { class: 'right muted' }, bajar ? icon('chevron_right') : ''));
  };
  $('libro-body').replaceChildren(...filas.map(r => fila(r, false)), fila(t, true));
}

/* ── Gastos, retiros y otros ingresos ─────────────────────────────────── */
function nuevoMovimiento() {
  const tipo = h('select', { class: 'select' }, ...Object.entries(TIPOS_MOV).map(([k, v]) => h('option', { value: k }, v)));
  const categoria = h('select', { class: 'select' });
  const llenarCategorias = () => categoria.replaceChildren(...CATEGORIAS[tipo.value].map(c => h('option', {}, c)));
  tipo.addEventListener('change', llenarCategorias);
  llenarCategorias();
  const fechaIn = h('input', { class: 'input', type: 'date', value: estadoLibro.modo === 'dia' ? estadoLibro.ref : hoyISO(), max: hoyISO() });
  const monto = h('input', { class: 'input num', type: 'number', min: 1, step: 'any', inputmode: 'decimal', placeholder: '0' });
  const medio = h('select', { class: 'select' }, ...Object.entries(MEDIOS_MOV).map(([k, v]) => h('option', { value: k }, v)));
  const detalle = h('input', { class: 'input', placeholder: 'Opcional. Ej: Edesur octubre' });

  const guardar = unaVez(async () => {
    const valor = Number(monto.value);
    if (!(valor > 0)) { toast('Ingresá el monto', 'error'); monto.focus(); return; }
    const { error } = await db.from('movimientos').insert({
      fecha: fechaIn.value || hoyISO(), tipo: tipo.value, categoria: categoria.value,
      descripcion: detalle.value.trim() || null, monto: valor, medio: medio.value,
    });
    if (error) { toast(error.message, 'error'); return; }
    closeModal();
    toast(`${TIPOS_MOV[tipo.value]} de ${money(valor)} guardado`, 'success');
    cargar();
  });
  openModal({
    title: 'Cargar gasto o movimiento',
    body: h('div', {},
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Qué es'), tipo),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Categoría'), categoria)),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Monto ($)'), monto),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Cómo se pagó'), medio)),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Fecha'), fechaIn),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Detalle'), detalle)),
      h('p', { class: 'hint' }, 'Las compras a proveedores se cargan solas desde Recepción; acá van los gastos del local.')),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar')],
  });
  setTimeout(() => monto.focus(), 50);
}

async function anularMovimiento(m) {
  if (!(await confirmar('Anular movimiento', `¿Anular "${m.detalle}" de ${money(m.importe)}? No se borra: queda tachado y deja de sumar.`, { ok: 'Anular', peligro: true }))) return;
  const { error } = await db.from('movimientos').update({ anulado: true }).eq('id', m.ref_id);
  if (error) return toast(error.message, 'error');
  toast('Movimiento anulado');
  cargar();
}

/* ── Excel e impresión ────────────────────────────────────────────────── */
async function descargarExcel() {
  const p = rangoPeriodo(estadoLibro.modo, estadoLibro.ref);
  let movimientos = estadoLibro.movimientos;
  if (estadoLibro.modo === 'mes') {   // el contador quiere el detalle del mes completo
    const { data, error } = await db.rpc('libro_movimientos', { p_desde: p.desde, p_hasta: p.hasta });
    if (error) return toast(error.message, 'error');
    movimientos = data;
  }
  try {
    const XLSX = await cargarSheetJS();
    const wb = XLSX.utils.book_new();
    for (const [nombre, filas] of hojasExcel({ titulo: p.titulo, agrupar: p.agrupar, resumen: estadoLibro.resumen, movimientos, pagos: { ...MEDIOS_MOV, ...PAGOS } })) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre);
    }
    XLSX.writeFile(wb, `danichap-libro-${estadoLibro.ref}.xlsx`);
  } catch (e) { toast(e.message, 'error'); }
}

function imprimir() {
  const p = rangoPeriodo(estadoLibro.modo, estadoLibro.ref);
  const t = totales(estadoLibro.resumen);
  const tabla = $('libro-tabla').cloneNode(true);
  $('print-area').replaceChildren(h('div', { class: 'cmp libro-print' },
    h('div', { class: 'cmp-head' }, h('h1', {}, 'Libro diario'), h('div', {}, p.titulo)),
    h('table', {}, h('tbody', {},
      ...[['Ventas', t.ventas], ['Ganancia bruta', t.ganancia], ['Compras a proveedores', t.compras], ['Gastos', t.gastos], ['Retiros del dueño', t.retiros],
        ['Resultado (ganancia − gastos)', t.resultado], ['Neto de caja', t.caja_neto]]
        .map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'right' }, money(v)))))),
    tabla));
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}

/* ── Inicio ───────────────────────────────────────────────────────────── */
export function iniciarLibro() {
  document.querySelectorAll('#libro-modos .subtab').forEach(b => b.addEventListener('click', () => {
    estadoLibro.modo = b.dataset.modo;
    estadoLibro.ref = periodoDeHoy(b.dataset.modo, hoyISO());
    cargar();
  }));
  $('libro-ant').addEventListener('click', () => { estadoLibro.ref = moverPeriodo(estadoLibro.modo, estadoLibro.ref, -1); cargar(); });
  $('libro-sig').addEventListener('click', () => { estadoLibro.ref = moverPeriodo(estadoLibro.modo, estadoLibro.ref, 1); cargar(); });
  $('libro-hoy').addEventListener('click', () => { estadoLibro.ref = periodoDeHoy(estadoLibro.modo, hoyISO()); cargar(); });
  for (const id of ['libro-dia', 'libro-mes', 'libro-anio']) {
    $(id).addEventListener('change', e => { if (e.target.value) { estadoLibro.ref = e.target.value; cargar(); } });
  }
  $('libro-nuevo').addEventListener('click', nuevoMovimiento);
  $('libro-excel').addEventListener('click', descargarExcel);
  $('libro-imprimir').addEventListener('click', imprimir);
  registrarVista('libro', cargar);
}
