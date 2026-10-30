// versionar.mjs — Pone el mismo ?v=N a gestion/main.js (en gestion.html) y a TODOS los imports entre módulos
// de gestion/. Así, después de publicar, el navegador no mezcla un módulo nuevo con otro viejo del caché
// (si main.js nuevo importa algo que un mostrador.js viejo no exporta, el panel no carga).
// Uso: npm run versionar          (sube el número en 1)
import fs from 'node:fs';

const raiz = new URL('..', import.meta.url);
const html = new URL('gestion.html', raiz);
let pagina = fs.readFileSync(html, 'utf8');
const actual = Number(pagina.match(/gestion\/main\.js\?v=(\d+)/)?.[1] ?? 0);
const v = actual + 1;
pagina = pagina.replace(/gestion\/main\.js(\?v=\d+)?"/, `gestion/main.js?v=${v}"`);
fs.writeFileSync(html, pagina);

const dir = new URL('gestion/', raiz);
for (const archivo of fs.readdirSync(dir).filter(a => a.endsWith('.js'))) {
  const ruta = new URL(archivo, dir);
  const antes = fs.readFileSync(ruta, 'utf8');
  const despues = antes.replace(/(from\s+'\.\/[\w-]+\.js)(\?v=\d+)?'/g, `$1?v=${v}'`);
  if (despues !== antes) fs.writeFileSync(ruta, despues);
}
console.log(`Panel versionado: v=${v}`);
