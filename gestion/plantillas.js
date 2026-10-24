// gestion/plantillas.js — Mensajes de WhatsApp listos para mandar (presupuesto, saldo, pedido a proveedor).
// Puras: reciben datos y devuelven texto. Tono: cercano, de barrio, sin presión; siempre con un próximo paso claro.

const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const primerNombre = nombre => {
  const n = String(nombre || '').trim();
  if (!n) return '';
  // Razones sociales ("Taller Gómez", "Mecánica Los Hermanos") se usan completas
  return /^(taller|mec[aá]nica|lubricentro|gomer[ií]a|transporte|flota|remiser[ií]a)\b/i.test(n) ? n : n.split(/\s+/)[0];
};
const saludo = nombre => (primerNombre(nombre) ? `Hola ${primerNombre(nombre)}!` : 'Hola!');
const firma = negocio => {
  const lineas = [`*${negocio?.nombre_negocio || 'DANICHAP'}* — Repuestos`];
  if (negocio?.direccion) lineas.push(`📍 ${negocio.direccion}`);
  return lineas.join('\n');
};

/** Presupuesto: claro, con total, validez y un cierre que invita a reservar. */
export function presupuesto({ cliente, items, negocio, validezHoras = 48 }) {
  const total = items.reduce((s, i) => s + i.cantidad * i.precio_unit, 0);
  const lineas = items.map(i => `• ${i.cantidad} x ${i.descripcion} — ${pesos(i.cantidad * i.precio_unit)}`);
  return [
    `${saludo(cliente)} 👋 Te paso el presupuesto:`,
    '',
    ...lineas,
    '',
    `*Total: ${pesos(total)}*`,
    '',
    `Precios válidos por ${validezHoras} hs, sujetos a stock.`,
    '¿Te lo separo? Respondé "dale" y queda reservado a tu nombre 🔧',
    '',
    firma(negocio),
  ].join('\n');
}

/** Recordatorio de saldo: amable, sin reproche, con opciones de pago concretas. */
export function recordatorioSaldo({ cliente, saldo, negocio, alias }) {
  return [
    `${saludo(cliente)} ¿Cómo va? Te escribo de ${negocio?.nombre_negocio || 'DANICHAP'}.`,
    '',
    `Te paso el resumen de tu cuenta: el saldo pendiente es de *${pesos(saldo)}*.`,
    alias ? `Podés abonarlo en efectivo en el local o por transferencia al alias *${alias}*.`
          : 'Podés abonarlo en efectivo en el local o por transferencia, como te quede mejor.',
    '',
    'Cualquier diferencia avisame y lo revisamos juntos. ¡Gracias por la confianza de siempre! 🙌',
  ].join('\n');
}

/** Pedido a un proveedor (reposición). */
export function pedidoProveedor({ proveedor, items, negocio }) {
  const lineas = items.map(it => `• ${it.cantidad} x ${it.codigo ? it.codigo + ' — ' : ''}${it.descripcion}`);
  return [
    `Hola! Pedido de ${negocio?.nombre_negocio || 'DANICHAP'}${proveedor ? ' para ' + proveedor : ''}:`,
    '',
    ...lineas,
    '',
    '¿Me confirmás disponibilidad y precio? Gracias!',
  ].join('\n');
}

