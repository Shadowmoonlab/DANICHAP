-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Fixes DB: índice stock + trigger updated_at
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Índice faltante: stock (usado en Productos.list() con eq('stock', true)) ─
create index if not exists idx_productos_stock
  on productos(stock) where stock = true;

-- ── Índice compuesto: catálogo público (stock + created_at) ──────────────────
create index if not exists idx_productos_stock_created
  on productos(stock, created_at desc);

-- ── Trigger: auto-actualizar updated_at al hacer UPDATE ──────────────────────
-- Evita depender del JS para mantener updated_at consistente
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_productos_updated_at on productos;
create trigger trg_productos_updated_at
  before update on productos
  for each row execute function set_updated_at();

-- ── RLS: agregar WITH CHECK a la política de update de perfiles ───────────────
-- Previene que un usuario rebaje su propio rol o eleve el de otro sin ser admin
drop policy if exists "Usuario actualiza su perfil" on perfiles;
create policy "Usuario actualiza su perfil"
  on perfiles for update
  using   (auth.uid() = id)
  with check (
    -- No puede cambiar su propio rol a 'admin' (solo admin puede hacerlo)
    rol = (select rol from perfiles where id = auth.uid())
    or exists (select 1 from perfiles where id = auth.uid() and rol = 'admin')
  );

-- ── RLS perfiles: prevenir recursión infinita en la policy admin ──────────────
-- La policy "Admin ve todos los perfiles" hace subquery a perfiles (recursión)
-- Reemplazar con security definer function para evitar el problema
create or replace function is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin'
  )
$$;

-- Reemplazar política recursiva por una que usa la función security definer
drop policy if exists "Admin ve todos los perfiles" on perfiles;
create policy "Admin ve todos los perfiles"
  on perfiles for select
  using (is_admin());

-- ── Verificación ──────────────────────────────────────────────────────────────
-- Después de ejecutar, confirmar que estos índices existen:
-- select indexname, indexdef from pg_indexes where tablename = 'productos';
-- Y que el trigger existe:
-- select trigger_name from information_schema.triggers where event_object_table = 'productos';
