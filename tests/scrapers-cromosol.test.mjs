// tests/scrapers-cromosol.test.mjs — robot de Cromosol: lectura de /api/products, una fila por código, nombre y precio, sin red
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// El robot corre al importarlo salvo con CROMOSOL_SOLO_FUNCIONES=1; db.mjs exige estas variables al cargar (no se usan)
process.env.CROMOSOL_SOLO_FUNCIONES = '1';
process.env.SUPABASE_URL ??= 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_KEY ??= 'sin-uso';
const { totalDe, preciosDe, vehiculoDe, armarNombre, agruparHits, filasDe, recorrerCatalogo, controlar } = await import('../scrapers/cromosol.mjs');

// Recorte de GET /api/products?page=0&size=36&sort=codeSort,asc (13 de los 36 hits, sin links firmados ni datos del cliente)
const pagina = JSON.parse(fs.readFileSync(new URL('./cromosol-productos.fixture.json', import.meta.url), 'utf8'));
const filas = filasDe(agruparHits(pagina.hits));
const fila = codigo => filas.find(f => f.codigo === codigo);

test('fixture: sin links firmados ni datos del cliente', () => {
  const crudo = JSON.stringify(pagina);
  assert.doesNotMatch(crudo, /amazonaws|X-Amz|Signature|imagePreSigned|OCULTO|segment"/i);
});

test('agruparHits + filasDe: una fila por código (las aplicaciones repetidas se juntan)', () => {
  assert.equal(totalDe(pagina), 187236);
  assert.equal(totalDe({ total: { value: 12 } }), 12);
  assert.equal(totalDe({}), null);
  assert.equal(pagina.hits.length, 13);
  assert.deepEqual(filas.map(f => f.codigo),
    ['000010000', '00003000D', '00003000I', '00005000D', '00014000D', '000150000', '000200000', '000350000']);
  assert.equal(new Set(filas.map(f => f.codigo)).size, filas.length);
  // Se puede ir sumando página por página sobre el mismo mapa
  const mapa = agruparHits(pagina.hits.slice(0, 2));
  agruparHits(pagina.hits.slice(2), mapa);
  assert.equal(mapa.size, 8);
  assert.equal(mapa.get('000010000').apps.length, 3);
  // Hits sin código no cuentan
  assert.equal(agruparHits([{ _source: { code: '  ' } }, null]).size, 0);
});

test('filasDe: rubro = line, marca = providerBrand, sin fotos firmadas', () => {
  assert.deepEqual(fila('00005000D'), {
    codigo: '00005000D',
    descripcion: 'Casco de optica De plastico Acompañante Delantero Ford Falcon VI 82/88, Falcon V 78/81, Falcon VII 89/91',
    marca: 'GALLO', rubro: 'Casco de optica', origen: null,
    precio_lista: 3855.27, precio_neto: 3855.27, imagen_url: null,
  });
  assert.equal(fila('000010000').marca, 'IND.ARG.');
});

test('armarNombre: rubro + adicional + lado/posición + vehículos distintos por marca', () => {
  assert.equal(fila('000010000').descripcion,
    'Casco de optica Base Delantero Dodge P.UP D-100 Sweptline 56/61, P.UP D-100 61/65, P.UP D-200 Slant Six 67/79');
  assert.equal(fila('00005000D').descripcion,
    'Casco de optica De plastico Acompañante Delantero Ford Falcon VI 82/88, Falcon V 78/81, Falcon VII 89/91');
  assert.equal(fila('00003000D').descripcion, 'Reten de optica Acompañante Delantero Fiat Super Europa 83/91, 128 71/81');
  assert.equal(fila('000200000').descripcion, 'Casco de optica Delantero Dodge 1500 71/77');   // sin adicional ni lado
  assert.equal(fila('000150000').descripcion, 'Casco de optica Completo Delantero IKA Estanciera 57/67');
  assert.equal(fila('000350000').descripcion, 'Brazo de espejo Lateral Universal Livianos 50/20');   // no repite "Universal"
  for (const f of filas) {
    assert.ok(f.descripcion.length > f.codigo.length);
    assert.notEqual(f.descripcion, f.codigo);
  }
  // version sin el modelo adentro: se escriben los dos
  assert.equal(vehiculoDe({ model: 'Gol', version: '1.6 99/05' }), 'Gol 1.6 99/05');
  assert.equal(vehiculoDe({ model: 'Gol', version: 'Gol Trend 08/12' }), 'Gol Trend 08/12');
  assert.equal(vehiculoDe({ model: 'Gol', version: '0' }), 'Gol');
});

test('armarNombre: varias marcas, tope de ~200 caracteres con "y N más", y nunca solo el código', () => {
  const app = (marcaVehiculo, vehiculo) => ({ rubro: 'Bisagra de capot', adicional: '', lado: '', posicion: '', marcaVehiculo, vehiculo, descripcion: '' });
  assert.equal(armarNombre([app('Ford', 'F-100 78/81'), app('Chevrolet', 'C-10 74/78'), app('Ford', 'F-100 78/81')]),
    'Bisagra de capot Ford F-100 78/81; Chevrolet C-10 74/78');
  const muchas = Array.from({ length: 40 }, (_, i) => app(i % 2 ? 'Fiat' : 'Renault', `Modelo largo número ${i} 90/99`));
  const nombre = armarNombre(muchas);
  assert.ok(nombre.length <= 200, `${nombre.length} caracteres`);
  assert.match(nombre, /^Bisagra de capot Renault Modelo largo número 0 90\/99, .* y \d+ más$/);
  const incluidos = (nombre.match(/Modelo largo/g) ?? []).length;
  assert.equal(Number(nombre.match(/y (\d+) más$/)[1]), 40 - incluidos);
  // Sin rubro: la descripción del sitio; sin nada (o solo el código): vacío para que correrScraper lo marque
  assert.equal(armarNombre([{ ...app('', ''), rubro: '', descripcion: 'Casco de optica 128 71/81' }]), 'Casco de optica 128 71/81');
  assert.equal(armarNombre([{ ...app('', ''), rubro: '', descripcion: '' }], 'X1'), '');
  assert.equal(armarNombre([{ ...app('', ''), rubro: '', descripcion: 'X1' }], 'X1'), '');
});

test('preciosDe: neto = priceNet (el "Precio Neto" de la web), no priceLists["51"] ni el precio de venta', () => {
  const f = fila('00014000D');
  assert.equal(f.precio_neto, 23352.03);
  assert.equal(f.precio_lista, 23352.03);
  const s = pagina.hits.find(h => h._source.code === '00014000D')._source;
  assert.equal(JSON.parse(s.priceLists)['51'], '28706.08');   // la otra lista existe pero no se usa
  assert.notEqual(f.precio_neto, 28706.08);
  assert.notEqual(f.precio_neto, 35028.04);   // formatClientFinalPrice = neto × 1,5 (rentabilidad del cliente)
  assert.equal(fila('000010000').precio_neto, 7393.55);
  // Sin priceNet numérico se lee el texto formateado; 0 o vacío = sin precio
  assert.deepEqual(preciosDe({ priceNet: '', formatPriceNet: '$7.393,55', priceListOne: '7763.23' }), { precio_lista: 7763.23, precio_neto: 7393.55 });
  assert.deepEqual(preciosDe({ priceNet: '0', priceListOne: null }), { precio_lista: null, precio_neto: null });
  assert.deepEqual(preciosDe({ priceNet: '6803.5' }), { precio_lista: 6803.5, precio_neto: 6803.5 });
});

// Servidor falso de /api/products: `total` aplicaciones, `tope` = size máximo que respeta, `vaciasDesde` = corta ahí
function servidorFalso({ total, tope = Infinity, falla = new Set(), vaciasDesde = Infinity, rechaza = new Set() }) {
  const pedidos = [];
  const fallos = new Map();
  const pedir = async (page, size) => {
    pedidos.push([page, size]);
    if (rechaza.has(size)) throw new Error(`/api/products?page=${page}&size=${size} HTTP 400`);
    const clave = `${page}/${size}`;
    if (falla.has(clave) && !fallos.get(clave)) { fallos.set(clave, true); throw new Error('Unexpected token <'); }
    const real = Math.min(size, tope);
    const desde = page * real;
    if (desde >= vaciasDesde) return { total, hits: [] };
    const hasta = Math.min(desde + real, total);
    return { total, hits: Array.from({ length: Math.max(0, hasta - desde) }, (_, i) => ({ _source: { code: `C${Math.floor((desde + i) / 2)}` } })) };
  };
  return { pedir, pedidos };
}
const sinLog = () => {};

test('recorrerCatalogo: usa el size grande si el servidor lo respeta y lee todas las páginas', async () => {
  const srv = servidorFalso({ total: 1234 });
  const mapa = new Map();
  const r = await recorrerCatalogo(srv.pedir, { alHits: h => agruparHits(h, mapa), log: sinLog, esperaMs: 0 });
  assert.deepEqual({ size: r.size, paginas: r.paginas, leidos: r.leidos, corte: r.corte }, { size: 500, paginas: 3, leidos: 1234, corte: null });
  assert.equal(mapa.size, 617);
  assert.deepEqual(srv.pedidos.map(p => p[0]).sort(), [0, 1, 2]);
});

test('recorrerCatalogo: si el servidor recorta el size prueba su tope, y si da error baja hasta 36', async () => {
  const recorta = servidorFalso({ total: 1000, tope: 100 });
  const r = await recorrerCatalogo(recorta.pedir, { log: sinLog, esperaMs: 0 });
  assert.equal(r.size, 100);
  assert.equal(r.leidos, 1000);
  assert.deepEqual(recorta.pedidos.slice(0, 2), [[0, 500], [0, 100]]);

  const solo36 = servidorFalso({ total: 100, rechaza: new Set([500, 200, 108]) });
  const r36 = await recorrerCatalogo(solo36.pedir, { log: sinLog, esperaMs: 0, intentos: 1 });
  assert.equal(r36.size, 36);
  assert.equal(r36.paginas, 3);
  assert.equal(r36.leidos, 100);
});

test('recorrerCatalogo: reintenta una página que falla y corta cuando vienen vacías', async () => {
  const srv = servidorFalso({ total: 2000, falla: new Set(['2/500']) });
  const r = await recorrerCatalogo(srv.pedir, { log: sinLog, esperaMs: 0 });
  assert.equal(r.leidos, 2000);
  assert.equal(srv.pedidos.filter(([p]) => p === 2).length, 2);

  const corta = servidorFalso({ total: 5000, vaciasDesde: 1500 });
  const rc = await recorrerCatalogo(corta.pedir, { log: sinLog, esperaMs: 0, simultaneos: 1 });
  assert.equal(rc.corte, 3);
  assert.equal(rc.leidos, 1500);
  assert.ok(corta.pedidos.every(([p]) => p <= 3), 'no sigue pidiendo después de la vacía');
  assert.throws(() => controlar({ ...rc, codigos: 750 }), /lectura cortada: 1500 de 5000/);

  // Un error definitivo (sesión cortada, 401/403/429) no se reintenta
  let n = 0;
  await assert.rejects(recorrerCatalogo(async () => { n++; throw new Error('/api/products HTTP 403'); }, { log: sinLog, esperaMs: 0 }), /HTTP 403/);
  assert.equal(n, 1);
});

test('controlar: mínimo de códigos únicos según el total de aplicaciones', () => {
  assert.doesNotThrow(() => controlar({ total: 187236, leidos: 187236, codigos: 130_000 }));
  assert.doesNotThrow(() => controlar({ total: 187236, leidos: 184000, codigos: 30_000 }));
  assert.throws(() => controlar({ total: 187236, leidos: 187236, codigos: 25_000 }), /mínimo 28085/);
  assert.throws(() => controlar({ total: 50_000, leidos: 50_000, codigos: 15_000 }), /mínimo 20000/);
  assert.throws(() => controlar({ total: 187236, leidos: 100_000, codigos: 90_000 }), /lectura cortada/);
});

const { recorrerPorTramos, opcionesDe, LIMITE_VENTANA } = await import('../scrapers/cromosol.mjs');

test('opcionesDe: lee los valores de un select y decodifica entidades', () => {
  const html = '<select name="line"><option value="">Todas</option><option value="Casco de optica">x</option>'
    + '<option value="Bomba de nafta &amp; filtro">y</option><option value="Ca&ntilde;o">z</option></select>';
  assert.deepEqual(opcionesDe(html, 'line'), ['Casco de optica', 'Bomba de nafta & filtro', 'Caño']);
  assert.deepEqual(opcionesDe(html, 'vehicleBrand'), []);
});

// Servidor falso con el tope de 10.000 por búsqueda: A 8.000, B 12.000 (Ford 7.000 + Fiat 5.000), C 5.000
function servidorConTope() {
  const items = [];
  const sumar = (line, marca, n) => { for (let i = 0; i < n; i++) items.push({ _source: { code: `${line}${marca}${i}`, line, vehicleBrand: marca, priceNet: '10' } }); };
  sumar('A', 'Ford', 8000); sumar('B', 'Ford', 7000); sumar('B', 'Fiat', 5000); sumar('C', 'Fiat', 5000);
  const pedidos = [];
  const pedir = async (page, size, filtro) => {
    pedidos.push(filtro);
    const p = new URLSearchParams(filtro);
    const sel = items.filter(h => (!p.get('filters[line]') || h._source.line === p.get('filters[line]'))
      && (!p.get('filters[vehicleBrand]') || h._source.vehicleBrand === p.get('filters[vehicleBrand]')));
    if ((page + 1) * size > LIMITE_VENTANA) throw new Error('HTTP 500');
    return { total: sel.length, hits: sel.slice(page * size, (page + 1) * size) };
  };
  return { pedir, pedidos };
}

test('recorrerPorTramos: parte por línea, y la línea que pasa el tope por marca, sin perder ni repetir', async () => {
  const srv = servidorConTope();
  const mapa = new Map();
  const r = await recorrerPorTramos(srv.pedir, { lineas: ['A', 'B', 'C'], marcas: ['Ford', 'Fiat', 'Chevrolet'],
    alHits: h => agruparHits(h, mapa), log: sinLog, esperaMs: 0 });
  assert.equal(r.total, 25000);
  assert.equal(r.leidos, 25000);
  assert.equal(mapa.size, 25000);
  assert.deepEqual(r.recortados, []);
  assert.ok(srv.pedidos.some(f => f.includes('vehicleBrand')), 'B se partió por marca');
});

test('recorrerPorTramos: si el filtro por línea no filtra, corta con error claro', async () => {
  const srv = servidorConTope();
  const ignora = (page, size) => srv.pedir(page, size, '');
  await assert.rejects(recorrerPorTramos(ignora, { lineas: ['A', 'B'], marcas: [], log: sinLog, esperaMs: 0 }), /no filtra/);
});

test('recorrerPorTramos: si todo entra en una búsqueda la lee de una vez', async () => {
  const items = Array.from({ length: 900 }, (_, i) => ({ _source: { code: `X${i}`, priceNet: '1' } }));
  const pedir = async (page, size) => ({ total: items.length, hits: items.slice(page * size, (page + 1) * size) });
  const r = await recorrerPorTramos(pedir, { log: sinLog, esperaMs: 0 });
  assert.equal(r.leidos, 900);
  assert.equal(r.tramos, 1);
});
