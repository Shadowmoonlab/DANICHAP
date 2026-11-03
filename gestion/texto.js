// gestion/texto.js — Funciones puras de texto (sin DOM ni base): búsqueda, teléfonos, WhatsApp.
// Se testean con node --test (tests/gestion-texto.test.mjs).

// Palabras que no ayudan a encontrar ("paragolpe DE gol"): se ignoran
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'para', 'p', 'con', 'c', 'y', 'en', 'un', 'una']);
// Cómo abrevian los proveedores: se busca por la raíz común, así "paragolpe" también encuentra "PARAG." o "PARAGOL"
const RAICES = [
  [/^farol/, 'faro'],   // "farol trasero": los proveedores escriben "FARO TRASERO" (y "faro" también encuentra "FAROL")
  [/^paragol/, 'parag'], [/^optica/, 'opt'], [/^delanter/, 'del'], [/^traser/, 'tras'], [/^izquierd/, 'izq'],
  [/^derech/, 'der'], [/^guardabarr/, 'guardab'], [/^amortiguad/, 'amort'], [/^parabris/, 'parabr'],
  [/^cerradur/, 'cerrad'], [/^levantavidri/, 'levantav'], [/^radiador/, 'radiad'], [/^espejo/, 'espej'],
];

/** Palabras de búsqueda seguras para filtros de PostgREST.
 *  Sin la "s" final (búsqueda por substring): "paragolpes" también encuentra "PARAGOLPE".
 *  Sin palabras vacías ("de", "del") y con la raíz de las abreviaturas comunes ("paragolpe" → "parag"). */
export const palabras = q => String(q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[,()*%\\:"']/g, ' ').split(/\s+/)
  .flatMap(partesDe)
  .filter(w => (w.length > 1 || /^\d$/.test(w)) && !VACIAS.has(w))
  .map(singular)
  .map(w => RAICES.find(([re]) => re.test(w))?.[1] ?? w)
  .slice(0, 6);

// "OPT.DEL.IZQ" → opt, del, izq y "p/400" → p, 400 (cada pedazo se busca por separado, como en la base);
// pero "F-100" queda "f100": una letra suelta que no es palabra vacía no sirve para buscar
function partesDe(token) {
  if (!/[-/.]/.test(token)) return [token];
  const partes = token.split(/[-/.]+/).filter(Boolean);
  return partes.some(p => p.length === 1 && !/\d/.test(p) && !VACIAS.has(p)) ? [token.replace(/[-/.]/g, '')] : partes;
}

// Plural → singular: "paragolpes" → "paragolpe", "rulemanes" → "ruleman", "luces" → "luz" (la búsqueda es por
// comienzo de palabra, así que quedarse corto nunca deja afuera el artículo)
function singular(w) {
  if (w.length > 4 && w.endsWith('ces')) return w.slice(0, -3) + 'z';
  if (w.length > 5 && /[rnldj]es$/.test(w)) return w.slice(0, -2);
  return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
}

/**
 * Qué tan bien coincide una descripción con lo buscado (menor = mejor). Lo que EMPIEZA con la primera palabra
 * va primero ("óptica de corsa" → "ÓPTICA CORSA…" antes que "SOPORTE ÓPTICA CORSA"); después, cuanto antes
 * aparezca esa palabra y más cerca estén las demás, mejor.
 */
// Cada palabra tiene que coincidir con el COMIENZO de una palabra: "gol" encuentra "GOL TREND" y "P/GOL",
// pero no "paraGOLpe". Solo números ("400", "128": modelos y medidas) van en cualquier parte.
export const escaparRegex = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const esNumero = w => /^\d+$/.test(w);
/** La misma regla que la base; recibe el texto ya normalizado con normalizarAmbos (pegado + separado). */
export function coincidePalabras(textoNormalizado, ws) {
  return ws.every(w => (esNumero(w) ? textoNormalizado.includes(w) : new RegExp(`(^|[^a-z0-9])${escaparRegex(w)}`).test(textoNormalizado)));
}
// Texto con - / . , como espacios: "OPT.DEL.IZQ" → "opt del izq" (para ubicar cada palabra)
const separado = q => String(q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-/.,]/g, ' ');

export function relevancia(descripcion, ws, escritas = []) {
  if (!ws.length) return 0;
  const t = separado(descripcion).replace(/\s+/g, ' ').trim();
  const partes = t.split(' ');
  const lugar = partes.findIndex(p => p.startsWith(ws[0]));   // en qué palabra de la descripción aparece
  if (lugar === -1) return t.includes(ws[0]) ? 500 : 1000;
  // Palabra entera ("gol" = "GOL") antes que parcial ("GOLF"); y la palabra TAL COMO SE ESCRIBIÓ ("delantera")
  // antes que su abreviatura ("DEL"): lo más parecido a lo que está en el buscador, primero
  const enteras = ws.filter(w => partes.includes(w)).length;
  const comoSeEscribio = escritas.filter(w => partes.some(p => p.replace(/s$/, '') === w.replace(/s$/, ''))).length;
  return (lugar === 0 ? 0 : 100) + lugar * 10 - enteras * 3 - comoSeEscribio * 5 + Math.min(t.length, 200) / 100;
}

/** Lo escrito sin palabras vacías ("de", "para"…), para la búsqueda de parecidos. */
export const sinPalabrasVacias = q => normalizar(q).split(/\s+/).filter(w => w && !VACIAS.has(w)).join(' ');

/** Sin acentos ni - / . → "f100" encuentra "F-100". */
export const normalizar = q => String(q).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[-/.]/g, '');

