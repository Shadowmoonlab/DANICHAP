// admin.js — Panel admin DANICHAP
// Requiere: supabase.js (Auth, Perfiles, Productos), auth.js, data.js (CATEGORIAS, PRODUCTOS)
(async () => {

  /* ══════════════════════════════════════════════════════════════════════════
     GUARD — solo admins
  ══════════════════════════════════════════════════════════════════════════ */
  const session = await Auth.getSession();
  const user    = session?.user ?? (await Auth.getUser());
  if (!user) { window.location.href = 'login.html'; return; }

  let perfil = await Perfiles.get(user.id);
  if (!perfil) {
    await new Promise(r => setTimeout(r, 900));
    perfil = await Perfiles.get(user.id);
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

  /* ══════════════════════════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════════════════════════ */
  function showToast(msg, type = 'success') {
    let t = document.getElementById('admin-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'admin-toast';
      t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[600] px-5 py-3 rounded-xl font-bold text-sm font-headline uppercase tracking-wide shadow-xl flex items-center gap-2 transition-all duration-300 opacity-0 translate-y-4 pointer-events-none';
      document.body.appendChild(t);
    }
    t.classList.remove('bg-[#0F172A]','text-[#F1F5F9]','bg-[#ba1a1a]','text-white');
    if (type === 'success') t.classList.add('bg-[#0F172A]','text-[#F1F5F9]');
    else                    t.classList.add('bg-[#ba1a1a]','text-white');

    t.innerHTML = '';
    const ico = document.createElement('span');
    ico.className = 'material-symbols-outlined text-base leading-none';
    ico.style.fontVariationSettings = "'FILL' 1";
    ico.textContent = type === 'success' ? 'check_circle' : 'error';
    t.appendChild(ico);
    t.appendChild(document.createTextNode(' ' + msg));

    requestAnimationFrame(() => {
      t.classList.remove('opacity-0','translate-y-4');
      t.classList.add('opacity-100','translate-y-0');
    });
    clearTimeout(t._t);
    t._t = setTimeout(() => {
      t.classList.add('opacity-0','translate-y-4');
      t.classList.remove('opacity-100','translate-y-0');
    }, 3000);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     FORM ERROR
  ══════════════════════════════════════════════════════════════════════════ */
  function setFormError(msg) {
    const wrap = document.getElementById('form-error');
    const txt  = document.getElementById('form-error-text');
    if (!wrap) return;
    if (msg) {
      if (txt) txt.textContent = msg;
      wrap.style.display = 'flex';
    } else {
      wrap.style.display = 'none';
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
     WATERMARK (canvas 800×800, crop centrado, logo DANICHAP)
  ══════════════════════════════════════════════════════════════════════════ */
  async function applyWatermark(file) {
    return new Promise(resolve => {
      const SIZE = 800;
      const img  = new Image();
      const blob = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(blob); resolve(file); };
      img.onload  = () => {
        URL.revokeObjectURL(blob);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx  = canvas.getContext('2d');
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx   = (img.naturalWidth  - side) / 2 | 0;
        const sy   = (img.naturalHeight - side) / 2 | 0;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

        const ws = (SIZE * 0.22) | 0;
        const mg = (ws * 0.18)   | 0;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
        ctx.globalAlpha = 0.30; ctx.fillStyle = '#fff';
        ctx.font = `900 ${(ws * 0.22)|0}px "Space Grotesk",sans-serif`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText('DANICHAP', SIZE - mg, SIZE - mg);

        const svgBlob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${ws}" height="${ws}" viewBox="0 0 38 38">
          <defs><linearGradient id="g" x1="0" y1="0" x2="38" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#93c5fd"/></linearGradient></defs>
          <path d="M6 5h14c8.284 0 15 6.716 15 15s-6.716 15-15 15H6V5z" fill="url(#g)"/>
          <path d="M10 28L28 10" stroke="rgba(15,23,42,.6)" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M10 9h9c6.075 0 11 4.925 11 11s-4.925 11-11 11H10V9z" fill="rgba(242,240,236,.55)"/>
        </svg>`], { type:'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const svgImg = new Image();
        const finish = () => {
          ctx.restore();
          URL.revokeObjectURL(svgUrl);
          canvas.toBlob(b => resolve(b ? new File([b],'product.jpg',{type:'image/jpeg'}) : file), 'image/jpeg', 0.92);
        };
        svgImg.onload = () => {
          ctx.globalAlpha = 0.34; ctx.shadowBlur = 8;
          ctx.drawImage(svgImg, SIZE - mg - ws, SIZE - mg - ws - (ws*.28|0), ws, ws);
          finish();
        };
        svgImg.onerror = finish;
        svgImg.src = svgUrl;
      };
      img.src = blob;
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
    set('stat-sin-precio', allProductos.filter(p => !p.precio).length);
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

      // Stock dot
      const stockColor = p.stock !== false ? '#1A9850' : '#ba1a1a';
      const stockTitle = p.stock !== false ? 'En stock' : 'Sin stock';

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
          <div class="flex items-center justify-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full" style="background:${stockColor}" title="${stockTitle}"></span>
            <span class="material-symbols-outlined text-sm leading-none" style="color:${p.destacado?'#2563EB':'#D1D5DB'};font-variation-settings:'FILL' ${p.destacado?1:0};">star</span>
          </div>
        </td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-0.5">
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
      if (p.marca_rep) { const m = tr.querySelector('.js-marca'); m.textContent = p.marca_rep; m.classList.remove('hidden'); }
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
     PREVIEW IMAGEN
  ══════════════════════════════════════════════════════════════════════════ */
  function setImgPreview(url) {
    const wrap = document.getElementById('img-preview');
    if (!wrap) return;
    // Quitar img o ph previos; preservar overlay watermark
    wrap.querySelectorAll('img,.preview-ph').forEach(el => el.remove());
    const overlay = wrap.querySelector('div.wm-overlay');
    const ph0 = document.getElementById('img-placeholder');

    if (url) {
      if (ph0) ph0.style.display = 'none';
      const img = document.createElement('img');
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;';
      img.alt = ''; img.src = url;
      img.onerror = () => {
        img.remove();
        if (ph0) { ph0.style.display = ''; ph0.textContent = 'broken_image'; ph0.style.color='#ba1a1a'; }
      };
      overlay ? wrap.insertBefore(img, overlay) : wrap.appendChild(img);
    } else {
      if (ph0) { ph0.style.display = ''; ph0.textContent = 'image'; ph0.style.color = ''; }
    }
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
    document.getElementById('prod-badge').value              = p?.badge       || '';
    document.getElementById('prod-precio').value             = p?.precio      != null ? p.precio : '';
    document.getElementById('prod-precio-antes').value       = p?.precio_antes != null ? p.precio_antes : '';
    document.getElementById('prod-descripcion').value        = p?.descripcion  || '';
    document.getElementById('prod-imagen-url').value         = p?.imagen_url   || '';
    document.getElementById('prod-stock').checked            = p?.stock        ?? true;
    document.getElementById('prod-destacado').checked        = p?.destacado    || false;

    const catSel = document.getElementById('prod-categoria');
    catSel.value = p?.categoria || '';
    updateSubcats(p?.categoria || '');
    setTimeout(() => {
      const sub = document.getElementById('prod-subcategoria');
      if (sub) sub.value = p?.subcategoria || '';
    }, 0);

    document.getElementById('prod-imagen').value = '';
    setFormError(null);
    setImgPreview(p?.imagen_url || null);

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
    } else if (action === 'delete') {
      const prod = allProductos.find(x => x.id === id);
      if (!prod) return;
      if (prod._static) { showToast('No se pueden eliminar datos estáticos.', 'error'); return; }
      deleteProducto(id, prod.nombre);
    }
  });

  /* ══════════════════════════════════════════════════════════════════════════
     PREVIEW — file input
  ══════════════════════════════════════════════════════════════════════════ */
  document.getElementById('prod-imagen')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    document.getElementById('prod-imagen-url').value = '';
    const reader = new FileReader();
    reader.onload = ev => setImgPreview(ev.target.result);
    reader.readAsDataURL(file);
  });

  // Preview URL con debounce
  let _urlTimer = null;
  document.getElementById('prod-imagen-url')?.addEventListener('input', e => {
    clearTimeout(_urlTimer);
    const url = e.target.value.trim();
    _urlTimer = setTimeout(() => setImgPreview(url || null), 400);
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

    // Upload imagen
    let imagenUrl = document.getElementById('prod-imagen-url').value.trim() || null;
    const fi = document.getElementById('prod-imagen');
    if (fi?.files?.[0]) {
      try {
        const processed = await applyWatermark(fi.files[0]);
        const { url, error: ue } = await Productos.uploadImagen(processed);
        if (ue) throw ue;
        imagenUrl = url;
      } catch (err) {
        setFormError('Error al subir imagen: ' + (err.message || err));
        btn.innerHTML = orig; btn.disabled = false; return;
      }
    }

    const payload = {
      nombre,
      categoria,
      subcategoria: document.getElementById('prod-subcategoria').value.trim() || null,
      marca_rep:    document.getElementById('prod-marca').value.trim()        || null,
      badge:        document.getElementById('prod-badge').value.trim().toUpperCase() || null,
      precio:       parseFloat(document.getElementById('prod-precio').value)        || null,
      precio_antes: parseFloat(document.getElementById('prod-precio-antes').value)  || null,
      descripcion:  document.getElementById('prod-descripcion').value.trim()        || null,
      imagen_url:   imagenUrl,
      destacado:    document.getElementById('prod-destacado').checked,
      stock:        document.getElementById('prod-stock').checked,
    };

    const isEditing = Boolean(editingId);
    const { error } = isEditing
      ? await Productos.update(editingId, payload)
      : await Productos.create(payload);

    btn.innerHTML = orig; btn.disabled = false;

    if (error) { setFormError(error.message); return; }

    closeModal();
    showToast(isEditing ? 'Producto actualizado ✓' : 'Producto creado ✓');
    await loadProductos();
  });

  /* ══════════════════════════════════════════════════════════════════════════
     ELIMINAR
  ══════════════════════════════════════════════════════════════════════════ */
  function deleteProducto(id, nombre) {
    showConfirmDialog(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`, async () => {
      const { error } = await Productos.delete(id);
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      showToast(`"${nombre}" eliminado`);
      await loadProductos();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ARRANQUE
  ══════════════════════════════════════════════════════════════════════════ */
  await loadProductos();

})();
