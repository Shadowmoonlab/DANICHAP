// gestion/texto.js — Funciones puras de texto (sin DOM ni base): búsqueda, teléfonos, WhatsApp.
// Se testean con node --test (tests/gestion-texto.test.mjs).

/** Palabras de búsqueda seguras para filtros de PostgREST.
 *  Sin la "s" final (búsqueda por substring): "paragolpes" también encuentra "PARAGOLPE". */
export const palabras = q => String(q).toLowerCase().replace(/[,()*%\\:"']/g, ' ').split(/\s+/)
  .filter(w => w.length > 1)
  .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
  .slice(0, 6);

/** Igual que la columna precios_distribuidor.busqueda: sin acentos ni - / . → "f100" encuentra "F-100". */
export const normalizar = q => String(q).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[-/.]/g, '');

/** Teléfono argentino → formato internacional de WhatsApp (549 + área + número), o null. */
export function telefonoWhatsApp(tel) {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // "11 15 5555-1234" → quitar el 15 después del código de área de 2 a 4 dígitos
  const quince = d.match(/^(\d{2,4})15(\d{6,8})$/);
  if (quince && (quince[1] + quince[2]).length === 10) d = quince[1] + quince[2];
  // Sin código de área: celular de AMBA escrito como 15xxxxxxxx
  if (d.length === 10 && d.startsWith('15')) d = '11' + d.slice(2);
  if (d.length !== 10) return null;
  return '549' + d;
}

/** Link wa.me con el texto ya escrito. Sin teléfono válido abre WhatsApp para elegir el contacto. */
export function linkWhatsApp(tel, texto) {
  const numero = telefonoWhatsApp(tel);
  return `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(texto)}`;
}
