// gestion/recepcion.js — Recepción de mercadería: foto/PDF de la factura → lectura con IA → revisión → stock.
// Criterio (ap-processor): no inventar números (lo ilegible se marca), no cargar dos veces el mismo
// comprobante, cruzar con lo pedido (precio y cantidad) y no tocar nada sin una confirmación explícita.
import {
  $, h, icon, vacio, db, toast, money, fechaCorta, estado, nombreProveedor, precioVenta, debounce,
  buscarStock, confirmar, registrarVista, actualizarBadgeRepo, hoyISO,
} from './core.js';
import { normalizar } from './texto.js';

const CATEGORIAS = [
  ['mecanica', 'Mecánica'], ['iluminacion', 'Iluminación'], ['faros', 'Faros'], ['opticas', 'Ópticas'],
  ['chaperio', 'Chapería'], ['paragolpes', 'Paragolpes'], ['refrigeracion', 'Refrigeración'],
  ['electricidad', 'Electricidad'], ['limpieza', 'Limpieza / Liqui Moly'], ['cerraduras', 'Cerraduras'],
];
const MAX_LADO = 2000; // px: suficiente para leer una factura, liviano para subir

let borrador = null;   // { proveedor, nro, fecha, total, origen, advertencias, filas: [...] }

/* ── Archivo → base64 (las fotos se achican antes de subir) ──────────── */
function leerComoBase64(file) {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => mal(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}

async function prepararArchivo(file) {
  if (file.type === 'application/pdf') return { archivo: await leerComoBase64(file), media_type: 'application/pdf' };
  if (!file.type.startsWith('image/')) throw new Error('Subí una foto o un PDF');
  const bmp = await createImageBitmap(file);
  const escala = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * escala), height: Math.round(bmp.height * escala) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.85));
  return { archivo: await leerComoBase64(blob), media_type: 'image/jpeg' };
}

/* ── Paso 1: elegir proveedor y archivo ──────────────────────────────── */
function selectProveedor(valor) {
  return h('select', { class: 'select', 'aria-label': 'Proveedor' },
    h('option', { value: '' }, 'Otro / sin proveedor'),
    ...estado.proveedores.filter(p => p.activo).map(p => h('option', { value: p.slug, selected: p.slug === valor ? true : null }, p.nombre)));
}

function pasoArchivo() {
  const preProv = sessionStorage.getItem('danichap-recepcion-prov') || '';
  sessionStorage.removeItem('danichap-recepcion-prov');
  const prov = selectProveedor(preProv);
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment', class: 'input' });
  const estadoLectura = h('div', { class: 'muted', style: 'min-height:22px;margin-top:8px' });
  const btnLeer = h('button', { class: 'btn btn-primary btn-lg', disabled: true }, icon('document_scanner'), 'Leer la factura');
  file.addEventListener('change', () => { btnLeer.disabled = !file.files.length; });

  btnLeer.addEventListener('click', async () => {
    btnLeer.disabled = true;
    estadoLectura.replaceChildren(h('span', { class: 'spinner-sm' }), ' Leyendo el comprobante… puede tardar hasta un minuto.');
    try {
      const entrada = await prepararArchivo(file.files[0]);
      const { data, error } = await db.functions.invoke('leer-factura', { body: { ...entrada, proveedor: nombreProveedor(prov.value) || null } });
      if (error) {
        let detalle = {};
        try { detalle = await error.context?.json?.(); } catch { /* sin cuerpo */ }
        if (detalle?.codigo === 'ia_no_configurada') {
          toast('La lectura automática todavía no está activada: cargala a mano', 'error');
          abrirEditor({ proveedor: prov.value, origen: 'manual', filas: [filaVacia()] });
          return;
        }
        throw new Error(detalle?.error || error.message);
      }
      const d = data.datos;
      if (data.uso) db.from('lecturas_ia').insert({ modelo: data.modelo, input_tokens: data.uso.input_tokens ?? 0, output_tokens: data.uso.output_tokens ?? 0 }).then(() => {});
      toast(`Leí ${d.renglones.length} renglones. Revisalos antes de guardar.`, 'success');
      abrirEditor({
        proveedor: prov.value, nro: d.numero || '', fecha: d.fecha || hoyISO(), total: d.total, origen: 'ia',
        advertencias: d.advertencias, preciosConIva: d.precios_con_iva, iaUso: data.uso ? { modelo: data.modelo, input_tokens: data.uso.input_tokens, output_tokens: data.uso.output_tokens } : null,
        filas: d.renglones.map(r => ({ ...filaVacia(), codigo: r.codigo || '', descripcion: r.descripcion,
          cantidad: r.cantidad ?? 1, costo: r.precio_unitario, legible: r.legible, nota: r.nota })),
      });
    } catch (e) {
      estadoLectura.textContent = '';
      btnLeer.disabled = false;
      toast('No se pudo leer: ' + e.message, 'error');
    }
  });

  $('recepcion-trabajo').replaceChildren(h('div', { class: 'card card-pad recep-paso' },
    h('h3', {}, '1. ¿Qué llegó?'),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Proveedor'), prov),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Foto o PDF de la factura / remito'), file)),
    h('p', { class: 'hint' }, 'Sacale una foto derecha y con buena luz. Después revisás todo antes de que se sume al stock.'),
    h('div', { class: 'acciones' },
      btnLeer,
      h('button', { class: 'btn btn-lg', onclick: () => abrirEditor({ proveedor: prov.value, origen: 'manual', filas: [filaVacia()] }) },
        icon('edit_note'), 'Cargar a mano'),
      h('button', { class: 'btn btn-lg', onclick: cargarLista }, 'Cancelar')),
    estadoLectura));
}

