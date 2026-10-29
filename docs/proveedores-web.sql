-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Página web de cada proveedor + Ópticas LAM (29/10/2026)
-- El Mostrador muestra "Buscalo en sus webs": un toque copia lo buscado y abre la web del proveedor
-- (para los que el robot no puede leer: login con captcha, anti-robot, o sin lista automática todavía).
-- busqueda_url: si la web acepta la búsqueda en la dirección, {q} se reemplaza por lo buscado.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.proveedores add column if not exists web text;
alter table public.proveedores add column if not exists busqueda_url text;

insert into public.proveedores (slug, nombre, orden) values ('opticaslam', 'Ópticas LAM', 140)
on conflict (slug) do nothing;

update public.proveedores p set web = coalesce(p.web, v.web), busqueda_url = coalesce(p.busqueda_url, v.busqueda)
from (values
  ('dm',                 'https://dmcompras.com/',                          null),
  ('prautopartes',       'https://prautopartes.com.ar/',                    null),
  ('delviso',            'https://metalurgicadelviso.com.ar/',              null),
  ('cromosol',           'http://slaweb.cromosol.com/login',                null),
  ('otero',              'https://www.autopartesotero.com.ar/lista.php',    null),
  ('goicoechea',         'https://goicoechea.com.ar/cuenta/buscador',       null),
  ('distrisuper',        'https://lupa.distrisuper.com/',                   null),
  ('fal',                'https://autopartesfal.com/',                      'https://autopartesfal.com/?s={q}&post_type=product'),
  ('distriferr',         'https://clientes.distriferr.com.ar/ingreso/',     null),
  ('primeraalternativa', 'https://www.laprimeraalternativa.com.ar/login/',  null),
  ('tytsa',              'https://www.tytsa.com.ar/',                       null),
  ('opticaslam',         'https://opticaslam.com.ar/',                      null)
) as v(slug, web, busqueda)
where p.slug = v.slug;

notify pgrst, 'reload schema';
