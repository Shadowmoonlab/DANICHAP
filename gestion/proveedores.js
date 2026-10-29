// gestion/proveedores.js — Proveedores (logística, WhatsApp), importación de listas de precios y estado de robots.
import {
  $, h, icon, vacio, db, toast, money, fecha, estado, DIAS, cargarProveedores, openModal, closeModal, confirmar,
  registrarVista,
} from './core.js';
import { parsearLista, aFilasDePrecio } from './listas.js';
import { estadoPrecios } from './robots.js';

// SheetJS 0.20.3 servido desde el propio sitio (la 0.18.5 de npm tiene CVE-2023-30533)
const SHEETJS = 'vendor/xlsx-0.20.3.full.min.js';

async function cargar() {
  await cargarProveedores();
  // 3 corridas por día (06/12/18 h) × proveedores: 400 alcanza para encontrar la última buena de cada uno
  const { data: runs } = await db.from('scraper_runs').select('distribuidor, inicio, fin, ok, productos, error')
    .order('inicio', { ascending: false }).limit(400);
  const porProveedor = {};
  for (const r of runs || []) (porProveedor[r.distribuidor] ??= []).push(r);

  $('prov-list').replaceChildren(...estado.proveedores.map(p => {
    const e = estadoPrecios(porProveedor[p.slug] || [], fecha);
    return h('div', { class: 'card prov-card' + (p.activo ? '' : ' off') },
      h('div', { class: 'prov-card-head' },
        h('div', {}, h('h3', {}, p.nombre),
          h('div', { class: 'muted', style: 'font-size:13px', title: e.detalle || '' },
            h('span', { class: 'dot ' + e.tipo }), e.texto)),
        h('button', { class: 'btn btn-sm', onclick: () => editarProveedor(p) }, icon('edit'), 'Editar')),
      h('div', { class: 'prov-card-body' },
        h('div', {}, h('span', { class: 'label' }, 'Pasa'),
          p.dias_visita?.length ? h('div', { class: 'dias' }, ...DIAS.map((d, i) => h('span', { class: 'dia' + (p.dias_visita.includes(i) ? ' on' : '') }, d)))
                                : h('span', { class: 'muted' }, 'Sin días cargados')),
        h('div', {}, h('span', { class: 'label' }, 'Pedido mínimo'), p.pedido_minimo ? money(p.pedido_minimo) : h('span', { class: 'muted' }, '—')),
        h('div', {}, h('span', { class: 'label' }, 'WhatsApp'), p.whatsapp || h('span', { class: 'muted' }, 'sin cargar'))));
  }));
}

function editarProveedor(p) {
  const nombre = h('input', { class: 'input', value: p.nombre });
  const whatsapp = h('input', { class: 'input', type: 'tel', value: p.whatsapp || '', placeholder: 'Ej: 11 5555-1234' });
  const minimo = h('input', { class: 'input num', type: 'number', min: 0, value: p.pedido_minimo ?? '' });
  const notas = h('textarea', { class: 'input', rows: 2 }, p.notas || '');
  const activo = h('input', { type: 'checkbox', checked: p.activo });
  const dias = DIAS.map((d, i) => h('input', { type: 'checkbox', checked: p.dias_visita?.includes(i), 'aria-label': d }));
  const guardar = async () => {
    const datos = {
      nombre: nombre.value.trim() || p.nombre, whatsapp: whatsapp.value.trim() || null,
      pedido_minimo: minimo.value === '' ? null : Number(minimo.value), notas: notas.value.trim() || null,
      activo: activo.checked, dias_visita: dias.map((c, i) => (c.checked ? i : null)).filter(i => i !== null),
    };
    const { error } = await db.from('proveedores').update(datos).eq('slug', p.slug);
    if (error) { toast(error.message, 'error'); return; }
    closeModal(); toast('Proveedor guardado', 'success'); cargar();
  };
  openModal({
    title: `Proveedor: ${p.nombre}`,
    body: h('div', {},
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Nombre'), nombre),
      h('div', { class: 'field' }, h('label', { class: 'label' }, '¿Qué días pasa o entrega?'),
        h('div', { class: 'dias dias-edit' }, ...DIAS.map((d, i) => h('label', { class: 'dia-check' }, dias[i], d)))),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'WhatsApp para pedidos'), whatsapp),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Pedido mínimo ($)'), minimo)),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Notas (condiciones, horarios, vendedor)'), notas),
      h('label', { class: 'check' }, activo, 'Activo')),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar')],
  });
}

/* ── Importar lista de precios (Excel / CSV) ─────────────────────────── */
function cargarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, mal) => {
    const s = Object.assign(document.createElement('script'), { src: SHEETJS, onload: () => ok(window.XLSX), onerror: () => mal(new Error('No se pudo cargar el lector de Excel')) });
    document.head.append(s);
  });
}

