-- Fix: la policy recursiva en perfiles puede causar que Perfiles.get() devuelva null
-- Solución: simplificar a que cada usuario vea SOLO su propio perfil (es suficiente para el guard)

-- Eliminar policies existentes en perfiles
drop policy if exists "Usuario ve su perfil" on perfiles;
drop policy if exists "Admin ve todos los perfiles" on perfiles;

-- Nueva policy simple: cada usuario ve solo su propio perfil
create policy "Usuario ve su perfil"
  on perfiles for select using (auth.uid() = id);

-- Verificar:
select schemaname, tablename, policyname from pg_policies where tablename = 'perfiles';
