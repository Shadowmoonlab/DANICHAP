// gestion/ventas.js — Historial de ventas con ganancia real y cierre de caja por forma de pago.
import { $, h, icon, vacio, db, toast, money, fecha, fechaCorta, PAGOS, hoyISO, openModal, closeModal, confirmar, registrarVista, unaVez } from './core.js?v=14';
import { imprimirComprobante } from './comprobante.js?v=14';
import { calcularCierre, leerDiferencia } from './caja-calc.js?v=14';

let pedidoVentas = 0;   // si se cambia el filtro rápido, la respuesta vieja no pisa a la nueva
async function cargar() {
  // Una fecha borrada (se puede en el celular) vuelve a hoy en vez de romper la lista
  if (!$('ventas-desde').value) $('ventas-desde').value = hoyISO();
  if (!$('ventas-hasta').value) $('ventas-hasta').value = hoyISO();
  const desde = new Date(`${$('ventas-desde').value}T00:00:00`);
  const hasta = new Date(`${$('ventas-hasta').value}T23:59:59.999`);
  const yo = ++pedidoVentas;
  const { data, error } = await db.from('ventas')
    .select('id, created_at, cliente_nombre, medio_pago, total, costo_total, ganancia, impreso, anulada')
    .gte('created_at', desde.toISOString()).lte('created_at', hasta.toISOString())
    .order('created_at', { ascending: false }).limit(1000);
  if (yo !== pedidoVentas) return;
  const body = $('ventas-body');
  if (error) { body.replaceChildren(h('tr', {}, h('td', { colspan: 6 }, error.message))); return; }

  const validas = data.filter(v => !v.anulada);
  const vendido = validas.reduce((s, v) => s + Number(v.total), 0);
  const ganancia = validas.reduce((s, v) => s + Number(v.ganancia), 0);
  $('st-vendido').textContent = money(vendido);
  $('st-ganancia').textContent = money(ganancia);
  $('st-cant').textContent = validas.length;
  $('st-ticket').textContent = money(validas.length ? vendido / validas.length : 0);

  // Cierre de caja: cuánto entró por cada forma de pago
  const porPago = {};
  for (const v of validas) porPago[v.medio_pago] = (porPago[v.medio_pago] || 0) + Number(v.total);
  $('ventas-caja').replaceChildren(...Object.keys(PAGOS).filter(k => porPago[k]).map(k =>
    h('div', { class: 'caja-item' + (k === 'cuenta_corriente' ? ' fiado' : '') }, h('span', {}, PAGOS[k]), h('b', { class: 'num' }, money(porPago[k])))));
  $('ventas-caja').classList.toggle('hidden', !validas.length);

  if (!data.length) { body.replaceChildren(h('tr', {}, h('td', { colspan: 6 }, vacio('receipt_long', 'No hay ventas en estas fechas.')))); return; }
  body.replaceChildren(...data.map(v => h('tr', { class: 'clickable' + (v.anulada ? ' anulada' : ''), onclick: () => verVenta(v), tabindex: 0,
    onkeydown: e => { if (e.key === 'Enter') verVenta(v); } },
    h('td', { class: 'num' }, v.id), h('td', {}, fecha(v.created_at)),
    h('td', {}, v.cliente_nombre || h('span', { class: 'muted' }, 'Consumidor final')),
    h('td', {}, PAGOS[v.medio_pago] || v.medio_pago),
    h('td', { class: 'right num' }, h('b', {}, money(v.total))),
    h('td', { class: 'right num ganancia' }, money(v.ganancia)))));
}

export async function verVenta(v) {
  const { data: items, error: errItems } = await db.from('venta_items').select('codigo, descripcion, cantidad, precio_unit, costo_unit').eq('venta_id', v.id);
  // Sin los renglones no se muestra la venta: se imprimiría un comprobante vacío en $0
  if (errItems) { toast('No se pudieron leer los artículos de la venta: ' + errItems.message, 'error'); return; }
  openModal({
    title: `Venta Nº ${v.id}`, wide: true,
    body: h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' }, `${fecha(v.created_at)} · ${v.cliente_nombre || 'Consumidor final'} · ${PAGOS[v.medio_pago] || v.medio_pago}`,
        v.anulada ? ' · ANULADA' : ''),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Cant.'), h('th', {}, 'Descripción'), h('th', { class: 'right' }, 'Precio'), h('th', { class: 'right' }, 'Subtotal'), h('th', { class: 'right' }, 'Ganancia'))),
        h('tbody', {}, ...(items || []).map(i => h('tr', {}, h('td', {}, i.cantidad), h('td', {}, i.descripcion),
          h('td', { class: 'right num' }, money(i.precio_unit)), h('td', { class: 'right num' }, money(i.cantidad * i.precio_unit)),
          h('td', { class: 'right num ganancia' }, i.costo_unit != null ? money(i.cantidad * (i.precio_unit - i.costo_unit)) : h('span', { class: 'muted' }, 'sin costo')))))))),
    foot: [
      !v.anulada ? h('button', { class: 'btn btn-red', onclick: async () => {
        closeModal();
        if (!(await confirmar('Anular venta', `¿Anular la venta Nº ${v.id}? No se borra: queda tachada, deja de sumar en caja y cuenta corriente, y lo vendido vuelve al stock.`, { ok: 'Anular', peligro: true }))) return;
        // anular_venta (docs/gestion-v4.sql) devuelve el stock, saca lo pendiente de Reposición y reabre el presupuesto.
        // Sin ese SQL todavía aplicado, se anula como antes (solo la marca).
        let { error } = await db.rpc('anular_venta', { p_id: v.id });
        if (error && /anular_venta/.test(error.message) && /find|exist/i.test(error.message)) {
          ({ error } = await db.from('ventas').update({ anulada: true }).eq('id', v.id));
        }
        if (error) return toast(error.message, 'error');
        toast('Venta anulada'); cargar();
      } }, icon('block'), 'Anular') : null,
      h('button', { class: 'btn btn-primary', onclick: () => imprimirComprobante({ ...v, items: items || [] }) }, icon('print'), 'Imprimir comprobante'),
    ],
  });
}

