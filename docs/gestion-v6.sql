-- gestion-v6.sql — Búsqueda que encuentra palabras pegadas con "/" o "." (se puede correr más de una vez).
-- Problema: "FARO P/GOL" se guardaba como "faro pgol" y "OPT.DEL.IZQ" como "optdelizq": buscando "faro gol" u
-- "optica delantera" no aparecían. Ahora la columna guarda las DOS versiones del texto:
--   pegada   ("f100", "pgol")         → sigue encontrando "F-100" cuando se escribe "f100"
--   separada ("f 100", "p gol", "opt del izq") → encuentra cada palabra por su comienzo
-- Regenera la columna y su índice sobre toda la tabla (~1 minuto). Correrlo fuera de los horarios de los
-- robots (6, 12 y 18 h) para no competir con ellos.

do $$
begin
  -- Ya migrada: la expresión reemplaza - / . , por un espacio en algún lugar ('[-/.,]', ' ')
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'precios_distribuidor' and column_name = 'busqueda'
      and generation_expression like '%''[-/.,]''::text, '' ''::text%'
  ) then
    raise notice 'La columna busqueda ya tiene las dos versiones: nada que hacer';
    return;
  end if;

  drop index if exists public.idx_precios_busqueda_trgm;
  alter table public.precios_distribuidor drop column if exists busqueda;
  alter table public.precios_distribuidor add column busqueda text generated always as (
    translate(
      regexp_replace(
        lower(codigo || ' ' || descripcion || ' ' || coalesce(marca, '') || ' ' ||
              coalesce(rubro, '') || ' ' || coalesce(origen, '')),
        '[-/.,]', '', 'g')
      || ' ' ||
      regexp_replace(
        lower(codigo || ' ' || descripcion || ' ' || coalesce(marca, '') || ' ' ||
              coalesce(rubro, '') || ' ' || coalesce(origen, '')),
        '[-/.,]', ' ', 'g'),
      'áéíóúüñ', 'aeiouun')
  ) stored;
end $$;

create index if not exists idx_precios_busqueda_trgm
  on public.precios_distribuidor using gin (busqueda gin_trgm_ops);

analyze public.precios_distribuidor;
notify pgrst, 'reload schema';
