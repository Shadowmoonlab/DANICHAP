-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — CRÍTICO: un usuario registrado podía hacerse administrador (29/10/2026)
-- La policy perfiles_update_own deja editar el propio perfil, y el perfil incluye la columna rol:
--   PATCH /rest/v1/perfiles?id=eq.<mi id>  {"rol":"admin"}  → acceso a precios, ventas, clientes y productos.
-- Correr ANTES que nada. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Desde la API nadie modifica perfiles (la web no lo hace: el perfil lo crea handle_new_user al registrarse).
--    Para dar o quitar el rol de administrador: desde el SQL Editor de Supabase.
revoke insert, update, delete, truncate on public.perfiles from anon, authenticated;
drop policy if exists perfiles_update_own on public.perfiles;

-- 2. Defensa extra: aunque algún día se vuelva a habilitar la edición, el rol solo lo cambia un administrador
--    (o el SQL Editor, que no tiene usuario logueado).
create or replace function public.proteger_rol()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rol is distinct from old.rol and auth.uid() is not null and not public.is_admin() then
    raise exception 'No autorizado a cambiar el rol';
  end if;
  return new;
end;
$$;
revoke execute on function public.proteger_rol() from public, anon, authenticated;
drop trigger if exists perfiles_proteger_rol on public.perfiles;
create trigger perfiles_proteger_rol before update on public.perfiles
  for each row execute function public.proteger_rol();

-- 3. Una sola policy de lectura (antes eran dos: el asesor de Supabase avisa que es más lento)
drop policy if exists perfiles_select_own   on public.perfiles;
drop policy if exists perfiles_select_admin on public.perfiles;
drop policy if exists perfiles_select       on public.perfiles;
create policy perfiles_select on public.perfiles for select
  using ((select auth.uid()) = id or (select public.is_admin()));

-- 4. Productos: is_admin() envuelto en (select ...) se evalúa una vez por consulta y no por fila
drop policy if exists productos_insert_admin on public.productos;
drop policy if exists productos_update_admin on public.productos;
drop policy if exists productos_delete_admin on public.productos;
create policy productos_insert_admin on public.productos for insert with check ((select public.is_admin()));
create policy productos_update_admin on public.productos for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy productos_delete_admin on public.productos for delete using ((select public.is_admin()));

-- 5. Carrito: al editar una fila propia no se puede pasar a otro usuario
drop policy if exists carrito_update_own on public.carrito;
create policy carrito_update_own on public.carrito for update
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
