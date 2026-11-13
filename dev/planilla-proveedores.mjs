// dev/planilla-proveedores.mjs — Funciones puras para importar la planilla de proveedores de Daniel (PROVEEDORES.xlsx):
// equivalencias de nombres → slug, fechas y montos mal escritos, renglones → compras y pagos históricos, SQL de carga,
// CSV (separado por ; para que Excel en castellano lo abra bien) e informe. Sin archivos ni red: lo usa
// dev/importar-planilla-proveedores.mjs y lo prueba tests/planilla-proveedores.test.mjs.
//
// Cómo se cargan: cada compra como nota de DÉBITO y cada pago como nota de CRÉDITO "de la planilla"
// (notas_proveedor.origen = 'planilla', ver docs/gestion-v19.sql). Así no tocan el stock ni el Libro diario
// (que lee recepciones y pagos_proveedor), cuentan en el saldo y la antigüedad (cc_proveedores las toma como
// sueltas: lo pagado cancela lo más viejo) y se borran y recargan con un solo delete.

/* ── Nombres ─────────────────────────────────────────────────────────── */
/** "  leo  cávila " → "LEO CAVILA" (mayúsculas, sin tildes, espacios simples). */
export function normalizarNombre(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Palabras que no distinguen a un proveedor de otro ("PR REPUESTO" = "PR Autopartes", "DM RTO" = "DM")
const RUIDO = new Set(['HNOS', 'HNO', 'HERMANOS', 'SA', 'SRL', 'SAS', 'SH', 'RTO', 'REMITO', 'REMITOS', 'AUTOPARTES', 'AUTOPARTE',
  'REPUESTO', 'REPUESTOS', 'DISTRIBUIDORA', 'METALURGICA', 'OPTICAS', 'OPTICA', 'LA', 'EL', 'LOS', 'LAS', 'DE', 'Y']);

function tokens(s) {
  const todos = normalizarNombre(s).replace(/\./g, '').split(/[^A-Z0-9]+/).filter(Boolean);
  const utiles = todos.filter(t => !RUIDO.has(t));
  return utiles.length ? utiles : todos;
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const parecido = (a, b) => (!a || !b ? 0 : 1 - levenshtein(a, b) / Math.max(a.length, b.length));

/** Parecido entre dos nombres (0 a 1): palabra por palabra (tolera una letra de más o de menos) o todo junto. */
function similitud(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const largo = t => t.reduce((s, x) => s + x.length, 0);
  let credito = 0;
  for (const t of ta) {
    let mejor = 0;
    for (const u of tb) {
      const p = t === u ? 1 : Math.min(t.length, u.length) >= 3 ? parecido(t, u) : 0;
      if (p >= 0.75 && p > mejor) mejor = p;
    }
    credito += mejor * t.length;
  }
  return Math.max(credito / Math.min(largo(ta), largo(tb)), parecido(ta.join(''), tb.join('')));
}

const ALTA = 0.85, MEDIA = 0.6, AGRUPAR = 0.8;
const redondeo = n => Math.round(n * 100) / 100;

/**
 * El proveedor del sistema que más se parece a un nombre de la planilla.
 * @returns {{slug: string|null, nombre: string|null, confianza: 'alta'|'media'|'nueva', puntaje: number}}
 */
export function proponerSlug(nombre, proveedores) {
  let mejor = null, puntaje = 0;
  for (const p of proveedores) {
    const s = Math.max(similitud(nombre, p.nombre), parecido(tokens(nombre).join(''), p.slug.toUpperCase()));
    if (s > puntaje) { puntaje = s; mejor = p; }
  }
  if (!mejor || puntaje < MEDIA) return { slug: null, nombre: null, confianza: 'nueva', puntaje: redondeo(puntaje) };
  return { slug: mejor.slug, nombre: mejor.nombre, confianza: puntaje >= ALTA ? 'alta' : 'media', puntaje: redondeo(puntaje) };
}

/** Slug para un proveedor nuevo: "BETA CHICO" → "betachico" (solo a-z y 0-9, como pide la tabla proveedores). */
export function slugNuevo(nombre) {
  return tokens(nombre).join('').toLowerCase().replace(/[^a-z0-9]/g, '') || 'proveedor';
}

const titulo = s => normalizarNombre(s).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

/**
 * Una fila por nombre de la planilla con el slug propuesto. Los nombres nuevos parecidos entre sí
 * ("ACME" y "ACMES") van al mismo slug. Lo que Daniel escribió en slug_final de la versión anterior se respeta.
 * @param {{nombre: string, renglones: number}[]} nombres  ya normalizados
 * @param {Map<string, {slug_final?: string}>} previas     equivalencias.csv anterior, por nombre
 */
export function armarEquivalencias(nombres, proveedores, previas = new Map()) {
  const ordenados = [...nombres].sort((a, b) => b.renglones - a.renglones || a.nombre.localeCompare(b.nombre));
  const nuevos = [];   // { nombre, slug }
  const usados = new Set(proveedores.map(p => p.slug));
  return ordenados.map(({ nombre, renglones }) => {
    const p = proponerSlug(nombre, proveedores);
    let slug = p.slug, nombreSistema = p.nombre, nota = '';
    if (!slug) {
      const grupo = nuevos.find(g => similitud(nombre, g.nombre) >= AGRUPAR);
      if (grupo) { slug = grupo.slug; nombreSistema = titulo(grupo.nombre); nota = `parecido a "${grupo.nombre}"`; }
      else {
        const base = slugNuevo(nombre);
        slug = base;
        for (let i = 2; usados.has(slug); i++) slug = `${base}${i}`;
        usados.add(slug);
        nuevos.push({ nombre, slug });
        nombreSistema = titulo(nombre);
        nota = 'se crea como proveedor nuevo';
      }
    }
    return { nombre_planilla: nombre, renglones, slug_propuesto: slug, nombre_sistema: nombreSistema, confianza: p.confianza,
      puntaje: p.puntaje, slug_final: previas.get(nombre)?.slug_final ?? '', nota };
  });
}

/** Separa los valores de una tupla SQL "('a', 'b (c)', 10, (select …))" respetando comillas y paréntesis. */
function camposTupla(txt) {
  const campos = [];
  let actual = '', comilla = false, nivel = 0;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (comilla) {
      if (c === "'" && txt[i + 1] === "'") { actual += "'"; i++; }
      else if (c === "'") comilla = false;
      else actual += c;
      continue;
    }
    if (c === "'") { comilla = true; actual += '\u0000'; continue; }   // marca: el campo era un texto
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) { campos.push(actual.trim()); actual = ''; continue; }
    actual += c;
  }
  campos.push(actual.trim());
  return campos.map(f => (f.startsWith('\u0000') ? f.slice(1) : f));
}

