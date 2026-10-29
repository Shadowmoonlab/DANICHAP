-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Sincronización de precios de los robots: solo se escribe lo que cambió (29/10/2026)
-- Correr DESPUÉS de robots-conservar-datos.sql. Idempotente.
--
-- Antes: cada corrida reescribía las ~176.000 filas (visto_at cambia siempre) y con ellas los 3 índices de
-- búsqueda: minutos de escritura y cortes por tiempo en el plan gratis. Ahora:
--   sincronizar_precios  → inserta lo nuevo y actualiza SOLO las filas cuyo precio/datos cambiaron
--   desactivar_ausentes  → da de baja lo que el distribuidor ya no lista (por código, sin depender de visto_at)
-- upsert_precios / desactivar_no_vistos quedan como estaban para el importador de listas del panel.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.sincronizar_precios(p_rows jsonb, p_visto timestamptz)
returns integer          -- filas nuevas o con cambios
language sql
security definer
set search_path = ''
as $$
  with filas as (
    select distinct on (codigo) *
    from jsonb_to_recordset(p_rows) as r(
      distribuidor text, codigo text, descripcion text, marca text, rubro text,
      origen text, precio_lista numeric, precio_neto numeric, imagen_url text
    )
    order by codigo
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
    -- Fila idéntica a la guardada: no se toca (ni la tabla ni los índices)
    where not t.activo
       or t.descripcion  is distinct from excluded.descripcion
       or t.precio_lista is distinct from excluded.precio_lista
       or t.precio_neto  is distinct from excluded.precio_neto
       or (excluded.marca      is not null and t.marca      is distinct from excluded.marca)
       or (excluded.rubro      is not null and t.rubro      is distinct from excluded.rubro)
       or (excluded.origen     is not null and t.origen     is distinct from excluded.origen)
       or (excluded.imagen_url is not null and t.imagen_url is distinct from excluded.imagen_url)
    returning 1
  )
  select count(*)::integer from ins;
$$;

create or replace function public.desactivar_ausentes(p_distribuidor text, p_codigos text[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with vigentes as (select unnest(p_codigos) as codigo),
  upd as (
    update public.precios_distribuidor t
    set activo = false
    where t.distribuidor = p_distribuidor and t.activo
      and not exists (select 1 from vigentes v where v.codigo = t.codigo)
    returning 1
  )
  select count(*)::integer from upd;
$$;

revoke all on function public.sincronizar_precios(jsonb, timestamptz)  from public, anon, authenticated;
revoke all on function public.desactivar_ausentes(text, text[])        from public, anon, authenticated;
grant execute on function public.sincronizar_precios(jsonb, timestamptz) to service_role;
grant execute on function public.desactivar_ausentes(text, text[])       to service_role;

notify pgrst, 'reload schema';
