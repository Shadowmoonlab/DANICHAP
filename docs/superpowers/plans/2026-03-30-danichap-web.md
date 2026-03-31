# Danichap Web Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el sitio web completo de Danichap — tienda de repuestos automotrices en Longchamps — con catálogo filtrable por vehículo, categorías jerárquicas, precios mixtos (visibles / por WhatsApp) y cierre de venta 100% por WhatsApp.

**Architecture:** Sitio estático multi-página (3 archivos HTML) que comparten un design system extraído a `shared.css` y lógica JS en `catalogo.js`. El diseño base proviene del export de Google Stitch (`stitch_export/code.html`). Sin build, sin framework — HTML + Tailwind CDN + Vanilla JS.

**Tech Stack:** HTML5, Tailwind CSS (CDN con plugins forms + container-queries), Space Grotesk + Inter (Google Fonts), Material Symbols Outlined, Vanilla JS ES6.

**Número WhatsApp:** 011 7520-0352 → Argentina (+54) → link: `https://wa.me/541175200352`

---

## Chunk 1: Shared foundation + index.html

### Task 1: Extraer design system compartido

**Files:**
- Create: `z:/proyects/DANICHAP/shared.css`
- Create: `z:/proyects/DANICHAP/shared-head.html` (snippet de referencia, no se sirve)

- [ ] **Step 1: Crear `shared.css`** con los estilos base reutilizables en las 3 páginas:

```css
/* shared.css — Danichap Design System */
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;900&family=Inter:wght@300;400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  vertical-align: middle;
}

.technical-grid {
  background-image: radial-gradient(rgba(249, 115, 22, 0.1) 1px, transparent 1px);
  background-size: 24px 24px;
}

.metallic-sheen {
  background: linear-gradient(135deg, #9d4300 0%, #f97316 100%);
}

/* WhatsApp FAB expand */
.wpp-fab-label {
  max-width: 0;
  overflow: hidden;
  transition: max-width 0.5s ease, margin-left 0.5s ease;
  white-space: nowrap;
}
.wpp-fab:hover .wpp-fab-label {
  max-width: 200px;
  margin-left: 0.75rem;
}
```

- [ ] **Step 2: Crear snippet `shared-head.html`** con el bloque `<head>` estándar que se copia en cada página (Tailwind config completo con todos los colores del design system de Stitch):

```html
<!-- shared-head.html — copiar dentro de <head> en cada página -->
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link rel="stylesheet" href="shared.css"/>
<script id="tailwind-config">
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-surface-variant": "#584237",
        "outline-variant": "#e0c0b1",
        "inverse-primary": "#ffb690",
        "on-tertiary-container": "#003b15",
        "surface-container-lowest": "#ffffff",
        "on-secondary-fixed": "#0d1c2f",
        "on-primary-container": "#582200",
        "inverse-on-surface": "#ecf1ff",
        "surface": "#f9f9ff",
        "surface-container-high": "#dee8ff",
        "error-container": "#ffdad6",
        "surface-variant": "#d8e3fb",
        "on-background": "#111c2d",
        "tertiary": "#006e2d",
        "on-primary": "#ffffff",
        "on-tertiary": "#ffffff",
        "secondary": "#515f74",
        "primary-fixed": "#ffdbca",
        "surface-container-highest": "#d8e3fb",
        "error": "#ba1a1a",
        "surface-container-low": "#f0f3ff",
        "secondary-container": "#d5e3fd",
        "outline": "#8c7164",
        "background": "#f9f9ff",
        "tertiary-container": "#2cb055",
        "on-surface": "#111c2d",
        "on-error": "#ffffff",
        "inverse-surface": "#263143",
        "primary": "#9d4300",
        "surface-container": "#e7eeff",
        "surface-dim": "#cfdaf2",
        "primary-container": "#f97316",
        "on-secondary-container": "#57657b",
        "surface-tint": "#9d4300",
      },
      fontFamily: {
        "headline": ["Space Grotesk"],
        "body": ["Inter"],
        "label": ["Inter"],
      },
      borderRadius: {
        "DEFAULT": "0.125rem",
        "lg": "0.25rem",
        "xl": "0.5rem",
        "full": "0.75rem",
      },
    },
  },
}
</script>
```

---

### Task 2: Crear `index.html` (Home)

**Files:**
- Create: `z:/proyects/DANICHAP/index.html`
- Source: `z:/proyects/DANICHAP/stitch_export/code.html` (adaptar)

- [ ] **Step 1: Copiar `stitch_export/code.html` como base de `index.html`**

- [ ] **Step 2: Reemplazar el link de WhatsApp incorrecto** — buscar `https://wa.me/12345678` y reemplazar por `https://wa.me/541175200352` en **todos** los lugares (nav, FAB, botones).

- [ ] **Step 3: Actualizar nav links** — conectar páginas reales:
  - `Catálogo` → `catalogo.html`
  - `Contacto` → `contacto.html`
  - `Inicio` → `index.html`
  - `Marcas` → `catalogo.html#marcas`
  - `Nosotros` → `contacto.html#nosotros`

- [ ] **Step 4: Actualizar las categorías** del grid "Navegá por categoría" para que coincidan exactamente con las de Danichap (reemplazar las 8 genéricas de Stitch por las reales):

```html
<!-- Reemplazar el grid de categorías con estos 8 items -->
<!-- 1 --> <span class="material-symbols-outlined ...">lightbulb</span> Iluminación
<!-- 2 --> <span class="material-symbols-outlined ...">car_repair</span> Chaperio
<!-- 3 --> <span class="material-symbols-outlined ...">settings</span> Mecánica
<!-- 4 --> <span class="material-symbols-outlined ...">thermostat</span> Refrigeración
<!-- 5 --> <span class="material-symbols-outlined ...">bolt</span> Electricidad
<!-- 6 --> <span class="material-symbols-outlined ...">cleaning_services</span> Art. Limpieza
<!-- 7 --> <span class="material-symbols-outlined ...">lock</span> Cerraduras
<!-- 8 --> <span class="material-symbols-outlined ...">brake_warning</span> Frenos
```
Cada categoría debe ser `<a href="catalogo.html?cat=SLUG">` para pre-filtrar el catálogo.

- [ ] **Step 5: Armar los slugs de categoría** — cada enlace de categoría desde Home envía a catálogo con `?cat=` param:
  - `iluminacion`, `chaperio`, `mecanica`, `refrigeracion`, `electricidad`, `limpieza`, `cerraduras`, `frenos`

