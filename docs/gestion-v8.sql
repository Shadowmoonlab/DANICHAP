-- docs/gestion-v8.sql — Buscador rápido (se puede correr más de una vez).
-- Problema: con RLS activa, Postgres no deja usar el índice de búsqueda para "busqueda ~* ..." (el operador de
-- expresiones regulares no es "leakproof"): recorría las 169.000 filas una por una → 3 a 5 segundos por búsqueda.
-- Arreglo: funciones security definer que primero verifican que quien busca es admin (la misma regla que la RLS)
-- y después buscan sin RLS, con el índice trigram → ~20-40 ms.

-- Búsqueda exacta del mostrador. Cada palabra tiene que aparecer al COMIENZO de una palabra (\m); los números
-- en cualquier parte ("p/400" → "400"). Con p_codigo, primero los artículos cuyo código empieza así.
create or replace function public.buscar_precios(p_palabras text[], p_codigo text default null, p_limite integer default 250)
returns table (id bigint, distribuidor text, codigo text, descripcion text, marca text, rubro text, origen text,
               precio_neto numeric, precio_anterior numeric, precio_cambio_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_condicion text;
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
  if v_condicion is null and v_codigo is null then return; end if;

  if v_codigo is not null and length(v_codigo) >= 3 then
    return query
      select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro, t.origen, t.precio_neto, t.precio_anterior, t.precio_cambio_at
      from public.precios_distribuidor t
      where t.activo and t.codigo ilike v_codigo || '%'
      limit 20;
  end if;
  if v_condicion is not null then
    return query execute format(
      'select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro, t.origen, t.precio_neto, t.precio_anterior, t.precio_cambio_at
       from public.precios_distribuidor t
       where t.activo and %s
       order by t.precio_neto asc nulls last
       limit $1', v_condicion)
    using least(greatest(coalesce(p_limite, 250), 1), 500);
  end if;
end;
$$;

revoke all on function public.buscar_precios(text[], text, integer) from public, anon;
grant execute on function public.buscar_precios(text[], text, integer) to authenticated;

-- Errores de tipeo ("paragople"): la misma función de v5, ahora security definer con el control de admin
-- (security invoker con RLS tampoco podía usar el índice).
create or replace function public.buscar_parecidos(p_q text, p_limite integer default 40)
returns table (id bigint, distribuidor text, codigo text, descripcion text, marca text, rubro text,
               precio_neto numeric, precio_anterior numeric, precio_cambio_at timestamptz, parecido real)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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
