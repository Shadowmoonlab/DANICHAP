// dev/mock-distribuidores.mjs — Simula los sitios de los distribuidores con datos inventados y volumen real
// (para dev/prueba-robots.mjs). Se carga con node --import; lo que no es un distribuidor va al fetch real.
import { createRequire } from 'node:module';

const XLSX = createRequire(import.meta.url)('../vendor/xlsx-0.20.3.full.min.js');
const real = globalThis.fetch;
const json = (o, h = {}) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json', ...h } });
const html = (t, h = {}) => new Response(t, { status: 200, headers: { 'Content-Type': 'text/html', ...h } });
const N = { goicoechea: 70_459, prPaginas: 795, distrisuper: 25_116, fal: 1_612, dm: 32_370, delviso: 11_859, oteroGrupos: 300 };
// Cada corrida cambia algunos precios, como pasa en la realidad
const ajuste = Number(process.env.PRUEBA_VUELTA || 0);

const falXlsx = (() => {
  const filas = [['Codigo', 'Descripcion', 'Precio', 'Familia']];
  for (let i = 0; i < N.fal; i++) filas.push([`F${i}`, `FARO ${i}`, 5000 + i + ajuste, 'Faros']);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'LISTA');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
})();

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const cookie = init.headers?.Cookie ?? '';

  if (url.startsWith('https://goicoechea.com.ar')) {
    if (url.endsWith('.com.ar/')) return html('<html></html>', { 'Set-Cookie': 'PHPSESSID=s1; path=/' });
    if (url.includes('/account/log/logout')) return html('');
    if (url.includes('/account/log/login')) return json({ success: cookie.includes('PHPSESSID=s1') });
    if (url.includes('/exportExcel/8/csv')) {
      const l = ['Codigo|Descripcion|Marca|Linea|Precio Lista|Precio Neto'];
      for (let i = 0; i < N.goicoechea; i++) l.push(`G${i}|ARTICULO ${i}|MARCA${i % 7}|LINEA${i % 5}|${1000 + i + ajuste},50|${800 + i + ajuste},40`);
      return new Response(l.join('\r\n'), { status: 200 });
    }
  }

  if (url.startsWith('https://prautopartes.com.ar/api/Login')) return json({ token: 'pr' });
  if (url.startsWith('https://prautopartes.com.ar/api/Articulos/Buscar')) {
    const { pagina } = JSON.parse(init.body);
    await new Promise(ok => setTimeout(ok, 30));   // latencia del sitio
    const items = pagina > N.prPaginas ? [] : Array.from({ length: 36 }, (_, i) =>
      ({ codigo: `PR${pagina}-${i}`, descripcion: `PIEZA ${pagina}-${i}`, marca: 'M', rubro: 'R', precioLista: 100 + ajuste, precioCosto: 80 + ajuste }));
    return json({ totalPages: N.prPaginas, currentPage: pagina, items });
  }

  if (url.startsWith('https://apidistri.distrisuper.com/api/auth/login')) return json({ access_token: 'ds' });
  if (url.startsWith('https://api-lupa.uc.r.appspot.com/lupa/')) {
    if (init.headers?.Authorization !== 'Bearer ds') return new Response('no', { status: 401 });
    if (url.includes('/clients')) return json({ data: [{ general_discount: 10, BrandClientsDiscounts: [{ brand_code: '7', percentage: 20 }] }] });
    if (url.includes('getSuperRubros')) return json([{ DESCRIPCION: 'FRENOS', RUBROS: ['001'] }]);
    const q = new URL(url).searchParams;
    const lim = Number(q.get('limit')) || 10, n = Number(q.get('page'));
    const cant = Math.min(lim, Math.max(0, N.distrisuper - (n - 1) * lim));
    return json({ ok: 1, totalArticles: N.distrisuper, hasMore: n * lim < N.distrisuper, data: Array.from({ length: cant }, (_, i) => {
      const k = (n - 1) * lim + i;
      return { article_code: `A${k}`, particular_code: `D${k}`, description: `REPUESTO ${k}`, price_list: 2000 + k + ajuste,
               brand_code: String(k % 10), rubro_code: '001', active: 1, Brand: { brand_name: `B${k % 10}` } };
    }) });
  }

  if (url.startsWith('https://autopartesfal.com/mi-cuenta/')) {
    if ((init.method || 'GET') === 'GET') return html('<input type="hidden" name="woocommerce-login-nonce" value="n1">');
    return html('ok', { 'Set-Cookie': 'wordpress_logged_in_x=1; path=/' });
  }
  if (url === 'https://autopartesfal.com/') return html('<a href="/logout">Cerrar sesión</a>');
  if (url.startsWith('https://www.dropbox.com/')) return new Response(falXlsx, { status: 200 });

  // DM: login por querystring → cookie "id"; catálogo entero en un JSON doblemente codificado (26 columnas)
  if (url.startsWith('https://dmcompras.com/login')) return html('1', { 'Set-Cookie': 'id=dm1; path=/' });
  if (url.startsWith('https://dmcompras.com/getProductos')) {
    if (!cookie.includes('id=dm1')) return html('');
    const data = Array.from({ length: N.dm }, (_, i) => {
      const f = Array(26).fill('');
      Object.assign(f, { 0: `DM${i}`, 1: `REPUESTO DM ${i}`, 2: 'NAC', 3: String(3000 + i + ajuste), 4: 'RUBRO', 5: 'MARCA', 9: [], 15: String(2500 + i + ajuste) });
      return f;
    });
    return new Response(JSON.stringify(JSON.stringify({ data })), { status: 200 });
  }

  // Otero: lista-excel.php es una tabla HTML con "Precio" en dos celdas ("$" | número) y filas de grupo
  if (url.startsWith('https://www.autopartesotero.com.ar/')) {
    if (url.endsWith('/ingresar.php')) return html('<form>', { 'Set-Cookie': 'PHPSESSID=ot1; path=/' });
    if (url.endsWith('/lista.php')) return html(cookie.includes('PHPSESSID=ot1') ? '<a>Cerrar sesión</a> Mis pedidos' : 'Ingresar');
    if (url.endsWith('/lista-excel.php')) {
      let t = '<table><tr><td colspan="8">Autopartes Otero</td></tr><tr><th>Marca</th><th>Modelo</th><th>Subrubro</th>'
        + '<th>C&oacute;digo</th><th>Nombre</th><th colspan="2">Precio</th><th>Foto</th></tr>';
      for (let g = 0; g < N.oteroGrupos; g++) {
        t += `<tr><td>MARCA ${g}</td><td>MODELO ${g}</td><td>ILUMINACION</td><td></td><td></td><td></td><td></td><td></td></tr>`;
        for (let i = 0; i < 20; i++) t += `<tr><td></td><td></td><td></td><td>OT${g}-${i}</td><td>FARO ${g}-${i}</td><td>$</td><td>${(10000 + i + ajuste).toLocaleString('es-AR')},00</td><td><img src="f.jpg"></td></tr>`;
      }
      return new Response(`${t}</table>`, { status: 200, headers: { 'Content-Type': 'application/vnd.ms-excel' } });
    }
  }

  // Del Viso: el formulario EXCEL devuelve la planilla del cliente
  if (url.startsWith('https://metalurgicadelviso.com.ar/')) {
    if (url.endsWith('/admgenexel.php')) return html('<form>');
    if (url.endsWith('/exelconphp.php')) {
      const filas = [['Codigo', 'Descripcion', 'Precio']];
      for (let i = 0; i < N.delviso; i++) filas.push([`DV${i}`, `CAÑO ESCAPE ${i}`, 7000 + i + ajuste]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Lista');
      return new Response(XLSX.write(wb, { type: 'buffer', bookType: 'xls' }), { status: 200 });
    }
  }

  if (/goicoechea|distrisuper|appspot|autopartesfal|dropbox|prautopartes|dmcompras|otero|delviso/.test(url)) {
    throw new Error(`Sitio sin simular en la prueba: ${url}`);
  }
  return real(input, init);
};
