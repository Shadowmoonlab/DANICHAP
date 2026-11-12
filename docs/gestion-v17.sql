-- gestion-v17.sql — Anular una venta devuelve al stock solo lo que esa venta descontó (12/11)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- Antes: se vendían 5 de un producto con 2 en stock → el stock quedaba en 0 (no baja de cero); al anular la venta
-- volvían las 5 y el stock quedaba en 5 (inflado). Ahora cada renglón guarda cuánto descontó de verdad
-- (stock_descontado) y al anular se devuelve exactamente eso. Las ventas viejas (sin ese dato) siguen como antes.

alter table public.venta_items add column if not exists stock_descontado integer;

create or replace function public.registrar_venta(p_venta jsonb)
returns bigint
language plpgsql
set search_path = ''
as $function$
declare
  v_id      bigint;
  v_item_id bigint;
  it        jsonb;
  v_cant    integer;
  v_costo   numeric;
  v_antes   integer;
  v_pago    text := coalesce(nullif(p_venta->>'medio_pago', ''), 'efectivo');
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede registrar ventas';
  end if;
  if jsonb_array_length(coalesce(p_venta->'items', '[]'::jsonb)) = 0 then
    raise exception 'La venta no tiene artículos';
  end if;
  if v_pago = 'cuenta_corriente' and nullif(p_venta->>'cliente_id', '') is null then
    raise exception 'Para vender en cuenta corriente elegí un cliente cargado';
  end if;

  insert into public.ventas (cliente_id, cliente_nombre, medio_pago, notas, impreso)
  values (
    nullif(p_venta->>'cliente_id', '')::bigint,
    nullif(p_venta->>'cliente_nombre', ''),
    v_pago,
    nullif(p_venta->>'notas', ''),
    coalesce((p_venta->>'impreso')::boolean, false)
  )
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_venta->'items') loop
    v_cant := (it->>'cantidad')::integer;
    -- Costo: el que manda el mostrador, o el costo cargado del producto propio
    v_costo := coalesce(
      nullif(it->>'costo_unit', '')::numeric,
      (select pc.costo from public.productos_costos pc where pc.producto_id = nullif(it->>'producto_id', '')::uuid)
    );

    insert into public.venta_items
      (venta_id, producto_id, precio_distribuidor_id, codigo, descripcion, cantidad, precio_unit, costo_unit)
    values (
      v_id,
      nullif(it->>'producto_id', '')::uuid,
      nullif(it->>'precio_distribuidor_id', '')::bigint,
      it->>'codigo',
      it->>'descripcion',
      v_cant,
      (it->>'precio_unit')::numeric,
      v_costo
    )
    returning id into v_item_id;

    if coalesce((it->>'reponer')::boolean, true) then
      insert into public.reposicion_items (venta_item_id, codigo, descripcion, cantidad, precio_distribuidor_id)
      values (v_item_id, it->>'codigo', it->>'descripcion', v_cant, nullif(it->>'precio_distribuidor_id', '')::bigint);
    end if;

    if nullif(it->>'producto_id', '') is not null then
      -- "for update": dos ventas del mismo producto a la vez no leen el mismo stock
      select stock_cantidad into v_antes from public.productos
      where id = (it->>'producto_id')::uuid for update;
      if v_antes is not null then
        update public.productos
        set stock_cantidad = greatest(v_antes - v_cant, 0),
            stock          = case when v_antes - v_cant <= 0 then false else stock end
        where id = (it->>'producto_id')::uuid;
        -- Lo que de verdad salió del stock (no se puede descontar más de lo que había)
        update public.venta_items set stock_descontado = least(v_cant, greatest(v_antes, 0)) where id = v_item_id;
      end if;
    end if;
  end loop;

  update public.ventas v
  set total       = s.total,
      costo_total = s.costo,
      ganancia    = s.ganancia
  from (
    select sum(cantidad * precio_unit) as total,
           sum(cantidad * coalesce(costo_unit, 0)) as costo,
           coalesce(sum(cantidad * (precio_unit - costo_unit)) filter (where costo_unit is not null), 0) as ganancia
    from public.venta_items where venta_id = v_id
  ) s
  where v.id = v_id;

  -- Si venía de un presupuesto, queda marcado como vendido
  if nullif(p_venta->>'presupuesto_id', '') is not null then
    update public.presupuestos set estado = 'vendido', venta_id = v_id
    where id = (p_venta->>'presupuesto_id')::bigint;
  end if;

  return v_id;
end;
$function$;

create or replace function public.anular_venta(p_id bigint)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede anular ventas';
  end if;

  update public.ventas set anulada = true where id = p_id and not anulada;
  if not found then
    raise exception 'La venta Nº % no existe o ya estaba anulada', p_id;
  end if;

  -- Vuelve al stock lo que esa venta descontó (las ventas anteriores a v17 no lo guardaban: se devuelve lo vendido)
  update public.productos p
  set stock_cantidad = p.stock_cantidad + vi.cantidad,
      stock          = case when p.stock_cantidad + vi.cantidad > 0 then true else p.stock end
  from (select producto_id, sum(coalesce(stock_descontado, cantidad)) as cantidad
        from public.venta_items where venta_id = p_id and producto_id is not null
        group by producto_id) vi
  where p.id = vi.producto_id and p.stock_cantidad is not null and vi.cantidad > 0;

  -- Lo que todavía no se pidió al proveedor ya no hace falta pedirlo
  update public.reposicion_items
  set estado = 'descartado'
  where estado = 'pendiente'
    and venta_item_id in (select id from public.venta_items where venta_id = p_id);

  -- El presupuesto del que salió la venta vuelve a quedar abierto
  update public.presupuestos set estado = 'abierto', venta_id = null where venta_id = p_id;
end;
$function$;
