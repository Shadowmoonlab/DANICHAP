// resumen-distrisuper.mjs — Resumen de cuenta corriente de Distrisuper (Lupa): lo que Distrisuper dice que le debés (una vez por día).
// Login de scrapers/distrisuper.mjs → token. El nº de cliente es el "codigoparticular" de GET apidistri/api/auth/me (el mismo
// con el que se entra: si no viene, se usa DISTRISUPER_USER). Después:
//   GET https://distrimdp.dvrdns.org/ctacte/{nº de cliente} → { ok: 1, data: { saldo, dias, estado, updated,
//   data: [{ COMPROBANTE, EMPRESA, CONDICION, TOTAL, PAGADO, SALDO, FECHACOMPROBANTE, DIAS, ACUMULADO }] } }
// Se guarda en resumenes_proveedor (docs/gestion-v19.sql): saldo de la cabecera y los comprobantes con saldo.
import { correrResumen } from './lib/db.mjs';
import { esPrincipal } from './lib/sesion.mjs';
import { AUTH, pedir, iniciarSesion } from './distrisuper.mjs';

const CTACTE = 'https://distrimdp.dvrdns.org/ctacte';
const plata = v => Math.round((Number(v) || 0) * 100) / 100;
// "2026-10-26T03:00:00.000Z" es la medianoche en Argentina (UTC-3): se pasa a fecha de acá
const fechaAR = v => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? new Date(t - 3 * 3600_000).toISOString().slice(0, 10) : null; };

/** Nº de cliente para /ctacte: el codigoparticular de /api/auth/me, o el usuario con el que se entró. */
export function codigoDeSesion(me, usuario) {
  return String(me?.codigoparticular ?? '').trim() || usuario;
}

/** Saldo de la cabecera y comprobantes con saldo, sin razón social, vendedor ni nº de cliente. */
export function resumenDeCtacte(r) {
  if (!r || Number(r.ok) !== 1 || !r.data || typeof r.data !== 'object') throw new Error('ctacte: respuesta inesperada');
  const d = r.data;
  const saldo = Number(d.saldo);
  if (d.saldo == null || d.saldo === '' || !Number.isFinite(saldo)) throw new Error('ctacte: la respuesta no trae el saldo');
  const detalle = (Array.isArray(d.data) ? d.data : []).filter(x => Math.round(Number(x.SALDO) * 100) !== 0).map(x => {
    const comprobante = String(x.COMPROBANTE ?? '').trim();
    const m = /^([A-Za-z]+)[-\s]*(.*)$/.exec(comprobante);
    return { comprobante, tipo: m ? m[1].toUpperCase() : null, numero: m ? m[2] || null : comprobante || null, fecha: fechaAR(x.FECHACOMPROBANTE),
      vence: null, total: plata(x.TOTAL), pagado: plata(x.PAGADO), saldo: plata(x.SALDO), empresa: x.EMPRESA ?? null,
      condicion: x.CONDICION ?? null, dias: Number.isFinite(Number(x.DIAS)) ? Number(x.DIAS) : null };
  });
  return {
    saldo: plata(saldo), detalle,
    datos: { dias: d.dias ?? null, estado: d.estado ?? null, actualizado: d.updated ?? null, suma_detalle: plata(detalle.reduce((s, x) => s + x.saldo, 0)) },
  };
}

/**
 * GET /ctacte/{nº de cliente}. Si falla, el error sale sin el nº de cliente: va a la consola y al resumen de GitHub
 * Actions, que en un repo público ve cualquiera. `pedirFn` es pedir() de distrisuper.mjs (los tests pasan uno falso).
 */
export async function leerCtacte(pedirFn, codigo, token) {
  const url = `${CTACTE}/${encodeURIComponent(codigo)}`;
  try {
    return await pedirFn(url, { token });
  } catch (err) {
    const tapado = String(err?.message ?? err).split(url).join(`${CTACTE}/(nº de cliente)`);
    const sinCodigo = String(codigo ?? '') ? tapado.split(String(codigo)).join('(nº de cliente)') : tapado;
    throw Object.assign(new Error(sinCodigo), { final: err?.final });
  }
}

async function leer() {
  const { token, usuario } = await iniciarSesion();
  const me = await pedir(`${AUTH}/api/auth/me`, { token }).catch(() => null);
  const r = resumenDeCtacte(await leerCtacte(pedir, codigoDeSesion(me, usuario), token));
  if (Math.abs(r.datos.suma_detalle - r.saldo) >= 1) console.warn('[resumen distrisuper] la suma de los comprobantes no da el saldo de la cabecera');
  return r;
}

if (esPrincipal(import.meta.url)) await correrResumen('distrisuper', leer);
