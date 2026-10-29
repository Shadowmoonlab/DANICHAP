-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Libro diario: compras, ventas, gastos y resultado por día / mes / año (29/10/2026)
-- Correr DESPUÉS de add-gestion-v2.sql. Idempotente.
--
-- Fuentes (ya existen):  ventas (+costo y ganancia) · pagos_clientes (cobros de cuenta corriente)
--                        recepciones (compras a proveedores)
-- Nueva:                 movimientos (gastos del local, otros ingresos y retiros del dueño)
-- Los totales se calculan en la base (libro_resumen): rápido aunque haya años de ventas.
-- Todo en hora de Argentina: una venta de las 23:30 cuenta en ese día, no en el siguiente (UTC).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.movimientos (
  id          bigint generated always as identity primary key,
  fecha       date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  tipo        text not null check (tipo in ('gasto', 'ingreso', 'retiro')),
  categoria   text not null,
  descripcion text,
  monto       numeric(12,2) not null check (monto > 0),
  medio       text not null default 'efectivo' check (medio in ('efectivo', 'transferencia', 'debito', 'credito', 'otro')),
  anulado     boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_movimientos_fecha on public.movimientos (fecha);
create index if not exists idx_recepciones_fecha on public.recepciones (fecha);
create index if not exists idx_pagos_created     on public.pagos_clientes (created_at);

alter table public.movimientos enable row level security;
drop policy if exists movimientos_admin_all on public.movimientos;
create policy movimientos_admin_all on public.movimientos for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.movimientos from anon;

-- ── Totales agrupados por día o mes ─────────────────────────────────────────
-- resultado = ganancia bruta de las ventas − gastos. La caja (lo que entró y salió de verdad) va aparte:
-- lo fiado entra recién cuando el cliente paga, y las compras salen el día que se recibieron.
create or replace function public.libro_resumen(p_desde date, p_hasta date, p_agrupar text default 'day')
returns table (
  periodo date, cant_ventas integer, ventas numeric, costo numeric, ganancia numeric, fiado numeric,
  cobros numeric, compras numeric, gastos numeric, otros_ingresos numeric, retiros numeric
)
language plpgsql
stable
security invoker          -- respeta el RLS: solo el administrador ve datos
set search_path = ''
as $$
#variable_conflict use_column   -- columnas de salida con el mismo nombre que columnas de tablas
begin
  if not (select public.is_admin()) then raise exception 'Solo el administrador puede ver el libro diario'; end if;
  if p_agrupar not in ('day', 'month') then raise exception 'p_agrupar debe ser day o month'; end if;

  return query
  with
  v as (
    select date_trunc(p_agrupar, (created_at at time zone 'America/Argentina/Buenos_Aires'))::date as p,
           count(*)::integer as n, sum(total) as tot, sum(costo_total) as cos, sum(ganancia) as gan,
           sum(total) filter (where medio_pago = 'cuenta_corriente') as fia
    from public.ventas
    where not anulada
      and created_at >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
      and created_at <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    group by 1
  ),
  c as (
    select date_trunc(p_agrupar, (created_at at time zone 'America/Argentina/Buenos_Aires'))::date as p, sum(monto) as tot
    from public.pagos_clientes
    where not anulado
      and created_at >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
      and created_at <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    group by 1
  ),
  r as (
    select date_trunc(p_agrupar, rr.fecha)::date as p,
           sum(coalesce(rr.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = rr.id), 0)) as tot
    from public.recepciones rr
    where rr.fecha between p_desde and p_hasta
    group by 1
  ),
  m as (
    select date_trunc(p_agrupar, fecha)::date as p,
           sum(monto) filter (where tipo = 'gasto')   as gas,
           sum(monto) filter (where tipo = 'ingreso') as ing,
           sum(monto) filter (where tipo = 'retiro')  as ret
    from public.movimientos
    where not anulado and fecha between p_desde and p_hasta
    group by 1
  ),
  periodos as (select p from v union select p from c union select p from r union select p from m)
  select pe.p,
         coalesce(v.n, 0), coalesce(v.tot, 0), coalesce(v.cos, 0), coalesce(v.gan, 0), coalesce(v.fia, 0),
         coalesce(c.tot, 0), coalesce(r.tot, 0), coalesce(m.gas, 0), coalesce(m.ing, 0), coalesce(m.ret, 0)
  from periodos pe
  left join v on v.p = pe.p left join c on c.p = pe.p left join r on r.p = pe.p left join m on m.p = pe.p
  order by pe.p;
end;
$$;

-- ── Todos los movimientos de un rango (para ver un día en detalle) ──────────
-- importe = monto de la operación (una venta fiada tiene importe pero no ingreso: entra a caja al cobrarla)
drop function if exists public.libro_movimientos(date, date);
create or replace function public.libro_movimientos(p_desde date, p_hasta date)
returns table (
  momento timestamptz, tipo text, ref_id bigint, detalle text, categoria text, medio text,
  importe numeric, ingreso numeric, egreso numeric, ganancia numeric, anulado boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column   -- columnas de salida con el mismo nombre que columnas de tablas
declare
  v_ini timestamptz := p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_fin timestamptz := (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
begin
  if not (select public.is_admin()) then raise exception 'Solo el administrador puede ver el libro diario'; end if;
  if p_hasta - p_desde > 92 then raise exception 'El detalle se pide por día o mes (máximo 3 meses)'; end if;

  return query
  select * from (
    select vv.created_at, 'venta'::text, vv.id, coalesce(vv.cliente_nombre, 'Consumidor final'), null::text, vv.medio_pago, vv.total,
           case when vv.medio_pago = 'cuenta_corriente' then 0::numeric else vv.total end, 0::numeric, vv.ganancia, vv.anulada
    from public.ventas vv where vv.created_at >= v_ini and vv.created_at < v_fin
    union all
    select pc.created_at, 'cobro', pc.id, coalesce(cl.nombre, 'Cliente') || coalesce(' · ' || pc.notas, ''), null, pc.medio,
           pc.monto, pc.monto, 0, null, pc.anulado
    from public.pagos_clientes pc left join public.clientes cl on cl.id = pc.cliente_id
    where pc.created_at >= v_ini and pc.created_at < v_fin
    union all
    select (rr.fecha::timestamp + time '12:00') at time zone 'America/Argentina/Buenos_Aires', 'compra', rr.id,
           coalesce(rr.proveedor, 'Proveedor') || coalesce(' · Nº ' || rr.nro_comprobante, ''), null, null,
           coalesce(rr.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = rr.id), 0),
           0, coalesce(rr.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = rr.id), 0), null, false
    from public.recepciones rr where rr.fecha between p_desde and p_hasta
    union all
    select (mm.fecha::timestamp + (mm.created_at at time zone 'America/Argentina/Buenos_Aires')::time) at time zone 'America/Argentina/Buenos_Aires',
           mm.tipo, mm.id, coalesce(mm.descripcion, mm.categoria), mm.categoria, mm.medio, mm.monto,
           case when mm.tipo = 'ingreso' then mm.monto else 0 end, case when mm.tipo = 'ingreso' then 0 else mm.monto end, null, mm.anulado
    from public.movimientos mm where mm.fecha between p_desde and p_hasta
  ) x
  order by 1;
end;
$$;

revoke all on function public.libro_resumen(date, date, text)  from public, anon;
revoke all on function public.libro_movimientos(date, date)    from public, anon;
grant execute on function public.libro_resumen(date, date, text) to authenticated;
grant execute on function public.libro_movimientos(date, date)   to authenticated;

notify pgrst, 'reload schema';