/** Slugs y nombres de los insert into public.proveedores de docs/*.sql (los proveedores que el sistema ya conoce). */
export function extraerProveedores(sql) {
  const vistos = new Map();
  for (const m of sql.matchAll(/insert\s+into\s+public\.proveedores\s*\(([^)]*)\)\s*values([\s\S]*?)on\s+conflict/gi)) {
    const columnas = m[1].split(',').map(c => c.trim().toLowerCase());
    const iSlug = columnas.indexOf('slug'), iNombre = columnas.indexOf('nombre');
    if (iSlug < 0 || iNombre < 0) continue;
    // Cada tupla de nivel 0: se recorre a mano porque los nombres pueden tener paréntesis y los valores subconsultas
    const txt = m[2];
    let nivel = 0, comilla = false, inicio = -1;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (comilla) { if (c === "'" && txt[i + 1] === "'") i++; else if (c === "'") comilla = false; continue; }
      if (c === "'") comilla = true;
      else if (c === '(') { if (nivel++ === 0) inicio = i + 1; }
      else if (c === ')' && --nivel === 0) {
        const campos = camposTupla(txt.slice(inicio, i));
        const slug = campos[iSlug], nombre = campos[iNombre];
        if (/^[a-z0-9_]+$/.test(slug ?? '') && nombre && !vistos.has(slug)) vistos.set(slug, { slug, nombre });
      }
    }
  }
  return [...vistos.values()];
}

