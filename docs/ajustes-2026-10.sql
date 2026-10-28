-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Ajustes 28/10/2026: seguridad/rendimiento (asesor de Supabase) y proveedores nuevos
-- Correr DESPUÉS de add-gestion-v2.sql. Idempotente: se puede correr más de una vez.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. handle_new_user: search_path fijo y no ejecutable desde la API ──────
-- Es la función del trigger que crea el perfil al registrarse. El trigger la sigue
-- ejecutando igual: los triggers no necesitan permiso EXECUTE de quien se registra.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    'cliente'
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ── 2. Carrito: policies con (select auth.uid()) (igual que fix-rls-completo.sql §4) ─
drop policy if exists "Usuario ve su carrito"         on public.carrito;
drop policy if exists "Usuario agrega a su carrito"   on public.carrito;
drop policy if exists "Usuario actualiza su carrito"  on public.carrito;
drop policy if exists "Usuario elimina de su carrito" on public.carrito;
drop policy if exists "carrito_select_own" on public.carrito;
drop policy if exists "carrito_insert_own" on public.carrito;
drop policy if exists "carrito_update_own" on public.carrito;
drop policy if exists "carrito_delete_own" on public.carrito;

create policy "carrito_select_own" on public.carrito for select
  using ((select auth.uid()) = user_id);
create policy "carrito_insert_own" on public.carrito for insert
  with check ((select auth.uid()) = user_id);
create policy "carrito_update_own" on public.carrito for update
  using ((select auth.uid()) = user_id);
create policy "carrito_delete_own" on public.carrito for delete
  using ((select auth.uid()) = user_id);

-- ── 3. Índice para la clave foránea carrito → productos ───────────────────
create index if not exists idx_carrito_producto on public.carrito (producto_id);

-- ── 4. Proveedores nuevos (robots y listas) ───────────────────────────────
-- El slug es el mismo que usa cada robot en precios_distribuidor.distribuidor.
insert into public.proveedores (slug, nombre, orden) values
  ('goicoechea',         'Goicoechea Hnos.',          80),
  ('distrisuper',        'Distrisuper',               90),
  ('fal',                'Autopartes Fal',           100),
  ('distriferr',         'Distriferr Hnos.',         110),
  ('primeraalternativa', 'La Primera Alternativa',   120),
  ('tytsa',              'TyT',                      130)
on conflict (slug) do nothing;
