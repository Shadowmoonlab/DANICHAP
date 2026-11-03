// gestion/mostrador.js — Venta por teclado: buscar (F2) → Enter agrega → F9 cobra. Presupuestos por WhatsApp.
import {
  $, h, icon, vacio, db, toast, money, fecha, PAGOS, debounce, estado, nombreProveedor, mesListaDe, precioVenta,
  buscarPrecios, buscarStock, openModal, closeModal, confirmar, copiar, linkWhatsApp, registrarVista,
  actualizarBadgeRepo, unaVez, hoyISO, gananciaDe, gananciaDePrecio, buscarParecidos, errorAmigable, buscarListado, listarStock,
} from './core.js?v=39';
import { numeroAR, palabras, normalizar } from './texto.js?v=39';
import { presupuesto as textoPresupuesto } from './plantillas.js?v=39';
import { imprimirComprobante } from './comprobante.js?v=39';
import { editarCliente } from './clientes.js?v=39';

let resultados = [];
let selIdx = -1;
let venta = [];            // renglones de la venta actual
let presupuestoId = null;  // si la venta se cargó desde un presupuesto
let buscado = '';          // texto de la búsqueda que está en pantalla (Enter solo agrega de esa)
let enterEnEspera = null;  // texto para el que se apretó Enter antes de que llegaran sus resultados: se agrega apenas lleguen
let sonParecidos = false;  // la búsqueda exacta no encontró nada y se muestran artículos parecidos (errores de tipeo)
// Proveedores elegidos con los botones de abajo del buscador (uno, dos o tres: "los de chapa"). Vacío = todos.
// 'stock' = Mi stock. Sin escribir nada, se ve TODO lo de los elegidos; escribiendo, se busca solo en ellos.
const seleccion = new Set();
let listado = null;        // { desde, hayMas } mientras se muestra todo lo de los elegidos (sin escribir)
const POR_PAGINA = 60;

const buscador = () => $('pos-search');
const visibles = () => resultados;
const elegidosDist = () => [...seleccion].filter(k => k !== 'stock');
const conStock = () => !seleccion.size || seleccion.has('stock');
const conDist = () => !seleccion.size || elegidosDist().length > 0;

const aResultadoDist = (dist, d) => ({
  tipo: 'dist', key: `d-${d.id}`, precio_distribuidor_id: d.id, distribuidor: d.distribuidor,
  codigo: d.codigo, descripcion: d.descripcion, origen: nombreProveedor(d.distribuidor), listaMes: mesListaDe(d.distribuidor),
  precio: precioVenta(d.precio_neto, d.distribuidor), costo: d.precio_neto,
  extra: [d.marca, d.rubro, d.moneda !== 'ARS' ? `lista en ${d.moneda === 'USD' ? 'dólares' : 'euros'}: ${d.moneda} ${d.precio_original}` : null]
    .filter(Boolean).join(' · '),
  masBarato: dist.costoMin != null && dist.length > 1 && d.precio_neto === dist.costoMin,
  faltante: d.faltante || null,   // búsqueda flexible: no tiene esta palabra
  subio: d.precio_anterior > 0 && d.precio_neto > d.precio_anterior
    ? { pct: Math.max(1, Math.round((d.precio_neto / d.precio_anterior - 1) * 100)), antes: d.precio_anterior } : null,
});
const aResultadoStock = p => ({
  tipo: 'stock', key: `p-${p.id}`, producto_id: p.id, codigo: p.costo?.codigo_proveedor || '',
  descripcion: p.nombre, origen: 'Mi stock', precio: p.precio, costo: p.costo?.costo ?? null,
  extra: p.stock_cantidad != null ? `${p.stock_cantidad} u.` : (p.stock ? 'Con stock' : 'Sin stock'),
  sinStock: p.stock === false || p.stock_cantidad === 0,
});

/* ── Búsqueda ────────────────────────────────────────────────────────── */
let pedido = 0;   // cada búsqueda tiene su número: la respuesta de una búsqueda vieja nunca pisa a la nueva
const dejarDeBuscar = () => { const caja = $('pos-results'); caja.classList.remove('buscando'); delete caja.dataset.estado; };

const ejecutarBusqueda = debounce(async () => {
  const q = buscador().value.trim();
  const este = ++pedido;
  if (q.length < 2) {
    enterEnEspera = null; dejarDeBuscar();
    if (seleccion.size) { listar(0); return; }   // proveedores elegidos y nada escrito: todo lo de ellos
    listado = null; resultados = []; renderResultados(null); return;
  }
  const caja = $('pos-results');
  caja.classList.add('buscando');   // se nota que está buscando: nunca parece que se trabó
  let stock, dist, parecidos = false;
  try {
    [stock, dist] = await Promise.all([conStock() ? buscarStock(q) : [], conDist() ? buscarPrecios(q, 40, { proveedores: elegidosDist() }) : []]);
    // Nada exacto: se buscan parecidos ("paragople" → "paragolpe"), como hacen los buscadores grandes
    if (!stock.length && !dist.length && conDist() && este === pedido) {
      caja.dataset.estado = 'Buscando parecidos…';
      dist = (await buscarParecidos(q)).filter(d => !elegidosDist().length || seleccion.has(d.distribuidor));
      parecidos = dist.length > 0;
    }
  } catch {
    if (este !== pedido) return;
    dejarDeBuscar();
    errorDeBusqueda(q);
    return;
  }
  if (este !== pedido) return; // llegó tarde: el usuario siguió escribiendo (la nueva búsqueda maneja la pantalla)
  dejarDeBuscar();
  sonParecidos = parecidos;
  buscado = q;
  listado = null;
  dist.costoMin = Math.min(...dist.map(d => d.precio_neto ?? Infinity));
  // Primero los precios de los proveedores (al día); después "Mi stock" (los productos cargados a mano)
  resultados = [...dist.map(d => aResultadoDist(dist, d)), ...stock.map(aResultadoStock)];
  selIdx = visibles().length ? 0 : -1;
  renderResultados(q);
  // Un Enter apurado (para ESTE mismo texto) agrega el primero; nunca un "parecido": eso lo elige Daniel mirando
  if (enterEnEspera === q && !sonParecidos) agregarSeleccionado();
  enterEnEspera = null;
}, 220);

