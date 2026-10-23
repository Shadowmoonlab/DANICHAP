-- ═══════════════════════════════════════════════════════════════════════════
-- dev/seed.sql — Datos de prueba del ambiente LOCAL
-- Usuarios: admin@danichap.test (admin) y cliente@danichap.test (cliente)
-- Contraseña de ambos en el ambiente local: danichap-dev   (ver dev/config.mjs)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Usuarios (el trigger handle_new_user crea el perfil como 'cliente') ───
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'admin@danichap.test',   '{"nombre": "Daniel (prueba)"}'),
  ('00000000-0000-4000-8000-000000000002', 'cliente@danichap.test', '{"nombre": "Cliente de prueba"}')
on conflict (id) do nothing;
update public.perfiles set rol = 'admin' where id = '00000000-0000-4000-8000-000000000001';

-- ── Datos del negocio ─────────────────────────────────────────────────────
update public.config_negocio set
  direccion = 'Av. Hipólito Yrigoyen 19608, Longchamps',
  telefono  = '11 2278-4750',
  redondeo  = 10
where id = 1;

-- ── Catálogo propio (web) ─────────────────────────────────────────────────
insert into public.productos (nombre, categoria, marca_rep, modelo, precio, stock, stock_cantidad, destacado, badge) values
  ('Faro auxiliar LED universal 27W',            'faros',        'Universal', null,                 25000,  true, 6,    true,  'NUEVO'),
  ('Óptica delantera Gol Trend 2013 derecha',    'opticas',      'Volkswagen','Gol Trend',          89000,  true, 2,    true,  null),
  ('Paragolpes delantero Corsa Classic',         'paragolpes',   'Chevrolet', 'Corsa Classic',      112000, true, 1,    false, 'OFERTA'),
  ('Espejo retrovisor Fiesta Kinetic izquierdo', 'chaperio',     'Ford',      'Fiesta Kinetic',     54000,  true, 0,    false, null),
  ('Aceite Liqui Moly Molygen 5W-30 4L',         'limpieza',     'Liqui Moly', null,                160000, true, 12,   true,  'POPULAR'),
  ('Lámpara H4 halógena 60/55W',                 'iluminacion',  'Universal', null,                 6500,   true, null, false, null)
on conflict do nothing;

-- ── Clientes ──────────────────────────────────────────────────────────────
insert into public.clientes (nombre, cuit_dni, telefono, email, localidad, notas) values
  ('Taller Gómez',         '20-12345678-9', '11 5555-1234', 'tallergomez@example.com', 'Longchamps', 'Cliente fijo, paga a fin de mes'),
  ('Mecánica Los Hermanos','30-71234567-1', '11 4444-9876', 'loshermanos@example.com', 'Burzaco',    null),
  ('Juan Pérez',           '28123456',      '11 3333-2222', null,                      'Glew',       null);

