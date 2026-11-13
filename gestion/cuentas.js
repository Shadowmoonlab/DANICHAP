// gestion/cuentas.js — Cuentas corrientes de proveedores: cuánto se le debe a cada uno, qué está vencido,
// pagos (enteros o en parte, aplicados a remitos), notas de crédito/débito y resumen por WhatsApp.
// Los saldos los calcula la base: cc_proveedores / cc_movimientos (docs/gestion-v18.sql). Lo que dice cada proveedor
// (resumenes_proveedor, docs/gestion-v19.sql, lo leen los robots scrapers/resumen-*.mjs) se compara en el detalle.
import {
  $, h, icon, vacio, db, toast, money, fechaCorta, hoyISO, openModal, closeModal, confirmar, registrarVista, unaVez,
  errorAmigable, estado, linkWhatsApp, proveedor,
} from './core.js?v=46';
import { numeroAR } from './texto.js?v=46';
import { repartirPago, ordenarCuentas, totalAdeudado, diasVencido, textoResumen, compararResumen, tituloMovimiento } from './cuentas-calc.js?v=46';

const MEDIOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', echeq: 'Echeq' };
const TRAMOS = [['vencido_30', 'vencido 1 a 30 días', 'chip-amber'], ['vencido_60', 'vencido 31 a 60 días', 'chip-vencido'],
  ['vencido_mas', 'vencido hace más de 60 días', 'chip-vencido']];
const cc = { filas: [], actual: null, movimientos: [], verAnulados: false };

/** Error de la base en palabras de Daniel: los avisos de las funciones (raise exception) ya vienen en castellano. */
const mensaje = (error, queNoSeHizo) => (error?.code === 'P0001' ? `${queNoSeHizo}: ${error.message}` : errorAmigable(error, queNoSeHizo));
const faltaSql = error => /cc_proveedores|cc_movimientos|pagos_proveedor/.test(error?.message ?? '') && /find|exist|schema cache/i.test(error.message);
const AVISO_SQL = 'Falta activar las cuentas corrientes en la base (docs/gestion-v18.sql).';

/* ── Lista: lo que se le debe a cada proveedor ───────────────────────── */
async function cargar() {
  const { data, error } = await db.rpc('cc_proveedores', {});
  if (error) {
    $('cc-total').replaceChildren();
    $('cc-lista').replaceChildren(vacio('error', faltaSql(error) ? AVISO_SQL : errorAmigable(error, 'No se pudieron traer las cuentas')));
    return;
  }
  cc.filas = ordenarCuentas(data || []);
  if (cc.actual) {
    const fila = cc.filas.find(f => f.proveedor === cc.actual);
    if (fila) return verDetalle(fila);
  }
  pintarLista();
}

const tramos = f => TRAMOS.filter(([k]) => Number(f[k]) > 0)
  .map(([k, texto, clase]) => h('span', { class: `chip ${clase}` }, `${money(f[k])} ${texto}`));

function pintarLista() {
  cc.actual = null;
  $('cc-detalle').classList.add('hidden');
  $('cc-lista').classList.remove('hidden');
  const conSaldo = cc.filas.filter(f => Number(f.saldo) !== 0);
  const sinSaldo = cc.filas.filter(f => Number(f.saldo) === 0);
  const vencido = cc.filas.reduce((s, f) => s + Number(f.vencido_30) + Number(f.vencido_60) + Number(f.vencido_mas), 0);
  $('cc-total').replaceChildren(h('div', { class: 'stats stats-2' },
    h('div', { class: 'card stat' }, h('div', { class: 'v num', id: 'cc-adeudado' }, money(totalAdeudado(cc.filas))), h('div', { class: 'l' }, 'Total que debés a proveedores')),
    h('div', { class: `card stat ${vencido > 0 ? 'bad' : 'good'}` }, h('div', { class: 'v num' }, money(vencido)), h('div', { class: 'l' }, vencido > 0 ? 'De eso, ya vencido' : 'Nada vencido'))));

  const fila = f => h('button', { class: 'cc-fila card', 'data-proveedor': f.proveedor, onclick: () => verDetalle(f) },
    h('div', { class: 'cc-fila-top' },
      h('b', { class: 'cc-nombre' }, f.nombre),
      h('span', { class: `cc-saldo num ${Number(f.saldo) < 0 ? 'ganancia' : ''}` }, Number(f.saldo) < 0 ? `${money(-f.saldo)} a favor` : money(f.saldo))),
    h('div', { class: 'cc-fila-info' },
      ...tramos(f),
      Number(f.al_dia) > 0 ? h('span', { class: 'chip chip-gray' }, `${money(f.al_dia)} al día`) : null,
      f.impago_desde ? h('span', { class: 'muted' }, `remito impago más viejo: ${fechaCorta(f.impago_desde)}`) : null));

  $('cc-lista').replaceChildren(
    conSaldo.length ? h('div', { class: 'cc-filas' }, ...conSaldo.map(fila))
      : vacio('task_alt', 'No le debés nada a ningún proveedor. Las compras que cargues en Recepción aparecen acá solas.'),
    sinSaldo.length ? h('details', { class: 'cc-sin-saldo' },
      h('summary', {}, `Proveedores sin deuda (${sinSaldo.length})`),
      h('div', { class: 'cc-filas' }, ...sinSaldo.map(fila))) : null);
}

