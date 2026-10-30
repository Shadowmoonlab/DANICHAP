// armar-funcion.mjs — Genera docs/leer-factura-un-archivo.ts (para pegar en el editor de Supabase)
// a partir de supabase/functions/leer-factura/index.ts + _shared/leer-factura.js.  Uso: npm run armar:funcion
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Saca el bloque de comentarios del principio (el encabezado propio de cada archivo)
const sinEncabezado = lineas => lineas.slice(lineas.findIndex(l => !l.startsWith('//')));

export function armarFuncion(raiz = new URL('..', import.meta.url)) {
  const leer = ruta => fs.readFileSync(new URL(ruta, raiz), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const comun = sinEncabezado(leer('supabase/functions/_shared/leer-factura.js'));
  const indice = sinEncabezado(leer('supabase/functions/leer-factura/index.ts'));
  const imports = indice.filter(l => l.startsWith("import ") && l.includes("'npm:"));
  const cuerpo = indice.filter(l => !l.startsWith('import '));
  const texto = ls => ls.join('\n').trim();
  return [
    '// leer-factura — versión en UN SOLO ARCHIVO para pegar en el editor del panel de Supabase',
    '// (Edge Functions → leer-factura → Code). GENERADO con `npm run armar:funcion` desde',
    '// supabase/functions/leer-factura/index.ts + supabase/functions/_shared/leer-factura.js: no editar a mano.',
    ...imports, '',
    '// ── Lectura (antes en _shared/leer-factura.js) ──',
    texto(comun), '',
    '// ── Función ──',
    texto(cuerpo), '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(new URL('../docs/leer-factura-un-archivo.ts', import.meta.url), armarFuncion());
  console.log('docs/leer-factura-un-archivo.ts actualizado');
}
