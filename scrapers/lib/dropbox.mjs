// scrapers/lib/dropbox.mjs — Links de Dropbox a descarga directa (puro y testeable).

/**
 * Links de descarga directa para un link de Dropbox. WordPress escribe los & como "&#038;": sin decodificarlos,
 * el "#" corta el link y Dropbox recibe solo ?rlkey=… → devuelve la vista previa (HTML) en vez del archivo.
 * Se prueban dl=1, raw=1 y el host de descarga directa.
 */
export function linksDeDescarga(link) {
  const limpio = link.replace(/&#0?38;|&amp;/g, '&');
  let u;
  try { u = new URL(limpio); } catch { return [limpio]; }
  if (!/dropbox\.com$/i.test(u.hostname)) return [limpio];
  const con = (host, params) => {
    const v = new URL(u);
    v.hostname = host;
    v.searchParams.delete('dl'); v.searchParams.delete('raw');
    for (const [k, val] of Object.entries(params)) v.searchParams.set(k, val);
    return v.toString();
  };
  return [...new Set([con(u.hostname, { dl: '1' }), con(u.hostname, { raw: '1' }), con('dl.dropboxusercontent.com', {})])];
}
