# Contexto: Feature Gestión de Productos — DANICHAP

**Última actualización:** 2026-04-06  
**Estado:** Implementado, auditado y completo

---

## Arquitectura general

```
admin.html  →  admin.js  →  supabase.js (Productos.*)  →  Supabase DB (tabla: productos)
catalogo.html  →  catalogo.js  →  supabase.js (Productos.list)  →  DB + fallback a data.js
```

---

## Archivos involucrados

| Archivo | Rol |
|---|---|
| `admin.html` | UI panel admin: skeleton rows, modal create/edit, toggles custom, watermark preview |
| `admin.js` | Lógica CRUD admin: loadProductos, renderTabla, openModal, closeModal, submit, delete, watermark canvas |
| `supabase.js` | Helpers: `Productos.create/update/delete/list/listAll/uploadImagen` |
| `catalogo.js` | Catálogo público: carga Supabase + merge compatibilidades + fallback estático |
| `data.js` | Estáticos: `PRODUCTOS`, `CATEGORIAS`, `VEHICULOS` |
| `docs/schema.sql` | Schema principal: tabla `productos`, RLS, storage bucket |
| `docs/fix-db-indexes-trigger.sql` | **Aplicar en Supabase:** índices faltantes + trigger updated_at + fix RLS recursión |

---

## Schema: tabla `productos`

```sql
id            uuid PK
nombre        text NOT NULL
categoria     text NOT NULL  -- slug: ver CATEGORIAS en data.js
subcategoria  text
marca_rep     text
precio        numeric(10,2)  -- null = "consultar por WhatsApp"
precio_antes  numeric(10,2)  -- precio tachado
descripcion   text
imagen_url    text           -- URL pública storage bucket "productos"
stock         boolean        -- false = sin stock (admin lo ve, catálogo no)
destacado     boolean
badge         text           -- UPPERCASE: "OFERTA", "NUEVO", "POPULAR"
created_at    timestamptz
updated_at    timestamptz    -- gestionado por trigger DB (fix-db-indexes-trigger.sql)
```

---

## Helpers Supabase (`supabase.js`)

```js
Productos.list(filtros)     // Público: stock=true, filtros opcionales
Productos.listAll()         // Admin: todos sin filtro stock
Productos.get(id)           // Un producto
Productos.create(payload)   // INSERT → RLS verifica rol='admin'
Productos.update(id, data)  // UPDATE → trigger DB actualiza updated_at
Productos.delete(id)        // DELETE → RLS verifica rol='admin'
Productos.uploadImagen(file) // Storage bucket "productos" → {url, error}
                             // Siempre usa .jpg para archivos watermarked
```

---

## Flujo Crear producto

1. Click "Nuevo producto" → `openModal(null)`
2. Form vacío, checkboxes: stock=✓, destacado=✗
3. Categoría → event change → `_updateSubcats()` → habilita subcategoría
4. Upload imagen → `applyWatermark()` (canvas 800×800 crop + logo DANICHAP) → `Productos.uploadImagen()`
5. Submit → validación cliente (nombre + categoría required) → `Productos.create(payload)` → `loadProductos()` → toast

## Flujo Editar producto

1. Click edit en tabla → `openModal(id)`
2. Datos precargados; imagen preview via `setImgPreview(url)`
3. Subcategorías se repoblan con `_updateSubcats()` + `setTimeout(0)` para setear valor
4. Si se sube imagen nueva → nueva URL; si solo URL manual → usa esa; si no hay cambio → conserva URL anterior
5. Submit → `Productos.update(id, payload)` → reload

## Flujo Eliminar producto

1. Click delete → `showConfirmDialog()` (dialog custom, no `confirm()` nativo)
2. Confirmar → `Productos.delete(id)` → reload → toast
3. **Imagen en storage NO se elimina automáticamente** — gestionar desde Supabase Dashboard

---

## Watermark

- Canvas 800×800, center-crop a cuadrado
- Overlay: logo SVG DANICHAP + texto "DANICHAP" esquina inferior derecha (30-34% opacidad)
- Output: JPEG 0.92
- Preview en modal: fondo blanco + overlay decorativo SVG siempre visible
- `uploadImagen` detecta `file.type` para extensión correcta (siempre `.jpg` para watermarked)

---

## Seguridad

| Capa | Detalle |
|---|---|
| Auth JS | `Perfiles.get()` verifica `rol='admin'` — primera validación |
| RLS Supabase | INSERT/UPDATE/DELETE solo si `rol='admin'` — segunda línea de defensa |
| Función `is_admin()` | `security definer` — evita recursión en RLS de `perfiles` |
| XSS tabla | `createElement + .src + .textContent` — nunca `innerHTML` con datos de usuario |
| XSS preview | `setImgPreview()` usa `createElement('img') + .src` — no innerHTML |
| Confirm delete | Dialog custom — `confirm()` nativo bloqueado en algunos contextos |
| Badge | `.toUpperCase()` siempre — normalización de input |
| Meta HTTP | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `noindex` |
| Validación | Cliente: nombre + categoría required antes de hacer request |

---

## SEO (aplicado 2026-04-06)

| Página | Mejoras |
|---|---|
| `index.html` | Title mejorado, keywords, canonical, OG tags, structured data `AutoPartsStore` con rating |
| `catalogo.html` | Title mejorado, canonical, OG tags, structured data `CollectionPage` |
| `contacto.html` | Title mejorado, canonical, OG tags, structured data `AutoPartsStore` + `ContactPoint` |
| `admin.html` | `noindex, nofollow`, `X-Frame-Options: DENY` |

---

## DB — Fixes pendientes de aplicar (docs/fix-db-indexes-trigger.sql)

```sql
-- Ejecutar en Supabase SQL Editor:
-- 1. idx_productos_stock: índice para eq('stock', true) en catálogo
-- 2. idx_productos_stock_created: índice compuesto para query principal del catálogo
-- 3. trigger trg_productos_updated_at: auto-actualiza updated_at en UPDATE
-- 4. Reescritura RLS perfiles: usa función is_admin() security definer
--    (previene recursión infinita en la policy anterior)
-- 5. WITH CHECK en "Usuario actualiza su perfil": previene auto-escalada de rol
```

---

## UI/UX — Decisiones de diseño

- **Skeleton rows:** tbody muestra 3 filas animadas antes de cargar (no colapsa a 0px)
- **Stats:** skeleton pulse individual por stat card
- **Toolbar mobile:** búsqueda full-width en mobile, botón "Nuevo" full-width en mobile
- **Modal mobile:** full-screen en mobile (sin bordes redondeados en mobile, sm:rounded-2xl)
- **Toggles:** custom CSS switch (no checkbox nativo — más consistente cross-browser)
- **Form error:** bloque con ícono + texto (no solo texto inline)
- **z-index stack:** loading=300, modal=250, confirm=400, toast=600

---

## Pendientes / mejoras futuras

- [ ] Eliminar imagen de storage al borrar producto (extraer path del URL público)
- [ ] Paginación admin cuando hay más de ~50 productos
- [ ] Campo `compatibilidades` editable en el form admin (actualmente heredado de data.js)
- [ ] Bulk actions: marcar múltiples como destacados / sin stock
- [ ] Preview watermark con canvas real antes de confirmar upload
- [ ] Aplicar `fix-db-indexes-trigger.sql` en Supabase
