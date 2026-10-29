// gestion/robots.js — Estado de los precios de cada proveedor a partir de scraper_runs (puro y testeable).
// Lo que importa para Daniel es desde cuándo están los precios: un intento fallido no borra los del día anterior,
// y un robot que está corriendo no es un error.

const EN_CURSO_MAX_MS = 2 * 3600_000;   // más que eso sin terminar = corrida cortada

/**
 * @param {{inicio: string, fin: string|null, ok: boolean|null, productos: number|null, error: string|null}[]} runs
 *        corridas de ESE proveedor, de la más nueva a la más vieja
 * @param {(iso: string) => string} fecha  formateador de fecha
 * @returns {{ tipo: 'none'|'ok'|'warn'|'run'|'err', texto: string, detalle?: string }}
 */
export function estadoPrecios(runs, fecha, ahora = Date.now()) {
  const ultimo = runs[0];
  if (!ultimo) return { tipo: 'none', texto: 'Precios: todavía no se cargaron' };

  const bueno = runs.find(r => r.ok === true);
  const precios = bueno ? `Precios del ${fecha(bueno.inicio)}: ${Number(bueno.productos ?? 0).toLocaleString('es-AR')} artículos` : null;

  if (ultimo.fin == null && ultimo.ok == null && ahora - new Date(ultimo.inicio).getTime() < EN_CURSO_MAX_MS) {
    return { tipo: 'run', texto: precios ? `${precios} · actualizando ahora…` : 'Cargando precios por primera vez…' };
  }
  if (ultimo === bueno) return { tipo: 'ok', texto: precios };
  const motivo = String(ultimo.error ?? 'no terminó').split('\n')[0].slice(0, 160);
  if (bueno) return { tipo: 'warn', texto: `${precios} · el último intento (${fecha(ultimo.inicio)}) falló`, detalle: motivo };
  return { tipo: 'err', texto: `No se pudieron cargar los precios (${fecha(ultimo.inicio)})`, detalle: motivo };
}
