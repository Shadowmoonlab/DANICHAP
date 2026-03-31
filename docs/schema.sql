-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Schema Supabase
-- Pegar completo en: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tabla productos ───────────────────────────────────────────────────────
create table if not exists productos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  categoria      text not null,
  subcategoria   text,
  marca_rep      text,
  precio         numeric(10,2),
  precio_antes   numeric(10,2),
  descripcion    text,
  imagen_url     text,
  stock          boolean default true,
  destacado      boolean default false,
  badge          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ── Tabla perfiles (extiende auth.users) ──────────────────────────────────
create table if not exists perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  telefono   text,
  rol        text default 'cliente' check (rol in ('cliente', 'admin')),
  created_at timestamptz default now()
);

-- ── Tabla carrito ─────────────────────────────────────────────────────────
create table if not exists carrito (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  producto_id uuid references productos(id) on delete cascade not null,
  cantidad    int default 1 check (cantidad > 0),
  created_at  timestamptz default now(),
  unique(user_id, producto_id)
);

-- ── Trigger: crear perfil automáticamente al registrarse ──────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── RLS: productos ────────────────────────────────────────────────────────
alter table productos enable row level security;

create policy "Lectura pública de productos"
  on productos for select using (true);

create policy "Admin puede insertar productos"
  on productos for insert
  with check (
    exists (select 1 from perfiles where id = auth.uid() and rol = 'admin')
  );

create policy "Admin puede actualizar productos"
  on productos for update
  using (
    exists (select 1 from perfiles where id = auth.uid() and rol = 'admin')
  );

create policy "Admin puede eliminar productos"
  on productos for delete
  using (
    exists (select 1 from perfiles where id = auth.uid() and rol = 'admin')
  );

-- ── RLS: carrito ──────────────────────────────────────────────────────────
alter table carrito enable row level security;

create policy "Usuario ve su carrito"
  on carrito for select using (auth.uid() = user_id);

create policy "Usuario agrega a su carrito"
  on carrito for insert with check (auth.uid() = user_id);

create policy "Usuario actualiza su carrito"
  on carrito for update using (auth.uid() = user_id);

create policy "Usuario elimina de su carrito"
  on carrito for delete using (auth.uid() = user_id);

-- ── RLS: perfiles ─────────────────────────────────────────────────────────
alter table perfiles enable row level security;

create policy "Usuario ve su perfil"
  on perfiles for select using (auth.uid() = id);

create policy "Admin ve todos los perfiles"
  on perfiles for select
  using (
    exists (select 1 from perfiles p where p.id = auth.uid() and p.rol = 'admin')
  );

create policy "Usuario actualiza su perfil"
  on perfiles for update using (auth.uid() = id);

-- ── Storage bucket para imágenes de productos ─────────────────────────────
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

create policy "Lectura pública imágenes"
  on storage.objects for select
  using (bucket_id = 'productos');

create policy "Admin sube imágenes"
  on storage.objects for insert
  with check (
    bucket_id = 'productos' and
    exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin')
  );

create policy "Admin elimina imágenes"
  on storage.objects for delete
  using (
    bucket_id = 'productos' and
    exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin')
  );

-- ── Índices de rendimiento ────────────────────────────────────────────────
create index if not exists idx_productos_categoria  on productos(categoria);
create index if not exists idx_productos_destacado  on productos(destacado) where destacado = true;
create index if not exists idx_carrito_user_id      on carrito(user_id);
