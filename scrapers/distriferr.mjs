// distriferr.mjs — Distriferr Hnos. (clientes.distriferr.com.ar, portal de clientes con jQuery, ~2.700 artículos)
// Login: GET /ingreso/ (cookie de sesión) y POST /ingreso/ form-urlencoded: from='' , email=<nro. de cliente>,
//        hpassword=<clave tal cual> (la página copia la clave a hpassword y vacía password) y password=''.
//        Responde JSON: {"err":"Error en usuario o clave."} si rechaza; {"from":"<url>"} si entra (→ /panel/).
// Lista: 1) "Mi usuario" tiene el botón /panel/csv/ ("Descargar archivo .csv de articulos"): se baja y se acepta
//           solo si se lee entera y sus precios coinciden con los que muestra el panel para los mismos códigos.
//        2) Si no, se recorre el buscador del panel: /panel/?q=&r=<rubro>&m= por cada rubro y /panel/?q=&r=&m=<marca>
//           por cada marca (las listas del <select> de /panel/). Cada página trae los artículos en un
//           `var results=[...]` (articulo, descri, precio de lista, descri_rubro, descri_marca, stock).
//        Precio neto = lista − descuento del cliente que muestra el panel (`var pDescuento`, "Costo c/Dto.").
// El sitio manda los textos de la base en latin1 dentro de páginas UTF-8 ("CAÑOS" llega con el byte 0xD1).
import { correrScraper, env } from './lib/db.mjs';
import { crearSesion, enParalelo } from './lib/sesion.mjs';
import { leerCsv, leerPlanilla } from './lib/planilla.mjs';

const BASE = 'https://clientes.distriferr.com.ar';
const AJAX = { 'X-Requested-With': 'XMLHttpRequest' };
const MINIMO = 1_500;      // la lista manual del 03/11 tenía 2.737 artículos
const SIMULTANEOS = 3;
const esperar = ms => new Promise(ok => setTimeout(ok, ms));

/** Bytes → texto: UTF-8 si es válido; si no, UTF-8 donde lo sea y latin1 en el resto (plantilla UTF-8 + datos latin1). */
export function decodificar(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {}
  return Buffer.from(buf).toString('latin1').replace(/[\xC2-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}|[\xF0-\xF4][\x80-\xBF]{3}/g,
    m => Buffer.from(m, 'latin1').toString('utf8'));
}

/** El arreglo JSON de `var <nombre>=[...]` de un <script> (recorre respetando comillas: los textos pueden traer ] y ;). */
export function arregloJs(html, nombre) {
  const m = new RegExp(`var\\s+${nombre}\\s*=\\s*\\[`).exec(html);
  if (!m) return null;
  const ini = m.index + m[0].length - 1;
  let prof = 0, enTexto = false;
  for (let i = ini; i < html.length; i++) {
    const c = html[i];
    if (enTexto) { if (c === '\\') i++; else if (c === '"') enTexto = false; continue; }
    if (c === '"') enTexto = true;
    else if (c === '[') prof++;
    else if (c === ']' && --prof === 0) return JSON.parse(html.slice(ini, i + 1).replace(/[\u0000-\u001f]/g, ' '));
  }
  return null;
}

const limpiar = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const deHtml = s => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const conDescuento = (lista, pct) => (lista == null ? null : Math.round(lista * (1 - pct / 100) * 100) / 100);

/** Artículos de una página del buscador del panel (`var results`), en el formato de correrScraper. */
export function articulosDePagina(html, descuentoPct = 0) {
  const results = arregloJs(html, 'results');
  if (!Array.isArray(results)) throw new Error('la página del panel no trae la lista de artículos (var results)');
  return results.map(o => {
    const precio = Number(o.precio);
    const lista = Number.isFinite(precio) && precio > 0 ? precio : null;
    return {
      codigo:       limpiar(o.articulo),
      descripcion:  limpiar(o.descri) || limpiar(o.obs),
      marca:        limpiar(o.descri_marca) || null,
      rubro:        limpiar(o.descri_rubro) || null,
      origen:       null,
      precio_lista: lista,
      precio_neto:  conDescuento(lista, descuentoPct),
      imagen_url:   null,
    };
  }).filter(f => f.codigo);
}