/** Sin internet o sesión vencida: se dice claro (nunca "no lo tengo") y se puede reintentar. */
function errorDeBusqueda(q) {
  enterEnEspera = null;
  resultados = []; selIdx = -1; buscado = null;
  renderWebs(null); renderProveedores(null);
  $('pos-results').replaceChildren(h('div', { class: 'empty' },
    vacio('wifi_off', `No se pudo buscar "${q}".`, h('br'), 'Revisá que haya internet y tocá Reintentar.'),
    h('button', { class: 'btn btn-primary', onclick: () => { ejecutarBusqueda(); buscador().focus(); } }, icon('refresh'), 'Reintentar')));
}

/* ── Buscar en las webs: proveedores que no salieron en esta búsqueda (los que el robot no lee, o sin coincidencias) ── */
function renderWebs(q) {
  const box = $('pos-webs');
  // Si solo hay "parecidos" (nada exacto), todas las webs valen la pena: puede estar en un proveedor sin robot
  const conResultados = new Set(sonParecidos ? [] : resultados.filter(r => r.tipo === 'dist').map(r => r.distribuidor));
  const webs = q == null ? [] : estado.proveedores.filter(p => p.activo && esLink(p.web) && !conResultados.has(p.slug));
  box.classList.toggle('hidden', !webs.length);
  if (!webs.length) { box.replaceChildren(); return; }
  box.replaceChildren(
    h('span', { class: 'muted' }, icon('travel_explore'), ` Buscá "${q}" en sus webs: se copia lo que escribiste y se abre la página, pegalo en su buscador.`),
    h('div', { class: 'pos-webs-lista' }, ...webs.map(p => h('button', { class: 'btn btn-sm', title: `Abrir ${p.web}`, onclick: () => abrirWeb(p, q) },
      icon('open_in_new'), p.nombre))));
}

// Solo links http(s): un valor raro guardado en la base nunca se abre como javascript: u otro esquema
const esLink = u => /^https?:\/\//i.test(u ?? '');

function abrirWeb(p, q) {
  // Copiar y abrir en el mismo clic: el navegador bloquea las pestañas que se abren después de esperar algo
  navigator.clipboard?.writeText(q).catch(() => {});
  const buscar = esLink(p.busqueda_url);
  window.open(buscar ? p.busqueda_url.replace('{q}', encodeURIComponent(q)) : p.web, '_blank', 'noopener');
  toast(buscar ? `Buscando en ${p.nombre}` : `Copiado "${q}": pegalo (Ctrl+V) en el buscador de ${p.nombre}`, 'success');
}

/* ── Proveedores, siempre a la vista abajo del buscador: se eligen uno o varios (y Mi stock) ──
   Sin escribir: todo lo de los elegidos, por nombre. Escribiendo: se busca solo en ellos (en la base, no solo
   entre los 40 que se ven). Con una búsqueda en todos, cada botón muestra cuántos resultados tiene. */
const proveedoresConPrecios = () => estado.proveedores.filter(p => p.activo && (estado.ultimaCarga?.[p.slug] || p.lista_mes));

function renderProveedores(q) {
  const box = $('pos-filtros');
  const cuenta = new Map();
  if (q) for (const r of resultados) { const k = r.tipo === 'stock' ? 'stock' : r.distribuidor; cuenta.set(k, (cuenta.get(k) || 0) + 1); }
  const boton = (k, texto) => h('button', {
    class: 'filtro' + (seleccion.has(k) ? ' on' : ''), 'aria-pressed': seleccion.has(k) ? 'true' : 'false',
    title: seleccion.has(k) ? 'Tocá de nuevo para sacarlo' : 'Tocá para ver o buscar solo en este (podés elegir varios)',
    onclick: () => elegir(k),
  }, seleccion.has(k) ? icon('check') : null, texto, cuenta.has(k) ? h('span', { class: 'n' }, cuenta.get(k)) : null);
  box.classList.remove('hidden');
  box.replaceChildren(
    h('button', { class: 'filtro' + (seleccion.size ? '' : ' on'), 'aria-pressed': seleccion.size ? 'false' : 'true', onclick: () => elegir(null) },
      'Todos', q && resultados.length && !seleccion.size ? h('span', { class: 'n' }, resultados.length) : null),
    boton('stock', 'Mi stock'),
    ...proveedoresConPrecios().map(p => boton(p.slug, p.nombre)));
  const nombres = [...seleccion].map(k => (k === 'stock' ? 'Mi stock' : nombreProveedor(k)));
  buscador().placeholder = nombres.length ? `Buscá solo en ${nombres.join(', ')}…` : 'Buscá en tu stock y en todos los proveedores: nombre, código o vehículo…';
}