- [ ] **Step 6: Reemplazar `shared.css` link** — en `<head>` de index.html agregar `<link rel="stylesheet" href="shared.css"/>` y eliminar los `<style>` inline duplicados.

- [ ] **Step 7: Verificar apertura en navegador** — abrir `index.html` directamente en el browser (file://) y confirmar que nav, hero, categorías, productos, footer y FAB de WhatsApp se ven correctos.

---

## Chunk 2: Data layer + Catálogo

### Task 3: Crear `data.js` — base de datos de vehículos y productos

**Files:**
- Create: `z:/proyects/DANICHAP/data.js`

Este archivo centraliza todos los datos. Se incluye en `catalogo.html` con `<script src="data.js"></script>`.

- [ ] **Step 1: Definir `VEHICULOS`** — objeto anidado Marca → Modelos → Versiones → Años:

```js
// data.js
const VEHICULOS = {
  "Toyota": {
    "Corolla": {
      "versiones": ["1.6 XLi", "1.8 XEi", "2.0 SE-G", "Hybrid"],
      "años": [2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Hilux": {
      "versiones": ["SR 4x2", "SR 4x4", "SRV 4x2", "SRV 4x4", "SRX"],
      "años": [2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Etios": {
      "versiones": ["1.5 XS", "1.5 XLS", "1.5 Platinum"],
      "años": [2013,2014,2015,2016,2017,2018,2019,2020]
    },
    "RAV4": {
      "versiones": ["2.0 VX", "2.4 4x4", "2.5 Hybrid"],
      "años": [2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
  },
  "Volkswagen": {
    "Gol": {
      "versiones": ["1.4 Trendline", "1.6 Comfortline", "1.6 Highline", "1.6 MSI"],
      "años": [1995,1996,1997,1998,1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
    "Polo": {
      "versiones": ["1.6 Trendline", "1.6 Comfortline", "1.6 Highline", "GTS"],
      "años": [2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Vento": {
      "versiones": ["1.4 TSI Trendline", "1.4 TSI Comfortline", "1.4 TSI Highline"],
      "años": [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Amarok": {
      "versiones": ["2.0 TDI 4x2", "2.0 TDI 4x4", "V6 Extreme 4x4"],
      "años": [2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
  },
  "Ford": {
    "Focus": {
      "versiones": ["1.6 S", "1.6 SE", "2.0 SE Plus", "2.0 Titanium"],
      "años": [1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018]
    },
    "Ranger": {
      "versiones": ["2.2 XL 4x2", "2.2 XLS 4x2", "2.2 XLT 4x4", "3.2 Limited 4x4"],
      "años": [2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "EcoSport": {
      "versiones": ["1.6 SE", "1.6 Freestyle", "2.0 Titanium 4WD"],
      "años": [2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021]
    },
    "Ka": {
      "versiones": ["1.0 S", "1.5 SE", "1.5 SE Plus"],
      "años": [2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
  },
  "Chevrolet": {
    "Onix": {
      "versiones": ["1.0 LS", "1.4 LT", "1.4 LTZ", "1.0 Turbo Premier"],
      "años": [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Cruze": {
      "versiones": ["1.4 LS", "1.4 LT", "1.4 LTZ", "1.8 LT"],
      "años": [2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "S10": {
      "versiones": ["2.8 LS 4x2", "2.8 LT 4x4", "2.8 High Country 4x4"],
      "años": [2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Tracker": {
      "versiones": ["1.2 Turbo LS", "1.2 Turbo LT", "1.2 Turbo Premier"],
      "años": [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
  },
  "Renault": {
    "Clio": {
      "versiones": ["1.2 Authentique", "1.6 Privilege", "2.0 Sport"],
      "años": [1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013]
    },
    "Sandero": {
      "versiones": ["1.6 Authentique", "1.6 Expression", "1.6 Privilege"],
      "años": [2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021]
    },
    "Logan": {
      "versiones": ["1.6 Authentique", "1.6 Expression", "1.6 Privilege"],
      "años": [2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020]
    },
    "Kangoo": {
      "versiones": ["1.6 Authentique", "1.6 Confort", "1.5 dCi"],
      "años": [2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022]
    },
  },
  "Peugeot": {
    "207": {
      "versiones": ["1.4 Active", "1.6 Allure", "1.6 XS", "1.6 THP Sport"],
      "años": [2006,2007,2008,2009,2010,2011,2012,2013,2014]
    },
    "208": {
      "versiones": ["1.2 Active", "1.5 Allure", "1.6 GT Line", "1.6 GT"],
      "años": [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "308": {
      "versiones": ["1.6 Active", "1.6 Allure", "1.6 GT Line", "2.0 HDi"],
      "años": [2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
    "Partner": {
      "versiones": ["1.4 Furgon", "1.6 HDi Furgon", "1.6 HDi Patagonia"],
      "años": [2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021]
    },
  },
  "Fiat": {
    "Palio": {
      "versiones": ["1.3 Fire S", "1.6 ELX", "1.8 EX"],
      "años": [1997,1998,1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012]
    },
    "Cronos": {
      "versiones": ["1.3 Drive", "1.8 Precision", "1.3 GNC"],
      "años": [2018,2019,2020,2021,2022,2023,2024]
    },
    "Fiorino": {
      "versiones": ["1.4 Furgon", "1.3 GNC Furgon"],
      "años": [2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
    "Strada": {
      "versiones": ["1.4 Trekking", "1.3 Volcano", "1.3 Freedom"],
      "años": [2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
  },
  "Honda": {
    "Civic": {
      "versiones": ["1.8 LX", "1.5 Turbo EX", "2.0 Si"],
      "años": [2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
    "HR-V": {
      "versiones": ["1.8 LX 2WD", "1.8 EX 2WD", "1.8 EXL AWD"],
      "años": [2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Fit": {
      "versiones": ["1.4 LX", "1.5 EX"],
      "años": [2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021]
    },
  },
  "Nissan": {
    "Frontier": {
      "versiones": ["2.5 S 4x2", "2.5 LE 4x4", "2.3 PRO-4X"],
      "años": [2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Kicks": {
      "versiones": ["1.6 Sense MT", "1.6 Advance AT", "1.6 Exclusive AT"],
      "años": [2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Sentra": {
      "versiones": ["1.8 S MT", "1.8 SL CVT"],
      "años": [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
  },
  "Hyundai": {
    "Tucson": {
      "versiones": ["2.0 GL 4x2", "2.0 GLS 4x4", "1.6 Turbo N Line"],
      "años": [2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Elantra": {
      "versiones": ["1.6 GL", "1.6 GLS", "2.0 GLS"],
      "años": [2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
    "i30": {
      "versiones": ["1.4 GL", "1.6 GLS", "2.0 Sport"],
      "años": [2009,2010,2011,2012,2013,2014,2015,2016,2017]
    },
  },
  "Kia": {
    "Sportage": {
      "versiones": ["2.0 LX 4x2", "2.0 EX 4x4", "1.6 T-GDi GT-Line"],
      "años": [2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024]
    },
    "Cerato": {
      "versiones": ["1.6 EX MT", "1.6 EX AT", "2.0 SX"],
      "años": [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023]
    },
    "Sorento": {
      "versiones": ["2.4 LX 4x2", "3.5 EX 4x4"],
      "años": [2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020]
    },
  },
};
```

- [ ] **Step 2: Definir `CATEGORIAS`** — estructura jerárquica con slug, label, icono y subcategorías:

```js
const CATEGORIAS = [
  {
    slug: "iluminacion",
    label: "Iluminación",
    icon: "lightbulb",
    subs: ["Faros delanteros", "Faros traseros", "Luces LED", "Luces de posición", "Focos H4/H7", "Luces interiores"]
  },
  {
    slug: "chaperio",
    label: "Chaperio",
    icon: "car_repair",
    subs: ["Paragolpes", "Molduras", "Espejos retrovisores", "Bisagras", "Capós", "Guardabarros"]
  },
  {
    slug: "mecanica",
    label: "Mecánica",
    icon: "settings",
    subs: [
      "Tren delantero / Rótulas",
      "Tren delantero / Bujes",
      "Tren delantero / Terminales dirección",
      "Tren delantero / Amortiguadores",
      "Frenos / Pastillas",
      "Frenos / Discos",
      "Frenos / Zapatas",
      "Frenos / Bombas de freno",
    ]
  },
  {
    slug: "refrigeracion",
    label: "Refrigeración",
    icon: "thermostat",
    subs: [
      "Electro ventiladores",
      "Radiador de agua",
      "Termostatos",
      "Mangueras de agua",
      "Tapas de radiador",
    ]
  },
  {
    slug: "electricidad",
    label: "Electricidad",
    icon: "bolt",
    subs: ["Alternadores", "Motores de arranque", "Bujías", "Cables de bujía", "Sensores", "Fusibles"]
  },
  {
    slug: "limpieza",
    label: "Art. Limpieza / Liqui-Moly",
    icon: "cleaning_services",
    subs: ["Aditivos motor Liqui-Moly", "Aceites Liqui-Moly", "Limpiadores de inyectores", "Desengrasantes", "Limpia contactos", "Escobillas limpiaparabrisas"]
  },
  {
    slug: "cerraduras",
    label: "Cerraduras",
    icon: "lock",
    subs: ["Cilindros de cerradura", "Manijas exteriores", "Manijas interiores", "Actuadores eléctricos", "Bocallaves", "Kits de cerradura"]
  },
];
```

- [ ] **Step 3: Definir `PRODUCTOS`** — array de 24 productos de ejemplo que cubran todas las categorías:

```js
// precio: número = visible en web. null = solo por WhatsApp.
const PRODUCTOS = [
  // ILUMINACIÓN
  { id: 1, nombre: "Faro delantero LED derecho", categoria: "iluminacion", sub: "Faros delanteros", marca_rep: "TYC", precio: 38500, imagen: null, compatibilidades: ["Toyota Corolla 2014-2019", "Toyota Corolla 2020-2024"] },
  { id: 2, nombre: "Faro trasero izquierdo", categoria: "iluminacion", sub: "Faros traseros", marca_rep: "Depo", precio: null, imagen: null, compatibilidades: ["Volkswagen Gol 2009-2016"] },
  { id: 3, nombre: "Kit faros antiniebla H11", categoria: "iluminacion", sub: "Focos H4/H7", marca_rep: "Osram", precio: 12900, imagen: null, compatibilidades: ["Universal"] },

  // CHAPERIO
  { id: 4, nombre: "Paragolpes delantero completo", categoria: "chaperio", sub: "Paragolpes", marca_rep: "", precio: null, imagen: null, compatibilidades: ["Ford Focus 2012-2018"] },
  { id: 5, nombre: "Espejo retrovisor eléctrico derecho", categoria: "chaperio", sub: "Espejos retrovisores", marca_rep: "", precio: 24800, imagen: null, compatibilidades: ["Peugeot 208 2013-2021", "Peugeot 207 2008-2014"] },
  { id: 6, nombre: "Moldura paragolpes trasero", categoria: "chaperio", sub: "Molduras", marca_rep: "", precio: null, imagen: null, compatibilidades: ["Renault Sandero 2014-2021"] },

  // MECÁNICA — FRENOS
  { id: 7, nombre: "Pastillas de freno delanteras", categoria: "mecanica", sub: "Frenos / Pastillas", marca_rep: "Brembo", precio: 28500, imagen: null, compatibilidades: ["Toyota Corolla 2014-2024", "Toyota RAV4 2013-2020"] },
  { id: 8, nombre: "Disco de freno ventilado", categoria: "mecanica", sub: "Frenos / Discos", marca_rep: "Brembo", precio: 35900, imagen: null, compatibilidades: ["Volkswagen Vento 2013-2023", "Volkswagen Polo 2010-2023"] },
  { id: 9, nombre: "Zapatas de freno traseras", categoria: "mecanica", sub: "Frenos / Zapatas", marca_rep: "Ferodo", precio: null, imagen: null, compatibilidades: ["Chevrolet Onix 2013-2019"] },

  // MECÁNICA — TREN DELANTERO
  { id: 10, nombre: "Rótula inferior derecha", categoria: "mecanica", sub: "Tren delantero / Rótulas", marca_rep: "Febest", precio: 18200, imagen: null, compatibilidades: ["Toyota Hilux 2012-2024"] },
  { id: 11, nombre: "Terminal de dirección izquierdo", categoria: "mecanica", sub: "Tren delantero / Terminales dirección", marca_rep: "TRW", precio: 9800, imagen: null, compatibilidades: ["Renault Clio 2003-2013", "Renault Sandero 2008-2021"] },
  { id: 12, nombre: "Buje de rueda trasero", categoria: "mecanica", sub: "Tren delantero / Bujes", marca_rep: "SKF", precio: null, imagen: null, compatibilidades: ["Ford Focus 2006-2018"] },

  // REFRIGERACIÓN
  { id: 13, nombre: "Electro ventilador completo", categoria: "refrigeracion", sub: "Electro ventiladores", marca_rep: "Valeo", precio: 52000, imagen: null, compatibilidades: ["Peugeot 207 2006-2014", "Peugeot 208 2013-2021"] },
  { id: 14, nombre: "Radiador de agua", categoria: "refrigeracion", sub: "Radiador de agua", marca_rep: "Nissens", precio: null, imagen: null, compatibilidades: ["Ford Ranger 2012-2020"] },
  { id: 15, nombre: "Termostato motor", categoria: "refrigeracion", sub: "Termostatos", marca_rep: "Gates", precio: 8500, imagen: null, compatibilidades: ["Chevrolet Cruze 2012-2020"] },

  // ELECTRICIDAD
  { id: 16, nombre: "Bujía Iridium Power", categoria: "electricidad", sub: "Bujías", marca_rep: "NGK", precio: 4200, imagen: null, compatibilidades: ["Universal — consultar modelo"] },
  { id: 17, nombre: "Motor de arranque", categoria: "electricidad", sub: "Motores de arranque", marca_rep: "Bosch", precio: null, imagen: null, compatibilidades: ["Toyota Corolla 2002-2014"] },
  { id: 18, nombre: "Alternador reconstruido", categoria: "electricidad", sub: "Alternadores", marca_rep: "Bosch", precio: null, imagen: null, compatibilidades: ["Volkswagen Gol 2009-2023"] },

  // LIMPIEZA / LIQUI-MOLY
  { id: 19, nombre: "Aditivo limpia inyectores Liqui-Moly", categoria: "limpieza", sub: "Limpiadores de inyectores", marca_rep: "Liqui-Moly", precio: 6900, imagen: null, compatibilidades: ["Universal"] },
  { id: 20, nombre: "Aceite motor 5W40 Full Synthetic Liqui-Moly 5L", categoria: "limpieza", sub: "Aceites Liqui-Moly", marca_rep: "Liqui-Moly", precio: 28900, imagen: null, compatibilidades: ["Universal"] },
  { id: 21, nombre: "Kit mantenimiento Liqui-Moly (aditivos + limpiadores)", categoria: "limpieza", sub: "Aditivos motor Liqui-Moly", marca_rep: "Liqui-Moly", precio: null, imagen: null, compatibilidades: ["Universal"] },

  // CERRADURAS
  { id: 22, nombre: "Cerradura puerta delantera derecha", categoria: "cerraduras", sub: "Cilindros de cerradura", marca_rep: "", precio: null, imagen: null, compatibilidades: ["Volkswagen Gol 2009-2023"] },
  { id: 23, nombre: "Manija exterior delantera izquierda", categoria: "cerraduras", sub: "Manijas exteriores", marca_rep: "", precio: 7400, imagen: null, compatibilidades: ["Chevrolet Onix 2013-2019", "Chevrolet Tracker 2013-2021"] },
  { id: 24, nombre: "Actuador eléctrico de cerradura", categoria: "cerraduras", sub: "Actuadores eléctricos", marca_rep: "", precio: null, imagen: null, compatibilidades: ["Ford Focus 2010-2018"] },
];
```

- [ ] **Step 4: Definir constante WhatsApp** al tope del archivo:

```js
const WPP_NUMBER = "541175200352"; // Argentina +54 11 7520-0352
const WPP_BASE = `https://wa.me/${WPP_NUMBER}`;

function wppLink(productoNombre, vehiculo = "") {
  const msg = vehiculo
    ? `Hola Danichap! Consulto por: *${productoNombre}* para mi vehículo *${vehiculo}*. ¿Tienen stock y precio?`
    : `Hola Danichap! Consulto por: *${productoNombre}*. ¿Tienen stock y precio?`;
  return `${WPP_BASE}?text=${encodeURIComponent(msg)}`;
}
```

---

### Task 4: Crear `catalogo.html`

**Files:**
- Create: `z:/proyects/DANICHAP/catalogo.html`

- [ ] **Step 1: Crear estructura HTML base** — copiar el `<head>` del shared snippet (Task 1), cambiar `<title>` a `"DANICHAP — Catálogo de Repuestos"`, incluir `data.js` y `catalogo.js`.

```html
<!DOCTYPE html>
<html class="light" lang="es">
<head>
  <meta charset="utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>DANICHAP — Catálogo de Repuestos</title>
  <!-- [insertar shared head: tailwind CDN, tailwind.config, shared.css, fonts] -->
  <script src="data.js"></script>
  <script defer src="catalogo.js"></script>
</head>
```

- [ ] **Step 2: Agregar el mismo nav** que index.html (copiar y pegar, links actualizados).

- [ ] **Step 3: Crear el layout principal** — sidebar izquierdo fijo + área de resultados derecha:

```html
<div class="flex pt-20 min-h-screen bg-surface">
  <!-- SIDEBAR -->
  <aside id="sidebar" class="w-80 flex-shrink-0 p-6 bg-surface-container-low sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto">
    <!-- Filtro vehículo -->
    <div class="mb-8">
      <h3 class="font-headline font-black text-sm uppercase tracking-widest text-primary-container mb-4">Tu vehículo</h3>
      <div class="space-y-3">
        <select id="fil-marca" class="w-full rounded-xl bg-white border-0 shadow-sm p-3 font-body text-sm focus:ring-2 focus:ring-primary-container">
          <option value="">Todas las marcas</option>
        </select>
        <select id="fil-modelo" class="w-full rounded-xl bg-white border-0 shadow-sm p-3 font-body text-sm" disabled>
          <option value="">Seleccioná una marca</option>
        </select>
        <select id="fil-version" class="w-full rounded-xl bg-white border-0 shadow-sm p-3 font-body text-sm" disabled>
          <option value="">Seleccioná un modelo</option>
        </select>
        <select id="fil-año" class="w-full rounded-xl bg-white border-0 shadow-sm p-3 font-body text-sm" disabled>
          <option value="">Seleccioná un modelo</option>
        </select>
        <button id="btn-buscar" class="w-full metallic-sheen text-white py-3 rounded-xl font-headline font-bold uppercase tracking-wide text-sm hover:opacity-90 transition-opacity">
          Buscar repuestos →
        </button>
        <button id="btn-limpiar" class="w-full text-secondary underline text-xs font-body py-1 hover:text-on-surface transition-colors hidden">
          Limpiar filtros
        </button>
      </div>
    </div>

    <!-- Categorías accordion -->
    <div>
      <h3 class="font-headline font-black text-sm uppercase tracking-widest text-primary-container mb-4">Categoría</h3>
      <div id="categorias-sidebar" class="space-y-1">
        <!-- generado por catalogo.js -->
      </div>
    </div>
  </aside>

  <!-- MAIN CONTENT -->
  <main class="flex-1 p-8">
    <!-- Barra superior de resultados -->
    <div class="flex items-center justify-between mb-8">
      <p id="resultado-count" class="font-body text-secondary text-sm"></p>
      <div class="flex items-center gap-3">
        <label class="font-body text-sm text-secondary">Ordenar:</label>
        <select id="sort-select" class="rounded-xl bg-white border-0 shadow-sm p-2 text-sm font-body focus:ring-2 focus:ring-primary-container">
          <option value="default">Relevancia</option>
          <option value="price-asc">Precio: menor a mayor</option>
          <option value="price-desc">Precio: mayor a menor</option>
          <option value="name-asc">Nombre A-Z</option>
        </select>
      </div>
    </div>

    <!-- Grid de productos -->
    <div id="productos-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      <!-- generado por catalogo.js -->
    </div>

    <!-- Estado vacío -->
    <div id="empty-state" class="hidden text-center py-24">
      <span class="material-symbols-outlined text-6xl text-secondary mb-4 block">search_off</span>
      <h3 class="font-headline font-bold text-xl mb-2">Sin resultados</h3>
      <p class="text-secondary font-body mb-6">No encontramos productos con esos filtros. Consultanos directamente por WhatsApp.</p>
      <a id="empty-wpp" href="https://wa.me/541175200352" target="_blank" class="inline-flex items-center gap-2 bg-tertiary-container text-on-tertiary-container px-6 py-3 rounded-xl font-bold font-headline uppercase text-sm hover:bg-tertiary transition-colors">
        <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;">chat</span>
        Consultar por WhatsApp
      </a>
    </div>
  </main>
</div>
```

- [ ] **Step 4: Agregar el mismo footer** que index.html (copiar y pegar).

- [ ] **Step 5: Agregar el FAB de WhatsApp** (igual que index.html).

---

### Task 5: Crear `catalogo.js` — lógica del catálogo

**Files:**
- Create: `z:/proyects/DANICHAP/catalogo.js`

- [ ] **Step 1: Inicializar filtros de vehículo** — poblar el `<select>` de marcas y manejar cascada:

```js
// catalogo.js
document.addEventListener('DOMContentLoaded', () => {
  const selMarca   = document.getElementById('fil-marca');
  const selModelo  = document.getElementById('fil-modelo');
  const selVersion = document.getElementById('fil-version');
  const selAño     = document.getElementById('fil-año');
  const btnBuscar  = document.getElementById('btn-buscar');
  const btnLimpiar = document.getElementById('btn-limpiar');

  // --- Estado de filtros activos ---
  let filtros = { marca: '', modelo: '', version: '', año: '', cat: '', sub: '', sort: 'default' };

  // --- Poblar marcas ---
  Object.keys(VEHICULOS).sort().forEach(m => {
    selMarca.add(new Option(m, m));
  });

  // --- Cascada Marca → Modelo ---
  selMarca.addEventListener('change', () => {
    filtros.marca = selMarca.value;
    filtros.modelo = ''; filtros.version = ''; filtros.año = '';
    resetSelect(selModelo, 'Seleccioná un modelo');
    resetSelect(selVersion, 'Seleccioná una versión');
    resetSelect(selAño, 'Seleccioná el año');
    selVersion.disabled = true; selAño.disabled = true;

    if (filtros.marca) {
      Object.keys(VEHICULOS[filtros.marca]).sort().forEach(m => {
        selModelo.add(new Option(m, m));
      });
      selModelo.disabled = false;
    } else {
      selModelo.disabled = true;
    }
  });

  // --- Cascada Modelo → Versión + Año ---
  selModelo.addEventListener('change', () => {
    filtros.modelo = selModelo.value;
    filtros.version = ''; filtros.año = '';
    resetSelect(selVersion, 'Todas las versiones');
    resetSelect(selAño, 'Todos los años');

    if (filtros.marca && filtros.modelo) {
      const data = VEHICULOS[filtros.marca][filtros.modelo];
      data.versiones.forEach(v => selVersion.add(new Option(v, v)));
      selVersion.disabled = false;
      [...data.años].sort((a,b) => b-a).forEach(a => selAño.add(new Option(a, a)));
      selAño.disabled = false;
    } else {
      selVersion.disabled = true; selAño.disabled = true;
    }
  });

  selVersion.addEventListener('change', () => { filtros.version = selVersion.value; });
  selAño.addEventListener('change', () => { filtros.año = selAño.value; });

  // --- Buscar ---
  btnBuscar.addEventListener('click', () => {
    renderProductos();
    btnLimpiar.classList.remove('hidden');
  });

  // --- Limpiar ---
  btnLimpiar.addEventListener('click', () => {
    filtros = { marca: '', modelo: '', version: '', año: '', cat: filtros.cat, sub: filtros.sub, sort: 'default' };
    selMarca.value = ''; selModelo.value = ''; selVersion.value = ''; selAño.value = '';
    selModelo.disabled = true; selVersion.disabled = true; selAño.disabled = true;
    btnLimpiar.classList.add('hidden');
    renderProductos();
  });

  // --- Sort ---
  document.getElementById('sort-select').addEventListener('change', e => {
    filtros.sort = e.target.value;
    renderProductos();
  });

  function resetSelect(sel, placeholder) {
    sel.innerHTML = `<option value="">${placeholder}</option>`;
  }
```

- [ ] **Step 2: Renderizar categorías en sidebar** — accordion expandible:

```js
  // --- Render sidebar categorías ---
  function renderSidebarCats() {
    const container = document.getElementById('categorias-sidebar');
    container.innerHTML = '';

    // Opción "Todos"
    const allBtn = document.createElement('button');
    allBtn.className = `w-full text-left px-3 py-2 rounded-lg font-body text-sm font-semibold transition-colors ${filtros.cat === '' ? 'bg-primary-container text-white' : 'text-on-surface hover:bg-surface-container'}`;
    allBtn.textContent = 'Todos los productos';
    allBtn.addEventListener('click', () => { filtros.cat = ''; filtros.sub = ''; renderSidebarCats(); renderProductos(); });
    container.appendChild(allBtn);

    CATEGORIAS.forEach(cat => {
      const isActive = filtros.cat === cat.slug;

      // Botón categoría
      const catBtn = document.createElement('div');
      catBtn.className = 'overflow-hidden';
      catBtn.innerHTML = `
        <button class="w-full flex items-center gap-2 px-3 py-2 rounded-lg font-body text-sm font-semibold transition-colors ${isActive ? 'bg-primary-container/10 text-primary' : 'text-on-surface hover:bg-surface-container'}" data-cat="${cat.slug}">
          <span class="material-symbols-outlined text-base text-primary-container">${cat.icon}</span>
          <span class="flex-1 text-left">${cat.label}</span>
          <span class="material-symbols-outlined text-sm transition-transform ${isActive ? 'rotate-180' : ''}">expand_more</span>
        </button>
        <div class="subcats pl-8 space-y-0.5 mt-1 ${isActive ? '' : 'hidden'}">
          ${cat.subs.map(s => `
            <button class="w-full text-left px-2 py-1.5 rounded text-xs font-body transition-colors ${filtros.sub === s ? 'text-primary font-bold' : 'text-secondary hover:text-on-surface'}" data-sub="${s}">
              ${s}
            </button>`).join('')}
        </div>
      `;

      catBtn.querySelector('[data-cat]').addEventListener('click', () => {
        filtros.cat = isActive ? '' : cat.slug;
        filtros.sub = '';
        renderSidebarCats();
        renderProductos();
      });

      catBtn.querySelectorAll('[data-sub]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          filtros.sub = btn.dataset.sub === filtros.sub ? '' : btn.dataset.sub;
          renderSidebarCats();
          renderProductos();
        });
      });

      container.appendChild(catBtn);
    });
  }
