# Cuenta corriente de proveedores — Plan de implementación

> **Para agentes:** usar superpowers:subagent-driven-development o superpowers:executing-plans, tarea por tarea. Pasos con `- [ ]`.

**Objetivo:** que Daniel vea cuánto le debe a cada proveedor y qué vence, cargando cada compra una sola vez, registrando pagos en segundos y comparando contra el resumen que publica cada proveedor.

**Arquitectura:** las compras salen de `recepciones` (ya existen); pagos, aplicaciones y notas en tablas nuevas (SQL v18); saldo y antigüedad calculados en Postgres; pantalla nueva "Cuentas corrientes" en el panel; robots que leen el resumen de cada proveedor y lo guardan como "según el proveedor" para comparar.

**Base:** la propuesta enviada a Daniel (`entrega/propuestas/Propuesta-cuenta-corriente-proveedores.pdf`, 3 etapas) y su planilla `PROVEEDORES.xlsx` (1.791 renglones, 61 proveedores, columnas FECHA · PROVEDOR · REMITO · IMPORTE · PAGOS, saldo total ≈ $12,2 M).

**Stack:** Supabase/Postgres (RPC + RLS admin), panel vanilla ES modules (`gestion/*.js`), robots Node en GitHub Actions (`scrapers/`).

## Restricciones globales
- Solo admin (`is_admin()`), RPC `security invoker`, `search_path = ''`, grants a `authenticated`.
- UI en español rioplatense simple; montos con `numeroAR` ("150.000" = ciento cincuenta mil).
- Nunca credenciales ni datos reales de saldos en el repo (es público). Explorador: todo lo sensible tapado.
- SQL de producción lo corre Fede a mano; nunca escribir en producción desde acá.

## Foco de revisión (lo que más puede fallar)
1. Pago mayor que la deuda o aplicado dos veces a la misma factura → la RPC lo rechaza con mensaje claro.
2. Anular/corregir una recepción que ya tiene pagos aplicados → regla explícita (bloquear o pasar el monto "a cuenta"), nunca perder plata.
3. Recepción sin total (carga a mano) → saldo = suma de renglones.
4. Proveedor con nombres distintos en la planilla ("GOICOCHEA HNOS" vs slug `goicoechea`) → tabla de equivalencias revisada por Daniel antes de importar.
5. Fechas mal escritas en la planilla ("08/08//25", "1/09/0925") → se corrigen o se marcan para revisar; nunca se importan en silencio con otra fecha.

---

## Etapa 1 · La cuenta (en curso — agente dev-pro)

### Tarea 1: SQL v18 (tablas, RPC, saldos)
**Archivos:** crear `docs/gestion-v18.sql`; agregar a `dev/config.mjs` MIGRACIONES.
- [ ] `proveedores.plazo_dias`, tablas `pagos_proveedor`, `pagos_aplicaciones`, `notas_proveedor` con RLS admin.
- [ ] RPC `registrar_pago_proveedor(p jsonb) → bigint` (aplicaciones ≤ monto y ≤ saldo de cada recepción; resto "a cuenta"), `anular_pago_proveedor`, `registrar_nota_proveedor`, `anular_nota_proveedor`.
- [ ] Saldo por proveedor con antigüedad (al día · 1-30 · 31-60 · +60) y remito impago más viejo; historial con saldo acumulado.
- [ ] Pagos como egreso en el Libro diario (anulados no).
- [ ] Regla para recepciones anuladas/corregidas con pagos aplicados.

### Tarea 2: Pantalla "Cuentas corrientes"
**Archivos:** crear `gestion/cuentas.js`; modificar `gestion.html`, `gestion/main.js`, `gestion.css`.
- [ ] Lista con total adeudado, saldo, vencido por tramo y remito más viejo.
- [ ] Detalle con historial; "Registrar pago" (aplica a lo más viejo primero), notas de crédito/débito, plazo de pago, anular, resumen por WhatsApp.
- [ ] Usable a 390 px.

### Tarea 3: Pruebas
- [ ] Unit test de la asignación "más viejo primero".
- [ ] e2e en `dev/e2e/nuevas.py`: compra → aparece; pago parcial → baja; nota de crédito → baja; anular pago → vuelve; pago en Libro diario; tramo vencido con `plazo_dias`.

