// gestion/recepcion.js — Recepción de mercadería: foto/PDF de la factura → lectura con IA → revisión → stock.
// Criterio (ap-processor): no inventar números (lo ilegible se marca), no cargar dos veces el mismo
// comprobante, cruzar con lo pedido (precio y cantidad) y no tocar nada sin una confirmación explícita.
import {
  $, h, icon, vacio, db, toast, money, fechaCorta, estado, nombreProveedor, precioVenta, debounce,
  buscarStock, confirmar, registrarVista, actualizarBadgeRepo, hoyISO, unaVez, aPesos,
} from './core.js?v=45';
import { normalizar, numeroAR } from './texto.js?v=45';

const CATEGORIAS = [
  ['mecanica', 'Mecánica'], ['iluminacion', 'Iluminación'], ['faros', 'Faros'], ['opticas', 'Ópticas'],
  ['chaperio', 'Chapería'], ['paragolpes', 'Paragolpes'], ['refrigeracion', 'Refrigeración'],
  ['electricidad', 'Electricidad'], ['limpieza', 'Limpieza / Liqui Moly'], ['cerraduras', 'Cerraduras'],
];
const MAX_LADO = 2000; // px: suficiente para leer una factura, liviano para subir
// Pagado al contado (Cuentas corrientes, docs/gestion-v18.sql): mismos medios que un pago a proveedor
const MEDIOS_CONTADO = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', echeq: 'Echeq' };

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
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'archivo-oculto' });
  const nombreArchivo = h('span', { class: 'archivo-nombre muted' }, 'Ningún archivo elegido');
  const elegir = h('label', { class: 'archivo-btn' }, file, icon('photo_camera'), h('span', {}, 'Sacar foto o elegir archivo'));
  const estadoLectura = h('div', { class: 'muted', style: 'min-height:22px;margin-top:8px' });
  const btnLeer = h('button', { class: 'btn btn-primary btn-lg', disabled: true }, icon('document_scanner'), 'Leer la factura');
  file.addEventListener('change', () => {
    btnLeer.disabled = !file.files.length;
    nombreArchivo.textContent = file.files[0]?.name || 'Ningún archivo elegido';
    nombreArchivo.classList.toggle('muted', !file.files.length);
  });

  btnLeer.addEventListener('click', async () => {
    btnLeer.disabled = true;
    estadoLectura.replaceChildren(h('span', { class: 'spinner-sm' }), ' Leyendo el comprobante… puede tardar hasta un minuto.');
    try {
      const entrada = await prepararArchivo(file.files[0]);
      const { data, error } = await db.functions.invoke('leer-factura', { body: { ...entrada, proveedor: nombreProveedor(prov.value) || null } });
      if (error) {
        let detalle = {};
        try { detalle = await error.context?.json?.(); } catch { /* sin cuerpo */ }
        if (['ia_no_configurada', 'limite_diario', 'limite'].includes(detalle?.codigo)) {
          toast(detalle.codigo === 'ia_no_configurada' ? 'La lectura automática todavía no está activada: cargala a mano' : detalle.error, 'error');
          abrirEditor({ proveedor: prov.value, origen: 'manual', filas: [filaVacia()] });
          return;
        }
        throw new Error(detalle?.error || error.message);
      }
      const d = data.datos;
      // El consumo lo registra la función del servidor (y controla el límite diario)
      toast(`Leí ${d.renglones.length} renglones. Revisalos antes de guardar.` +
        (data.limite_diario ? ` (hoy: ${data.lecturas_hoy} de ${data.limite_diario})` : ''), 'success');
      abrirEditor({
        proveedor: prov.value, nro: d.numero || '', fecha: d.fecha || hoyISO(), total: d.total, origen: 'ia',
        advertencias: d.advertencias, preciosConIva: d.precios_con_iva, iaUso: data.uso ? { modelo: data.modelo, input_tokens: data.uso.input_tokens, output_tokens: data.uso.output_tokens } : null,
        filas: d.renglones.map(r => ({ ...filaVacia(), codigo: r.codigo || '', descripcion: r.descripcion,
          cantidad: r.cantidad, costo: r.precio_unitario, legible: r.legible && r.cantidad != null, nota: r.nota })),
      });
    } catch (e) {
      // Cualquier falla (sin conexión, cupo agotado, foto ilegible): seguir a mano, sin perder el proveedor elegido
      estadoLectura.textContent = '';
      btnLeer.disabled = false;
      toast(`No se pudo leer la factura (${e.message}). Cargala a mano.`, 'error');
      abrirEditor({ proveedor: prov.value, origen: 'manual', filas: [filaVacia()] });
    }
  });

  $('recepcion-trabajo').replaceChildren(h('div', { class: 'card card-pad recep-paso' },
    h('h3', {}, '1. ¿Qué llegó?'),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Proveedor'), prov),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Foto o PDF de la factura / remito'), h('div', { class: 'archivo' }, elegir, nombreArchivo))),
    h('p', { class: 'hint' }, 'Sacale una foto derecha y con buena luz. Después revisás todo antes de que se sume al stock.'),
    h('div', { class: 'acciones' },
      btnLeer,
      h('button', { class: 'btn btn-lg', onclick: () => abrirEditor({ proveedor: prov.value, origen: 'manual', filas: [filaVacia()] }) },
        icon('edit_note'), 'Cargar a mano'),
      h('button', { class: 'btn btn-lg', onclick: cargarLista }, 'Cancelar')),
    estadoLectura));
}