/**
 * Igual que la columna precios_distribuidor.busqueda (docs/gestion-v6.sql): el texto PEGADO ("f100", "pgol")
 * y SEPARADO ("f 100", "p gol", "opt del izq"), así se encuentra tanto el código como cada palabra abreviada.
 */
export const normalizarAmbos = q => {
  const base = String(q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return `${base.replace(/[-/.,]/g, '')} ${base.replace(/[-/.,]/g, ' ')}`;
};

/**
 * De los resultados ya ordenados, se queda con los `limite` mejores PERO siempre con los 2 mejores de cada proveedor:
 * si no, los robots (cientos de "PARAGOLPE GOL…") tapan a las listas cargadas a mano (Francar, Chriva…) y esos
 * proveedores ni aparecen en los botones de filtro. Mantiene el orden original.
 */
export function conTodosLosProveedores(limite, porProveedor = 2) {
  let elegidos = null;
  return (x, i, todos) => {
    if (!elegidos) {
      elegidos = new Set(todos.slice(0, limite));
      const cuenta = new Map();
      for (const y of todos) {
        const k = y.d.distribuidor, n = cuenta.get(k) || 0;
        if (n < porProveedor) { elegidos.add(y); cuenta.set(k, n + 1); }
      }
    }
    return elegidos.has(x);
  };
}

// Marcas de auto: muchos proveedores no las escriben cuando ya está el modelo ("OPTICA 206…", sin "PEUGEOT")
const MARCAS = new Set(['peugeot', 'chevrolet', 'chevrolete', 'chevy', 'gm', 'ford', 'fiat', 'renault', 'volkswagen', 'vw',
  'citroen', 'toyota', 'honda', 'nissan', 'suzuki', 'hyundai', 'kia', 'jeep', 'dodge', 'mercedes', 'benz', 'audi', 'bmw',
  'chery', 'iveco', 'mitsubishi', 'seat', 'alfa', 'scania', 'ram']);
/**
 * Palabras obligatorias y opcionales de una búsqueda. La marca del auto es opcional cuando además hay al menos dos
 * palabras más (repuesto + modelo: "optica peugeot 206" → opt + 206 obligatorias, peugeot ayuda a ordenar).
 * Si la marca es lo único que precisa la búsqueda ("faro peugeot"), sigue siendo obligatoria.
 */
export function separarMarcas(ws) {
  const duras = ws.filter(w => !MARCAS.has(w));
  // Hace falta un modelo claro además del repuesto: un nombre ("gol", "corsa") o un número de 3 cifras (206, 504, 128).
  // "renault 9" o "fiat 1": un número corto aparece en cualquier código, sin la marca traería cualquier cosa
  const modeloClaro = duras.slice(1).some(w => (/^\d+$/.test(w) ? w.length >= 3 : w.length >= 2));
  if (modeloClaro && duras.length >= 2 && duras.length < ws.length) return { duras, blandas: ws.filter(w => MARCAS.has(w)) };
  return { duras: ws, blandas: [] };
}

/** Teléfono argentino → formato internacional de WhatsApp (549 + área + número), o null. */
export function telefonoWhatsApp(tel) {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // "11 15 5555-1234" → quitar el 15 después del código de área de 2 a 4 dígitos
  const quince = d.match(/^(\d{2,4})15(\d{6,8})$/);
  if (quince && (quince[1] + quince[2]).length === 10) d = quince[1] + quince[2];
  // Sin código de área: celular de AMBA escrito como 15xxxxxxxx
  if (d.length === 10 && d.startsWith('15')) d = '11' + d.slice(2);
  if (d.length !== 10) return null;
  return '549' + d;
}

/** Link wa.me con el texto ya escrito. Sin teléfono válido abre WhatsApp para elegir el contacto. */
export function linkWhatsApp(tel, texto) {
  const numero = telefonoWhatsApp(tel);
  return `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(texto)}`;
}

/** Número escrito a la argentina → número. "15.000" → 15000, "1.500,50" → 1500.5, "$ 12000" → 12000, "12.5" → 12.5.
 *  Vacío o inválido → null. Un punto seguido de exactamente 3 dígitos se toma como separador de miles. */
export function numeroAR(texto) {
  let t = String(texto ?? '').replace(/[$\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
