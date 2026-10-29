// gestion/caja-calc.js — Cierre de caja (puro y testeable): cuánto efectivo tendría que haber y la diferencia.
// Las filas vienen de caja_del_dia (una por medio de pago) — docs/gestion-v3.sql.

const n = v => Number(v) || 0;

/**
 * @param {{medio: string, ventas, cobros, ingresos, gastos, retiros}[]} filas
 * @param {number} inicial  efectivo con el que se abrió la caja (cambio)
 * @returns {{ entra: number, sale: number, esperado: number, otros: Record<string, number> }}
 *   entra/sale/esperado: solo efectivo · otros: lo que entró por cada medio que no es efectivo (va al banco)
 */
export function calcularCierre(filas, inicial = 0) {
  const ef = filas.find(f => f.medio === 'efectivo') || {};
  const entra = n(ef.ventas) + n(ef.cobros) + n(ef.ingresos);
  const sale = n(ef.gastos) + n(ef.retiros);
  const otros = {};
  for (const f of filas) {
    if (f.medio === 'efectivo') continue;
    const neto = n(f.ventas) + n(f.cobros) + n(f.ingresos) - n(f.gastos) - n(f.retiros);
    if (neto) otros[f.medio] = neto;
  }
  return { entra, sale, esperado: n(inicial) + entra - sale, otros };
}

/** Cómo leer la diferencia del arqueo (redondea a $1: monedas sueltas no son faltante). */
export function leerDiferencia(contado, esperado) {
  const d = Math.round(n(contado) - n(esperado));
  if (d === 0) return { tipo: 'ok', texto: 'La caja cierra justa' };
  return d > 0 ? { tipo: 'sobra', texto: `Sobran $${d.toLocaleString('es-AR')}` } : { tipo: 'falta', texto: `Faltan $${(-d).toLocaleString('es-AR')}` };
}