```

- [ ] **Step 3: Filtrar y renderizar productos** — función principal:

```js
  function getProductosFiltrados() {
    let lista = [...PRODUCTOS];

    // Filtro categoría / sub
    if (filtros.cat) lista = lista.filter(p => p.categoria === filtros.cat);
    if (filtros.sub) lista = lista.filter(p => p.sub === filtros.sub);

    // Filtro vehículo (texto en compatibilidades)
    if (filtros.marca || filtros.modelo) {
      const query = [filtros.marca, filtros.modelo, filtros.año].filter(Boolean).join(' ').toLowerCase();
      lista = lista.filter(p =>
        p.compatibilidades.some(c => c.toLowerCase().includes(query) || c === 'Universal')
      );
    }

    // Sort
    if (filtros.sort === 'price-asc') {
      lista.sort((a, b) => {
        if (a.precio === null) return 1;
        if (b.precio === null) return -1;
        return a.precio - b.precio;
      });
    } else if (filtros.sort === 'price-desc') {
      lista.sort((a, b) => {
        if (a.precio === null) return 1;
        if (b.precio === null) return -1;
        return b.precio - a.precio;
      });
    } else if (filtros.sort === 'name-asc') {
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    return lista;
  }

  function buildVehiculoStr() {
    return [filtros.marca, filtros.modelo, filtros.version, filtros.año].filter(Boolean).join(' ');
  }

  function renderProductos() {
    const lista = getProductosFiltrados();
    const grid = document.getElementById('productos-grid');
    const emptyState = document.getElementById('empty-state');
    const countEl = document.getElementById('resultado-count');

    countEl.textContent = `${lista.length} producto${lista.length !== 1 ? 's' : ''} encontrado${lista.length !== 1 ? 's' : ''}`;

    if (lista.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      // Actualizar link de WhatsApp con contexto
      const vehiculo = buildVehiculoStr();
      const msg = vehiculo
        ? `Hola Danichap! No encontré el repuesto que necesito para mi ${vehiculo}. ¿Me podés ayudar?`
        : `Hola Danichap! Necesito un repuesto que no encuentro en el catálogo. ¿Me podés ayudar?`;
      document.getElementById('empty-wpp').href = `https://wa.me/${WPP_NUMBER}?text=${encodeURIComponent(msg)}`;
      return;
    }

    emptyState.classList.add('hidden');
    grid.innerHTML = lista.map(p => renderCard(p)).join('');
  }

  function formatPrecio(n) {
    return '$ ' + n.toLocaleString('es-AR');
  }

  function renderCard(p) {
    const vehiculo = buildVehiculoStr();
    const wpp = wppLink(p.nombre, vehiculo);
    const cat = CATEGORIAS.find(c => c.slug === p.categoria);

    const precioHtml = p.precio !== null
      ? `<span class="text-2xl font-black text-on-surface font-headline">${formatPrecio(p.precio)}</span>`
      : `<span class="inline-flex items-center gap-1 text-tertiary font-bold text-sm font-body">
           <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1;">chat</span>
           Precio por WhatsApp
         </span>`;

    const compatHtml = p.compatibilidades.length
      ? `<p class="text-xs text-tertiary font-body mb-3">✓ ${p.compatibilidades[0]}${p.compatibilidades.length > 1 ? ` +${p.compatibilidades.length - 1} más` : ''}</p>`
      : '';

    return `
      <div class="bg-surface-container-lowest rounded-xl overflow-hidden group hover:shadow-xl transition-all duration-300 border border-surface-container flex flex-col">
        <div class="relative h-48 bg-surface-container-low flex items-center justify-center overflow-hidden">
          <span class="material-symbols-outlined text-8xl text-surface-dim group-hover:scale-110 transition-transform duration-500">${cat ? cat.icon : 'build'}</span>
          ${p.marca_rep ? `<span class="absolute top-3 left-3 bg-inverse-surface text-white text-[10px] font-bold px-2 py-1 uppercase tracking-widest font-label rounded">${p.marca_rep}</span>` : ''}
        </div>
        <div class="p-5 flex flex-col flex-1">
          <span class="text-[10px] font-bold uppercase tracking-widest text-secondary font-label mb-1">${cat ? cat.label : ''} ${p.sub ? '· ' + p.sub.split(' / ').pop() : ''}</span>
          <h3 class="font-headline font-bold text-base uppercase mb-2 leading-tight">${p.nombre}</h3>
          ${compatHtml}
          <div class="mt-auto pt-4 flex items-center justify-between gap-3">
            ${precioHtml}
            <a href="${wpp}" target="_blank" rel="noopener"
               class="flex-shrink-0 bg-tertiary-container text-on-tertiary-container px-3 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 hover:bg-tertiary transition-colors font-label uppercase tracking-wide">
              <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">chat</span>
              Consultar
            </a>
          </div>
        </div>
      </div>`;
  }
```

- [ ] **Step 4: Leer parámetros URL al cargar** — para pre-filtrar desde links de Home:

```js
  function leerParamsURL() {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat');
    if (cat) {
      filtros.cat = cat;
    }
  }

  // --- Boot ---
  leerParamsURL();
  renderSidebarCats();
  renderProductos();
}); // fin DOMContentLoaded
```

- [ ] **Step 5: Verificar en navegador** — abrir `catalogo.html`, probar:
  1. Seleccionar Toyota → aparecen modelos
  2. Seleccionar Corolla → aparecen versiones y años
  3. Click "Buscar" → productos filtrados
  4. Click categoría "Mecánica" → accordion se expande, muestra subcategorías
  5. Click subcategoría "Frenos / Pastillas" → filtra
  6. Botón "Consultar" de un producto → abre WhatsApp con mensaje correcto

---

## Chunk 3: Página de contacto

### Task 6: Crear `contacto.html`

**Files:**
- Create: `z:/proyects/DANICHAP/contacto.html`

- [ ] **Step 1: Crear estructura HTML base** — mismo head compartido, title `"DANICHAP — Contacto"`.

- [ ] **Step 2: Crear sección Hero de contacto** — dark background, título, subtítulo:

```html
<section class="pt-32 pb-16 bg-inverse-surface text-white relative overflow-hidden">
  <div class="absolute inset-0 technical-grid opacity-10"></div>
  <div class="max-w-4xl mx-auto px-6 text-center relative z-10">
    <span class="inline-block px-4 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-400 text-xs font-bold tracking-widest uppercase font-label mb-6">Contacto</span>
    <h1 class="font-headline text-5xl font-black uppercase tracking-tighter mb-4">Hablemos <span class="text-primary-container">por WhatsApp</span></h1>
    <p class="text-slate-400 text-lg max-w-xl mx-auto font-body">Respondemos en minutos. Asesoramiento técnico real, antes y después de tu compra.</p>
  </div>
