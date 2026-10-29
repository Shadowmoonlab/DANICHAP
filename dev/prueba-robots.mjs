// dev/prueba-robots.mjs — Prueba de carga de los robots contra la base LOCAL, antes de subir cambios.
// Corre los 7 robots a la vez con volumen real (DM 32.370, Goicoechea 70.459, PR 28.620, Distrisuper 25.116,
// Del Viso 11.859, Otero 6.000, Fal 1.612), con los sitios simulados (dev/mock-distribuidores.mjs), tres vueltas:
// carga, actualización con todos los precios cambiados y una igual a la anterior (no debe escribir nada).
// Con --estricto los guardados de los robots se cortan a los 200 ms (en vez de 5 min, como en producción tras
// docs/robots-conservar-datos.sql): imita una base mucho más lenta y obliga a partir lotes.
// Uso: npm run dev (en otra terminal) y después  npm run test:robots  [-- --estricto] [--sin-sql-nuevo]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PORTS, PG_SUPERUSER } from './config.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ENV = `${RAIZ}.dev/supabase.env`;
// Los 7 robots activos, a la vez, como en GitHub Actions
const ROBOTS = ['dm', 'pr', 'goicoechea', 'distrisuper', 'otero', 'fal', 'delviso'];
const estricto = process.argv.includes('--estricto');

if (!fs.existsSync(ENV)) {
  console.error('Falta .dev/supabase.env: primero corré "npm run dev" en otra terminal.');
  process.exit(1);
}

async function sql(...consultas) {
  const c = new pg.Client({ host: '127.0.0.1', port: PORTS.postgres, database: 'postgres', ...PG_SUPERUSER });
  await c.connect();
  try { for (const q of consultas) await c.query(q); } finally { await c.end(); }
}

// --sin-sql-nuevo: como una base de producción donde todavía no se corrió docs/robots-sincronizar.sql
const sinSqlNuevo = process.argv.includes('--sin-sql-nuevo');
const SQL_NUEVO = fs.readFileSync(`${RAIZ}docs/robots-sincronizar.sql`, 'utf8');
await sql(...(sinSqlNuevo
  ? ['drop function if exists public.sincronizar_precios(jsonb, timestamptz)', 'drop function if exists public.desactivar_ausentes(text, text[])']
  : [SQL_NUEVO]), `notify pgrst, 'reload schema'`);

// Igual que producción: la API corta a los 8 s y los robots (service_role) tienen su propio límite.
// Se cierran las conexiones de la API para que tomen la configuración.
await sql(`alter role authenticator set statement_timeout = '8s'`,
  `alter role service_role set statement_timeout = '${estricto ? '200ms' : '5min'}'`,
  `select pg_terminate_backend(pid) from pg_stat_activity where usename = 'authenticator'`);
// PostgREST tarda unos segundos en reconectarse: esperar a que responda
process.loadEnvFile(ENV);
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
for (let i = 0; i < 60; i++) {
  await new Promise(ok => setTimeout(ok, 1000));
  const r = await fetch(`${SUPABASE_URL}/rest/v1/scraper_runs?limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }).catch(() => null);
  if (r?.ok) break;
}

function correr(robot, vuelta) {
  return new Promise(ok => {
    const inicio = Date.now();
    const hijo = spawn(process.execPath, ['--env-file', ENV, '--import', new URL('./mock-distribuidores.mjs', import.meta.url).href,
      `scrapers/${robot}.mjs`], {
      cwd: RAIZ,
      env: { ...process.env, PRUEBA_VUELTA: String(vuelta), GOICOECHEA_USER: 'u', GOICOECHEA_PASSWORD: 'p',
             PR_USER: 'u', PR_PASSWORD: 'p', DISTRISUPER_USER: 'u', DISTRISUPER_PASSWORD: 'p', FAL_USER: 'u', FAL_PASSWORD: 'p',
             DM_EMAIL: 'u', DM_PASSWORD: 'p', OTERO_USER: 'u', OTERO_PASSWORD: 'p', DELVISO_USER: 'u', DELVISO_PASSWORD: 'p' },
    });
    let salida = '';
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    hijo.on('close', codigo => ok({ robot, codigo, segundos: (Date.now() - inicio) / 1000,
      salida, linea: salida.split('\n').find(l => /OK —|ERROR/.test(l)) ?? salida.trim().split('\n').pop() }));
  });
}

let fallas = 0;
const VUELTAS = [
  { ajuste: 1, nombre: 'carga' },
  { ajuste: 2, nombre: 'todos los precios cambiaron' },
  { ajuste: 2, nombre: 'sin cambios', sinEscrituras: true },
];
for (const v of VUELTAS) {
  const inicio = Date.now();
  const resultados = await Promise.all(ROBOTS.map(r => correr(r, v.ajuste)));
  console.log(`\nVuelta "${v.nombre}" — ${((Date.now() - inicio) / 1000).toFixed(1)} s en total`);
  for (const r of resultados) {
    // Sin cambios en el sitio no se reescribe nada (salvo sin docs/robots-sincronizar.sql, que reescribe todo)
    const modoViejo = /guardo con upsert_precios/.test(r.salida);
    const ok = r.codigo === 0 && (!v.sinEscrituras || modoViejo || /\(0 nuevos o con cambios\)/.test(r.linea));
    console.log(`  ${ok ? '✅' : '❌'} ${r.robot.padEnd(12)} ${r.segundos.toFixed(1).padStart(5)} s  ${r.linea}${modoViejo ? '  [sin SQL nuevo]' : ''}`);
    if (!ok) fallas++;
  }
}

await sql(`alter role service_role set statement_timeout = '5min'`, SQL_NUEVO);   // la base local queda completa
console.log(fallas ? `\n❌ ${fallas} corridas fallaron` : '\n✅ Todos los robots guardaron todo');
process.exit(fallas ? 1 : 0);