const filaVacia = () => ({ incluir: true, codigo: '', descripcion: '', cantidad: 1, costo: null, legible: true, nota: null,
  accion: 'solo', producto_id: null, producto_nombre: '', categoria: 'mecanica', precio_venta: null, repo: null, coincide: [] });

/* ── Paso 2: revisión ────────────────────────────────────────────────── */
async function abrirEditor(datos) {
  borrador = { nro: '', fecha: hoyISO(), total: null, advertencias: [], ...datos };
  await cruzarConPedidos();
  renderEditor();
}

/** Cruza cada renglón con lo pedido a ese proveedor y con los productos propios ya vinculados. */
async function cruzarConPedidos() {
  const prov = borrador.proveedor;
  if (!prov) return;
  const [{ data: pedidos }, { data: costos }] = await Promise.all([
    db.from('reposicion_items').select('id, cantidad, descripcion, estado, precio:precios_distribuidor!inner(codigo, descripcion, precio_neto, distribuidor)')
      .in('estado', ['pedido', 'pendiente']).eq('precio.distribuidor', prov),
    db.from('productos_costos').select('producto_id, costo, codigo_proveedor, producto:productos(nombre, precio)').eq('proveedor', prov),
  ]);
  const usados = new Set();
  for (const f of borrador.filas) {
    const cod = normalizar(f.codigo || '');
    const desc = normalizar(f.descripcion || '');
    const p = (pedidos || []).find(x => !usados.has(x.id) && ((cod && normalizar(x.precio.codigo) === cod) || (desc && normalizar(x.precio.descripcion) === desc)));
    if (p) { usados.add(p.id); f.repo = { id: p.id, cantidad: p.cantidad, costo: p.precio.precio_neto, estado: p.estado }; }
    const c = cod && (costos || []).find(x => normalizar(x.codigo_proveedor || '') === cod);
    if (c && f.accion === 'solo') { f.accion = 'stock'; f.producto_id = c.producto_id; f.producto_nombre = c.producto?.nombre || ''; f.costo_anterior = c.costo; }
  }
}