/* ── Foto del producto nuevo: se achica a 1200 px y se sube al mismo lugar que las fotos del Admin ── */
const LADO_FOTO = 1200;
async function achicarFoto(archivo) {
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_FOTO / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * escala), height: Math.round(bmp.height * escala) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.88));
  return new File([blob], 'producto.jpg', { type: 'image/jpeg' });
}

function fotoProducto(f, repintar) {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'archivo-oculto' });
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    f.subiendoFoto = true; repintar();
    try {
      const { url, error } = await Productos.uploadImagen(await achicarFoto(input.files[0]));
      if (error) throw error;
      f.imagen_url = url;
    } catch (e) {
      toast('No se pudo subir la foto: ' + (e.message || e), 'error');
    } finally {
      f.subiendoFoto = false;
      if (borrador?.filas.includes(f)) repintar();   // si mientras subía se canceló o se quitó el renglón, no hay nada que repintar
    }
  });
  if (f.subiendoFoto) return h('span', { class: 'foto-prod muted' }, h('span', { class: 'spinner-sm' }), ' Subiendo foto…');
  return h('label', { class: 'foto-prod' + (f.imagen_url ? ' con-foto' : ''), title: f.imagen_url ? 'Cambiar la foto' : 'Sin foto se publica en la web sin imagen' },
    input, f.imagen_url ? h('img', { src: f.imagen_url, alt: 'Foto del producto' }) : icon('add_a_photo'),
    h('span', {}, f.imagen_url ? 'Cambiar foto' : 'Agregar foto'));
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
    if (p) { usados.add(p.id); f.repo = { id: p.id, cantidad: p.cantidad, costo: aPesos(p.precio.precio_neto, p.precio.distribuidor), estado: p.estado }; }
    const c = cod && (costos || []).find(x => normalizar(x.codigo_proveedor || '') === cod);
    if (c && f.accion === 'solo') { f.accion = 'stock'; f.producto_id = c.producto_id; f.producto_nombre = c.producto?.nombre || ''; f.costo_anterior = c.costo; }
  }
}

function chipsCoincidencia(f) {
  const chips = [];
  if (f.deLista) chips.push(h('span', { class: 'chip chip-stock' }, '✓ de la lista del proveedor'));
  if (f.noEnLista) chips.push(h('span', { class: 'chip chip-amber' }, 'este código no está en su lista: escribí la descripción'));
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
    let res;
    try { res = await buscarStock(input.value, 8); }
    catch { toast('No se pudo buscar en tu stock: revisá internet y escribí de nuevo', 'error'); return; }
    lista.replaceChildren(...res.map(p => h('div', { class: 'picker-op', onclick: () => {
      f.producto_id = p.id; f.producto_nombre = p.nombre; input.value = p.nombre; lista.classList.add('hidden'); alCambiar();
    } }, p.nombre, h('span', { class: 'muted' }, p.stock_cantidad != null ? ` · ${p.stock_cantidad} u.` : ''))));
    lista.classList.toggle('hidden', !res.length);
  }, 250));
  wrap.append(input, lista);
  return wrap;
}

