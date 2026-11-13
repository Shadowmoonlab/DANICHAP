-- gestion-v18.sql — Cuenta corriente de proveedores, etapa 1 (13/11)
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- Qué agrega:
--   proveedores.plazo_dias        días que da el proveedor para pagar (vacío = sin vencimiento)
--   pagos_proveedor               cada pago (efectivo, transferencia, cheque, echeq); se anula, no se borra
--   pagos_aplicaciones            a qué remitos (recepciones) se aplicó cada pago, entero o en parte.
--                                 Lo que no se aplicó queda "a cuenta" (pago − aplicado)
--   notas_proveedor               notas de crédito / débito, sueltas o de un remito
--   registrar_pago_proveedor / anular_pago_proveedor / registrar_nota_proveedor / anular_nota_proveedor
--   cc_proveedores(hoy)           saldo y vencidos de cada proveedor (al día, 1-30, 31-60, +60 días)
--   cc_movimientos(proveedor)     compras, pagos y notas de un proveedor con el saldo después de cada uno
--   libro_resumen / libro_movimientos  desde el 14/11/2026 la caja del Libro diario cuenta lo PAGADO a proveedores
--                                 (los anulados no); las compras con proveedor quedan "a pagar" (ver punto 10)
--   caja_del_dia                  el cierre de caja descuenta los pagos a proveedores en efectivo (ver punto 10b)
--
-- saldo = compras (recepciones.total, o la suma de sus renglones si no tiene total) + notas de débito
--         − notas de crédito − pagos no anulados
--
-- Regla para remitos corregidos o anulados en Recepción (nada se pierde en silencio):
--   * Anular un remito con pagos aplicados: el remito deja de sumar y lo que se le había aplicado vuelve a quedar
--     "a cuenta" en ese pago (el pago sigue contando entero, así el saldo queda bien). Sus notas quedan sueltas.
--   * Corregir un remito: si la corregida es del mismo proveedor, sus pagos y notas pasan solos a la nueva
--     (hasta lo que vale la nueva; si vale menos, la diferencia queda a cuenta). Si cambió de proveedor,
--     quedan a cuenta como al anular.

-- ── 1. Plazo de pago del proveedor ──────────────────────────────────────────
alter table public.proveedores add column if not exists plazo_dias integer
  check (plazo_dias is null or plazo_dias between 0 and 365);

-- ── 2. Tablas ───────────────────────────────────────────────────────────────
create table if not exists public.pagos_proveedor (
  id                 bigint generated always as identity primary key,
  proveedor          text not null references public.proveedores(slug),
  fecha              date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  monto              numeric(12,2) not null check (monto > 0),
  medio              text not null default 'efectivo' check (medio in ('efectivo', 'transferencia', 'cheque', 'echeq')),
  cheque_fecha_cobro date,
  nota               text,
  anulado            boolean not null default false,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now()
);
create index if not exists idx_pagos_proveedor_prov  on public.pagos_proveedor (proveedor, fecha);
create index if not exists idx_pagos_proveedor_fecha on public.pagos_proveedor (fecha);

-- Si se anula el remito (se borra en Recepción), la aplicación se va y esa plata queda "a cuenta" en el pago
create table if not exists public.pagos_aplicaciones (
  id           bigint generated always as identity primary key,
  pago_id      bigint not null references public.pagos_proveedor(id) on delete cascade,
  recepcion_id bigint not null references public.recepciones(id) on delete cascade,
  monto        numeric(12,2) not null check (monto > 0),
  unique (pago_id, recepcion_id)
);
create index if not exists idx_pagos_aplicaciones_recepcion on public.pagos_aplicaciones (recepcion_id);

