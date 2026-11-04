// tests/scrapers-distriferr.test.mjs — robot de Distriferr: lectura del panel y de la lista descargada, sin red
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// El robot corre al importarlo salvo con DISTRIFERR_SOLO_FUNCIONES=1; db.mjs exige estas variables al cargar (no se usan)
process.env.DISTRIFERR_SOLO_FUNCIONES = '1';
process.env.SUPABASE_URL ??= 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_KEY ??= 'sin-uso';
const { decodificar, arregloJs, articulosDePagina, filtrosDelPanel, urlsDeFiltro, leerDescarga } = await import('../scrapers/distriferr.mjs');

// Como lo manda el sitio: plantilla en UTF-8 ("Código", "¿Que…") y los textos de la base en latin1 (Ñ = byte 0xD1)
const fixture = fs.readFileSync(new URL('./distriferr-panel.fixture.html', import.meta.url), 'utf8');
const partes = fixture.split('Ñ');
const bytesDelSitio = Buffer.concat(partes.flatMap((p, i) => (i ? [Buffer.from([0xd1]), Buffer.from(p, 'utf8')] : [Buffer.from(p, 'utf8')])));

test('decodificar: UTF-8 y latin1 mezclados en la misma página', () => {
  const html = decodificar(bytesDelSitio);
  assert.ok(html.includes('ANCLAJE KIT N 1 PARA CAÑO TUBULAR JUEGO'));
  assert.ok(html.includes('¿Que estas buscando?'));
  assert.ok(!html.includes('�'));
  assert.equal(decodificar(Buffer.from('Código CAÑO', 'utf8')), 'Código CAÑO');
});

test('articulosDePagina: var results → filas con nombre, rubro, marca y precio con el descuento del cliente', () => {
  const html = decodificar(bytesDelSitio);
  const filas = articulosDePagina(html, filtrosDelPanel(html).descuentoPct);
  assert.equal(filas.length, 3);
  assert.deepEqual(filas[0], {
    codigo: '300/69', descripcion: 'ANCLAJE KIT N 1 PARA CAÑO TUBULAR JUEGO',
    marca: 'ANCLAJE Y CAÑOS D P/EQUIPAJE', rubro: 'ANCLAJES Y CAÑOS D PORTA EQUIPAJE', origen: null,
    precio_lista: 67782, precio_neto: 30501.9, imagen_url: null,
  });
  assert.equal(filas[1].descripcion, 'DEFLECTOR FIAT SIENA 97/2007 DEL O1014 ADHES');   // espacios dobles juntados
  assert.equal(filas[2].precio_neto, 61389.9);   // "Costo c/Dto.(55%)" del panel
  for (const f of filas) assert.notEqual(f.descripcion, f.codigo);
  // Comillas, ] y ; dentro de los textos no cortan el arreglo
  assert.match(arregloJs(html, 'results')[2].obs, /\[kit\]; ver$/);
  // Página sin resultados (/panel/ al entrar) y página sin la lista (otra cosa)
  assert.deepEqual(articulosDePagina('<script>var results=[];\nvar pDescuento= 55 ;</script>'), []);
  assert.throws(() => articulosDePagina('<form id="frmaction"><input name="hpassword"></form>'), /var results/);
});

test('filtrosDelPanel: rubros y marcas del buscador (select + variable JS), sin repetir, y descuento', () => {
  const f = filtrosDelPanel(decodificar(bytesDelSitio));
  assert.deepEqual(f.rubros, ['ABRAZADERAS', 'ANCLAJES Y CAÑOS D PORTA EQUIPAJE', 'DEFLECTOR DE PUERTAS/CAPOT',
    'MANGUERA  CRISTAL', 'PORTAEQUIPAJE TUBULAR']);
  assert.deepEqual(f.marcas, ['FIAT', 'FOTON', 'VOLKSWAGEN']);
  assert.equal(f.descuentoPct, 55);
  assert.equal(filtrosDelPanel('<html></html>').descuentoPct, 0);
});

test('urlsDeFiltro: links del buscador; con Ñ se prueba en UTF-8 y en latin1', () => {
  assert.deepEqual(urlsDeFiltro('r', 'DEFLECTOR DE PUERTAS/CAPOT'), ['/panel/?q=&r=DEFLECTOR%20DE%20PUERTAS%2FCAPOT&m=']);
  assert.deepEqual(urlsDeFiltro('m', 'FIAT'), ['/panel/?q=&r=&m=FIAT']);
  assert.deepEqual(urlsDeFiltro('r', 'PERFIL UÑA'), ['/panel/?q=&r=PERFIL%20U%C3%91A&m=', '/panel/?q=&r=PERFIL%20U%D1A&m=']);
});

