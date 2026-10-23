-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Precios de distribuidores (correr en Supabase SQL Editor)
-- Los carga el scraper diario (scrapers/*.mjs vía GitHub Actions) con la
-- service_role key. Contienen COSTOS: solo el admin puede leerlos.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- ── 1. Tabla principal ────────────────────────────────────────────────────
create table if not exists public.precios_distribuidor (
  id               bigint generated always as identity primary key,
  distribuidor     text not null,           -- slug: 'dm', 'delviso', 'cromosol', 'prautopartes'
  codigo           text not null,           -- código del distribuidor
  descripcion      text not null,
  marca            text,                    -- marca del vehículo / línea
  rubro            text,
  origen           text,                    -- fabricante / procedencia
  precio_lista     numeric(12,2),
  precio_neto      numeric(12,2),           -- costo para Daniel (lista − descuento)
  precio_anterior  numeric(12,2),           -- último precio_neto distinto (para ver subas)
  precio_cambio_at timestamptz,
  imagen_url       text,
  activo           boolean not null default true,  -- false = ya no aparece en el distribuidor
  visto_at         timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (distribuidor, codigo)
);

create index if not exists idx_precios_desc_trgm
  on public.precios_distribuidor using gin (descripcion gin_trgm_ops);
create index if not exists idx_precios_codigo_trgm
  on public.precios_distribuidor using gin (codigo gin_trgm_ops);
create index if not exists idx_precios_dist_visto
  on public.precios_distribuidor (distribuidor, visto_at);

alter table public.precios_distribuidor enable row level security;

drop policy if exists "precios_select_admin" on public.precios_distribuidor;
create policy "precios_select_admin"
  on public.precios_distribuidor for select
  using ((select public.is_admin()));
-- Sin policies de insert/update/delete: solo escribe la service_role (bypassa RLS).

-- ── 2. Log de corridas del scraper ────────────────────────────────────────
create table if not exists public.scraper_runs (
  id            bigint generated always as identity primary key,
  distribuidor  text not null,
  inicio        timestamptz not null default now(),
  fin           timestamptz,
  ok            boolean,
  productos     integer,
  error         text
);

create index if not exists idx_scraper_runs_dist_inicio
  on public.scraper_runs (distribuidor, inicio desc);

alter table public.scraper_runs enable row level security;

drop policy if exists "scraper_runs_select_admin" on public.scraper_runs;
create policy "scraper_runs_select_admin"
  on public.scraper_runs for select
  using ((select public.is_admin()));

-- ── 3. Upsert por lotes (guarda precio_anterior cuando cambia el costo) ───
create or replace function public.upsert_precios(p_rows jsonb, p_visto timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  with filas as (
    select * from jsonb_to_recordset(p_rows) as r(
      distribuidor text, codigo text, descripcion text, marca text, rubro text,
      origen text, precio_lista numeric, precio_neto numeric, imagen_url text
    )
  ), ins as (
    insert into public.precios_distribuidor as t
      (distribuidor, codigo, descripcion, marca, rubro, origen,
       precio_lista, precio_neto, imagen_url, activo, visto_at)
    select distribuidor, codigo, descripcion, marca, rubro, origen,
           precio_lista, precio_neto, imagen_url, true, p_visto
    from filas
    on conflict (distribuidor, codigo) do update set
      descripcion      = excluded.descripcion,
      marca            = excluded.marca,
      rubro            = excluded.rubro,
      origen           = excluded.origen,
      precio_lista     = excluded.precio_lista,
      precio_anterior  = case when excluded.precio_neto is distinct from t.precio_neto
                              then t.precio_neto else t.precio_anterior end,
      precio_cambio_at = case when excluded.precio_neto is distinct from t.precio_neto
                              then p_visto else t.precio_cambio_at end,
      precio_neto      = excluded.precio_neto,
      imagen_url       = excluded.imagen_url,
      activo           = true,
      visto_at         = p_visto
    returning 1
  )
  select count(*)::integer from ins;
$$;

-- Marca como inactivos los productos que no aparecieron en la corrida
create or replace function public.desactivar_no_vistos(p_distribuidor text, p_visto timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  with upd as (
    update public.precios_distribuidor
    set activo = false
    where distribuidor = p_distribuidor and visto_at < p_visto and activo
    returning 1
  )
  select count(*)::integer from upd;
$$;

-- Solo la service_role (el scraper) puede ejecutarlas
revoke all on function public.upsert_precios(jsonb, timestamptz)        from public, anon, authenticated;
revoke all on function public.desactivar_no_vistos(text, timestamptz)   from public, anon, authenticated;
grant execute on function public.upsert_precios(jsonb, timestamptz)      to service_role;
grant execute on function public.desactivar_no_vistos(text, timestamptz) to service_role;