-- ── Precios de distribuidores (muestra; los robots cargan los reales) ─────
insert into public.precios_distribuidor
  (distribuidor, codigo, descripcion, marca, rubro, origen, precio_lista, precio_neto, precio_anterior, precio_cambio_at, imagen_url) values
  -- DM (datos reales de su catálogo)
  ('dm', '01/001/001', 'AROS DE FARO FALCON 66/69 DERECHO',                    'FORD', 'AROS DE FARO', 'ORIGINAL', 32000.00, 27648.00, null, null, null),
  ('dm', '01/001/018', 'AROS DE FARO F-100 81/87 DERECHO',                     'FORD', 'AROS DE FARO', 'NACIONAL', 51867.88, 44813.85, 42000, now() - interval '2 days', null),
  ('dm', '01/002/004', 'AMORTIGUADORES DE PORTON ECOSPORT 03/12',              'FORD', 'AMORTIGUADORES DE PORTON', 'NACIONAL', 14979.00, 12941.07, null, null, null),
  ('dm', '01/005/012', 'BURLETES DE PUERTAS GALAXY DELANTERO PARAVIENTO JUEGO','FORD', 'BURLETES DE PUERTAS', 'FACO', 27636.23, 23877.70, null, null, null),
  ('dm', '01/014/042', 'ESPEJOS SIERRA C/CONTROL DERECHO',                     'FORD', 'ESPEJOS', 'IMPORTADO', 84634.16, 73123.91, null, null, null),
  ('dm', '01/014/127', 'ESPEJOS TRANSIT 01/10 BRAZO CORTO DERECHO',            'FORD', 'ESPEJOS', 'IMPORTADO', 159473.60, 137785.19, null, null, null),
  ('dm', '02/027/072', 'PARAGOLPES SIENA 97/01 TRASERO NEGRO',                 'FIAT-ALFA ROMEO', 'PARAGOLPES', 'NACIONAL', 120555.56, 104160.00, 98500, now() - interval '1 day', null),
  ('dm', '02/028/014', 'GRILLAS PARAG-PARANTE-CAPOT PALIO 08/ MARCO INFERIOR PARAGOLPE DEL CROMADO', 'FIAT-ALFA ROMEO', 'GRILLAS PARAG-PARANTE-CAPOT', 'IMPORTADO', 43036.07, 37183.16, null, null, null),
  ('dm', '05/011/220', 'OPTICAS GOL TREND 13/ DERECHA',                        'VOLKSWAGEN', 'OPTICAS', 'IMPORTADO', 61200.00, 52876.80, null, null, null),
  ('dm', '06/040/031', 'PARAGOLPES CORSA CLASSIC 10/ DELANTERO',               'CHEVROLET', 'PARAGOLPES', 'NACIONAL', 76800.00, 66355.20, null, null, null),
  -- PR Autopartes (ejemplo)
  ('prautopartes', 'PR-10231', 'ARO FARO FORD F100 81/87 DERECHO',             'FORD', 'OPTICA', 'NACIONAL', 50100.00, 43590.00, null, null, null),
  ('prautopartes', 'PR-20877', 'PARAGOLPE TRASERO FIAT SIENA 97/01 NEGRO',     'FIAT', 'CARROCERIA', 'NACIONAL', 112000.00, 99500.00, null, null, null),
  ('prautopartes', 'PR-30410', 'OPTICA VW GOL TREND 2013 DER',                 'VOLKSWAGEN', 'OPTICA', 'IMPORTADO', 63500.00, 55245.00, null, null, null),
  ('prautopartes', 'PR-40552', 'AMORTIGUADOR PORTON ECOSPORT 2003/2012',       'FORD', 'AMORTIGUADORES', 'IMPORTADO', 13800.00, 12006.00, null, null, null),
  ('prautopartes', 'PR-50013', 'LAMPARA H4 12V 60/55W',                        'UNIVERSAL', 'LAMPARAS', 'IMPORTADO', 4200.00, 3654.00, null, null, null),
  -- Autopartes Otero (ejemplo)
  ('otero', 'OT-0118', 'ARO DE FARO F-100 81/87 DER CROMADO',                  'FORD', 'OPTICAS', 'NACIONAL', 54200.00, 47154.00, null, null, null),
  ('otero', 'OT-2290', 'PARAGOLPE DEL CORSA CLASSIC 2010 EN ADELANTE',         'CHEVROLET', 'PARAGOLPES', 'NACIONAL', 71500.00, 62205.00, null, null, null),
  ('otero', 'OT-3341', 'ESPEJO SIERRA CON CONTROL DERECHO',                    'FORD', 'ESPEJOS', 'IMPORTADO', 88000.00, 76560.00, null, null, null),
  ('otero', 'OT-5002', 'LAMPARA HALOGENA H4 60/55W',                           'UNIVERSAL', 'LAMPARAS', 'NACIONAL', 4500.00, 3915.00, null, null, null)
on conflict (distribuidor, codigo) do nothing;

-- ── Historial de robots ───────────────────────────────────────────────────
insert into public.scraper_runs (distribuidor, inicio, fin, ok, productos, error) values
  ('dm',           now() - interval '3 hours', now() - interval '179 minutes', true,  10, null),
  ('prautopartes', now() - interval '3 hours', now() - interval '178 minutes', true,  5,  null),
  ('otero',        now() - interval '3 hours', now() - interval '178 minutes', false, null, 'Ejemplo: login rechazado');
