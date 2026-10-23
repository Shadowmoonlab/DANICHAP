# Sistema de gestión DANICHAP — Plan completo

**Fecha:** 2026-10-23 · **Entrega:** 2026-11-04 · **Cliente:** Daniel (DANICHAP)
**Presupuesto:** $500.000 + $30.000/mes de mantenimiento · 3 revisiones incluidas

---

## 1. La idea en una frase

Daniel atiende el mostrador, cobra, y el sistema hace el resto: registra lo vendido,
arma solo la lista de reposición con **el precio de cada distribuidor actualizado todos los días**,
y cuando llega la mercadería la carga sacándole una foto a la factura.

```
          ┌──────────── GitHub Actions (06:00 todos los días) ────────────┐
          │  dm.mjs   pr.mjs   delviso.mjs   cromosol.mjs   otero.mjs     │
          └───────────────────────────┬───────────────────────────────────┘
                                      ▼
                       Supabase: precios_distribuidor
                                      │
   ┌──────────────┐   venta    ┌──────┴───────┐  faltantes  ┌────────────────────┐
   │  MOSTRADOR   │──────────▶ │    VENTAS    │───────────▶ │ CARRITO REPOSICIÓN │
   │ buscar+Enter │            │ + comprobante│             │ por proveedor/precio│
   └──────┬───────┘            └──────────────┘             └─────────┬──────────┘
          │ cliente                                                   │ pedido
   ┌──────┴───────┐                                        ┌──────────┴─────────┐
   │   CLIENTES   │                                        │ RECEPCIÓN (foto/PDF│
   │ datos + mail │                                        │ de factura → stock)│
   └──────────────┘                                        └────────────────────┘
```

---

## 2. Módulos (lo que pidió Daniel, en sus palabras)

### 2.1 Mostrador — *"paso el precio, me lo compran, pongo Enter"*
- Buscador único: escribe nombre/código/vehículo → resultados del catálogo propio **y** de los distribuidores.
- Cada resultado muestra: precio de venta (con su fórmula), stock propio, y el distribuidor más barato.
- `Enter` agrega a la venta; `F2` cierra la venta; elegir cliente (opcional, alta rápida).
- Comprobante interno ("documento no válido como factura") imprimible **solo si el cliente lo pide**.
- Todo se registra: qué, cuánto, a quién, a qué precio y con qué costo (ganancia real por venta).
- Optimizado para teclado y para la PC del mostrador (pantalla grande, letras grandes).

### 2.2 Carrito de reposición — *"que me pase a un carrito y después armo el pedido"*
- Cada artículo vendido entra **solo** al carrito de reposición.
- Vista **proveedor por proveedor, con el precio de cada uno** (pedido explícito de Daniel):
  columnas DM / PR / Del Viso / Cromosol / Otero, la más barata resaltada.
- Daniel mueve cada ítem al proveedor que quiera (logística: quién viene hoy, quién tiene stock).
- Botón "Pedido a X": arma la lista para mandar por WhatsApp o copiar al sitio del distribuidor.
- Fase 2 (si los sitios lo permiten): enviar el pedido directo (DM y PR tienen API de carrito).

### 2.3 Recepción de mercadería — *"al recibirlo…"* (audio 15:10, falta texto completo)
- Sacar foto o subir PDF de la factura del proveedor.
- IA (Claude, visión) extrae: proveedor, nº de factura, fecha, y por renglón código / descripción / cantidad / precio unitario / IVA.
- **Vista de confirmación editable** (nombres, precios, cantidades) antes de guardar.
- Al confirmar: suma stock, actualiza costo, crea productos nuevos con foto, y descuenta del carrito de reposición lo recibido.
- Probado con facturas reales que mandó Daniel: LAM (matricial), DM (ARCA), Taraborelli (Mopar).

### 2.4 Clientes — *"ir anotando todo así nos queda un listado"*
- Ficha: nombre, CUIT/DNI, teléfono, mail, dirección, notas.
- Historial de compras por cliente.
- Exportar listado (Excel) para mailing.

### 2.5 Precios de distribuidores (base de todo)
- Robots diarios en GitHub Actions; guardan en `precios_distribuidor` con precio anterior (para ver subas).
- Listas en archivo (Liqui Moly PDF, CAVILA .xls): importador desde el panel admin.
- Panel "Estado de robots": última corrida de cada distribuidor, cuántos productos, errores.

### 2.6 Fórmula de ganancia
- Detectada en la config de DM: **costo = lista − 13,6 %**, **venta = costo × 1,82**.
- Configurable por distribuidor y por rubro desde el panel (Daniel la ajusta sin programador).

---

## 3. Estado de cada distribuidor

| Distribuidor | Tipo de sitio | Cómo se automatiza | Estado |
|---|---|---|---|
| **DM** (dmcompras.com) | jQuery + endpoint JSON | `GET /login` → `GET /getProductos` (32.277 artículos de una vez) | ✅ Robot listo (`scrapers/dm.mjs`) |
| **PR Autopartes** | Angular + API REST | `POST /api/Login/authenticate` → token → `POST /api/Articulos/Buscar` paginado | ✅ Robot listo (`scrapers/pr.mjs`), falta 1ª corrida |
| **Metalúrgica del Viso** | PHP clásico | Catálogo por vehículo; la "clave" habilita precios — falta ver dónde | 🔍 Robot explorador |
| **Cromosol** (slaweb) | Desconocido (el navegador del panel no lo abrió) | — | 🔍 Robot explorador · **falta contraseña** |
| **Autopartes Otero** | PHP (`ingresar.php`, form usuario/password, sin captcha en login) | Form POST → "Lista de precios" | 🔍 Robot explorador |
| **Liqui Moly** | PDF lista de precios | Importador PDF | ⏳ |
| **CAVILA** | Excel .xls | Importador Excel | ⏳ |