function chipsCoincidencia(f) {
  const chips = [];
  if (f.repo) {
    chips.push(h('span', { class: 'chip chip-stock' }, f.repo.estado === 'pedido' ? '✓ estaba pedido' : '✓ estaba en la lista'));
    if (f.cantidad && f.repo.cantidad !== Number(f.cantidad)) chips.push(h('span', { class: 'chip chip-amber' }, `pediste ${f.repo.cantidad}, llegaron ${f.cantidad}`));
    const ref = Number(f.repo.costo);
    if (f.costo != null && ref && Math.abs(f.costo - ref) / ref > 0.01) {
      const dif = f.costo - ref;
      chips.push(h('span', { class: `chip ${dif > 0 ? 'chip-amber' : 'chip-stock'}` }, `${dif > 0 ? 'subió' : 'bajó'} ${money(Math.abs(dif))} (${((dif / ref) * 100).toFixed(1)}%)`));
    }
  }
  if (f.costo_anterior != null && f.costo != null && Math.abs(f.costo - f.costo_anterior) / f.costo_anterior > 0.01) {
    chips.push(h('span', { class: 'chip chip-amber' }, `antes costaba ${money(f.costo_anterior)}`));
  }
  if (!f.legible) chips.push(h('span', { class: 'chip chip-amber', title: f.nota || '' }, '⚠ revisar: ' + (f.nota || 'no se leyó bien')));
  return chips;
}

function selectorProducto(f, alCambiar) {
  const wrap = h('div', { class: 'picker' });
  const input = h('input', { class: 'input input-sm', placeholder: 'Buscar producto…', value: f.producto_nombre, 'aria-label': 'Producto de tu stock' });
  const lista = h('div', { class: 'picker-list hidden' });
  input.addEventListener('input', debounce(async () => {
    const res = await buscarStock(input.value, 8);
    lista.replaceChildren(...res.map(p => h('div', { class: 'picker-op', onclick: () => {
      f.producto_id = p.id; f.producto_nombre = p.nombre; input.value = p.nombre; lista.classList.add('hidden'); alCambiar();
    } }, p.nombre, h('span', { class: 'muted' }, p.stock_cantidad != null ? ` · ${p.stock_cantidad} u.` : ''))));
    lista.classList.toggle('hidden', !res.length);
  }, 250));
  wrap.append(input, lista);
  return wrap;
}

