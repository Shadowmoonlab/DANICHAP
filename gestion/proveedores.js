// gestion/proveedores.js — Proveedores (logística, WhatsApp), importación de listas de precios y estado de robots.
import {
  $, h, icon, vacio, db, toast, money, fecha, estado, DIAS, cargarProveedores, openModal, closeModal, confirmar,
  registrarVista, cargarSheetJS, unaVez, leerTextoPdf,
} from './core.js?v=21';
import { parsearLibro, filasDePdf, aFilasDePrecio } from './listas.js?v=21';
import { numeroAR } from './texto.js?v=21';
import { estadoPrecios } from './robots.js?v=21';

const MONEDAS = { ARS: 'Pesos', USD: 'Dólares', EUR: 'Euros' };
const cotizacionDe = m => Number(estado.config[m === 'USD' ? 'cotizacion_usd' : 'cotizacion_eur']) || 0;

async function cargar() {
  await cargarProveedores();
  // 3 corridas por día (06/12/18 h) × proveedores: 400 alcanza para encontrar la última buena de cada uno
  const { data: runs } = await db.from('scraper_runs').select('distribuidor, inicio, fin, ok, productos, error')
    .order('inicio', { ascending: false }).limit(400);
  const porProveedor = {};
  for (const r of runs || []) (porProveedor[r.distribuidor] ??= []).push(r);

  $('prov-list').replaceChildren(...estado.proveedores.map(p => {
    const e = estadoPrecios(porProveedor[p.slug] || [], fecha);
    const moneda = p.moneda && p.moneda !== 'ARS' ? p.moneda : null;
    return h('div', { class: 'card prov-card' + (p.activo ? '' : ' off') },
      h('div', { class: 'prov-card-head' },
        h('div', {}, h('h3', {}, p.nombre),
          h('div', { class: 'muted', style: 'font-size:13px', title: e.detalle || '' },
            h('span', { class: 'dot ' + e.tipo }), e.texto),
          moneda ? h('span', { class: 'chip chip-amber', title: 'Se pasa a pesos con la cotización de Ajustes' },
            `Lista en ${MONEDAS[moneda].toLowerCase()} · ${moneda} 1 = ${money(cotizacionDe(moneda))}`) : null),
        h('div', { class: 'prov-acts' },
          // En azul solo si todavía no tiene precios: así se ve de un vistazo qué lista falta cargar
          h('button', { class: 'btn btn-sm' + (e.tipo === 'none' ? ' btn-primary' : ''), title: `Cargar la lista de precios de ${p.nombre} (Excel o PDF)`, onclick: () => importarLista(p) },
            icon('upload_file'), 'Lista'),
          /^https?:\/\//i.test(p.web ?? '') ? h('a', { class: 'btn btn-sm', href: p.web, target: '_blank', rel: 'noopener', title: 'Abrir la web del proveedor' }, icon('open_in_new'), 'Web') : null,
          h('button', { class: 'btn btn-sm', onclick: () => editarProveedor(p) }, icon('edit'), 'Editar'))),
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
  const web = h('input', { class: 'input', type: 'url', value: p.web || '', placeholder: 'https://… (donde entrás a ver precios)' });
  const moneda = h('select', { class: 'select' }, ...Object.entries(MONEDAS).map(([k, t]) => h('option', { value: k, selected: (p.moneda || 'ARS') === k ? true : null }, t)));
  const guardar = async () => {
    const datos = {
      nombre: nombre.value.trim() || p.nombre, whatsapp: whatsapp.value.trim() || null,
      pedido_minimo: minimo.value === '' ? null : Number(minimo.value), notas: notas.value.trim() || null,
      activo: activo.checked, dias_visita: dias.map((c, i) => (c.checked ? i : null)).filter(i => i !== null),
    };
    // La columna web llega con docs/proveedores-web.sql: sin ella, guardar el resto igual
    if ('web' in p) {
      const url = web.value.trim();
      if (url && !/^https?:\/\//i.test(url)) { toast('La página web tiene que empezar con http:// o https://', 'error'); return; }
      datos.web = url || null;
    }
    if ('moneda' in p) datos.moneda = moneda.value;   // llega con docs/gestion-v5.sql
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
      'web' in p ? h('div', { class: 'field' }, h('label', { class: 'label' }, 'Página web (para buscar desde Buscar y vender)'), web) : null,
      'moneda' in p ? h('div', { class: 'field' }, h('label', { class: 'label' }, 'Su lista de precios está en'), moneda) : null,
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Notas (condiciones, horarios, vendedor)'), notas),
      h('label', { class: 'check' }, activo, 'Activo')),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar')],
  });
}

/* ── Importar lista de precios de UN proveedor (Excel / CSV / PDF, uno o varios archivos) ── */
// Cada proveedor importa en su propia lista: los precios de uno nunca pisan los de otro.
const LOTE = 1000;   // filas por pedido: listas grandes (Reposiciones ~10.000) no llegan al límite de tiempo de la API
const recordar = slug => { try { return JSON.parse(localStorage.getItem(`danichap-lista-${slug}`)) || {}; } catch { return {}; } };
const guardarRecuerdo = (slug, v) => { try { localStorage.setItem(`danichap-lista-${slug}`, JSON.stringify(v)); } catch { /* sin almacenamiento: no pasa nada */ } };

async function leerArchivo(archivo) {
  if (/\.pdf$/i.test(archivo.name)) {
    return [{ nombre: archivo.name.replace(/\.pdf$/i, ''), filas: filasDePdf(await leerTextoPdf(archivo)) }];
  }
  const XLSX = await cargarSheetJS();
  let wb;
  if (/\.csv$/i.test(archivo.name)) {
    // Excel en castellano exporta CSV con ";" — se detecta el separador que más aparece
    const texto = await archivo.text();
    const sep = (texto.match(/;/g) || []).length > (texto.match(/,/g) || []).length ? ';' : ',';
    // raw: los números quedan como texto y los lee aNumero ("58.300" = 58300, código "00123" se conserva)
    wb = XLSX.read(texto, { type: 'string', FS: sep, raw: true });
  } else {
    wb = XLSX.read(await archivo.arrayBuffer(), { raw: true });   // un .xls que en realidad es una tabla HTML también
  }
  // Todas las hojas (Francar viene en 17, Senesa una por familia de productos)
  return wb.SheetNames.map(nombre => ({ nombre, filas: XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' }) }));
}

/** Sin proveedor elegido (botón de arriba): primero se elige de quién es la lista. */
function elegirProveedorParaLista() {
  openModal({
    title: '¿De qué proveedor es la lista?', wide: true,
    body: h('div', { class: 'elegir-prov' }, ...estado.proveedores.filter(p => p.activo).map(p =>
      h('button', { class: 'btn', onclick: () => importarLista(p) }, icon('upload_file'), p.nombre))),
  });
}

function importarLista(p) {
  const previo = recordar(p.slug);
  const etiqueta = h('label', { class: 'archivo-btn' }, icon('upload_file'), h('span', {}, 'Elegir Excel o PDF'));
  const file = h('input', { type: 'file', class: 'archivo-oculto', multiple: true, accept: '.xls,.xlsx,.csv,.ods,.pdf' });
  etiqueta.prepend(file);
  const nombres = h('span', { class: 'muted' }, 'Podés elegir varios archivos juntos (ej. lista + especiales).');
  const vista = h('div', {});
  const moneda = h('select', { class: 'select' }, ...Object.entries(MONEDAS).map(([k, t]) => h('option', { value: k, selected: (p.moneda || 'ARS') === k ? true : null }, t)));
  const descuento = h('input', { class: 'input num', inputmode: 'decimal', value: previo.descuento ?? 0 });
  const sumarIva = h('input', { type: 'checkbox', checked: previo.sumarIva ? true : null });
  const reemplazar = h('input', { type: 'checkbox', checked: previo.reemplazar ? true : null });
  const progreso = h('div', { class: 'progreso hidden' }, h('div', { class: 'barra' }), h('span', {}));
  let leido = null;

  const opciones = () => ({ descuentoPct: numeroAR(descuento.value) || 0, sumarIva: sumarIva.checked });
  const previsualizar = () => {
    if (!leido) return;
    if (!leido.productos.length) {
      vista.replaceChildren(h('div', { class: 'aviso' }, 'No encontré productos con precio en este archivo. ¿Es una lista de precios? Si es una foto, cargala a mano.'));
      return;
    }
    const filas = aFilasDePrecio(leido.productos, opciones());
    const m = moneda.value;
    vista.replaceChildren(
      h('div', { class: 'aviso ok' },
        h('b', {}, `Encontré ${leido.productos.length.toLocaleString('es-AR')} productos`),
        leido.archivos.length > 1 ? ` en ${leido.archivos.length} archivos` : '',
        leido.porHoja.filter(x => x.productos).length > 1 ? ` (${leido.porHoja.filter(x => x.productos).length} hojas)` : '', '.',
        leido.preciosSinIva === true ? ' La lista dice que los precios son SIN IVA.' : leido.preciosSinIva === false ? ' La lista dice que los precios incluyen IVA.' : '',
        leido.descartadas ? ` ${leido.descartadas} renglones sin precio no se importan.` : '',
        m !== 'ARS' ? ` Precios en ${MONEDAS[m].toLowerCase()}: se ven en pesos con la cotización de Ajustes (${money(cotizacionDe(m))}).` : ''),
      h('div', { class: 'tbl-wrap', style: 'max-height:250px' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Código'), h('th', {}, 'Descripción'), h('th', {}, 'Rubro'), h('th', { class: 'right' }, 'Lista'), h('th', { class: 'right' }, 'Tu costo'))),
        h('tbody', {}, ...filas.slice(0, 30).map(f => h('tr', {}, h('td', { class: 'muted' }, f.codigo.slice(0, 24)), h('td', {}, f.descripcion), h('td', { class: 'muted' }, f.rubro || ''),
          h('td', { class: 'right num' }, m === 'ARS' ? money(f.precio_lista) : `${m} ${f.precio_lista}`),
          h('td', { class: 'right num' }, h('b', {}, m === 'ARS' ? money(f.precio_neto) : `${m} ${f.precio_neto}`))))))),
      filas.length > 30 ? h('p', { class: 'muted' }, `… y ${(filas.length - 30).toLocaleString('es-AR')} más.`) : null);
  };

  file.addEventListener('change', async () => {
    if (!file.files.length) return;
    const archivos = [...file.files];
    nombres.textContent = archivos.map(a => a.name).join(' · ');
    vista.replaceChildren(vacio('hourglass_top', archivos.some(a => /\.pdf$/i.test(a.name)) ? 'Leyendo el PDF…' : 'Leyendo la planilla…'));
    try {
      const hojas = [];
      for (const a of archivos) hojas.push(...(await leerArchivo(a)));
      leido = { ...parsearLibro(hojas), archivos };
      if (leido.preciosSinIva === true && previo.sumarIva === undefined) sumarIva.checked = false;
      previsualizar();
    } catch (e) {
      leido = null;
      vista.replaceChildren(h('div', { class: 'aviso' }, `No pude leer el archivo: ${e.message}`));
    }
  });
  [descuento, sumarIva, moneda].forEach(el => el.addEventListener('input', previsualizar));

  // unaVez: un doble clic no importa la lista dos veces
  const importar = unaVez(async () => {
    if (!leido?.productos.length) { toast('Elegí primero la lista (Excel o PDF)', 'error'); return; }
    if (reemplazar.checked && !(await confirmar('Reemplazar lista',
      `Los productos de ${p.nombre} que no estén en esta lista quedan como "ya no figura". ¿Seguimos?`, { ok: 'Sí, reemplazar' }))) return;
    const filas = aFilasDePrecio(leido.productos, opciones());
    guardarRecuerdo(p.slug, { descuento: numeroAR(descuento.value) || 0, sumarIva: sumarIva.checked, reemplazar: reemplazar.checked });
    if ('moneda' in p && moneda.value !== (p.moneda || 'ARS')) {
      const { error } = await db.from('proveedores').update({ moneda: moneda.value }).eq('slug', p.slug);
      if (error) { toast(error.message, 'error'); return; }
    }
    // Sin docs/gestion-v5.sql todavía: un solo pedido con la función anterior (alcanza para listas chicas)
    const probar = await db.rpc('importar_lista_lote', { p_proveedor: p.slug, p_rows: [] });
    if (probar.error && /importar_lista_lote/.test(probar.error.message) && /find|exist/i.test(probar.error.message)) {
      const { data, error } = await db.rpc('importar_lista_precios', { p_proveedor: p.slug, p_rows: filas, p_reemplazar: reemplazar.checked });
      if (error) { toast(error.message, 'error'); return; }
      return terminar(data);
    }
    if (probar.error) { toast(probar.error.message, 'error'); return; }

    progreso.classList.remove('hidden');
    let cambios = 0;
    for (let i = 0; i < filas.length; i += LOTE) {
      progreso.lastChild.textContent = `Guardando ${Math.min(i + LOTE, filas.length).toLocaleString('es-AR')} de ${filas.length.toLocaleString('es-AR')}…`;
      progreso.firstChild.style.width = `${Math.round((i / filas.length) * 100)}%`;
      const { data, error } = await db.rpc('importar_lista_lote', { p_proveedor: p.slug, p_rows: filas.slice(i, i + LOTE) });
      if (error) { toast(`Se cortó en ${i.toLocaleString('es-AR')} de ${filas.length.toLocaleString('es-AR')}: ${error.message}. Probá de nuevo: lo ya guardado no se duplica.`, 'error'); return; }
      cambios += data || 0;
    }
    progreso.firstChild.style.width = '100%';
    const { data, error } = await db.rpc('finalizar_importacion', {
      p_proveedor: p.slug, p_codigos: [...new Set(filas.map(f => f.codigo))], p_reemplazar: reemplazar.checked, p_cambios: cambios,
    });
    if (error) { toast(error.message, 'error'); return; }
    terminar(data);
  });
  const terminar = data => {
    closeModal();
    toast(`Lista de ${p.nombre}: ${Number(data.guardados).toLocaleString('es-AR')} productos`
      + `${data.cambios != null ? ` (${Number(data.cambios).toLocaleString('es-AR')} nuevos o con precio cambiado)` : ''}`
      + `${data.desactivados ? `, ${data.desactivados} ya no figuran` : ''}`, 'success');
    cargar();
  };

  openModal({
    title: `Lista de precios de ${p.nombre}`, wide: true,
    body: h('div', {},
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Archivo de la lista (Excel, CSV o PDF)'), h('div', { class: 'archivo' }, etiqueta, nombres)),
      h('div', { class: 'grid4' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'La lista está en'), moneda),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Tu descuento (%)'), descuento),
        h('div', { class: 'field span2' }, h('label', { class: 'label' }, 'Opciones'),
          h('label', { class: 'check', style: 'margin:4px 0' }, sumarIva, 'Sumar 21% de IVA a los precios'),
          h('label', { class: 'check', style: 'margin:4px 0' }, reemplazar, 'Reemplaza la lista anterior (lo que no venga queda como "ya no figura")'))),
      vista, progreso),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: importar }, icon('upload'), 'Importar')],
  });
}

export function iniciarProveedores() {
  $('prov-importar').addEventListener('click', elegirProveedorParaLista);
  registrarVista('proveedores', cargar);
}