**Robot explorador** (`scrapers/explorar.mjs` + workflow *Explorar sitio*): entra solo con los
secrets, recorre el sitio logueado y deja un artifact con HTML + datos JSON (credenciales tapadas).
Con eso se escribe el robot definitivo de cada sitio sin que nadie tenga que entrar a mano.

---

## 4. Secrets a cargar en GitHub (una sola vez)

`github.com/Shadowmoonlab/DANICHAP → Settings → Secrets and variables → Actions → New repository secret`

| Secret | De dónde sale el valor |
|---|---|
| `SUPABASE_URL` | `supabase.js` (SUPABASE_URL) |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → `service_role` (**nunca** en el frontend) |
| `DM_EMAIL` / `DM_PASSWORD` | Captura del gestor de contraseñas (dmcompras.com) |
| `PR_USER` / `PR_PASSWORD` | Chat 23/10 15:23 (Prautopartes.com.ar) |
| `DELVISO_USER` / `DELVISO_PASSWORD` | Chat 23/10 11:06 — solo hay "Clave"; usuario vacío o CUIT |
| `CROMOSOL_USER` / `CROMOSOL_PASSWORD` | Chat 23/10 11:08 — usuario = CUIT; **contraseña: pedir a Daniel** |
| `OTERO_USER` / `OTERO_PASSWORD` | Foto del chat 23/10 11:11 (autopartesotero.com.ar) |
| `DM_COOKIE_ID` (opcional) | Solo si DM exige equipo activado |

---

## 5. Base de datos (Supabase) — tablas nuevas

Criterios (skill *supabase-postgres-best-practices*): `bigint identity`, `numeric` para plata,
`timestamptz`, índice en toda FK, RLS con `(select public.is_admin())`, upserts por lotes vía RPC.

| Tabla | Para qué | Campos clave |
|---|---|---|
| `precios_distribuidor` ✅ | Precios diarios | distribuidor, codigo, precio_lista, precio_neto, precio_anterior, activo |
| `scraper_runs` ✅ | Log de robots | distribuidor, ok, productos, error |
| `clientes` | Agenda | nombre, cuit_dni, telefono, email, direccion, notas |
| `ventas` | Cabecera | numero (correlativo), cliente_id → clientes, total, impreso, created_at |
| `venta_items` | Renglones | venta_id → ventas, producto_id?, precio_distribuidor_id?, descripcion, cantidad, precio, costo |
| `reposicion_items` | Carrito de reposición | venta_item_id, descripcion, cantidad, distribuidor_elegido, estado (pendiente/pedido/recibido) |
| `recepciones` | Facturas de proveedor | distribuidor, nro_factura, fecha, archivo_url, estado (borrador/confirmada) |
| `recepcion_items` | Renglones extraídos | recepcion_id, codigo, descripcion, cantidad, costo, producto_id |
| `config_ganancia` | Fórmula | distribuidor?, rubro?, descuento_pct, ganancia_pct |

---

## 6. Cronograma al 4/11

| Días | Entrega |
|---|---|
| 23–25/10 | ✅ DM + PR automáticos · robot explorador · secrets · 1ª corrida |
| 26–28/10 | Robots Del Viso / Cromosol / Otero · importador Liqui Moly + CAVILA · panel estado robots |
| 27–30/10 | Clientes + Mostrador + comprobante (núcleo del día a día) |
| 30/10–1/11 | Carrito de reposición por proveedor |
| 31/10–2/11 | Recepción por foto/PDF con IA + vista de confirmación |
| 3/11 | Pruebas con Daniel en el mostrador · ajustes |
| **4/11** | **Entrega** + guía de uso simple (actualizar `docs/guia-usuario.html`) |

---

## 7. Riesgos y cómo se cubren

| Riesgo | Mitigación |
|---|---|
| Un distribuidor cambia su web y el robot falla | `fail-fast: false` (los demás siguen) + panel de estado + aviso; arreglo cubierto por el mantenimiento mensual |
| DM pide activar el equipo desde servidores de GitHub | Secret `DM_COOKIE_ID`; plan B: robot en la PC del local |
| Captcha en algún login | Ningún login visto lo tiene hoy; si aparece → lista en Excel del distribuidor |
| Costo de la IA para leer facturas | Centavos de USD por factura; cubierto en el mantenimiento |
| Términos de uso de los sitios | Se usa la cuenta propia de Daniel, 1 vez por día, con pausas entre páginas |

---

## 8. Pendientes con Daniel

1. Contraseña de Cromosol.
2. Audios completos 14:56, 15:10 y 15:19 (transcripciones cortadas).
3. La "otra página más" (audio 16:43).
4. ¿El usuario de Metalúrgica del Viso es el CUIT? (solo pasó la clave)
5. Foto de un comprobante/presupuesto que use hoy, para copiar el formato.
