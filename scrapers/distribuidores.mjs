// distribuidores.mjs — Registro único de robots de precios.
// Sumar un distribuidor = crear scrapers/<archivo>.mjs (usa correrScraper de lib/db.mjs) y agregarlo acá con activo: true.
// El workflow "Precios diarios" arma un trabajo en paralelo por cada distribuidor activo (scrapers/plan.mjs).
export const DISTRIBUIDORES = [
  { slug: 'dm',                 archivo: 'dm',                 activo: true,  nota: 'API JSON, ~32.000 artículos' },
  { slug: 'prautopartes',       archivo: 'pr',                 activo: true,  nota: 'API REST paginada' },
  { slug: 'distrisuper',        archivo: 'distrisuper',        activo: false, nota: 'Next.js + /api/auth/login' },
  { slug: 'goicoechea',         archivo: 'goicoechea',         activo: false, nota: 'PHP + jQuery' },
  { slug: 'otero',              archivo: 'otero',              activo: false, nota: 'PHP, form usuario/password' },
  { slug: 'delviso',            archivo: 'delviso',            activo: false, nota: 'PHP clásico' },
  { slug: 'distriferr',         archivo: 'distriferr',         activo: false, nota: 'clave en MD5 (hpassword)' },
  { slug: 'fal',                archivo: 'fal',                activo: false, nota: 'WordPress / WooCommerce' },
  { slug: 'primeraalternativa', archivo: 'primeraalternativa', activo: false, nota: 'tiene /lista/' },
  { slug: 'tytsa',              archivo: 'tytsa',              activo: false, nota: 'reCAPTCHA: puede no ser automatizable' },
  { slug: 'cromosol',           archivo: 'cromosol',           activo: false, nota: 'solo http; no responde desde GitHub' },
];