async function importarLista() {
  const prov = h('select', { class: 'select' }, ...estado.proveedores.map(p => h('option', { value: p.slug }, p.nombre)));
  const file = h('input', { type: 'file', class: 'input', accept: '.xls,.xlsx,.csv,.ods' });
  const vista = h('div', {});
  const descuento = h('input', { class: 'input num', type: 'number', min: 0, max: 90, step: 0.5, value: 0 });
  const sumarIva = h('input', { type: 'checkbox' });
  const reemplazar = h('input', { type: 'checkbox' });
  let parsed = null;

  const previsualizar = () => {
    if (!parsed) return;
    if (!parsed.columnas) { vista.replaceChildren(h('div', { class: 'aviso' }, 'No encontré las columnas de código y precio en esta planilla. ¿Es una lista de precios?')); return; }
    const filas = aFilasDePrecio(parsed.productos, { descuentoPct: Number(descuento.value) || 0, sumarIva: sumarIva.checked });
    vista.replaceChildren(
      h('div', { class: 'aviso ok' }, `Encontré ${parsed.productos.length} productos`,
        parsed.secciones.length ? ` en ${parsed.secciones.length} secciones (se guardan como rubro: ${parsed.secciones.slice(0, 4).join(', ')}${parsed.secciones.length > 4 ? '…' : ''})` : '',
        parsed.preciosSinIva === true ? '. La lista dice que los precios son SIN IVA.' : parsed.preciosSinIva === false ? '. La lista dice que los precios incluyen IVA.' : '.',
        parsed.descartadas ? ` ${parsed.descartadas} filas incompletas no se importan.` : ''),
      h('div', { class: 'tbl-wrap', style: 'max-height:260px' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Código'), h('th', {}, 'Descripción'), h('th', {}, 'Rubro'), h('th', { class: 'right' }, 'Lista'), h('th', { class: 'right' }, 'Tu costo'))),
        h('tbody', {}, ...filas.slice(0, 40).map(f => h('tr', {}, h('td', { class: 'muted' }, f.codigo), h('td', {}, f.descripcion), h('td', { class: 'muted' }, f.rubro || ''),
          h('td', { class: 'right num' }, money(f.precio_lista)), h('td', { class: 'right num' }, h('b', {}, money(f.precio_neto)))))))),
      filas.length > 40 ? h('p', { class: 'muted' }, `… y ${filas.length - 40} más.`) : null);
  };
  file.addEventListener('change', async () => {
    if (!file.files.length) return;
    vista.replaceChildren(vacio('hourglass_top', 'Leyendo la planilla…'));
    try {
      const XLSX = await cargarSheetJS();
      const archivo = file.files[0];
      let wb;
      if (/\.csv$/i.test(archivo.name)) {
        // Excel en castellano exporta CSV con ";" — se detecta el separador que más aparece
        const texto = await archivo.text();
        const sep = (texto.match(/;/g) || []).length > (texto.match(/,/g) || []).length ? ';' : ',';
        wb = XLSX.read(texto, { type: 'string', FS: sep });
      } else {
        wb = XLSX.read(await archivo.arrayBuffer());
      }
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      parsed = parsearLista(filas);
      if (parsed.preciosSinIva === true) sumarIva.checked = false;
      previsualizar();
    } catch (e) { vista.replaceChildren(h('div', { class: 'aviso' }, e.message)); }
  });
  [descuento, sumarIva].forEach(el => el.addEventListener('input', previsualizar));

  const importar = async () => {
    if (!parsed?.productos.length) { toast('Elegí primero una planilla con productos', 'error'); return; }
    const nombre = estado.proveedores.find(p => p.slug === prov.value)?.nombre;
    if (reemplazar.checked && !(await confirmar('Reemplazar lista', `Los productos de ${nombre} que no estén en esta planilla quedan como "ya no figura". ¿Seguimos?`, { ok: 'Sí, reemplazar' }))) return;
    const filas = aFilasDePrecio(parsed.productos, { descuentoPct: Number(descuento.value) || 0, sumarIva: sumarIva.checked });
    const { data, error } = await db.rpc('importar_lista_precios', { p_proveedor: prov.value, p_rows: filas, p_reemplazar: reemplazar.checked });
    if (error) { toast(error.message, 'error'); return; }
    closeModal();
    toast(`Lista de ${nombre} importada: ${data.guardados} productos${data.desactivados ? `, ${data.desactivados} ya no figuran` : ''}`, 'success');
    cargar();
  };

  openModal({
    title: 'Importar lista de precios', wide: true,
    body: h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' }, 'Para proveedores que mandan la lista en Excel (como Cavila). Se detectan solas las columnas de código, descripción y precio.'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Proveedor'), prov),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Planilla (.xls, .xlsx, .csv)'), file)),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Tu descuento sobre lista (%)'), descuento),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Opciones'),
          h('label', { class: 'check', style: 'margin:4px 0' }, sumarIva, 'Sumar 21% de IVA a los precios'),
          h('label', { class: 'check', style: 'margin:4px 0' }, reemplazar, 'Reemplaza la lista anterior completa'))),
      vista),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: importar }, icon('upload'), 'Importar')],
  });
}

export function iniciarProveedores() {
  $('prov-importar').addEventListener('click', importarLista);
  registrarVista('proveedores', cargar);
}
