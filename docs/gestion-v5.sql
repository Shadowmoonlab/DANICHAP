-- gestion-v5.sql — Listas por proveedor, moneda y cotización (se puede correr más de una vez).
--  1. Proveedores nuevos que mandan lista en Excel / PDF.
--  2. Moneda por proveedor (La Primera Alternativa lista en dólares) y cotización en Ajustes:
--     los precios se guardan como vienen en la lista y el panel los pasa a pesos con la cotización del día.
--  3. Importación de listas por lotes (listas grandes como Reposiciones, ~10.000 artículos):
--     cada lote es corto (no llega al límite de tiempo de la API) y solo se reescribe lo que cambió.

-- ── 1. Proveedores nuevos ───────────────────────────────────────────────
insert into public.proveedores (slug, nombre, activo, orden) values
  ('francar',       'Francar',          true, 150),
  ('chriva',        'Chriva',           true, 160),
  ('espindola',     'Espíndola',        true, 170),
  ('gomeztorralba', 'Gómez Torralba',   true, 180),
  ('senesa',        'Senesa',           true, 190),
  ('almas',         'Almas',            true, 200),
  ('reposiciones',  'Reposiciones',     true, 210),
  ('joel',          'Joel Enganches',   true, 220),
  ('mello',         'Mello',            true, 230)
on conflict (slug) do nothing;

-- ── 2. Moneda y cotización ──────────────────────────────────────────────
alter table public.proveedores add column if not exists moneda text not null default 'ARS';
alter table public.proveedores drop constraint if exists proveedores_moneda_check;
alter table public.proveedores add constraint proveedores_moneda_check check (moneda in ('ARS', 'USD', 'EUR'));
update public.proveedores set moneda = 'USD' where slug = 'primeraalternativa' and moneda = 'ARS';

alter table public.config_negocio add column if not exists cotizacion_usd numeric(12,2) not null default 1400;
alter table public.config_negocio add column if not exists cotizacion_eur numeric(12,2) not null default 1600;
alter table public.config_negocio drop constraint if exists config_cotizacion_pos;
alter table public.config_negocio add constraint config_cotizacion_pos check (cotizacion_usd > 0 and cotizacion_eur > 0);

-- ── 3. Importar listas por lotes ────────────────────────────────────────
-- Un lote de filas de UNA lista. Devuelve cuántas filas eran nuevas o cambiaron.
create or replace function public.importar_lista_lote(p_proveedor text, p_rows jsonb)
returns integer
language plpgsql
security definer          -- usa sincronizar_precios (reservada a service_role); valida admin acá
set search_path = ''
as $$
declare
  v_filas jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede importar listas';
  end if;
  if not exists (select 1 from public.proveedores where slug = p_proveedor) then
    raise exception 'Proveedor desconocido: %', p_proveedor;
  end if;
  -- Código repetido dentro del lote: queda la última aparición (como en importar_lista_precios)
  select coalesce(jsonb_agg(r || jsonb_build_object('distribuidor', p_proveedor)), '[]'::jsonb)
  into v_filas
  from (
    select distinct on (e.r->>'codigo') e.r
    from jsonb_array_elements(p_rows) with ordinality as e(r, n)
    where nullif(trim(e.r->>'codigo'), '') is not null and nullif(trim(e.r->>'descripcion'), '') is not null
      and coalesce((e.r->>'precio_neto')::numeric, 0) >= 0
    order by e.r->>'codigo', e.n desc
  ) x;
  if jsonb_array_length(v_filas) = 0 then return 0; end if;
  return public.sincronizar_precios(v_filas, now());
end;
$$;

-- Cierra la importación: si se reemplaza la lista, lo que no vino queda como "ya no figura"; deja registro.
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

revoke all on function public.importar_lista_lote(text, jsonb)                          from public, anon;
revoke all on function public.finalizar_importacion(text, text[], boolean, integer)      from public, anon;
grant execute on function public.importar_lista_lote(text, jsonb)                        to authenticated;
grant execute on function public.finalizar_importacion(text, text[], boolean, integer)   to authenticated;

-- ── 4. Búsqueda tolerante a errores de tipeo ("paragople" → "paragolpe") ─
-- Solo se usa cuando la búsqueda exacta no encontró nada. Usa el mismo índice trigram de la columna busqueda.
-- security invoker: respeta RLS (solo el admin ve precios de proveedores). pg_trgm está en "extensions"
-- en Supabase y en "public" en el ambiente local: el search_path incluye los dos.
create or replace function public.buscar_parecidos(p_q text, p_limite integer default 40)
returns table (id bigint, distribuidor text, codigo text, descripcion text, marca text, rubro text,
               precio_neto numeric, precio_anterior numeric, precio_cambio_at timestamptz, parecido real)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_palabras text[];
  v_principal text;
begin
  -- Cada palabra tiene que parecerse a alguna palabra del artículo ("paragople corsa": las dos);
  -- la más larga usa el índice y las demás se controlan sobre esos candidatos
  select array_agg(w order by length(w) desc) into v_palabras
  from unnest(regexp_split_to_array(lower(trim(coalesce(p_q, ''))), '\s+')) w where length(w) >= 3;
  if v_palabras is null then return; end if;
  v_principal := v_palabras[1];
  perform set_config('pg_trgm.word_similarity_threshold', '0.5', true);
  return query
    select t.id, t.distribuidor, t.codigo, t.descripcion, t.marca, t.rubro,
           t.precio_neto, t.precio_anterior, t.precio_cambio_at,
           (select avg(word_similarity(w, t.busqueda)) from unnest(v_palabras) w)::real
    from public.precios_distribuidor t
    where t.activo and v_principal <% t.busqueda
      and (select bool_and(w <% t.busqueda) from unnest(v_palabras) w)
    order by 10 desc, t.precio_neto nulls last
    limit least(greatest(p_limite, 1), 100);
end;
$$;

revoke all on function public.buscar_parecidos(text, integer) from public, anon;
grant execute on function public.buscar_parecidos(text, integer) to authenticated;

notify pgrst, 'reload schema';