function elegir(k) {
  if (k == null) seleccion.clear();
  else if (seleccion.has(k)) seleccion.delete(k);
  else seleccion.add(k);
  buscado = null;
  renderProveedores(buscador().value.trim() || null);
  ejecutarBusqueda();
  buscador().focus();
}

/** Todo lo de los proveedores elegidos (sin escribir nada), por nombre, de a 60 con "Ver más". */
async function listar(desde = 0) {
  const este = ++pedido;
  const caja = $('pos-results');
  caja.classList.add('buscando');
  let dist, stock;
  try {
    [dist, stock] = await Promise.all([buscarListado(elegidosDist(), desde, POR_PAGINA),
      seleccion.has('stock') ? listarStock(desde, POR_PAGINA) : []]);
  } catch {
    if (este !== pedido) return;
    dejarDeBuscar();
    errorDeBusqueda('los productos elegidos');
    return;
  }
  if (este !== pedido) return;
  dejarDeBuscar();
  dist.costoMin = null;   // en el listado no se compara "más barato"
  const nuevos = [...dist.map(d => aResultadoDist(dist, d)), ...stock.map(aResultadoStock)];
  resultados = desde ? [...resultados, ...nuevos] : nuevos;
  listado = { desde: desde + POR_PAGINA, hayMas: dist.length === POR_PAGINA || stock.length === POR_PAGINA };
  sonParecidos = false;
  buscado = '';
  if (!desde) selIdx = resultados.length ? 0 : -1;
  renderResultados('');
}

/** Marca en la descripción las palabras buscadas: el ojo va directo a lo que importa. */
function resaltar(texto, q) {
  const ws = palabras(q);
  if (!ws.length || sonParecidos) return [texto];
  return texto.split(/(\s+)/).map(parte => {
    const n = normalizar(parte);
    // "P/GOL" o "OPT.DEL": se mira cada pedazo separado por / . -
    const pedazos = [n, ...parte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[-/.,]/)];
    return parte.trim() && ws.some(w => (/^\d+$/.test(w) ? n.includes(w) : pedazos.some(p => p.startsWith(w)))) ? h('mark', {}, parte) : parte;
  });
}

/* ── Búsquedas recientes: con el buscador vacío, las últimas para repetirlas con un toque ── */
const RECIENTES = 'danichap-busquedas';
const recientes = () => { try { return JSON.parse(localStorage.getItem(RECIENTES)) || []; } catch { return []; } };
function recordarBusqueda(q) {
  try { localStorage.setItem(RECIENTES, JSON.stringify([q, ...recientes().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8))); } catch { /* sin almacenamiento */ }
}

function renderResultados(q) {
  renderWebs(q || null);   // en el listado (q = '') no hace falta buscar en las webs
  renderProveedores(q || null);
  const box = $('pos-results');
  if (q == null) {
    const ultimas = recientes();
    box.replaceChildren(vacio('manage_search', 'Escribí lo que te piden.', h('br'), 'Busca en tu stock y en todos los distribuidores a la vez.'),
      ultimas.length ? h('div', { class: 'recientes' }, h('span', { class: 'muted' }, icon('history'), 'Buscaste hace poco:'),
        ...ultimas.map(t => h('button', { class: 'filtro', onclick: () => { buscador().value = t; buscado = null; ejecutarBusqueda(); buscador().focus(); } }, t))) : '');
    return;
  }
  if (q === '' && !resultados.length) {
    box.replaceChildren(vacio('inventory_2', 'Este proveedor todavía no tiene productos cargados.'));
    return;
  }
  if (!resultados.length) {
    box.replaceChildren(h('div', { class: 'empty' },
      vacio('search_off', `No encontré nada con "${q}".`, h('br'), 'Probá con menos palabras o con el código.'),
      h('button', { class: 'btn btn-primary', onclick: () => venderAMano(q) }, icon('edit_note'), `Vender "${q.slice(0, 40)}" a mano`)));
    return;
  }
  const nombres = [...seleccion].map(k => (k === 'stock' ? 'Mi stock' : nombreProveedor(k))).join(', ');
  const aviso = q === '' ? h('div', { class: 'aviso-listado' }, icon('list'),
      h('span', {}, `Todo lo de ${nombres}, por nombre. Escribí arriba para buscar solo en ${seleccion.size > 1 ? 'estos' : 'este'}.`))
    : sonParecidos ? h('div', { class: 'aviso-parecidos' }, icon('spellcheck'),
      h('span', {}, `No encontré exacto "${q}". Estos se parecen (¿quizás está escrito distinto?):`)) : null;
  const verMas = q === '' && listado?.hayMas
    ? h('button', { class: 'btn ver-mas', onclick: () => listar(listado.desde) }, icon('expand_more'), `Ver ${POR_PAGINA} más`) : null;
  box.replaceChildren(aviso || '', ...visibles().map((r, i) => h('div', {
    class: 'res' + (i === selIdx ? ' sel' : ''), 'data-i': i, role: 'option', 'aria-selected': i === selIdx ? 'true' : 'false',
    // Un clic en la lista vieja (mientras llega la nueva) no hace nada: nunca agrega otra cosa que la tocada
    onclick: () => { if (buscador().value.trim() !== buscado) return; selIdx = i; agregarSeleccionado(); },
  },
    h('div', { class: 'desc' }, ...resaltar(r.descripcion, q)),
    h('div', { class: 'price' },
      h('div', { class: 'pv num' }, r.precio != null ? money(r.precio) : 'Sin precio'),
      r.costo != null ? h('div', { class: 'pc num' }, `costo ${money(r.costo)}`) : null,
      r.masBarato ? h('span', { class: 'best' }, '★ más barato') : null),
    h('div', { class: 'meta' },
      h('span', { class: 'chip' + (r.tipo === 'stock' ? ' chip-stock' : '') }, r.origen),
      r.listaMes ? h('span', { class: 'chip' + (r.listaMes.vieja ? ' chip-amber' : ' chip-gray'),
        title: r.listaMes.vieja ? 'Precios viejos: pueden estar desactualizados' : 'De cuándo son los precios' }, r.listaMes.texto + (r.listaMes.vieja ? ' · vieja' : '')) : null,
      r.codigo ? h('span', {}, r.codigo) : null,
      r.extra ? h('span', {}, r.extra) : null,
      r.sinStock ? h('span', { class: 'chip chip-gray' }, 'sin stock') : null,
      r.subio ? h('span', { class: 'chip chip-amber', title: `Antes ${money(r.subio.antes)}` }, `subió ${r.subio.pct}%`) : null,
      r.faltante ? h('span', { class: 'chip chip-gray', title: 'Parecido: tiene todo lo buscado menos esta palabra' }, `no dice: ${r.faltante}`) : null),
  )), verMas || '');
}