/* ── Detalle de un proveedor ─────────────────────────────────────────── */
async function verDetalle(f) {
  cc.actual = f.proveedor;
  const [{ data, error }, resumen] = await Promise.all([
    db.rpc('cc_movimientos', { p_proveedor: f.proveedor }),
    ultimoResumen(f.proveedor),
  ]);
  if (error) return toast(mensaje(error, 'No se pudieron traer los movimientos'), 'error');
  if (cc.actual !== f.proveedor) return;   // tocó otro mientras cargaba
  cc.movimientos = data || [];
  $('cc-lista').classList.add('hidden');
  $('cc-total').replaceChildren();
  const det = $('cc-detalle');
  det.classList.remove('hidden');

  const impagos = remitosImpagos();
  const texto = textoResumen({ negocio: estado.config.nombre_negocio || 'DANICHAP', proveedor: f.nombre, saldo: Number(f.saldo), hoy: hoyISO(),
    remitos: impagos });
  const saldo = Number(f.saldo);
  // filter(Boolean): replaceChildren escribe "null" si el bloque del resumen o el botón de anulados no van
  det.replaceChildren(...[
    h('button', { class: 'btn btn-sm cc-volver', onclick: () => { cc.actual = null; cargar(); } }, icon('arrow_back'), 'Todos los proveedores'),
    h('div', { class: 'card card-pad cc-cabecera' },
      h('div', { class: 'cc-cab-top' },
        h('h3', {}, f.nombre),
        h('div', { class: 'cc-cab-saldo' },
          h('span', { class: 'label' }, saldo < 0 ? 'Saldo a favor tuyo' : 'Le debés'),
          h('span', { class: `cc-saldo-grande num ${saldo < 0 ? 'ganancia' : ''}`, id: 'cc-saldo' }, money(Math.abs(saldo))))),
      h('div', { class: 'cc-fila-info' },
        ...tramos(f),
        Number(f.al_dia) > 0 ? h('span', { class: 'chip chip-gray' }, `${money(f.al_dia)} al día`) : null,
        Number(f.a_cuenta) > 0 ? h('span', { class: 'chip chip-stock', title: 'Pagos que no se aplicaron a ningún remito: igual descuentan del saldo' }, `${money(f.a_cuenta)} pagado a cuenta`) : null),
      h('div', { class: 'cc-plazo' },
        icon('event'),
        h('span', {}, f.plazo_dias == null ? 'Sin plazo de pago (nunca figura vencido)' : `Plazo de pago: ${f.plazo_dias} días`),
        h('button', { class: 'btn btn-sm', id: 'cc-plazo', onclick: () => editarPlazo(f) }, icon('edit'), 'Cambiar plazo')),
      h('div', { class: 'cc-acciones' },
        h('button', { class: 'btn btn-green btn-lg', id: 'cc-pagar', onclick: () => registrarPago(f) }, icon('payments'), 'Registrar pago'),
        h('button', { class: 'btn btn-lg', id: 'cc-nota', onclick: () => registrarNota(f) }, icon('receipt'), 'Nota de crédito / débito'),
        h('a', { class: 'btn btn-lg', id: 'cc-whatsapp', href: linkWhatsApp(proveedor(f.proveedor)?.whatsapp, texto), target: '_blank', rel: 'noopener' },
          icon('chat'), 'Resumen por WhatsApp'))),
    bloqueResumen(resumen, saldo, impagos),
    h('h3', { class: 'sub-title' }, 'Movimientos'),
    h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl cc-tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Qué'), h('th', { class: 'right' }, 'Importe'), h('th', { class: 'right' }, 'Saldo'))),
      h('tbody', { id: 'cc-movs' }, ...filasMovimientos()))),
    botonAnulados()].filter(Boolean));
}

