// tests/gestion-libro.test.mjs — cálculos del libro diario (gestion/libro-calc.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangoPeriodo, moverPeriodo, periodoDeHoy, conResultados, totales, etiquetaFila, margen, hojasExcel } from '../gestion/libro-calc.js';

test('rangos: día, mes (incluye 29 de febrero bisiesto) y año', () => {
  assert.deepEqual(rangoPeriodo('dia', '2026-05-10'), { desde: '2026-05-10', hasta: '2026-05-10', agrupar: 'day', titulo: 'domingo 10 de mayo de 2026' });
  assert.equal(rangoPeriodo('mes', '2028-02').hasta, '2028-02-29');
  assert.equal(rangoPeriodo('mes', '2026-02').hasta, '2026-02-28');
  assert.deepEqual(rangoPeriodo('anio', '2026'), { desde: '2026-01-01', hasta: '2026-12-31', agrupar: 'month', titulo: 'Año 2026' });
});

test('mover período cruza meses y años', () => {
  assert.equal(moverPeriodo('dia', '2026-03-01', -1), '2026-02-28');
  assert.equal(moverPeriodo('dia', '2026-12-31', 1), '2027-01-01');
  assert.equal(moverPeriodo('mes', '2026-01', -1), '2025-12');
  assert.equal(moverPeriodo('mes', '2026-12', 1), '2027-01');
  assert.equal(moverPeriodo('anio', '2026', -1), '2025');
  assert.equal(periodoDeHoy('mes', '2026-10-29'), '2026-10');
});

// Mismos números que la prueba contra la base local (mayo 2026)
const MAYO = [
  { periodo: '2026-05-10', cant_ventas: 2, ventas: 15000, costo: 9000, ganancia: 6000, fiado: 0, cobros: 0, compras: 20000, gastos: 1500, otros_ingresos: 0, retiros: 0 },
  { periodo: '2026-05-11', cant_ventas: 1, ventas: 8000, costo: 5000, ganancia: 3000, fiado: 8000, cobros: 0, compras: 0, gastos: 0, otros_ingresos: 200, retiros: 500 },
  { periodo: '2026-05-12', cant_ventas: 0, ventas: 0, costo: 0, ganancia: 0, fiado: 0, cobros: 3000, compras: 0, gastos: 0, otros_ingresos: 0, retiros: 0 },
];

test('resultado económico y caja: lo fiado entra recién al cobrarlo', () => {
  const d11 = conResultados(MAYO[1]);
  assert.equal(d11.resultado, 3000);          // ganancia 3000 − gastos 0
  assert.equal(d11.caja_entro, 200);          // venta fiada no entra; sí el otro ingreso
  assert.equal(d11.caja_salio, 500);          // retiro del dueño
  const t = totales(MAYO);
  assert.equal(t.ventas, 23000);
  assert.equal(t.resultado, 9000 - 1500);
  assert.equal(t.caja_entro, 23000 - 8000 + 3000 + 200);
  assert.equal(t.caja_salio, 20000 + 1500 + 500);
  assert.equal(t.caja_neto, t.caja_entro - t.caja_salio);
  assert.equal(margen(t), 39.1);
  assert.equal(margen({ ventas: 0, ganancia: 0 }), null);
});

test('etiquetas de fila', () => {
  assert.equal(etiquetaFila('2026-05-10', 'day'), 'dom 10');
  assert.equal(etiquetaFila('2026-05-01', 'month'), 'Mayo');
});

test('Excel: resumen con totales y hoja de movimientos', () => {
  const hojas = hojasExcel({ titulo: 'mayo de 2026', agrupar: 'day', resumen: MAYO,
    movimientos: [{ momento: '2026-05-10T12:00:00Z', tipo: 'venta', ref_id: 1, detalle: 'Consumidor final', medio: 'efectivo', importe: 10000, ingreso: 10000, egreso: 0, ganancia: 4000, anulado: false }],
    pagos: { efectivo: 'Efectivo' } });
  assert.deepEqual(hojas.map(h => h[0]), ['Resumen', 'Movimientos']);
  const total = hojas[0][1].at(-1);
  assert.equal(total[0], 'TOTAL');
  assert.equal(total[1], 23000);
  assert.deepEqual(hojas[1][1][1].slice(1, 7), ['Venta', 1, 'Consumidor final', '', 'Efectivo', 10000]);
  assert.equal(hojasExcel({ titulo: 'x', agrupar: 'month', resumen: [] }).length, 1);
});

// Desde el corte (docs/gestion-v18.sql) la caja cuenta lo PAGADO a proveedores; las compras con proveedor
// quedan como "a pagar" (informativas) y las compras sin proveedor salen de la caja como siempre
const NOVIEMBRE = [
  { periodo: '2026-11-20', cant_ventas: 1, ventas: 10000, costo: 6000, ganancia: 4000, fiado: 0, cobros: 0,
    compras: 50000, compras_caja: 3000, pagos_proveedores: 20000, gastos: 1000, otros_ingresos: 0, retiros: 0 },
];

test('caja desde el corte: sale lo pagado a proveedores y las compras al contado, no las compras a pagar', () => {
  const d = conResultados(NOVIEMBRE[0]);
  assert.equal(d.caja_salio, 20000 + 3000 + 1000);
  assert.equal(d.compras_a_pagar, 47000);
  assert.equal(d.resultado, 3000);   // el resultado económico no cambia
  const t = totales(NOVIEMBRE);
  assert.equal(t.pagos_proveedores, 20000);
  assert.equal(t.compras_caja, 3000);
  assert.equal(t.caja_salio, 24000);
});

test('caja: una compra con proveedor (a pagar) no cambia la caja; un pago sí; una compra sin proveedor sí', () => {
  const base = { ventas: 0, fiado: 0, cobros: 0, otros_ingresos: 0, gastos: 0, retiros: 0 };
  assert.equal(conResultados({ ...base, compras: 80000, compras_caja: 0, pagos_proveedores: 0 }).caja_neto, 0);
  assert.equal(conResultados({ ...base, compras: 0, compras_caja: 0, pagos_proveedores: 15000 }).caja_neto, -15000);
  assert.equal(conResultados({ ...base, compras: 7000, compras_caja: 7000, pagos_proveedores: 0 }).caja_neto, -7000);
});

test('Excel: muestra pagos a proveedores, compras a pagar y el pago como "Pago a proveedor"', () => {
  const hojas = hojasExcel({ titulo: 'noviembre de 2026', agrupar: 'day', resumen: NOVIEMBRE,
    movimientos: [{ momento: '2026-11-20T15:00:00Z', tipo: 'pago_proveedor', ref_id: 9, detalle: 'Cromosol', medio: 'cheque', importe: 20000, ingreso: 0, egreso: 20000, ganancia: null, anulado: false }],
    pagos: { cheque: 'Cheque' } });
  const resumen = hojas[0][1];
  const fila = k => resumen.find(r => r[0] === k);
  assert.equal(fila('Pagos a proveedores')[1], 20000);
  assert.equal(fila('Compras a pagar (no salen de la caja)')[1], 47000);
  assert.match(resumen.find(r => String(r[0]).startsWith('Caja: salió'))[0], /pagos a proveedores/);
  const enc = resumen.find(r => r[0] === 'Día');
  assert.ok(enc.includes('Pagos a proveedores'));
  assert.deepEqual(hojas[1][1][1].slice(1, 7), ['Pago a proveedor', 9, 'Cromosol', '', 'Cheque', 20000]);
});