create table if not exists public.notas_proveedor (
  id           bigint generated always as identity primary key,
  proveedor    text not null references public.proveedores(slug),
  fecha        date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  tipo         text not null check (tipo in ('credito', 'debito')),
  monto        numeric(12,2) not null check (monto > 0),
  motivo       text,
  recepcion_id bigint references public.recepciones(id) on delete set null,
  anulado      boolean not null default false,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_notas_proveedor_prov      on public.notas_proveedor (proveedor, fecha);
create index if not exists idx_notas_proveedor_recepcion on public.notas_proveedor (recepcion_id);
create index if not exists idx_recepciones_proveedor     on public.recepciones (proveedor);

-- ── 3. RLS: todo solo admin (igual que las otras tablas de gestión) ─────────
do $$
declare t text;
begin
  foreach t in array array['pagos_proveedor', 'pagos_aplicaciones', 'notas_proveedor'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_all', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ── 4. Cuánto falta pagar de un remito ──────────────────────────────────────
-- total del remito + notas de débito del remito − notas de crédito del remito − pagos aplicados (no anulados)
create or replace function public.saldo_recepcion(p_id bigint)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(r.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = r.id), 0)
       + coalesce((select sum(case when n.tipo = 'debito' then n.monto else -n.monto end)
                   from public.notas_proveedor n where n.recepcion_id = r.id and not n.anulado), 0)
       - coalesce((select sum(a.monto) from public.pagos_aplicaciones a
                   join public.pagos_proveedor pp on pp.id = a.pago_id
                   where a.recepcion_id = r.id and not pp.anulado), 0)
  from public.recepciones r where r.id = p_id;
$$;

-- ── 5. Registrar y anular pagos ─────────────────────────────────────────────
-- p = { proveedor, fecha, monto, medio, cheque_fecha_cobro, nota, aplicaciones: [{ recepcion_id, monto }] }
create or replace function public.registrar_pago_proveedor(p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id        bigint;
  v_prov      text    := nullif(p->>'proveedor', '');
  v_monto     numeric := nullif(p->>'monto', '')::numeric;
  v_medio     text    := coalesce(nullif(p->>'medio', ''), 'efectivo');
  v_aplicado  numeric := 0;
  v_pend      numeric;
  ap          record;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede cargar pagos a proveedores';
  end if;
  if v_prov is null or not exists (select 1 from public.proveedores where slug = v_prov) then
    raise exception 'Elegí el proveedor';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto del pago tiene que ser mayor a cero';
  end if;
  if v_medio not in ('efectivo', 'transferencia', 'cheque', 'echeq') then
    raise exception 'Forma de pago desconocida: %', v_medio;
  end if;

  insert into public.pagos_proveedor (proveedor, fecha, monto, medio, cheque_fecha_cobro, nota)
  values (v_prov,
          coalesce(nullif(p->>'fecha', '')::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
          v_monto, v_medio,
          case when v_medio in ('cheque', 'echeq') then nullif(p->>'cheque_fecha_cobro', '')::date end,
          nullif(trim(p->>'nota'), ''))
  returning id into v_id;

  -- Mismo remito dos veces en la lista: se suma (no falla por la clave única)
  for ap in
    select (x->>'recepcion_id')::bigint as rid, sum((x->>'monto')::numeric) as monto
    from jsonb_array_elements(coalesce(p->'aplicaciones', '[]'::jsonb)) x
    where nullif(x->>'monto', '')::numeric > 0
    group by 1 order by 1
  loop
    -- "for update": dos pagos a la vez no pueden pasarse de lo que se debe del mismo remito
    perform 1 from public.recepciones where id = ap.rid and proveedor = v_prov for update;
    if not found then
      raise exception 'El remito Nº % no es de este proveedor', ap.rid;
    end if;
    v_pend := public.saldo_recepcion(ap.rid);
    if ap.monto > v_pend then
      raise exception 'Al remito Nº % le faltan pagar $ % y se quiso aplicar $ %', ap.rid, round(v_pend, 2), round(ap.monto, 2);
    end if;
    v_aplicado := v_aplicado + ap.monto;
    if v_aplicado > v_monto then
      raise exception 'Lo aplicado a los remitos ($ %) es más que el pago ($ %)', round(v_aplicado, 2), round(v_monto, 2);
    end if;
    insert into public.pagos_aplicaciones (pago_id, recepcion_id, monto) values (v_id, ap.rid, ap.monto);
  end loop;

  return v_id;
end;
$$;

-- Anular no borra: queda tachado y deja de restar del saldo (y de salir en el Libro diario)
create or replace function public.anular_pago_proveedor(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede anular pagos a proveedores';
  end if;
  update public.pagos_proveedor set anulado = true where id = p_id and not anulado;
  if not found then
    raise exception 'El pago Nº % no existe o ya estaba anulado', p_id;
  end if;
end;
$$;

-- ── 6. Notas de crédito y débito ────────────────────────────────────────────
-- p = { proveedor, fecha, tipo: 'credito'|'debito', monto, motivo, recepcion_id (opcional) }
create or replace function public.registrar_nota_proveedor(p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id    bigint;
  v_prov  text    := nullif(p->>'proveedor', '');
  v_tipo  text    := nullif(p->>'tipo', '');
  v_monto numeric := nullif(p->>'monto', '')::numeric;
  v_rec   bigint  := nullif(p->>'recepcion_id', '')::bigint;
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede cargar notas de proveedores';
  end if;
  if v_prov is null or not exists (select 1 from public.proveedores where slug = v_prov) then
    raise exception 'Elegí el proveedor';
  end if;
  if v_tipo is null or v_tipo not in ('credito', 'debito') then
    raise exception 'Elegí si es nota de crédito o de débito';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto de la nota tiene que ser mayor a cero';
  end if;
  if v_rec is not null and not exists (select 1 from public.recepciones where id = v_rec and proveedor = v_prov) then
    raise exception 'El remito Nº % no es de este proveedor', v_rec;
  end if;

  insert into public.notas_proveedor (proveedor, fecha, tipo, monto, motivo, recepcion_id)
  values (v_prov,
          coalesce(nullif(p->>'fecha', '')::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
          v_tipo, v_monto, nullif(trim(p->>'motivo'), ''), v_rec)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.anular_nota_proveedor(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Solo el administrador puede anular notas de proveedores';
  end if;
  update public.notas_proveedor set anulado = true where id = p_id and not anulado;
  if not found then
    raise exception 'La nota Nº % no existe o ya estaba anulada', p_id;
  end if;
end;
$$;

-- ── 7. Saldo y vencidos por proveedor ───────────────────────────────────────
-- Lo que se debe se reparte remito por remito (y notas de débito sueltas). La plata a favor que no está aplicada
-- a un remito (pagos "a cuenta", notas de crédito sueltas, lo pagado de más) cancela primero lo más viejo.
-- Vencimiento de cada remito = su fecha + plazo_dias del proveedor (sin plazo: nunca vence, queda "al día").
create or replace function public.cc_proveedores(p_hoy date default null)
returns table (
  proveedor text, nombre text, plazo_dias integer,
  comprado numeric, notas_debito numeric, notas_credito numeric, pagado numeric, saldo numeric, a_cuenta numeric,
  al_dia numeric, vencido_30 numeric, vencido_60 numeric, vencido_mas numeric, impago_desde date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
begin
  if not (select public.is_admin()) then raise exception 'Solo el administrador puede ver las cuentas corrientes'; end if;

  return query
  with
  rec as (
    select r.id, r.proveedor,
           coalesce(r.fecha, (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date) as fecha,
           coalesce(r.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = r.id), 0) as total
    from public.recepciones r where r.proveedor is not null
  ),
  apl as (
    select a.recepcion_id, sum(a.monto) as m
    from public.pagos_aplicaciones a join public.pagos_proveedor pp on pp.id = a.pago_id
    where not pp.anulado group by 1
  ),
  nrec as (
    select n.recepcion_id, sum(case when n.tipo = 'debito' then n.monto else -n.monto end) as m
    from public.notas_proveedor n where not n.anulado and n.recepcion_id is not null group by 1
  ),
  docs as (   -- lo que falta pagar de cada remito, y las notas de débito sueltas
    select rec.proveedor, rec.fecha, 0 as orden, rec.id as ref, rec.total + coalesce(nrec.m, 0) - coalesce(apl.m, 0) as pend
    from rec left join apl on apl.recepcion_id = rec.id left join nrec on nrec.recepcion_id = rec.id
    union all
    select n.proveedor, n.fecha, 1, n.id, n.monto
    from public.notas_proveedor n where not n.anulado and n.tipo = 'debito' and n.recepcion_id is null
  ),
  pagos_libres as (   -- parte de cada pago que no se aplicó a ningún remito
    select pp.proveedor, pp.monto - coalesce((select sum(a.monto) from public.pagos_aplicaciones a where a.pago_id = pp.id), 0) as m
    from public.pagos_proveedor pp where not pp.anulado
  ),
  favor as (
    select x.proveedor, sum(x.m) as m from (
      select pl.proveedor, pl.m from pagos_libres pl
      union all
      select n.proveedor, n.monto from public.notas_proveedor n where not n.anulado and n.tipo = 'credito' and n.recepcion_id is null
      union all
      select d.proveedor, -d.pend from docs d where d.pend < 0
    ) x group by 1
  ),
  fifo as (
    select d.proveedor, d.fecha, d.pend,
           sum(d.pend) over (partition by d.proveedor order by d.fecha, d.orden, d.ref rows unbounded preceding) - d.pend as antes
    from docs d where d.pend > 0
  ),
  resto as (
    select f.proveedor, f.fecha, greatest(0, f.pend - greatest(0, coalesce(fv.m, 0) - f.antes)) as queda
    from fifo f left join favor fv on fv.proveedor = f.proveedor
  ),
  aging as (
    select rs.proveedor,
           sum(rs.queda) filter (where pr.plazo_dias is null or v_hoy - (rs.fecha + pr.plazo_dias) <= 0)    as al_dia,
           sum(rs.queda) filter (where v_hoy - (rs.fecha + pr.plazo_dias) between 1 and 30)                 as v30,
           sum(rs.queda) filter (where v_hoy - (rs.fecha + pr.plazo_dias) between 31 and 60)                as v60,
           sum(rs.queda) filter (where v_hoy - (rs.fecha + pr.plazo_dias) > 60)                             as vmas,
           min(rs.fecha) filter (where rs.queda > 0)                                                        as desde
    from resto rs join public.proveedores pr on pr.slug = rs.proveedor
    group by 1
  ),
  compras as (select rec.proveedor, sum(rec.total) as m from rec group by 1),
  notas as (
    select n.proveedor, sum(n.monto) filter (where n.tipo = 'debito') as deb, sum(n.monto) filter (where n.tipo = 'credito') as cre
    from public.notas_proveedor n where not n.anulado group by 1
  ),
  pagos as (select pp.proveedor, sum(pp.monto) as m from public.pagos_proveedor pp where not pp.anulado group by 1),
  libres as (select pl.proveedor, sum(pl.m) as m from pagos_libres pl group by 1)
  select pr.slug, pr.nombre, pr.plazo_dias,
         coalesce(c.m, 0), coalesce(nt.deb, 0), coalesce(nt.cre, 0), coalesce(pg.m, 0),
         coalesce(c.m, 0) + coalesce(nt.deb, 0) - coalesce(nt.cre, 0) - coalesce(pg.m, 0),
         coalesce(lb.m, 0),
         coalesce(ag.al_dia, 0), coalesce(ag.v30, 0), coalesce(ag.v60, 0), coalesce(ag.vmas, 0), ag.desde
  from public.proveedores pr
  left join compras c on c.proveedor = pr.slug
  left join notas nt on nt.proveedor = pr.slug
  left join pagos pg on pg.proveedor = pr.slug
  left join libres lb on lb.proveedor = pr.slug
  left join aging ag on ag.proveedor = pr.slug
  order by (coalesce(c.m, 0) + coalesce(nt.deb, 0) - coalesce(nt.cre, 0) - coalesce(pg.m, 0)) <> 0 desc,
           coalesce(c.m, 0) + coalesce(nt.deb, 0) - coalesce(nt.cre, 0) - coalesce(pg.m, 0) desc,
           pr.nombre;
end;
$$;

-- ── 8. Movimientos de un proveedor con el saldo después de cada uno ─────────
-- Más nuevo primero. debe = compras y notas de débito; haber = pagos y notas de crédito.
-- Lo anulado se muestra (tachado) pero no mueve el saldo.
create or replace function public.cc_movimientos(p_proveedor text)
returns table (
  fecha date, momento timestamptz, tipo text, ref_id bigint, detalle text, debe numeric, haber numeric, saldo numeric,
  anulado boolean, medio text, cheque_fecha_cobro date, aplicado numeric, aplicado_a text, pendiente numeric, vence date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_plazo integer := (select pr.plazo_dias from public.proveedores pr where pr.slug = p_proveedor);
begin
  if not (select public.is_admin()) then raise exception 'Solo el administrador puede ver las cuentas corrientes'; end if;

  return query
  select x.fecha, x.momento, x.tipo, x.ref_id, x.detalle, x.debe, x.haber,
         sum(case when x.anulado then 0 else x.debe - x.haber end)
           over (order by x.fecha, x.momento, x.tipo, x.ref_id rows unbounded preceding),
         x.anulado, x.medio, x.cheque_fecha_cobro, x.aplicado, x.aplicado_a, x.pendiente, x.vence
  from (
    select coalesce(r.fecha, (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date) as fecha, r.created_at as momento,
           'compra'::text as tipo, r.id as ref_id,
           coalesce('Remito Nº ' || r.nro_comprobante, 'Compra sin número') as detalle,
           coalesce(r.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = r.id), 0) as debe,
           0::numeric as haber, false as anulado, null::text as medio, null::date as cheque_fecha_cobro,
           null::numeric as aplicado, null::text as aplicado_a,
           public.saldo_recepcion(r.id) as pendiente,
           coalesce(r.fecha, (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date) + v_plazo as vence
    from public.recepciones r where r.proveedor = p_proveedor
    union all
    select pp.fecha, pp.created_at, 'pago', pp.id, pp.nota, 0, pp.monto, pp.anulado, pp.medio, pp.cheque_fecha_cobro,
           coalesce((select sum(a.monto) from public.pagos_aplicaciones a where a.pago_id = pp.id), 0),
           (select string_agg(coalesce('Nº ' || r.nro_comprobante, 'compra del ' || to_char(r.fecha, 'DD/MM')), ', ' order by r.fecha, r.id)
            from public.pagos_aplicaciones a join public.recepciones r on r.id = a.recepcion_id where a.pago_id = pp.id),
           null, null
    from public.pagos_proveedor pp where pp.proveedor = p_proveedor
    union all
    select n.fecha, n.created_at, 'nota_' || n.tipo, n.id,
           concat_ws(' · ', n.motivo, (select 'Remito Nº ' || r.nro_comprobante from public.recepciones r where r.id = n.recepcion_id)),
           case when n.tipo = 'debito' then n.monto else 0 end, case when n.tipo = 'credito' then n.monto else 0 end,
           n.anulado, null, null, null, null, null, null
    from public.notas_proveedor n where n.proveedor = p_proveedor
  ) x
  order by x.fecha desc, x.momento desc, x.tipo desc, x.ref_id desc;
end;
$$;

-- ── 9. Recepción: corregir un remito mantiene sus pagos y notas ─────────────
-- Igual que en gestion-v15.sql, y además: si la corregida es del mismo proveedor, los pagos aplicados y las notas
-- de la vieja pasan a la nueva (si la nueva vale menos, lo que sobra de los pagos queda a cuenta).
create or replace function public.corregir_recepcion(p_id bigint, p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nuevo bigint;
  v_ids   uuid[] := array(select producto_id from public.recepcion_items where recepcion_id = p_id and producto_id is not null);
  v_prov  text   := (select proveedor from public.recepciones where id = p_id);
  v_notas bigint[] := array(select id from public.notas_proveedor where recepcion_id = p_id);
  v_apps  jsonb  := (select jsonb_agg(jsonb_build_object('pago_id', a.pago_id, 'monto', a.monto) order by pp.fecha, a.pago_id)
                     from public.pagos_aplicaciones a join public.pagos_proveedor pp on pp.id = a.pago_id
                     where a.recepcion_id = p_id and not pp.anulado);
  v_resto numeric;
  v_m     numeric;
  ap      jsonb;
begin
  -- Sin piso en cero: si de esa carga ya se vendió algo, la cuenta queda bien al volver a sumar la corregida
  perform public.deshacer_recepcion(p_id, false);
  v_nuevo := public.confirmar_recepcion(p);
  -- Si a un producto de la carga vieja le quedó stock negativo o en cero (se sacó o achicó un renglón ya vendido),
  -- queda en cero y "sin stock" en la web
  update public.productos set stock_cantidad = 0, stock = false where id = any(v_ids) and stock_cantidad <= 0;

  -- Cuenta corriente (v18)
  if v_prov is not null and v_prov = (select proveedor from public.recepciones where id = v_nuevo) then
    update public.notas_proveedor set recepcion_id = v_nuevo where id = any(v_notas);
    v_resto := public.saldo_recepcion(v_nuevo);
    for ap in select * from jsonb_array_elements(coalesce(v_apps, '[]'::jsonb)) loop
      v_m := least((ap->>'monto')::numeric, v_resto);
      exit when v_m <= 0;
      insert into public.pagos_aplicaciones (pago_id, recepcion_id, monto) values ((ap->>'pago_id')::bigint, v_nuevo, v_m);
      v_resto := v_resto - v_m;
    end loop;
  end if;
  return v_nuevo;
end;
$$;

-- ── 10. Libro diario: la caja cuenta lo PAGADO a proveedores ──────────────
-- Decisión de Daniel (14/11): desde el corte (14/11/2026) lo que sale de la caja es lo que se le PAGA al proveedor
-- (pagos_proveedor no anulados), no la compra. Las compras CON proveedor quedan informativas ("a pagar").
-- Las compras SIN proveedor siguen saliendo de la caja el día de la compra (se toman como pagadas en el momento).
-- Antes del corte todo queda como estaba: las compras salen de la caja y los pagos con fecha anterior NO
-- (si no, una compra vieja contaría dos veces y cambiarían días ya cerrados, ej. al importar el Excel en la etapa 2).
create or replace function public.libro_corte_compras()
returns date
language sql
immutable
set search_path = ''
as $$ select date '2026-11-14' $$;

-- libro_resumen: igual que en add-libro-diario.sql (ventas, cobros, compras, gastos sin cambios) y suma dos columnas al final:
--   compras_caja       compras que salen de la caja (sin proveedor, o anteriores al corte)
--   pagos_proveedores  pagos a proveedores desde el corte (no anulados)
drop function if exists public.libro_resumen(date, date, text);
create or replace function public.libro_resumen(p_desde date, p_hasta date, p_agrupar text default 'day')
returns table (
  periodo date, cant_ventas integer, ventas numeric, costo numeric, ganancia numeric, fiado numeric,
  cobros numeric, compras numeric, gastos numeric, otros_ingresos numeric, retiros numeric,
  compras_caja numeric, pagos_proveedores numeric
)
language plpgsql
stable
security invoker          -- respeta el RLS: solo el administrador ve datos
set search_path = ''
as $$
#variable_conflict use_column   -- columnas de salida con el mismo nombre que columnas de tablas
declare
  v_corte date := public.libro_corte_compras();
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
    select x.p, sum(x.tot) as tot, sum(x.tot) filter (where x.proveedor is null or x.fecha < v_corte) as caja
    from (
      select date_trunc(p_agrupar, rr.fecha)::date as p, rr.proveedor, rr.fecha,
             coalesce(rr.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = rr.id), 0) as tot
      from public.recepciones rr
      where rr.fecha between p_desde and p_hasta
    ) x
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
  pp as (
    select date_trunc(p_agrupar, fecha)::date as p, sum(monto) as tot
    from public.pagos_proveedor
    where not anulado and fecha between p_desde and p_hasta and fecha >= v_corte
    group by 1
  ),
  periodos as (select p from v union select p from c union select p from r union select p from m union select p from pp)
  select pe.p,
         coalesce(v.n, 0), coalesce(v.tot, 0), coalesce(v.cos, 0), coalesce(v.gan, 0), coalesce(v.fia, 0),
         coalesce(c.tot, 0), coalesce(r.tot, 0), coalesce(m.gas, 0), coalesce(m.ing, 0), coalesce(m.ret, 0),
         coalesce(r.caja, 0), coalesce(pp.tot, 0)
  from periodos pe
  left join v on v.p = pe.p left join c on c.p = pe.p left join r on r.p = pe.p left join m on m.p = pe.p
  left join pp on pp.p = pe.p
  order by pe.p;
end;
$$;

-- libro_movimientos: igual que en add-libro-diario.sql, más los pagos a proveedores (tipo 'pago_proveedor'; los
-- anulados no aparecen). Una compra con proveedor desde el corte no sale de la caja (egreso 0, "a pagar");
-- un pago anterior al corte se lista pero no sale de la caja (la compra ya había salido).
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
  v_ini   timestamptz := p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_fin   timestamptz := (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_corte date := public.libro_corte_compras();
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
    select (y.fecha::timestamp + time '12:00') at time zone 'America/Argentina/Buenos_Aires', 'compra', y.id,
           coalesce(y.nombre, y.proveedor, 'Proveedor') || coalesce(' · Nº ' || y.nro_comprobante, '')
             || case when y.a_pagar then ' · a pagar: sale de la caja al pagarla' else '' end,
           null, null, y.tot, 0, case when y.a_pagar then 0 else y.tot end, null, false
    from (
      select rr.id, rr.fecha, rr.proveedor, pr.nombre, rr.nro_comprobante,
             rr.proveedor is not null and rr.fecha >= v_corte as a_pagar,
             coalesce(rr.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = rr.id), 0) as tot
      from public.recepciones rr left join public.proveedores pr on pr.slug = rr.proveedor
      where rr.fecha between p_desde and p_hasta
    ) y
    union all
    select (mm.fecha::timestamp + (mm.created_at at time zone 'America/Argentina/Buenos_Aires')::time) at time zone 'America/Argentina/Buenos_Aires',
           mm.tipo, mm.id, coalesce(mm.descripcion, mm.categoria), mm.categoria, mm.medio, mm.monto,
           case when mm.tipo = 'ingreso' then mm.monto else 0 end, case when mm.tipo = 'ingreso' then 0 else mm.monto end, null, mm.anulado
    from public.movimientos mm where mm.fecha between p_desde and p_hasta
    union all
    select (pp.fecha::timestamp + (pp.created_at at time zone 'America/Argentina/Buenos_Aires')::time) at time zone 'America/Argentina/Buenos_Aires',
           'pago_proveedor', pp.id,
           coalesce(pr.nombre, pp.proveedor) || coalesce(' · ' || pp.nota, '')
             || case when pp.fecha < v_corte then ' · anterior al 14/11: la compra ya había salido de la caja' else '' end,
           null, pp.medio, pp.monto, 0, case when pp.fecha < v_corte then 0 else pp.monto end, null, false
    from public.pagos_proveedor pp left join public.proveedores pr on pr.slug = pp.proveedor
    where not pp.anulado and pp.fecha between p_desde and p_hasta
  ) x
  order by 1;
end;
$$;

-- ── 10b. Cierre de caja: lo pagado a proveedores también sale de la caja ───
-- Igual que en gestion-v3.sql, y desde el corte (libro_corte_compras, 14/11/2026) suma dos columnas por medio de pago:
--   pagos_proveedores  pagos a proveedores no anulados (el de efectivo baja lo que tiene que haber en la caja;
--                      el de transferencia, cheque o echeq no toca la caja)
--   compras            compras SIN proveedor (se toman como pagadas en efectivo en el momento, igual que en el Libro diario)
-- Antes del corte no se suma nada nuevo: los cierres viejos dan lo mismo que antes.
drop function if exists public.caja_del_dia(date);
create or replace function public.caja_del_dia(p_fecha date)
returns table (medio text, ventas numeric, cobros numeric, ingresos numeric, gastos numeric, retiros numeric,
               pagos_proveedores numeric, compras numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ini   timestamptz := p_fecha::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_fin   timestamptz := (p_fecha + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  v_desde boolean     := p_fecha >= public.libro_corte_compras();
begin
  if not (select public.is_admin()) then raise exception 'Solo el administrador puede ver la caja'; end if;
  return query
  with mov as (
    select medio_pago as medio, total as ventas, 0::numeric as cobros, 0::numeric as ingresos, 0::numeric as gastos, 0::numeric as retiros,
           0::numeric as pagos, 0::numeric as compras
    from public.ventas where not anulada and medio_pago <> 'cuenta_corriente' and created_at >= v_ini and created_at < v_fin
    union all
    select medio, 0, monto, 0, 0, 0, 0, 0 from public.pagos_clientes where not anulado and created_at >= v_ini and created_at < v_fin
    union all
    select medio, 0, 0, case when tipo = 'ingreso' then monto else 0 end, case when tipo = 'gasto' then monto else 0 end,
           case when tipo = 'retiro' then monto else 0 end, 0, 0
    from public.movimientos where not anulado and fecha = p_fecha
    union all
    select pp.medio, 0, 0, 0, 0, 0, pp.monto, 0
    from public.pagos_proveedor pp where v_desde and not pp.anulado and pp.fecha = p_fecha
    union all
    select 'efectivo', 0, 0, 0, 0, 0, 0,
           coalesce(rr.total, (select sum(i.cantidad * i.costo_unit) from public.recepcion_items i where i.recepcion_id = rr.id), 0)
    from public.recepciones rr where v_desde and rr.proveedor is null and rr.fecha = p_fecha
  )
  select m.medio, sum(m.ventas), sum(m.cobros), sum(m.ingresos), sum(m.gastos), sum(m.retiros), sum(m.pagos), sum(m.compras)
  from mov m group by m.medio order by m.medio;
end;
$$;

-- ── 11. Permisos: solo usuarios con sesión (y adentro se verifica que sea admin) ──
revoke all on function public.saldo_recepcion(bigint)            from public, anon;
revoke all on function public.registrar_pago_proveedor(jsonb)    from public, anon;
revoke all on function public.anular_pago_proveedor(bigint)      from public, anon;
revoke all on function public.registrar_nota_proveedor(jsonb)    from public, anon;
revoke all on function public.anular_nota_proveedor(bigint)      from public, anon;
revoke all on function public.cc_proveedores(date)               from public, anon;
revoke all on function public.cc_movimientos(text)               from public, anon;
revoke all on function public.corregir_recepcion(bigint, jsonb)  from public, anon;
revoke all on function public.libro_movimientos(date, date)      from public, anon;
revoke all on function public.libro_resumen(date, date, text)    from public, anon;
revoke all on function public.caja_del_dia(date)                 from public, anon;
grant execute on function public.saldo_recepcion(bigint)           to authenticated;
grant execute on function public.registrar_pago_proveedor(jsonb)   to authenticated;
grant execute on function public.anular_pago_proveedor(bigint)     to authenticated;
grant execute on function public.registrar_nota_proveedor(jsonb)   to authenticated;
grant execute on function public.anular_nota_proveedor(bigint)     to authenticated;
grant execute on function public.cc_proveedores(date)              to authenticated;
grant execute on function public.cc_movimientos(text)              to authenticated;
grant execute on function public.corregir_recepcion(bigint, jsonb) to authenticated;
grant execute on function public.libro_movimientos(date, date)     to authenticated;
grant execute on function public.libro_resumen(date, date, text)   to authenticated;
grant execute on function public.libro_corte_compras()             to authenticated;
grant execute on function public.caja_del_dia(date)                to authenticated;

notify pgrst, 'reload schema';
