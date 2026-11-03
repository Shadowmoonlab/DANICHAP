// dev/prueba-seguridad.mjs — Qué puede hacer cada tipo de usuario, contra la base LOCAL (npm run dev en otra terminal).
// Visitante anónimo y cliente registrado no deben ver ni tocar nada interno; el administrador sí.
// Uso: npm run test:seguridad
import fs from 'node:fs';
import { PORTS, TOKENS, DEV_USERS } from './config.mjs';

const API = `http://localhost:${PORTS.web}/rest/v1`;
if (!fs.existsSync(new URL('../.dev/supabase.env', import.meta.url))) {
  console.error('Primero corré "npm run dev" en otra terminal.');
  process.exit(1);
}

const USUARIOS = { anonimo: TOKENS.anon, cliente: TOKENS.cliente, admin: TOKENS.admin };
const pedir = (quien, ruta, opciones = {}) => fetch(`${API}/${ruta}`, {
  ...opciones,
  headers: { apikey: TOKENS.anon, Authorization: `Bearer ${USUARIOS[quien]}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...opciones.headers },
});
// Cuántas filas devuelve una lectura (las RLS devuelven 0 en vez de error)
async function filas(quien, tabla) {
  const r = await pedir(quien, `${tabla}?select=*&limit=5`);
  return r.ok ? (await r.json()).length : `HTTP ${r.status}`;
}

const INTERNAS = ['precios_distribuidor', 'ventas', 'venta_items', 'clientes', 'pagos_clientes', 'recepciones', 'proveedores',
  'reposicion_items', 'presupuestos', 'config_negocio', 'productos_costos', 'scraper_runs', 'lecturas_ia', 'movimientos'];

let fallas = 0;
const revisar = (ok, texto) => { console.log(`${ok ? '✅' : '❌'} ${texto}`); if (!ok) fallas++; };

for (const tabla of INTERNAS) {
  const [anon, cli, adm] = await Promise.all(['anonimo', 'cliente', 'admin'].map(q => filas(q, tabla)));
  if (typeof adm === 'string' && /404/.test(adm)) { console.log(`·  ${tabla}: no existe en esta base (se omite)`); continue; }
  revisar(!(anon > 0) && !(cli > 0), `${tabla}: anónimo ve ${anon}, cliente ve ${cli}, admin ve ${adm}`);
}

// Escalada de privilegios: un cliente no puede hacerse administrador
const escalada = await pedir('cliente', `perfiles?id=eq.${DEV_USERS.cliente.id}`, { method: 'PATCH', body: JSON.stringify({ rol: 'admin' }) });
const rolDespues = (await (await pedir('admin', `perfiles?select=rol&id=eq.${DEV_USERS.cliente.id}`)).json())[0]?.rol;
revisar(rolDespues === 'cliente', `cliente intenta ponerse rol admin → HTTP ${escalada.status}, rol queda "${rolDespues}"`);

// Escrituras internas bloqueadas para el cliente
for (const [tabla, fila] of [['ventas', { medio_pago: 'efectivo', total: 1 }], ['productos', { nombre: 'X', precio: 1 }], ['movimientos', { tipo: 'gasto', categoria: 'X', monto: 1 }]]) {
  const r = await pedir('cliente', tabla, { method: 'POST', body: JSON.stringify(fila) });
  revisar(!r.ok, `cliente intenta crear en ${tabla} → HTTP ${r.status}`);
}

// Funciones internas
for (const [fn, body] of [['libro_resumen', { p_desde: '2026-01-01', p_hasta: '2026-12-31', p_agrupar: 'month' }], ['upsert_precios', { p_rows: [], p_visto: new Date().toISOString() }],
  ['importar_lista_precios', { p_proveedor: 'dm', p_rows: [] }], ['importar_lista_lote', { p_proveedor: 'dm', p_rows: [] }],
  ['finalizar_importacion', { p_proveedor: 'dm', p_codigos: ['x'], p_reemplazar: true, p_cambios: 0 }], ['anular_venta', { p_id: 1 }]]) {
  for (const rol of ['cliente', 'anonimo']) {
    const r = await pedir(rol, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
    if (r.status === 404) { console.log(`·  ${fn}: no existe en esta base (se omite)`); break; }
    revisar(!r.ok, `${rol} llama ${fn} → HTTP ${r.status}`);
  }
}
// El buscador con patrones (v12) tampoco le muestra precios a un cliente
{
  const r = await pedir('cliente', 'rpc/buscar_precios2', { method: 'POST', body: JSON.stringify({ p_patrones: ['\mfaro'] }) });
  if (r.status !== 404) revisar(!r.ok || (await r.json()).length === 0, `cliente usa buscar_precios2 → no ve precios (HTTP ${r.status})`);
}
// El buscador tampoco responde sin sesión
{
  const r = await pedir('anonimo', 'rpc/buscar_precios', { method: 'POST', body: JSON.stringify({ p_palabras: ['faro'] }) });
  if (r.status !== 404) revisar(!r.ok || (await r.json()).length === 0, `anónimo usa el buscador → no ve precios (HTTP ${r.status})`);
}
// La búsqueda de parecidos respeta RLS: un cliente no ve ningún precio de proveedor
{
  const r = await pedir('cliente', 'rpc/buscar_parecidos', { method: 'POST', body: JSON.stringify({ p_q: 'paragolpe', p_limite: 5 }) });
  if (r.status === 404) console.log('·  buscar_parecidos: no existe en esta base (se omite)');
  else revisar(!r.ok || (await r.json()).length === 0, `cliente busca parecidos → no ve precios (HTTP ${r.status})`);
}
// El buscador rápido (security definer) también: un cliente no ve precios de proveedores
{
  const r = await pedir('cliente', 'rpc/buscar_precios', { method: 'POST', body: JSON.stringify({ p_palabras: ['faro'], p_codigo: 'TR-07' }) });
  if (r.status === 404) console.log('·  buscar_precios: no existe en esta base (se omite)');
  else revisar(!r.ok || (await r.json()).length === 0, `cliente usa el buscador → no ve precios (HTTP ${r.status})`);
}

// Lo público sigue andando: catálogo para todos, perfil propio para el cliente
revisar((await filas('anonimo', 'productos')) > 0, 'anónimo ve el catálogo de productos');
const propio = await (await pedir('cliente', `perfiles?select=rol&id=eq.${DEV_USERS.cliente.id}`)).json();
revisar(propio.length === 1, 'cliente lee su propio perfil');
revisar((await filas('cliente', 'perfiles')) === 1, 'cliente no ve los perfiles de otros');

console.log(fallas ? `\n❌ ${fallas} problemas de seguridad` : '\n✅ Permisos correctos');
process.exit(fallas ? 1 : 0);
