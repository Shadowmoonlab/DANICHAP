-- ═══════════════════════════════════════════════════════════════════════════
-- DANICHAP — El visitante anónimo solo puede leer el catálogo (29/10/2026)
-- Con RLS, un pedido anónimo a una tabla interna devuelve vacío, pero Postgres igual recorre TODAS las filas
-- para descartarlas: GET /rest/v1/precios_distribuidor tardaba ~1,5 s y se cortaba por tiempo (error 500).
-- Cualquiera podía repetirlo para cargar la base. Sin permiso de tabla, el pedido se rechaza al instante.
-- La web sin login solo usa productos (y el bucket de imágenes); perfil y carrito se leen ya logueado.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'precios_distribuidor', 'scraper_runs', 'proveedores', 'ventas', 'venta_items', 'clientes', 'pagos_clientes',
    'recepciones', 'recepcion_items', 'reposicion_items', 'presupuestos', 'config_negocio', 'productos_costos',
    'lecturas_ia', 'movimientos', 'perfiles', 'carrito'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
  if to_regclass('public.clientes_resumen') is not null then
    revoke all on public.clientes_resumen from anon;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── Lectura de facturas: tope fijo de 4 por día (cupo gratuito) ─────────────
-- La función leer-factura lee este valor; con el check nadie lo puede subir, ni desde el panel ni por la API.
update public.config_negocio set lecturas_ia_por_dia = 4 where lecturas_ia_por_dia is distinct from 4;
alter table public.config_negocio drop constraint if exists lecturas_ia_fijo;
alter table public.config_negocio add constraint lecturas_ia_fijo check (lecturas_ia_por_dia = 4);
