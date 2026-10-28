// sesion.mjs — HTTP con cookies para los robots (sitios PHP / WordPress / Django que guardan la sesión en cookies).
// Sin navegador: más rápido y liviano que Puppeteer. Reintenta cada pedido ante cortes momentáneos.

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const esperar = ms => new Promise(ok => setTimeout(ok, ms));

export function crearSesion(base, { headers: fijos = {} } = {}) {
  const cookies = new Map();

  async function pedir(ruta, { method = 'GET', form, json, headers = {}, intentos = 3, redirect = 'follow' } = {}) {
    const url = new URL(ruta, base).toString();
    const h = { 'User-Agent': UA, Accept: '*/*', ...fijos, ...headers };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    for (let i = 1; ; i++) {
      try {
        if (cookies.size) h.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
        const res = await fetch(url, { method, headers: h, body, redirect });
        for (const c of res.headers.getSetCookie()) {
          const [par] = c.split(';');
          const j = par.indexOf('=');
          if (j > 0) cookies.set(par.slice(0, j).trim(), par.slice(j + 1).trim());
        }
        if (res.status >= 500 || res.status === 429) throw new Error(`${url} HTTP ${res.status}`);
        return res;
      } catch (err) {
        if (i >= intentos) throw err;
        await esperar(2000 * i);
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
