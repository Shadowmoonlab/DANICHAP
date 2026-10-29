-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Gestión v3: cierre de caja con arqueo (29/10/2026)
-- Lo que tienen todos los puntos de venta (Tango, Xubio, Fidel…) y faltaba acá. Correr DESPUÉS de add-libro-diario.sql.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Cierre de caja con arqueo ────────────────────────────────────────────
-- Al cerrar el día se cuenta la plata en efectivo y se compara con lo que dice el sistema.
create table if not exists public.cierres_caja (
  id                bigint generated always as identity primary key,
  fecha             date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  efectivo_inicial  numeric(12,2) not null default 0 check (efectivo_inicial >= 0),
  efectivo_esperado numeric(12,2) not null,
  efectivo_contado  numeric(12,2) not null check (efectivo_contado >= 0),
  diferencia        numeric(12,2) generated always as (efectivo_contado - efectivo_esperado) stored,
  otros_medios      jsonb not null default '{}'::jsonb,   -- transferencia / débito / crédito del día (informativo)
  notas             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now()
);
create unique index if not exists idx_cierres_caja_fecha on public.cierres_caja (fecha);
alter table public.cierres_caja enable row level security;
drop policy if exists cierres_caja_admin_all on public.cierres_caja;
create policy cierres_caja_admin_all on public.cierres_caja for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.cierres_caja from anon;

-- Movimientos de caja de un día por medio de pago (ventas no fiadas, cobros, otros ingresos, gastos y retiros)
create or replace function public.caja_del_dia(p_fecha date)
returns table (medio text, ventas numeric, cobros numeric, ingresos numeric, gastos numeric, retiros numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ini timestamptz := p_fecha::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_fin timestamptz := (p_fecha + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
begin
  if not (select public.is_admin()) then raise exception 'Solo el administrador puede ver la caja'; end if;
  return query
  with mov as (
    select medio_pago as medio, total as ventas, 0::numeric as cobros, 0::numeric as ingresos, 0::numeric as gastos, 0::numeric as retiros
    from public.ventas where not anulada and medio_pago <> 'cuenta_corriente' and created_at >= v_ini and created_at < v_fin
    union all
    select medio, 0, monto, 0, 0, 0 from public.pagos_clientes where not anulado and created_at >= v_ini and created_at < v_fin
    union all
    select medio, 0, 0, case when tipo = 'ingreso' then monto else 0 end, case when tipo = 'gasto' then monto else 0 end,
           case when tipo = 'retiro' then monto else 0 end
    from public.movimientos where not anulado and fecha = p_fecha
  )
  select m.medio, sum(m.ventas), sum(m.cobros), sum(m.ingresos), sum(m.gastos), sum(m.retiros)
  from mov m group by m.medio order by m.medio;
end;
$$;
revoke all on function public.caja_del_dia(date) from public, anon;
grant execute on function public.caja_del_dia(date) to authenticated;

notify pgrst, 'reload schema';
