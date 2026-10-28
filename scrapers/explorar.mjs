// explorar.mjs — Robot explorador (se corre UNA vez por sitio, a mano, desde GitHub Actions)
// Entra con las credenciales de los secrets, recorre las páginas internas y guarda
// el HTML + todas las respuestas JSON que carga el sitio en exploracion/<sitio>/.
// Ese material sirve para escribir el scraper definitivo de cada distribuidor.
//
// Uso: node scrapers/explorar.mjs <sitio>      (sitios: ver SITIOS)
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const SITIOS = {
  delviso: {
    inicio: 'https://metalurgicadelviso.com.ar/index.php',
    user: 'DELVISO_USER', pass: 'DELVISO_PASSWORD',
  },
  cromosol: {
    inicio: 'http://slaweb.cromosol.com/login',   // solo responde por http (https se cuelga)
    user: 'CROMOSOL_USER', pass: 'CROMOSOL_PASSWORD',
  },
  otero: {
    inicio: 'https://www.autopartesotero.com.ar/ingresar.php',
    user: 'OTERO_USER', pass: 'OTERO_PASSWORD',
  },
  prautopartes: {
    inicio: 'https://prautopartes.com.ar/',
    user: 'PR_USER', pass: 'PR_PASSWORD',
  },
  goicoechea: {
    inicio: 'https://goicoechea.com.ar/',
    user: 'GOICOECHEA_USER', pass: 'GOICOECHEA_PASSWORD',
  },
  tytsa: {   // Laravel con reCAPTCHA v3: puede bloquear al robot
    inicio: 'https://www.tytsa.com.ar/',
    user: 'TYTSA_USER', pass: 'TYTSA_PASSWORD',
  },
  primeraalternativa: {
    inicio: 'https://www.laprimeraalternativa.com.ar/login/',
    user: 'PRIMERAALT_USER', pass: 'PRIMERAALT_PASSWORD',
  },
  distrisuper: {   // Next.js; API en /api/auth/login
    inicio: 'https://lupa.distrisuper.com/',
    user: 'DISTRISUPER_USER', pass: 'DISTRISUPER_PASSWORD',
  },
  distriferr: {    // la clave viaja en MD5 (campo hpassword)
    inicio: 'https://clientes.distriferr.com.ar/ingreso/',
    user: 'DISTRIFERR_USER', pass: 'DISTRIFERR_PASSWORD',
  },
  fal: {           // WordPress + WooCommerce
    inicio: 'https://autopartesfal.com/mi-cuenta/',
    user: 'FAL_USER', pass: 'FAL_PASSWORD',
  },
};

const MAX_PAGINAS = 25;
const sitio = process.argv[2];
const cfg = SITIOS[sitio];
if (!cfg) { console.error(`Sitio desconocido. Opciones: ${Object.keys(SITIOS).join(', ')}`); process.exit(1); }

const usuario = process.env[cfg.user] || '';
const clave = process.env[cfg.pass] || '';
const salida = path.join('exploracion', sitio);
await fs.mkdir(salida, { recursive: true });

// Nunca guardar las credenciales en lo que se sube como artifact
const tapar = txt => [usuario, clave].filter(v => v && v.length > 2)
  .reduce((t, v) => t.split(v).join('[OCULTO]'), txt);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });

let nJson = 0;
const indice = [];
const resumen = { sitio, inicio: cfg.inicio, login: 'no intentado', paginas: 0 };
page.on('response', async res => {
  const tipo = res.headers()['content-type'] || '';
  const tipoReq = res.request().resourceType();
  if (!['xhr', 'fetch', 'document'].includes(tipoReq)) return;
  if (!tipo.includes('json') && tipoReq === 'document') return;
  try {
    const cuerpo = await res.text();
    if (!cuerpo || cuerpo.length < 2) return;
    const archivo = `json-${String(++nJson).padStart(3, '0')}.txt`;
    await fs.writeFile(path.join(salida, archivo), tapar(cuerpo.slice(0, 2_000_000)));
    indice.push({ archivo, metodo: res.request().method(), url: tapar(res.url()), status: res.status(),
                  postData: tapar(res.request().postData() || '').slice(0, 500), bytes: cuerpo.length });
  } catch { /* respuestas sin cuerpo (redirects) */ }
});