</section>
```

- [ ] **Step 3: Crear sección de datos de contacto + mapa** en layout 2 columnas:

```html
<section class="py-20 bg-surface">
  <div class="max-w-5xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

    <!-- Datos -->
    <div>
      <h2 class="font-headline font-black text-2xl uppercase mb-8">Encontranos</h2>

      <!-- WhatsApp CTA destacado -->
      <a href="https://wa.me/541175200352?text=Hola%20Danichap!%20Quisiera%20consultar%20por%20un%20repuesto."
         target="_blank"
         class="flex items-center gap-4 bg-tertiary-container text-on-tertiary-container p-5 rounded-xl mb-8 hover:bg-tertiary transition-colors group">
        <span class="material-symbols-outlined text-4xl flex-shrink-0" style="font-variation-settings:'FILL' 1;">chat</span>
        <div>
          <p class="font-headline font-black text-lg uppercase">WhatsApp directo</p>
          <p class="font-body text-sm opacity-80">011 7520-0352 — Click para abrir chat</p>
        </div>
        <span class="material-symbols-outlined ml-auto group-hover:translate-x-1 transition-transform">arrow_forward</span>
      </a>

      <!-- Info -->
      <ul class="space-y-6">
        <li class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center flex-shrink-0">
            <span class="material-symbols-outlined text-primary-container">location_on</span>
          </div>
          <div>
            <p class="font-headline font-bold text-sm uppercase tracking-wide mb-1">Dirección</p>
            <p class="font-body text-secondary">Av. Hipólito Yrigoyen 19608<br>B1854, Longchamps, Buenos Aires</p>
          </div>
        </li>
        <li class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center flex-shrink-0">
            <span class="material-symbols-outlined text-primary-container">schedule</span>
          </div>
          <div>
            <p class="font-headline font-bold text-sm uppercase tracking-wide mb-1">Horario</p>
            <p class="font-body text-secondary">Lunes a Viernes: 8:30 a 18:30 hs<br>Sábados: 8:30 a 13:30 hs</p>
          </div>
        </li>
        <li class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center flex-shrink-0">
            <span class="material-symbols-outlined text-primary-container">photo_camera</span>
          </div>
          <div>
            <p class="font-headline font-bold text-sm uppercase tracking-wide mb-1">Instagram</p>
            <a href="https://www.instagram.com/danichap.arg/" target="_blank" class="font-body text-primary-container hover:underline">@danichap.arg</a>
          </div>
        </li>
      </ul>
    </div>

    <!-- Mapa Google -->
    <div class="rounded-2xl overflow-hidden shadow-xl h-96 lg:h-full min-h-80">
      <iframe
        src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3275.0!2d-58.39!3d-34.87!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMzTCsDUyJzEyLjAiUyA1OMKwMjMnMjQuMCJX!5e0!3m2!1ses!2sar!4v1"
        width="100%" height="100%" style="border:0;" allowfullscreen="" loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        title="Ubicación Danichap — Av. Hipólito Yrigoyen 19608, Longchamps">
      </iframe>
    </div>
  </div>
