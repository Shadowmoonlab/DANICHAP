// gestion/cuentas-calc.js — Cuenta corriente de proveedores (puro y testeable): repartir un pago entre remitos,
// ordenar la lista, días vencidos y el resumen para WhatsApp. Los saldos los calcula la base (docs/gestion-v18.sql).

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
    lineas.push('Estamos al día: no le debemos nada.');
  }
  lineas.push('', 'Cualquier diferencia avisame. Gracias.');
  return lineas.join('\n');
}
