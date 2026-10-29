// planilla.mjs — Lee una lista de precios en Excel/CSV (o tabla HTML exportada como .xls) con el mismo
// detector de columnas que usa el importador del panel (gestion/listas.js). Elige la hoja con más productos.
// Si la planilla no tiene encabezados reconocibles, deduce las columnas por el contenido (código / texto / precio).
import { createRequire } from 'node:module';
import { parsearLista, aFilasDePrecio, aNumero } from '../../gestion/listas.js';

const XLSX = createRequire(import.meta.url)('../../vendor/xlsx-0.20.3.full.min.js');

/** CSV/TXT con encabezado (ej. Goicoechea "códigos corridos", separador |): columnas por nombre del encabezado. */
export function leerCsv(texto) {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim());
  const iEnc = lineas.findIndex(l => /cod/i.test(l) && /precio|lista|neto/i.test(l));
  if (iEnc === -1) throw new Error(`CSV sin encabezado reconocible: "${lineas[0]?.replace(/\d/g, '#').slice(0, 200)}"`);
  const sep = (lineas[iEnc].match(/[|;\t,]/g) ?? ['|']).sort((a, b) =>
    lineas[iEnc].split(b).length - lineas[iEnc].split(a).length)[0];
  const enc = lineas[iEnc].split(sep).map(sinAcentos);
  const col = re => enc.findIndex(c => re.test(c));
  const c = {
    codigo: col(/^(cod|codigo|articulo|nro)/),
    descripcion: col(/desc|detalle|nombre|producto/),
    marca: col(/marca|fabric|familia/),
    rubro: col(/rubro|linea|categ/),
    lista: col(/lista/),
    neto: col(/neto|cliente|final|costo/),
  };
  if (c.lista === -1 && c.neto === -1) c.lista = col(/precio/);
  if (c.codigo === -1 || (c.lista === -1 && c.neto === -1)) {
    throw new Error(`CSV: no encuentro código/precio en el encabezado "${lineas[iEnc].slice(0, 200)}"`);
  }
    const celda = (p, i) => (i >= 0 ? String(p[i] ?? '').replace(/^"|"$/g, '').trim() : '');
  return lineas.slice(iEnc + 1).map(l => {
    const p = l.split(sep);
    const lista = aNumero(celda(p, c.lista));
    const neto = aNumero(celda(p, c.neto));
    return {
      codigo: celda(p, c.codigo),
      descripcion: celda(p, c.descripcion) || celda(p, c.codigo),
      marca: celda(p, c.marca) || null,
      rubro: celda(p, c.rubro) || null,
      origen: null,
      precio_lista: lista ?? neto,
      precio_neto: neto ?? lista,
      imagen_url: null,
    };
  }).filter(f => f.codigo && (f.precio_lista ?? f.precio_neto) != null);
}

const sinAcentos = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const texto = v => String(v ?? '').trim();
const texto8 = v => texto(v).slice(0, 40);

/**
 * Sin encabezado: código = columna de textos cortos casi todos distintos; descripción = la de textos más
 * largos; precio = la columna numérica de valores más altos (si hay varias, suele ser el precio de lista).
 */
export function deducirColumnas(filas) {
  const datos = filas.filter(f => f.filter(v => texto(v)).length >= 3).slice(0, 300);
  if (datos.length < 5) return null;
  const ancho = Math.max(...datos.map(f => f.length));
  const stats = Array.from({ length: ancho }, (_, i) => {
    const vals = datos.map(f => texto(f[i])).filter(Boolean);
    const nums = datos.map(f => aNumero(f[i])).filter(n => n != null && n > 0);
    return {
      i,
      lleno: vals.length / datos.length,
      numerico: nums.length / datos.length,
      distintos: new Set(vals).size / Math.max(vals.length, 1),
      largo: vals.reduce((s, v) => s + v.length, 0) / Math.max(vals.length, 1),
      mediana: nums.sort((a, b) => a - b)[Math.floor(nums.length / 2)] ?? 0,
      conDecimales: nums.some(n => !Number.isInteger(n)),
    };
  });
  const precio = stats.filter(s => s.numerico >= 0.8).sort((a, b) => (b.conDecimales - a.conDecimales) || (b.mediana - a.mediana))[0];
  const descripcion = stats.filter(s => s.i !== precio?.i && s.numerico < 0.5 && s.lleno >= 0.8).sort((a, b) => b.largo - a.largo)[0];
  const codigo = stats.find(s => s.i !== precio?.i && s.i !== descripcion?.i && s.lleno >= 0.9 && s.distintos >= 0.9 && s.largo <= 25);
  if (!precio || !descripcion || !codigo) return null;
  return { codigo: codigo.i, descripcion: descripcion.i, precio: precio.i };
}

