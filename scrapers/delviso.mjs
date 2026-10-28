// delviso.mjs — Metalúrgica del Viso (metalurgicadelviso.com.ar, PHP clásico)
// La página admgenexel.php tiene el formulario "EXCEL": POST /exelconphp.php (usuario, pass) devuelve la
// lista de precios del cliente como planilla. Se lee con el mismo detector de columnas que el panel.
import { correrScraper, env } from './lib/db.mjs';
import { crearSesion } from './lib/sesion.mjs';
import { leerPlanilla } from './lib/planilla.mjs';

const BASE = 'https://metalurgicadelviso.com.ar';

async function scrape() {
  const s = crearSesion(BASE);
  await s.pedir('/admgenexel.php');
  const archivo = await s.binario('/exelconphp.php', { method: 'POST', headers: { Referer: `${BASE}/admgenexel.php` },
    form: { usuario: env('DELVISO_USER'), pass: env('DELVISO_PASSWORD'), Submit: 'Enviar' } });

  // Si el usuario/clave no sirven, el sitio responde una página HTML corta en vez de la planilla
  const inicio = archivo.subarray(0, 600).toString('latin1');
  if (archivo.length < 2000 && /<html|usuario|clave|incorrect|error/i.test(inicio)) {
    throw new Error('Login rechazado o lista vacía: revisar DELVISO_USER / DELVISO_PASSWORD');
  }
  const { filas, hoja, descartadas } = leerPlanilla(archivo);
  console.log(`[delviso] hoja "${hoja}": ${filas.length} artículos (${descartadas} filas descartadas)`);
  return filas;
}

await correrScraper('delviso', scrape);
