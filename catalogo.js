// catalogo.js — Lógica del catálogo Danichap
document.addEventListener('DOMContentLoaded', async () => {

  // ── Estado ──────────────────────────────────────────────────────────────────
  const filtros = { marca: '', modelo: '', version: '', año: '', cat: '', sub: '', sort: 'default', texto: '' };

  // ── Referencias DOM ─────────────────────────────────────────────────────────
  const selMarca   = document.getElementById('fil-marca');
  const selModelo  = document.getElementById('fil-modelo');
  const selVersion = document.getElementById('fil-version');
  const selAño     = document.getElementById('fil-año');
  const btnBuscar  = document.getElementById('btn-buscar');
  const btnLimpiar = document.getElementById('btn-limpiar');
  const sortSel    = document.getElementById('sort-select');

  // Mobile
  const mSelMarca   = document.getElementById('m-fil-marca');
  const mSelModelo  = document.getElementById('m-fil-modelo');
  const mSelVersion = document.getElementById('m-fil-version');
  const mSelAño     = document.getElementById('m-fil-año');
  const mBtnAplicar = document.getElementById('m-btn-aplicar');

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function resetSelect(sel, placeholder) {
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    sel.disabled = true;
  }

  function poblarMarcas(sel) {
    Object.keys(VEHICULOS).sort().forEach(m => sel.add(new Option(m, m)));
  }

  function onMarcaChange(sel, selMod, selVer, selA) {
    const marca = sel.value;
    filtros.marca = marca;
    filtros.modelo = ''; filtros.version = ''; filtros.año = '';
    resetSelect(selMod, 'Seleccioná un modelo');
    resetSelect(selVer, 'Seleccioná una versión');
    resetSelect(selA, 'Seleccioná el año');
    if (marca && VEHICULOS[marca]) {
      Object.keys(VEHICULOS[marca]).sort().forEach(m => selMod.add(new Option(m, m)));
      selMod.disabled = false;
    }
  }

  function onModeloChange(sel, marca, selVer, selA) {
    const modelo = sel.value;
    filtros.modelo = modelo;
    filtros.version = ''; filtros.año = '';
    resetSelect(selVer, 'Todas las versiones');
    resetSelect(selA, 'Todos los años');
    if (marca && modelo && VEHICULOS[marca]?.[modelo]) {
      const data = VEHICULOS[marca][modelo];
      data.versiones.forEach(v => selVer.add(new Option(v, v)));
      selVer.disabled = false;
      data.años.forEach(a => selA.add(new Option(a, a)));
      selA.disabled = false;
    }
  }

  // ── Inicializar dropdowns ────────────────────────────────────────────────────
  poblarMarcas(selMarca);
  poblarMarcas(mSelMarca);

  selMarca.addEventListener('change', () => onMarcaChange(selMarca, selModelo, selVersion, selAño));
  selModelo.addEventListener('change', () => {
    filtros.modelo = selModelo.value;
    onModeloChange(selModelo, filtros.marca, selVersion, selAño);
  });
  selVersion.addEventListener('change', () => { filtros.version = selVersion.value; });
  selAño.addEventListener('change', () => { filtros.año = selAño.value; });

  mSelMarca.addEventListener('change', () => onMarcaChange(mSelMarca, mSelModelo, mSelVersion, mSelAño));
  mSelModelo.addEventListener('change', () => {
    const marca = mSelMarca.value;
    onModeloChange(mSelModelo, marca, mSelVersion, mSelAño);
    filtros.modelo = mSelModelo.value;
  });
  mSelVersion.addEventListener('change', () => { filtros.version = mSelVersion.value; });
  mSelAño.addEventListener('change', () => { filtros.año = mSelAño.value; });

  // ── Buscar ───────────────────────────────────────────────────────────────────
  btnBuscar.addEventListener('click', () => {
    filtros.marca = selMarca.value;
    filtros.modelo = selModelo.value;
    filtros.version = selVersion.value;
    filtros.año = selAño.value;
    renderProductos();
    if (filtros.marca || filtros.modelo) btnLimpiar.classList.remove('hidden');
    actualizarBadge();
  });

  mBtnAplicar && mBtnAplicar.addEventListener('click', () => {
    filtros.marca = mSelMarca.value;
    filtros.modelo = mSelModelo.value;
    filtros.version = mSelVersion.value;
    filtros.año = mSelAño.value;
    renderProductos();
    closeMobileSidebar();
    actualizarBadge();
  });

  btnLimpiar && btnLimpiar.addEventListener('click', () => {
    filtros.marca = ''; filtros.modelo = ''; filtros.version = ''; filtros.año = '';
    selMarca.value = '';
    resetSelect(selModelo, 'Seleccioná una marca');
    resetSelect(selVersion, 'Seleccioná un modelo');
    resetSelect(selAño, 'Seleccioná un modelo');
    btnLimpiar.classList.add('hidden');
    renderProductos();
    actualizarBadge();
  });

  sortSel && sortSel.addEventListener('change', e => {
    filtros.sort = e.target.value;
    renderProductos();
  });

  // ── Búsqueda texto libre ─────────────────────────────────────────────────────
  const searchInput = document.getElementById('search-text');
  const searchClear = document.getElementById('search-clear');
  searchInput && searchInput.addEventListener('input', e => {
    filtros.texto = e.target.value.trim();
    searchClear && searchClear.classList.toggle('hidden', !filtros.texto);
    renderProductos();
  });
  searchClear && searchClear.addEventListener('click', () => {
    filtros.texto = '';
    if (searchInput) searchInput.value = '';
    searchClear.classList.add('hidden');
    renderProductos();
  });

  // ── Sidebar categorías ───────────────────────────────────────────────────────
  function renderSidebarCats(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    // Todos
    const allBtn = document.createElement('button');
    allBtn.className = `w-full text-left px-3 py-2 rounded-lg font-body text-sm font-semibold transition-colors ${filtros.cat === '' ? 'bg-primary-container text-white' : 'text-on-surface hover:bg-surface-container'}`;
    allBtn.textContent = 'Todos los productos';
    allBtn.addEventListener('click', () => {
      filtros.cat = ''; filtros.sub = '';
      renderSidebarCats('categorias-sidebar');
      renderSidebarCats('m-categorias-sidebar');
      renderProductos();
    });
    container.appendChild(allBtn);

    CATEGORIAS.forEach(cat => {
      const isActive = filtros.cat === cat.slug;
      const wrapper = document.createElement('div');

      wrapper.innerHTML = `
        <button class="cat-btn w-full flex items-center gap-2 px-3 py-2 rounded-lg font-body text-sm font-semibold transition-colors ${isActive ? 'bg-primary-container/10 text-primary' : 'text-on-surface hover:bg-surface-container'}" data-cat="${cat.slug}">
          <span class="material-symbols-outlined text-base text-primary-container">${cat.icon}</span>
          <span class="flex-1 text-left">${cat.label}</span>
          <span class="material-symbols-outlined text-sm transition-transform duration-300 ${isActive ? 'rotate-180' : ''}">expand_more</span>
        </button>
        <div class="subcat-panel pl-7 mt-0.5 ${isActive ? 'open' : ''}">
          <button class="w-full text-left px-2 py-1.5 rounded text-xs font-body transition-colors ${filtros.sub === '' && isActive ? 'text-primary font-bold' : 'text-secondary hover:text-on-surface'}" data-sub="">
            Todos en ${cat.label}
          </button>
          ${cat.subs.map(s => `
            <button class="w-full text-left px-2 py-1.5 rounded text-xs font-body transition-colors ${filtros.sub === s ? 'text-primary font-bold' : 'text-secondary hover:text-on-surface'}" data-sub="${s}">
              ${s.includes('/') ? '↳ ' + s.split('/').pop().trim() : s}
            </button>`).join('')}
        </div>`;

      wrapper.querySelector('.cat-btn').addEventListener('click', () => {
        filtros.cat = isActive ? '' : cat.slug;
        filtros.sub = '';
        renderSidebarCats('categorias-sidebar');
        renderSidebarCats('m-categorias-sidebar');
        renderProductos();
      });

      wrapper.querySelectorAll('[data-sub]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          filtros.sub = btn.dataset.sub;
          renderSidebarCats('categorias-sidebar');
          renderSidebarCats('m-categorias-sidebar');
          renderProductos();
        });
      });

      container.appendChild(wrapper);
    });
  }

  // ── Filtrado y render ─────────────────────────────────────────────────────────
  function getProductosFiltrados() {
    let lista = [...PRODUCTOS];

    if (filtros.texto) {
      const q = filtros.texto.toLowerCase();
      lista = lista.filter(p =>
        p.nombre.toLowerCase().includes(q) ||
        (p.marca_rep || '').toLowerCase().includes(q) ||
        (p.descripcion || '').toLowerCase().includes(q) ||
        p.categoria.toLowerCase().includes(q)
      );
    }
    if (filtros.cat) lista = lista.filter(p => p.categoria === filtros.cat);
    if (filtros.sub) lista = lista.filter(p => p.sub === filtros.sub);

    if (filtros.marca || filtros.modelo) {
      const partes = [filtros.marca, filtros.modelo, filtros.año].filter(Boolean).map(s => s.toLowerCase());
      lista = lista.filter(p =>
        p.compatibilidades.some(c => {
          const cl = c.toLowerCase();
          if (cl === 'universal' || cl.includes('universal')) return true;
          return partes.every(parte => cl.includes(parte));
        })
      );
    }

    if (filtros.sort === 'price-asc') {
      lista.sort((a, b) => { if (a.precio === null) return 1; if (b.precio === null) return -1; return a.precio - b.precio; });
    } else if (filtros.sort === 'price-desc') {
      lista.sort((a, b) => { if (a.precio === null) return 1; if (b.precio === null) return -1; return b.precio - a.precio; });
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

    const n = lista.length;
    countEl.textContent = `${n} producto${n !== 1 ? 's' : ''} encontrado${n !== 1 ? 's' : ''}`;

    if (n === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      const vehiculo = buildVehiculoStr();
      const msg = vehiculo
        ? `Hola Danichap! No encontré el repuesto para mi ${vehiculo}. ¿Me podés ayudar?`
        : `Hola Danichap! No encontré el repuesto que busco. ¿Me podés ayudar?`;
      document.getElementById('empty-wpp').href = `${WPP_BASE}?text=${encodeURIComponent(msg)}`;
      return;
    }

    emptyState.classList.add('hidden');
    grid.innerHTML = lista.map(p => renderCard(p)).join('');
  }

  function renderCard(p) {
    const vehiculo = buildVehiculoStr();
    const wpp = wppLink(p.nombre, vehiculo);
    const cat = CATEGORIAS.find(c => c.slug === p.categoria);
    const subLabel = p.sub ? (p.sub.includes('/') ? p.sub.split('/').pop().trim() : p.sub) : '';

    const precioHtml = p.precio !== null
      ? `<div class="flex items-baseline gap-2">
           <span class="text-xl font-black text-on-surface font-headline">$ ${p.precio.toLocaleString('es-AR')}</span>
           ${p.precio_antes ? `<span class="text-xs text-secondary line-through font-body">$ ${p.precio_antes.toLocaleString('es-AR')}</span>` : ''}
         </div>`
      : `<span class="inline-flex items-center gap-1 text-tertiary font-bold text-sm font-body">
           <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1;">chat</span>
           Precio por WhatsApp
         </span>`;

    const compat = p.compatibilidades?.[0] || 'Universal';
    const masCompat = (p.compatibilidades?.length || 0) > 1 ? ` <span class="text-secondary">+${p.compatibilidades.length - 1}</span>` : '';

    const imagenHtml = p.imagen_url
      ? `<img src="${p.imagen_url}" alt="${p.nombre}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>`
      : `<span class="material-symbols-outlined text-7xl text-surface-dim group-hover:scale-110 transition-transform duration-500">${cat ? cat.icon : 'build'}</span>`;

    return `
      <div class="bg-surface-container-lowest rounded-xl overflow-hidden group hover:shadow-lg transition-all duration-300 border border-surface-container flex flex-col">
        <div class="relative h-40 bg-surface-container-low flex items-center justify-center overflow-hidden">
          ${imagenHtml}
          ${p.badge ? `<span class="absolute top-3 right-3 bg-primary-container text-white text-[10px] font-black px-2 py-1 uppercase tracking-widest font-label rounded">${p.badge}</span>` : ''}
          ${p.marca_rep ? `<span class="absolute top-3 left-3 bg-inverse-surface text-white text-[10px] font-bold px-2 py-1 uppercase tracking-widest font-label rounded">${p.marca_rep}</span>` : ''}
        </div>
        <div class="p-4 flex flex-col flex-1">
          <div class="flex items-center gap-1 mb-1">
            <span class="text-[10px] font-bold uppercase tracking-widest text-secondary font-label">${cat ? cat.label : ''}</span>
            ${p.sub ? `<span class="text-[10px] text-secondary font-label">· ${subLabel}</span>` : ''}
          </div>
          <h3 class="font-headline font-bold text-sm uppercase mb-2 leading-tight">${p.nombre}</h3>
          <p class="text-xs text-tertiary font-body mb-4">✓ ${compat}${masCompat}</p>
          <div class="mt-auto space-y-2">
            <div class="flex items-center justify-between gap-2">
              ${precioHtml}
              <a href="${wpp}" target="_blank" rel="noopener"
                 class="flex-shrink-0 bg-tertiary-container text-on-tertiary-container px-3 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 hover:bg-tertiary transition-colors font-label uppercase tracking-wide">
                <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">chat</span>
                Consultar
              </a>
            </div>
            <button
              data-producto='${JSON.stringify(p).replace(/'/g, "&#39;")}'
              onclick="agregarAlCarrito(event, this)"
              class="w-full flex items-center justify-center gap-1.5 bg-primary-container/10 text-primary-container border border-primary-container/30 px-3 py-2 rounded-lg font-bold text-xs hover:bg-primary-container hover:text-white transition-all font-label uppercase tracking-wide">
              <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">add_shopping_cart</span>
              Agregar al carrito
            </button>
          </div>
        </div>
      </div>`;
  }

  function actualizarBadge() {
    const badge = document.getElementById('filtros-badge');
    if (!badge) return;
    const activos = [filtros.marca, filtros.modelo, filtros.cat].filter(Boolean).length;
    if (activos > 0) {
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  }

  // ── Mobile sidebar ───────────────────────────────────────────────────────────
  const btnFiltrosMobile = document.getElementById('btn-filtros-mobile');
  btnFiltrosMobile && btnFiltrosMobile.addEventListener('click', openMobileSidebar);

  // ── Leer params URL ──────────────────────────────────────────────────────────
  function leerParamsURL() {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat');
    if (cat) {
      filtros.cat = cat;
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  leerParamsURL();
  renderSidebarCats('categorias-sidebar');
  renderSidebarCats('m-categorias-sidebar');

  // Mostrar loading mientras carga
  const loadingEl = document.getElementById('catalogo-loading');
  const gridEl    = document.getElementById('productos-grid');

  // Cargar productos desde Supabase si hay. Si no, usar los estáticos de data.js
  try {
    if (typeof Productos !== 'undefined') {
      const { data: dbProds } = await Productos.list();
      if (dbProds && dbProds.length > 0) {
        // Normalizar al formato de PRODUCTOS (añadir compatibilidades/sub si faltan)
        const normalizados = dbProds.map(p => ({
          id: p.id,
          nombre: p.nombre,
          categoria: p.categoria,
          sub: p.subcategoria || '',
          marca_rep: p.marca_rep || '',
          precio: p.precio ? Number(p.precio) : null,
          precio_antes: p.precio_antes ? Number(p.precio_antes) : null,
          imagen_url: p.imagen_url || null,
          badge: p.badge || null,
          destacado: p.destacado || false,
          compatibilidades: ['Universal'],
          _fromDB: true,
        }));
        // Reemplazar el array global
        PRODUCTOS.length = 0;
        normalizados.forEach(p => PRODUCTOS.push(p));
      }
    }
  } catch(e) { console.warn('Catalogo: no se pudo cargar desde Supabase, usando datos estáticos', e); }

  // Ocultar loading, mostrar grid
  if (loadingEl) loadingEl.classList.add('hidden');
  if (gridEl) gridEl.classList.remove('hidden');

  renderProductos();
});

// ── Agregar al carrito (global, accesible desde el HTML inline) ───────────────
async function agregarAlCarrito(event, btn) {
  event.preventDefault();
  if (typeof AuthUI !== 'undefined' && !AuthUI.user) {
    AuthUI.open('login');
    return;
  }
  let producto;
  try { producto = JSON.parse(btn.dataset.producto); } catch { return; }

  // Mapear estructura de data.js al formato esperado por Cart
  const prod = {
    id:          producto.id || `local-${producto.nombre}`,
    nombre:      producto.nombre,
    categoria:   producto.categoria,
    marca_rep:   producto.marca_rep || null,
    precio:      producto.precio,
    imagen_url:  producto.imagen_url || null,
  };

  await Cart.add(prod);

  // Feedback visual
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="material-symbols-outlined text-sm" style="font-variation-settings:\'FILL\' 1;">check</span> Agregado';
  btn.disabled = true;
  btn.classList.remove('bg-primary-container/10', 'text-primary-container', 'border-primary-container/30');
  btn.classList.add('bg-tertiary-container/20', 'text-tertiary');
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.disabled = false;
    btn.classList.add('bg-primary-container/10', 'text-primary-container', 'border-primary-container/30');
    btn.classList.remove('bg-tertiary-container/20', 'text-tertiary');
  }, 1800);

  // Abrir drawer
  if (typeof CartUI !== 'undefined') CartUI.open();
}

// ── Mobile sidebar helpers (globales para onclick inline) ─────────────────────
function openMobileSidebar() {
  document.getElementById('mobile-sidebar-overlay').classList.remove('hidden');
  const panel = document.getElementById('mobile-sidebar-panel');
  panel.classList.remove('translate-y-full');
  panel.classList.add('translate-y-0');
}

function closeMobileSidebar() {
  document.getElementById('mobile-sidebar-overlay').classList.add('hidden');
  const panel = document.getElementById('mobile-sidebar-panel');
  panel.classList.add('translate-y-full');
  panel.classList.remove('translate-y-0');
}