// Dónde está el cursor dentro de la tabla (renglón + campo), para devolverlo ahí después de redibujar
function posicionDelCursor() {
  const el = document.activeElement;
  if (!el || !$('recepcion-trabajo')?.contains(el) || !el.getAttribute('aria-label')) return null;
  const tr = el.closest('tbody tr');
  return { fila: tr ? [...tr.parentElement.children].indexOf(tr) : -1, campo: el.getAttribute('aria-label'),
           ini: el.selectionStart, fin: el.selectionEnd };
}
function devolverCursor(pos) {
  if (!pos) return;
  const tr = pos.fila >= 0 ? $('recepcion-trabajo').querySelectorAll('.tbl-recep tbody tr')[pos.fila] : $('recepcion-trabajo');
  const el = tr?.querySelector(`[aria-label="${CSS.escape(pos.campo)}"]`);
  if (!el) return;
  el.focus();
  try { if (pos.ini != null) el.setSelectionRange(pos.ini, pos.fin); } catch { /* select/checkbox no tienen selección */ }
}

function renderEditor() {
  const b = borrador;
  const cursor = posicionDelCursor();
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
    const { data } = await q.limit(2);
    if (data?.some(r => r.id !== b.corrigiendo)) { avisoDup.textContent = `⚠ Este comprobante ya se cargó el ${fechaCorta(data[0].created_at)}. No lo cargues de nuevo.`; avisoDup.classList.remove('hidden'); }
  });
  const fechaIn = h('input', { class: 'input', type: 'date', value: b.fecha, onchange: e => { b.fecha = e.target.value; } });

  const filas = b.filas.map((f, i) => {
    // Se redibuja en la vuelta siguiente: así el cursor ya pasó al campo que Daniel tocó (con el mouse o Tab)
    // y se lo devuelve ahí. Redibujar en el mismo "change" reemplazaba ese campo y lo tipeado se perdía.
    const repintar = () => setTimeout(() => { if (borrador === b) renderEditor(); }, 0);
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
            oninput: e => { f.precio_venta = numeroAR(e.target.value) || null; } }),   // "12.500" = doce mil quinientos
          fotoProducto(f, repintar))
      : h('span', { class: 'muted', style: 'font-size:12px' }, 'No cambia el stock');
    return h('tr', { class: (f.legible ? '' : 'fila-revisar') + (f.incluir ? '' : ' fila-off') },
      h('td', {}, h('input', { type: 'checkbox', checked: f.incluir, 'aria-label': 'Incluir', onchange: e => { f.incluir = e.target.checked; repintar(); } })),
      h('td', {}, h('input', { class: 'input input-sm', value: f.codigo, 'aria-label': 'Código', placeholder: 'Código',
        oninput: e => { f.codigo = e.target.value.trim(); },
        onchange: async () => { if (await completarPorCodigo(f, b)) repintar(); },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.closest('tr').querySelector('[aria-label="Cantidad"]').focus(); } } })),
      h('td', {}, h('input', { class: 'input input-sm', value: f.descripcion, 'aria-label': 'Descripción', style: 'min-width:220px', oninput: e => { f.descripcion = e.target.value; } }),
        h('div', { class: 'chips' }, ...chipsCoincidencia(f))),
      h('td', {}, h('input', { class: 'input input-sm num', value: f.cantidad ?? '', inputmode: 'numeric', style: 'width:64px', 'aria-label': 'Cantidad',
        onfocus: e => e.target.select(),   // la cantidad arranca en 1: lo que se escribe la reemplaza ("3", no "13")
        oninput: e => { f.cantidad = parseInt(e.target.value, 10) || null; },
        onchange: () => { f.legible = f.costo != null && f.cantidad != null; repintar(); },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); f.legible = f.costo != null && f.cantidad != null;
          if (i === b.filas.length - 1) b.filas.push(filaVacia());
          b.enfocarCodigo = i + 1; setTimeout(() => { if (borrador === b) renderEditor(); }, 0); } } })),
      h('td', {}, h('input', { class: 'input input-sm num', value: f.costo ?? '', inputmode: 'decimal', style: 'width:110px', 'aria-label': 'Costo unitario',
        placeholder: '¿?', oninput: e => { f.costo = numeroAR(e.target.value); },
        onchange: () => { f.legible = f.costo != null && f.cantidad != null; repintar(); } })),
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
    subiendo: activas.some(f => f.subiendoFoto),
  };

  $('recepcion-trabajo').replaceChildren(h('div', { class: 'card card-pad' },
    b.corrigiendo ? h('div', { class: 'aviso' }, icon('edit'), h('b', {}, ` Corrigiendo la carga Nº ${b.corrigiendo}. `),
      'Cambiá lo que esté mal y tocá Guardar corrección: el stock y el Libro diario se ajustan solos.') : null,
    h('h3', {}, b.corrigiendo ? 'Corregir la carga' : '2. Revisá lo que llegó'),
    h('div', { class: 'grid4' },
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Proveedor'), prov),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Nº de comprobante'), nro),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Fecha'), fechaIn),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Total del comprobante'),
        h('div', { class: 'total-recep num' }, b.total != null ? money(b.total) : '—', b.preciosConIva === false ? h('span', { class: 'muted' }, ' (+IVA)') : null))),
    avisoDup,
    b.origen === 'manual' ? h('p', { class: 'hint', style: 'margin:8px 0 0' }, b.proveedor
      ? h('span', {}, 'Escribí el ', h('b', {}, 'código'), ' y tocá Enter: la descripción y el costo salen solos de la lista del proveedor. Poné la ', h('b', {}, 'cantidad'), ' y Enter para el siguiente.')
      : h('b', {}, 'Elegí primero el proveedor: así, al escribir el código, la descripción y el costo salen solos.')) : null,
    b.advertencias?.length ? h('div', { class: 'aviso' }, h('b', {}, 'Para revisar: '), b.advertencias.join(' · ')) : null,
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl tbl-recep' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Código'), h('th', {}, 'Descripción'), h('th', {}, 'Cant.'), h('th', {}, 'Costo unit.'), h('th', { class: 'right' }, 'Subtotal'), h('th', {}, 'Qué hago'), h('th', {}))),
      h('tbody', {}, ...filas))),
    h('button', { class: 'btn btn-sm', style: 'margin-top:10px', onclick: () => { b.filas.push(filaVacia()); renderEditor(); } }, icon('add'), 'Agregar renglón'),
    // Con proveedor: la compra queda "a pagar" en su cuenta corriente, salvo que se haya pagado en el momento
    b.proveedor && !b.corrigiendo ? h('div', { class: 'recep-contado' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.alContado, 'aria-label': 'Pagado al contado',
        onchange: e => { b.alContado = e.target.checked; renderEditor(); } }), 'Pagado al contado'),
      b.alContado ? h('select', { class: 'select input-auto', 'aria-label': 'Cómo se pagó',
        onchange: e => { b.medioContado = e.target.value; } },
        ...Object.entries(MEDIOS_CONTADO).map(([v, l]) => h('option', { value: v, selected: v === (b.medioContado || 'efectivo') ? true : null }, l))) : null,
      h('span', { class: 'muted' }, b.alContado ? 'Se anota el pago y la compra queda saldada.' : 'Si no, queda en su cuenta corriente como "a pagar".')) : null,
    h('div', { class: 'recep-resumen' },
      h('div', {},
        h('div', { class: 'recep-total num' }, money(suma)),
        h('div', { class: 'muted' }, `${activas.length} renglones · ${resumen.stock} suman stock · ${resumen.nuevos} productos nuevos · ${resumen.pedidos} coinciden con pedidos`),
        resumen.revisar ? h('div', { class: 'falta' }, `⚠ ${resumen.revisar} renglón(es) incompletos: completá cantidad, costo o el producto antes de confirmar.`) : null,
        resumen.subiendo ? h('div', { class: 'falta' }, 'Esperá a que termine de subir la foto.') : null),
      h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-lg', onclick: cargarLista }, 'Cancelar'),
        b.corrigiendo ? h('button', { class: 'btn btn-red btn-lg', onclick: e => anularRecepcion(e.currentTarget, b.corrigiendo) }, icon('delete'), 'Anular esta carga') : null,
        h('button', { class: 'btn btn-green btn-lg', disabled: !activas.length || resumen.revisar || resumen.subiendo ? true : null, onclick: e => confirmarRecepcion(e.currentTarget, suma, resumen) },
          icon(b.corrigiendo ? 'save' : 'inventory'), b.corrigiendo ? 'Guardar corrección' : 'Confirmar y cargar')))));
  devolverCursor(cursor);
  if (b.enfocarCodigo != null) {
    $('recepcion-trabajo').querySelectorAll('.tbl-recep tbody tr')[b.enfocarCodigo]?.querySelector('[aria-label="Código"]')?.focus();
    b.enfocarCodigo = null;
  }
}

