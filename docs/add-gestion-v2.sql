-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Gestión v2: proveedores y logística, presupuestos, cuenta corriente,
-- recepción de mercadería, costos propios e importación de listas de precios.
-- Correr en Supabase SQL Editor DESPUÉS de add-gestion.sql. Todo solo-admin.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Proveedores (logística: días de visita, pedido mínimo, WhatsApp) ───
create table if not exists public.proveedores (
  slug           text primary key check (slug ~ '^[a-z0-9_]+$'),  -- = precios_distribuidor.distribuidor
  nombre         text not null,
  whatsapp       text,                                  -- para mandar el pedido directo
  dias_visita    smallint[] not null default '{}',      -- 0=domingo … 6=sábado
  pedido_minimo  numeric(12,2),
  notas          text,
  activo         boolean not null default true,
  orden          integer not null default 100,
  created_at     timestamptz not null default now()
);

insert into public.proveedores (slug, nombre, orden) values
  ('dm',           'DM',                   10),
  ('prautopartes', 'PR Autopartes',        20),
  ('delviso',      'Metalúrgica del Viso', 30),
  ('cromosol',     'Cromosol',             40),
  ('otero',        'Autopartes Otero',     50),
  ('cavila',       'Cavila (Lagostena)',   60),
  ('liquimoly',    'Liqui Moly (DAZ)',     70)
on conflict (slug) do nothing;

-- ── 2. Costo de los productos propios (separado: productos es público) ────
create table if not exists public.productos_costos (
  producto_id       uuid primary key references public.productos(id) on delete cascade,
  costo             numeric(12,2) not null,
  proveedor         text references public.proveedores(slug) on delete set null,
  codigo_proveedor  text,
  actualizado_at    timestamptz not null default now()
);
create index if not exists idx_costos_proveedor_codigo on public.productos_costos (proveedor, codigo_proveedor);

-- ── 2b. Datos del negocio: alias para cobrar por transferencia ────────────
alter table public.config_negocio add column if not exists alias_transferencia text;

