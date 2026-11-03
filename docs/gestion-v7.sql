-- docs/gestion-v7.sql — Mes de la lista de cada proveedor (se ve en el buscador: "Francar · ago 2026").
-- Lo guarda el panel al importar una lista. Los proveedores con robot muestran la fecha de su última corrida.
-- Se puede correr más de una vez.

alter table public.proveedores add column if not exists lista_mes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'proveedores_lista_mes_formato') then
    alter table public.proveedores add constraint proveedores_lista_mes_formato
      check (lista_mes is null or lista_mes ~ '^\d{4}-(0[1-9]|1[0-2])$');
  end if;
end $$;

-- Listas cargadas el 03/11/2026: el mes que dice cada archivo (las que no dicen fecha quedan con el de la carga)
update public.proveedores set lista_mes = v.mes
from (values ('francar', '2026-08'), ('chriva', '2026-08'), ('espindola', '2026-08'), ('gomeztorralba', '2026-07'),
             ('mello', '2026-09'), ('reposiciones', '2026-04'), ('senesa', '2026-11'), ('almas', '2026-11'),
             ('liquimoly', '2026-11'), ('joel', '2026-11')) as v(slug, mes)
where proveedores.slug = v.slug and proveedores.lista_mes is null;
