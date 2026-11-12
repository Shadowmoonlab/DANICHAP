-- gestion-v16.sql — Pedidos de Daniel del 11/11
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.

-- 1) Proveedor nuevo: PL Autopartes (tienda pl-autopartes.rdi.store). Sus precios los trae el robot diario.
insert into public.proveedores (slug, nombre, whatsapp, web, activo, orden)
values ('plautopartes', 'PL Autopartes', '1139150368', 'https://pl-autopartes.rdi.store/products', true,
        (select coalesce(max(orden), 0) + 1 from public.proveedores))
on conflict (slug) do update set nombre = excluded.nombre, web = excluded.web, activo = true;

-- 2) RIDA: en la sección "Adaptación" de su lista se leyó el código de fábrica de la pieza como si fuera el precio
--    (ej. 8200699903 = código Renault). Los precios reales de RIDA van de $48 a $70.903 y siempre con centavos;
--    los leídos mal son números enteros desde 741.649 para arriba (316 artículos). Se ocultan del buscador
--    hasta reimportar la lista con el precio correcto (no se borran: al reimportar se reemplazan solos).
update public.precios_distribuidor set activo = false
where distribuidor = 'rida' and precio_lista >= 700000 and precio_lista = trunc(precio_lista);
