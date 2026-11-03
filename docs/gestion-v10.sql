-- docs/gestion-v10.sql — Buscador: ninguna lista queda tapada (se puede correr más de una vez).
-- Problema: "paragolpe gol" tiene ~700 coincidencias de los robots (Otero, DM, Del Viso) y los 250 que devolvía la
-- base eran todos de ellos: lo de Francar, Almas o Chriva nunca llegaba a la pantalla.
-- Arreglo: primero los 5 mejores de CADA proveedor (lo que empieza con la palabra y lo más barato en pesos), después
-- el resto en el mismo orden. Así cada lista con coincidencias aparece y tiene su botón de filtro.

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

revoke all on function public.buscar_precios(text[], text, integer) from public, anon;
grant execute on function public.buscar_precios(text[], text, integer) to authenticated;

notify pgrst, 'reload schema';
