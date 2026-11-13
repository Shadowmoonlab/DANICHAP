-- gestion-v19.sql — Cuenta corriente de proveedores, etapas 2 y 3 (13/11)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez. Requiere gestion-v18.sql.
--
-- Qué agrega:
--   notas_proveedor.origen         'sistema' (cargada en el panel) o 'planilla' (importada de PROVEEDORES.xlsx con
--                                  dev/importar-planilla-proveedores.mjs). Las compras de la planilla entran como notas de
--                                  débito y los pagos como notas de crédito: cuentan en el saldo y la antigüedad, pero no
--                                  tocan el stock ni el Libro diario (que lee recepciones y pagos_proveedor). Para sacarlas:
--                                  delete from public.notas_proveedor where origen = 'planilla';
--   notas_proveedor.planilla_fila  renglón del Excel de donde salió (para encontrarlo si hay que corregirlo)
--   resumenes_proveedor            lo que dice cada proveedor que le debés, leído por los robots una vez por día
--                                  (scrapers/resumen-*.mjs): saldo y comprobantes impagos. Solo admin la ve; la escriben los
--                                  robots con la clave service_role (que no pasa por RLS).

-- ── 1. Origen de las notas (planilla importada) ─────────────────────────────
alter table public.notas_proveedor add column if not exists origen text not null default 'sistema';
alter table public.notas_proveedor drop constraint if exists notas_proveedor_origen_check;
alter table public.notas_proveedor add constraint notas_proveedor_origen_check check (origen in ('sistema', 'planilla'));
alter table public.notas_proveedor add column if not exists planilla_fila integer;
create index if not exists idx_notas_proveedor_origen on public.notas_proveedor (origen) where origen <> 'sistema';

-- ── 2. Resúmenes de cuenta que publica cada proveedor ───────────────────────
-- detalle = comprobantes impagos según el proveedor:
--   [{ comprobante, tipo, numero, fecha, vence, total, saldo, empresa, … }]   (saldo negativo = crédito a tu favor sin aplicar)
-- datos   = cabecera del resumen (ej. Distrisuper: días, estado de la cuenta, fecha de actualización)
create table if not exists public.resumenes_proveedor (
  id                     bigint generated always as identity primary key,
  proveedor              text not null references public.proveedores(slug) on delete cascade,
  fecha_lectura          timestamptz not null default now(),
  saldo_segun_proveedor  numeric(14,2) not null,
  detalle                jsonb not null default '[]'::jsonb check (jsonb_typeof(detalle) = 'array'),
  datos                  jsonb not null default '{}'::jsonb
);
create index if not exists idx_resumenes_proveedor_ultimo on public.resumenes_proveedor (proveedor, fecha_lectura desc);

-- RLS: el panel solo lee (admin). Sin políticas de escritura: solo service_role (los robots) inserta.
alter table public.resumenes_proveedor enable row level security;
drop policy if exists resumenes_proveedor_admin_select on public.resumenes_proveedor;
create policy resumenes_proveedor_admin_select on public.resumenes_proveedor
  for select using ((select public.is_admin()));
revoke all on public.resumenes_proveedor from anon;
revoke insert, update, delete, truncate on public.resumenes_proveedor from authenticated;
grant select on public.resumenes_proveedor to authenticated;

notify pgrst, 'reload schema';
