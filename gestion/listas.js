// gestion/listas.js — Lectura de listas de precios en planilla (Excel / CSV), pura y testeable.
// Recibe las filas de la hoja (array de arrays, como SheetJS sheet_to_json({header:1})) y detecta solo:
//   - la fila de encabezado (código / descripción / precio), aunque se repita por secciones;
//   - la columna de descripción aunque su encabezado venga vacío (la de textos más largos);
//   - los títulos de sección ("Peugeot 505", "Fiat 128") que pasan a ser el rubro de los productos;
//   - leyendas tipo "PRECIO NETO SIN IVA" / "CON IVA".

const sinAcentos = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  // "Còdigo" en algunos Excel viejos trae el acento separado o cambiado
  .replace(/[^\x20-\x7e]/g, '').trim();

const ES_CODIGO = /^(cod|codigo|cdigo|art|articulo|ref|referencia|item)\b/;
const ES_DESC = /^(desc|descripcion|detalle|producto|articulo|nombre)/;
const ES_PRECIO = /^(precio|p\.? ?unit|importe|valor|lista|neto|pvp|costo)/;

/** Convierte "24.824,67", "$ 58.300", 58300 → número, o null. */
export function aNumero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[$\s]/g, '');
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

const texto = v => String(v ?? '').trim();

function esEncabezado(fila) {
  const celdas = fila.map(sinAcentos);
  return celdas.some(c => ES_CODIGO.test(c)) && celdas.some(c => ES_PRECIO.test(c));
}

/** Detecta columnas a partir del primer encabezado y del contenido de las filas siguientes. */
export function detectarColumnas(filas) {
  const iEnc = filas.findIndex(esEncabezado);
  if (iEnc === -1) return null;
  const enc = filas[iEnc].map(sinAcentos);
  const col = { encabezado: iEnc, codigo: enc.findIndex(c => ES_CODIGO.test(c)), precio: -1, descripcion: enc.findIndex(c => ES_DESC.test(c)) };
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
export function parsearLista(filas) {
  const columnas = detectarColumnas(filas);
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
  let preciosSinIva = null;

  for (const fila of filas) {
    const todo = sinAcentos(fila.join(' '));
    if (/sin iva|neto/.test(todo) && /precio/.test(todo) && !esEncabezado(fila)) preciosSinIva = true;
    if (/con iva|iva incluido/.test(todo) && !esEncabezado(fila)) preciosSinIva = false;
  }

  for (const fila of filas.slice(columnas.encabezado + 1)) {
    if (esEncabezado(fila)) continue;
    const codigo = texto(fila[columnas.codigo]);
    // Encabezado repetido incompleto ("Código | Mano" sin "Precio") o leyenda del pie escrita en la
    // columna de código ("PRECIO NETO SIN IVA"). Se mira solo esa celda: una descripción puede decir "precio".
    if ((ES_CODIGO.test(sinAcentos(codigo)) || /precio|iva|sujeto a/.test(sinAcentos(codigo)))
        && aNumero(fila[columnas.precio]) == null) continue;
    const descripcion = texto(fila[columnas.descripcion]).replace(/\s+/g, ' ');
    const precio = aNumero(fila[columnas.precio]);

    if (codigo && descripcion && precio != null && precio > 0) {
      productos.push({ codigo, descripcion, rubro, precio });
    } else if (!codigo && descripcion && precio == null && descripcion.length <= 60 && !/precio|iva|sujeto|cambio/i.test(descripcion)) {
      rubro = descripcion;                       // título de sección
      if (!secciones.includes(rubro)) secciones.push(rubro);
    } else if (codigo || descripcion) {
      descartadas++;                             // fila con datos incompletos: se informa, no se inventa
    }
  }
  return { columnas, productos, secciones, preciosSinIva, descartadas };
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
