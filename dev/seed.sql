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

-- ── v2: logística, cuenta corriente, costos, pedidos en camino ────────────
update public.proveedores set dias_visita = '{1,3,5}', pedido_minimo = 150000, notas = 'Reparto lunes, miércoles y viernes' where slug = 'dm';
update public.proveedores set dias_visita = '{0,1,2,3,4,5,6}' where slug = 'prautopartes';
update public.proveedores set dias_visita = '{2,4}', pedido_minimo = 60000 where slug = 'otero';
update public.config_negocio set alias_transferencia = 'DANICHAP.REPUESTOS' where id = 1;


-- Taller Gómez: compró fiado y pagó una parte → saldo pendiente
insert into public.ventas (cliente_id, cliente_nombre, medio_pago, total, costo_total, ganancia, created_at)
select id, nombre, 'cuenta_corriente', 182000, 100000, 82000, now() - interval '12 days' from public.clientes where nombre = 'Taller Gómez';
insert into public.ventas (cliente_id, cliente_nombre, medio_pago, total, costo_total, ganancia, created_at)
select id, nombre, 'cuenta_corriente', 95000, 52000, 43000, now() - interval '5 days' from public.clientes where nombre = 'Taller Gómez';
insert into public.pagos_clientes (cliente_id, monto, medio, notas, created_at)
select id, 150000, 'transferencia', 'Pago parcial', now() - interval '3 days' from public.clientes where nombre = 'Taller Gómez';
-- Juan Pérez: última compra hace 3 meses → aparece como inactivo
insert into public.ventas (cliente_id, cliente_nombre, medio_pago, total, costo_total, ganancia, created_at)
select id, nombre, 'efectivo', 25000, 14000, 11000, now() - interval '90 days' from public.clientes where nombre = 'Juan Pérez';

-- Costo de productos propios (vinculados al código del proveedor)
insert into public.productos_costos (producto_id, costo, proveedor, codigo_proveedor)
select id, 13500, 'prautopartes', 'PR-60001' from public.productos where nombre = 'Faro auxiliar LED universal 27W';
insert into public.productos_costos (producto_id, costo, proveedor, codigo_proveedor)
select id, 3200, 'otero', 'OT-5002' from public.productos where nombre = 'Lámpara H4 halógena 60/55W';

-- Pedido en camino a PR: sirve para probar el cruce de la recepción con lo pedido
insert into public.reposicion_items (codigo, descripcion, cantidad, precio_distribuidor_id, estado, pedido_at)
select codigo, descripcion, 10, id, 'pedido', now() - interval '1 day' from public.precios_distribuidor where codigo = 'PR-50013';
insert into public.reposicion_items (codigo, descripcion, cantidad, precio_distribuidor_id, estado, pedido_at)
select codigo, descripcion, 2, id, 'pedido', now() - interval '1 day' from public.precios_distribuidor where codigo = 'PR-20877';

-- Un presupuesto abierto
insert into public.presupuestos (cliente_id, cliente_nombre, items, total, valido_hasta)
select c.id, c.nombre, jsonb_build_array(jsonb_build_object(
  'producto_id', null, 'precio_distribuidor_id', p.id, 'codigo', p.codigo, 'descripcion', p.descripcion,
  'origen', 'DM', 'cantidad', 1, 'precio_unit', 81560, 'costo_unit', p.precio_neto)), 81560, current_date + 2
from public.clientes c, public.precios_distribuidor p
where c.nombre = 'Mecánica Los Hermanos' and p.codigo = '01/001/018';

-- Lecturas con IA de ejemplo (para el tablero de consumo)
insert into public.lecturas_ia (modelo, input_tokens, output_tokens) values ('claude-opus-5-5', 3100, 2400), ('claude-opus-5-5', 2800, 1900);
