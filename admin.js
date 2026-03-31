// admin.js — Panel admin DANICHAP
(async () => {
  // ── Guard: solo admins ────────────────────────────────────────────────────
  // getSession lee localStorage sin red; getUser valida contra el servidor
  const session = await Auth.getSession();
  const user = session?.user ?? (await Auth.getUser());
  if (!user) { window.location.href = 'index.html'; return; }

  // Obtener perfil con retry por si la sesión acaba de iniciar
  let perfil = await Perfiles.get(user.id);
  if (!perfil) {
    await new Promise(r => setTimeout(r, 800));
    perfil = await Perfiles.get(user.id);
  }

  document.getElementById('admin-loading').classList.add('hidden');

  if (!perfil || perfil.rol !== 'admin') {
    console.warn('Admin guard: perfil =', JSON.stringify(perfil), '| user =', user?.email);
    const guard = document.getElementById('admin-guard');
    guard.classList.remove('hidden');
    const msg = guard.querySelector('p');
    if (msg) msg.textContent = perfil
      ? `Acceso restringido. Rol actual: ${perfil.rol}`
      : `No se pudo leer el perfil para ${user?.email}. Revisá la consola.`;
    return;
  }

  // Mostrar email del admin
  const labelEl = document.getElementById('admin-user-label');
  if (labelEl) labelEl.textContent = perfil.nombre || user.email;

  // ── Estado ────────────────────────────────────────────────────────────────
  let allProductos = [];
  let editingId    = null;

  // ── Logout ────────────────────────────────────────────────────────────────
  document.getElementById('admin-logout').addEventListener('click', async () => {
    await Auth.signOut();
    window.location.href = 'index.html';
  });

  // ── Cargar productos ──────────────────────────────────────────────────────
  async function loadProductos() {
    const { data, error } = await _supabase
      .from('productos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) { console.error(error); return; }
    allProductos = data || [];
    renderStats();
    renderTabla(allProductos);
    populateCatFilter();
  }

  function renderStats() {
    document.getElementById('stat-total').textContent      = allProductos.length;
    document.getElementById('stat-destacados').textContent = allProductos.filter(p => p.destacado).length;
    document.getElementById('stat-sin-precio').textContent = allProductos.filter(p => !p.precio).length;
    const cats = new Set(allProductos.map(p => p.categoria));
    document.getElementById('stat-categorias').textContent = cats.size;

    // Datalist categorías en el form
    const dl = document.getElementById('cat-list');
    if (dl) dl.innerHTML = [...cats].sort().map(c => `<option value="${c}"/>`).join('');
  }

  function populateCatFilter() {
    const sel  = document.getElementById('admin-filter-cat');
    const cats = [...new Set(allProductos.map(p => p.categoria))].sort();
    const cur  = sel.value;
    sel.innerHTML = '<option value="">Todas las cats.</option>' +
      cats.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
  }

  function renderTabla(productos) {
    const tbody  = document.getElementById('admin-productos-table');
    const emptyEl = document.getElementById('admin-empty');
    emptyEl.classList.toggle('hidden', productos.length > 0);

    if (productos.length === 0) { tbody.innerHTML = ''; return; }

    tbody.innerHTML = productos.map(p => `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-surface-container flex-shrink-0 overflow-hidden border border-outline-variant">
              ${p.imagen_url
                ? `<img src="${p.imagen_url}" class="w-full h-full object-cover" loading="lazy"/>`
                : `<div class="w-full h-full flex items-center justify-center">
                     <span class="material-symbols-outlined text-sm text-outline">inventory_2</span>
                   </div>`}
            </div>
            <div class="min-w-0">
              <p class="font-bold text-on-surface text-sm truncate max-w-[180px]">${p.nombre}</p>
              ${p.marca_rep ? `<p class="text-xs text-secondary font-label">${p.marca_rep}</p>` : ''}
              ${p.badge ? `<span class="text-[10px] font-black font-label uppercase tracking-widest text-primary-container">${p.badge}</span>` : ''}
            </div>
          </div>
        </td>
        <td class="px-4 py-3 hidden md:table-cell">
          <span class="text-xs bg-surface-container px-2 py-1 rounded-lg font-label text-secondary">${p.categoria}</span>
        </td>
        <td class="px-4 py-3 text-sm">
          ${p.precio
            ? `<span class="font-bold text-on-surface font-headline">$${Number(p.precio).toLocaleString('es-AR')}</span>`
            : `<span class="text-secondary italic text-xs">Sin precio</span>`}
        </td>
        <td class="px-4 py-3 text-center">
          <span class="material-symbols-outlined text-sm ${p.destacado ? 'text-primary-container' : 'text-outline-variant'}"
            style="font-variation-settings:'FILL' ${p.destacado ? 1 : 0};">star</span>
        </td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-1">
            <button onclick="openModal('${p.id}')" title="Editar"
              class="text-secondary hover:text-primary-container transition-colors p-2 rounded-lg hover:bg-surface-container">
              <span class="material-symbols-outlined text-sm">edit</span>
            </button>
            <button onclick="deleteProducto('${p.id}', '${p.nombre.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" title="Eliminar"
              class="text-secondary hover:text-error transition-colors p-2 rounded-lg hover:bg-surface-container">
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </td>
      </tr>`).join('');
  }

  // ── Filtros ───────────────────────────────────────────────────────────────
  function filtrar() {
    const q   = document.getElementById('admin-search').value.toLowerCase().trim();
    const cat = document.getElementById('admin-filter-cat').value;
    let r = allProductos;
    if (q)   r = r.filter(p => p.nombre.toLowerCase().includes(q) || (p.marca_rep||'').toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
    if (cat) r = r.filter(p => p.categoria === cat);
    renderTabla(r);
  }

  document.getElementById('admin-search').addEventListener('input', filtrar);
  document.getElementById('admin-filter-cat').addEventListener('change', filtrar);

  // ── Modal ─────────────────────────────────────────────────────────────────
  function openModal(id = null) {
    editingId = id;
    const p   = id ? allProductos.find(x => x.id === id) : null;

    document.getElementById('modal-title').textContent    = id ? 'Editar Producto' : 'Nuevo Producto';
    document.getElementById('prod-id').value              = p?.id || '';
    document.getElementById('prod-nombre').value          = p?.nombre || '';
    document.getElementById('prod-categoria').value       = p?.categoria || '';
    document.getElementById('prod-subcategoria').value    = p?.subcategoria || '';
    document.getElementById('prod-marca').value           = p?.marca_rep || '';
    document.getElementById('prod-badge').value           = p?.badge || '';
    document.getElementById('prod-precio').value          = p?.precio ?? '';
    document.getElementById('prod-precio-antes').value    = p?.precio_antes ?? '';
    document.getElementById('prod-descripcion').value     = p?.descripcion || '';
    document.getElementById('prod-imagen-url').value      = p?.imagen_url || '';
    document.getElementById('prod-destacado').checked     = p?.destacado || false;
    document.getElementById('prod-stock').checked         = p?.stock ?? true;
    document.getElementById('form-error').classList.add('hidden');
    document.getElementById('prod-imagen').value          = '';

    const preview = document.getElementById('img-preview');
    preview.innerHTML = p?.imagen_url
      ? `<img src="${p.imagen_url}" class="w-full h-full object-cover"/>`
      : `<span class="material-symbols-outlined text-3xl text-outline">image</span>`;

    document.getElementById('producto-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('prod-nombre').focus();
  }
  window.openModal = openModal;

  function closeModal() {
    document.getElementById('producto-modal').classList.add('hidden');
    document.body.style.overflow = '';
    editingId = null;
  }

  document.getElementById('modal-close').addEventListener('click',   closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-nuevo-producto').addEventListener('click', () => openModal());
  document.getElementById('btn-nuevo-empty')?.addEventListener('click', () => openModal());

  // Preview imagen por archivo
  document.getElementById('prod-imagen').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('img-preview').innerHTML =
        `<img src="${ev.target.result}" class="w-full h-full object-cover"/>`;
    };
    reader.readAsDataURL(file);
    // Limpiar URL manual si se sube archivo
    document.getElementById('prod-imagen-url').value = '';
  });

  // Preview imagen por URL
  document.getElementById('prod-imagen-url').addEventListener('input', e => {
    const url = e.target.value.trim();
    if (url) {
      document.getElementById('img-preview').innerHTML =
        `<img src="${url}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<span class=material-symbols-outlined text-3xl text-error>broken_image</span>'"/>`;
    }
  });

  // ── Submit form ───────────────────────────────────────────────────────────
  document.getElementById('form-producto').addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = document.getElementById('btn-save-modal');
    const errEl = document.getElementById('form-error');
    btn.textContent = 'Guardando…'; btn.disabled = true;
    errEl.classList.add('hidden');

    // Upload imagen si hay archivo
    let imagenUrl = document.getElementById('prod-imagen-url').value.trim() || null;
    const fileInput = document.getElementById('prod-imagen');
    if (fileInput.files[0]) {
      const { url, error } = await Productos.uploadImagen(fileInput.files[0]);
      if (error) {
        errEl.textContent = 'Error subiendo imagen: ' + error.message;
        errEl.classList.remove('hidden');
        btn.textContent = 'Guardar'; btn.disabled = false;
        return;
      }
      imagenUrl = url;
    }

    const payload = {
      nombre:       document.getElementById('prod-nombre').value.trim(),
      categoria:    document.getElementById('prod-categoria').value.trim(),
      subcategoria: document.getElementById('prod-subcategoria').value.trim() || null,
      marca_rep:    document.getElementById('prod-marca').value.trim() || null,
      badge:        document.getElementById('prod-badge').value.trim() || null,
      precio:       parseFloat(document.getElementById('prod-precio').value) || null,
      precio_antes: parseFloat(document.getElementById('prod-precio-antes').value) || null,
      descripcion:  document.getElementById('prod-descripcion').value.trim() || null,
      imagen_url:   imagenUrl,
      destacado:    document.getElementById('prod-destacado').checked,
      stock:        document.getElementById('prod-stock').checked,
    };

    const { error } = editingId
      ? await Productos.update(editingId, payload)
      : await Productos.create(payload);

    btn.textContent = 'Guardar'; btn.disabled = false;

    if (error) {
      errEl.textContent = error.message;
      errEl.classList.remove('hidden');
      return;
    }
    closeModal();
    await loadProductos();
  });

  // ── Eliminar ──────────────────────────────────────────────────────────────
  window.deleteProducto = async (id, nombre) => {
    if (!confirm(`¿Eliminar "${nombre}"?\nEsta acción no se puede deshacer.`)) return;
    const { error } = await Productos.delete(id);
    if (error) { alert('Error al eliminar: ' + error.message); return; }
    await loadProductos();
  };

  // ── Iniciar ───────────────────────────────────────────────────────────────
  await loadProductos();
})();
