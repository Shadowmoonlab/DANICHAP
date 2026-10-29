-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — upsert_precios conserva foto, marca, rubro y origen si el robot no los trae (29/10/2026)
-- Goicoechea ahora baja la lista completa en un CSV (segundos en vez de minutos), pero el CSV no trae fotos:
-- sin esto, cada corrida borraría las fotos que ya había. Correr DESPUÉS de ajustes-2026-10.sql. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
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
      marca            = coalesce(excluded.marca, t.marca),
      rubro            = coalesce(excluded.rubro, t.rubro),
      origen           = coalesce(excluded.origen, t.origen),
      precio_lista     = excluded.precio_lista,
      precio_anterior  = case when excluded.precio_neto is distinct from t.precio_neto
                              then t.precio_neto else t.precio_anterior end,
      precio_cambio_at = case when excluded.precio_neto is distinct from t.precio_neto
                              then p_visto else t.precio_cambio_at end,
      precio_neto      = excluded.precio_neto,
      imagen_url       = coalesce(excluded.imagen_url, t.imagen_url),
      activo           = true,
      visto_at         = p_visto
    returning 1
  )
  select count(*)::integer from ins;
$$;

revoke execute on function public.upsert_precios(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.upsert_precios(jsonb, timestamptz) to service_role;

-- ── Guardado de los robots sin cortes por tiempo (29/10/2026) ────────────────
-- La API corta a los 8 s (statement_timeout del rol authenticator). service_role (solo los robots, desde
-- GitHub Actions) no tenía límite propio y heredaba esos 8 s: un lote de 500-1000 precios con 3 índices de
-- búsqueda puede pasarlos cuando corren 7 robots a la vez.
alter role service_role set statement_timeout = '5min';

-- visto_at cambia en cada corrida: con un índice encima, cada fila se reescribe en todos los índices (incluidos los
-- de búsqueda, caros). Sin él, Postgres actualiza "en el lugar" (HOT) las filas cuyo precio no cambió.
-- desactivar_no_vistos filtra por distribuidor: usa el índice único (distribuidor, codigo).
drop index if exists public.idx_precios_dist_visto;
alter table public.precios_distribuidor set (fillfactor = 85);

notify pgrst, 'reload config';