/* ── Lo que dice el proveedor (último resumen leído por los robots) ──── */
// Sin la tabla (falta docs/gestion-v19.sql) o sin resúmenes de este proveedor: no se muestra nada
async function ultimoResumen(prov) {
  const { data, error } = await db.from('resumenes_proveedor').select('fecha_lectura, saldo_segun_proveedor, detalle')
    .eq('proveedor', prov).order('fecha_lectura', { ascending: false }).limit(1);
  return error ? null : data?.[0] ?? null;
}

function bloqueResumen(r, saldoSistema, impagos) {
  if (!r) return null;
  const cmp = compararResumen({ saldoProveedor: Number(r.saldo_segun_proveedor), saldoSistema, docsProveedor: r.detalle, remitosSistema: impagos });
  const dif = cmp.diferencia;
  const explicacion = cmp.coinciden ? 'Coinciden: el proveedor dice lo mismo que tu sistema.'
    : dif > 0 ? `El proveedor dice que le debés ${money(dif)} más de lo que figura en tu sistema.`
      : `El proveedor dice que le debés ${money(-dif)} menos de lo que figura en tu sistema.`;
  const nombre = d => d.comprobante || 'Comprobante sin número';
  return h('div', { class: 'card card-pad cc-resumen', id: 'cc-resumen' },
    h('div', { class: 'cc-resumen-top' }, icon('fact_check'), h('b', {}, 'Resumen del proveedor'),
      h('span', { class: 'muted' }, `leído el ${fechaCorta(r.fecha_lectura)}`)),
    h('p', { class: 'cc-resumen-saldos num', id: 'cc-resumen-saldos' },
      `Según el proveedor ${money(r.saldo_segun_proveedor)} · Según tu sistema ${money(saldoSistema)} · Diferencia ${money(Math.abs(dif))}`),
    h('p', { class: cmp.coinciden ? 'cc-resumen-ok' : 'egreso' }, explicacion),
    cmp.docs.length ? h('details', { class: 'cc-resumen-docs', open: !cmp.coinciden || null },
      h('summary', {}, `Impagos según el proveedor (${cmp.docs.length})`),
      h('ul', { class: 'cc-resumen-lista' }, ...cmp.docs.map(d => h('li', {},
        h('span', {}, nombre(d), d.fecha ? h('span', { class: 'muted' }, ` · ${fechaCorta(d.fecha)}`) : null),
        h('b', { class: `num ${Number(d.saldo) < 0 ? 'ganancia' : ''}` }, Number(d.saldo) < 0 ? `${money(-d.saldo)} a favor` : money(d.saldo)),
        d.enSistema ? null : h('span', { class: 'chip chip-amber' }, Number(d.saldo) < 0 ? 'no está cargada' : 'no figura impago en tu sistema'))))) : null,
    cmp.soloSistema.length ? h('details', { class: 'cc-resumen-docs' },
      h('summary', {}, `Impagos en tu sistema que el proveedor no tiene pendientes (${cmp.soloSistema.length})`),
      h('ul', { class: 'cc-resumen-lista' }, ...cmp.soloSistema.map(x => h('li', {},
        h('span', {}, x.nro_comprobante ? `Nº ${x.nro_comprobante}` : 'Compra sin número', h('span', { class: 'muted' }, ` · ${fechaCorta(x.fecha)}`)),
        h('b', { class: 'num' }, money(x.pendiente)))))) : null);
}

// Lo anulado queda guardado pero escondido: si no, la lista se llena de renglones tachados
function botonAnulados() {
  const n = cc.movimientos.filter(m => m.anulado).length;
  if (!n) return null;
  const b = h('button', { class: 'btn btn-sm cc-ver-anulados', id: 'cc-ver-anulados', 'aria-pressed': String(cc.verAnulados) });
  const pintar = () => { b.replaceChildren(icon(cc.verAnulados ? 'visibility_off' : 'visibility'), cc.verAnulados ? 'Ocultar anulados' : `Ver anulados (${n})`); };
  b.addEventListener('click', () => {
    cc.verAnulados = !cc.verAnulados;
    b.setAttribute('aria-pressed', String(cc.verAnulados));
    $('cc-movs').replaceChildren(...filasMovimientos());
    pintar();
  });
  pintar();
  return b;
}

