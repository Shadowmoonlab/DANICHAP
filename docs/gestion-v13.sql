-- docs/gestion-v13.sql — Buscador más rápido (se puede correr más de una vez).
-- La columna busqueda ya está en minúsculas y sin acentos, y los patrones del panel también: comparar sin
-- ignorar mayúsculas (~ en vez de ~*) da el mismo resultado y es ~6 veces más rápido al revisar candidatos
-- ("paragolpe ka": 1.250 ms → 205 ms en producción).

create or replace function public.buscar_precios2(p_patrones text[], p_primera text default null, p_codigo text default null, p_limite integer default 250)
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
  -- Cada palabra llega como patrón ya armado por el panel (gestion/texto.js → patron): sinónimos de los
  -- proveedores, lado (-DI/-TD, D/I), números exactos, palabras cortas enteras. Máximo 6, cortos.
  select string_agg(format('t.busqueda ~ %L', p), ' and ')
  into v_condicion
  from unnest(p_patrones[1:6]) p
  where length(trim(p)) between 1 and 200;
  v_primera := nullif(regexp_replace(lower(coalesce(p_primera, '')), '([.*+?^${}()|\[\]\\])', '\\\1', 'g'), '');
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
      'select x.id, x.distribuidor, x.codigo, x.descripcion, x.marca, x.rubro, x.origen, x.precio_neto, x.precio_anterior, x.precio_cambio_at
       from (
         select t.*, %s as empieza,
                t.precio_neto * case coalesce(p.moneda, ''ARS'') when ''USD'' then c.usd when ''EUR'' then c.eur else 1 end as pesos
         from public.precios_distribuidor t
         left join public.proveedores p on p.slug = t.distribuidor
         cross join (select coalesce(cotizacion_usd, 1400) usd, coalesce(cotizacion_eur, 1600) eur from public.config_negocio where id = 1) c
         where t.activo and %s
       ) x
       order by (row_number() over (partition by x.distribuidor order by x.empieza desc, x.pesos asc nulls last) <= 5) desc,
                x.empieza desc, x.pesos asc nulls last
       limit $1',
      case when v_primera is null then 'true'
           else format('translate(lower(t.descripcion), %L, %L) ~ %L', 'áéíóúüñ', 'aeiouun', '^' || v_primera) end,
      v_condicion)
    using least(greatest(coalesce(p_limite, 250), 1), 500);
  end if;
end;
$$;

revoke all on function public.buscar_precios2(text[], text, text, integer) from public, anon;
grant execute on function public.buscar_precios2(text[], text, text, integer) to authenticated;


notify pgrst, 'reload schema';