function renderEditor() {
  const b = borrador;
  const prov = selectProveedor(b.proveedor);
  prov.addEventListener('change', async () => { b.proveedor = prov.value; b.filas.forEach(f => { f.repo = null; }); await cruzarConPedidos(); renderEditor(); });
  const nro = h('input', { class: 'input', value: b.nro, placeholder: '0001-00012345' });
  const avisoDup = h('div', { class: 'aviso hidden' });
  nro.addEventListener('change', async () => {
    b.nro = nro.value.trim();
    avisoDup.classList.add('hidden');
    if (!b.nro) return;
    let q = db.from('recepciones').select('id, created_at').eq('nro_comprobante', b.nro);
    q = b.proveedor ? q.eq('proveedor', b.proveedor) : q.is('proveedor', null);
    const { data } = await q.limit(1);
    if (data?.length) { avisoDup.textContent = `⚠ Este comprobante ya se cargó el ${fechaCorta(data[0].created_at)}. No lo cargues de nuevo.`; avisoDup.classList.remove('hidden'); }
  });
  const fechaIn = h('input', { class: 'input', type: 'date', value: b.fecha, onchange: e => { b.fecha = e.target.value; } });

  const filas = b.filas.map((f, i) => {
    const repintar = () => renderEditor();
    const accion = h('select', { class: 'select input-sm', 'aria-label': 'Qué hago con este renglón', onchange: e => { f.accion = e.target.value; repintar(); } },
      h('option', { value: 'stock', selected: f.accion === 'stock' ? true : null }, 'Sumar a mi stock'),
      h('option', { value: 'crear', selected: f.accion === 'crear' ? true : null }, 'Crear producto nuevo'),
      h('option', { value: 'solo', selected: f.accion === 'solo' ? true : null }, 'Solo registrar'));
    const detalleAccion = f.accion === 'stock' ? selectorProducto(f, repintar)
      : f.accion === 'crear' ? h('div', { class: 'crear' },
          h('select', { class: 'select input-sm', 'aria-label': 'Categoría', onchange: e => { f.categoria = e.target.value; } },
            ...CATEGORIAS.map(([v, l]) => h('option', { value: v, selected: v === f.categoria ? true : null }, l))),
          h('input', { class: 'input input-sm num', inputmode: 'decimal', 'aria-label': 'Precio de venta',
            placeholder: 'Precio venta', value: f.precio_venta ?? precioVenta(f.costo, b.proveedor) ?? '',
            onchange: e => { f.precio_venta = parseFloat(e.target.value.replace(',', '.')) || null; } }))
      : h('span', { class: 'muted', style: 'font-size:12px' }, 'No cambia el stock');
    return h('tr', { class: (f.legible ? '' : 'fila-revisar') + (f.incluir ? '' : ' fila-off') },
      h('td', {}, h('input', { type: 'checkbox', checked: f.incluir, 'aria-label': 'Incluir', onchange: e => { f.incluir = e.target.checked; repintar(); } })),
      h('td', {}, h('input', { class: 'input input-sm', value: f.codigo, 'aria-label': 'Código', onchange: e => { f.codigo = e.target.value.trim(); } })),
      h('td', {}, h('input', { class: 'input input-sm', value: f.descripcion, 'aria-label': 'Descripción', style: 'min-width:220px', onchange: e => { f.descripcion = e.target.value; } }),
        h('div', { class: 'chips' }, ...chipsCoincidencia(f))),
      h('td', {}, h('input', { class: 'input input-sm num', value: f.cantidad ?? '', inputmode: 'numeric', style: 'width:64px', 'aria-label': 'Cantidad',
        onchange: e => { f.cantidad = parseInt(e.target.value, 10) || null; repintar(); } })),
      h('td', {}, h('input', { class: 'input input-sm num', value: f.costo ?? '', inputmode: 'decimal', style: 'width:110px', 'aria-label': 'Costo unitario',
        placeholder: '¿?', onchange: e => { f.costo = parseFloat(e.target.value.replace(',', '.')); if (!Number.isFinite(f.costo)) f.costo = null; f.legible = f.costo != null; repintar(); } })),
      h('td', { class: 'right num' }, f.costo != null && f.cantidad ? money(f.costo * f.cantidad) : '—'),
      h('td', {}, accion, h('div', { style: 'margin-top:4px' }, detalleAccion)),
      h('td', {}, h('button', { class: 'btn btn-icon btn-red btn-sm', title: 'Quitar renglón', 'aria-label': 'Quitar renglón', onclick: () => { b.filas.splice(i, 1); repintar(); } }, icon('close'))));
  });

  const activas = b.filas.filter(f => f.incluir);
  const suma = activas.reduce((s, f) => s + (f.costo ?? 0) * (f.cantidad ?? 0), 0);
  const resumen = {
    stock: activas.filter(f => f.accion === 'stock').length,
    nuevos: activas.filter(f => f.accion === 'crear').length,
    pedidos: activas.filter(f => f.repo).length,
    revisar: activas.filter(f => !f.legible || f.costo == null || !f.cantidad || !f.descripcion.trim() || (f.accion === 'stock' && !f.producto_id)).length,
  };

  $('recepcion-trabajo').replaceChildren(h('div', { class: 'card card-pad' },
    h('h3', {}, '2. Revisá lo que llegó'),
    h('div', { class: 'grid4' },
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Proveedor'), prov),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Nº de comprobante'), nro),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Fecha'), fechaIn),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Total del comprobante'),
        h('div', { class: 'total-recep num' }, b.total != null ? money(b.total) : '—', b.preciosConIva === false ? h('span', { class: 'muted' }, ' (+IVA)') : null))),
    avisoDup,
    b.advertencias?.length ? h('div', { class: 'aviso' }, h('b', {}, 'Para revisar: '), b.advertencias.join(' · ')) : null,
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl tbl-recep' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Código'), h('th', {}, 'Descripción'), h('th', {}, 'Cant.'), h('th', {}, 'Costo unit.'), h('th', { class: 'right' }, 'Subtotal'), h('th', {}, 'Qué hago'), h('th', {}))),
      h('tbody', {}, ...filas))),
    h('button', { class: 'btn btn-sm', style: 'margin-top:10px', onclick: () => { b.filas.push(filaVacia()); renderEditor(); } }, icon('add'), 'Agregar renglón'),
    h('div', { class: 'recep-resumen' },
      h('div', {},
        h('div', { class: 'recep-total num' }, money(suma)),
        h('div', { class: 'muted' }, `${activas.length} renglones · ${resumen.stock} suman stock · ${resumen.nuevos} productos nuevos · ${resumen.pedidos} coinciden con pedidos`),
        resumen.revisar ? h('div', { class: 'falta' }, `⚠ ${resumen.revisar} renglón(es) incompletos: completá cantidad, costo o el producto antes de confirmar.`) : null),
      h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-lg', onclick: cargarLista }, 'Cancelar'),
        h('button', { class: 'btn btn-green btn-lg', disabled: !activas.length || resumen.revisar ? true : null, onclick: () => confirmarRecepcion(suma, resumen) },
          icon('inventory'), 'Confirmar y cargar')))));
}