const remitosImpagos = () => cc.movimientos.filter(m => m.tipo === 'compra' && Number(m.pendiente) > 0)
  .map(m => ({ id: m.ref_id, fecha: m.fecha, pendiente: Number(m.pendiente), nro_comprobante: m.detalle.startsWith('Remito Nº ') ? m.detalle.slice(10) : null }));

function filasMovimientos() {
  if (!cc.movimientos.length) {
    return [h('tr', {}, h('td', { colspan: 4 }, vacio('receipt_long', 'Todavía no hay compras ni pagos con este proveedor. Las compras se cargan en Recepción.')))];
  }
  const hoy = hoyISO();
  return cc.movimientos.filter(m => cc.verAnulados || !m.anulado).map(m => {
    const resta = Number(m.haber) > 0;
    const info = [];
    if (m.tipo === 'compra') {
      const pend = Number(m.pendiente);
      const dias = diasVencido(m.vence, hoy);
      if (pend <= 0) info.push(h('span', { class: 'chip chip-stock' }, 'pagado'));
      else {
        if (pend < Number(m.debe)) info.push(h('span', { class: 'chip chip-gray' }, `falta pagar ${money(pend)}`));
        if (dias != null) info.push(h('span', { class: dias > 0 ? 'egreso' : 'muted' }, dias > 0 ? `vencido hace ${dias} ${dias === 1 ? 'día' : 'días'}` : `vence ${fechaCorta(m.vence)}`));
      }
    } else if (m.tipo === 'pago') {
      info.push(h('span', { class: 'muted' }, MEDIOS[m.medio] || m.medio));
      if (m.cheque_fecha_cobro) info.push(h('span', { class: 'muted' }, `se cobra el ${fechaCorta(m.cheque_fecha_cobro)}`));
      if (m.aplicado_a) info.push(h('span', { class: 'muted' }, `pagó ${m.aplicado_a}`));
      const aCuenta = Number(m.haber) - Number(m.aplicado);
      if (aCuenta > 0 && !m.anulado) info.push(h('span', { class: 'chip chip-stock' }, `${money(aCuenta)} a cuenta`));
    }
    const { titulo, detalle } = tituloMovimiento(m);   // las compras y pagos de la planilla importada son notas
    const anulable = (m.tipo === 'pago' || m.tipo.startsWith('nota_')) && !m.anulado;
    return h('tr', { class: [m.anulado ? 'anulada' : '', `cc-${m.tipo}`].join(' ').trim() },
      h('td', { class: 'num' }, fechaCorta(m.fecha)),
      h('td', {}, h('b', {}, titulo), detalle ? ` · ${detalle}` : null,
        m.anulado ? h('span', { class: 'muted' }, ' · anulado') : null,
        info.length ? h('div', { class: 'cc-mov-info' }, ...info) : null,
        // El botón va en la misma celda: en el celular una columna aparte quedaba afuera de la pantalla
        anulable ? h('button', { class: 'btn btn-sm btn-red cc-anular', title: `Anular ${titulo.toLowerCase()}`,
          onclick: () => anular(m, titulo) }, icon('block'), 'Anular') : null),
      h('td', { class: `right num cc-importe ${resta ? 'ganancia' : ''}` }, resta ? `− ${money(m.haber)}` : money(m.debe)),
      h('td', { class: 'right num cc-importe' }, money(m.saldo)));
  });
}

async function anular(m, titulo) {
  const importe = money(Number(m.haber) || Number(m.debe));
  if (!(await confirmar(`Anular ${titulo.toLowerCase()}`, `¿Anular ${titulo.toLowerCase()} del ${fechaCorta(m.fecha)} por ${importe}? No se borra: queda tachado y deja de contar en el saldo.`, { ok: 'Sí, anular', peligro: true }))) return;
  const { error } = await db.rpc(m.tipo === 'pago' ? 'anular_pago_proveedor' : 'anular_nota_proveedor', { p_id: m.ref_id });
  if (error) return toast(mensaje(error, 'No se anuló'), 'error');
  toast(`${titulo} anulad${/^(Nota|Compra)/.test(titulo) ? 'a' : 'o'}`);
  cargar();
}

