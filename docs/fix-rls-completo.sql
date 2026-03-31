-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Fix RLS completo (correr en Supabase SQL Editor)
-- Problema: policy "Admin ve todos los perfiles" era RECURSIVA → Perfiles.get() devuelve null
-- Fix: usar security definer function + (select auth.uid()) optimizado
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Helper function: is_admin() — security definer bypasses RLS ────────
-- Esta función corre como su dueño (postgres), no como el usuario llamante.
-- Evita la recursión: la policy puede llamar is_admin() sin hacer select en perfiles bajo RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = (select auth.uid())
    and rol = 'admin'
  );
$$;

-- ── 2. Perfiles: RLS ──────────────────────────────────────────────────────
drop policy if exists "Usuario ve su perfil"       on public.perfiles;
drop policy if exists "Admin ve todos los perfiles" on public.perfiles;
drop policy if exists "Usuario actualiza su perfil" on public.perfiles;

-- Cada usuario ve SOLO su propio perfil (simple, sin recursión)
create policy "perfiles_select_own"
  on public.perfiles for select
  using ((select auth.uid()) = id);

-- Admin ve todos (usa is_admin() para evitar recursión)
create policy "perfiles_select_admin"
  on public.perfiles for select
  using (public.is_admin());

-- Cada usuario actualiza solo el suyo
create policy "perfiles_update_own"
  on public.perfiles for update
  using ((select auth.uid()) = id);

-- ── 3. Productos: RLS optimizada ──────────────────────────────────────────
drop policy if exists "Lectura pública de productos"   on public.productos;
drop policy if exists "Admin puede insertar productos" on public.productos;
drop policy if exists "Admin puede actualizar productos" on public.productos;
drop policy if exists "Admin puede eliminar productos"  on public.productos;

create policy "productos_select_public"
  on public.productos for select
  using (true);

create policy "productos_insert_admin"
  on public.productos for insert
  with check (public.is_admin());

create policy "productos_update_admin"
  on public.productos for update
  using (public.is_admin());

create policy "productos_delete_admin"
  on public.productos for delete
  using (public.is_admin());

-- ── 4. Carrito: RLS optimizada ────────────────────────────────────────────
drop policy if exists "Usuario ve su carrito"       on public.carrito;
drop policy if exists "Usuario agrega a su carrito" on public.carrito;
drop policy if exists "Usuario actualiza su carrito" on public.carrito;
drop policy if exists "Usuario elimina de su carrito" on public.carrito;

create policy "carrito_select_own"
  on public.carrito for select
  using ((select auth.uid()) = user_id);

create policy "carrito_insert_own"
  on public.carrito for insert
  with check ((select auth.uid()) = user_id);

create policy "carrito_update_own"
  on public.carrito for update
  using ((select auth.uid()) = user_id);

create policy "carrito_delete_own"
  on public.carrito for delete
  using ((select auth.uid()) = user_id);

-- ── 5. Storage: policies optimizadas ─────────────────────────────────────
drop policy if exists "Lectura pública imágenes" on storage.objects;
drop policy if exists "Admin sube imágenes"      on storage.objects;
drop policy if exists "Admin elimina imágenes"   on storage.objects;

create policy "storage_select_public"
  on storage.objects for select
  using (bucket_id = 'productos');

create policy "storage_insert_admin"
  on storage.objects for insert
  with check (bucket_id = 'productos' and public.is_admin());

create policy "storage_delete_admin"
  on storage.objects for delete
  using (bucket_id = 'productos' and public.is_admin());

-- ── 6. Verificación ───────────────────────────────────────────────────────
select tablename, policyname, cmd
from pg_policies
where tablename in ('perfiles', 'productos', 'carrito')
order by tablename, policyname;

-- Test: tu usuario debería devolver true si tiene rol = 'admin'
select public.is_admin() as soy_admin;