</section>
```

> **Nota:** Reemplazar el embed de Maps por el iframe real de Google Maps buscando "Danichap Longchamps" y copiando el embed desde "Compartir → Incorporar mapa".

- [ ] **Step 4: Sección "Nosotros"** (id="nosotros" para el link desde nav):

```html
<section id="nosotros" class="py-20 bg-inverse-surface text-white">
  <div class="max-w-4xl mx-auto px-6 text-center">
    <h2 class="font-headline font-black text-4xl uppercase mb-6">Quiénes somos</h2>
    <p class="text-slate-300 text-lg font-body leading-relaxed max-w-2xl mx-auto mb-12">
      Danichap es una tienda de repuestos y accesorios automotrices ubicada en Longchamps, Zona Sur del Gran Buenos Aires.
      Con más de 10 años en el rubro, nos especializamos en atención personalizada: te asesoramos antes de comprar
      y estamos presentes después de tu compra.
    </p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div class="bg-white/5 rounded-xl p-8 text-center">
        <span class="text-4xl font-headline font-black text-primary-container block mb-2">+10</span>
        <span class="font-body text-slate-300 text-sm uppercase tracking-wide">Años de experiencia</span>
      </div>
      <div class="bg-white/5 rounded-xl p-8 text-center">
        <span class="text-4xl font-headline font-black text-primary-container block mb-2">249</span>
        <span class="font-body text-slate-300 text-sm uppercase tracking-wide">Reseñas en Google</span>
      </div>
      <div class="bg-white/5 rounded-xl p-8 text-center">
        <span class="text-4xl font-headline font-black text-primary-container block mb-2">4.3★</span>
        <span class="font-body text-slate-300 text-sm uppercase tracking-wide">Calificación promedio</span>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 5: Agregar footer y FAB** iguales al resto del sitio.

