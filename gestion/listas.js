// gestion/listas.js — Lectura de listas de precios (Excel / CSV / PDF), pura y testeable.
// Recibe las filas de la hoja (array de arrays, como SheetJS sheet_to_json({header:1})) y detecta solo:
//   - la fila de encabezado (código / descripción / precio), aunque se repita por secciones;
//   - la columna de descripción aunque su encabezado venga vacío (la de textos más largos);
//   - los títulos de sección ("Peugeot 505", "Fiat 128") que pasan a ser el rubro de los productos;
//   - leyendas tipo "PRECIO NETO SIN IVA" / "CON IVA";
//   - listas SIN encabezado (Francar, Chriva, PDFs): las columnas se deducen por el contenido;
//   - libros con varias hojas (parsearLibro) y PDFs convertidos a filas (filasDePdf).

const sinAcentos = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  // "Còdigo" en algunos Excel viejos trae el acento separado o cambiado
  .replace(/[^\x20-\x7e]/g, '').trim();

const ES_CODIGO = /^(cod|codigo|cdigo|art|articulo|ref|referencia|item|numero|nro)\b/;
const ES_DESC = /^(desc|descripcion|detalle|producto|articulo|nombre|aplicacion)/;
const ES_PRECIO = /^(precio|p\.? ?unit|unitario|importe|valor|lista|neto|pvp|costo)/;
// Renglones sueltos que NO son títulos de sección: datos del proveedor, leyendas y pedazos del encabezado
const NO_ES_SECCION = new RegExp([
  'precio', 'iva', 'sujeto', 'cambio', 'lista', 'tel', 'mail', '@', 'www', 'calle', 'av\\.', 's\\.a', 'srl', 'cuit',
  'p[aá]gina', 'fecha', 'importante', 'unitario', 'd[ií]as', 'pago', 'contado', 'caja', 'bs\\.? ?as', 'argentina',
  'ciudad', '\\(\\d{4}\\)', 'ofertas? .*\\d{4}', '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)',
].join('|'), 'i');

/** Convierte "24.824,67", "$ 58.300", "15 500", "153,639 €-", 58300 → número, o null. */
export function aNumero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/u\$s|us\$|usd|ars|eur/gi, '').replace(/[$€\s]/g, '').replace(/^[-–]+|[-–]+$/g, '');
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Acentos rotos: texto UTF-8 que alguna vez se leyó como Windows-1252 ("AGRÃCOLA" en vez de "AGRÍCOLA").
// Se vuelve a los bytes originales y se decodifica bien; si algo no cierra, queda como estaba.
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
  0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