/* ── Fechas ──────────────────────────────────────────────────────────── */
const pad = n => String(n).padStart(2, '0');
function isoValida(a, m, d) {
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${pad(m)}-${pad(d)}` : null;
}
const revisarFecha = motivo => ({ fecha: null, estado: 'revisar', motivo });

/**
 * Fecha de un renglón: número de serie de Excel o texto "dd/mm/aa". Corrige solo lo inequívoco ("08/08//25",
 * "1/09/0925" = mes repetido + año, "0511/25" = falta una barra) y lo anota; lo demás queda para revisar.
 * @param {{desde: string, hasta: string}} rango  fechas posibles (ISO): afuera = para revisar
 * @returns {{fecha: string|null, estado: 'ok'|'corregida'|'revisar', motivo?: string}}
 */
export function parsearFecha(v, { desde = '2020-01-01', hasta = new Date().toISOString().slice(0, 10) } = {}) {
  const enRango = (iso, r) => {
    if (!iso) return revisarFecha('la fecha no existe');
    if (iso < desde || iso > hasta) return revisarFecha(`fecha fuera de rango (${iso})`);
    return r;
  };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return revisarFecha('sin fecha');
    const iso = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5).toISOString().slice(0, 10);
    return enRango(iso, { fecha: iso, estado: 'ok' });
  }
  const original = String(v ?? '').trim();
  if (!original) return revisarFecha('sin fecha');
  const motivos = [];
  let s = original.replace(/\s+/g, '');
  if (/\/{2,}/.test(s)) { s = s.replace(/\/{2,}/g, '/'); motivos.push('barra repetida'); }
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!m) {
    const junto = /^(\d{2})(\d{2})\/(\d{2}|\d{4})$/.exec(s);   // "0511/25"
    if (junto) { m = junto; motivos.push('faltaba la barra entre día y mes'); }
  }
  if (!m) return revisarFecha(`no se entiende la fecha "${original}"`);
  const d = Number(m[1]), mes = Number(m[2]);
  let anio;
  if (m[3].length === 2) anio = 2000 + Number(m[3]);
  else if (/^20\d{2}$/.test(m[3])) anio = Number(m[3]);
  else if (m[3].slice(0, 2) === pad(mes)) { anio = 2000 + Number(m[3].slice(2)); motivos.push('año mal tipeado (mes repetido)'); }
  else return revisarFecha(`año dudoso en "${original}"`);
  const iso = isoValida(anio, mes, d);
  const r = motivos.length ? { fecha: iso, estado: 'corregida', motivo: `"${original}" → ${iso} (${motivos.join(', ')})` } : { fecha: iso, estado: 'ok' };
  return enRango(iso, r);
}

/* ── Montos ──────────────────────────────────────────────────────────── */
/**
 * Monto de una celda IMPORTE/PAGOS. Números tal cual; texto con formato roto se corrige si es inequívoco
 * ("123,456,78", "12345,,67", "1234.56"); "$123.456" (¿miles o centavos?) o con palabras → revisar.
 * @returns {{monto: number|null, estado: 'ok'|'vacio'|'corregido'|'revisar', motivo?: string}}
 */
export function parsearMonto(v) {
  if (v == null) return { monto: null, estado: 'vacio' };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { monto: null, estado: 'revisar', motivo: 'monto inválido' };
    return v === 0 ? { monto: null, estado: 'vacio' } : { monto: redondeo(v), estado: 'ok' };
  }
  const original = String(v).trim();
  if (!original) return { monto: null, estado: 'vacio' };
  const s = original.replace(/\s+/g, '').replace(/^(-?)\$/, '$1');
  const corregido = (n, motivo) => (n === 0 ? { monto: null, estado: 'vacio' } : { monto: redondeo(n), estado: 'corregido', motivo });
  if (/[a-z]/i.test(s)) return { monto: null, estado: 'revisar', motivo: `el monto tiene palabras: "${original}"` };
  if (/^-?\d+(\.\d{1,2})?$/.test(s)) return corregido(Number(s), 'monto escrito como texto');
  if (/^-?\d{1,3}(,\d{3})*,\d{2}$/.test(s)) {
    const i = s.lastIndexOf(',');
    return corregido(Number(s.slice(0, i).replace(/,/g, '') + '.' + s.slice(i + 1)), `"${original}": comas de miles y de centavos`);
  }
  if (/^-?\d+,,\d{2}$/.test(s)) return corregido(Number(s.replace(',,', '.')), `"${original}": coma repetida`);
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return { monto: null, estado: 'revisar', motivo: `"${original}": no se sabe si el punto es de miles o de centavos` };
  return { monto: null, estado: 'revisar', motivo: `no se entiende el monto "${original}"` };
}

/* ── Remitos ─────────────────────────────────────────────────────────── */
/** "RTO 132863" → { texto: "RTO 132863", tipo: "RTO", numero: "132863" }; "N/C 21894" y "NOTA CRED" son notas de crédito. */
export function parsearRemito(v) {
  if (v == null || v === '') return { texto: '', tipo: null, numero: null, notaCredito: false };
  if (typeof v === 'number') { const t = String(Math.trunc(v)); return { texto: t, tipo: null, numero: t, notaCredito: false }; }
  const s = String(v).replace(/\s+/g, ' ').trim();
  const notaCredito = /^(N\/?C\b|N\/?C\d|NOTA (DE )?CRED)/i.test(s);
  let m = /^([A-Za-z/]+) ?(\d+)$/.exec(s);
  if (m) return { texto: `${m[1].toUpperCase()} ${m[2]}`, tipo: m[1].toUpperCase(), numero: m[2], notaCredito };
  m = /^([A-Za-z/]+)$/.exec(s);
  if (m) return { texto: m[1].toUpperCase(), tipo: m[1].toUpperCase(), numero: null, notaCredito };
  if (/^\d+$/.test(s)) return { texto: s, tipo: null, numero: s, notaCredito };
  return { texto: s, tipo: null, numero: null, notaCredito };
}

/* ── Renglones ───────────────────────────────────────────────────────── */
/**
 * Renglones de la hoja (matriz de celdas, como sheet_to_json con header: 1): busca el encabezado
 * FECHA · PROVEDOR · REMITO · IMPORTE · PAGOS y devuelve los renglones con algo, numerados como en Excel.
 */
export function filasDesdeMatriz(matriz) {
  const enc = c => normalizarNombre(c);
  const iEnc = matriz.findIndex(f => Array.isArray(f) && f.some(c => enc(c) === 'FECHA') && f.some(c => /^PROVE/.test(enc(c))));
  if (iEnc < 0) throw new Error('No encuentro el encabezado de la planilla (FECHA, PROVEDOR, REMITO, IMPORTE, PAGOS)');
  const cab = matriz[iEnc].map(enc);
  const col = re => cab.findIndex(c => re.test(c));
  const c = { fecha: col(/^FECHA$/), proveedor: col(/^PROVE/), remito: col(/^REMITO/), importe: col(/^IMPORTE$/), pagos: col(/^PAGOS$/) };
  for (const [k, i] of Object.entries(c)) if (i < 0) throw new Error(`Falta la columna ${k.toUpperCase()} en el encabezado de la planilla`);
  const filas = [];
  for (let i = iEnc + 1; i < matriz.length; i++) {
    const f = matriz[i] ?? [];
    const r = { fila: i + 1, fecha: f[c.fecha] ?? null, proveedor: f[c.proveedor] ?? null, remito: f[c.remito] ?? null,
      importe: f[c.importe] ?? null, pagos: f[c.pagos] ?? null };
    if ([r.fecha, r.proveedor, r.remito, r.importe, r.pagos].some(x => x != null && String(x).trim() !== '')) filas.push(r);
  }
  return filas;
}

const esSi = v => /^(si|sí|s|x|1|true)$/i.test(String(v ?? '').trim());
const lleno = v => String(v ?? '').trim() !== '';
const crudo = v => (v == null ? '' : typeof v === 'number' ? String(v) : String(v));
const fechaCruda = v => (typeof v === 'number' ? `${v} (${parsearFecha(v, { desde: '0000', hasta: '9999' }).fecha ?? '?'})` : crudo(v));

/**
 * Pasa los renglones a movimientos (débito = compra, crédito = pago) y junta los que hay que revisar.
 * @param {{fila, fecha, proveedor, remito, importe, pagos}[]} filas
 * @param {{equivalencias: Map<string, string>, correcciones?: Map<number, object>, desde: string, hasta: string}} op
 *   equivalencias: nombre normalizado → slug ('ignorar' = no se importa). correcciones: revisar.csv anterior por fila.
 */
export function procesarFilas(filas, { equivalencias, correcciones = new Map(), desde, hasta }) {
  const movimientos = [], revisar = [], porProveedor = new Map();
  let ignorados = 0;
  for (const f of filas) {
    const nombre = normalizarNombre(f.proveedor);
    const remito = parsearRemito(f.remito);
    const base = { fila: f.fila, proveedor: nombre, slug: '', fecha_planilla: fechaCruda(f.fecha), remito: remito.texto,
      importe_planilla: crudo(f.importe), pagos_planilla: crudo(f.pagos), estado: '', motivo: '',
      fecha_ok: '', importe_ok: '', pagos_ok: '', no_importar: '' };
    if (!nombre) {
      if (lleno(f.importe) || lleno(f.pagos)) revisar.push({ ...base, estado: 'revisar', motivo: 'renglón sin proveedor' });
      continue;
    }
    const slug = equivalencias.get(nombre);
    if (!slug) throw new Error(`Falta la equivalencia de "${nombre}" (equivalencias.csv)`);
    if (slug === 'ignorar') { ignorados++; continue; }
    base.slug = slug;

    let st = porProveedor.get(slug);
    if (!st) porProveedor.set(slug, st = { slug, nombres: new Set(), renglones: 0, saldoPlanilla: 0, saldoImportado: 0, renglonesRevisar: 0 });
    st.nombres.add(nombre);
    st.renglones++;
    // Como la planilla: SUBTOTAL suma solo las celdas con número (las de texto no cuentan)
    st.saldoPlanilla = redondeo(st.saldoPlanilla + (typeof f.importe === 'number' ? f.importe : 0) - (typeof f.pagos === 'number' ? f.pagos : 0));

    // Corrección a mano de una corrida anterior: solo si el renglón sigue siendo el mismo (proveedor y remito)
    const previa = correcciones.get(f.fila);
    const c = previa && normalizarNombre(previa.proveedor) === nombre && String(previa.remito ?? '').trim() === remito.texto ? previa : null;
    const avisos = [];
    if (previa && !c) avisos.push('la corrección anterior era de otro renglón (¿se movieron filas?): se descartó');
    if (c) Object.assign(base, { fecha_ok: c.fecha_ok ?? '', importe_ok: c.importe_ok ?? '', pagos_ok: c.pagos_ok ?? '', no_importar: c.no_importar ?? '' });
    if (c && esSi(c.no_importar)) { revisar.push({ ...base, estado: 'no se importa', motivo: 'marcado "no importar" en revisar.csv' }); continue; }

    const fecha = c && lleno(c.fecha_ok) ? parsearFecha(c.fecha_ok, { desde, hasta }) : parsearFecha(f.fecha, { desde, hasta });
    const importe = parsearMonto(c && lleno(c.importe_ok) ? c.importe_ok : f.importe);
    const pagos = parsearMonto(c && lleno(c.pagos_ok) ? c.pagos_ok : f.pagos);
    const problemas = [fecha, importe, pagos].filter(x => x.estado === 'revisar').map(x => x.motivo);
    if (problemas.length) {
      st.renglonesRevisar++;
      revisar.push({ ...base, estado: 'revisar', motivo: [...avisos, ...problemas].join(' · ') });
      continue;
    }
    if (importe.monto == null && pagos.monto == null) continue;   // renglón sin montos: no hay nada que cargar

    const ref = remito.texto ? ` · ${remito.texto}` : '';
    const mov = (tipo, monto, que) => movimientos.push({ fila: f.fila, proveedor: slug, fecha: fecha.fecha, tipo, monto: Math.abs(monto), motivo: `Planilla · ${que}${ref}` });
    if (importe.monto > 0) mov('debito', importe.monto, 'Compra');
    if (importe.monto < 0) mov('credito', importe.monto, 'Compra en negativo');
    if (pagos.monto > 0) mov('credito', pagos.monto, remito.notaCredito ? 'Nota de crédito' : 'Pago');
    if (pagos.monto < 0) mov('debito', pagos.monto, 'Pago en negativo');
    st.saldoImportado = redondeo(st.saldoImportado + (importe.monto ?? 0) - (pagos.monto ?? 0));

    const arreglos = [...avisos, ...[fecha, importe, pagos].filter(x => x.estado === 'corregida' || x.estado === 'corregido').map(x => x.motivo)];
    if (c && (lleno(c.fecha_ok) || lleno(c.importe_ok) || lleno(c.pagos_ok))) revisar.push({ ...base, estado: 'corregida a mano', motivo: arreglos.join(' · ') || 'corregida en revisar.csv' });
    else if (arreglos.length) revisar.push({ ...base, estado: 'corregida', motivo: arreglos.join(' · ') });
  }
  return {
    movimientos, revisar, porProveedor, ignorados, leidos: filas.length,
    compras: movimientos.filter(m => m.tipo === 'debito').length, pagos: movimientos.filter(m => m.tipo === 'credito').length,
  };
}

/* ── SQL de carga ────────────────────────────────────────────────────── */
const sqlTexto = s => `'${String(s).replace(/'/g, "''")}'`;
const LOTE = 500;