- [ ] **Step 6: Verificar apertura en browser** — confirmar que el link de WhatsApp abre correctamente.

---

## Chunk 4: Polish y mobile

### Task 7: Mobile nav (hamburger menu)

**Files:**
- Modify: `index.html`, `catalogo.html`, `contacto.html`
- Create: `nav.js`

- [ ] **Step 1: Agregar botón hamburger al nav** en las 3 páginas — visible en mobile (`md:hidden`):

```html
<button id="mobile-menu-btn" class="md:hidden text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
  <span class="material-symbols-outlined text-2xl" id="menu-icon">menu</span>
</button>
```

- [ ] **Step 2: Agregar panel mobile** antes del cierre de `<nav>`:

```html
<div id="mobile-menu" class="hidden md:hidden absolute top-full left-0 w-full bg-slate-900/95 backdrop-blur-md border-t border-white/10">
  <div class="flex flex-col px-6 py-4 gap-1">
    <a href="index.html" class="py-3 text-slate-300 hover:text-white font-headline uppercase text-sm tracking-wide border-b border-white/5">Inicio</a>
    <a href="catalogo.html" class="py-3 text-slate-300 hover:text-white font-headline uppercase text-sm tracking-wide border-b border-white/5">Catálogo</a>
    <a href="contacto.html#nosotros" class="py-3 text-slate-300 hover:text-white font-headline uppercase text-sm tracking-wide border-b border-white/5">Nosotros</a>
    <a href="contacto.html" class="py-3 text-slate-300 hover:text-white font-headline uppercase text-sm tracking-wide border-b border-white/5">Contacto</a>
    <a href="https://wa.me/541175200352" target="_blank" class="mt-3 flex items-center justify-center gap-2 bg-tertiary-container text-on-tertiary-container py-3 rounded-xl font-bold font-headline uppercase text-sm">
      <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;">chat</span>
      WhatsApp
    </a>
  </div>
</div>
```

