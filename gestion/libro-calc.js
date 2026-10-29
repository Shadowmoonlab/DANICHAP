// gestion/libro-calc.js — Cálculos del libro diario (puros y testeables): períodos, totales, caja y filas para Excel.
// Las filas de resumen vienen de la función libro_resumen de la base (una por día o por mes).

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const TIPOS_MOV = { gasto: 'Gasto', retiro: 'Retiro del dueño', ingreso: 'Otro ingreso' };
export const CATEGORIAS = {
  gasto: ['Alquiler', 'Luz, gas y agua', 'Internet y teléfono', 'Sueldos', 'Impuestos', 'Contador', 'Flete y envíos', 'Mantenimiento', 'Bancos y comisiones', 'Otros gastos'],
  retiro: ['Retiro del dueño'],
  ingreso: ['Aporte del dueño', 'Devolución de proveedor', 'Otros ingresos'],
};

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Fechas "YYYY-MM-DD" como día local (al mediodía, para que ningún huso horario cambie el día)
const aDia = s => new Date(`${s.slice(0, 10)}T12:00:00`);

/** Rango y agrupación de un período. modo: 'dia' (ref YYYY-MM-DD) | 'mes' (YYYY-MM) | 'anio' (YYYY). */
export function rangoPeriodo(modo, ref) {
  if (modo === 'dia') {
    const d = aDia(ref);
    return { desde: iso(d), hasta: iso(d), agrupar: 'day', titulo: `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}` };
  }
  if (modo === 'mes') {
    const [a, m] = ref.split('-').map(Number);
    const fin = new Date(a, m, 0);   // día 0 del mes siguiente = último día de este
    return { desde: `${a}-${pad(m)}-01`, hasta: iso(fin), agrupar: 'day', titulo: `${MESES[m - 1]} de ${a}` };
  }
  const a = Number(ref);
  return { desde: `${a}-01-01`, hasta: `${a}-12-31`, agrupar: 'month', titulo: `Año ${a}` };
}

/** Período anterior (-1) o siguiente (+1). */
export function moverPeriodo(modo, ref, delta) {
  if (modo === 'dia') { const d = aDia(ref); d.setDate(d.getDate() + delta); return iso(d); }
  if (modo === 'mes') { const [a, m] = ref.split('-').map(Number); const d = new Date(a, m - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  return String(Number(ref) + delta);
}

/** Referencia del período actual a partir de "hoy" (YYYY-MM-DD). */
export function periodoDeHoy(modo, hoy) {
  return modo === 'dia' ? hoy : modo === 'mes' ? hoy.slice(0, 7) : hoy.slice(0, 4);
}

const n = v => Number(v) || 0;

/** Una fila de resumen con sus resultados: económico (ganancia − gastos) y de caja (lo que entró − lo que salió). */
export function conResultados(r) {
  const entro = n(r.ventas) - n(r.fiado) + n(r.cobros) + n(r.otros_ingresos);
  const salio = n(r.compras) + n(r.gastos) + n(r.retiros);
  return { ...r, resultado: n(r.ganancia) - n(r.gastos), caja_entro: entro, caja_salio: salio, caja_neto: entro - salio };
}

/** Totales de todas las filas del período. */
export function totales(filas) {
  const campos = ['cant_ventas', 'ventas', 'costo', 'ganancia', 'fiado', 'cobros', 'compras', 'gastos', 'otros_ingresos', 'retiros'];
  const t = Object.fromEntries(campos.map(c => [c, filas.reduce((s, f) => s + n(f[c]), 0)]));
  return conResultados(t);
}

/** Etiqueta de una fila de resumen: "lun 10" (vista mes) o "Mayo" (vista año). */
export function etiquetaFila(periodo, agrupar) {
  const d = aDia(periodo);
  if (agrupar === 'month') return MESES[d.getMonth()][0].toUpperCase() + MESES[d.getMonth()].slice(1);
  return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}`;
}

/** Margen bruto en % (ganancia / ventas), o null si no hubo ventas. */
export const margen = t => (n(t.ventas) > 0 ? Math.round((n(t.ganancia) / n(t.ventas)) * 1000) / 10 : null);

const ETIQ_MOV = { venta: 'Venta', cobro: 'Cobro cta. cte.', compra: 'Compra', gasto: 'Gasto', retiro: 'Retiro', ingreso: 'Otro ingreso' };
export const etiquetaMovimiento = m => ETIQ_MOV[m.tipo] || m.tipo;

/**
 * Hojas para el Excel del contador: [nombre, filas (array de arrays)].
 * Resumen siempre; Movimientos solo si se pasan (vista día o mes).
 */
export function hojasExcel({ titulo, agrupar, resumen, movimientos, pagos = {} }) {
  const t = totales(resumen);
  const hoja1 = [
    [`DANICHAP — Libro diario — ${titulo}`], [],
    ['Ventas', t.ventas], ['Costo de lo vendido', t.costo], ['Ganancia bruta', t.ganancia], ['Gastos', t.gastos],
    ['Resultado (ganancia − gastos)', t.resultado], [],
    ['Caja: entró', t.caja_entro], ['Caja: salió (compras + gastos + retiros)', t.caja_salio], ['Caja: neto', t.caja_neto],
    ['Vendido en cuenta corriente (fiado)', t.fiado], ['Cobros de cuenta corriente', t.cobros], ['Compras a proveedores', t.compras], [],
    [agrupar === 'month' ? 'Mes' : 'Día', 'Ventas', 'Cant.', 'Costo', 'Ganancia', 'Fiado', 'Cobros', 'Compras', 'Gastos', 'Otros ingresos', 'Retiros', 'Resultado', 'Caja neto'],
    ...resumen.map(r => { const x = conResultados(r); return [r.periodo, n(r.ventas), n(r.cant_ventas), n(r.costo), n(r.ganancia), n(r.fiado), n(r.cobros), n(r.compras), n(r.gastos), n(r.otros_ingresos), n(r.retiros), x.resultado, x.caja_neto]; }),
    ['TOTAL', t.ventas, t.cant_ventas, t.costo, t.ganancia, t.fiado, t.cobros, t.compras, t.gastos, t.otros_ingresos, t.retiros, t.resultado, t.caja_neto],
  ];
  const hojas = [['Resumen', hoja1]];
  if (movimientos?.length) {
    hojas.push(['Movimientos', [
      ['Fecha y hora', 'Tipo', 'Nº', 'Detalle', 'Categoría', 'Medio', 'Importe', 'Entra a caja', 'Sale de caja', 'Ganancia', 'Anulado'],
      ...movimientos.map(m => [new Date(m.momento).toLocaleString('es-AR'), etiquetaMovimiento(m), m.ref_id, m.detalle, m.categoria || '',
        pagos[m.medio] || m.medio || '', n(m.importe), n(m.ingreso), n(m.egreso), m.ganancia == null ? '' : n(m.ganancia), m.anulado ? 'sí' : '']),
    ]]);
  }
  return hojas;
}