function moverSeleccion(delta) {
  const lista = visibles();
  if (!lista.length) return;
  selIdx = (selIdx + delta + lista.length) % lista.length;
  document.querySelectorAll('#pos-results .res').forEach((el, i) => {
    el.classList.toggle('sel', i === selIdx);
    el.setAttribute('aria-selected', i === selIdx ? 'true' : 'false');
  });
  document.querySelector(`#pos-results .res[data-i="${selIdx}"]`)?.scrollIntoView({ block: 'nearest' });
}

function agregarSeleccionado() {
  // Mientras se tipea (o la búsqueda nueva no llegó), Enter no agrega un resultado de la búsqueda anterior
  const texto = buscador().value.trim();
  if (texto !== buscado) { enterEnEspera = texto.length >= 2 ? texto : null; return; }
  const r = visibles()[selIdx];
  if (!r) return;
  const ya = venta.find(v => v.key === r.key);
  if (ya) ya.cantidad++;
  else venta.push({
    key: r.key, producto_id: r.producto_id || null, precio_distribuidor_id: r.precio_distribuidor_id || null,
    codigo: r.codigo, descripcion: r.descripcion, origen: r.origen, distribuidor: r.distribuidor || null,
    cantidad: 1, precio_unit: r.precio ?? 0, costo_unit: r.costo,
  });
  ultimoAgregado = r.key;
  renderVenta();
  recordarBusqueda(buscado);
  buscador().select();
}
let ultimoAgregado = null;   // el renglón recién sumado se ilumina un momento (en vez de un cartel que tapa Cobrar)