- [ ] **Step 3: Crear `nav.js`** — lógica toggle hamburger:

```js
// nav.js — incluir en todas las páginas con <script src="nav.js"></script>
document.addEventListener('DOMContentLoaded', () => {
  const btn  = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  const icon = document.getElementById('menu-icon');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const open = menu.classList.toggle('hidden') === false;
    icon.textContent = open ? 'close' : 'menu';
  });
});
```

- [ ] **Step 4: Incluir `<script src="nav.js"></script>`** en las 3 páginas antes de `</body>`.

---

### Task 8: Mobile sidebar en catálogo

**Files:**
- Modify: `catalogo.html`, `catalogo.js`

El sidebar de escritorio es fijo a la izquierda. En mobile debe colapsarse en un drawer/bottom sheet activado por un botón "Filtros".

- [ ] **Step 1: Agregar botón "Filtros" sticky en mobile** (solo visible en mobile, fixed bottom-left):

```html
<!-- En catalogo.html, antes de </body> -->
<button id="btn-filtros-mobile"
  class="md:hidden fixed bottom-8 left-8 z-50 bg-inverse-surface text-white px-5 py-3 rounded-full shadow-xl flex items-center gap-2 font-headline font-bold uppercase text-sm">
  <span class="material-symbols-outlined text-base">tune</span>
  Filtros
  <span id="filtros-badge" class="hidden bg-primary-container text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">0</span>
</button>
```