/**
 * Carga a mano (pedido de Daniel, 12/11): con el proveedor elegido, el código trae la descripción y el costo de su
 * lista, y si ese código ya está vinculado a un producto de su stock, lo suma ahí. Devuelve true si cambió algo.
 */
async function completarPorCodigo(f, b) {
  f.deLista = false; f.noEnLista = false;
  if (!b.proveedor || !f.codigo) return true;
  const codigo = f.codigo.replace(/[\\%_]/g, m => '\\' + m);   // ilike sin comodines: el código tal cual, sin importar mayúsculas
  const [{ data: lista }, { data: propios }] = await Promise.all([
    db.from('precios_distribuidor').select('descripcion, precio_neto, precio_lista').eq('distribuidor', b.proveedor).eq('activo', true).ilike('codigo', codigo).limit(1),
    db.from('productos_costos').select('producto_id, costo, producto:productos(nombre)').eq('proveedor', b.proveedor).ilike('codigo_proveedor', codigo).limit(1),
  ]);
  const p = lista?.[0], propio = propios?.[0];
  if (!p && !propio) { f.noEnLista = true; return true; }
  if (p) {
    f.deLista = true;
    if (!f.descripcion.trim() || f.descripcionAuto) { f.descripcion = p.descripcion; f.descripcionAuto = true; }
    if (f.costo == null || f.costoAuto) { f.costo = aPesos(p.precio_neto ?? p.precio_lista, b.proveedor); f.costoAuto = true; }
  }
  if (propio) {
    f.accion = 'stock'; f.producto_id = propio.producto_id; f.producto_nombre = propio.producto?.nombre || '';
    f.costo_anterior = propio.costo;
    if (!f.descripcion.trim()) f.descripcion = f.producto_nombre;
  } else if (f.accion === 'solo') {
    f.accion = 'crear';   // no está en el stock todavía: se crea el producto con el precio de venta sugerido
  }
  f.legible = f.costo != null && f.cantidad != null;
  return true;
}