/* ── Venta actual ────────────────────────────────────────────────────── */
function renderVenta() {
  const box = $('pos-items');
  if (!venta.length) {
    box.replaceChildren(vacio('shopping_cart', 'Todavía no agregaste nada.'));
  } else {
    box.replaceChildren(...venta.map(v => {
      const qty = h('input', { value: v.cantidad, inputmode: 'numeric', 'aria-label': 'Cantidad',
        onchange: e => { v.cantidad = Math.max(1, parseInt(e.target.value, 10) || 1); renderVenta(); } });
      const pr = h('input', { class: 'pr num', value: v.precio_unit.toLocaleString('es-AR'), inputmode: 'decimal', 'aria-label': 'Precio',
        onchange: e => {   // "15.000" = quince mil
          const n = Math.max(0, numeroAR(e.target.value) ?? 0), antes = v.precio_unit;
          // Un precio muy por debajo (un punto o una coma de más) se pregunta: nunca se cobra mal por un error de tipeo.
          // Mientras se pregunta, Cobrar y Presupuesto esperan la respuesta (F9 justo después de tipear)
          if (n > 0 && ((v.costo_unit > 0 && n < v.costo_unit) || (antes > 0 && n < antes / 2))) {
            precioPendiente = confirmar('¿Precio correcto?', `Pusiste ${money(n)} y antes era ${money(antes)}${v.costo_unit > 0 ? ` (te cuesta ${money(v.costo_unit)})` : ''}. ¿Lo dejo así?`, { ok: 'Sí, dejar ese precio', peligro: true })
              .then(ok => { if (ok) v.precio_unit = n; precioPendiente = null; renderVenta(); return ok; });
            return;
          }
          v.precio_unit = n; renderVenta();
        } });
      // Ganancia del renglón: se ve siempre y con un toque se cambia (opciones rápidas con el precio ya calculado)
      const gan = v.costo_unit > 0 ? gananciaDePrecio(v.precio_unit, v.costo_unit) : null;
      const chipGanancia = gan == null ? null : h('button', {
        class: 'gan' + (gan < 15 ? ' baja' : '') + (v.editando ? ' on' : ''), title: 'Cambiar la ganancia de este artículo',
        'aria-expanded': v.editando ? 'true' : 'false', onclick: () => { v.editando = !v.editando; renderVenta(); },
      }, icon('trending_up'), `ganancia ${pct(gan)} · ganás ${money(v.cantidad * (v.precio_unit - v.costo_unit))}`);
      return h('div', { class: 'ti' + (v.editando ? ' editando' : '') + (v.key === ultimoAgregado ? ' recien' : '') },
        h('div', {}, h('div', { class: 'd' }, v.descripcion), h('div', { class: 'src' }, [v.origen, v.codigo].filter(Boolean).join(' · ')),
          chipGanancia),
        h('button', { class: 'btn btn-icon btn-red', title: 'Quitar', 'aria-label': 'Quitar', onclick: () => { venta = venta.filter(x => x !== v); renderVenta(); } }, icon('close')),
        h('div', { class: 'ctrl' },
          h('div', { class: 'qty' },
            h('button', { onclick: () => { v.cantidad = Math.max(1, v.cantidad - 1); renderVenta(); }, 'aria-label': 'Menos' }, '−'),
            qty,
            h('button', { onclick: () => { v.cantidad++; renderVenta(); }, 'aria-label': 'Más' }, '+')),
          h('span', { class: 'muted' }, '×'), pr),
        h('div', { class: 'sub num' + (v.precio_unit > 0 ? '' : ' sin-precio') }, v.precio_unit > 0 ? money(v.cantidad * v.precio_unit) : 'Sin precio'),
        v.editando ? selectorGanancia(v) : null);   // fila propia, de lado a lado del renglón
    }));
  }
  const total = venta.reduce((s, v) => s + v.cantidad * v.precio_unit, 0);
  const conCosto = venta.filter(v => v.costo_unit != null);
  const ganancia = conCosto.reduce((s, v) => s + v.cantidad * (v.precio_unit - v.costo_unit), 0);
  ultimoAgregado = null;
  // En la compu se muestra el renglón nuevo; en el celular no (la venta está abajo y se perdería la búsqueda:
  // para eso está la barra con el total)
  if (window.innerWidth > 1000) document.querySelector('#pos-items .ti.recien')?.scrollIntoView({ block: 'nearest' });
  // Celular: barra fija con cuántos artículos y el total (la venta queda debajo de la búsqueda)
  const unidades = venta.reduce((s, v) => s + v.cantidad, 0);
  $('pos-barra').classList.toggle('hidden', !venta.length);
  document.body.classList.toggle('con-venta', venta.length > 0);
  $('pos-barra-txt').textContent = `${unidades === 1 ? '1 artículo' : `${unidades} artículos`} · ${money(total)}`;
  $('pos-total').textContent = money(total);
  $('pos-gain').textContent = conCosto.length
    ? `Ganancia: ${money(ganancia)}${conCosto.length < venta.length ? ' (sin contar artículos sin costo)' : ''}` : '';
  const medio = $('pos-pago').value;
  $('pos-cobrar').disabled = !venta.length;
  $('pos-cobrar-txt').textContent = venta.length ? `Cobrar ${money(total)} · ${PAGOS[medio]}` : 'Cobrar';
  $('pos-presu').disabled = !venta.length;
  document.querySelector('#pos-items .gan-selector')?.scrollIntoView({ block: 'nearest' });   // que se vea entero al abrirlo
  $('pos-presu-badge').classList.toggle('hidden', !presupuestoId);
  $('pos-presu-badge').textContent = presupuestoId ? `Presupuesto Nº ${presupuestoId}` : '';
}

const pct = g => `${Number.isInteger(g) ? g : g.toFixed(1)}%`;

/**
 * Selector de ganancia de un renglón: opciones rápidas (la de Ajustes marcada) que muestran el precio final y
 * cuánto se gana, un % a elección, y "a toda la venta" para un precio especial (ej. a un mecánico).
 */
function selectorGanancia(v) {
  const base = gananciaDe(v.distribuidor);
  const actual = gananciaDePrecio(v.precio_unit, v.costo_unit);
  const opciones = [...new Set([20, 30, 50, 70, base, 100].map(Number))].sort((a, b) => a - b);
  const aplicar = p => {
    v.precio_unit = precioVenta(v.costo_unit, v.distribuidor, p);
    v.editando = false;
    renderVenta();
    buscador().focus();
  };
  const otro = h('input', { class: 'input input-sm num', inputmode: 'decimal', placeholder: 'otro %', 'aria-label': 'Otra ganancia en %',
    onkeydown: async e => {
      if (e.key !== 'Enter') return;
      const n = numeroAR(e.target.value);
      if (n == null || n <= -100) return;
      // Ganancia negativa = vender por debajo del costo: se pregunta, nunca pasa por un error de tipeo
      if (n < 0 && !(await confirmar('Venta por debajo del costo', `Con ${n}% vendés por debajo de lo que te cuesta. ¿Seguro?`, { ok: 'Sí, vender así', peligro: true }))) return;
      aplicar(n);
    } });
  return h('div', { class: 'gan-selector', role: 'group', 'aria-label': 'Elegir ganancia' },
    ...opciones.map(p => h('button', {
      class: 'gan-op' + (Math.abs(p - actual) < 0.5 ? ' on' : '') + (p === base ? ' base' : ''),
      title: p === base ? 'Tu ganancia de Ajustes' : '', onclick: () => aplicar(p),
    }, h('b', {}, `${p}%`), h('span', {}, money(precioVenta(v.costo_unit, v.distribuidor, p))),
       h('small', {}, `ganás ${money(precioVenta(v.costo_unit, v.distribuidor, p) - v.costo_unit)}`))),
    otro,
    venta.filter(x => x.costo_unit > 0).length > 1 ? h('button', { class: 'btn btn-sm', title: 'Misma ganancia para todos los artículos de esta venta', onclick: () => {
      const g = gananciaDePrecio(v.precio_unit, v.costo_unit);
      for (const x of venta) if (x.costo_unit > 0) x.precio_unit = precioVenta(x.costo_unit, x.distribuidor, g);
      v.editando = false;
      renderVenta();
      toast(`Ganancia de ${pct(g)} aplicada a toda la venta`, 'success');
    } }, icon('done_all'), `${pct(actual)} a toda la venta`) : null);
}

