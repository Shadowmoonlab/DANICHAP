-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Agregar campo `modelo` (text) a tabla productos
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- modelo: texto libre para el/los modelos de vehículo compatibles
-- Convención: si hay más de un modelo, separarlos con " / "
-- Ejemplos:
--   "Corolla"
--   "Corolla / Yaris / Etios"
--   "Focus 2.0 / Fiesta 1.6"

alter table productos
  add column if not exists modelo text default null;

-- Índice trigram para búsqueda rápida por modelo (requiere extensión pg_trgm)
-- create extension if not exists pg_trgm;
-- create index if not exists idx_productos_modelo_trgm
--   on productos using gin (modelo gin_trgm_ops);

-- Verificación:
-- select id, nombre, marca_rep, modelo from productos limit 5;
