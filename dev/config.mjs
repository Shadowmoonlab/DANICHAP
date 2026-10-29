// dev/config.mjs — Configuración del ambiente de pruebas LOCAL (nada de esto se usa en producción)
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEV_DIR = path.join(ROOT, '.dev');               // datos locales (gitignored)
export const PG_DATA = path.join(DEV_DIR, 'pgdata');
export const STORAGE_DIR = path.join(DEV_DIR, 'storage');
export const BIN_DIR = path.join(DEV_DIR, 'bin');

export const PORTS = { web: 8080, postgres: 54322, postgrest: 54323 };

export const POSTGREST_VERSION = 'v12.2.12';                  // misma línea que usa Supabase
export const POSTGREST_URL =
  `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-windows-x86-64.zip`;

// Credenciales SOLO del ambiente local de pruebas
export const PG_SUPERUSER = { user: 'postgres', password: 'postgres-dev' };
export const PG_AUTHENTICATOR_PASSWORD = 'authenticator-dev';
export const JWT_SECRET = 'danichap-entorno-local-de-pruebas-no-usar-en-produccion';

// Usuarios de prueba (se crean en dev/seed.sql). Contraseña común para ambos: DEV_PASSWORD
export const DEV_PASSWORD = 'danichap-dev';
export const DEV_USERS = {
  admin:   { id: '00000000-0000-4000-8000-000000000001', email: 'admin@danichap.test' },
  cliente: { id: '00000000-0000-4000-8000-000000000002', email: 'cliente@danichap.test' },
};

// Migraciones en orden: los mismos SQL de docs/ que se corren en Supabase
export const MIGRACIONES = [
  'dev/supabase-shim.sql',
  'docs/schema.sql',
  'docs/fix-db-indexes-trigger.sql',
  'docs/fix-rls-perfiles.sql',
  'docs/fix-rls-completo.sql',
  'docs/add-imagenes-array.sql',
  'docs/add-modelo.sql',
  'docs/add-stock-cantidad.sql',
  'docs/add-precios-distribuidor.sql',
  'docs/add-gestion.sql',
  'docs/add-gestion-v2.sql',
  'docs/ajustes-2026-10.sql',
  'docs/robots-conservar-datos.sql',
  'docs/robots-sincronizar.sql',
  'docs/add-libro-diario.sql',
  'docs/seguridad-perfiles.sql',
];
export const SEED = 'dev/seed.sql';

/* ── JWT HS256 (igual formato que Supabase) ────────────────────────────── */
const b64url = buf => Buffer.from(buf).toString('base64url');
export function firmarJWT(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: 'danichap-dev', iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, ...payload }));
  const firma = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${firma}`;
}

export const TOKENS = {
  anon:    firmarJWT({ role: 'anon' }),
  service: firmarJWT({ role: 'service_role' }),
  admin:   firmarJWT({ role: 'authenticated', sub: DEV_USERS.admin.id, email: DEV_USERS.admin.email }),
  cliente: firmarJWT({ role: 'authenticated', sub: DEV_USERS.cliente.id, email: DEV_USERS.cliente.email }),
};