// Recorte de la lista "DistriFerr_Hnos__catalogo_*.xls" (tabla HTML) que Daniel bajó del sitio el 03/11
const TABLA = '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><table border="1"><thead>'
  + '<tr><th colspan="4"><span>DistriFerr Hnos.</span></th></tr>'
  + '<tr><th colspan="4">Lista de Precios Oficial - Generada el: 03/11/2026 18:29</th></tr><tr><th colspan="4"></th></tr>'
  + '<tr><th>ID</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th>PRECIO ($)</th></tr></thead><tbody>'
  + [['2340', '200/72', 'ABRAZADERA 7 MM 6-12', '725,76'], ['2341', '202/72', 'ABRAZADERA 7 MM 10-16', '729,12'],
     ['2717', '300/69', 'ANCLAJE KIT N 1 PARA CAÑO TUBULAR JUEGO', '67.782,00'],
     ['1259', '127/50', 'DEFLECTOR FIAT SIENA 97/2007  DEL O1014 ADHES', '58.242,24'],
     ['2281', '430/46/J', 'TACOS CARROC FORD F100 67/73 (KIT COMPLET 6 PZAS)', '138.754,76'],
     ['2389', '857/5', 'BURLETE BAUL VW GOL TREND ADAPTABLE', '24.978,76'],
     ['1266', '2010/46', 'TOPE DE CAJA CARROCERIA GRANDE 7 X 7 X 40 CM LARGO', '31.900,00']]
    .map(c => `<tr>${c.map(v => `<td>${v}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
// Precios de lista que muestra el buscador del panel para esos códigos (vienen redondeados al peso)
const PANEL = new Map([['300/69', 67782], ['127/50', 58242], ['430/46/J', 138755], ['857/5', 24979], ['200/72', 726]]);

test('leerDescarga: la lista bajada se usa si coincide con los precios del panel', () => {
  const { filas, motivo } = leerDescarga(Buffer.from(TABLA, 'utf8'), PANEL, 55, { minimo: 5 });
  assert.equal(motivo, undefined);
  assert.equal(filas.length, 7);
  const anclaje = filas.find(f => f.codigo === '300/69');
  assert.equal(anclaje.descripcion, 'ANCLAJE KIT N 1 PARA CAÑO TUBULAR JUEGO');   // el código es CÓDIGO, no el ID
  assert.equal(anclaje.precio_lista, 67782);
  assert.equal(anclaje.precio_neto, 30501.9);
  assert.equal(filas.find(f => f.codigo === '127/50').precio_lista, 58242.24);
  for (const f of filas) assert.notEqual(f.descripcion, f.codigo);
});

test('leerDescarga: CSV con encabezado; se descarta si los precios no son los del panel o viene corta', () => {
  const csv = 'CODIGO;DESCRIPCION;PRECIO\n' + TABLA.match(/<tr><td>[\s\S]*?<\/tr>/g)
    .map(tr => [...tr.matchAll(/<td>([^<]*)<\/td>/g)].slice(1).map(m => m[1]).join(';')).join('\n');
  const latin1 = Buffer.from(csv, 'latin1');
  const ok = leerDescarga(latin1, PANEL, 55, { minimo: 5 });
  assert.equal(ok.filas.length, 7);
  assert.equal(ok.filas.find(f => f.codigo === '300/69').descripcion, 'ANCLAJE KIT N 1 PARA CAÑO TUBULAR JUEGO');
  // Precio público (+57 %) en vez del de lista: no se usa, el robot recorre el buscador
  const otroPrecio = new Map([...PANEL].map(([c, p]) => [c, Math.round(p * 0.45 * 1.57)]));
  assert.match(leerDescarga(latin1, otroPrecio, 55, { minimo: 5 }).motivo, /no coinciden/);
  assert.match(leerDescarga(latin1, PANEL, 55).motivo, /solo 7 artículos/);
  assert.match(leerDescarga(Buffer.from('<!DOCTYPE html><html><body>Ingresar</body></html>'), PANEL).motivo, /página web/);
});
