-- gestion-v15.sql — Corregir o anular una recepción de mercadería cargada mal (pedido de Daniel, 11/11)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- anular_recepcion(id):    devuelve el stock que sumó esa carga, vuelve a "pedido" lo que había marcado como recibido
--                          y la borra (el Libro diario la deja de contar: lee las compras de la tabla recepciones).
-- corregir_recepcion(id,p): anula la carga vieja y graba la corregida en UNA sola transacción: si algo falla
--                          no se pierde nada. Usa confirmar_recepcion para la nueva, con las mismas reglas.

create or replace function public.deshacer_recepcion(p_id bigint, p_piso_cero boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it record;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede corregir mercadería';
  end if;
  if not exists (select 1 from public.recepciones where id = p_id) then
    raise exception 'No existe la recepción Nº %', p_id;
  end if;

  for it in select * from public.recepcion_items where recepcion_id = p_id loop
    -- 'stock' y 'crear' sumaron stock a un producto: se le resta lo mismo
    if it.accion in ('stock', 'crear') and it.producto_id is not null then
      update public.productos
      set stock_cantidad = case when p_piso_cero then greatest(0, coalesce(stock_cantidad, 0) - it.cantidad)
                                else coalesce(stock_cantidad, 0) - it.cantidad end
      where id = it.producto_id;
    end if;
    if it.reposicion_item_id is not null then
      update public.reposicion_items set estado = 'pedido', recibido_at = null
      where id = it.reposicion_item_id and estado = 'recibido';
    end if;
  end loop;

  delete from public.recepciones where id = p_id;   -- los renglones se borran en cascada
end;
$$;

create or replace function public.anular_recepcion(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.deshacer_recepcion(p_id, true);
end;
$$;

create or replace function public.corregir_recepcion(p_id bigint, p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nuevo bigint;
  v_ids   uuid[] := array(select producto_id from public.recepcion_items where recepcion_id = p_id and producto_id is not null);
begin
  -- Sin piso en cero: si de esa carga ya se vendió algo, la cuenta queda bien al volver a sumar la corregida
  perform public.deshacer_recepcion(p_id, false);
  v_nuevo := public.confirmar_recepcion(p);
  -- Si a un producto de la carga vieja le quedó stock negativo (se sacó un renglón ya vendido), queda en cero
  update public.productos set stock_cantidad = 0 where id = any(v_ids) and stock_cantidad < 0;
  return v_nuevo;
end;
$$;

revoke all on function public.deshacer_recepcion(bigint, boolean) from public, anon;
revoke all on function public.anular_recepcion(bigint) from public, anon;
revoke all on function public.corregir_recepcion(bigint, jsonb) from public, anon;
grant execute on function public.anular_recepcion(bigint) to authenticated;
grant execute on function public.corregir_recepcion(bigint, jsonb) to authenticated;
grant execute on function public.deshacer_recepcion(bigint, boolean) to authenticated;