/**
 * SQL idempotente: crea los proveedores nuevos, borra lo que se había cargado de la planilla y lo vuelve a cargar,
 * todo en una transacción (si algo falla, no queda nada a medias).
 */
export function generarSql({ movimientos, proveedoresNuevos }) {
  const l = [
    '-- carga-inicial.sql — Compras y pagos históricos de la planilla de proveedores (generado por dev/importar-planilla-proveedores.mjs)',
    '-- NO SUBIR A GIT: tiene datos reales. Revisar informe.txt con Daniel antes de correrlo.',
    '-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez: borra lo cargado antes desde la',
    "-- planilla (notas_proveedor.origen = 'planilla') y lo vuelve a cargar. Compras = notas de débito, pagos = notas de",
    '-- crédito: no tocan el stock ni el Libro diario. Para sacar todo: delete from public.notas_proveedor where origen = \'planilla\';',
    '',
    'begin;',
    '',
    'do $$',
    'begin',
    "  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notas_proveedor' and column_name = 'origen') then",
    "    raise exception 'Primero hay que correr docs/gestion-v19.sql';",
    '  end if;',
    'end $$;',
    '',
  ];
  if (proveedoresNuevos.length) {
    l.push('-- Proveedores que no estaban en el sistema (si ya existen, no se tocan)',
      'insert into public.proveedores (slug, nombre, orden) values',
      proveedoresNuevos.map(p => `  (${sqlTexto(p.slug)}, ${sqlTexto(p.nombre)}, 500)`).join(',\n'),
      'on conflict (slug) do nothing;', '');
  }
  l.push("delete from public.notas_proveedor where origen = 'planilla';", '');
  for (let i = 0; i < movimientos.length; i += LOTE) {
    l.push('insert into public.notas_proveedor (proveedor, fecha, tipo, monto, motivo, origen, planilla_fila) values',
      movimientos.slice(i, i + LOTE).map(m =>
        `  (${sqlTexto(m.proveedor)}, ${sqlTexto(m.fecha)}, ${sqlTexto(m.tipo)}, ${Number(m.monto).toFixed(2)}, ${sqlTexto(m.motivo)}, 'planilla', ${Number(m.fila)})`).join(',\n') + ';',
      '');
  }
  l.push('commit;', '');
  return l.join('\n');
}

