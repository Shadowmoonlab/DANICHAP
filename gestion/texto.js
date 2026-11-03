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
  [/^luc(e|es)?$|^luz$/, 'luz'], [/^moldur/, 'mold'], [/^distribuc/, 'distrib'], [/^direcc/, 'direcc'],
];
const RAIZ = new Set(RAICES.map(([, r]) => r));
// Palabras compuestas que los proveedores escriben juntas o separadas ("PORTA MAZA" 205 / "PORTAMAZA" 67)
const COMPUESTO = /^(porta|cubre|levanta|limpia|guarda|salva|tapa)$/;
const COMPUESTA = /^(porta|cubre|levanta|limpia|guarda|salva|tapa)([a-z]{3,})$/;

// Cómo lo escribe cada proveedor (auditoría de 248 búsquedas en producción, nov 2026). Formato de la base
// (Postgres): \m = comienzo de palabra, \M = fin de palabra. En el navegador se traduce con aRegexJs.
const SINONIMOS = {
  opt: String.raw`\mop(t|\M)`,                          // "OP. Taunus" (Mello, Ópticas LAM)
  izq: String.raw`(\mizq|\m(di|ti|li)\M|\md i\M)`,      // Otero: código "-DI"/"-TI"; "D/I" = sirve para los dos lados
  der: String.raw`(\mder|\m(dd|td|ld)\M|\md i\M)`,
  luz: String.raw`\mlu(z|ces)`,
  levantav: String.raw`\mlevanta ?(vidri|cristal)`,     // DM: "MAQUINA LEVANTA CRISTAL"
  distrib: String.raw`\m(distrib|sincron|dentad)`,      // correa de distribución = sincrónica / dentada
  espiral: String.raw`\m(espiral|resorte)`,
  oxigeno: String.raw`\m(oxigeno|lambda)`,               // sensor de oxígeno = sonda lambda
  sensor: String.raw`\m(sensor|sonda)`,
  direcc: String.raw`\m(direcc|hidraul)`,                // bomba de dirección = bomba hidráulica
};

/** Palabras de búsqueda seguras para filtros de PostgREST.
 *  Sin la "s" final (búsqueda por substring): "paragolpes" también encuentra "PARAGOLPE".
 *  Sin palabras vacías ("de", "del") y con la raíz de las abreviaturas comunes ("paragolpe" → "parag"). */
export function palabras(q) {
  const tokens = String(q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d)[.,](\d)/g, '$1·$2')          // "1.4" / "1,6" (cilindrada) es un solo dato
    .replace(/[,()*%\\:"']/g, ' ').split(/\s+/).filter(Boolean);
  // "s 10", "r 12", "f 100": la letra va con el número (S-10, R12, F-100)
  const juntos = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^[a-z]$/.test(tokens[i]) && !VACIAS.has(tokens[i]) && /^\d+$/.test(tokens[i + 1] ?? '')) juntos.push(tokens[i] + tokens[++i]);
    // "porta maza", "cubre carter": una sola palabra (se busca junta o separada, ver patron)
    else if (COMPUESTO.test(tokens[i]) && /^[a-z]{3,}$/.test(tokens[i + 1] ?? '') && !VACIAS.has(tokens[i + 1])) juntos.push(tokens[i] + tokens[++i]);
    else juntos.push(tokens[i]);
  }
  const ws = juntos.flatMap(partesDe)
    .filter(w => (w.length > 1 || /^\d$/.test(w)) && !VACIAS.has(w))
    .map(singular)
    .map(w => RAICES.find(([re]) => re.test(w))?.[1] ?? w);
  // "óptica delantera": las ópticas casi nunca dicen "delantera" (las de atrás son "faro trasero")
  return (ws.includes('opt') ? ws.filter(w => w !== 'del') : ws).slice(0, 6);
}

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
  return ws.every(w => regexJs(w).test(textoNormalizado));
}

/**
 * Cómo se busca cada palabra (la misma regla en la base y en el navegador):
 * - sinónimos y abreviaturas de los proveedores (SINONIMOS);
 * - número: solo ese número ("206" no está dentro de "1005206"; "1·4" = "1.4");
 * - letra + número ("s10", "r12", "f100"): con o sin espacio/guion; "r12" también "renault 12";
 * - palabra corta escrita tal cual ("gol", "ka", "uno"): entera ("gol" no trae "GOLF" ni "Golpe");
 * - el resto (y las raíces como "parag", "del"): comienzo de palabra.
 */
export function patron(w) {
  if (SINONIMOS[w]) return SINONIMOS[w];
  const fin = '([^0-9]|$)';
  if (/^\d+$/.test(w)) return `(^|[^0-9])${w}${fin}`;
  let m = /^(\d+)·(\d+)$/.exec(w);
  if (m) return `(^|[^0-9])${m[1]} ${m[2]}${fin}`;
  m = /^([a-z]{1,2})(\d+)$/.exec(w);
  if (m) return m[1] === 'r' ? String.raw`(\mr ?${m[2]}|renault ${m[2]})${fin}` : String.raw`\m${m[1]} ?${m[2]}${fin}`;
  if (w.length <= 3 && !RAIZ.has(w)) return String.raw`\m${escaparRegex(w)}\M`;
  m = COMPUESTA.exec(w);
  if (m) return String.raw`\m${m[1]} ?${escaparRegex(m[2])}`;
  return String.raw`\m${escaparRegex(w)}`;
}
/** El patrón de la base, para el navegador (que no conoce \m ni \M). */
export const aRegexJs = p => p.replace(/\\m/g, '(?<![a-z0-9])').replace(/\\M/g, '(?![a-z0-9])');
const regexes = new Map();
const regexJs = w => {
  if (!regexes.has(w)) regexes.set(w, new RegExp(aRegexJs(patron(w))));
  return regexes.get(w);
};
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
  // Cercanía: la segunda palabra justo después de la primera ("BOMBA DE NAFTA" antes que "BOMBA DE AGUA … NAFTA")
  const segunda = ws.length > 1 ? partes.findIndex((p, i) => i > lugar && p.startsWith(ws[1])) : -1;
  const juntas = segunda > lugar && segunda - lugar <= 2 ? 8 : 0;
  return (lugar === 0 ? 0 : 100) + lugar * 10 - enteras * 3 - comoSeEscribio * 5 - juntas + Math.min(t.length, 200) / 100;
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