/** Rubros y marcas del buscador (valores exactos, sin recortar: el sitio tiene "MANGUERA  CRISTAL") y descuento del cliente. */
export function filtrosDelPanel(html) {
  const opciones = (campo, variable) => {
    const sel = new RegExp(`<select[^>]*\\bname="${campo}"[^>]*>([\\s\\S]*?)</select>`, 'i').exec(html)?.[1] ?? '';
    const deSelect = [...sel.matchAll(/<option[^>]*\bvalue="([^"]*)"/gi)].map(m => deHtml(m[1]));
    const deVar = (html.match(new RegExp(`var\\s+${variable}\\s*=\\s*"([^"]*)"`))?.[1] ?? '')
      .replace(/\\(.)/g, '$1').split(',');   // texto de JS: "PUERTAS\/CAPOT" = "PUERTAS/CAPOT"
    return [...new Set([...deSelect, ...deVar].filter(v => v.trim()))];
  };
  const pct = Number(html.match(/var\s+pDescuento\s*=\s*([\d.]+)/)?.[1]);
  return { rubros: opciones('r', 'rubros'), marcas: opciones('m', 'marcas'), descuentoPct: Number.isFinite(pct) && pct < 100 ? pct : 0 };
}

const latin1Url = v => [...Buffer.from(v, 'latin1')].map(b => (/[A-Za-z0-9_.~-]/.test(String.fromCharCode(b))
  ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');

/** URL(s) del buscador para un rubro (campo 'r') o marca ('m'). Con Ñ/acentos se prueba en UTF-8 y en latin1. */
export function urlsDeFiltro(campo, valor) {
  const url = v => `/panel/?q=&r=${campo === 'r' ? v : ''}&m=${campo === 'm' ? v : ''}`;
  const urls = [url(encodeURIComponent(valor))];
  if (/[^\x00-\x7f]/.test(valor) && !/[^\x00-\xff]/.test(valor)) urls.push(url(latin1Url(valor)));
  return urls;
}

/**
 * Lista bajada de /panel/csv/ (CSV o tabla HTML ".xls"). Devuelve las filas solo si se lee entera, con nombres
 * reales y con los mismos precios de lista que muestra el panel (`muestra`: código → precio); si no, el motivo.
 */
export function leerDescarga(buf, muestra, descuentoPct = 0, { minimo = MINIMO } = {}) {
  const texto = decodificar(buf);
  let filas;
  if (/<table/i.test(texto.slice(0, 20_000))) filas = leerPlanilla(buf).filas;
  else if (/^\s*<(!doctype|html)/i.test(texto)) return { motivo: 'devolvió una página web en vez de la lista' };
  else {
    try { filas = leerCsv(texto); } catch (e) {
      try { filas = leerPlanilla(buf).filas; } catch { return { motivo: e.message.slice(0, 200) }; }
    }
  }
  filas = [...new Map(filas.map(f => [String(f.codigo).trim(), f])).values()];
  if (filas.length < minimo) return { motivo: `trajo solo ${filas.length} artículos` };
  const sinNombre = filas.filter(f => !limpiar(f.descripcion) || limpiar(f.descripcion) === limpiar(f.codigo)).length;
  if (sinNombre > filas.length * 0.05) return { motivo: `${sinNombre} de ${filas.length} artículos sin nombre` };
  const comparables = filas.filter(f => muestra.has(f.codigo));
  const iguales = comparables.filter(f => Math.abs(f.precio_lista - muestra.get(f.codigo)) <= Math.max(1, muestra.get(f.codigo) * 0.005));
  if (comparables.length < 5 || iguales.length < comparables.length * 0.9) {
    return { motivo: `sus precios no coinciden con los del panel (${iguales.length} de ${comparables.length} códigos comparables)` };
  }
  return { filas: filas.map(f => ({ ...f, precio_neto: conDescuento(f.precio_lista, descuentoPct) })) };
}

async function scrape() {
  const s = crearSesion(BASE);
  const pagina = async ruta => decodificar(await s.binario(ruta));
  const entrar = async () => {
    await s.pedir('/ingreso/');
    const res = await s.pedir('/ingreso/', { method: 'POST', headers: AJAX,
      form: { from: '', hpassword: env('DISTRIFERR_PASSWORD'), email: env('DISTRIFERR_USER'), password: '' } });
    let r = null;
    try { r = JSON.parse(await res.text()); } catch {}
    if (r?.err) return { rechazado: true };
    const panel = await pagina('/panel/');
    return /name="hpassword"/.test(panel) || !/var\s+results\s*=/.test(panel) ? {} : { panel };
  };
  // Un segundo intento antes de darlo por rechazado: "Login rechazado" no se reintenta en el día
  let ingreso = await entrar();
  if (!ingreso.panel) {
    console.warn('[distriferr] el ingreso no tomó, pruebo una vez más en 20 s…');
    await esperar(20_000);
    ingreso = await entrar();
  }
  if (ingreso.rechazado) throw new Error('Login rechazado: revisar DISTRIFERR_USER / DISTRIFERR_PASSWORD');
  if (!ingreso.panel) throw new Error('El ingreso no llegó al panel de artículos (/panel/)');

  try {
    const filtros = filtrosDelPanel(ingreso.panel);
    if (!filtros.rubros.length && !filtros.marcas.length) throw new Error('/panel/ sin listas de rubros ni marcas para recorrer');
    console.log(`[distriferr] ${filtros.rubros.length} rubros, ${filtros.marcas.length} marcas, descuento del cliente ${filtros.descuentoPct}%`);
    const urls = [...filtros.rubros.flatMap(v => urlsDeFiltro('r', v)), ...filtros.marcas.flatMap(v => urlsDeFiltro('m', v))];

    const porCodigo = new Map();
    const leerBuscador = async (url, i) => {
      const html = await pagina(url);
      if (/name="hpassword"/.test(html)) throw new Error('El panel volvió a pedir el ingreso (sesión vencida)');
      for (const f of articulosDePagina(html, filtros.descuentoPct)) if (!porCodigo.has(f.codigo)) porCodigo.set(f.codigo, f);
      if ((i + 1) % 25 === 0) console.log(`[distriferr] buscador ${i + 1}/${urls.length}: ${porCodigo.size} artículos`);
    };

    // Primero la descarga completa, comparada con los precios de las tres primeras páginas del buscador
    await enParalelo(urls.slice(0, 3), SIMULTANEOS, leerBuscador);
    const muestra = new Map([...porCodigo.values()].map(f => [f.codigo, f.precio_lista]));
    try {
      const res = await s.pedir('/panel/csv/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { filas, motivo } = leerDescarga(Buffer.from(await res.arrayBuffer()), muestra, filtros.descuentoPct);
      if (filas) {
        console.log(`[distriferr] /panel/csv/: ${filas.length} artículos`);
        return filas;
      }
      console.warn(`[distriferr] /panel/csv/ no sirve (${motivo}): recorro el buscador`);
    } catch (e) {
      console.warn(`[distriferr] /panel/csv/ falló (${e.message}): recorro el buscador`);
    }

    await enParalelo(urls.slice(3), SIMULTANEOS, (url, i) => leerBuscador(url, i + 3));
    const filas = [...porCodigo.values()];
    console.log(`[distriferr] buscador: ${filas.length} artículos en ${urls.length} páginas`);
    if (filas.length < MINIMO) throw new Error(`el buscador del panel trajo solo ${filas.length} artículos`);
    return filas;
  } finally {
    await s.pedir('/salir/').catch(() => {});   // no dejar la sesión abierta en la cuenta de Daniel
  }
}

// Los tests importan las funciones de arriba sin correr el robot (DISTRIFERR_SOLO_FUNCIONES=1)
if (process.env.DISTRIFERR_SOLO_FUNCIONES !== '1') await correrScraper('distriferr', scrape);
