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
  let s = String(v ?? '').replace(/[$€\s]/g, '').replace(/^[-–]+|[-–]+$/g, '');
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
// Celda que es solo un monto (no una descripción con números como "TOP TEC 4200")
const esMonto = v => typeof v === 'number' || /^[\d\s.,$€–-]+$/.test(texto(v));
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
      rubro = celdas[0];
      secciones.push(rubro);
      break;
    }
  }
  let descartadas = 0;

  // "Sin IVA" / "con IVA" escrito en el encabezado de la lista; si dice las dos cosas (dos columnas), no se adivina
  let dicenSin = false, dicenCon = false;
  for (const fila of filas.slice(0, 60)) {
    const todo = sinAcentos(fila.join(' '));
    if (/(sin|no incluyen?|s ?\/ ?) ?iva|\+ ?iva|mas iva/.test(todo) || (/neto/.test(todo) && /precio/.test(todo) && !esEncabezado(fila))) dicenSin = true;
    if (/con iva|iva incluido/.test(todo)) dicenCon = true;
  }
  const preciosSinIva = dicenSin !== dicenCon ? dicenSin : null;

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
        rubro = titulo;
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
      rubro = celdas[0].replace(/\s+/g, ' ');   // título de sección (en cualquier columna: Chriva lo pone en otra)
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
  const productos = [], secciones = [], porHoja = [];
  const vistos = new Set();
  let descartadas = 0, sinIva = false, conIva = false;
  for (const { nombre, filas } of hojas) {
    if (!filas || filas.length < 2) continue;
    const r = parsearLista(filas, opciones);
    porHoja.push({ nombre, productos: r.productos.length, descartadas: r.descartadas });
    if (!r.productos.length) continue;
    const rubroHoja = /^(hoja|sheet|pagina)\s*\d*$/i.test(String(nombre).trim()) ? null : String(nombre).trim();
    for (const p of r.productos) {
      if (vistos.has(p.codigo)) continue;
      vistos.add(p.codigo);
      productos.push({ ...p, rubro: p.rubro ?? rubroHoja });
    }
    for (const s of r.secciones.length ? r.secciones : rubroHoja ? [rubroHoja] : []) if (!secciones.includes(s)) secciones.push(s);
    descartadas += r.descartadas;
    if (r.preciosSinIva === true) sinIva = true;
    if (r.preciosSinIva === false) conIva = true;
  }
  return { columnas: productos.length ? true : null, productos, secciones, descartadas, porHoja,
           preciosSinIva: sinIva !== conIva ? sinIva : null };
}

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
export function aFilasDePrecio(productos, { descuentoPct = 0, sumarIva = false, ivaPct = 21 } = {}) {
  return productos.map(p => {
    const lista = Math.round(p.precio * (sumarIva ? 1 + ivaPct / 100 : 1) * 100) / 100;
    const neto = Math.round(lista * (1 - descuentoPct / 100) * 100) / 100;
    return { codigo: p.codigo, descripcion: p.descripcion, rubro: p.rubro, marca: null, origen: null,
             precio_lista: lista, precio_neto: neto, imagen_url: null };
  });
}