// unaVez + botón deshabilitado: un doble clic o una conexión lenta no cargan dos veces la misma compra
const confirmarRecepcion = unaVez(async (btn, suma, resumen) => {
  const b = borrador;
  const activas = b.filas.filter(f => f.incluir);
  const alContado = Boolean(b.proveedor && b.alContado && !b.corrigiendo);
  const medio = b.medioContado || 'efectivo';
  const ok = await confirmar(b.corrigiendo ? 'Guardar corrección' : 'Confirmar recepción',
    (b.corrigiendo ? `Se reemplaza la carga Nº ${b.corrigiendo}: se descuenta lo que había sumado y se carga así. ` : '') +
    `Se registra el comprobante${b.nro ? ' ' + b.nro : ''} de ${nombreProveedor(b.proveedor) || 'proveedor sin nombre'} por ${money(suma)}: ` +
    `${resumen.stock} artículos suman stock, se crean ${resumen.nuevos} productos nuevos` +
    `${resumen.pedidos ? ` y ${resumen.pedidos} pedidos quedan como recibidos` : ''}.` +
    `${alContado ? ` Queda pagada al contado (${MEDIOS_CONTADO[medio].toLowerCase()}).` : ''} ¿Confirmás?`, { ok: 'Sí, cargar' });
  if (!ok) return;
  btn.disabled = true;
  const datosRecepcion = {
    // Sin fecha la compra no aparecía en el Libro diario (se borra fácil en el celular): queda la de hoy
    proveedor: b.proveedor || null, nro_comprobante: b.nro || null, fecha: b.fecha || hoyISO(), total: b.total ?? suma, origen: b.origen, ia_uso: b.iaUso ?? null,
    items: activas.map(f => ({
      codigo: f.codigo || null, descripcion: f.descripcion.trim(), cantidad: f.cantidad, costo_unit: f.costo,
      accion: f.accion, producto_id: f.accion === 'stock' ? f.producto_id : null, categoria: f.categoria,
      precio_venta: f.accion === 'crear' ? (f.precio_venta ?? precioVenta(f.costo, b.proveedor)) : null,
      reposicion_item_id: f.repo?.id ?? null,
    })),
  };
  const { data: id, error } = b.corrigiendo
    ? await db.rpc('corregir_recepcion', { p_id: b.corrigiendo, p: datosRecepcion })
    : await db.rpc('confirmar_recepcion', { p: datosRecepcion });
  if (error) {
    btn.disabled = false;
    toast(/corregir_recepcion|function .* does not exist/i.test(error.message) ? 'Falta activar la corrección en la base (docs/gestion-v15.sql)' : error.message, 'error');
    return;
  }
  // confirmar_recepcion crea los productos en el orden de los renglones: se les pone la foto elegida
  const creadas = activas.filter(f => f.accion === 'crear');
  if (creadas.some(f => f.imagen_url)) {
    const { data: items } = await db.from('recepcion_items').select('producto_id').eq('recepcion_id', id).eq('accion', 'crear').order('id');
    const res = await Promise.all((items || []).map((it, i) => creadas[i]?.imagen_url && it.producto_id
      ? db.from('productos').update({ imagen_url: creadas[i].imagen_url }).eq('id', it.producto_id) : null));
    if (!items || res.some(r => r?.error)) toast('La compra quedó cargada, pero alguna foto no se guardó: ponela desde Admin → Productos', 'error');
  }
  // Pagado al contado: el pago por el total, aplicado a esta compra. Si falla, la compra igual queda cargada
  let pagada = false;
  if (alContado) {
    const { error: errorPago } = await db.rpc('registrar_pago_proveedor', { p: {
      proveedor: b.proveedor, fecha: datosRecepcion.fecha, monto: datosRecepcion.total, medio,
      nota: `Pagado al contado${b.nro ? ` · Nº ${b.nro}` : ''}`,
      aplicaciones: [{ recepcion_id: id, monto: datosRecepcion.total }],
    } });
    if (errorPago) {
      console.warn('[gestion] pago al contado:', errorPago.message);
      toast(`La compra Nº ${id} quedó cargada, pero el pago no se guardó. Cargalo desde Cuentas corrientes → ${nombreProveedor(b.proveedor)} → Registrar pago.`, 'error');
    } else pagada = true;
  }
  toast(b.corrigiendo ? `Carga corregida (ahora Nº ${id})` : `Recepción Nº ${id} cargada${pagada ? ' y pagada' : ''}`, 'success');
  borrador = null;
  actualizarBadgeRepo();
  cargarLista();
});