- [ ] **Step 2: Hacer el sidebar colapsable en mobile** — agregar clases responsive al `<aside>`:

Cambiar `<aside id="sidebar" class="w-80 ...">` por:
```html
<aside id="sidebar" class="
  fixed inset-0 z-40 bg-black/50 md:relative md:bg-transparent md:inset-auto
  hidden md:flex md:w-80 md:flex-shrink-0
">
  <div id="sidebar-panel" class="
    absolute bottom-0 left-0 right-0 md:relative md:bottom-auto md:left-auto md:right-auto
    bg-surface-container-low rounded-t-2xl md:rounded-none
    p-6 max-h-[80vh] md:max-h-none overflow-y-auto md:overflow-visible
    md:sticky md:top-20 md:h-[calc(100vh-5rem)]
  ">
    <!-- contenido del sidebar aquí -->
  </div>
</aside>
```

- [ ] **Step 3: Toggle del sidebar mobile en `catalogo.js`**:

```js
// Agregar al final del bloque DOMContentLoaded
const btnFiltrosMobile = document.getElementById('btn-filtros-mobile');
const sidebar = document.getElementById('sidebar');
if (btnFiltrosMobile) {
  btnFiltrosMobile.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
  });
  // Cerrar al hacer click en el backdrop
  sidebar.addEventListener('click', e => {
    if (e.target === sidebar) sidebar.classList.add('hidden');
  });
}
```

---

### Task 9: Verificación final

- [ ] **Step 1: Abrir `index.html`** en browser. Verificar:
  - [ ] Nav links funcionan entre páginas
  - [ ] Categorías en home llevan a `catalogo.html?cat=...`
  - [ ] FAB WhatsApp abre `wa.me/541175200352`
  - [ ] En mobile, hamburger abre el menú

- [ ] **Step 2: Abrir `catalogo.html`** y verificar:
  - [ ] Dropdowns Marca → Modelo → Versión → Año en cascada
  - [ ] Accordion de categorías funciona
  - [ ] Subcategorías filtran correctamente
  - [ ] Cards con precio visible muestran `$ X.XXX`
  - [ ] Cards sin precio muestran "Precio por WhatsApp"
  - [ ] Botón "Consultar" en cada card genera link de WA con el nombre del producto
  - [ ] Estado vacío muestra CTA a WhatsApp
  - [ ] URL `catalogo.html?cat=mecanica` pre-filtra la categoría

- [ ] **Step 3: Abrir `contacto.html`** y verificar:
  - [ ] Link de WhatsApp abre chat con mensaje predefinido
  - [ ] Stats de Danichap correctos (249 reseñas, 4.3★)
  - [ ] Footer links funcionan

- [ ] **Step 4: Revisar en DevTools mobile** (F12 → toggle device) — verificar que las 3 páginas son usables en 375px de ancho.

---

## Resumen de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `index.html` | Crear (adaptar Stitch) | Home — hero, featured products, categorías |
| `catalogo.html` | Crear | Catálogo — sidebar filtros + grid productos |
| `contacto.html` | Crear | Contacto + info local + mapa + nosotros |
| `data.js` | Crear | Datos: vehículos, categorías, productos |
| `catalogo.js` | Crear | Lógica filtros cascada + render catálogo |
| `nav.js` | Crear | Toggle hamburger mobile |
| `shared.css` | Crear | Estilos compartidos: grid, sheen, FAB |
| `stitch_export/` | Solo lectura | Fuente del diseño original |