/* ── Vender algo que no está en ninguna lista: descripción, costo y ganancia (o precio) que se calculan solos ── */
function venderAMano(texto = '') {
  const desc = h('input', { class: 'input', value: texto, placeholder: 'Ej: Faro auxiliar universal', 'aria-label': 'Qué se vende' });
  const costo = h('input', { class: 'input num', inputmode: 'decimal', placeholder: 'Opcional', 'aria-label': 'Costo' });
  const ganancia = h('input', { class: 'input num', inputmode: 'decimal', value: estado.config.ganancia_pct, 'aria-label': 'Ganancia %' });
  const precio = h('input', { class: 'input num', inputmode: 'decimal', placeholder: '$', 'aria-label': 'Precio de venta' });
  const cantidad = h('input', { class: 'input num', inputmode: 'numeric', value: 1, 'aria-label': 'Cantidad' });
  const pedir = h('input', { type: 'checkbox' });
  const resumen = h('p', { class: 'muted' });
  let precioEscrito = false;   // si Daniel escribió el precio, cambiar el costo recalcula la ganancia (no le pisa el precio)
  const actualizar = origen => {
    if (origen === 'precio') precioEscrito = numeroAR(precio.value) > 0;
    if (origen === 'ganancia') precioEscrito = false;
    const c = numeroAR(costo.value), g = numeroAR(ganancia.value), p = numeroAR(precio.value);
    if (!precioEscrito && origen !== 'precio' && c > 0 && g != null) precio.value = precioVenta(c, null, g);
    if (precioEscrito && c > 0 && p > 0) ganancia.value = gananciaDePrecio(p, c);
    const pf = numeroAR(precio.value), gf = numeroAR(ganancia.value);
    // Sin costo: se calcula con la ganancia en % (a la vista, para que la cambie si no es así). Nunca queda "$0 de ganancia"
    resumen.textContent = c > 0 && pf > 0 ? `Ganás ${money(pf - c)} por unidad.`
      : pf > 0 && gf != null && gf > -100 ? `Sin costo: se calcula con ${gf}% de ganancia → costo ${money(Math.round(pf / (1 + gf / 100)))}, ganás ${money(pf - Math.round(pf / (1 + gf / 100)))}. Si no es así, cambiá el costo o el %.`
      : 'Poné el costo o la ganancia en %, así sabés cuánto ganaste.';
  };
  costo.addEventListener('input', () => actualizar('costo'));
  ganancia.addEventListener('input', () => actualizar('ganancia'));
  precio.addEventListener('input', () => actualizar('precio'));
  actualizar();
  const agregar = () => {
    const d = desc.value.trim(), p = numeroAR(precio.value), g = numeroAR(ganancia.value);
    let c = numeroAR(costo.value);
    if (!(c > 0) && p > 0 && g != null && g > -100) c = Math.round(p / (1 + g / 100));   // costo a partir de la ganancia
    if (!d) { toast('Escribí qué se vende', 'error'); desc.focus(); return; }
    if (!(p > 0)) { toast('Falta el precio de venta', 'error'); precio.focus(); return; }
    venta.push({ key: `m-${Date.now()}`, producto_id: null, precio_distribuidor_id: null, codigo: '', descripcion: d,
                 origen: 'A mano', distribuidor: null, cantidad: Math.max(1, parseInt(cantidad.value, 10) || 1),
                 precio_unit: p, costo_unit: c > 0 ? c : null, reponer: pedir.checked });
    closeModal(); renderVenta(); buscador().focus();
    toast(`Agregado a mano: ${d.slice(0, 40)}`, 'success');
  };
  [desc, costo, ganancia, precio, cantidad].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') agregar(); }));
  openModal({
    title: 'Vender algo que no está en las listas',
    body: h('div', {},
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Qué se vende'), desc),
      h('div', { class: 'grid4' },
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Costo ($)'), costo),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Ganancia (%)'), ganancia),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Precio de venta ($)'), precio),
        h('div', { class: 'field' }, h('label', { class: 'label' }, 'Cantidad'), cantidad)),
      resumen,
      h('label', { class: 'check' }, pedir, 'Anotarlo en Reposición para pedirlo')),
    foot: [h('button', { class: 'btn', onclick: closeModal }, 'Cancelar'),
           h('button', { class: 'btn btn-primary', onclick: agregar }, icon('add_shopping_cart'), 'Agregar a la venta')],
  });
  setTimeout(() => (texto ? costo : desc).focus(), 0);
}

function clienteElegido() {
  const nombre = $('pos-cliente').value.trim();
  return { nombre, cliente: estado.clientes.find(c => c.nombre.toLowerCase() === nombre.toLowerCase()) || null };
}

function itemsParaGuardar() {
  return venta.map(v => ({
    producto_id: v.producto_id, precio_distribuidor_id: v.precio_distribuidor_id, codigo: v.codigo,
    descripcion: v.descripcion, origen: v.origen, cantidad: v.cantidad, precio_unit: v.precio_unit, costo_unit: v.costo_unit,
    reponer: v.reponer ?? true,   // lo vendido a mano solo va a Reposición si se tildó
  }));
}

