// dev/importar-planilla-proveedores.mjs — Importa la planilla de proveedores de Daniel (PROVEEDORES.xlsx) a la cuenta corriente.
// Corre en la PC de Fede, con el Excel local (nunca se sube a git):
//
//   node dev/importar-planilla-proveedores.mjs <PROVEEDORES.xlsx> [--desde=2024-01-01] [--hasta=AAAA-MM-DD] [--salida=carpeta]
//
// Deja en entrega/planilla/ (ignorada por git: tiene datos reales):
//   equivalencias.csv   cada nombre de la planilla → slug del sistema propuesto. Daniel corrige la columna slug_final
//                       (vacía = el propuesto; "ignorar" = no se importa ese proveedor). Al volver a correr se respeta.
//   revisar.csv         renglones con fecha o monto dudoso (no se importan) y los que se corrigieron solos (sí se importan).
//                       Completando fecha_ok / importe_ok / pagos_ok (o no_importar = si) y volviendo a correr, se usan.
//   carga-inicial.sql   SQL idempotente para Supabase (requiere docs/gestion-v19.sql). Lo corre Fede a mano.
//   informe.txt         por proveedor: saldo de la planilla vs saldo importado.
// Las funciones (sin archivos) están en dev/planilla-proveedores.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './config.mjs';
import {
  normalizarNombre, armarEquivalencias, extraerProveedores, filasDesdeMatriz, procesarFilas, generarSql, aCsv, leerCsv, informe,
} from './planilla-proveedores.mjs';

const XLSX = createRequire(import.meta.url)('../vendor/xlsx-0.20.3.full.min.js');

const args = process.argv.slice(2);
const opcion = (nombre, defecto) => args.find(a => a.startsWith(`--${nombre}=`))?.split('=').slice(1).join('=') || defecto;
const archivo = args.find(a => !a.startsWith('--'));
if (!archivo) {
  console.error('Uso: node dev/importar-planilla-proveedores.mjs <PROVEEDORES.xlsx> [--desde=2024-01-01] [--hasta=AAAA-MM-DD] [--salida=carpeta]');
  process.exit(1);
}
const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);   // hoy en Argentina (UTC-3)
const desde = opcion('desde', '2024-01-01');
const hasta = opcion('hasta', hoy);
const salida = path.resolve(opcion('salida', path.join(ROOT, 'entrega', 'planilla')));
// Los archivos tienen datos reales: dentro del repo (que es público) solo en entrega/, que git ignora
const dentro = (hijo, padre) => { const r = path.relative(padre, hijo); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
if (dentro(salida, ROOT) && !dentro(salida, path.join(ROOT, 'entrega'))) {
  console.error(`--salida=${salida}: dentro del proyecto los archivos van en entrega/ (git la ignora; en otra carpeta se subirían datos reales)`);
  process.exit(1);
}
fs.mkdirSync(salida, { recursive: true });
const ruta = nombre => path.join(salida, nombre);

// 1. La hoja con el encabezado FECHA · PROVEDOR · REMITO · IMPORTE · PAGOS
const libro = XLSX.read(fs.readFileSync(archivo), { type: 'buffer' });
let filas = null, hoja = null;
for (const nombre of [...libro.SheetNames].sort((a, b) => /prove/i.test(b) - /prove/i.test(a))) {
  try {
    filas = filasDesdeMatriz(XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: null }));
    hoja = nombre;
    break;
  } catch { /* otra hoja */ }
}
if (!filas) { console.error('No encontré en el Excel una hoja con FECHA, PROVEDOR, REMITO, IMPORTE y PAGOS'); process.exit(1); }

// 2. Proveedores que el sistema ya conoce (los insert de docs/*.sql)
const docs = path.join(ROOT, 'docs');
const conocidos = extraerProveedores(fs.readdirSync(docs).filter(f => f.endsWith('.sql')).sort()
  .map(f => fs.readFileSync(path.join(docs, f), 'utf8')).join('\n'));
const slugsConocidos = new Set(conocidos.map(p => p.slug));

