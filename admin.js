// admin.js — Panel admin DANICHAP
// Requiere: supabase.js (Auth, Perfiles, Productos), auth.js, data.js (CATEGORIAS, PRODUCTOS)
(async () => {

  /* ══════════════════════════════════════════════════════════════════════════
     GUARD — solo admins
  ══════════════════════════════════════════════════════════════════════════ */
  const user = await Auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  // Retry hasta 3 veces con backoff — el trigger de Supabase puede tardar en crear el perfil
  let perfil = null;
  for (let i = 0; i < 3; i++) {
    perfil = await Perfiles.get(user.id);
    if (perfil) break;
    await new Promise(r => setTimeout(r, 600 * (i + 1)));
  }

  document.getElementById('admin-loading').classList.add('hidden');

  if (!perfil || perfil.rol !== 'admin') {
    const guard = document.getElementById('admin-guard');
    guard.classList.remove('hidden');
    const msg = guard.querySelector('p');
    if (msg) msg.textContent = perfil
      ? `Acceso restringido. Tu rol actual es: "${perfil.rol}".`
      : `No se pudo cargar el perfil (${user.email}). Revisá la consola.`;
    return;
  }

  const lbl = document.getElementById('admin-user-label');
  if (lbl) lbl.textContent = perfil.nombre || user.email;

  /* ══════════════════════════════════════════════════════════════════════════
     ESTADO
  ══════════════════════════════════════════════════════════════════════════ */
  let allProductos = [];   // todos los productos (Supabase o estáticos)
  let editingId    = null; // id del producto en edición, null = crear nuevo

  /* showToast — delegado a toast.js (global) */

  /* ══════════════════════════════════════════════════════════════════════════
     FORM ERROR
  ══════════════════════════════════════════════════════════════════════════ */
  function setFormError(msg) {
    const wrap = document.getElementById('form-error');
    const txt  = document.getElementById('form-error-text');
    if (!wrap) return;
    if (msg) {
      if (txt) txt.textContent = msg;
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
      if (txt) txt.textContent = '';
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CONFIRM DIALOG (reemplaza confirm() nativo)
  ══════════════════════════════════════════════════════════════════════════ */
  function showConfirmDialog(msg, onOk) {
    let dlg = document.getElementById('confirm-dialog');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'confirm-dialog';
      dlg.className = 'hidden fixed inset-0 z-[500] flex items-center justify-center p-4';
      dlg.innerHTML = `
        <div id="confirm-bd" class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
        <div class="relative bg-[#F2F0EC] rounded-2xl shadow-2xl w-full max-w-sm border border-[#D1D5DB] p-6 z-10">
          <div class="flex items-start gap-3 mb-5">
            <span class="material-symbols-outlined text-[#ba1a1a] text-2xl leading-none flex-shrink-0 mt-0.5" style="font-variation-settings:'FILL' 1;">warning</span>
            <p id="confirm-msg" class="text-sm text-[#111827] leading-relaxed"></p>
          </div>
          <div class="flex gap-3 justify-end">
            <button id="confirm-cancel" class="px-5 py-2.5 border border-[#D1D5DB] rounded-xl text-sm text-[#4B5563] hover:bg-[#E2DFD9] transition-colors">Cancelar</button>
            <button id="confirm-ok"     class="px-5 py-2.5 bg-[#ba1a1a] text-white rounded-xl text-sm font-bold uppercase hover:opacity-90 transition-opacity">Eliminar</button>
          </div>
        </div>`;
      document.body.appendChild(dlg);
    }

    dlg.querySelector('#confirm-msg').textContent = msg;
    dlg.classList.remove('hidden');

    const close = () => dlg.classList.add('hidden');

    const newOk  = dlg.querySelector('#confirm-ok').cloneNode(true);
    const newCxl = dlg.querySelector('#confirm-cancel').cloneNode(true);
    dlg.querySelector('#confirm-ok').replaceWith(newOk);
    dlg.querySelector('#confirm-cancel').replaceWith(newCxl);

    newOk.addEventListener('click',  () => { close(); onOk(); });
    newCxl.addEventListener('click', close);
    dlg.querySelector('#confirm-bd').onclick = close;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LOGOUT
  ══════════════════════════════════════════════════════════════════════════ */
  document.getElementById('admin-logout')?.addEventListener('click', async () => {
    await Auth.signOut();
    window.location.href = 'index.html';
  });

  /* ══════════════════════════════════════════════════════════════════════════
     CATEGORÍAS SELECT
  ══════════════════════════════════════════════════════════════════════════ */
  function initCatSelect() {
    const sel = document.getElementById('prod-categoria');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccioná una categoría —</option>' +
      CATEGORIAS.map(c => `<option value="${c.slug}">${c.label}</option>`).join('');
    sel.addEventListener('change', () => updateSubcats(sel.value));
  }

  function updateSubcats(slug) {
    const sub = document.getElementById('prod-subcategoria');
    if (!sub) return;
    const cat = CATEGORIAS.find(c => c.slug === slug);
    sub.innerHTML = '<option value="">— Sin subcategoría —</option>';
    if (cat?.subs?.length) {
      cat.subs.forEach(s => sub.add(new Option(s, s)));
      sub.disabled = false;
    } else {
      sub.disabled = true;
    }
  }
  initCatSelect();

  /* ══════════════════════════════════════════════════════════════════════════
     WATERMARK (canvas 800×800, crop centrado)
     Estrategia:
       1. Texto diagonal "DANICHAP" repetido en toda la imagen (sutil, 10% opac)
       2. Logo SVG + texto en esquina inferior derecha (28% opac)
     Fix vs versión anterior:
       - Esperar document.fonts.ready para que Space Grotesk esté disponible en canvas
       - Tile sin shadowBlur (evita sangrado en bordes del tile = falsos logos en esquinas)
       - Save/restore stack correcto (una sola capa, no anidada)
  ══════════════════════════════════════════════════════════════════════════ */
  async function applyWatermark(file) {
    // Esperar fuente antes de dibujar en canvas
    await document.fonts.ready;

    return new Promise(resolve => {
      const SIZE = 800;
      const img  = new Image();
      const bUrl = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(bUrl); resolve(file); };
      img.onload  = () => {
        URL.revokeObjectURL(bUrl);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d');

        // ── 1. Dibujar imagen (crop cuadrado centrado) ───────────────────────
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx   = (img.naturalWidth  - side) / 2 | 0;
        const sy   = (img.naturalHeight - side) / 2 | 0;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

        // ── 2. Patrón diagonal — texto en tile SIN shadowBlur ───────────────
        // shadowBlur sangra fuera del tile bounds → al repetir aparece en esquinas
        const TILE = 220;
        const tile = document.createElement('canvas');
        tile.width = tile.height = TILE;
        const tc = tile.getContext('2d');
        tc.save();
        tc.translate(TILE / 2, TILE / 2);
        tc.rotate(-Math.PI / 5.5); // ~-33°
        tc.font = '700 14px "Space Grotesk",sans-serif';
        tc.fillStyle = 'rgba(255,255,255,0.7)';
        tc.textAlign  = 'center';
        tc.textBaseline = 'middle';
        // NO shadowBlur aquí — evita artefactos en bordes del tile
        tc.fillText('DANICHAP', 0, 0);
        tc.restore();

        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = ctx.createPattern(tile, 'repeat');
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.restore();

        // ── 3. Marca fija esquina inferior derecha ───────────────────────────
        const ws  = (SIZE * 0.16) | 0;  // logo width
        const mg  = 16;
        const fs  = Math.max(11, (ws * 0.22) | 0); // font-size texto

        const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${ws}" height="${ws}" viewBox="0 0 38 38">
          <defs><linearGradient id="wg" x1="0" y1="0" x2="38" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#93c5fd"/>
          </linearGradient></defs>
          <path d="M6 5h14c8.284 0 15 6.716 15 15s-6.716 15-15 15H6V5z" fill="url(%23wg)"/>
          <path d="M10 28L28 10" stroke="rgba(15,23,42,.5)" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M10 9h9c6.075 0 11 4.925 11 11s-4.925 11-11 11H10V9z" fill="rgba(242,240,236,.55)"/>
        </svg>`;

        const svgImg = new Image();

        const drawCorner = () => {
          ctx.save();
          ctx.globalAlpha   = 0.28;
          ctx.shadowColor   = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur    = 6;
          ctx.shadowOffsetX = 1;
          ctx.shadowOffsetY = 1;

          // Texto "DANICHAP" en la parte baja
          ctx.font          = `900 ${fs}px "Space Grotesk",sans-serif`;
          ctx.fillStyle     = '#ffffff';
          ctx.textAlign     = 'right';
          ctx.textBaseline  = 'bottom';
          ctx.fillText('DANICHAP', SIZE - mg, SIZE - mg);

          // Logo encima del texto
          if (svgImg.complete && svgImg.naturalWidth > 0) {
            ctx.drawImage(svgImg, SIZE - mg - ws, SIZE - mg - fs - 6 - ws, ws, ws);
          }
          ctx.restore();

          canvas.toBlob(
            b => resolve(b ? new File([b], 'product.jpg', { type: 'image/jpeg' }) : file),
            'image/jpeg', 0.92
          );
        };

        svgImg.onload  = drawCorner;
        svgImg.onerror = drawCorner; // dibuja igual, solo sin logo
        svgImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
      };
      img.src = bUrl;
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CARGAR PRODUCTOS
     Primero intenta Supabase listAll(). Si retorna vacío o falla,
     usa PRODUCTOS estáticos de data.js como fallback (solo lectura).
  ══════════════════════════════════════════════════════════════════════════ */
  let _usingStaticFallback = false;

  async function loadProductos() {
    try {
      const { data, error } = await Productos.listAll();
      if (error) throw error;
      if (data && data.length > 0) {
        allProductos = data;
        _usingStaticFallback = false;
      } else {
        // DB vacía → usar estáticos para visualización
        allProductos = (typeof PRODUCTOS !== 'undefined' ? PRODUCTOS : []).map(p => ({
          id:          String(p.id),
          nombre:      p.nombre,
          categoria:   p.categoria,
          subcategoria:p.sub || null,
          marca_rep:   p.marca_rep || null,
          precio:      p.precio ?? null,
          precio_antes:p.precio_antes ?? null,
          imagen_url:  p.imagen_url || null,
          badge:       p.badge || null,
          destacado:   p.destacado || false,
          stock:       true,
          _static:     true,
        }));
        _usingStaticFallback = true;

        // Mostrar aviso solo si hay DB real conectada
        if (!error) _showStaticBanner();
      }
    } catch (err) {
      console.error('[admin] loadProductos error:', err);
      showToast('Error al cargar desde Supabase — mostrando datos estáticos', 'error');
      allProductos = (typeof PRODUCTOS !== 'undefined' ? PRODUCTOS : []).map(p => ({
        id: String(p.id), nombre: p.nombre, categoria: p.categoria,
        subcategoria: p.sub||null, marca_rep: p.marca_rep||null,
        precio: p.precio??null, precio_antes: p.precio_antes??null,
        imagen_url: p.imagen_url||null, badge: p.badge||null,
        destacado: p.destacado||false, stock: true, _static: true,
      }));
      _usingStaticFallback = true;
    }

    renderStats();
    renderTabla(allProductos);
    populateCatFilter();
  }

  function _showStaticBanner() {
    if (document.getElementById('static-banner')) return;
    const b = document.createElement('div');
    b.id = 'static-banner';
    b.className = 'mb-4 flex items-start gap-3 bg-[#ffdad6] border border-[#ba1a1a]/20 rounded-xl px-4 py-3 text-[#ba1a1a] text-xs font-body';
    b.innerHTML = `<span class="material-symbols-outlined text-base leading-none flex-shrink-0 mt-0.5" style="font-variation-settings:'FILL' 1;">info</span>
      <span>La base de datos está vacía. Se muestran los productos estáticos de muestra. <strong>Los botones Editar y Eliminar no funcionan sobre datos estáticos.</strong> Usá "Nuevo producto" para crear productos reales en Supabase.</span>`;
    const main = document.querySelector('main');
    if (main) main.insertBefore(b, main.firstChild);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     STATS
  ══════════════════════════════════════════════════════════════════════════ */
  function renderStats() {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('stat-total',      allProductos.length);
    set('stat-destacados', allProductos.filter(p => p.destacado).length);
    set('stat-sin-stock',  allProductos.filter(p => p.stock === false).length);
    set('stat-categorias', new Set(allProductos.map(p => p.categoria)).size);
  }

  function populateCatFilter() {
    const sel = document.getElementById('admin-filter-cat');
    if (!sel) return;
    const cats = [...new Set(allProductos.map(p => p.categoria))].sort();
    const cur  = sel.value;
    sel.innerHTML = '<option value="">Todas</option>' +
      cats.map(c => `<option value="${c}"${c===cur?' selected':''}>${c}</option>`).join('');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER TABLA (XSS-safe)
  ══════════════════════════════════════════════════════════════════════════ */
  function renderTabla(lista) {
    const tbody = document.getElementById('admin-productos-table');
    const empty = document.getElementById('admin-empty');
    if (!tbody) return;

    if (lista.length === 0) {
      tbody.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');

    const frag = document.createDocumentFragment();
    lista.forEach(p => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-[#ECEAE5] transition-colors border-b border-[#D1D5DB] last:border-0';
      tr.dataset.id = p.id;

      // Imagen (XSS-safe)
      const imgWrap = document.createElement('div');
      imgWrap.className = 'w-10 h-10 rounded-lg bg-[#E2DFD9] overflow-hidden border border-[#D1D5DB] flex-shrink-0 flex items-center justify-center';
      if (p.imagen_url) {
        const img = document.createElement('img');
        img.className = 'w-full h-full object-cover'; img.loading = 'lazy'; img.alt = '';
        img.src = p.imagen_url;
        img.onerror = () => { img.remove(); imgWrap.innerHTML = '<span class="material-symbols-outlined text-sm text-[#9CA3AF] leading-none">broken_image</span>'; };
        imgWrap.appendChild(img);
      } else {
        imgWrap.innerHTML = '<span class="material-symbols-outlined text-sm text-[#9CA3AF] leading-none">inventory_2</span>';
      }

      // Precio HTML (no user-controlled, safe to template)
      const precioHtml = p.precio
        ? `<span class="font-bold text-[#111827] font-headline">$${Number(p.precio).toLocaleString('es-AR')}</span>`
        : `<span class="text-[#4B5563] italic text-xs">Consultar</span>`;

      // Stock dot + cantidad
      const sinStock   = p.stock === false || p.stock_cantidad === 0;
      const stockColor = sinStock ? '#ba1a1a' : '#1A9850';
      const stockTitle = sinStock ? 'Sin stock'
        : p.stock_cantidad != null ? `${p.stock_cantidad} uds.`
        : 'En stock';
      const stockLabel = p.stock_cantidad != null
        ? (p.stock_cantidad === 0 ? 'Sin stock' : `${p.stock_cantidad} uds.`)
        : (sinStock ? 'Sin stock' : '');

      tr.innerHTML = `
        <td class="px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="img-slot flex-shrink-0"></div>
            <div class="min-w-0">
              <p class="js-nombre font-bold text-[#111827] text-sm truncate max-w-[180px]"></p>
              <p class="js-marca text-xs text-[#4B5563] hidden"></p>
              <span class="js-badge text-[10px] font-black uppercase tracking-widest text-[#2563EB] hidden"></span>
            </div>
          </div>
        </td>
        <td class="px-4 py-3 hidden md:table-cell">
          <span class="js-cat text-xs bg-[#E2DFD9] px-2 py-0.5 rounded-lg text-[#4B5563]"></span>
        </td>
        <td class="px-4 py-3 text-sm">${precioHtml}</td>
        <td class="px-4 py-3 text-center">
          <div class="flex flex-col items-center gap-0.5">
            <div class="flex items-center gap-1">
              <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:${stockColor}" title="${stockTitle}"></span>
              ${stockLabel ? `<span class="text-[10px] font-bold" style="color:${stockColor}">${stockLabel}</span>` : ''}
            </div>
            <span class="material-symbols-outlined text-sm leading-none" style="color:${p.destacado?'#2563EB':'#D1D5DB'};font-variation-settings:'FILL' ${p.destacado?1:0};">star</span>
          </div>
        </td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-0.5">
            <button data-action="duplicate" data-id="${p.id}" title="Duplicar producto"
              class="p-2 rounded-lg text-[#4B5563] hover:text-[#1A9850] hover:bg-[#E2DFD9] transition-colors hidden sm:inline-flex">
              <span class="material-symbols-outlined text-sm leading-none">content_copy</span>
            </button>
            <button data-action="edit" data-id="${p.id}" title="Editar"
              class="p-2 rounded-lg text-[#4B5563] hover:text-[#2563EB] hover:bg-[#E2DFD9] transition-colors">
              <span class="material-symbols-outlined text-sm leading-none">edit</span>
            </button>
            <button data-action="delete" data-id="${p.id}" title="Eliminar"
              class="p-2 rounded-lg text-[#4B5563] hover:text-[#ba1a1a] hover:bg-[#ffdad6] transition-colors">
              <span class="material-symbols-outlined text-sm leading-none">delete</span>
            </button>
          </div>
        </td>`;

      tr.querySelector('.img-slot').replaceWith(imgWrap);
      tr.querySelector('.js-nombre').textContent = p.nombre;
      tr.querySelector('.js-cat').textContent    = p.categoria;
      const marcaModelo = [p.marca_rep, p.modelo].filter(Boolean).join(' · ');
      if (marcaModelo) { const m = tr.querySelector('.js-marca'); m.textContent = marcaModelo; m.classList.remove('hidden'); }
      if (p.badge)     { const b = tr.querySelector('.js-badge'); b.textContent = p.badge;     b.classList.remove('hidden'); }

      frag.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     FILTROS
  ══════════════════════════════════════════════════════════════════════════ */
  function filtrar() {
    const q   = (document.getElementById('admin-search')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('admin-filter-cat')?.value || '';
    let r = allProductos;
    if (q) r = r.filter(p =>
      p.nombre.toLowerCase().includes(q) ||
      (p.marca_rep||'').toLowerCase().includes(q) ||
      (p.modelo||'').toLowerCase().includes(q) ||
      (p.categoria||'').toLowerCase().includes(q) ||
      (p.subcategoria||'').toLowerCase().includes(q) ||
      (p.badge||'').toLowerCase().includes(q)
    );
    if (cat) r = r.filter(p => p.categoria === cat);
    renderTabla(r);
  }

  document.getElementById('admin-search')?.addEventListener('input', filtrar);
  document.getElementById('admin-filter-cat')?.addEventListener('change', filtrar);

  /* ══════════════════════════════════════════════════════════════════════════
     GALERÍA MULTI-FOTO (admin modal)
     _galleryUrls: array de URLs ya guardadas en Supabase (al editar)
     _galleryFiles: array de File pendientes de subir (al guardar)
  ══════════════════════════════════════════════════════════════════════════ */
  let _galleryUrls  = []; // URLs existentes (de Supabase)
  let _galleryFiles = []; // Files nuevos a subir

  function _renderGallery() {
    const gallery = document.getElementById('img-gallery');
    const counter = document.getElementById('img-count-label');
    if (!gallery) return;

    const total = _galleryUrls.length + _galleryFiles.length;
    if (counter) counter.textContent = `${total} foto(s)`;

    gallery.innerHTML = '';

    // Miniaturas de URLs ya guardadas
    _galleryUrls.forEach((url, i) => {
      const wrap = _makeThumb(null, url, i, 'url');
      gallery.appendChild(wrap);
    });

    // Miniaturas de archivos nuevos (preview local)
    _galleryFiles.forEach((file, i) => {
      const wrap = _makeThumb(file, null, i, 'file');
      gallery.appendChild(wrap);
    });
  }

  function _makeThumb(file, url, index, type) {
    const wrap = document.createElement('div');
    wrap.className = 'relative w-20 h-20 rounded-xl overflow-hidden border-2 border-outline-variant bg-surface-container-low flex-shrink-0';
    if (index === 0 && type === 'url') wrap.title = 'Foto principal';

    const img = document.createElement('img');
    img.className = 'w-full h-full object-cover';
    img.alt = '';

    if (file) {
      const reader = new FileReader();
      reader.onload = e => { img.src = e.target.result; };
      reader.readAsDataURL(file);
    } else {
      img.src = url;
    }

    // Badge "principal" en la primera foto de URLs guardadas
    if (index === 0 && type === 'url') {
      const badge = document.createElement('div');
      badge.className = 'absolute top-0 left-0 right-0 text-center bg-primary-container/80 text-white text-[9px] font-bold py-0.5 uppercase tracking-wide';
      badge.textContent = 'Principal';
      wrap.appendChild(badge);
    }

    // Botón eliminar miniatura
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-error transition-colors';
    del.innerHTML = '<span class="material-symbols-outlined leading-none" style="font-size:12px;">close</span>';
    del.addEventListener('click', () => {
      if (type === 'url') _galleryUrls.splice(index, 1);
      else                _galleryFiles.splice(index, 1);
      _renderGallery();
    });

    wrap.append(img, del);
    return wrap;
  }

  function _initGallery(urls) {
    _galleryUrls  = urls ? [...urls] : [];
    _galleryFiles = [];
    _renderGallery();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MODAL — ABRIR
  ══════════════════════════════════════════════════════════════════════════ */
  function openModal(id = null) {
    // Si es un producto estático (fallback), abrir en modo "nuevo" con datos pre-llenados
    const isStatic = id && allProductos.find(x => x.id === id)?._static;
    if (isStatic) {
      showToast('Los datos estáticos no se pueden editar directamente. Creá una copia.', 'error');
      return;
    }

    editingId = id;
    const p   = id ? allProductos.find(x => x.id === id) : null;

    document.getElementById('modal-title').textContent       = id ? 'Editar Producto' : 'Nuevo Producto';
    document.getElementById('prod-id').value                 = p?.id || '';
    document.getElementById('prod-nombre').value             = p?.nombre      || '';
    document.getElementById('prod-marca').value              = p?.marca_rep   || '';
    document.getElementById('prod-modelo').value             = p?.modelo      || '';
    document.getElementById('prod-badge').value              = p?.badge       || '';
    document.getElementById('prod-precio').value             = p?.precio      != null ? p.precio : '';
    document.getElementById('prod-precio-antes').value       = p?.precio_antes != null ? p.precio_antes : '';
    document.getElementById('prod-descripcion').value        = p?.descripcion  || '';
    document.getElementById('prod-stock').checked            = p?.stock        ?? true;
    document.getElementById('prod-destacado').checked        = p?.destacado    || false;
    document.getElementById('prod-stock-cantidad').value     = p?.stock_cantidad != null ? p.stock_cantidad : '';

    const catSel = document.getElementById('prod-categoria');
    catSel.value = p?.categoria || '';
    updateSubcats(p?.categoria || '');
    setTimeout(() => {
      const sub = document.getElementById('prod-subcategoria');
      if (sub) sub.value = p?.subcategoria || '';
    }, 0);

    // Reset input de archivos
    const imgInput = document.getElementById('prod-imagenes');
    if (imgInput) imgInput.value = '';

    setBadgeChip(p?.badge || '');
    // Actualizar contadores
    ['prod-nombre', 'prod-descripcion'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.dispatchEvent(new Event('input'));
    });
    setFormError(null);

    // Inicializar galería con fotos existentes del producto
    const existingUrls = [];
    if (p?.imagen_url) existingUrls.push(p.imagen_url);
    if (p?.imagenes?.length) existingUrls.push(...p.imagenes.filter(u => u !== p.imagen_url));
    _initGallery(existingUrls);

    document.getElementById('producto-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('prod-nombre')?.focus(), 50);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MODAL — CERRAR
  ══════════════════════════════════════════════════════════════════════════ */
  function closeModal() {
    document.getElementById('producto-modal').classList.add('hidden');
    document.body.style.overflow = '';
    editingId = null;
  }

  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-nuevo-producto')?.addEventListener('click', () => openModal());
  document.getElementById('btn-nuevo-empty')?.addEventListener('click', () => openModal());

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const cOpen = !document.getElementById('confirm-dialog')?.classList.contains('hidden');
    if (cOpen) { document.getElementById('confirm-dialog').classList.add('hidden'); return; }
    if (!document.getElementById('producto-modal')?.classList.contains('hidden')) closeModal();
  });

  // Event delegation tabla → edit / delete
  document.getElementById('admin-productos-table')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit') {
      openModal(id);
    } else if (action === 'duplicate') {
      duplicateProducto(id);
    } else if (action === 'delete') {
      const prod = allProductos.find(x => x.id === id);
      if (!prod) return;
      if (prod._static) { showToast('No se pueden eliminar datos estáticos.', 'error'); return; }
      deleteProducto(id, prod.nombre);
    }
  });

  /* ══════════════════════════════════════════════════════════════════════════
     GALERÍA — file input (multi)
  ══════════════════════════════════════════════════════════════════════════ */
  document.getElementById('prod-imagenes')?.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    _galleryFiles.push(...files);
    e.target.value = ''; // reset para poder volver a elegir
    _renderGallery();
  });

  /* ══════════════════════════════════════════════════════════════════════════
     SUBMIT FORM
  ══════════════════════════════════════════════════════════════════════════ */
  document.getElementById('form-producto')?.addEventListener('submit', async e => {
    e.preventDefault();

    const nombre    = document.getElementById('prod-nombre').value.trim();
    const categoria = document.getElementById('prod-categoria').value.trim();

    if (!nombre)    { setFormError('El nombre es obligatorio.'); document.getElementById('prod-nombre').focus(); return; }
    if (!categoria) { setFormError('Seleccioná una categoría.'); document.getElementById('prod-categoria').focus(); return; }

    const btn  = document.getElementById('btn-save-modal');
    if (!btn) { setFormError('Error interno: botón no encontrado.'); return; }
    const orig = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span>Guardando…';
    btn.disabled = true;
    setFormError(null);

    // Agregar keyframes spin si no existen
    if (!document.getElementById('spin-style')) {
      const s = document.createElement('style');
      s.id = 'spin-style';
      s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    // ── Upload fotos nuevas con watermark ────────────────────────────────────
    let allUrls = [..._galleryUrls]; // empezar con las ya guardadas

    if (_galleryFiles.length > 0) {
      try {
        for (const file of _galleryFiles) {
          const processed = await applyWatermark(file);
          const { url, error: ue } = await Productos.uploadImagen(processed);
          if (ue) throw ue;
          allUrls.push(url);
        }
      } catch (err) {
        setFormError('Error al subir imagen: ' + (err.message || err));
        btn.innerHTML = orig; btn.disabled = false; return;
      }
    }

    // Foto principal = primera del array; resto = imagenes[]
    const imagenUrl  = allUrls[0] || null;
    const imagenesExtra = allUrls.slice(1);

    const precioVal      = document.getElementById('prod-precio').value.trim();
    const precioAntesVal = document.getElementById('prod-precio-antes').value.trim();
    const cantVal        = document.getElementById('prod-stock-cantidad').value.trim();
    const stockCheck     = document.getElementById('prod-stock').checked;
    const cantNum        = cantVal !== '' ? parseInt(cantVal, 10) : null;

    const payload = {
      nombre,
      categoria,
      subcategoria:    document.getElementById('prod-subcategoria').value.trim() || null,
      marca_rep:       document.getElementById('prod-marca').value.trim()        || null,
      modelo:          document.getElementById('prod-modelo').value.trim()       || null,
      badge:           document.getElementById('prod-badge').value.trim().toUpperCase() || null,
      precio:          precioVal      ? parseFloat(precioVal)      : null,
      precio_antes:    precioAntesVal ? parseFloat(precioAntesVal) : null,
      descripcion:     document.getElementById('prod-descripcion').value.trim() || null,
      imagen_url:      imagenUrl,
      imagenes:        imagenesExtra,
      stock_cantidad:  cantNum,
      // Si cantidad = 0 → sin stock automáticamente
      stock:           cantNum === 0 ? false : stockCheck,
      destacado:       document.getElementById('prod-destacado').checked,
    };

    const isEditing = Boolean(editingId);
    let saveError;
    try {
      const { error } = isEditing
        ? await Productos.update(editingId, payload)
        : await Productos.create(payload);
      saveError = error;
    } catch (ex) {
      saveError = ex;
    }

    btn.innerHTML = orig; btn.disabled = false;

    if (saveError) { setFormError(saveError.message || 'Error al guardar. Intentá de nuevo.'); return; }

    closeModal();
    showToast(isEditing ? 'Producto actualizado ✓' : 'Producto creado ✓');
    await loadProductos();
  });

  /* ══════════════════════════════════════════════════════════════════════════
     ELIMINAR
  ══════════════════════════════════════════════════════════════════════════ */
  function deleteProducto(id, nombre) {
    showConfirmDialog(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`, async () => {
      try {
        const { error } = await Productos.delete(id);
        if (error) { showToast('Error: ' + error.message, 'error'); return; }
        showToast(`"${nombre}" eliminado`);
        await loadProductos();
      } catch (err) {
        console.error('[admin] deleteProducto error:', err);
        showToast('Error inesperado al eliminar: ' + (err.message || err), 'error');
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     BADGE CHIPS
  ══════════════════════════════════════════════════════════════════════════ */
  function initBadgeChips() {
    const chips = document.querySelectorAll('.badge-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        document.getElementById('prod-badge').value = chip.dataset.badge;
      });
    });
  }
  initBadgeChips();

  function setBadgeChip(val) {
    const v = val || '';
    const chips = document.querySelectorAll('.badge-chip');
    chips.forEach(c => c.classList.remove('selected'));
    const match = [...chips].find(c => c.dataset.badge === v);
    if (match) match.classList.add('selected');
    const input = document.getElementById('prod-badge');
    if (input) input.value = v;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CONTADORES DE CARACTERES
  ══════════════════════════════════════════════════════════════════════════ */
  function initCounters() {
    const pairs = [
      { inputId: 'prod-nombre',      counterId: 'nombre-counter', max: 80  },
      { inputId: 'prod-descripcion', counterId: 'desc-counter',   max: 300 },
    ];
    pairs.forEach(({ inputId, counterId, max }) => {
      const el  = document.getElementById(inputId);
      const ctr = document.getElementById(counterId);
      if (!el || !ctr) return;
      const update = () => {
        const len = el.value.length;
        ctr.textContent = `${len}/${max}`;
        ctr.style.color = len > max * 0.9 ? '#ba1a1a' : '';
      };
      el.addEventListener('input', update);
    });
  }
  initCounters();

  /* ══════════════════════════════════════════════════════════════════════════
     DUPLICAR PRODUCTO
  ══════════════════════════════════════════════════════════════════════════ */
  async function duplicateProducto(id) {
    const orig = allProductos.find(x => x.id === id);
    if (!orig || orig._static) { showToast('No se puede duplicar este producto.', 'error'); return; }
    const payload = {
      nombre:         orig.nombre + ' (copia)',
      categoria:      orig.categoria,
      subcategoria:   orig.subcategoria  || null,
      marca_rep:      orig.marca_rep     || null,
      modelo:         orig.modelo        || null,
      badge:          orig.badge         || null,
      precio:         orig.precio        ?? null,
      precio_antes:   orig.precio_antes  ?? null,
      descripcion:    orig.descripcion   || null,
      imagen_url:     orig.imagen_url    || null,
      imagenes:       Array.isArray(orig.imagenes) ? orig.imagenes : [],
      stock_cantidad: orig.stock_cantidad ?? null,
      destacado:      false,
      stock:          orig.stock         ?? true,
    };
    try {
      const { error } = await Productos.create(payload);
      if (error) { showToast('Error al duplicar: ' + error.message, 'error'); return; }
      showToast('Producto duplicado — editalo para ajustar los cambios');
      await loadProductos();
    } catch (err) {
      showToast('Error inesperado: ' + (err.message || err), 'error');
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ARRANQUE
  ══════════════════════════════════════════════════════════════════════════ */
  await loadProductos();

})();
