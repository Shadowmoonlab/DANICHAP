-- gestion-v4.sql — Arreglos de la revisión de octubre 2026 (se puede correr más de una vez).
--  1. anular_venta: anular una venta devuelve el stock, saca lo pendiente de Reposición y reabre el presupuesto.
--     Una venta anulada no se puede "desanular" desde la API.
--  2. Borrar un cliente que tiene ventas o pagos queda bloqueado (antes borraba sus pagos de la caja y su deuda).
--  3. Misma factura cargada dos veces: el control ahora incluye las facturas sin proveedor y no distingue mayúsculas.
--  4. Precios, costos y totales no pueden ser negativos.

-- ── 1. Anular venta de forma completa y atómica ─────────────────────────
create or replace function public.anular_venta(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede anular ventas';
  end if;

  update public.ventas set anulada = true where id = p_id and not anulada;
  if not found then
    raise exception 'La venta Nº % no existe o ya estaba anulada', p_id;
  end if;

  -- Lo vendido vuelve al stock (solo productos que llevan cantidad)
  update public.productos p
  set stock_cantidad = p.stock_cantidad + vi.cantidad,
      stock          = true
  from (select producto_id, sum(cantidad) as cantidad
        from public.venta_items where venta_id = p_id and producto_id is not null
        group by producto_id) vi
  where p.id = vi.producto_id and p.stock_cantidad is not null;

  -- Lo que todavía no se pidió al proveedor ya no hace falta pedirlo
  update public.reposicion_items
  set estado = 'descartado'
  where estado = 'pendiente'
    and venta_item_id in (select id from public.venta_items where venta_id = p_id);

  -- El presupuesto del que salió la venta vuelve a quedar abierto
  update public.presupuestos set estado = 'abierto', venta_id = null where venta_id = p_id;
end;
$$;

revoke all on function public.anular_venta(bigint) from public, anon;
grant execute on function public.anular_venta(bigint) to authenticated;

-- Una venta anulada no vuelve a contar (se haría sin devolver nada y descuadraría caja y stock)
create or replace function public.ventas_no_desanular()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anulada and not new.anulada then
    raise exception 'Una venta anulada no se puede reactivar: cargala de nuevo';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ventas_no_desanular on public.ventas;
create trigger trg_ventas_no_desanular before update on public.ventas
  for each row execute function public.ventas_no_desanular();

-- ── 2. No borrar clientes con historial ─────────────────────────────────
alter table public.pagos_clientes drop constraint if exists pagos_clientes_cliente_id_fkey;
alter table public.pagos_clientes add constraint pagos_clientes_cliente_id_fkey
  foreign key (cliente_id) references public.clientes(id) on delete restrict;

alter table public.ventas drop constraint if exists ventas_cliente_id_fkey;
alter table public.ventas add constraint ventas_cliente_id_fkey
  foreign key (cliente_id) references public.clientes(id) on delete restrict;

-- ── 3. Misma factura dos veces ──────────────────────────────────────────
-- Si ya hay duplicados cargados, el índice nuevo no se puede crear: se deja el anterior y se avisa.
do $$
begin
  if exists (
    select 1 from public.recepciones where nro_comprobante is not null
    group by coalesce(proveedor, ''), upper(nro_comprobante) having count(*) > 1
  ) then
    raise notice 'Hay comprobantes repetidos ya cargados: se mantiene el control anterior';
  else
    drop index if exists public.uq_recepcion_comprobante;
    create unique index uq_recepcion_comprobante
      on public.recepciones (coalesce(proveedor, ''), upper(nro_comprobante)) where nro_comprobante is not null;
  end if;
end $$;

-- ── 4. Sin montos negativos (not valid: no revisa lo ya cargado, sí todo lo nuevo) ──
do $$
declare
  r record;
begin
  for r in select * from (values
    ('venta_items',      'precio_unit', 'ck_venta_items_precio_pos'),
    ('venta_items',      'costo_unit',  'ck_venta_items_costo_pos'),
    ('productos',        'precio',      'ck_productos_precio_pos'),
    ('productos_costos', 'costo',       'ck_productos_costos_costo_pos'),
    ('presupuestos',     'total',       'ck_presupuestos_total_pos'),
    ('recepcion_items',  'costo_unit',  'ck_recepcion_items_costo_pos')
  ) as t(tabla, columna, nombre)
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = r.tabla and column_name = r.columna)
       and not exists (select 1 from pg_constraint where conname = r.nombre) then
      execute format('alter table public.%I add constraint %I check (%I is null or %I >= 0) not valid',
                     r.tabla, r.nombre, r.columna, r.columna);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
