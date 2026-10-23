// gestion.js — Panel de gestión DANICHAP: mostrador, reposición, ventas, clientes, ajustes
// Requiere: supabase.js (_supabase, Auth, Perfiles), toast.js (showToast). SQL: docs/add-gestion.sql
(async () => {

  /* ══════════════════════════════════════════════════════════════════════
     GUARD — solo admin
  ══════════════════════════════════════════════════════════════════════ */
  const user = await Auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }
  let perfil = null;
  for (let i = 0; i < 3 && !perfil; i++) {
    perfil = await Perfiles.get(user.id);
    if (!perfil) await new Promise(r => setTimeout(r, 600 * (i + 1)));
  }
  document.getElementById('g-loading').classList.add('hidden');
  if (perfil?.rol !== 'admin') {
    document.getElementById('g-guard').classList.remove('hidden');
    return;
  }
  document.getElementById('g-user').textContent = perfil.nombre || user.email;
  document.getElementById('g-logout').addEventListener('click', async () => {
    await Auth.signOut(); window.location.href = 'index.html';
  });

  const db = _supabase;

  /* ══════════════════════════════════════════════════════════════════════
     UTILIDADES
  ══════════════════════════════════════════════════════════════════════ */
  const $ = id => document.getElementById(id);

  // Crea elementos sin innerHTML (los datos vienen de distribuidores/usuarios → nunca HTML)
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const icon = name => h('span', { class: 'ms' }, name);

  const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const money = n => fmt.format(Math.round(Number(n) || 0));
  const fecha = iso => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const DISTRIBUIDORES = {
    dm: 'DM', prautopartes: 'PR Autopartes', delviso: 'Metalúrgica del Viso',
    cromosol: 'Cromosol', otero: 'Autopartes Otero',
  };
  const nombreDist = slug => DISTRIBUIDORES[slug] || slug;
  const PAGOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', debito: 'Débito', credito: 'Crédito', cuenta_corriente: 'Cta. corriente' };

  // Palabras de búsqueda seguras para filtros de PostgREST
  const palabras = q => q.toLowerCase().replace(/[,()*%\\:"']/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 6);

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* ── Modal genérico ───────────────────────────────────────────────── */
  function openModal({ title, body, foot = [], wide = false }) {
    $('modal-title').textContent = title;
    $('modal-body').replaceChildren(body);
    $('modal-foot').replaceChildren(...foot);
    $('modal-foot').classList.toggle('hidden', foot.length === 0);
    $('modal').classList.toggle('wide', wide);
    $('modal-bg').classList.remove('hidden');
  }
  function closeModal() { $('modal-bg').classList.add('hidden'); }
  $('modal-close').addEventListener('click', closeModal);
  $('modal-bg').addEventListener('click', e => { if (e.target === $('modal-bg')) closeModal(); });

  /* ══════════════════════════════════════════════════════════════════════
     CONFIGURACIÓN (ganancia, redondeo, datos de comprobante)
  ══════════════════════════════════════════════════════════════════════ */
  let config = { ganancia_pct: 82, ganancias_distribuidor: {}, redondeo: 1, nombre_negocio: 'DANICHAP',
                 leyenda_comprobante: 'Documento no válido como factura' };

  async function loadConfig() {
    const { data, error } = await db.from('config_negocio').select('*').eq('id', 1).maybeSingle();
    if (error) { console.warn('[gestion] config:', error.message); showToast('Falta correr docs/add-gestion.sql en Supabase', 'error'); return; }
    if (data) config = data;
  }

  function precioVenta(costo, distribuidor) {
    if (costo == null) return null;
    const pct = Number(config.ganancias_distribuidor?.[distribuidor] ?? config.ganancia_pct);
    const r = Number(config.redondeo) || 1;
    return Math.round((costo * (1 + pct / 100)) / r) * r;
  }

  /* ══════════════════════════════════════════════════════════════════════
     NAVEGACIÓN ENTRE PESTAÑAS
  ══════════════════════════════════════════════════════════════════════ */
  const loaders = {};
  function show(view) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${view}`));
    loaders[view]?.();
    if (view === 'mostrador') setTimeout(() => $('pos-search').focus(), 0);
  }
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));

  /* ══════════════════════════════════════════════════════════════════════
     BÚSQUEDA (stock propio + distribuidores)
  ══════════════════════════════════════════════════════════════════════ */
  async function buscarPrecios(q, limite = 40) {
    const ws = palabras(q);
    if (!ws.length) return [];
    let query = db.from('precios_distribuidor')
      .select('id, distribuidor, codigo, descripcion, marca, rubro, precio_neto, precio_anterior, precio_cambio_at')
      .eq('activo', true);
    for (const w of ws) query = query.ilike('busqueda', `%${w}%`);
    const { data, error } = await query.order('precio_neto', { ascending: true, nullsFirst: false }).limit(limite);
    if (error) { console.warn('[gestion] buscarPrecios:', error.message); return []; }
    return data;
  }

  async function buscarStock(q, limite = 15) {
    const ws = palabras(q);
    if (!ws.length) return [];
    // La base filtra por la primera palabra; el resto se filtra acá (el catálogo propio es chico)
    const { data, error } = await db.from('productos')
      .select('id, nombre, precio, stock, stock_cantidad, marca_rep, modelo')
      .or(`nombre.ilike.*${ws[0]}*,modelo.ilike.*${ws[0]}*,marca_rep.ilike.*${ws[0]}*`)
      .limit(200);
    if (error) { console.warn('[gestion] buscarStock:', error.message); return []; }
    return data
      .filter(p => { const t = [p.nombre, p.modelo, p.marca_rep].join(' ').toLowerCase(); return ws.every(w => t.includes(w)); })
      .slice(0, limite);
  }

  /* ══════════════════════════════════════════════════════════════════════
     MOSTRADOR
  ══════════════════════════════════════════════════════════════════════ */
  let resultados = [];   // [{tipo:'stock'|'dist', ...}]
  let selIdx = -1;
  let venta = [];        // [{key, producto_id, precio_distribuidor_id, codigo, descripcion, origen, cantidad, precio_unit, costo_unit}]
  let clientes = [];

  const searchInput = $('pos-search');

  const ejecutarBusqueda = debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { renderResultados(null); return; }
    const [stock, dist] = await Promise.all([buscarStock(q), buscarPrecios(q)]);
    if (searchInput.value.trim() !== q) return; // llegó tarde: el usuario siguió escribiendo
    const costoMin = Math.min(...dist.map(d => d.precio_neto ?? Infinity));
    resultados = [
      ...stock.map(p => ({
        tipo: 'stock', key: `p-${p.id}`, producto_id: p.id, codigo: '', descripcion: p.nombre,
        origen: 'Mi stock', precio: p.precio, costo: null,
        extra: p.stock_cantidad != null ? `${p.stock_cantidad} u.` : (p.stock ? 'Con stock' : 'Sin stock'),
        sinStock: p.stock === false || p.stock_cantidad === 0,
      })),
      ...dist.map(d => ({
        tipo: 'dist', key: `d-${d.id}`, precio_distribuidor_id: d.id, distribuidor: d.distribuidor,
        codigo: d.codigo, descripcion: d.descripcion, origen: nombreDist(d.distribuidor),
        precio: precioVenta(d.precio_neto, d.distribuidor), costo: d.precio_neto,
        extra: [d.marca, d.rubro].filter(Boolean).join(' · '), masBarato: dist.length > 1 && d.precio_neto === costoMin,
        subio: d.precio_anterior != null && d.precio_neto > d.precio_anterior,
      })),
    ];
    selIdx = resultados.length ? 0 : -1;
    renderResultados(q);
  }, 220);

  function renderResultados(q) {
    const box = $('pos-results');
    if (q == null) {
      box.replaceChildren(h('div', { class: 'empty' }, icon('manage_search'), 'Escribí lo que te piden.', h('br'),
        'Busca en tu stock y en todos los distribuidores a la vez.'));
      return;
    }
    if (!resultados.length) {
      box.replaceChildren(h('div', { class: 'empty' }, icon('search_off'), `No encontré nada con "${q}".`, h('br'),
        'Probá con menos palabras o con el código.'));
      return;
    }
    box.replaceChildren(...resultados.map((r, i) => h('div', {
      class: 'res' + (i === selIdx ? ' sel' : ''), 'data-i': i,
      onclick: () => { selIdx = i; agregarSeleccionado(); },
    },
      h('div', { class: 'desc' }, r.descripcion),
      h('div', { class: 'price' },
        h('div', { class: 'pv num' }, r.precio != null ? money(r.precio) : 'Sin precio'),
        r.costo != null ? h('div', { class: 'pc num' }, `costo ${money(r.costo)}`) : null),
      h('div', { class: 'meta' },
        h('span', { class: 'chip' + (r.tipo === 'stock' ? ' chip-stock' : '') }, r.origen),
        r.codigo ? h('span', {}, r.codigo) : null,
        r.extra ? h('span', {}, r.extra) : null,
        r.sinStock ? h('span', { class: 'chip chip-gray' }, 'sin stock') : null,
        r.masBarato && r.tipo === 'dist' ? h('span', { class: 'best' }, '★ más barato') : null,
        r.subio ? h('span', { class: 'chip chip-amber' }, 'subió') : null),
    )));
  }

  function moverSeleccion(delta) {
    if (!resultados.length) return;
    selIdx = (selIdx + delta + resultados.length) % resultados.length;
    document.querySelectorAll('#pos-results .res').forEach((el, i) => el.classList.toggle('sel', i === selIdx));
    document.querySelector(`#pos-results .res[data-i="${selIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function agregarSeleccionado() {
    const r = resultados[selIdx];
    if (!r) return;
    const ya = venta.find(v => v.key === r.key);
    if (ya) ya.cantidad++;
    else venta.push({
      key: r.key, producto_id: r.producto_id || null, precio_distribuidor_id: r.precio_distribuidor_id || null,
      codigo: r.codigo, descripcion: r.descripcion, origen: r.origen,
      cantidad: 1, precio_unit: r.precio ?? 0, costo_unit: r.costo,
    });
    renderVenta();
    searchInput.select();
    showToast(`Agregado: ${r.descripcion.slice(0, 40)}`);
  }

  function renderVenta() {
    const box = $('pos-items');
    if (!venta.length) {
      box.replaceChildren(h('div', { class: 'empty' }, icon('shopping_cart'), 'Todavía no agregaste nada.'));
    } else {
      box.replaceChildren(...venta.map(v => {
        const qty = h('input', { value: v.cantidad, inputmode: 'numeric', 'aria-label': 'Cantidad',
          onchange: e => { v.cantidad = Math.max(1, parseInt(e.target.value, 10) || 1); renderVenta(); } });
        const pr = h('input', { class: 'pr num', value: v.precio_unit, inputmode: 'decimal', 'aria-label': 'Precio',
          onchange: e => { v.precio_unit = Math.max(0, parseFloat(e.target.value.replace(',', '.')) || 0); renderVenta(); } });
        return h('div', { class: 'ti' },
          h('div', {}, h('div', { class: 'd' }, v.descripcion), h('div', { class: 'src' }, [v.origen, v.codigo].filter(Boolean).join(' · '))),
          h('button', { class: 'btn btn-icon btn-red', title: 'Quitar', onclick: () => { venta = venta.filter(x => x !== v); renderVenta(); } }, icon('close')),
          h('div', { class: 'ctrl' },
            h('div', { class: 'qty' },
              h('button', { onclick: () => { v.cantidad = Math.max(1, v.cantidad - 1); renderVenta(); }, 'aria-label': 'Menos' }, '−'),
              qty,
              h('button', { onclick: () => { v.cantidad++; renderVenta(); }, 'aria-label': 'Más' }, '+')),
            h('span', { class: 'muted' }, '×'), pr),
          h('div', { class: 'sub num' }, money(v.cantidad * v.precio_unit)));
      }));
    }
    const total = venta.reduce((s, v) => s + v.cantidad * v.precio_unit, 0);
    const costo = venta.reduce((s, v) => s + v.cantidad * (v.costo_unit ?? 0), 0);
    const todosConCosto = venta.length && venta.every(v => v.costo_unit != null);
    $('pos-total').textContent = money(total);
    $('pos-gain').textContent = todosConCosto ? `Ganancia de esta venta: ${money(total - costo)}` : '';
    $('pos-cobrar').disabled = !venta.length;
  }

  async function cobrar() {
    if (!venta.length) return;
    const btn = $('pos-cobrar');
    btn.disabled = true;
    const nombreCli = $('pos-cliente').value.trim();
    const cli = clientes.find(c => c.nombre.toLowerCase() === nombreCli.toLowerCase());
    const imprimir = $('pos-print').checked;
    const payload = {
      cliente_id: cli?.id ?? null,
      cliente_nombre: cli?.nombre ?? (nombreCli || null),
      medio_pago: $('pos-pago').value,
      impreso: imprimir,
      items: venta.map(v => ({
        producto_id: v.producto_id, precio_distribuidor_id: v.precio_distribuidor_id,
        codigo: v.codigo, descripcion: v.descripcion, cantidad: v.cantidad,
        precio_unit: v.precio_unit, costo_unit: v.costo_unit,
      })),
    };
    const { data: ventaId, error } = await db.rpc('registrar_venta', { p_venta: payload });
    if (error) {
      btn.disabled = false;
      showToast('No se pudo registrar la venta: ' + error.message, 'error');
      return;
    }
    if (imprimir) imprimirComprobante({
      id: ventaId, created_at: new Date().toISOString(), cliente_nombre: payload.cliente_nombre,
      medio_pago: payload.medio_pago, items: payload.items,
    });
    showToast(`Venta Nº ${ventaId} registrada`, 'success');
    venta = [];
    $('pos-cliente').value = '';
    $('pos-print').checked = false;
    renderVenta();
    actualizarBadgeRepo();
    searchInput.value = '';
    renderResultados(null);
    searchInput.focus();
  }

  searchInput.addEventListener('input', ejecutarBusqueda);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moverSeleccion(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moverSeleccion(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); agregarSeleccionado(); }
    else if (e.key === 'Escape') { searchInput.value = ''; resultados = []; renderResultados(null); }
  });
  $('pos-cobrar').addEventListener('click', cobrar);
  $('pos-clear').addEventListener('click', () => { venta = []; renderVenta(); searchInput.focus(); });
  $('pos-cliente-nuevo').addEventListener('click', () => editarCliente(null, c => { $('pos-cliente').value = c.nombre; }));

  document.addEventListener('keydown', e => {
    if (!$('modal-bg').classList.contains('hidden')) { if (e.key === 'Escape') closeModal(); return; }
    const enMostrador = !$('view-mostrador').classList.contains('hidden');
    if (e.key === 'F2') { e.preventDefault(); show('mostrador'); searchInput.select(); }
    else if (e.key === 'F9' && enMostrador) { e.preventDefault(); cobrar(); }
  });

  /* ── Comprobante ──────────────────────────────────────────────────── */
  function imprimirComprobante(v) {
    const total = v.items.reduce((s, i) => s + i.cantidad * i.precio_unit, 0);
    const area = $('print-area');
    area.replaceChildren(h('div', { class: 'cmp' },
      h('div', { class: 'cmp-head' },
        h('div', {}, h('h1', {}, config.nombre_negocio || 'DANICHAP'),
          config.direccion ? h('div', {}, config.direccion) : null,
          config.telefono ? h('div', {}, `Tel: ${config.telefono}`) : null),
        h('div', { style: 'text-align:right' }, h('b', {}, `Comprobante Nº ${String(v.id).padStart(6, '0')}`),
          h('div', {}, new Date(v.created_at).toLocaleString('es-AR')),
          h('div', {}, `Cliente: ${v.cliente_nombre || 'Consumidor final'}`),
          h('div', {}, `Pago: ${PAGOS[v.medio_pago] || v.medio_pago}`))),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Cant.'), h('th', {}, 'Descripción'), h('th', { style: 'text-align:right' }, 'P. unit.'), h('th', { style: 'text-align:right' }, 'Subtotal'))),
        h('tbody', {}, ...v.items.map(i => h('tr', {},
          h('td', {}, i.cantidad), h('td', {}, i.descripcion),
          h('td', { style: 'text-align:right' }, money(i.precio_unit)),
          h('td', { style: 'text-align:right' }, money(i.cantidad * i.precio_unit)))))),
      h('div', { class: 'tot' }, `TOTAL ${money(total)}`),
      h('div', { class: 'leg' }, config.leyenda_comprobante || 'Documento no válido como factura')));
    document.body.classList.add('printing');
    setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
  }

  /* ══════════════════════════════════════════════════════════════════════
     REPOSICIÓN
  ══════════════════════════════════════════════════════════════════════ */
  let repoEstado = 'pendiente';

  async function actualizarBadgeRepo() {
    const { count } = await db.from('reposicion_items').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    const b = $('badge-repo');
    b.textContent = count || 0;
    b.classList.toggle('hidden', !count);
  }

  async function loadReposicion() {
    const box = $('repo-list');
    const { data, error } = await db.from('reposicion_items')
      .select('id, codigo, descripcion, cantidad, estado, created_at, pedido_at, precio_distribuidor_id, precio:precios_distribuidor(id, distribuidor, codigo, descripcion, precio_neto, activo)')
      .eq('estado', repoEstado)
      .order('created_at', { ascending: true });
    if (error) { box.replaceChildren(h('div', { class: 'card empty' }, error.message)); return; }
    if (!data.length) {
      box.replaceChildren(h('div', { class: 'card empty' }, icon(repoEstado === 'pendiente' ? 'task_alt' : 'local_shipping'),
        repoEstado === 'pendiente' ? 'No hay nada para pedir. ¡Todo repuesto!' : 'No hay pedidos en camino.'));
      return;
    }

    // Agrupar por distribuidor elegido
    const grupos = new Map();
    for (const it of data) {
      const k = it.precio?.distribuidor || '_sin';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(it);
    }
    const orden = [...grupos.keys()].sort((a, b) => (a === '_sin') - (b === '_sin') || nombreDist(a).localeCompare(nombreDist(b)));

    box.replaceChildren(h('div', { class: 'prov-grid' }, ...orden.map(k => {
      const items = grupos.get(k);
      const sin = k === '_sin';
      const total = items.reduce((s, it) => s + it.cantidad * (it.precio?.precio_neto || 0), 0);
      return h('div', { class: 'card' },
        h('div', { class: 'prov-head' + (sin ? ' none' : '') },
          h('h3', {}, sin ? 'Sin proveedor elegido' : nombreDist(k)),
          h('div', { class: 'prov-tot' }, `${items.length} artículo${items.length > 1 ? 's' : ''}`, sin ? '' : [' · costo ', h('b', { class: 'num' }, money(total))])),
        ...items.map(it => h('div', { class: 'ri' },
          h('div', { class: 'q' }, it.cantidad),
          h('div', {},
            h('div', { class: 'd' }, it.precio?.descripcion || it.descripcion),
            h('div', { class: 'm' },
              it.precio ? `${it.precio.codigo} · ${money(it.precio.precio_neto)} c/u` : (it.codigo || 'Elegí dónde comprarlo con "Comparar"'),
              it.precio && !it.precio.activo ? ' · ⚠ ya no figura en el distribuidor' : '',
              repoEstado === 'pedido' && it.pedido_at ? ` · pedido ${fecha(it.pedido_at)}` : '')),
          h('div', { class: 'acts' },
            repoEstado === 'pendiente'
              ? [h('button', { class: 'btn btn-sm', onclick: () => compararPrecios(it) }, icon('compare_arrows'), 'Comparar'),
                 h('button', { class: 'btn btn-sm btn-icon btn-red', title: 'Descartar (no hace falta reponer)', onclick: () => cambiarEstado([it.id], 'descartado') }, icon('close'))]
              : h('button', { class: 'btn btn-sm btn-green', onclick: () => cambiarEstado([it.id], 'recibido') }, icon('check'), 'Llegó')))),
        h('div', { class: 'prov-foot' },
          repoEstado === 'pendiente' && !sin ? [
            h('button', { class: 'btn btn-sm', onclick: () => copiarPedido(k, items) }, icon('content_copy'), 'Copiar pedido para WhatsApp'),
            h('button', { class: 'btn btn-sm btn-primary', onclick: () => cambiarEstado(items.map(i => i.id), 'pedido') }, icon('send'), 'Marcar como pedido'),
          ] : null,
          repoEstado === 'pedido' ? h('button', { class: 'btn btn-sm btn-green', onclick: () => cambiarEstado(items.map(i => i.id), 'recibido') }, icon('done_all'), 'Llegó todo') : null));
    })));
  }

  async function cambiarEstado(ids, estado) {
    const campos = { estado };
    if (estado === 'pedido') campos.pedido_at = new Date().toISOString();
    if (estado === 'recibido') campos.recibido_at = new Date().toISOString();
    const { error } = await db.from('reposicion_items').update(campos).in('id', ids);
    if (error) { showToast(error.message, 'error'); return; }
    const txt = { pedido: 'Marcado como pedido', recibido: 'Marcado como recibido', descartado: 'Quitado de la lista' };
    showToast(txt[estado] || 'Actualizado', 'success');
    loadReposicion(); actualizarBadgeRepo();
  }

  async function copiarPedido(dist, items) {
    const lineas = items.map(it => `• ${it.cantidad} x ${it.precio?.codigo || ''} — ${it.precio?.descripcion || it.descripcion}`);
    const texto = `Hola! Pedido de DANICHAP para ${nombreDist(dist)}:\n\n${lineas.join('\n')}\n\nGracias!`;
    try { await navigator.clipboard.writeText(texto); showToast('Pedido copiado. Pegalo en WhatsApp', 'success'); }
    catch { openModal({ title: 'Pedido', body: h('textarea', { class: 'input', rows: 12, readonly: true }, texto) }); }
  }

  // Busca el mismo repuesto en todos los distribuidores, del más barato al más caro
  async function compararPrecios(it, alElegir) {
    const base = it.precio?.descripcion || it.descripcion || '';
    const input = h('input', { class: 'input', value: palabras(base).slice(0, 4).join(' '), placeholder: 'Buscar…' });
    const lista = h('div', {}, h('div', { class: 'empty' }, 'Buscando…'));

    const correr = async () => {
      const res = await buscarPrecios(input.value, 30);
      if (!res.length) { lista.replaceChildren(h('div', { class: 'empty' }, 'Sin resultados. Probá con menos palabras.')); return; }
      lista.replaceChildren(h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Distribuidor'), h('th', {}, 'Código'), h('th', {}, 'Descripción'), h('th', { class: 'right' }, 'Costo'), h('th', {}))),
        h('tbody', {}, ...res.map((r, i) => h('tr', {},
          h('td', {}, h('span', { class: 'chip' }, nombreDist(r.distribuidor))),
          h('td', { class: 'muted' }, r.codigo),
          h('td', {}, r.descripcion, i === 0 && res.length > 1 ? h('span', { class: 'best', style: 'margin-left:6px;color:#1A9850;font-weight:700;font-size:12px' }, '★ más barato') : null),
          h('td', { class: 'right num' }, h('b', {}, money(r.precio_neto))),
          h('td', {}, h('button', { class: 'btn btn-sm btn-primary', onclick: () => elegir(r) },
            r.id === it.precio_distribuidor_id ? 'Elegido' : 'Elegir')))))));
    };
    const elegir = async r => {
      if (alElegir) { closeModal(); alElegir(r); return; }
      const { error } = await db.from('reposicion_items').update({ precio_distribuidor_id: r.id }).eq('id', it.id);
      if (error) { showToast(error.message, 'error'); return; }
      closeModal(); showToast(`Se pide a ${nombreDist(r.distribuidor)}`, 'success'); loadReposicion();
    };

    input.addEventListener('input', debounce(correr, 300));
    openModal({ title: alElegir ? 'Agregar faltante' : 'Comparar precios', wide: true,
      body: h('div', {}, h('div', { class: 'field' }, input), lista) });
    input.focus();
    correr();
  }

  // Agregar a mano algo que falta (sin venta de por medio)
  $('repo-agregar').addEventListener('click', () => compararPrecios({ descripcion: '' }, async r => {
    const cant = parseInt(prompt(`¿Cuántas unidades de "${r.descripcion}"?`, '1'), 10);
    if (!cant || cant < 1) return;
    const { error } = await db.from('reposicion_items').insert({
      codigo: r.codigo, descripcion: r.descripcion, cantidad: cant, precio_distribuidor_id: r.id,
    });
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Agregado a la lista para pedir', 'success'); loadReposicion(); actualizarBadgeRepo();
  }));

  document.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
    repoEstado = b.dataset.estado;
    document.querySelectorAll('.subtab').forEach(x => x.classList.toggle('active', x === b));
    $('repo-agregar').classList.toggle('hidden', repoEstado !== 'pendiente');
    loadReposicion();
  }));
  loaders.reposicion = loadReposicion;

  /* ══════════════════════════════════════════════════════════════════════
     VENTAS
  ══════════════════════════════════════════════════════════════════════ */
  const hoyISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $('ventas-desde').value = $('ventas-hasta').value = hoyISO();

  async function loadVentas() {
    const desde = new Date(`${$('ventas-desde').value}T00:00:00`);
    const hasta = new Date(`${$('ventas-hasta').value}T23:59:59.999`);
    const { data, error } = await db.from('ventas')
      .select('id, created_at, cliente_nombre, medio_pago, total, costo_total, impreso, anulada')
      .gte('created_at', desde.toISOString()).lte('created_at', hasta.toISOString())
      .order('created_at', { ascending: false }).limit(500);
    const body = $('ventas-body');
    if (error) { body.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'empty' }, error.message))); return; }
    const validas = data.filter(v => !v.anulada);
    const vendido = validas.reduce((s, v) => s + Number(v.total), 0);
    const ganancia = validas.reduce((s, v) => s + Number(v.total) - Number(v.costo_total), 0);
    $('st-vendido').textContent = money(vendido);
    $('st-ganancia').textContent = money(ganancia);
    $('st-cant').textContent = validas.length;
    $('st-ticket').textContent = money(validas.length ? vendido / validas.length : 0);
    if (!data.length) { body.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'No hay ventas en estas fechas.'))); return; }
    body.replaceChildren(...data.map(v => h('tr', { class: 'clickable', onclick: () => verVenta(v), style: v.anulada ? 'opacity:.45;text-decoration:line-through' : null },
      h('td', { class: 'num' }, v.id), h('td', {}, fecha(v.created_at)),
      h('td', {}, v.cliente_nombre || h('span', { class: 'muted' }, 'Consumidor final')),
      h('td', {}, PAGOS[v.medio_pago] || v.medio_pago),
      h('td', { class: 'right num' }, h('b', {}, money(v.total))),
      h('td', { class: 'right num', style: 'color:#1A9850' }, money(v.total - v.costo_total)))));
  }

  async function verVenta(v) {
    const { data: items } = await db.from('venta_items').select('codigo, descripcion, cantidad, precio_unit, costo_unit').eq('venta_id', v.id);
    openModal({
      title: `Venta Nº ${v.id}`, wide: true,
      body: h('div', {},
        h('p', { class: 'muted', style: 'margin-top:0' }, `${fecha(v.created_at)} · ${v.cliente_nombre || 'Consumidor final'} · ${PAGOS[v.medio_pago] || v.medio_pago}`),
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Cant.'), h('th', {}, 'Descripción'), h('th', { class: 'right' }, 'Precio'), h('th', { class: 'right' }, 'Subtotal'))),
          h('tbody', {}, ...(items || []).map(i => h('tr', {}, h('td', {}, i.cantidad), h('td', {}, i.descripcion),
            h('td', { class: 'right num' }, money(i.precio_unit)), h('td', { class: 'right num' }, money(i.cantidad * i.precio_unit))))))),
      foot: [
        !v.anulada ? h('button', { class: 'btn btn-red', onclick: async () => {
          if (!confirm(`¿Anular la venta Nº ${v.id}? No se borra, queda tachada.`)) return;
          const { error } = await db.from('ventas').update({ anulada: true }).eq('id', v.id);
          if (error) return showToast(error.message, 'error');
          closeModal(); showToast('Venta anulada'); loadVentas();
        } }, icon('block'), 'Anular') : null,
        h('button', { class: 'btn btn-primary', onclick: () => imprimirComprobante({ ...v, items: items || [] }) }, icon('print'), 'Imprimir comprobante'),
      ].filter(Boolean),
    });
  }

  $('ventas-desde').addEventListener('change', loadVentas);
  $('ventas-hasta').addEventListener('change', loadVentas);
  $('ventas-hoy').addEventListener('click', () => { $('ventas-desde').value = $('ventas-hasta').value = hoyISO(); loadVentas(); });
  loaders.ventas = loadVentas;

  /* ══════════════════════════════════════════════════════════════════════
     CLIENTES
  ══════════════════════════════════════════════════════════════════════ */
  async function loadClientes() {
    const { data, error } = await db.from('clientes').select('*, ventas(total, anulada)').order('nombre');
    if (error) { console.warn('[gestion] clientes:', error.message); return; }
    clientes = data.map(c => {
      const vs = (c.ventas || []).filter(v => !v.anulada);
      return { ...c, compras: vs.length, total: vs.reduce((s, v) => s + Number(v.total), 0) };
    });
    $('dl-clientes').replaceChildren(...clientes.map(c => h('option', { value: c.nombre })));
    renderClientes();
  }

  function renderClientes() {
    const q = $('cli-search').value.trim().toLowerCase();
    const lista = clientes.filter(c => !q || [c.nombre, c.cuit_dni, c.telefono, c.email].some(x => (x || '').toLowerCase().includes(q)));
    const body = $('cli-body');
    if (!lista.length) { body.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'empty' }, clientes.length ? 'Ningún cliente coincide.' : 'Todavía no cargaste clientes.'))); return; }
    body.replaceChildren(...lista.map(c => h('tr', { class: 'clickable', onclick: () => editarCliente(c) },
      h('td', {}, h('b', {}, c.nombre)), h('td', {}, c.cuit_dni || ''), h('td', {}, c.telefono || ''), h('td', {}, c.email || ''),
      h('td', { class: 'right num' }, c.compras), h('td', { class: 'right num' }, money(c.total)))));
  }

  function editarCliente(c, alGuardar) {
    const campos = [['nombre', 'Nombre y apellido / Razón social *'], ['cuit_dni', 'CUIT o DNI'], ['telefono', 'Teléfono'],
                    ['email', 'Mail'], ['direccion', 'Dirección'], ['localidad', 'Localidad'], ['notas', 'Notas']];
    const inputs = {};
    const form = h('div', {}, ...campos.map(([k, l]) => h('div', { class: 'field' },
      h('label', { class: 'label' }, l),
      inputs[k] = k === 'notas' ? h('textarea', { class: 'input', rows: 2 }, c?.[k] || '') : h('input', { class: 'input', value: c?.[k] || '', type: k === 'email' ? 'email' : 'text' }))));
    const guardar = async () => {
      const datos = Object.fromEntries(campos.map(([k]) => [k, inputs[k].value.trim() || null]));
      if (!datos.nombre) { showToast('Falta el nombre', 'error'); inputs.nombre.focus(); return; }
      datos.updated_at = new Date().toISOString();
      const q = c ? db.from('clientes').update(datos).eq('id', c.id) : db.from('clientes').insert(datos);
      const { data, error } = await q.select().single();
      if (error) { showToast(error.message, 'error'); return; }
      closeModal(); showToast(c ? 'Cliente actualizado' : 'Cliente creado', 'success');
      await loadClientes();
      alGuardar?.(data);
    };
    openModal({ title: c ? 'Editar cliente' : 'Nuevo cliente', body: form,
      foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'), h('button', { class: 'btn btn-primary', onclick: guardar }, icon('save'), 'Guardar')] });
    inputs.nombre.focus();
  }

  function exportarClientes() {
    const cols = ['nombre', 'cuit_dni', 'telefono', 'email', 'direccion', 'localidad', 'compras', 'total', 'notas'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(';'), ...clientes.map(c => cols.map(k => esc(c[k])).join(';'))].join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `clientes-danichap-${hoyISO()}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  $('cli-search').addEventListener('input', renderClientes);
  $('cli-nuevo').addEventListener('click', () => editarCliente(null));
  $('cli-export').addEventListener('click', exportarClientes);
  loaders.clientes = loadClientes;

  /* ══════════════════════════════════════════════════════════════════════
     AJUSTES
  ══════════════════════════════════════════════════════════════════════ */
  function renderAjustes() {
    $('cfg-ganancia').value = config.ganancia_pct;
    $('cfg-redondeo').value = String(config.redondeo || 1);
    $('cfg-nombre').value = config.nombre_negocio || '';
    $('cfg-dir').value = config.direccion || '';
    $('cfg-tel').value = config.telefono || '';
    $('cfg-leyenda').value = config.leyenda_comprobante || '';
    $('cfg-dist').replaceChildren(
      h('p', { class: 'hint', style: 'margin-top:4px' }, 'Opcional: ganancia distinta por distribuidor (vacío = usa la general).'),
      h('div', { class: 'grid2' }, ...Object.entries(DISTRIBUIDORES).map(([k, n]) => h('div', { class: 'field' },
        h('label', { class: 'label' }, n),
        h('input', { class: 'input', type: 'number', min: 0, step: 0.5, 'data-dist': k, placeholder: String(config.ganancia_pct),
          value: config.ganancias_distribuidor?.[k] ?? '' })))));
    loadRobots();
  }

  async function guardarAjustes() {
    const porDist = {};
    document.querySelectorAll('#cfg-dist input[data-dist]').forEach(i => { if (i.value !== '') porDist[i.dataset.dist] = Number(i.value); });
    const datos = {
      ganancia_pct: Number($('cfg-ganancia').value) || 0,
      ganancias_distribuidor: porDist,
      redondeo: Number($('cfg-redondeo').value) || 1,
      nombre_negocio: $('cfg-nombre').value.trim() || 'DANICHAP',
      direccion: $('cfg-dir').value.trim() || null,
      telefono: $('cfg-tel').value.trim() || null,
      leyenda_comprobante: $('cfg-leyenda').value.trim() || 'Documento no válido como factura',
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from('config_negocio').update(datos).eq('id', 1);
    if (error) { showToast(error.message, 'error'); return; }
    config = { ...config, ...datos };
    showToast('Ajustes guardados', 'success');
  }

  async function loadRobots() {
    const { data } = await db.from('scraper_runs').select('distribuidor, inicio, ok, productos, error').order('inicio', { ascending: false }).limit(60);
    const ultimo = {};
    for (const r of data || []) if (!ultimo[r.distribuidor]) ultimo[r.distribuidor] = r;
    $('robots').replaceChildren(...Object.entries(DISTRIBUIDORES).map(([k, n]) => {
      const r = ultimo[k];
      return h('div', { class: 'robot' },
        h('div', {}, h('span', { class: 'dot ' + (!r ? 'none' : r.ok ? 'ok' : 'err') }), h('b', {}, n)),
        h('div', { class: 'muted', style: 'font-size:13px;text-align:right' },
          !r ? 'Todavía no corrió' : r.ok ? `${r.productos?.toLocaleString('es-AR')} productos · ${fecha(r.inicio)}` : `Error ${fecha(r.inicio)}`));
    }));
  }

  $('cfg-guardar').addEventListener('click', guardarAjustes);
  loaders.ajustes = renderAjustes;

  /* ══════════════════════════════════════════════════════════════════════
     INICIO
  ══════════════════════════════════════════════════════════════════════ */
  await loadConfig();
  loadClientes();
  actualizarBadgeRepo();
  renderVenta();
  show('mostrador');
})();
