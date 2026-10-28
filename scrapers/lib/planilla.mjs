// planilla.mjs — Lee una lista de precios en Excel/CSV (o tabla HTML exportada como .xls) con el mismo
// detector de columnas que usa el importador del panel (gestion/listas.js). Elige la hoja con más productos.
import { createRequire } from 'node:module';
import { parsearLista, aFilasDePrecio } from '../../gestion/listas.js';

const XLSX = createRequire(import.meta.url)('../../vendor/xlsx-0.20.3.full.min.js');

const sinAcentos = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * @param {Buffer} buffer  archivo descargado
 * @param {{descuentoPct?: number, sumarIva?: boolean}} [opciones]  igual que aFilasDePrecio
 * @returns {{ filas: object[], hoja: string, descartadas: number }}  filas listas para correrScraper
 */
export function leerPlanilla(buffer, opciones = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  let mejor = null;
  for (const nombre of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' });
    const r = parsearLista(filas);
    if (!r.columnas || (mejor && r.productos.length <= mejor.r.productos.length)) continue;
    // Columna de rubro/familia si la planilla la trae (ej. Fal: "familia")
    const enc = filas[r.columnas.encabezado].map(sinAcentos);
    const iRubro = enc.findIndex(c => /^(familia|rubro|categoria|linea)/.test(c));
    if (iRubro >= 0) {
      const porCodigo = new Map(filas.slice(r.columnas.encabezado + 1)
        .map(f => [String(f[r.columnas.codigo] ?? '').trim(), String(f[iRubro] ?? '').trim()]));
      for (const p of r.productos) p.rubro = porCodigo.get(p.codigo) || p.rubro;
    }
    mejor = { nombre, r };
  }
  if (!mejor || mejor.r.productos.length === 0) throw new Error('La planilla no tiene una lista de precios reconocible');
  return {
    filas: aFilasDePrecio(mejor.r.productos, opciones),
    hoja: mejor.nombre,
    descartadas: mejor.r.descartadas,
  };
}