export function arreglarAcentos(t) {
  if (!/[ÃÂ][-¿Œ-Ÿƒˆ˜–-™]/.test(t)) return t;
  const bytes = [];
  for (const ch of t) {
    const c = ch.codePointAt(0);
    const b = c < 256 ? c : CP1252[c];
    if (b === undefined) return t;
    bytes.push(b);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch { return t; }
}
const texto = v => arreglarAcentos(String(v ?? '').trim());
// Título de sección escrito con letras separadas ("R E N A U L T", Espíndola): se junta para que se pueda buscar
export const tituloDeSeccion = t => String(t ?? '').replace(/\s+/g, ' ').trim()
  .replace(/(?<![\p{L}\d])(?:\p{L} ){2,}\p{L}(?![\p{L}\d])/gu, m => m.replace(/ /g, ''));
// Celda que es solo un monto (no una descripción con números como "TOP TEC 4200")
const esMonto = v => typeof v === 'number' || /^(u\$s|us\$|usd|ars|eur)?[\d\s.,$€–-]+$/i.test(texto(v));
const mediana = xs => { const o = [...xs].sort((a, b) => a - b); return o.length ? o[o.length >> 1] : 0; };

function esEncabezado(fila) {
  const celdas = fila.map(sinAcentos);
  return celdas.some(c => ES_CODIGO.test(c)) && celdas.some(c => ES_PRECIO.test(c));
}
// "Descripción | Precio" sin columna de código: el código pasa a ser la descripción
function esEncabezadoSinCodigo(fila) {
  const celdas = fila.map(sinAcentos);
  return celdas.some(c => ES_DESC.test(c)) && celdas.some(c => ES_PRECIO.test(c));
}

/** Columna con los textos más largos (la descripción), sin contar las indicadas. Empate: la de la izquierda. */
function columnaDeTexto(filas, excluir) {
  const largo = {};
  for (const f of filas) {
    f.forEach((v, i) => {
      if (excluir.includes(i) || esMonto(v)) return;
      largo[i] = (largo[i] || 0) + texto(v).length;
    });
  }
  const mejor = Object.entries(largo).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return mejor && mejor[1] > 0 ? Number(mejor[0]) : -1;
}

/**
 * Lista sin encabezado (Francar, Chriva, PDFs): descripción = textos más largos; precio = montos (si hay dos
 * columnas parecidas, como sin IVA / con IVA, la de la izquierda); código = valores cortos, con números y casi
 * todos distintos. Sin columna de código se busca al principio de la descripción ("8909 TOP TEC 4200").
 */
export function detectarSinEncabezado(filas, { minimoPrecio = 100 } = {}) {
  const muestra = filas.slice(0, 500);
  const descripcion = columnaDeTexto(muestra, []);
  if (descripcion === -1) return null;
  const conDesc = muestra.filter(f => texto(f[descripcion]).length >= 3);
  const ancho = Math.max(0, ...muestra.map(f => f.length));
  const candidatos = [];
  for (let i = 0; i < ancho; i++) {
    if (i === descripcion) continue;
    const montos = conDesc.map(f => f[i]).filter(v => esMonto(v) && aNumero(v) > 0).map(aNumero);
    if (montos.length >= Math.max(3, conDesc.length * 0.3)) candidatos.push({ i, med: mediana(montos) });
  }
  const precios = candidatos.filter(c => c.med >= minimoPrecio);   // en dólares, un precio de 12,5 es normal
  if (!precios.length) return null;
  const mayor = Math.max(...precios.map(c => c.med));
  const precio = precios.filter(c => c.med * 1.6 >= mayor).sort((a, b) => a.i - b.i)[0].i;

  const productos = conDesc.filter(f => esMonto(f[precio]) && aNumero(f[precio]) > 0);
  // La otra columna de precio (con IVA) no puede ser el código aunque sus valores sean cortos y distintos
  const otrosPrecios = new Set(precios.filter(c => c.med * 1.6 >= mayor).map(c => c.i));
  let codigo = -1;
  for (let i = 0; i < ancho && codigo === -1; i++) {
    if (i === descripcion || otrosPrecios.has(i)) continue;
    const vals = productos.map(f => texto(f[i])).filter(Boolean);
    const pareceCodigo = vals.filter(v => v.length <= 20 && /\d/.test(v)).length;
    if (vals.length >= productos.length * 0.6 && pareceCodigo >= vals.length * 0.7
        && new Set(vals).size >= vals.length * 0.8) codigo = i;
  }
  const codigoEnDesc = codigo === -1
    && productos.filter(f => /^\d{3,6}\s+\S/.test(texto(f[descripcion]))).length >= productos.length * 0.6;
  // Columnas de texto entre la descripción y el precio ("5W-30", "4 l", "NUEVO") se suman a la descripción
  const extras = [];
  for (let i = descripcion + 1; i < precio; i++) if (i !== codigo && !candidatos.some(c => c.i === i)) extras.push(i);
  // El tipo de producto en la columna de la izquierda ("BUJIAS DE ENCENDIDO" | "EQUIV. BOSCH WR78") va adelante
  const izq = descripcion - 1;
  const prefijo = izq >= 0 && izq !== codigo && !candidatos.some(c => c.i === izq)
    && productos.filter(f => texto(f[izq]) && !esMonto(f[izq])).length >= productos.length * 0.5 ? izq : -1;
  return { encabezado: -1, codigo, precio, descripcion, codigoEnDesc, extras, prefijo, lado: -1 };
}

/** Detecta columnas a partir del primer encabezado y del contenido de las filas siguientes. */
export function detectarColumnas(filas, opciones = {}) {
  const iEnc = filas.findIndex(esEncabezado);
  if (iEnc === -1) {
    // "Descripción | Precio" sin código: la descripción se elige por contenido (el encabezado puede venir corrido)
    const iSin = filas.findIndex(esEncabezadoSinCodigo);
    if (iSin === -1) return detectarSinEncabezado(filas, opciones);
    // El encabezado puede venir corrido (Reposiciones: el código no tiene título): se deduce por el contenido
    const porContenido = detectarSinEncabezado(filas.slice(iSin + 1), opciones);
    if (porContenido) return { ...porContenido, encabezado: iSin };
    const enc = filas[iSin].map(sinAcentos);
    let precio = -1;
    enc.forEach((c, i) => { if (ES_PRECIO.test(c)) precio = i; });
    const descripcion = columnaDeTexto(filas.slice(iSin + 1, iSin + 200), [precio]);
    return descripcion >= 0 ? { encabezado: iSin, codigo: -1, precio, descripcion, codigoEnDesc: false, extras: [], lado: -1 } : null;
  }
  const enc = filas[iEnc].map(sinAcentos);
  const col = { encabezado: iEnc, codigo: enc.findIndex(c => ES_CODIGO.test(c)), precio: -1, descripcion: enc.findIndex(c => ES_DESC.test(c)),
                lado: enc.findIndex(c => c === 'lado'), codigoEnDesc: false, extras: [] };
  // Precio: la última columna de precio (suele ser el precio final de la fila)
  enc.forEach((c, i) => { if (ES_PRECIO.test(c)) col.precio = i; });
  // "Precio lista | Precio c/dto 20%": la de lista (el descuento de Daniel se aplica aparte, si no se descontaría dos veces)
  if (/dto|desc|bonif/.test(enc[col.precio] ?? '')) {
    const sinDto = enc.map((c, i) => (ES_PRECIO.test(c) && !/dto|desc|bonif/.test(c) ? i : -1)).filter(i => i >= 0).at(-1);
    if (sinDto != null) col.precio = sinDto;
  }
  // "Precio" ocupando dos celdas ("$" | 12.345): si la de al lado no tiene encabezado y trae más números, es esa
  if (col.precio >= 0 && !enc[col.precio + 1]) {
    const numeros = i => filas.slice(iEnc + 1, iEnc + 200).filter(f => aNumero(f[i]) != null).length;
    if (numeros(col.precio + 1) > numeros(col.precio)) col.precio += 1;
  }

  // Descripción sin encabezado: la columna con textos más largos en las filas de datos
  if (col.descripcion === -1 || col.descripcion === col.codigo) {
    const largo = {};
    for (const f of filas.slice(iEnc + 1, iEnc + 80)) {
      f.forEach((v, i) => {
        if (i === col.codigo || i === col.precio || typeof v === 'number') return;
        largo[i] = (largo[i] || 0) + texto(v).length;
      });
    }
    const mejor = Object.entries(largo).sort((a, b) => b[1] - a[1])[0];
    col.descripcion = mejor ? Number(mejor[0]) : -1;
  }
  return col.codigo >= 0 && col.precio >= 0 && col.descripcion >= 0 ? col : null;
}

/**
 * @returns {{ columnas, productos: {codigo, descripcion, rubro, precio}[], secciones: string[],
 *             preciosSinIva: boolean|null, descartadas: number }}
 */
export function parsearLista(filas, opciones = {}) {
  const columnas = detectarColumnas(filas, opciones);
  if (!columnas) return { columnas: null, productos: [], secciones: [], preciosSinIva: null, descartadas: 0 };

  const productos = [];
  const secciones = [];
  // La primera sección suele estar justo arriba del primer encabezado
  let rubro = null;
  for (let i = columnas.encabezado - 1; i >= Math.max(0, columnas.encabezado - 3); i--) {
    const celdas = filas[i].map(texto).filter(Boolean);
    if (celdas.length === 1 && celdas[0].length <= 60 && !/lista|precio|tel|mail|@/i.test(celdas[0])) {
      rubro = tituloDeSeccion(celdas[0]);
      secciones.push(rubro);
      break;
    }
  }
  let descartadas = 0;

  // "Sin IVA" / "con IVA" escrito en el encabezado de la lista; si dice las dos cosas (dos columnas), no se adivina
  let dicenSin = false, dicenCon = false;
  for (const fila of filas.slice(0, 60)) {
    const todo = sinAcentos(fila.join(' ')).replace(/i\.? ?v\.? ?a\.?/g, 'iva');   // "I.V.A." = "iva"
    const noIncluye = /no incluyen? (el |los )?iva/.test(todo);
    if (noIncluye || /(sin|s ?\/ ?) ?iva|\+ ?iva|mas iva/.test(todo) || (/neto/.test(todo) && /precio/.test(todo) && !esEncabezado(fila))) dicenSin = true;
    if (/con iva|c ?\/ ?iva|iva incluido/.test(todo) || (!noIncluye && /incluyen? (el )?iva/.test(todo))) dicenCon = true;
  }
  let preciosSinIva = dicenSin !== dicenCon ? dicenSin : null;
  // "Precio s/IVA | Precio c/IVA": lo que dice la columna de la que se toma el precio es lo que vale
  const tituloPrecio = columnas.encabezado >= 0 ? sinAcentos(filas[columnas.encabezado][columnas.precio]).replace(/i\.? ?v\.? ?a\.?/g, 'iva') : '';
  if (/con iva|c ?\/ ?iva|iva incl/.test(tituloPrecio)) preciosSinIva = false;
  else if (/sin iva|s ?\/ ?iva|\+ ?iva|neto/.test(tituloPrecio)) preciosSinIva = true;

  const leerCodigo = (fila, descripcion) => {
    if (columnas.codigo >= 0) return { codigo: texto(fila[columnas.codigo]), descripcion };
    const m = columnas.codigoEnDesc && descripcion.match(/^(\d{3,6})\s+(.+)$/);
    // Sin código: el código es "sección · descripción", así "PARAGOLPE DELANTERO" de GOL y el de CORSA no se pisan
    return m ? { codigo: m[1], descripcion: m[2] } : { codigo: rubro ? `${rubro} · ${descripcion}` : descripcion, descripcion };
  };

  for (const fila of filas.slice(columnas.encabezado + 1)) {
    if (esEncabezado(fila) || (columnas.codigo === -1 && columnas.encabezado >= 0 && esEncabezadoSinCodigo(fila))) {
      // Encabezado repetido por modelo ("NÚMERO DE ARTÍCULO | CHEVROLET CLASSIC 94/2009 | PRECIO"): el modelo es el rubro
      const titulo = texto(fila[columnas.descripcion]).replace(/\s+/g, ' ');
      if (titulo && !ES_DESC.test(sinAcentos(titulo)) && titulo.length <= 60) {
        rubro = tituloDeSeccion(titulo);
        if (!secciones.includes(rubro)) secciones.push(rubro);
      }
      continue;
    }
    const precio = esMonto(fila[columnas.precio]) ? aNumero(fila[columnas.precio]) : null;
    const celdas = fila.map(texto).filter(Boolean);
    let desc = texto(fila[columnas.descripcion]);
    if (columnas.prefijo >= 0 && texto(fila[columnas.prefijo]) && !esMonto(fila[columnas.prefijo])) desc = `${texto(fila[columnas.prefijo])} ${desc}`;
    for (const i of columnas.extras) {
      const extra = texto(fila[i]);
      if (extra && !esMonto(extra)) desc += ' ' + extra;
    }
    if (columnas.lado >= 0 && texto(fila[columnas.lado])) desc += ' ' + texto(fila[columnas.lado]);
    const leido = leerCodigo(fila, desc.replace(/\s+/g, ' ').trim());
    // Sin columna de código, el "código" sale de la descripción: en un título de sección no hay código
    const codigo = columnas.codigo >= 0 || precio != null ? leido.codigo : '';

    // Encabezado repetido incompleto ("Código | Mano" sin "Precio") o leyenda del pie escrita en la
    // columna de código ("PRECIO NETO SIN IVA"). Se mira solo esa celda: una descripción puede decir "precio".
    if (columnas.codigo >= 0 && (ES_CODIGO.test(sinAcentos(codigo)) || /precio|iva|sujeto a/.test(sinAcentos(codigo)))
        && aNumero(fila[columnas.precio]) == null) continue;
    const descripcion = leido.descripcion;

    if (codigo && descripcion && precio != null && precio > 0) {
      productos.push({ codigo, descripcion, rubro, precio });
    } else if (precio == null && celdas.length === 1 && celdas[0].length <= 60 && !esMonto(celdas[0]) && !NO_ES_SECCION.test(celdas[0])) {
      rubro = tituloDeSeccion(celdas[0]);   // título de sección (en cualquier columna: Chriva lo pone en otra)
      if (!secciones.includes(rubro)) secciones.push(rubro);
    } else if (codigo && descripcion) {
      descartadas++;                             // fila con datos incompletos (ej. sin precio): se informa, no se inventa
    }
  }
  return { columnas, productos, secciones, preciosSinIva, descartadas };
}

/**
 * Lee un libro completo (todas las hojas) y junta los productos. Si una hoja no trae secciones, su nombre
 * ("ENGANCHES", "PORTAMAZAS") pasa a ser el rubro. Código repetido en otra hoja: queda la primera aparición.
 * @param {{nombre: string, filas: any[][]}[]} hojas
 */
export function parsearLibro(hojas, opciones = {}) {
  const todos = [], secciones = [], porHoja = [];
  let descartadas = 0, sinIva = false, conIva = false;
  for (const { nombre, filas } of hojas) {
    if (!filas || filas.length < 2) continue;
    const r = parsearLista(filas, opciones);
    porHoja.push({ nombre, productos: r.productos.length, descartadas: r.descartadas });
    if (!r.productos.length) continue;
    const rubroHoja = /^(hoja|sheet|pagina)\s*\d*$/i.test(String(nombre).trim()) ? null : String(nombre).trim();
    for (const p of r.productos) todos.push({ ...p, rubro: p.rubro ?? rubroHoja });
    for (const s of r.secciones.length ? r.secciones : rubroHoja ? [rubroHoja] : []) if (!secciones.includes(s)) secciones.push(s);
    descartadas += r.descartadas;
    if (r.preciosSinIva === true) sinIva = true;
    if (r.preciosSinIva === false) conIva = true;
  }
  const { productos, repetidos } = sinCodigosRepetidos(todos);
  return { columnas: productos.length ? true : null, productos, secciones, descartadas, porHoja, repetidos,
           preciosSinIva: sinIva !== conIva ? sinIva : null };
}

/**
 * Un mismo código para productos distintos (Reposiciones usa "103" en 4 marcas; Chriva "1128" para dos
 * modelos): antes quedaba uno solo y el resto se perdía. Ahora:
 * - el mismo renglón repetido (mismo código, descripción y precio) cuenta una vez;
 * - si el código se repite con otra descripción o precio, cada uno pasa a "código · descripción" (y si hace
 *   falta, también la sección), así ninguno se pisa en la base y se encuentran todos.
 */
export function sinCodigosRepetidos(lista) {
  const porCodigo = new Map();
  for (const p of lista) {
    const grupo = porCodigo.get(p.codigo) ?? [];
    if (!grupo.some(o => o.descripcion === p.descripcion && o.precio === p.precio)) grupo.push(p);
    porCodigo.set(p.codigo, grupo);
  }
  const productos = [];
  let repetidos = 0;
  for (const [codigo, grupo] of porCodigo) {
    if (grupo.length === 1) { productos.push(grupo[0]); continue; }
    repetidos++;
    const usados = new Set();
    for (const p of grupo) {
      let nuevo = `${codigo} · ${p.descripcion}`;
      if (usados.has(nuevo) && p.rubro) nuevo += ` · ${p.rubro}`;
      for (let n = 2; usados.has(nuevo); n++) nuevo = `${codigo} · ${p.descripcion} · ${n}`;
      usados.add(nuevo);
      productos.push({ ...p, codigo: nuevo });
    }
  }
  return { productos, repetidos };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Meses ("2026-08") que aparecen en un texto: "Septiembre 2026", "03 de Agosto de 2026", "03/08/26", "01-07-2026".
 *  Solo fechas con año, de los últimos 3 años y no futuras: un "12-13-15" de una descripción no cuenta. */
function mesesEnTexto(texto, hoy, { sinAnio = false } = {}) {
  const t = String(texto ?? '').toLowerCase().replace(/setiembre/g, 'septiembre');
  const anioHoy = hoy.getFullYear(), mesHoy = hoy.getMonth() + 1;
  const encontrados = [];
  const sumar = (anio, mes) => {
    if (anio < 100) anio += 2000;
    if (mes < 1 || mes > 12 || anio < anioHoy - 3 || anio * 12 + mes > anioHoy * 12 + mesHoy) return;
    encontrados.push(`${anio}-${String(mes).padStart(2, '0')}`);
  };
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) if (+m[1] >= 1 && +m[1] <= 31) sumar(+m[3], +m[2]);
  for (const m of t.matchAll(/(?:^|[^\d/.-])(\d{1,2})[/-](\d{4})\b/g)) sumar(+m[2], +m[1]);   // "04/2026"
  for (const m of t.matchAll(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[-/](\d{2}|\d{4})\b/g)) {   // "ABR-26"
    sumar(+m[2], ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'].indexOf(m[1] === 'set' ? 'sep' : m[1]) + 1);
  }
  // "Septiembre 2026", "agosto de 2026", "abril/2026", "abril. 01 2026"; "mayorista" no es mayo
  for (const m of t.matchAll(new RegExp(`\\b(${MESES.join('|')})\\b(?:[\\s./,-]*(?:de|del)?[\\s./,-]*(?:\\d{1,2}[\\s./,-]+)?(\\d{4}))?`, 'g'))) {
    const mes = MESES.indexOf(m[1]) + 1;
    if (m[2]) sumar(+m[2], mes);
    // Solo el mes ("chriva agosto"): el último que pasó (agosto en noviembre → este año; diciembre en marzo → el anterior)
    else if (sinAnio) sumar(mes <= mesHoy ? anioHoy : anioHoy - 1, mes);
  }
  return encontrados;
}

/**
 * De qué mes es la lista, para que en el buscador se vea si está al día. Busca primero en el nombre del archivo
 * ("Ofertas Ford Septiembre 2026.pdf"), después en el nombre de las hojas y en los primeros renglones
 * ("LISTA Nº 3/2026: 03/08/26"). Si hay varias fechas queda la más nueva. Sin ninguna → null (Daniel la elige).
 * @param {{nombres: string[], hojas: {nombre: string, filas: any[][]}[]}} lista
 * @returns {string|null} "2026-08"
 */
export function mesDeLista({ nombres = [], hojas = [] }, hoy = new Date()) {
  const masNuevo = meses => (meses.length ? meses.sort().at(-1) : null);
  const porNombre = masNuevo(nombres.flatMap(n => mesesEnTexto(n, hoy, { sinAnio: true })));
  if (porNombre) return porNombre;
  return masNuevo(hojas.flatMap(({ nombre, filas }) => [
    ...mesesEnTexto(nombre, hoy),
    ...(filas || []).slice(0, 12).flatMap(f => mesesDeRenglon(f || [], hoy)),
  ]));
}

// Un renglón de encabezado: celdas de fecha de Excel o fechas escritas. Un renglón de producto (con precio) no
// cuenta: un código "10.11.24" no es una fecha.
function mesesDeRenglon(fila, hoy) {
  const celdas = fila.filter(c => c != null && c !== '');
  if (celdas.length >= 3 && celdas.some(c => typeof c === 'number' && c >= 100)) return [];
  const fechas = celdas.filter(c => c instanceof Date && !Number.isNaN(c.getTime()))
    .map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    .filter(m => m <= `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}` && +m.slice(0, 4) >= hoy.getFullYear() - 3);
  return [...fechas, ...mesesEnTexto(celdas.filter(c => !(c instanceof Date)).join(' '), hoy)];
}

/** "2026-08" → "ago 2026". */
export const mesCorto = mes => {
  const m = /^(\d{4})-(\d{2})$/.exec(mes ?? '');
  return m ? `${MESES[+m[2] - 1].slice(0, 3)} ${m[1]}` : '';
};

/**
 * Convierte el texto de un PDF (pedazos con su posición, como los da pdf.js) en filas de celdas, para leerlo
 * con parsearLista. Arma renglones por altura y columnas por posición horizontal; descarta "$", "€" y guiones sueltos.
 * @param {{x: number, y: number, s: string}[][]} paginas  pedazos de texto de cada página
 */
export function filasDePdf(paginas, { toleranciaY = 3, toleranciaX = 14 } = {}) {
  const renglones = [];
  for (const items of paginas) {
    const porAltura = [];
    for (const it of items) {
      const s = String(it.s ?? '').trim();
      if (!s || /^[-–—$€.:|]+$/.test(s)) continue;
      let r = porAltura.find(r => Math.abs(r.y - it.y) <= toleranciaY);
      if (!r) porAltura.push(r = { y: it.y, items: [] });
      r.items.push({ x: it.x, s });
    }
    porAltura.sort((a, b) => b.y - a.y);   // en PDF la y crece hacia arriba: de arriba hacia abajo
    for (const r of porAltura) renglones.push(r.items.sort((a, b) => a.x - b.x));
  }
  // Columnas: posiciones horizontales agrupadas (un pedazo a menos de toleranciaX del anterior es la misma columna)
  const xs = [...new Set(renglones.flat().map(it => Math.round(it.x)))].sort((a, b) => a - b);
  const columnas = [];
  for (const x of xs) {
    const ultima = columnas[columnas.length - 1];
    if (ultima && x - ultima.hasta <= toleranciaX) ultima.hasta = x;
    else columnas.push({ desde: x, hasta: x });
  }
  const columnaDe = x => columnas.findIndex(c => Math.round(x) >= c.desde && Math.round(x) <= c.hasta);
  return renglones.map(items => {
    const fila = Array(columnas.length).fill('');
    for (const it of items) {
      const i = columnaDe(it.x);
      fila[i] = fila[i] ? `${fila[i]} ${it.s}` : it.s;
    }
    return fila;
  });
}

/** Pasa productos de la lista a filas para importar_lista_precios. */
/**
 * Precios que en realidad son códigos de pieza leídos en la columna del precio (RIDA, 11/11: "8200699903" es un
 * código Renault): número entero, al menos 100 mil y 100 veces la mediana de la lista. Esos no se importan.
 */
export function separarPreciosRaros(productos) {
  const precios = productos.map(p => p.precio).filter(n => n > 0).sort((a, b) => a - b);
  const mediana = precios.length ? precios[Math.floor(precios.length / 2)] : 0;
  const esRaro = p => Number.isInteger(p.precio) && p.precio >= 100_000 && mediana > 0 && p.precio >= mediana * 100;
  return { productos: productos.filter(p => !esRaro(p)), raros: productos.filter(esRaro) };
}

export function aFilasDePrecio(productos, { descuentoPct = 0, sumarIva = false, ivaPct = 21 } = {}) {
  return productos.map(p => {
    const lista = Math.round(p.precio * (sumarIva ? 1 + ivaPct / 100 : 1) * 100) / 100;
    const neto = Math.round(lista * (1 - descuentoPct / 100) * 100) / 100;
    return { codigo: p.codigo, descripcion: p.descripcion, rubro: p.rubro, marca: p.marca ?? null, origen: null,
             precio_lista: lista, precio_neto: neto, imagen_url: null };
  });
}