async function guardarPagina(nombre) {
  const html = await page.content();
  await fs.writeFile(path.join(salida, `${nombre}.html`), tapar(html));
  await page.screenshot({ path: path.join(salida, `${nombre}.png`), fullPage: false });
}

async function login() {
  await page.goto(cfg.inicio, { waitUntil: 'networkidle2', timeout: 60_000 });
  await guardarPagina('00-inicio');

  // Algunos sitios tienen el formulario duplicado y oculto (versión móvil): usar el visible
  const passVisible = () => page.evaluateHandle(() =>
    [...document.querySelectorAll('input[type=password]')].find(i => i.offsetParent !== null) || null);

  // SPA / modal: si no hay contraseña a la vista, tocar el botón de ingreso
  for (const texto of ['Login', 'Ingresar', 'Iniciar sesión', 'Iniciar Sesión', 'Acceder', 'Mi cuenta', 'Clientes']) {
    if ((await passVisible()).asElement()) break;
    const boton = await page.$(`::-p-text(${texto})`);
    if (boton) {
      await boton.click().catch(() => {});
      await new Promise(ok => setTimeout(ok, 1500));
    }
  }

  const pass = (await passVisible()).asElement();
  if (!pass) { console.log('No encontré campo de contraseña en la página de inicio'); resumen.login = 'sin formulario'; return; }

  // Campo de usuario: el input de texto/email visible más cercano antes del password
  const user = await page.evaluateHandle(p => {
    const inputs = [...(p.form || document).querySelectorAll('input[type=text],input[type=email],input:not([type])')]
      .filter(i => i.offsetParent !== null);
    return inputs.filter(i => i.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || null;
  }, pass);
  if (usuario && user.asElement()) await user.asElement().type(usuario, { delay: 30 });
  await pass.type(clave, { delay: 30 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {}),
    pass.press('Enter'),
  ]);
  await new Promise(ok => setTimeout(ok, 3000));

  // Formularios que se envían por JavaScript (onsubmit="return false"): apretar el botón
  if ((await passVisible()).asElement()) {
    const enviar = await page.evaluateHandle(() => {
      const visibles = [...document.querySelectorAll('button, input[type=submit], a')].filter(b => b.offsetParent !== null);
      return visibles.find(b => b.type === 'submit') ||
             visibles.find(b => /ingresar|entrar|iniciar|acceder|login/i.test(b.textContent || b.value || '')) || null;
    });
    if (enviar.asElement()) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {}),
        enviar.asElement().click().catch(() => {}),
      ]);
      await new Promise(ok => setTimeout(ok, 3000));
    }
  }
  resumen.login = (await passVisible()).asElement() ? 'probablemente falló (sigue el formulario)' : 'ok';
  resumen.url_despues_login = tapar(page.url());
  await guardarPagina('01-despues-login');
}

async function recorrer() {
  const origen = new URL(page.url()).origin;
  const vistos = new Set([page.url()]);
  const cola = await enlaces(origen);
  let n = 2;
  while (cola.length && n < MAX_PAGINAS + 2) {
    const url = cola.shift();
    if (vistos.has(url)) continue;
    vistos.add(url);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
      await guardarPagina(String(n++).padStart(2, '0') + '-' + new URL(url).pathname.replace(/[^a-z0-9]+/gi, '_').slice(0, 40));
      resumen.paginas++;
      for (const u of await enlaces(origen)) if (!vistos.has(u)) cola.push(u);
    } catch (e) { console.log(`No pude abrir ${url}: ${e.message}`); }
  }
}

async function enlaces(origen) {
  const hrefs = await page.$$eval('a[href]', as => as.map(a => a.href));
  return [...new Set(hrefs)]
    .filter(h => h.startsWith(origen) && !/logout|salir|cerrar|\.pdf$|\.jpg$|\.png$|mailto:|whatsapp/i.test(h))
    .map(h => h.split('#')[0]);
}

try {
  await login();
  await recorrer();
} finally {
  await fs.writeFile(path.join(salida, 'indice.json'), JSON.stringify(indice, null, 2));
  await fs.writeFile(path.join(salida, 'resumen.json'), JSON.stringify({ ...resumen, respuestas_json: indice.length }, null, 2));
  await browser.close();
  console.log(`Listo: ${indice.length} respuestas JSON guardadas en ${salida}`);
}