function porContenido(filas) {
  const col = deducirColumnas(filas);
  if (!col) return null;
  const productos = [];
  let descartadas = 0;
  for (const f of filas) {
    const codigo = texto(f[col.codigo]);
    const descripcion = texto(f[col.descripcion]).replace(/\s+/g, ' ');
    const precio = aNumero(f[col.precio]);
    if (codigo && descripcion && precio > 0) productos.push({ codigo, descripcion, rubro: null, precio });
    else if (codigo || descripcion) descartadas++;
  }
  return { columnas: { ...col, encabezado: -1 }, productos, descartadas };
}

const ENTIDADES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', deg: '°' };
const deHtml = s => s.replace(/<[^>]*>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&(\w+);/g, (m, e) => ENTIDADES[e] ?? m)
  .replace(/\s+/g, ' ').trim();

/** Tabla HTML "exportada como Excel": todas las filas <tr> en orden, aunque haya tablas anidadas o HTML roto. */
export function filasDeHtml(html) {
  return html.split(/<tr[\s>]/i).slice(1).map(tr => {
    const fin = tr.search(/<\/tr>/i);
    return [...(fin >= 0 ? tr.slice(0, fin) : tr).matchAll(/<t[dh][^>]*>([\s\S]*?)(?=<t[dh][\s>]|<\/t[dh]>|$)/gi)].map(m => deHtml(m[1]));
  }).filter(f => f.some(Boolean));
}

// Para el log cuando no se reconoce: solo los textos de las primeras filas (encabezados), nunca números
function muestra(wb) {
  return wb.SheetNames.map(nombre => {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' })
      .filter(f => f.some(v => texto(v))).slice(0, 3)
      .map(f => f.map(v => (aNumero(v) != null ? '#' : texto(v).slice(0, 25))).join(' | '));
    return `hoja "${nombre}": ${filas.join(' // ') || '(vacía)'}`;
  }).join('; ');
}

/**
 * @param {Buffer} buffer  archivo descargado
 * @param {{descuentoPct?: number, sumarIva?: boolean}} [opciones]  igual que aFilasDePrecio
 * @returns {{ filas: object[], hoja: string, descartadas: number }}  filas listas para correrScraper
 */
export function leerPlanilla(buffer, opciones = {}) {
  const inicio = buffer.subarray(0, 400).toString('latin1');
  if (/^\s*(<!doctype html|<html)/i.test(inicio) && !/<table/i.test(buffer.toString('latin1'))) {
    throw new Error(`Se recibió una página web en vez de la planilla (${buffer.length} bytes)`);
  }
  // raw: en tablas HTML/CSV no convertir textos a número (leería "10.021,00" como 10,021); aNumero los lee en formato argentino
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true });
  const hojas = wb.SheetNames.map(nombre => [nombre, XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' })]);
  const texto = buffer.toString('latin1');
  if (/<table/i.test(texto.slice(0, 20000))) {
    hojas.push(['tabla HTML', filasDeHtml(/charset=["']?utf-8/i.test(texto.slice(0, 3000)) ? buffer.toString('utf8') : texto)]);
  }
  let mejor = null;
  for (const [nombre, filas] of hojas) {
    let r = parsearLista(filas);
    if (!r.columnas || r.productos.length === 0) r = porContenido(filas) ?? r;
    if (!r.columnas || (mejor && r.productos.length <= mejor.r.productos.length)) continue;
    // Columna de rubro/familia si la planilla la trae (ej. Fal: "familia")
    if (r.columnas.encabezado >= 0) {
      const enc = filas[r.columnas.encabezado].map(sinAcentos);
      const iRubro = enc.findIndex(c => /^(familia|rubro|categoria|linea|subrubro|grupo)/.test(c));
      if (iRubro >= 0) {
        const porCodigo = new Map(filas.slice(r.columnas.encabezado + 1)
          .map(f => [String(f[r.columnas.codigo] ?? '').trim(), String(f[iRubro] ?? '').trim()]));
        for (const p of r.productos) p.rubro = porCodigo.get(p.codigo) || p.rubro;
      }
    }
    mejor = { nombre, r };
  }
  if (!mejor || mejor.r.productos.length === 0) {
    const err = new Error(`La planilla no tiene una lista de precios reconocible (${buffer.length} bytes; ${muestra(wb)})`.slice(0, 600));
    // Detalle para diagnosticar (solo se guarda en scraper_runs, no en el log público): filas 1-15 de cada hoja
    err.detalle = hojas.map(([n, filas]) => `[${n}] ` + filas.slice(0, 15).map(f => f.map(v => texto8(v)).join(' | ')).join(' // ')).join('\n').slice(0, 3500);
    throw err;
  }
  return {
    filas: aFilasDePrecio(mejor.r.productos, opciones),
    hoja: mejor.nombre,
    descartadas: mejor.r.descartadas,
  };
}
