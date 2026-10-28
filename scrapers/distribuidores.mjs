// distribuidores.mjs — Registro único de robots de precios.
// Sumar un distribuidor = crear scrapers/<archivo>.mjs (usa correrScraper de lib/db.mjs) y agregarlo acá con activo: true.
// El workflow "Precios diarios" arma un trabajo en paralelo por cada distribuidor activo (scrapers/plan.mjs).
export const DISTRIBUIDORES = [
  { slug: 'dm',                 archivo: 'dm',                 activo: true,  nota: 'API JSON (~32.000)' },
  { slug: 'prautopartes',       archivo: 'pr',                 activo: true,  nota: 'API REST paginada' },
  { slug: 'goicoechea',         archivo: 'goicoechea',         activo: true,  nota: 'API JSON (~70.000), precio con descuento de cliente' },
  { slug: 'distrisuper',        archivo: 'distrisuper',        activo: true,  nota: 'API JSON (~25.000), descuento general y por marca' },
  { slug: 'otero',              archivo: 'otero',              activo: true,  nota: 'baja lista-excel.php' },
  { slug: 'fal',                archivo: 'fal',                activo: true,  nota: 'lista Excel de Dropbox (~1.600)' },
  { slug: 'delviso',            archivo: 'delviso',            activo: true,  nota: 'planilla de exelconphp.php (formulario EXCEL)' },
  { slug: 'distriferr',         archivo: 'distriferr',         activo: false, nota: 'el sitio rechaza usuario/clave: confirmar con Daniel' },
  { slug: 'primeraalternativa', archivo: 'primeraalternativa', activo: false, nota: 'el sitio rechaza usuario/clave: confirmar con Daniel' },
  { slug: 'tytsa',              archivo: 'tytsa',              activo: false, nota: 'login con reCAPTCHA: no se automatiza; pedir lista Excel e importarla' },
  { slug: 'cromosol',           archivo: 'cromosol',           activo: false, nota: 'no responde desde GitHub (solo http): runner en una PC del local' },
];