/* ── Historial ───────────────────────────────────────────────────────── */
async function cargarLista() {
  borrador = null;
  $('recepcion-trabajo').replaceChildren(h('div', { class: 'recep-cta card card-pad' },
    h('div', {}, h('h3', { style: 'margin:0 0 4px' }, '¿Llegó mercadería?'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Sacale una foto a la factura o remito (o cargala a mano): revisás los renglones y, al confirmar, se suma al stock y queda anotado como compra en el Libro diario.')),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn btn-primary btn-lg', onclick: pasoArchivo }, icon('photo_camera'), 'Cargar factura o remito'),
      // A mano, sin foto: siempre a la vista (antes solo aparecía después de elegir "Cargar factura")
      h('button', { class: 'btn btn-lg', onclick: () => abrirEditor({ proveedor: '', origen: 'manual', filas: [filaVacia()] }) },
        icon('edit_note'), 'Cargar a mano'))));
  if (sessionStorage.getItem('danichap-recepcion-prov') !== null) pasoArchivo();

  const { data, error } = await db.from('recepciones')
    .select('id, proveedor, nro_comprobante, fecha, total, origen, created_at, recepcion_items(count)')
    .order('created_at', { ascending: false }).limit(30);
  const body = $('recepcion-body');
  if (error) { body.replaceChildren(h('tr', {}, h('td', { colspan: 7 }, error.message))); return; }
  if (!data.length) { body.replaceChildren(h('tr', {}, h('td', { colspan: 7 }, vacio('inventory_2', 'Todavía no cargaste mercadería.')))); return; }
  body.replaceChildren(...data.map(r => h('tr', {},
    h('td', {}, fechaCorta(r.fecha || r.created_at)),
    h('td', {}, r.proveedor ? nombreProveedor(r.proveedor) : h('span', { class: 'muted' }, 'Sin proveedor')),
    h('td', { class: 'muted' }, r.nro_comprobante || '—'),
    h('td', { class: 'right num' }, r.recepcion_items?.[0]?.count ?? 0),
    h('td', { class: 'right num' }, r.total != null ? money(r.total) : '—'),
    h('td', {}, h('span', { class: 'chip' + (r.origen === 'ia' ? '' : ' chip-gray') }, r.origen === 'ia' ? 'leída con IA' : 'a mano')),
    h('td', { class: 'right' }, h('button', { class: 'btn btn-sm', onclick: () => corregirRecepcion(r) }, icon('edit'), 'Corregir')))));
}