async function confirmarRecepcion(suma, resumen) {
  const b = borrador;
  const activas = b.filas.filter(f => f.incluir);
  const ok = await confirmar('Confirmar recepción',
    `Se registra el comprobante${b.nro ? ' ' + b.nro : ''} de ${nombreProveedor(b.proveedor) || 'proveedor sin nombre'} por ${money(suma)}: ` +
    `${resumen.stock} artículos suman stock, se crean ${resumen.nuevos} productos nuevos` +
    `${resumen.pedidos ? ` y ${resumen.pedidos} pedidos quedan como recibidos` : ''}. ¿Confirmás?`, { ok: 'Sí, cargar' });
  if (!ok) return;
  const { data: id, error } = await db.rpc('confirmar_recepcion', { p: {
    proveedor: b.proveedor || null, nro_comprobante: b.nro || null, fecha: b.fecha || null, total: b.total ?? suma, origen: b.origen, ia_uso: b.iaUso ?? null,
    items: activas.map(f => ({
      codigo: f.codigo || null, descripcion: f.descripcion.trim(), cantidad: f.cantidad, costo_unit: f.costo,
      accion: f.accion, producto_id: f.accion === 'stock' ? f.producto_id : null, categoria: f.categoria,
      precio_venta: f.accion === 'crear' ? (f.precio_venta ?? precioVenta(f.costo, b.proveedor)) : null,
      reposicion_item_id: f.repo?.id ?? null,
    })),
  } });
  if (error) { toast(error.message, 'error'); return; }
  toast(`Recepción Nº ${id} cargada`, 'success');
  borrador = null;
  actualizarBadgeRepo();
  cargarLista();
}

/* ── Historial ───────────────────────────────────────────────────────── */
async function cargarLista() {
  borrador = null;
  $('recepcion-trabajo').replaceChildren(h('div', { class: 'recep-cta card card-pad' },
    h('div', {}, h('h3', { style: 'margin:0 0 4px' }, '¿Llegó mercadería?'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Sacale una foto a la factura o remito: se lee sola y se suma al stock cuando la confirmás.')),
    h('button', { class: 'btn btn-primary btn-lg', onclick: pasoArchivo }, icon('photo_camera'), 'Cargar factura o remito')));
  if (sessionStorage.getItem('danichap-recepcion-prov') !== null) pasoArchivo();

  const { data, error } = await db.from('recepciones')
    .select('id, proveedor, nro_comprobante, fecha, total, origen, created_at, recepcion_items(count)')
    .order('created_at', { ascending: false }).limit(30);
  const body = $('recepcion-body');
  if (error) { body.replaceChildren(h('tr', {}, h('td', { colspan: 6 }, error.message))); return; }
  if (!data.length) { body.replaceChildren(h('tr', {}, h('td', { colspan: 6 }, vacio('inventory_2', 'Todavía no cargaste mercadería.')))); return; }
  body.replaceChildren(...data.map(r => h('tr', {},
    h('td', {}, fechaCorta(r.fecha || r.created_at)),
    h('td', {}, r.proveedor ? nombreProveedor(r.proveedor) : h('span', { class: 'muted' }, 'Sin proveedor')),
    h('td', { class: 'muted' }, r.nro_comprobante || '—'),
    h('td', { class: 'right num' }, r.recepcion_items?.[0]?.count ?? 0),
    h('td', { class: 'right num' }, r.total != null ? money(r.total) : '—'),
    h('td', {}, h('span', { class: 'chip' + (r.origen === 'ia' ? '' : ' chip-gray') }, r.origen === 'ia' ? 'leída con IA' : 'a mano')))));
}

export function iniciarRecepcion() {
  registrarVista('recepcion', cargarLista);
}