function limpiarVenta() {
  venta = []; presupuestoId = null;
  $('pos-cliente').value = '';
  $('pos-print').checked = false;
  $('pos-pago').value = 'efectivo';
  renderVenta();
}

// unaVez: mientras se registra, tocar +/− rehabilita el botón; igual no se puede cobrar dos veces
let precioPendiente = null;   // pregunta "¿Precio correcto?" abierta: cobrar espera la respuesta (y no cobra si fue No)
const cobrar = unaVez(async () => {
  if (precioPendiente && !(await precioPendiente)) return;
  if (!venta.length) return;
  const gratis = venta.filter(v => !(v.precio_unit > 0));
  if (gratis.length && !(await confirmar('Artículos sin precio',
    `${gratis.length === 1 ? 'Hay 1 artículo' : `Hay ${gratis.length} artículos`} a $0 (${gratis.map(v => v.descripcion).join(', ').slice(0, 120)}). ¿Cobrar igual?`,
    { ok: 'Cobrar igual' }))) return;
  const { nombre, cliente } = clienteElegido();
  const medio = $('pos-pago').value;
  const btn = $('pos-cobrar');
  btn.disabled = true;
  const imprimir = $('pos-print').checked;
  const payload = {
    cliente_id: cliente?.id ?? null, cliente_nombre: cliente?.nombre ?? (nombre || null),
    medio_pago: medio, impreso: imprimir, presupuesto_id: presupuestoId, items: itemsParaGuardar(),
  };
  const { data: ventaId, error } = await db.rpc('registrar_venta', { p_venta: payload });
  if (error) { btn.disabled = false; toast(errorAmigable(error, 'La venta NO se guardó', 'tocá Cobrar de nuevo'), 'error', 0); return; }
  if (imprimir) imprimirComprobante({ id: ventaId, created_at: new Date().toISOString(), cliente_nombre: payload.cliente_nombre, medio_pago: medio, items: payload.items });
  toast(`Venta Nº ${ventaId}: ${money(payload.items.reduce((s, i) => s + i.cantidad * i.precio_unit, 0))} · ${PAGOS[medio]}`, 'success', 6000);
  limpiarVenta();
  actualizarBadgeRepo();
  if (payload.presupuesto_id) actualizarBadgePresupuestos();
  seleccion.clear();   // el próximo cliente arranca buscando en todos los proveedores
  limpiarBusqueda();
});

/* ── Presupuestos ────────────────────────────────────────────────────── */
async function presupuestoWhatsApp() {
  if (precioPendiente && !(await precioPendiente)) return;
  if (!venta.length) return;
  const { nombre, cliente } = clienteElegido();
  const texto = textoPresupuesto({ cliente: cliente?.nombre || nombre, items: venta, negocio: estado.config });
  const area = h('textarea', { class: 'input', rows: 14 }, texto);
  const guardar = unaVez(async () => {
    const total = venta.reduce((s, v) => s + v.cantidad * v.precio_unit, 0);
    const valido = new Date(Date.parse(hoyISO() + 'T12:00:00Z') + 2 * 864e5).toISOString().slice(0, 10);   // hoy en Argentina + 2 días
    const datos = { cliente_id: cliente?.id ?? null, cliente_nombre: cliente?.nombre ?? (nombre || null), items: itemsParaGuardar(), total, valido_hasta: valido };
    const q = presupuestoId ? db.from('presupuestos').update(datos).eq('id', presupuestoId) : db.from('presupuestos').insert(datos);
    const { data, error } = await q.select('id').single();
    if (error) { toast(error.message, 'error'); return null; }
    presupuestoId = data.id; renderVenta(); actualizarBadgePresupuestos();
    return data.id;
  });
  openModal({
    title: 'Presupuesto por WhatsApp', wide: true,
    body: h('div', {},
      h('p', { class: 'muted', style: 'margin-top:0' }, cliente?.telefono
        ? `Se abre WhatsApp con ${cliente.nombre} (${cliente.telefono}). Podés editar el texto antes.`
        : 'Sin teléfono cargado: WhatsApp te va a pedir elegir el contacto. Podés editar el texto antes.'),
      area),
    foot: [
      h('button', { class: 'btn', onclick: async () => { if (await guardar()) { closeModal(); toast('Presupuesto guardado', 'success'); } } }, icon('save'), 'Solo guardar'),
      h('button', { class: 'btn', onclick: () => copiar(area.value, 'Presupuesto copiado') }, icon('content_copy'), 'Copiar'),
      h('button', { class: 'btn btn-green', onclick: async () => {
        if (!(await guardar())) return;
        window.open(linkWhatsApp(cliente?.telefono, area.value), '_blank', 'noopener');
        closeModal(); toast('Presupuesto guardado y abierto en WhatsApp', 'success');
      } }, icon('send'), 'Guardar y enviar'),
    ],
  });
}

export async function actualizarBadgePresupuestos() {
  const { count } = await db.from('presupuestos').select('id', { count: 'exact', head: true }).eq('estado', 'abierto');
  $('pos-presus-n').textContent = count ? `(${count})` : '';
}

