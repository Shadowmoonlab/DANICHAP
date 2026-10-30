// sesion.mjs — HTTP con cookies para los robots (sitios PHP / WordPress / Django que guardan la sesión en cookies).
// Sin navegador: más rápido y liviano que Puppeteer. Reintenta cada pedido ante cortes momentáneos.

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const esperar = ms => new Promise(ok => setTimeout(ok, ms));

export function crearSesion(base, { headers: fijos = {} } = {}) {
  const cookies = new Map();

  function guardarCookies(res) {
    for (const c of res.headers.getSetCookie()) {
      const [par, ...attrs] = c.split(';');
      const j = par.indexOf('=');
      if (j <= 0) continue;
      const nombre = par.slice(0, j).trim(), valor = par.slice(j + 1).trim();
      const vencida = valor === 'deleted' || attrs.some(a => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (vencida) cookies.delete(nombre); else cookies.set(nombre, valor);
    }
  }
  const conCookies = h => (cookies.size ? { ...h, Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : h);

  async function pedir(ruta, { method = 'GET', form, json, headers = {}, intentos = 3, redirect = 'follow' } = {}) {
    const url = new URL(ruta, base).toString();
    const h = { 'User-Agent': UA, Accept: '*/*', ...fijos, ...headers };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    for (let i = 1; ; i++) {
      try {
        let res = await fetch(url, { method, headers: conCookies(h), body, redirect: 'manual' });
        guardarCookies(res);
        // Sigue las redirecciones a mano: fetch descarta el Set-Cookie de los 302 (PHP suele renovar la sesión ahí)
        for (let saltos = 0; redirect === 'follow' && res.status >= 300 && res.status < 400 && res.headers.get('location') && saltos < 10; saltos++) {
          const destino = new URL(res.headers.get('location'), res.url || url).toString();
          const { 'Content-Type': _, ...sinCuerpo } = h;
          res = await fetch(destino, { headers: conCookies(sinCuerpo), redirect: 'manual' });
          guardarCookies(res);
        }
        if (res.status === 429) {
          // El sitio pide bajar el ritmo: se espera lo que indica (Retry-After, hasta 60 s) y, si insiste, se corta
          const pausa = Math.min(Number(res.headers.get('retry-after')) || 15, 60);
          const err = new Error(`${url} HTTP 429`);
          err.pausaMs = pausa * 1000;
          throw err;
        }
        if (res.status >= 500) throw new Error(`${url} HTTP ${res.status}`);
        return res;
      } catch (err) {
        if (i >= intentos) throw err;
        await esperar(err.pausaMs ?? 2000 * i);
      }
    }
  }

  return {
    pedir,
    cookie: nombre => cookies.get(nombre),
    texto: async (ruta, opc) => (await pedir(ruta, opc)).text(),
    json: async (ruta, opc) => {
      const res = await pedir(ruta, opc);
      if (!res.ok) throw new Error(`${ruta} HTTP ${res.status}`);
      return res.json();
    },
    binario: async (ruta, opc) => {
      const res = await pedir(ruta, opc);
      if (!res.ok) throw new Error(`${ruta} HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Corre `fn` sobre cada elemento con como máximo `n` a la vez (para paginar sin saturar el sitio). */
export async function enParalelo(items, n, fn) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i], i);
    }
  }));
  return resultados;
}