/* ── Registrar pago ──────────────────────────────────────────────────── */
function registrarPago(f) {
  const remitos = remitosImpagos();
  const fechaIn = h('input', { class: 'input', type: 'date', value: hoyISO(), max: hoyISO(), 'aria-label': 'Fecha del pago' });
  // Texto y no type=number: "150.000" es ciento cincuenta mil (numeroAR), no 150
  const monto = h('input', { class: 'input input-xl num', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Monto del pago' });
  const medio = h('select', { class: 'select', 'aria-label': 'Cómo pagaste' }, ...Object.entries(MEDIOS).map(([k, v]) => h('option', { value: k }, v)));
  const chequeFecha = h('input', { class: 'input', type: 'date', 'aria-label': 'Fecha de cobro del cheque' });
  const campoCheque = h('div', { class: 'field hidden' }, h('label', { class: 'label' }, 'Fecha de cobro del cheque'), chequeFecha);
  medio.addEventListener('change', () => campoCheque.classList.toggle('hidden', !['cheque', 'echeq'].includes(medio.value)));
  const nota = h('input', { class: 'input', placeholder: 'Opcional. Ej: Nº de cheque', 'aria-label': 'Nota del pago' });

  const casillas = remitos.map(r => ({ r, input: h('input', { type: 'checkbox', checked: true, 'aria-label': `Aplicar a ${r.nro_comprobante ? `Nº ${r.nro_comprobante}` : 'compra'} del ${fechaCorta(r.fecha)}` }),
    aplica: h('b', { class: 'num cc-aplica' }) }));
  const resumen = h('div', { class: 'cc-reparto-res', 'aria-live': 'polite' });
  let reparto = { aplicaciones: [], aCuenta: 0 };
  const recalcular = () => {
    reparto = repartirPago(numeroAR(monto.value) || 0, casillas.filter(c => c.input.checked).map(c => c.r));
    for (const c of casillas) {
      const a = reparto.aplicaciones.find(x => x.recepcion_id === c.r.id);
      c.aplica.textContent = a ? `paga ${money(a.monto)}` : '';
    }
    const valor = numeroAR(monto.value) || 0;
    resumen.textContent = !valor ? '' : reparto.aCuenta > 0
      ? `${remitos.length ? 'Sobran' : 'Quedan'} ${money(reparto.aCuenta)}: quedan a cuenta (igual bajan el saldo).`
      : 'Todo el pago se aplica a los remitos tildados.';
  };
  monto.addEventListener('input', recalcular);
  casillas.forEach(c => c.input.addEventListener('change', recalcular));

  const guardar = unaVez(async () => {
    const valor = numeroAR(monto.value);
    if (!(valor > 0)) { toast('Escribí cuánto pagaste', 'error'); monto.focus(); return; }
    recalcular();
    const { data, error } = await db.rpc('registrar_pago_proveedor', { p: {
      proveedor: f.proveedor, fecha: fechaIn.value || hoyISO(), monto: valor, medio: medio.value,
      cheque_fecha_cobro: ['cheque', 'echeq'].includes(medio.value) ? chequeFecha.value || null : null,
      nota: nota.value.trim() || null, aplicaciones: reparto.aplicaciones,
    } });
    if (error) { toast(mensaje(error, 'No se guardó el pago'), 'error'); return; }
    closeModal();
    toast(`Pago Nº ${data} de ${money(valor)} a ${f.nombre} guardado`);
    cargar();
  });

  openModal({
    title: `Pago a ${f.nombre}`,
    body: h('div', {},
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Cuánto pagaste ($)'), monto),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Cómo pagaste'), medio),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Fecha'), fechaIn)),
      campoCheque,
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Nota'), nota),
      remitos.length
        ? h('div', { class: 'field' }, h('label', { class: 'label' }, 'Qué remitos pagás'),
            h('p', { class: 'hint cc-hint' }, 'Se paga primero el más viejo. Destildá el que no quieras pagar ahora.'),
            h('div', { class: 'cc-reparto' }, ...casillas.map(({ r, input, aplica }) => h('label', { class: 'check cc-remito' }, input,
              h('span', {}, r.nro_comprobante ? `Nº ${r.nro_comprobante}` : 'Compra', h('span', { class: 'muted' }, ` · ${fechaCorta(r.fecha)} · debe ${money(r.pendiente)}`)),
              aplica))))
        : h('p', { class: 'hint' }, 'No hay remitos sin pagar: el pago queda a cuenta y baja el saldo igual.'),
      resumen),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-green', onclick: guardar }, icon('save'), 'Guardar pago')],
  });
  monto.focus();   // ya está en pantalla: con un setTimeout el foco volvía acá si se pasaba rápido a otro campo
}