-- ── 4. Cuenta corriente: pagos de clientes ────────────────────────────────
create table if not exists public.pagos_clientes (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references public.clientes(id) on delete cascade,
  monto       numeric(12,2) not null check (monto > 0),
  medio       text not null default 'efectivo' check (medio in ('efectivo', 'transferencia', 'debito', 'credito', 'otro')),
  notas       text,
  anulado     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pagos_cliente on public.pagos_clientes (cliente_id, created_at desc);

-- Resumen por cliente: compras, última compra y saldo de cuenta corriente.
-- security_invoker: respeta el RLS de quien consulta (solo admin ve datos).
create or replace view public.clientes_resumen with (security_invoker = true) as
select
  c.*,
  coalesce(v.compras, 0)                       as compras,
  coalesce(v.total, 0)                         as total_comprado,
  v.ultima_compra,
  coalesce(v.fiado, 0) - coalesce(p.pagado, 0) as saldo
from public.clientes c
left join lateral (
  select count(*)                                                as compras,
         sum(total)                                              as total,
         max(created_at)                                         as ultima_compra,
         sum(total) filter (where medio_pago = 'cuenta_corriente') as fiado
  from public.ventas where cliente_id = c.id and not anulada
) v on true
left join lateral (
  select sum(monto) as pagado from public.pagos_clientes where cliente_id = c.id and not anulado
) p on true;

-- ── 5. Presupuestos (lo que se cotiza por WhatsApp y se puede vender después) ─
create table if not exists public.presupuestos (
  id              bigint generated always as identity primary key,
  cliente_id      bigint references public.clientes(id) on delete set null,
  cliente_nombre  text,
  items           jsonb not null,           -- mismos campos que los renglones de venta
  total           numeric(12,2) not null,
  estado          text not null default 'abierto' check (estado in ('abierto', 'vendido', 'descartado')),
  venta_id        bigint references public.ventas(id) on delete set null,
  valido_hasta    date,
  created_at      timestamptz not null default now()
);
create index if not exists idx_presupuestos_estado on public.presupuestos (estado, created_at desc);
create index if not exists idx_presupuestos_cliente on public.presupuestos (cliente_id);
create index if not exists idx_presupuestos_venta on public.presupuestos (venta_id);

-- ── 6. Recepción de mercadería (facturas / remitos de proveedores) ────────
create table if not exists public.recepciones (
  id               bigint generated always as identity primary key,
  proveedor        text references public.proveedores(slug) on delete set null,
  nro_comprobante  text,
  fecha            date,
  total            numeric(12,2),
  origen           text not null default 'manual' check (origen in ('ia', 'manual')),
  ia_uso           jsonb,                    -- tokens de la lectura con IA (para controlar el gasto mensual)
  notas            text,
  created_at       timestamptz not null default now()
);
-- La misma factura no se carga dos veces (el error caro: sumar stock duplicado)
create unique index if not exists uq_recepcion_comprobante
  on public.recepciones (proveedor, nro_comprobante) where nro_comprobante is not null;

create table if not exists public.recepcion_items (
  id                      bigint generated always as identity primary key,
  recepcion_id            bigint not null references public.recepciones(id) on delete cascade,
  codigo                  text,
  descripcion             text not null,
  cantidad                integer not null check (cantidad > 0),
  costo_unit              numeric(12,2),
  accion                  text not null check (accion in ('stock', 'crear', 'solo')),
  producto_id             uuid references public.productos(id) on delete set null,
  reposicion_item_id      bigint references public.reposicion_items(id) on delete set null
);
create index if not exists idx_recepcion_items_recepcion on public.recepcion_items (recepcion_id);
create index if not exists idx_recepcion_items_producto  on public.recepcion_items (producto_id);
create index if not exists idx_recepcion_items_repo      on public.recepcion_items (reposicion_item_id);

-- Cada lectura con IA (se confirme o no la recepción): para ver el gasto del mes en Ajustes
create table if not exists public.lecturas_ia (
  id             bigint generated always as identity primary key,
  modelo         text,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_lecturas_ia_fecha on public.lecturas_ia (created_at desc);

-- ── 7. RLS: todo solo admin ───────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['proveedores', 'productos_costos', 'pagos_clientes', 'presupuestos', 'recepciones', 'recepcion_items', 'lecturas_ia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_all', t);
  end loop;
end $$;

-- ── 8. registrar_venta v2: costo propio, presupuesto y cuenta corriente ───
create or replace function public.registrar_venta(p_venta jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id      bigint;
  v_item_id bigint;
  it        jsonb;
  v_cant    integer;
  v_costo   numeric;
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
      update public.productos
      set stock_cantidad = greatest(stock_cantidad - v_cant, 0),
          stock          = case when stock_cantidad - v_cant <= 0 then false else stock end
      where id = (it->>'producto_id')::uuid and stock_cantidad is not null;
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
$$;

-- ── 9. Confirmar recepción (atómico: comprobante + stock + costos + reposición) ─
create or replace function public.confirmar_recepcion(p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id        bigint;
  it          jsonb;
  v_cant      integer;
  v_costo     numeric;
  v_producto  uuid;
  v_accion    text;
  v_prov      text := nullif(p->>'proveedor', '');
  v_nro       text := nullif(trim(p->>'nro_comprobante'), '');
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede cargar mercadería';
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then
    raise exception 'La recepción no tiene renglones';
  end if;
  if v_nro is not null and exists (
    select 1 from public.recepciones where proveedor is not distinct from v_prov and nro_comprobante = v_nro
  ) then
    raise exception 'Este comprobante (%) ya fue cargado', v_nro;
  end if;

  insert into public.recepciones (proveedor, nro_comprobante, fecha, total, origen, ia_uso, notas)
  values (v_prov, v_nro, nullif(p->>'fecha', '')::date, nullif(p->>'total', '')::numeric,
          coalesce(nullif(p->>'origen', ''), 'manual'), p->'ia_uso', nullif(p->>'notas', ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_cant     := (it->>'cantidad')::integer;
    v_costo    := nullif(it->>'costo_unit', '')::numeric;
    v_accion   := coalesce(nullif(it->>'accion', ''), 'solo');
    v_producto := nullif(it->>'producto_id', '')::uuid;

    if v_accion = 'crear' then
      insert into public.productos (nombre, categoria, precio, stock, stock_cantidad)
      values (it->>'descripcion', coalesce(nullif(it->>'categoria', ''), 'mecanica'),
              nullif(it->>'precio_venta', '')::numeric, true, v_cant)
      returning id into v_producto;
    elsif v_accion = 'stock' and v_producto is not null then
      update public.productos
      set stock_cantidad = coalesce(stock_cantidad, 0) + v_cant, stock = true
      where id = v_producto;
    end if;

    if v_producto is not null and v_costo is not null then
      insert into public.productos_costos (producto_id, costo, proveedor, codigo_proveedor, actualizado_at)
      values (v_producto, v_costo, v_prov, nullif(it->>'codigo', ''), now())
      on conflict (producto_id) do update set
        costo = excluded.costo, proveedor = excluded.proveedor,
        codigo_proveedor = coalesce(excluded.codigo_proveedor, public.productos_costos.codigo_proveedor),
        actualizado_at = now();
    end if;

    insert into public.recepcion_items
      (recepcion_id, codigo, descripcion, cantidad, costo_unit, accion, producto_id, reposicion_item_id)
    values (v_id, nullif(it->>'codigo', ''), it->>'descripcion', v_cant, v_costo,
            v_accion, v_producto, nullif(it->>'reposicion_item_id', '')::bigint);

    if nullif(it->>'reposicion_item_id', '') is not null then
      update public.reposicion_items set estado = 'recibido', recibido_at = now()
      where id = (it->>'reposicion_item_id')::bigint and estado in ('pendiente', 'pedido');
    end if;
  end loop;

  return v_id;
end;
$$;

-- ── 10. Importar lista de precios (Excel / CSV / PDF leído) desde el panel ─
create or replace function public.importar_lista_precios(p_proveedor text, p_rows jsonb, p_reemplazar boolean default false)
returns jsonb
language plpgsql
security definer          -- usa upsert_precios (reservado a service_role); valida admin acá
set search_path = ''
as $$
declare
  v_visto      timestamptz := now();
  v_filas      jsonb;
  v_guardados  integer;
  v_inactivos  integer := 0;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede importar listas';
  end if;
  if not exists (select 1 from public.proveedores where slug = p_proveedor) then
    raise exception 'Proveedor desconocido: %', p_proveedor;
  end if;

  -- Un código repetido en la lista rompería el upsert: queda la última aparición
  select coalesce(jsonb_agg(r || jsonb_build_object('distribuidor', p_proveedor)), '[]'::jsonb)
  into v_filas
  from (
    select distinct on (e.r->>'codigo') e.r
    from jsonb_array_elements(p_rows) with ordinality as e(r, n)
    where nullif(trim(e.r->>'codigo'), '') is not null and nullif(trim(e.r->>'descripcion'), '') is not null
    order by e.r->>'codigo', e.n desc
  ) x;
  if jsonb_array_length(v_filas) = 0 then
    raise exception 'La lista no tiene productos';
  end if;

  v_guardados := public.upsert_precios(v_filas, v_visto);
  if p_reemplazar then
    v_inactivos := public.desactivar_no_vistos(p_proveedor, v_visto);
  end if;

  insert into public.scraper_runs (distribuidor, inicio, fin, ok, productos, error)
  values (p_proveedor, v_visto, now(), true, v_guardados, null);

  return jsonb_build_object('guardados', v_guardados, 'desactivados', v_inactivos);
end;
$$;

revoke all on function public.confirmar_recepcion(jsonb)                        from public, anon;
revoke all on function public.importar_lista_precios(text, jsonb, boolean)      from public, anon;
grant execute on function public.confirmar_recepcion(jsonb)                     to authenticated;
grant execute on function public.importar_lista_precios(text, jsonb, boolean)   to authenticated;
