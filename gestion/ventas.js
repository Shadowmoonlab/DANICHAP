// gestion/ventas.js — Historial de ventas con ganancia real y cierre de caja por forma de pago.
import { $, h, icon, vacio, db, toast, money, fecha, fechaCorta, PAGOS, hoyISO, openModal, closeModal, confirmar, registrarVista, unaVez } from './core.js?v=33';
import { imprimirComprobante } from './comprobante.js?v=33';
import { calcularCierre, leerDiferencia } from './caja-calc.js?v=33';
import { numeroAR } from './texto.js?v=33';

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
  // Ventas con algún artículo sin costo (ej. "A mano" sin costo): su ganancia no es $0, es desconocida
  const ids = validas.map(v => v.id);
  const { data: sinCostoItems } = ids.length
    ? await db.from('venta_items').select('venta_id').in('venta_id', ids).is('costo_unit', null)
    : { data: [] };
  if (yo !== pedidoVentas) return;
  const sinCosto = new Set((sinCostoItems || []).map(i => i.venta_id));
  const vendido = validas.reduce((s, v) => s + Number(v.total), 0);
  const ganancia = validas.reduce((s, v) => s + Number(v.ganancia), 0);
  $('st-vendido').textContent = money(vendido);
  $('st-ganancia').textContent = money(ganancia);
  const nSin = validas.filter(v => sinCosto.has(v.id)).length;
  $('st-ganancia-nota').textContent = nSin ? `${nSin === 1 ? '1 venta' : `${nSin} ventas`} sin costo: tocala y cargá el costo` : 'Ganancia';
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
    h('td', { class: 'right num ganancia' }, money(v.ganancia),
      !v.anulada && sinCosto.has(v.id) ? h('span', { class: 'chip chip-amber', style: 'margin-left:6px', title: 'Tocá la venta y cargá el costo para saber cuánto ganaste' }, 'sin costo') : null))));
}

export async function verVenta(v) {
  const { data: items, error: errItems } = await db.from('venta_items').select('id, codigo, descripcion, cantidad, precio_unit, costo_unit').eq('venta_id', v.id);
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
          // La ganancia de cada artículo se puede cambiar siempre (costo en $ o ganancia en %), no solo si faltaba
          h('td', { class: 'right num ganancia', style: 'white-space:nowrap' },
            i.costo_unit != null ? money(i.cantidad * (i.precio_unit - i.costo_unit)) : (v.anulada ? h('span', { class: 'muted' }, 'sin costo') : null),
            !v.anulada ? h('button', { class: 'btn btn-sm', style: 'margin-left:6px', title: 'Cambiar el costo o la ganancia de este artículo', onclick: () => cargarCosto(v, i) },
              icon('edit'), i.costo_unit != null ? 'Cambiar' : 'Cargar costo') : null))))))),
    foot: [
      !v.anulada ? h('button', { class: 'btn btn-red', onclick: async () => {
        closeModal();
        if (!(await confirmar('Anular venta', `¿Anular la venta Nº ${v.id}? No se borra: queda tachada, deja de sumar en la caja y lo vendido vuelve al stock.`, { ok: 'Anular', peligro: true }))) return;
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

/* ── Costo de un artículo ya vendido (ej. "A mano" sin costo): con el costo o con la ganancia en % ── */
function cargarCosto(v, i) {
  const tiene = i.costo_unit != null && Number(i.costo_unit) > 0;
  const costo = h('input', { class: 'input num', inputmode: 'decimal', placeholder: '$', 'aria-label': 'Costo por unidad', value: tiene ? Math.round(i.costo_unit) : '' });
  const pct = h('input', { class: 'input num', inputmode: 'decimal', placeholder: '%', 'aria-label': 'Ganancia en %',
    value: tiene ? Math.round((i.precio_unit / i.costo_unit - 1) * 1000) / 10 : '' });
  const resumen = h('p', { class: 'muted' }, ' ');
  const leer = origen => {
    const c = numeroAR(costo.value), g = numeroAR(pct.value);
    // Si sabe el costo, la ganancia sale sola; si solo sabe cuánto le ganó (%), el costo sale del precio
    if (origen === 'pct' && g != null && g > -100) costo.value = Math.round(i.precio_unit / (1 + g / 100));
    if (origen === 'costo' && c > 0) pct.value = Math.round((i.precio_unit / c - 1) * 1000) / 10;
    const cf = numeroAR(costo.value);
    resumen.textContent = cf > 0 ? `Ganás ${money(i.cantidad * (i.precio_unit - cf))} en este artículo.` : ' ';
    return cf;
  };
  costo.addEventListener('input', () => leer('costo'));
  pct.addEventListener('input', () => leer('pct'));
  leer();   // si ya tenía costo, se ve cuánto gana ahora
  const guardar = unaVez(async () => {
    const c = leer();
    if (!(c > 0)) { toast('Poné el costo o la ganancia en %', 'error'); costo.focus(); return; }
    if (c > i.precio_unit && !(await confirmar('Costo mayor al precio', `El costo (${money(c)}) es más que lo que lo vendiste (${money(i.precio_unit)}). ¿Es correcto?`, { ok: 'Sí, es correcto', peligro: true }))) { cargarCosto(v, i); return; }
    const { error } = await db.rpc('cargar_costo_item', { p_item: i.id, p_costo: c });
    if (error) {
      toast(/cargar_costo_item/.test(error.message) ? 'Falta activar esto en la base (docs/gestion-v11.sql)' : error.message, 'error');
      return;
    }
    toast(`Ganancia actualizada: ${i.descripcion.slice(0, 40)}`, 'success');
    await cargar();
    const { data } = await db.from('ventas').select('id, created_at, cliente_nombre, medio_pago, total, costo_total, ganancia, impreso, anulada').eq('id', v.id).single();
    verVenta(data || v);
  });
  [costo, pct].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') guardar(); }));
  openModal({
    title: `Ganancia de "${i.descripcion.slice(0, 40)}"`,
    body: h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' }, `Lo vendiste a ${money(i.precio_unit)}${i.cantidad > 1 ? ` (x${i.cantidad})` : ''}. Poné lo que te costó, o cuánto le ganaste en %.`),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Costo por unidad ($)'), costo),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'o Ganancia (%)'), pct)),
      resumen),
    foot: [h('button', { class: 'btn', onclick: () => verVenta(v) }, 'Volver'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar costo')],
  });
  setTimeout(() => costo.focus(), 50);
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
      h('div', {}, h('span', {}, '+ Entró en efectivo (ventas y otros ingresos)'), h('b', { class: 'num ganancia' }, money(c.entra))),
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