/* ── Cierre de caja con arqueo: lo que hay que tener en efectivo vs. lo que se contó ── */
async function cerrarCaja() {
  const hoy = hoyISO();
  const [mov, previo] = await Promise.all([
    db.rpc('caja_del_dia', { p_fecha: hoy }),
    db.from('cierres_caja').select('fecha, efectivo_inicial, efectivo_contado, notas').order('fecha', { ascending: false }).limit(2),
  ]);
  if (previo.error) toast('No se pudo leer el cierre anterior: revisá el cambio inicial', 'error');
  if (mov.error) {
    toast(/caja_del_dia|cierres_caja/.test(mov.error.message) ? 'Falta activar el cierre de caja en la base (docs/gestion-v3.sql)' : mov.error.message, 'error');
    return;
  }
  const deHoy = (previo.data || []).find(c => c.fecha === hoy);
  const anterior = (previo.data || []).find(c => c.fecha < hoy);
  // El cambio con el que se abre suele ser lo que quedó contado al cerrar el día anterior
  const inicial = h('input', { class: 'input num', type: 'number', min: 0, step: 'any', inputmode: 'decimal',
    value: deHoy?.efectivo_inicial ?? anterior?.efectivo_contado ?? 0 });
  const contado = h('input', { class: 'input num input-xl', type: 'number', min: 0, step: 'any', inputmode: 'decimal',
    value: deHoy?.efectivo_contado ?? '', placeholder: 'Contá los billetes y poné el total' });
  const notas = h('input', { class: 'input', value: deHoy?.notas || '', placeholder: 'Opcional. Ej: faltante por vuelto mal dado' });
  const cuentas = h('div', { class: 'arqueo' });
  const resultado = h('div', { class: 'arqueo-res' });

  const calcular = () => {
    const c = calcularCierre(mov.data || [], Number(inicial.value) || 0);
    cuentas.replaceChildren(...[
      h('div', {}, h('span', {}, 'Cambio con el que abriste'), h('b', { class: 'num' }, money(Number(inicial.value) || 0))),
      h('div', {}, h('span', {}, '+ Entró en efectivo (ventas, cobros, otros ingresos)'), h('b', { class: 'num ganancia' }, money(c.entra))),
      h('div', {}, h('span', {}, '− Salió en efectivo (gastos y retiros)'), h('b', { class: 'num egreso' }, money(c.sale))),
      h('div', { class: 'arqueo-total' }, h('span', {}, 'Tendría que haber en la caja'), h('b', { class: 'num' }, money(c.esperado))),
      Object.keys(c.otros).length ? h('p', { class: 'hint' }, 'No van a la caja (quedan en el banco): ',
        Object.entries(c.otros).map(([m, v]) => `${PAGOS[m] || m} ${money(v)}`).join(' · ')) : null,
    ].filter(Boolean));
    if (contado.value === '') { resultado.replaceChildren(); return c; }
    const d = leerDiferencia(contado.value, c.esperado);
    resultado.className = `arqueo-res arqueo-${d.tipo}`;
    resultado.replaceChildren(icon(d.tipo === 'ok' ? 'check_circle' : 'warning'), d.texto);
    return c;
  };
  inicial.addEventListener('input', calcular);
  contado.addEventListener('input', calcular);
  calcular();

  const guardar = unaVez(async () => {
    if (contado.value === '') { toast('Poné cuánto contaste en la caja', 'error'); contado.focus(); return; }
    const c = calcular();
    const { error } = await db.from('cierres_caja').upsert({
      fecha: hoy, efectivo_inicial: Number(inicial.value) || 0, efectivo_esperado: c.esperado,
      efectivo_contado: Number(contado.value), otros_medios: c.otros, notas: notas.value.trim() || null,
    }, { onConflict: 'fecha' });
    if (error) { toast(error.message, 'error'); return; }
    closeModal();
    toast(`Caja cerrada: ${leerDiferencia(contado.value, c.esperado).texto.toLowerCase()}`, 'success');
  });
  openModal({
    title: `Cierre de caja · ${fechaCorta(hoy)}`,
    body: h('div', {},
      deHoy ? h('p', { class: 'hint' }, 'Ya cerraste la caja hoy. Si guardás de nuevo, se reemplaza.') : null,
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Cambio con el que abriste la caja ($)'), inicial),
      cuentas,
      h('div', { class: 'field' }, h('label', { class: 'label' }, '¿Cuánto efectivo contaste? ($)'), contado),
      resultado,
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Nota'), notas)),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('lock'), 'Cerrar caja')],
  });
  setTimeout(() => contado.focus(), 50);
}

export function iniciarVentas() {
  $('ventas-cerrar').addEventListener('click', cerrarCaja);
  $('ventas-desde').value = $('ventas-hasta').value = hoyISO();
  $('ventas-desde').addEventListener('change', cargar);
  $('ventas-hasta').addEventListener('change', cargar);
  $('ventas-hoy').addEventListener('click', () => { $('ventas-desde').value = $('ventas-hasta').value = hoyISO(); cargar(); });
  $('ventas-mes').addEventListener('click', () => {
    const hoy = hoyISO(); $('ventas-desde').value = hoy.slice(0, 8) + '01'; $('ventas-hasta').value = hoy; cargar();
  });
  registrarVista('ventas', cargar);
}