// 3. Equivalencias (respetando lo que Daniel ya corrigió)
const conteo = new Map();
for (const f of filas) {
  const n = normalizarNombre(f.proveedor);
  if (n) conteo.set(n, (conteo.get(n) ?? 0) + 1);
}
const leerSiExiste = nombre => (fs.existsSync(ruta(nombre)) ? leerCsv(fs.readFileSync(ruta(nombre), 'utf8')) : []);
const previas = new Map(leerSiExiste('equivalencias.csv').map(e => [normalizarNombre(e.nombre_planilla), e]));
const equivalencias = armarEquivalencias([...conteo].map(([nombre, renglones]) => ({ nombre, renglones })), conocidos, previas);
fs.writeFileSync(ruta('equivalencias.csv'), aCsv(equivalencias,
  ['nombre_planilla', 'renglones', 'slug_propuesto', 'nombre_sistema', 'confianza', 'puntaje', 'slug_final', 'nota']));

const elegido = new Map();
for (const e of equivalencias) {
  const slug = String(e.slug_final || e.slug_propuesto).trim().toLowerCase();
  if (slug !== 'ignorar' && !/^[a-z0-9_]+$/.test(slug)) {
    console.error(`equivalencias.csv: slug_final inválido para "${e.nombre_planilla}" (solo letras minúsculas, números y _; o "ignorar")`);
    process.exit(1);
  }
  elegido.set(e.nombre_planilla, slug);
}

// 4. Renglones → movimientos (con las correcciones a mano de revisar.csv)
const correcciones = new Map(leerSiExiste('revisar.csv').filter(r => Number(r.fila) > 0).map(r => [Number(r.fila), r]));
const r = procesarFilas(filas, { equivalencias: elegido, correcciones, desde, hasta });

// Proveedores que no están en docs/*.sql: se crean (si en la base ya existen, el insert no los toca)
const nombreDe = new Map();
for (const e of equivalencias) {
  const slug = elegido.get(e.nombre_planilla);
  if (!nombreDe.has(slug)) nombreDe.set(slug, e.slug_final && e.slug_final !== e.slug_propuesto ? e.nombre_planilla : e.nombre_sistema);
}
const usados = [...new Set(r.movimientos.map(m => m.proveedor))].sort();
const proveedoresNuevos = usados.filter(s => !slugsConocidos.has(s)).map(slug => ({ slug, nombre: nombreDe.get(slug) || slug }));

// 5. Archivos
fs.writeFileSync(ruta('revisar.csv'), aCsv(r.revisar, ['fila', 'proveedor', 'slug', 'fecha_planilla', 'remito', 'importe_planilla',
  'pagos_planilla', 'estado', 'motivo', 'fecha_ok', 'importe_ok', 'pagos_ok', 'no_importar']));
fs.writeFileSync(ruta('carga-inicial.sql'), generarSql({ movimientos: r.movimientos, proveedoresNuevos }));
const aRevisar = r.revisar.filter(x => x.estado === 'revisar').length;
fs.writeFileSync(ruta('informe.txt'), informe({ ...r, revisar: aRevisar }));

// Solo totales por consola (los nombres y montos quedan en los archivos)
const existentes = equivalencias.filter(e => slugsConocidos.has(elegido.get(e.nombre_planilla)));
const ignorados = equivalencias.filter(e => elegido.get(e.nombre_planilla) === 'ignorar');
console.log(`Hoja "${hoja.trim()}": ${r.leidos} renglones leídos`);
console.log(`Nombres de proveedor: ${equivalencias.length} → ${existentes.length} con un proveedor del sistema`
  + ` (${existentes.filter(e => e.confianza === 'media').length} dudosos), ${equivalencias.length - existentes.length - ignorados.length} nuevos`
  + `${ignorados.length ? `, ${ignorados.length} ignorados` : ''}; proveedores a crear: ${proveedoresNuevos.length}`);
console.log(`Movimientos: ${r.compras} débitos (compras) y ${r.pagos} créditos (pagos y notas de crédito)`);
console.log(`Para revisar (no se importan): ${aRevisar} · corregidos solos: ${r.revisar.filter(x => x.estado === 'corregida').length}`
  + ` · corregidos a mano: ${r.revisar.filter(x => x.estado === 'corregida a mano').length}`
  + ` · marcados no importar: ${r.revisar.filter(x => x.estado === 'no se importa').length}`);
console.log(`Archivos en ${salida}: equivalencias.csv, revisar.csv, carga-inicial.sql, informe.txt`);
