-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Agregar campo stock_cantidad (integer) a tabla productos
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- stock_cantidad: null = sin límite/ilimitado, 0 = sin stock, N = N unidades disponibles
-- El campo stock (boolean) sigue existiendo para compatibilidad con el catálogo público.
-- La lógica de negocio: si stock_cantidad IS NOT NULL AND stock_cantidad = 0 → stock = false

alter table productos
  add column if not exists stock_cantidad integer default null;

-- Verificación:
-- select id, nombre, stock, stock_cantidad from productos limit 5;
