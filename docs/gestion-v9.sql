-- docs/gestion-v9.sql — Ajustes de la revisión (se puede correr más de una vez).
-- 1. Buscador: de las coincidencias, primero lo que EMPIEZA con la primera palabra y después lo más barato EN PESOS
--    (antes "más barato" comparaba dólares con pesos: USD 5 quedaba antes que $ 5.000 y una lista en dólares
--    podía llenar los 250 resultados). Por código: el código exacto primero.
-- 2. search_path de las funciones security definer: pg_catalog y extensions antes que public.
-- 3. finalizar_importacion verifica que el proveedor exista (como importar_lista_lote).
-- 4. sincronizar_precios: un precio vacío nunca pisa el precio bueno que ya estaba.
-- 5. anon (sin sesión) no puede escribir productos aunque una regla RLS fallara; tablas nuevas sin permisos para anon.

create or replace function public.buscar_precios(p_palabras text[], p_codigo text default null, p_limite integer default 250)
returns table (id bigint, distribuidor text, codigo text, descripcion text, marca text, rubro text, origen text,
               precio_neto numeric, precio_anterior numeric, precio_cambio_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  v_condicion text;
  v_primera text;
  v_codigo text := nullif(regexp_replace(coalesce(p_codigo, ''), '[%_\\]', '', 'g'), '');
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador ve los precios de los proveedores';
  end if;
  select string_agg(case when w ~ '^\d+$' then format('t.busqueda ilike %L', '%' || w || '%')
                         else format('t.busqueda ~* %L', '\m' || regexp_replace(w, '([.*+?^${}()|\[\]\\])', '\\\1', 'g')) end,
                    ' and ')
  into v_condicion
  from unnest(p_palabras[1:6]) w
  where length(trim(w)) > 0;
  -- La primera palabra que no es número: lo que empieza con ella va arriba ("óptica corsa" → "ÓPTICA CORSA…")
  select regexp_replace(w, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') into v_primera
  from unnest(p_palabras[1:6]) with ordinality u(w, n)
  where w !~ '^\d+$' and length(trim(w)) > 0
  order by n limit 1;
  if v_condicion is null and v_codigo is null then return; end if;

  if v_codigo is not null and length(v_codigo) >= 3 then
    return query
      select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro, t.origen, t.precio_neto, t.precio_anterior, t.precio_cambio_at
      from public.precios_distribuidor t
      where t.activo and t.codigo ilike v_codigo || '%'
      order by lower(t.codigo) = lower(v_codigo) desc, length(t.codigo), t.codigo
      limit 20;
  end if;
  if v_condicion is not null then
    return query execute format(
      'select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro, t.origen, t.precio_neto, t.precio_anterior, t.precio_cambio_at
       from public.precios_distribuidor t
       left join public.proveedores p on p.slug = t.distribuidor
       cross join (select coalesce(cotizacion_usd, 1400) usd, coalesce(cotizacion_eur, 1600) eur from public.config_negocio where id = 1) c
       where t.activo and %s
       order by %s,
                t.precio_neto * case coalesce(p.moneda, ''ARS'') when ''USD'' then c.usd when ''EUR'' then c.eur else 1 end asc nulls last
       limit $1',
      v_condicion,
      case when v_primera is null then 'true'
           else format('translate(lower(t.descripcion), %L, %L) ~ %L desc', 'áéíóúüñ', 'aeiouun', '^' || v_primera) end)
    using least(greatest(coalesce(p_limite, 250), 1), 500);
  end if;
end;
$$;

revoke all on function public.buscar_precios(text[], text, integer) from public, anon;
grant execute on function public.buscar_precios(text[], text, integer) to authenticated;

create or replace function public.buscar_parecidos(p_q text, p_limite integer default 40)
returns table (id bigint, distribuidor text, codigo text, descripcion text, marca text, rubro text,
               precio_neto numeric, precio_anterior numeric, precio_cambio_at timestamptz, parecido real)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  v_palabras text[];
  v_condicion text;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador ve los precios de los proveedores';
  end if;
  select array_agg(w order by length(w) desc) into v_palabras
  from (select distinct w from unnest(regexp_split_to_array(lower(trim(coalesce(p_q, ''))), '\s+')) w where length(w) >= 3) x;
  if v_palabras is null then return; end if;
  v_palabras := v_palabras[1:4];
  select string_agg(format('%L <%% t.busqueda', w), ' and ') into v_condicion from unnest(v_palabras) w;
  perform set_config('pg_trgm.word_similarity_threshold', '0.5', true);
  return query execute format(
    'select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro,
            t.precio_neto, t.precio_anterior, t.precio_cambio_at,
            (select avg(word_similarity(w, t.busqueda)) from unnest($1) w)::real
     from public.precios_distribuidor t
     where t.activo and %s
     order by 10 desc, t.precio_neto nulls last
     limit $2', v_condicion)
  using v_palabras, least(greatest(p_limite, 1), 100);
end;
$$;

revoke all on function public.buscar_parecidos(text, integer) from public, anon;
grant execute on function public.buscar_parecidos(text, integer) to authenticated;

-- 3. Cierre de importación: solo proveedores que existen (un error no puede "dar de baja" a otro)
create or replace function public.finalizar_importacion(p_proveedor text, p_codigos text[], p_reemplazar boolean, p_cambios integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bajas integer := 0;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede importar listas';
  end if;
  if not exists (select 1 from public.proveedores where slug = p_proveedor) then
    raise exception 'Proveedor desconocido: %', p_proveedor;
  end if;
  if coalesce(array_length(p_codigos, 1), 0) = 0 then
    raise exception 'La lista no tiene productos';
  end if;
  if p_reemplazar then
    v_bajas := public.desactivar_ausentes(p_proveedor, p_codigos);
  end if;
  insert into public.scraper_runs (distribuidor, inicio, fin, ok, productos, error)
  values (p_proveedor, now(), now(), true, array_length(p_codigos, 1), null);
  return jsonb_build_object('guardados', array_length(p_codigos, 1), 'cambios', coalesce(p_cambios, 0), 'desactivados', v_bajas);
end;
$$;

revoke all on function public.finalizar_importacion(text, text[], boolean, integer) from public, anon;
grant execute on function public.finalizar_importacion(text, text[], boolean, integer) to authenticated;

-- 4. Precio vacío = "sin precio": se guarda el resto, pero el precio bueno anterior se conserva
create or replace function public.sincronizar_precios(p_rows jsonb, p_visto timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  with filas as (
    select distinct on (codigo) * from jsonb_to_recordset(p_rows) as r(
      distribuidor text, codigo text, descripcion text, marca text, rubro text,
      origen text, precio_lista numeric, precio_neto numeric, imagen_url text)
    order by codigo
  ), ins as (
    insert into public.precios_distribuidor as t
      (distribuidor, codigo, descripcion, marca, rubro, origen, precio_lista, precio_neto, imagen_url, activo, visto_at)
    select distribuidor, codigo, descripcion, marca, rubro, origen, precio_lista, precio_neto, imagen_url, true, p_visto from filas
    on conflict (distribuidor, codigo) do update set
      descripcion = excluded.descripcion,
      marca = coalesce(excluded.marca, t.marca), rubro = coalesce(excluded.rubro, t.rubro),
      origen = coalesce(excluded.origen, t.origen),
      precio_lista = coalesce(excluded.precio_lista, t.precio_lista),
      precio_anterior  = case when excluded.precio_neto is not null and excluded.precio_neto is distinct from t.precio_neto then t.precio_neto else t.precio_anterior end,
      precio_cambio_at = case when excluded.precio_neto is not null and excluded.precio_neto is distinct from t.precio_neto then p_visto else t.precio_cambio_at end,
      precio_neto = coalesce(excluded.precio_neto, t.precio_neto),
      imagen_url = coalesce(excluded.imagen_url, t.imagen_url),
      activo = true, visto_at = p_visto
    where not t.activo
       or t.descripcion is distinct from excluded.descripcion
       or (excluded.precio_lista is not null and t.precio_lista is distinct from excluded.precio_lista)
       or (excluded.precio_neto is not null and t.precio_neto is distinct from excluded.precio_neto)
       or (excluded.marca is not null and t.marca is distinct from excluded.marca)
       or (excluded.rubro is not null and t.rubro is distinct from excluded.rubro)
       or (excluded.origen is not null and t.origen is distinct from excluded.origen)
       or (excluded.imagen_url is not null and t.imagen_url is distinct from excluded.imagen_url)
    returning 1)
  select count(*)::integer from ins;
$$;

revoke all on function public.sincronizar_precios(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.sincronizar_precios(jsonb, timestamptz) to service_role;

-- 5. Sin sesión no se escribe nada, aunque una regla RLS se rompiera; y lo que se cree después nace cerrado
revoke insert, update, delete, truncate on public.productos from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

notify pgrst, 'reload schema';