/* ── Corregir / anular una carga hecha mal ──────────────────────────── */
async function corregirRecepcion(r) {
  const { data: items, error } = await db.from('recepcion_items')
    .select('codigo, descripcion, cantidad, costo_unit, accion, producto_id, reposicion_item_id, producto:productos(nombre)')
    .eq('recepcion_id', r.id).order('id');
  if (error) { toast(error.message, 'error'); return; }
  // Si el total era la suma de los renglones (carga a mano), al corregir se recalcula: si no, el Libro diario
  // seguía con la compra vieja. Si era el total leído de la factura (con IVA, por ej.), se respeta.
  const sumaVieja = (items || []).reduce((s, it) => s + Number(it.cantidad) * Number(it.costo_unit ?? 0), 0);
  const total = r.total != null && Math.abs(Number(r.total) - sumaVieja) >= 1 ? r.total : null;
  await abrirEditor({
    corrigiendo: r.id, proveedor: r.proveedor || '', nro: r.nro_comprobante || '', fecha: r.fecha || hoyISO(), total, origen: r.origen,
    // Lo que creó un producto nuevo ahora ya existe: al corregir se suma a ese mismo producto
    filas: (items || []).map(it => ({ ...filaVacia(), codigo: it.codigo || '', descripcion: it.descripcion, cantidad: it.cantidad, costo: it.costo_unit,
      accion: it.producto_id ? 'stock' : 'solo', producto_id: it.producto_id, producto_nombre: it.producto?.nombre || '',
      repo: it.reposicion_item_id ? { id: it.reposicion_item_id, cantidad: it.cantidad, estado: 'pedido' } : null })),
  });
  $('recepcion-trabajo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const anularRecepcion = unaVez(async (btn, id) => {
  const ok = await confirmar('Anular carga', `Se borra la carga Nº ${id}: se descuenta del stock lo que había sumado y deja de figurar como compra en el Libro diario. ¿Confirmás?`, { ok: 'Sí, anular' });
  if (!ok) return;
  btn.disabled = true;
  const { error } = await db.rpc('anular_recepcion', { p_id: id });
  if (error) {
    btn.disabled = false;
    toast(/anular_recepcion|function .* does not exist/i.test(error.message) ? 'Falta activar la corrección en la base (docs/gestion-v15.sql)' : error.message, 'error');
    return;
  }
  toast(`Carga Nº ${id} anulada`, 'success');
  borrador = null;
  actualizarBadgeRepo();
  cargarLista();
});

export function iniciarRecepcion() {
  registrarVista('recepcion', cargarLista);
}
