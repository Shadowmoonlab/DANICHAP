-- docs/gestion-v14.sql — Proveedores elegidos en el buscador + listas de proveedores nuevos (se puede correr más de una vez).
-- 1. buscar_precios3: el mismo buscador (v13) pero se puede elegir en qué proveedores buscar (uno o varios) y,
--    sin escribir nada, ver TODO lo de esos proveedores por nombre (de a páginas). El panel usa buscar_precios2
--    si esta todavía no está.
-- 2. Listas de proveedores nuevos: Daniel agrega el proveedor y sube su lista; si el panel no la puede leer sola,
--    queda guardada (archivo privado) en "listas_pendientes" para que la procesemos.

create or replace function public.buscar_precios3(p_patrones text[], p_primera text default null, p_codigo text default null, p_limite integer default 250,
                                                  p_proveedores text[] default null, p_desde integer default 0)
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
  v_prov text := '';
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
  -- Proveedores elegidos con los botones de abajo del buscador (uno o varios): se busca solo en esos
  if coalesce(array_length(p_proveedores, 1), 0) > 0 then
    v_prov := format(' and t.distribuidor = any(%L::text[])', p_proveedores[1:30]);
  end if;
  -- Sin palabras y con proveedores elegidos: TODO lo de esos proveedores, por nombre, de a páginas
  if v_condicion is null and v_codigo is null then
    if v_prov = '' then return; end if;
    return query execute format(
      'select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro, t.origen, t.precio_neto, t.precio_anterior, t.precio_cambio_at
       from public.precios_distribuidor t
       where t.activo %s
       order by t.descripcion, t.id
       limit $1 offset $2', v_prov)
    using least(greatest(coalesce(p_limite, 60), 1), 200), greatest(coalesce(p_desde, 0), 0);
    return;
  end if;

  if v_codigo is not null and length(v_codigo) >= 3 then
    return query
      select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro, t.origen, t.precio_neto, t.precio_anterior, t.precio_cambio_at
      from public.precios_distribuidor t
      where t.activo and t.codigo ilike v_codigo || '%'
        and (coalesce(array_length(p_proveedores, 1), 0) = 0 or t.distribuidor = any(p_proveedores))
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
         where t.activo and %s%s
       ) x
       order by (row_number() over (partition by x.distribuidor order by x.empieza desc, x.pesos asc nulls last) <= 5) desc,
                x.empieza desc, x.pesos asc nulls last
       limit $1',
      case when v_primera is null then 'true'
           else format('translate(lower(t.descripcion), %L, %L) ~ %L', 'áéíóúüñ', 'aeiouun', '^' || v_primera) end,
      v_condicion, v_prov)
    using least(greatest(coalesce(p_limite, 250), 1), 500);
  end if;
end;
$$;


revoke all on function public.buscar_precios3(text[], text, text, integer, text[], integer) from public, anon;
grant execute on function public.buscar_precios3(text[], text, text, integer, text[], integer) to authenticated;

create table if not exists public.listas_pendientes (
  id               bigint generated always as identity primary key,
  proveedor        text not null references public.proveedores(slug) on update cascade on delete cascade,
  archivo          text not null,             -- ruta en el bucket privado "listas"
  nombre_original  text,
  nota             text,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'procesada')),
  created_at       timestamptz not null default now()
);
alter table public.listas_pendientes enable row level security;
drop policy if exists listas_pendientes_admin on public.listas_pendientes;
create policy listas_pendientes_admin on public.listas_pendientes for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.listas_pendientes from anon;

-- Archivos de las listas: bucket privado, solo el administrador
insert into storage.buckets (id, name, public) values ('listas', 'listas', false) on conflict (id) do nothing;
drop policy if exists "Admin sube listas" on storage.objects;
create policy "Admin sube listas" on storage.objects for insert to authenticated
  with check (bucket_id = 'listas' and (select public.is_admin()));
drop policy if exists "Admin lee listas" on storage.objects;
create policy "Admin lee listas" on storage.objects for select to authenticated
  using (bucket_id = 'listas' and (select public.is_admin()));
drop policy if exists "Admin borra listas" on storage.objects;
create policy "Admin borra listas" on storage.objects for delete to authenticated
  using (bucket_id = 'listas' and (select public.is_admin()));

notify pgrst, 'reload schema';