## Etapa 2 · La planilla (importación del Excel)

### Tarea 4: Equivalencias de proveedores
**Archivos:** crear `dev/importar-planilla-proveedores.mjs` (corre en la PC de Fede, lee el Excel local, no se sube a git).
- [ ] Normalizar nombres (mayúsculas, espacios, tildes) y proponer el slug del sistema por parecido; los 61 nombres → CSV `entrega/planilla/equivalencias.csv` para que Daniel confirme (los que no existen se crean como proveedor nuevo).
- [ ] Test: "GOICOCHEA HNOS" → `goicoechea`; "PR REPUESTO" → `prautopartes`.

### Tarea 5: Fechas y renglones
- [ ] Fechas Excel (número de serie) → fecha; texto "dd/mm/aa" con errores típicos (`//`, años de 4 cifras mal tipeados) → corregir si es inequívoco, si no marcar "revisar".
- [ ] Cada renglón con IMPORTE → compra histórica; con PAGOS → pago; ambos en el mismo renglón → compra + pago aplicado a esa compra.
- [ ] Test con los casos reales de formato ("RTO 132863", "N10455", fechas rotas).

### Tarea 6: Saldo inicial confirmado
- [ ] Generar SQL de carga (`entrega/planilla/carga-inicial.sql`, no se sube) con compras/pagos históricos marcados `origen = 'planilla'`.
- [ ] Informe por proveedor: saldo planilla vs saldo importado; Daniel lo confirma antes de correr el SQL.

## Etapa 3 · El control (resúmenes de cada proveedor)

Hallazgos del explorador (13/11):

| Proveedor | Fuente del saldo | Formato |
|---|---|---|
| Cromosol (4 empresas) | `GET /api/transactions?company=1..4&page=N` con la sesión del robot de precios | lista de comprobantes: fecha, tipo (FC/NC/RC), número, total, `balance` (lo que queda pagar), vencimiento; 30 por página |
| Distrisuper (Lupa) | `GET distrimdp.dvrdns.org/ctacte/{nº cliente}` | cabecera: saldo total, días, estado; detalle de impagos: comprobante, total, pagado, saldo, fecha, días, acumulado |
| PR Autopartes | `GET /api/CuentasCorrientes?page=N` (Bearer) | responde vacío para la cuenta de Daniel: no tiene cuenta corriente con PR |
| DM | la ficha de cliente (`ficha.php`) trae campos `compras` y `pagos` | a confirmar si son totales de la cuenta |
| Goicoechea | `POST /account/myaccount/filter` (debe, haber, saldo, vencimiento, PDF) | cuenta desactivada: espera reactivación |

### Tarea 7: Tabla de resúmenes del proveedor
**Archivos:** `docs/gestion-v19.sql`.
- [ ] Tabla `resumenes_proveedor` (proveedor, fecha_lectura, saldo_segun_proveedor, detalle jsonb de comprobantes impagos) con RLS admin; el robot escribe con service_role.

### Tarea 8: Robots de resumen (Cromosol y Distrisuper primero)
**Archivos:** `scrapers/resumen-cromosol.mjs`, `scrapers/resumen-distrisuper.mjs`, paso en `.github/workflows/precios-diarios.yml` (una vez por día).
- [ ] Cromosol: reusar el login de `scrapers/cromosol.mjs`; recorrer las 4 empresas y todas las páginas; saldo = suma de `balance`.
- [ ] Distrisuper: reusar el login de `scrapers/distrisuper.mjs`; tomar el nº de cliente de la sesión; guardar saldo y detalle.
- [ ] Tests con fixtures recortados de las capturas (sin montos reales).

### Tarea 9: Comparación en la pantalla
- [ ] En el detalle del proveedor: "Según el proveedor $X · Según tu sistema $Y · Diferencia $Z", con los comprobantes que están de un lado y no del otro.

### Tarea 10: DM y avisos
- [ ] Confirmar qué son `compras`/`pagos` de DM; si no alcanza, cargar su resumen por foto (lectura de factura ya existente).
- [ ] Avisos de vencidos y cheques por cobrar en el panel.