/* ── CSV ─────────────────────────────────────────────────────────────── */
/** CSV separado por ; con BOM (Excel en castellano lo abre con tildes y columnas bien). */
export function aCsv(filas, columnas) {
  const celda = v => {
    const s = v == null ? '' : String(v);
    return /[;,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columnas.join(';'), ...filas.map(f => columnas.map(c => celda(f[c])).join(';'))].join('\r\n') + '\r\n';
}

/** Lee un CSV con encabezado (separado por ; o por ,) → objetos por nombre de columna. */
export function leerCsv(texto) {
  const t = String(texto).replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0];
  const sep = (primera.match(/;/g) ?? []).length >= (primera.match(/,/g) ?? []).length ? ';' : ',';
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const [cab, ...resto] = filas.filter(f => f.some(x => x.trim() !== ''));
  if (!cab) return [];
  const nombres = cab.map(x => x.trim());
  return resto.map(f => Object.fromEntries(nombres.map((n, i) => [n, f[i] ?? ''])));
}

/* ── Informe ─────────────────────────────────────────────────────────── */
const plata = n => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Informe de texto: por proveedor, saldo de la planilla vs lo que se importa (Daniel lo confirma antes de correr el SQL). */
export function informe({ porProveedor, leidos, compras, pagos, revisar, ignorados, generado = new Date().toISOString().slice(0, 16).replace('T', ' ') }) {
  const filas = [...porProveedor.values()].map(s => ({ ...s, dif: redondeo(s.saldoPlanilla - s.saldoImportado) }))
    .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif) || a.slug.localeCompare(b.slug));
  const ancho = [18, 34, 9, 18, 18, 16, 9];
  const linea = cols => cols.map((c, i) => (i >= 2 ? String(c).padStart(ancho[i]) : String(c).padEnd(ancho[i]))).join('  ');
  const tot = filas.reduce((t, s) => ({ r: t.r + s.renglones, p: t.p + s.saldoPlanilla, i: t.i + s.saldoImportado, v: t.v + s.renglonesRevisar }), { r: 0, p: 0, i: 0, v: 0 });
  return [
    'Planilla de proveedores — saldo según la planilla vs lo que se va a importar',
    `Generado: ${generado}`,
    '',
    `Renglones leídos: ${leidos} · compras: ${compras} · pagos y notas de crédito: ${pagos} · a revisar: ${revisar} · de proveedores ignorados: ${ignorados}`,
    '',
    linea(['Proveedor (slug)', 'Nombres en la planilla', 'Renglones', 'Saldo planilla', 'Saldo importado', 'Diferencia', 'A revisar']),
    linea(ancho.map(n => '-'.repeat(n))),
    ...filas.map(s => linea([s.slug, [...s.nombres].join(', ').slice(0, ancho[1]), s.renglones, plata(s.saldoPlanilla), plata(s.saldoImportado), plata(s.dif), s.renglonesRevisar])),
    linea(ancho.map(n => '-'.repeat(n))),
    linea(['TOTAL', '', tot.r, plata(tot.p), plata(tot.i), plata(tot.p - tot.i), tot.v]),
    '',
    'Cómo leerlo:',
    '- "Saldo planilla" = IMPORTE − PAGOS sumados como la planilla (las celdas con texto no suman). Positivo = le debés.',
    '- "Saldo importado" = lo que queda en el sistema al correr carga-inicial.sql.',
    '- La diferencia viene de los renglones que quedaron para revisar (ver revisar.csv) y de montos escritos como texto',
    '  que la planilla no sumaba y acá sí se cargan. Corregí revisar.csv (fecha_ok, importe_ok, pagos_ok o no_importar = si)',
    '  y equivalencias.csv (slug_final) y volvé a correr el script.',
    '',
  ].join('\n');
}
