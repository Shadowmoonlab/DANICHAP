// gestion/cuentas-calc.js — Cuenta corriente de proveedores (puro y testeable): repartir un pago entre remitos,
// ordenar la lista, días vencidos, el resumen para WhatsApp y la comparación con el resumen del proveedor.
// Los saldos los calcula la base (docs/gestion-v18.sql).

const n = v => Number(v) || 0;
const centavos = v => Math.round(n(v) * 100);
const pesos = c => c / 100;

/**
 * Reparte un pago entre remitos impagos, del más viejo al más nuevo (misma fecha: el de número más chico).
 * @param {number} monto  lo que se paga
 * @param {{id: number, fecha: string, pendiente: number}[]} remitos  los remitos a los que se puede aplicar
 * @returns {{ aplicaciones: {recepcion_id: number, monto: number}[], aCuenta: number }}  lo que sobra queda "a cuenta"
 */
export function repartirPago(monto, remitos) {
  let queda = Math.max(0, centavos(monto));
  const aplicaciones = [];
  const ordenados = [...remitos].filter(r => centavos(r.pendiente) > 0)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
  for (const r of ordenados) {
    if (queda <= 0) break;
    const m = Math.min(queda, centavos(r.pendiente));
    aplicaciones.push({ recepcion_id: r.id, monto: pesos(m) });
    queda -= m;
  }
  return { aplicaciones, aCuenta: pesos(queda) };
}

/** Primero los proveedores con saldo (de mayor a menor deuda; los saldos a favor después), luego el resto por nombre. */
export function ordenarCuentas(filas) {
  return [...filas].sort((a, b) => (n(b.saldo) !== 0) - (n(a.saldo) !== 0) || n(b.saldo) - n(a.saldo)
    || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/** Lo que se les debe a todos (un proveedor con saldo a favor no achica la deuda con los otros). */
export const totalAdeudado = filas => pesos(filas.reduce((s, f) => s + Math.max(0, centavos(f.saldo)), 0));

const aDia = s => new Date(`${String(s).slice(0, 10)}T12:00:00`);
/** Días que pasaron desde el vencimiento (0 o negativo = todavía no venció; sin vencimiento = null). */
export function diasVencido(vence, hoy) {
  if (!vence) return null;
  return Math.round((aDia(hoy) - aDia(vence)) / 864e5);
}

const fechaLarga = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const plata = v => `$ ${Math.round(Math.abs(n(v))).toLocaleString('es-AR')}`;

/**
 * Resumen en texto simple (sin negritas ni emojis) para mandarle al proveedor por WhatsApp.
 * @param {{negocio: string, proveedor: string, saldo: number, hoy: string,
 *          remitos: {nro_comprobante: string|null, fecha: string, pendiente: number}[]}} datos
 */
export function textoResumen({ negocio, proveedor, saldo, hoy, remitos }) {
  const lineas = [`Hola ${proveedor}, te paso el resumen de cuenta de ${negocio} al ${fechaLarga(hoy)}.`, ''];
  if (n(saldo) > 0) {
    lineas.push(`Saldo que les debemos: ${plata(saldo)}`);
    const impagos = remitos.filter(r => n(r.pendiente) > 0);
    if (impagos.length) {
      lineas.push('', 'Remitos sin pagar:');
      for (const r of impagos) {
        lineas.push(`- ${r.nro_comprobante ? `Nº ${r.nro_comprobante}` : 'Remito sin número'} del ${fechaLarga(r.fecha)}: ${plata(r.pendiente)}`);
      }
    }
  } else if (n(saldo) < 0) {
    lineas.push(`Tenemos un saldo a favor de ${plata(saldo)}.`);
  } else {
    lineas.push('Estamos al día: no les debemos nada.');
  }
  lineas.push('', 'Cualquier diferencia avisame. Gracias.');
  return lineas.join('\n');
}

/* ── Comparación con el resumen que publica el proveedor (docs/gestion-v19.sql: resumenes_proveedor) ── */
// Números de un comprobante para compararlo: todas las cifras juntas y el último grupo, sin ceros adelante
// ("FC A 0001-00000106" → "100000106" y "106"). Menos de 3 cifras no alcanza para decir que es el mismo.
function numerosDe(txt) {
  const grupos = String(txt ?? '').match(/\d+/g) ?? [];
  const sinCeros = s => s.replace(/^0+/, '');
  return [sinCeros(grupos.join('')), sinCeros(grupos.at(-1) ?? '')].filter(s => s.length >= 3);
}

/** ¿Es el mismo comprobante? ("FC A 0001-00000106" del proveedor = "106" o "0001-00000106" cargado en Recepción) */
export function mismoComprobante(a, b) {
  const nb = numerosDe(b);
  return numerosDe(a).some(x => nb.includes(x));
}

/**
 * Compara lo que dice el proveedor con la cuenta del sistema.
 * @param {{saldoProveedor: number, saldoSistema: number,
 *          docsProveedor: {comprobante: string, fecha?: string, saldo: number}[],
 *          remitosSistema: {id: number, nro_comprobante: string|null, fecha: string, pendiente: number}[]}} datos
 * @returns {{ diferencia: number, coinciden: boolean,
 *             docs: object[],            impagos según el proveedor (más viejo primero), con enSistema = está impago en el sistema
 *             soloProveedor: object[],   impagos según el proveedor que en el sistema no figuran impagos
 *             soloSistema: object[] }}   remitos impagos en el sistema que el proveedor no tiene pendientes
 */
export function compararResumen({ saldoProveedor, saldoSistema, docsProveedor, remitosSistema }) {
  const diferencia = pesos(centavos(saldoProveedor) - centavos(saldoSistema));
  const remitos = (remitosSistema ?? []).filter(r => centavos(r.pendiente) > 0)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
  const docs = (Array.isArray(docsProveedor) ? docsProveedor : []).filter(d => centavos(d.saldo) !== 0)
    .map(d => ({ ...d, enSistema: remitos.some(r => mismoComprobante(d.comprobante, r.nro_comprobante)) }))
    .sort((a, b) => String(a.fecha ?? '').localeCompare(String(b.fecha ?? '')) || String(a.comprobante).localeCompare(String(b.comprobante)));
  return {
    diferencia,
    coinciden: Math.abs(diferencia) < 1,
    docs,
    soloProveedor: docs.filter(d => !d.enSistema),
    soloSistema: remitos.filter(r => !docs.some(d => mismoComprobante(d.comprobante, r.nro_comprobante))),
  };
}

const TITULOS = { compra: 'Compra', pago: 'Pago', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };
/**
 * Título y detalle de un movimiento de cc_movimientos. Las compras y pagos importados de la planilla de Daniel son notas
 * con detalle "Planilla · Compra · RTO 123" (dev/importar-planilla-proveedores.mjs): se muestran como "Compra (planilla)".
 */
export function tituloMovimiento(m) {
  const detalle = m.detalle ?? '';
  const partes = detalle.split(' · ');
  if (String(m.tipo).startsWith('nota_') && partes[0] === 'Planilla' && partes.length >= 2) {
    return { titulo: `${partes[1]} (planilla)`, detalle: partes.slice(2).join(' · ') };
  }
  return { titulo: TITULOS[m.tipo] || m.tipo, detalle };
}
