// dev/server.mjs — Servidor web LOCAL: archivos del sitio + API (proxy a PostgREST) + storage simulado
// Inyecta /__dev/config.js en cada HTML para que supabase.js apunte al ambiente local.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT, STORAGE_DIR, PORTS, TOKENS, DEV_USERS, DEV_PASSWORD } from './config.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2',
};
const PRIVADO = /^\/(\.dev|\.git|\.github|\.claude|\.agents|\.vscode|node_modules|dev|scrapers|supabase|tests|exploracion)(\/|$)|\/\.env/i;

const devConfig = `// Generado por dev/server.mjs — SOLO ambiente local de pruebas
window.__DANICHAP_DEV__ = ${JSON.stringify({
  url: `http://localhost:${PORTS.web}`,
  anonKey: TOKENS.anon,
  password: DEV_PASSWORD,
  users: {
    admin:   { ...DEV_USERS.admin,   token: TOKENS.admin },
    cliente: { ...DEV_USERS.cliente, token: TOKENS.cliente },
  },
}, null, 2)};
`;

function proxyPostgrest(req, res) {
  const destino = req.url.replace(/^\/rest\/v1/, '') || '/';
  const headers = { ...req.headers, host: `127.0.0.1:${PORTS.postgrest}` };
  const up = http.request({ host: '127.0.0.1', port: PORTS.postgrest, path: destino, method: req.method, headers }, r => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => json(res, 502, { message: 'PostgREST no responde. ¿Está corriendo npm run dev?' }));
  req.pipe(up);
}

async function storage(req, res, url) {
  // Público:  GET  /storage/v1/object/public/<bucket>/<ruta>
  // Subida:   POST /storage/v1/object/<bucket>/<ruta>
  const pub = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (pub && req.method === 'GET') return servirArchivo(res, path.join(STORAGE_DIR, pub[1], decodeURIComponent(pub[2])));
  const sub = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (sub && (req.method === 'POST' || req.method === 'PUT')) {
    const destino = path.join(STORAGE_DIR, sub[1], decodeURIComponent(sub[2]));
    if (!destino.startsWith(STORAGE_DIR)) return json(res, 400, { message: 'ruta inválida' });
    await fsp.mkdir(path.dirname(destino), { recursive: true });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await fsp.writeFile(destino, Buffer.concat(chunks));
    return json(res, 200, { Key: `${sub[1]}/${sub[2]}`, Id: sub[2] });
  }
  if (req.method === 'DELETE') return json(res, 200, []);
  return json(res, 404, { message: 'storage local: ruta no soportada' });
}

async function servirArchivo(res, archivo, inyectar = false) {
  try {
    const st = await fsp.stat(archivo);
    if (st.isDirectory()) return servirArchivo(res, path.join(archivo, 'index.html'), true);
    const ext = path.extname(archivo).toLowerCase();
    res.setHeader('Cache-Control', 'no-store');
    if (ext === '.html') {
      let html = await fsp.readFile(archivo, 'utf8');
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n<script src="/__dev/config.js"></script>`);
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — no existe');
  }
}

// Equivalente local de la Edge Function supabase/functions/leer-factura (mismo módulo compartido)
async function leerFacturaLocal(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  if (req.headers.authorization !== `Bearer ${TOKENS.admin}`) {
    return json(res, 403, { error: 'Solo el administrador puede leer comprobantes' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(res, 501, { error: 'La lectura automática no está configurada', codigo: 'ia_no_configurada' });
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const { leerFactura, ErrorLectura } = await import('../supabase/functions/_shared/leer-factura.js');
    try {
      const resultado = await leerFactura(new Anthropic(), JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return json(res, 200, resultado);
    } catch (e) {
      if (e instanceof ErrorLectura) return json(res, e.codigo === 'entrada' ? 400 : 422, { error: e.message, codigo: e.codigo });
      if (e instanceof Anthropic.RateLimitError) return json(res, 429, { error: 'Muchas lecturas seguidas, probá en un minuto', codigo: 'limite' });
      if (e instanceof Anthropic.APIError) return json(res, 502, { error: `Error del servicio de lectura (${e.status})`, codigo: 'api' });
      throw e;
    }
  } catch (e) {
    console.error('[leer-factura]', e);
    return json(res, 500, { error: 'Error inesperado leyendo el comprobante', codigo: 'interno' });
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function iniciarServidor() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/__dev/config.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      return res.end(devConfig);
    }
    if (url.pathname.startsWith('/rest/v1')) return proxyPostgrest(req, res);
    if (url.pathname.startsWith('/storage/v1')) return storage(req, res, url);
    if (url.pathname.startsWith('/auth/v1')) return json(res, 501, { message: 'En local el login lo simula supabase.js' });
    if (url.pathname === '/functions/v1/leer-factura') return leerFacturaLocal(req, res);

    const ruta = decodeURIComponent(url.pathname);
    if (PRIVADO.test(ruta)) return json(res, 404, { message: 'no disponible' });
    const archivo = path.join(ROOT, ruta === '/' ? 'index.html' : ruta);
    if (!archivo.startsWith(ROOT)) return json(res, 400, { message: 'ruta inválida' });
    return servirArchivo(res, archivo);
  });
  return new Promise(ok => server.listen(PORTS.web, () => ok(server)));
}
