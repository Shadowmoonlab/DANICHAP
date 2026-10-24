// dev/start.mjs — Levanta el ambiente de pruebas LOCAL completo
//   npm run dev          → Postgres + PostgREST + web en http://localhost:8080
//   npm run dev:reset    → borra la base local y la vuelve a crear con los datos de prueba
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import {
  ROOT, DEV_DIR, PG_DATA, BIN_DIR, PORTS, POSTGREST_URL, POSTGREST_VERSION,
  PG_SUPERUSER, PG_AUTHENTICATOR_PASSWORD, JWT_SECRET, MIGRACIONES, SEED, TOKENS, DEV_USERS, DEV_PASSWORD,
} from './config.mjs';
import { iniciarServidor } from './server.mjs';

// .env.local (opcional): ANTHROPIC_API_KEY para leer facturas, credenciales de robots
if (fs.existsSync(path.join(ROOT, '.env.local'))) process.loadEnvFile(path.join(ROOT, '.env.local'));

const RESET = process.argv.includes('--reset');
const SOLO_DB = process.argv.includes('--solo-db');
const log = (...a) => console.log('[dev]', ...a);

/* ── 1. PostgREST (se descarga una sola vez del release oficial) ───────── */
async function asegurarPostgrest() {
  const exe = path.join(BIN_DIR, 'postgrest.exe');
  const marca = path.join(BIN_DIR, `postgrest-${POSTGREST_VERSION}.ok`);
  if (fs.existsSync(exe) && fs.existsSync(marca)) return exe;
  log(`Descargando PostgREST ${POSTGREST_VERSION} (una sola vez)…`);
  await fsp.mkdir(BIN_DIR, { recursive: true });
  const res = await fetch(POSTGREST_URL);
  if (!res.ok) throw new Error(`No pude descargar PostgREST: HTTP ${res.status}`);
  const zip = path.join(BIN_DIR, 'postgrest.zip');
  await fsp.writeFile(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xf', zip, '-C', BIN_DIR]);   // tar de Windows 10+ abre .zip
  await fsp.rm(zip);
  if (!fs.existsSync(exe)) throw new Error('El zip de PostgREST no trajo postgrest.exe');
  await fsp.writeFile(marca, new Date().toISOString());
  return exe;
}

/* ── 2. Postgres embebido + migraciones + datos de prueba ──────────────── */
async function iniciarPostgres() {
  if (RESET && fs.existsSync(PG_DATA)) {
    log('Borrando base local (reset)…');
    await fsp.rm(PG_DATA, { recursive: true, force: true });
  }
  const nueva = !fs.existsSync(path.join(PG_DATA, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DATA, port: PORTS.postgres, persistent: true,
    user: PG_SUPERUSER.user, password: PG_SUPERUSER.password,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {}, onError: m => { const t = String(m); if (/ERROR|FATAL/.test(t)) console.error('[postgres]', t.trim()); },
  });
  if (nueva) { log('Creando base local…'); await pg.initialise(); }
  await pg.start();
  log(`Postgres listo en puerto ${PORTS.postgres}`);

  const db = pg.getPgClient();
  await db.connect();
  await db.query(`create schema if not exists _dev;
    create table if not exists _dev.migraciones (archivo text primary key, aplicada_at timestamptz default now())`);
  const { rows } = await db.query('select archivo from _dev.migraciones');
  const hechas = new Set(rows.map(r => r.archivo));

  for (const archivo of MIGRACIONES) {
    if (hechas.has(archivo)) continue;
    log(`Migración: ${archivo}`);
    let sql = await fsp.readFile(path.join(ROOT, archivo), 'utf8');
    if (archivo.endsWith('supabase-shim.sql')) sql = sql.replace("'authenticator-dev'", `'${PG_AUTHENTICATOR_PASSWORD}'`);
    try {
      await db.query(sql);
    } catch (e) {
      throw new Error(`Falló ${archivo}: ${e.message}${e.position ? ` (posición ${e.position})` : ''}`);
    }
    await db.query('insert into _dev.migraciones (archivo) values ($1)', [archivo]);
  }

  if (!hechas.has(SEED)) {
    log('Cargando datos de prueba (dev/seed.sql)…');
    await db.query(await fsp.readFile(path.join(ROOT, SEED), 'utf8'));
    await db.query('insert into _dev.migraciones (archivo) values ($1)', [SEED]);
  }
  await db.end();
  return pg;
}

/* ── 3. PostgREST ──────────────────────────────────────────────────────── */
// postgrest.exe necesita libpq.dll (+ OpenSSL): las tomo del Postgres embebido
const PG_BIN = path.join(ROOT, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');

function iniciarPostgrest(exe) {
  const proc = spawn(exe, [], {
    env: {
      ...process.env,
      PATH: `${PG_BIN};${process.env.PATH}`,
      PGRST_DB_URI: `postgres://authenticator:${PG_AUTHENTICATOR_PASSWORD}@127.0.0.1:${PORTS.postgres}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(PORTS.postgrest),
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_DB_MAX_ROWS: '1000',            // igual que el límite por defecto de Supabase
      PGRST_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => { const t = String(d).trim(); if (t) console.log('[postgrest]', t); });
  proc.stderr.on('data', d => { const t = String(d).trim(); if (t) console.error('[postgrest]', t); });
  return proc;
}

async function esperarPostgrest() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORTS.postgrest}/`); if (r.status < 500) return; } catch {}
    await new Promise(ok => setTimeout(ok, 250));
  }
  throw new Error('PostgREST no arrancó');
}

/* ── 4. Archivo de entorno para correr los robots contra la base local ─── */
async function escribirEnvLocal() {
  await fsp.writeFile(path.join(DEV_DIR, 'supabase.env'),
    `# Generado por dev/start.mjs — robots apuntando a la base LOCAL\nSUPABASE_URL=http://localhost:${PORTS.web}\nSUPABASE_SERVICE_KEY=${TOKENS.service}\n`);
}

/* ── Main ──────────────────────────────────────────────────────────────── */
await fsp.mkdir(DEV_DIR, { recursive: true });
const exe = await asegurarPostgrest();
const pg = await iniciarPostgres();
if (SOLO_DB) { await pg.stop(); log('Base lista.'); process.exit(0); }

const rest = iniciarPostgrest(exe);
let server;
try {
  await esperarPostgrest();
  await escribirEnvLocal();
  server = await iniciarServidor();
} catch (e) {
  console.error('[dev]', e.message);
  rest.kill(); await pg.stop().catch(() => {});
  process.exit(1);
}

console.log(`
  ┌────────────────────────────────────────────────────────────┐
  │  DANICHAP — ambiente de pruebas LOCAL                      │
  │                                                            │
  │  Sitio:     http://localhost:${PORTS.web}                         │
  │  Gestión:   http://localhost:${PORTS.web}/gestion.html            │
  │  Admin:     http://localhost:${PORTS.web}/admin.html              │
  │                                                            │
  │  Usuario admin:    ${DEV_USERS.admin.email.padEnd(39)} │
  │  Usuario cliente:  ${DEV_USERS.cliente.email.padEnd(39)} │
  │  Contraseña:       ${DEV_PASSWORD.padEnd(39)} │
  │                                                            │
  │  Ctrl+C para apagar. Nada de esto toca la base real.       │
  └────────────────────────────────────────────────────────────┘
`);

let cerrando = false;
async function apagar() {
  if (cerrando) return; cerrando = true;
  log('Apagando…');
  server.close(); rest.kill();
  await pg.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
rest.on('exit', code => { if (!cerrando) { console.error(`[dev] PostgREST se cerró (código ${code})`); apagar(); } });
