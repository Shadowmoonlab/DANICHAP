-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — Gestión: mostrador, ventas, reposición, clientes, configuración
-- Correr en Supabase SQL Editor DESPUÉS de add-precios-distribuidor.sql
-- Todo es solo-admin (RLS con (select public.is_admin())).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Búsqueda rápida en precios de distribuidores ───────────────────────
-- Columna de búsqueda (código + descripción + marca + rubro + origen) con índice trigram:
-- permite buscar por varias palabras sueltas en cualquier orden ("faro gol der").
-- Normalizada: sin acentos ni - / . ,  → "F-100" y "F100" se encuentran igual (gestion.js normaliza lo mismo).
alter table public.precios_distribuidor
  add column if not exists busqueda text generated always as (
    translate(
      regexp_replace(
        lower(codigo || ' ' || descripcion || ' ' || coalesce(marca, '') || ' ' ||
              coalesce(rubro, '') || ' ' || coalesce(origen, '')),
        '[-/.,]', '', 'g'),
      'áéíóúüñ', 'aeiouun')
  ) stored;

create index if not exists idx_precios_busqueda_trgm
  on public.precios_distribuidor using gin (busqueda gin_trgm_ops);

-- ── 1. Configuración del negocio (una sola fila) ──────────────────────────
create table if not exists public.config_negocio (
  id                     smallint primary key default 1 check (id = 1),
  ganancia_pct           numeric(6,2) not null default 82,   -- % sobre el costo
  ganancias_distribuidor jsonb not null default '{}',        -- {"dm": 82, "prautopartes": 70}
  redondeo               integer not null default 1,         -- redondear precio de venta a múltiplos de N pesos
  nombre_negocio         text default 'DANICHAP',
  direccion              text,
  telefono               text,
  leyenda_comprobante    text default 'Documento no válido como factura',
  updated_at             timestamptz not null default now()
);
insert into public.config_negocio (id) values (1) on conflict (id) do nothing;

-- ── 2. Clientes ───────────────────────────────────────────────────────────
create table if not exists public.clientes (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  cuit_dni    text,
  telefono    text,
  email       text,
  direccion   text,
  localidad   text,
  notas       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_clientes_nombre_trgm on public.clientes using gin (lower(nombre) gin_trgm_ops);

-- ── 3. Ventas ─────────────────────────────────────────────────────────────
create table if not exists public.ventas (
  id              bigint generated always as identity primary key,  -- = nº de comprobante
  cliente_id      bigint references public.clientes(id) on delete set null,
  cliente_nombre  text,                                   -- copia por si se borra el cliente
  medio_pago      text not null default 'efectivo'
                  check (medio_pago in ('efectivo', 'transferencia', 'debito', 'credito', 'cuenta_corriente')),
  total           numeric(12,2) not null default 0,
  costo_total     numeric(12,2) not null default 0,
  ganancia        numeric(12,2) not null default 0,   -- solo de los renglones con costo conocido
  impreso         boolean not null default false,
  anulada         boolean not null default false,
  notas           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_ventas_created   on public.ventas (created_at desc);
create index if not exists idx_ventas_cliente   on public.ventas (cliente_id);

create table if not exists public.venta_items (
  id                      bigint generated always as identity primary key,
  venta_id                bigint not null references public.ventas(id) on delete cascade,
  producto_id             uuid references public.productos(id) on delete set null,
  precio_distribuidor_id  bigint references public.precios_distribuidor(id) on delete set null,
  codigo                  text,
  descripcion             text not null,
  cantidad                integer not null check (cantidad > 0),
  precio_unit             numeric(12,2) not null,
  costo_unit              numeric(12,2)
);
create index if not exists idx_venta_items_venta      on public.venta_items (venta_id);
create index if not exists idx_venta_items_producto   on public.venta_items (producto_id);
create index if not exists idx_venta_items_precio     on public.venta_items (precio_distribuidor_id);

-- ── 4. Carrito de reposición ──────────────────────────────────────────────
create table if not exists public.reposicion_items (
  id                      bigint generated always as identity primary key,
  venta_item_id           bigint references public.venta_items(id) on delete set null,
  codigo                  text,
  descripcion             text not null,
  cantidad                integer not null check (cantidad > 0),
  precio_distribuidor_id  bigint references public.precios_distribuidor(id) on delete set null, -- proveedor elegido
  estado                  text not null default 'pendiente'
                          check (estado in ('pendiente', 'pedido', 'recibido', 'descartado')),
  pedido_at               timestamptz,
  recibido_at             timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists idx_repo_estado       on public.reposicion_items (estado, created_at);
create index if not exists idx_repo_venta_item   on public.reposicion_items (venta_item_id);
create index if not exists idx_repo_precio       on public.reposicion_items (precio_distribuidor_id);

-- ── 5. RLS: todo solo admin ───────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['config_negocio', 'clientes', 'ventas', 'venta_items', 'reposicion_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_all', t);
  end loop;
end $$;

-- ── 6. Registrar venta (atómico: venta + renglones + reposición + stock) ──
create or replace function public.registrar_venta(p_venta jsonb)
returns bigint
language plpgsql
security invoker            -- corre con los permisos del usuario: RLS exige admin
set search_path = ''
as $$
declare
  v_id      bigint;
  v_item_id bigint;
  it        jsonb;
  v_cant    integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede registrar ventas';
  end if;
  if jsonb_array_length(coalesce(p_venta->'items', '[]'::jsonb)) = 0 then
    raise exception 'La venta no tiene artículos';
  end if;

  insert into public.ventas (cliente_id, cliente_nombre, medio_pago, notas, impreso)
  values (
    nullif(p_venta->>'cliente_id', '')::bigint,
    nullif(p_venta->>'cliente_nombre', ''),
    coalesce(nullif(p_venta->>'medio_pago', ''), 'efectivo'),
    nullif(p_venta->>'notas', ''),
    coalesce((p_venta->>'impreso')::boolean, false)
  )
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_venta->'items') loop
    v_cant := (it->>'cantidad')::integer;

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
      nullif(it->>'costo_unit', '')::numeric
    )
    returning id into v_item_id;

    -- Todo lo vendido pasa al carrito de reposición (salvo que se indique lo contrario)
    if coalesce((it->>'reponer')::boolean, true) then
      insert into public.reposicion_items (venta_item_id, codigo, descripcion, cantidad, precio_distribuidor_id)
      values (v_item_id, it->>'codigo', it->>'descripcion', v_cant, nullif(it->>'precio_distribuidor_id', '')::bigint);
    end if;

    -- Descontar stock propio (solo si el producto lleva conteo de unidades)
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

  return v_id;
end;
$$;

revoke all on function public.registrar_venta(jsonb) from public, anon;
grant execute on function public.registrar_venta(jsonb) to authenticated;
