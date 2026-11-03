-- docs/gestion-v11.sql — Cargar el costo de un artículo ya vendido (se puede correr más de una vez).
-- Problema: lo vendido "A mano" sin costo quedaba con ganancia $0 para siempre (ventas 16 y 17 de Daniel).
-- Ahora, desde Ventas → la venta → "Cargar costo", se pone el costo y se recalculan el costo y la ganancia de la
-- venta (el Libro diario los suma de ahí, así que también queda bien).

create or replace function public.cargar_costo_item(p_item bigint, p_costo numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venta bigint;
  v_anulada boolean;
  v_res jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede cambiar costos';
  end if;
  if p_costo is null or p_costo < 0 or p_costo > 1e9 then
    raise exception 'Costo inválido';
  end if;
  select i.venta_id, v.anulada into v_venta, v_anulada
  from public.venta_items i join public.ventas v on v.id = i.venta_id
  where i.id = p_item;
  if v_venta is null then raise exception 'Artículo de venta inexistente'; end if;
  if v_anulada then raise exception 'La venta está anulada'; end if;

  update public.venta_items set costo_unit = round(p_costo, 2) where id = p_item;

  -- Mismo cálculo que registrar_venta
  update public.ventas v
  set costo_total = s.costo, ganancia = s.ganancia
  from (
    select sum(cantidad * coalesce(costo_unit, 0)) as costo,
           coalesce(sum(cantidad * (precio_unit - costo_unit)) filter (where costo_unit is not null), 0) as ganancia
    from public.venta_items where venta_id = v_venta
  ) s
  where v.id = v_venta
  returning jsonb_build_object('venta', v.id, 'costo_total', v.costo_total, 'ganancia', v.ganancia) into v_res;
  return v_res;
end;
$$;

revoke all on function public.cargar_costo_item(bigint, numeric) from public, anon;
grant execute on function public.cargar_costo_item(bigint, numeric) to authenticated;

notify pgrst, 'reload schema';