async function verPresupuestos() {
  const { data, error } = await db.from('presupuestos')
    .select('id, cliente_nombre, items, total, valido_hasta, created_at').eq('estado', 'abierto')
    .order('created_at', { ascending: false }).limit(50);
  if (error) { toast(error.message, 'error'); return; }
  const hoy = hoyISO();   // no la fecha UTC: después de las 21 h ya sería mañana
  openModal({
    title: 'Presupuestos abiertos', wide: true,
    body: data.length ? h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Nº'), h('th', {}, 'Fecha'), h('th', {}, 'Cliente'), h('th', {}, 'Artículos'), h('th', { class: 'right' }, 'Total'), h('th', {}))),
      h('tbody', {}, ...data.map(p => h('tr', {},
        h('td', { class: 'num' }, p.id), h('td', {}, fecha(p.created_at),
          p.valido_hasta && p.valido_hasta < hoy ? h('span', { class: 'chip chip-gray', style: 'margin-left:6px' }, 'vencido') : null),
        h('td', {}, p.cliente_nombre || h('span', { class: 'muted' }, 'Sin nombre')),
        h('td', { class: 'muted' }, p.items.map(i => `${i.cantidad} x ${i.descripcion}`).join(', ').slice(0, 70)),
        h('td', { class: 'right num' }, h('b', {}, money(p.total))),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => cargarPresupuesto(p) }, 'Cargar'),
          h('button', { class: 'btn btn-sm btn-icon btn-red', title: 'Descartar', 'aria-label': 'Descartar', style: 'margin-left:4px', onclick: async () => {
            if (!(await confirmar('Descartar presupuesto', `¿Descartar el presupuesto Nº ${p.id}${p.cliente_nombre ? ` de ${p.cliente_nombre}` : ''}?`, { ok: 'Sí, descartar', peligro: true }))) { verPresupuestos(); return; }
            const { error: e } = await db.from('presupuestos').update({ estado: 'descartado' }).eq('id', p.id);
            if (e) { toast('No se pudo descartar: ' + e.message, 'error'); return; }
            closeModal(); actualizarBadgePresupuestos(); verPresupuestos();
          } }, icon('close'))))))) : vacio('request_quote', 'No hay presupuestos abiertos.'),
  });
}

async function cargarPresupuesto(p) {
  if (venta.length && !(await confirmar('Reemplazar venta', 'Hay artículos en la venta actual. ¿Los reemplazo por este presupuesto?', { ok: 'Reemplazar' }))) return;
  venta = p.items.map((i, n) => ({ ...i, key: i.producto_id ? `p-${i.producto_id}` : i.precio_distribuidor_id ? `d-${i.precio_distribuidor_id}` : `x-${n}` }));
  presupuestoId = p.id;
  $('pos-cliente').value = p.cliente_nombre || '';
  closeModal(); renderVenta();
  toast(`Presupuesto Nº ${p.id} cargado. Revisá precios y cobrá con F9.`, 'success');
}

/** Esc: borra la búsqueda y deja el cursor listo para la próxima (la venta en curso no se toca). */
export function limpiarBusqueda() {
  enterEnEspera = null;
  pedido++;   // lo que estaba buscando ya no importa
  dejarDeBuscar();
  buscador().value = '';
  resultados = []; selIdx = -1; buscado = null; listado = null;
  // Esc borra lo escrito pero deja los proveedores elegidos (vuelve a mostrar todo lo de ellos)
  if (seleccion.size) listar(0); else renderResultados(null);
  buscador().focus();
}

/* ── Inicio ──────────────────────────────────────────────────────────── */
export function iniciarMostrador() {
  buscador().addEventListener('input', () => { buscado = null; ejecutarBusqueda(); });
  buscador().addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moverSeleccion(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moverSeleccion(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); agregarSeleccionado(); }
  });
  $('pos-cobrar').addEventListener('click', cobrar);
  $('pos-barra-ver').addEventListener('click', () => document.querySelector('.ticket').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('pos-presu').addEventListener('click', presupuestoWhatsApp);
  $('pos-presus').addEventListener('click', verPresupuestos);
  $('pos-clear').addEventListener('click', async () => {
    const total = venta.reduce((s, v) => s + v.cantidad * v.precio_unit, 0);
    if (venta.length && !(await confirmar('Vaciar la venta', `Se sacan ${venta.length === 1 ? '1 artículo' : `${venta.length} artículos`} (${money(total)}). ¿Seguro?`, { ok: 'Sí, vaciar', peligro: true }))) return;
    limpiarVenta(); buscador().focus();
  });
  // Ojo: oculta costos y ganancia de la pantalla (el cliente la ve del otro lado del mostrador). Se recuerda.
  const ojo = oculto => {
    document.body.classList.toggle('ocultar-costos', oculto);
    $('pos-ojo').setAttribute('aria-pressed', oculto ? 'true' : 'false');
    $('pos-ojo').querySelector('.ms').textContent = oculto ? 'visibility_off' : 'visibility';
    try { localStorage.setItem('danichap-ocultar-costos', oculto ? '1' : ''); } catch { /* sin almacenamiento */ }
  };
  try { ojo(localStorage.getItem('danichap-ocultar-costos') === '1'); } catch { /* sin almacenamiento */ }
  $('pos-ojo').addEventListener('click', () => { ojo(!document.body.classList.contains('ocultar-costos')); buscador().focus(); });
  $('pos-manual').addEventListener('click', () => venderAMano());
  $('pos-cliente-nuevo').addEventListener('click', () => editarCliente(null, c => { $('pos-cliente').value = c.nombre; }));
  $('pos-pago').addEventListener('change', () => renderVenta());
  renderVenta();
  actualizarBadgePresupuestos();
  registrarVista('mostrador', () => { renderProveedores(buscador().value.trim() || null); setTimeout(() => buscador().focus(), 0); });
}

