-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Agregar columna imagenes (text[]) a tabla productos
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- Agregar columna para array de URLs de imágenes adicionales
alter table productos
  add column if not exists imagenes text[] default '{}';

-- Verificación:
-- select id, nombre, imagen_url, imagenes from productos limit 5;