/* ── Nota de crédito / débito ────────────────────────────────────────── */
function registrarNota(f) {
  const tipo = h('select', { class: 'select', 'aria-label': 'Tipo de nota' },
    h('option', { value: 'credito' }, 'Nota de crédito (te descuenta: devolución, bonificación)'),
    h('option', { value: 'debito' }, 'Nota de débito (te suma: flete, intereses)'));
  const fechaIn = h('input', { class: 'input', type: 'date', value: hoyISO(), max: hoyISO(), 'aria-label': 'Fecha de la nota' });
  const monto = h('input', { class: 'input input-xl num', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Monto de la nota' });
  const motivo = h('input', { class: 'input', placeholder: 'Ej: devolución de 2 faros', 'aria-label': 'Motivo' });
  const compras = cc.movimientos.filter(m => m.tipo === 'compra');
  const remito = h('select', { class: 'select', 'aria-label': 'Remito de la nota' }, h('option', { value: '' }, 'Ninguno en especial'),
    ...compras.map(m => h('option', { value: m.ref_id }, `${m.detalle} · ${fechaCorta(m.fecha)} · ${money(m.debe)}`)));

  const guardar = unaVez(async () => {
    const valor = numeroAR(monto.value);
    if (!(valor > 0)) { toast('Escribí el monto de la nota', 'error'); monto.focus(); return; }
    const { error } = await db.rpc('registrar_nota_proveedor', { p: {
      proveedor: f.proveedor, fecha: fechaIn.value || hoyISO(), tipo: tipo.value, monto: valor,
      motivo: motivo.value.trim() || null, recepcion_id: remito.value || null,
    } });
    if (error) { toast(mensaje(error, 'No se guardó la nota'), 'error'); return; }
    closeModal();
    toast(`Nota de ${tipo.value === 'credito' ? 'crédito' : 'débito'} de ${money(valor)} guardada`);
    cargar();
  });

  openModal({
    title: `Nota de ${f.nombre}`,
    body: h('div', {},
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Qué nota es'), tipo),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Monto ($)'), monto),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Fecha'), fechaIn),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Motivo'), motivo)),
      compras.length ? h('div', { class: 'field' }, h('label', { class: 'label' }, 'De qué remito (opcional)'), remito) : null),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar nota')],
  });
  monto.focus();   // ya está en pantalla: con un setTimeout el foco volvía acá si se pasaba rápido a otro campo
}

/* ── Plazo de pago ───────────────────────────────────────────────────── */
function editarPlazo(f) {
  const dias = h('input', { class: 'input input-xl num', type: 'number', min: 0, max: 365, inputmode: 'numeric', value: f.plazo_dias ?? '',
    placeholder: 'Ej: 30', 'aria-label': 'Plazo de pago en días' });
  const guardar = unaVez(async () => {
    const txt = dias.value.trim();
    const valor = txt === '' ? null : Number(txt);
    if (valor != null && !(Number.isInteger(valor) && valor >= 0 && valor <= 365)) { toast('El plazo va en días: un número de 0 a 365', 'error'); dias.focus(); return; }
    const { error } = await db.from('proveedores').update({ plazo_dias: valor }).eq('slug', f.proveedor);
    if (error) { toast(mensaje(error, 'No se guardó el plazo'), 'error'); return; }
    const p = proveedor(f.proveedor);
    if (p) p.plazo_dias = valor;
    closeModal();
    toast(valor == null ? `${f.nombre}: sin plazo de pago` : `${f.nombre}: plazo de ${valor} días`);
    cargar();
  });
  dias.addEventListener('keydown', e => { if (e.key === 'Enter') guardar(); });
  openModal({
    title: `Plazo de pago de ${f.nombre}`,
    body: h('div', {},
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Plazo de pago (días)'), dias),
      h('p', { class: 'hint cc-hint' }, 'Cuántos días te da para pagar cada remito. Pasado ese plazo, figura como vencido. Dejalo vacío si no tiene plazo.')),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar')],
  });
  dias.focus(); dias.select();
}

/* ── Inicio ──────────────────────────────────────────────────────────── */
export function iniciarCuentas() {
  registrarVista('cuentas', () => { cc.actual = null; cc.verAnulados = false; cargar(); });
}
