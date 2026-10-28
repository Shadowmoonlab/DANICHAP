// otero.mjs — Autopartes Otero (autopartesotero.com.ar, PHP)
// Login: POST /ingresar.php (accion=login, usuario, password) → redirige a lista.php
// Lista: GET /lista-excel.php → planilla completa de precios del cliente (se lee con el detector del panel).
import { correrScraper, env } from './lib/db.mjs';
import { crearSesion } from './lib/sesion.mjs';
import { leerPlanilla } from './lib/planilla.mjs';

const BASE = 'https://www.autopartesotero.com.ar';

async function scrape() {
  const s = crearSesion(BASE);
  await s.pedir('/ingresar.php');
  await s.pedir('/ingresar.php', { method: 'POST',
    form: { accion: 'login', usuario: env('OTERO_USER'), password: env('OTERO_PASSWORD') } });
  const lista = await s.texto('/lista.php');
  if (!/cerrar sesi|mis pedidos/i.test(lista)) throw new Error('Login rechazado: revisar OTERO_USER / OTERO_PASSWORD');

  const archivo = await s.binario('/lista-excel.php');
  const { filas, hoja, descartadas } = leerPlanilla(archivo);
  console.log(`[otero] hoja "${hoja}": ${filas.length} artículos (${descartadas} filas descartadas)`);
  return filas;
}

await correrScraper('otero', scrape);
