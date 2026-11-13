// resumen-cromosol.mjs — Resumen de cuenta corriente de Cromosol: lo que Cromosol dice que le debés (una vez por día).
// Misma sesión Spring que el robot de precios (login de scrapers/cromosol.mjs). Por cada empresa del grupo (1 a 4):
//   GET /api/transactions?company=N&page=P → [{ createdDate, type ('FC A' factura, 'NC A' nota de crédito, 'RC X' recibo),
//   numerator, total, balance (lo que queda por pagar; negativo = crédito sin aplicar), expiration, … }], de a 30.
// Saldo según Cromosol = suma de balance de las 4 empresas. Se guarda en resumenes_proveedor (docs/gestion-v19.sql) con los
// comprobantes que tienen algo pendiente; el panel lo compara con la cuenta del sistema (Cuentas corrientes).
import { correrResumen, env } from './lib/db.mjs';
import { crearSesion, esPrincipal } from './lib/sesion.mjs';
import { BASE, API, iniciarSesion } from './cromosol.mjs';

export const EMPRESAS = [1, 2, 3, 4];
const POR_PAGINA = 30;
const MAX_PAGINAS = 500;   // 15.000 comprobantes por empresa: más que eso es que la paginación no corta

const dia = v => (v ? String(v).slice(0, 10) : null);   // "2026-11-11 00:00:00.0" → "2026-11-11"
const clave = t => `${t?.type}|${t?.numerator}|${t?.createdDate}`;

/**
 * Todas las transacciones de una empresa: pide páginas hasta una que venga con menos de `porPagina`.
 * `pedirPagina(empresa, page)` devuelve el array de la API.
 */
export async function leerEmpresa(pedirPagina, empresa, { porPagina = POR_PAGINA, maxPaginas = MAX_PAGINAS } = {}) {
  const todas = [];
  let primera = null;
  for (let page = 0; page < maxPaginas; page++) {
    const lote = await pedirPagina(empresa, page);
    if (!Array.isArray(lote)) throw new Error(`/api/transactions empresa ${empresa} página ${page}: formato inesperado`);
    if (page === 0) primera = lote.length ? clave(lote[0]) : null;
    else if (lote.length && clave(lote[0]) === primera) {
      throw new Error(`/api/transactions empresa ${empresa}: la página ${page} repite la primera (el sitio no pagina)`);
    }
    todas.push(...lote);
    if (lote.length < porPagina) return todas;
  }
  throw new Error(`/api/transactions empresa ${empresa}: más de ${maxPaginas} páginas`);
}

/**
 * Saldo (suma de balance) y comprobantes con algo pendiente, sin el nº de cliente ni las notas internas.
 * @param {[number, object[]][]} porEmpresa  [[empresa, transacciones], …]
 */
export function resumenDeTransacciones(porEmpresa) {
  let saldo = 0, leidos = 0;
  const detalle = [], cuenta = {};
  for (const [empresa, txs] of porEmpresa) {
    cuenta[empresa] = txs.length;
    for (const t of txs) {
      leidos++;
      const balance = Number(t.balance);
      if (t.balance == null || !Number.isFinite(balance)) throw new Error(`/api/transactions: comprobante sin balance numérico (${t.type ?? '?'})`);
      const c = Math.round(balance * 100);
      saldo += c;
      if (c === 0) continue;
      detalle.push({ comprobante: [t.type, t.numerator].filter(Boolean).join(' '), tipo: t.type ?? null, numero: t.numerator ?? null,
        fecha: dia(t.createdDate), vence: dia(t.expiration), total: Number(t.total) || 0, saldo: c / 100, empresa: String(empresa) });
    }
  }
  detalle.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.comprobante.localeCompare(b.comprobante));
  return { saldo: saldo / 100, detalle, datos: { comprobantes_leidos: leidos, por_empresa: cuenta } };
}

async function leer() {
  const s = crearSesion(BASE);
  if ((await iniciarSesion(s, env('CROMOSOL_USER'), env('CROMOSOL_PASSWORD'))).rechazado) {
    throw new Error('Login rechazado: revisar CROMOSOL_USER / CROMOSOL_PASSWORD');
  }
  try {
    const pedirPagina = async (empresa, page) => {
      const ruta = `/api/transactions?company=${empresa}&page=${page}`;
      const res = await s.pedir(ruta, { headers: API, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        await res.arrayBuffer().catch(() => {});
        throw new Error(`${ruta}: la sesión no habilitó la cuenta corriente (redirige a /login)`);
      }
      if (!res.ok) throw new Error(`${ruta} HTTP ${res.status}`);
      return res.json();
    };
    const porEmpresa = [];
    for (const empresa of EMPRESAS) porEmpresa.push([empresa, await leerEmpresa(pedirPagina, empresa)]);
    const r = resumenDeTransacciones(porEmpresa);
    console.log(`[resumen cromosol] ${r.datos.comprobantes_leidos} comprobantes leídos (${EMPRESAS.map(e => `empresa ${e}: ${r.datos.por_empresa[e]}`).join(', ')})`);
    return r;
  } finally {
    await s.pedir('/logout').catch(() => {});   // no dejar la sesión abierta en la cuenta de Daniel
  }
}

if (esPrincipal(import.meta.url)) await correrResumen('cromosol', leer);
