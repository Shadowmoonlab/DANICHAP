// cart-ui.js — Drawer lateral del carrito
const CartUI = {
  syncFromDB() { return Cart.syncFromDB(); },
  clearLocal()  { return Cart.clearLocal(); },

  init() {
    this._injectDrawer();
    this._injectNavBadge();
    Cart.subscribe(() => this._render());
    this._render();
  },

  _injectDrawer() {
    if (document.getElementById('cart-drawer')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="cart-drawer" class="hidden fixed inset-0 z-[150]">
      <div id="cart-overlay" class="absolute inset-0 bg-black/30 backdrop-blur-sm"></div>
      <aside id="cart-panel"
        class="absolute right-0 top-0 h-full w-full max-w-md bg-surface shadow-2xl flex flex-col border-l border-outline-variant">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-5 border-b border-outline-variant flex-shrink-0">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary-container" style="font-variation-settings:'FILL' 1;">shopping_cart</span>
            <h2 class="font-headline font-black text-lg uppercase text-on-surface">Tu carrito</h2>
            <span id="cart-drawer-count" class="bg-primary-container text-white text-xs font-bold px-2 py-0.5 rounded-full font-label">0</span>
          </div>
          <button id="cart-close" class="text-secondary hover:text-on-surface transition-colors p-1">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <!-- Items -->
        <div id="cart-items" class="flex-1 overflow-y-auto px-6 py-4 space-y-4"></div>
        <!-- Empty state -->
        <div id="cart-empty" class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <span class="material-symbols-outlined text-6xl text-outline-variant">shopping_cart</span>
          <p class="text-secondary font-body text-sm">Tu carrito está vacío.<br/>Agregá productos desde el catálogo.</p>
          <a href="catalogo.html" class="text-primary-container font-bold text-sm font-headline uppercase hover:underline">Ver catálogo</a>
        </div>
        <!-- Footer -->
        <div id="cart-footer" class="hidden px-6 py-5 border-t border-outline-variant flex-shrink-0">
          <div class="flex justify-between items-center mb-4">
            <span class="font-body text-secondary text-sm">Total estimado</span>
            <span id="cart-total" class="font-headline font-black text-xl text-on-surface"></span>
          </div>
          <a id="cart-wpp-btn" href="#" target="_blank"
             class="flex items-center justify-center gap-2 w-full bg-tertiary-container text-on-tertiary-container py-4 rounded-xl font-bold font-headline uppercase text-sm hover:bg-tertiary transition-colors">
            <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1;">chat</span>
            Consultar por WhatsApp
          </a>
          <button id="cart-clear-btn"
            class="mt-3 w-full text-secondary hover:text-error text-xs font-label uppercase tracking-wide transition-colors py-2">
            Vaciar carrito
          </button>
        </div>
      </aside>
    </div>`);

    document.getElementById('cart-overlay').addEventListener('click', () => this.close());
    document.getElementById('cart-close').addEventListener('click',   () => this.close());
    document.getElementById('cart-clear-btn').addEventListener('click', async () => {
      if (confirm('¿Vaciar el carrito?')) await Cart.clear();
    });
  },

  _injectNavBadge() {
    // El botón ya está en el HTML — solo registrar el click si nav.js no lo hizo
    const btn = document.getElementById('cart-nav-btn');
    if (btn && !btn._cartListenerAdded) {
      btn.addEventListener('click', () => this.open());
      btn._cartListenerAdded = true;
    }
  },

  open() {
    document.getElementById('cart-drawer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  },
  close() {
    document.getElementById('cart-drawer').classList.add('hidden');
    document.body.style.overflow = '';
  },

  _render() {
    const items   = Cart.items;
    const count   = Cart.count;
    const total   = Cart.total;
    const isEmpty = items.length === 0;

    // Badge
    const badge = document.getElementById('cart-badge');
    if (badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }

    const drawerCount = document.getElementById('cart-drawer-count');
    if (drawerCount) drawerCount.textContent = count;

    // Toggle empty/footer
    const emptyEl  = document.getElementById('cart-empty');
    const footerEl = document.getElementById('cart-footer');
    const itemsEl  = document.getElementById('cart-items');
    if (!emptyEl) return;

    emptyEl.classList.toggle('hidden', !isEmpty);
    footerEl.classList.toggle('hidden', isEmpty);

    // Items
    itemsEl.innerHTML = items.map(item => {
      const p      = item.productos;
      const precio = p?.precio ? `$${Number(p.precio).toLocaleString('es-AR')}` : 'Consultar';
      return `
      <div class="flex gap-4 items-start py-1">
        <div class="w-16 h-16 rounded-xl overflow-hidden bg-surface-container-low flex-shrink-0 border border-outline-variant">
          ${p?.imagen_url
            ? `<img src="${p.imagen_url}" alt="${p.nombre}" class="w-full h-full object-cover"/>`
            : `<div class="w-full h-full flex items-center justify-center">
                 <span class="material-symbols-outlined text-2xl text-outline">inventory_2</span>
               </div>`}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-body font-bold text-sm text-on-surface leading-snug">${p?.nombre || 'Producto'}</p>
          ${p?.marca_rep ? `<p class="text-xs text-secondary font-label">${p.marca_rep}</p>` : ''}
          <p class="font-headline font-black text-primary-container text-sm mt-1">${precio}</p>
          <div class="flex items-center gap-2 mt-2">
            <button onclick="Cart.updateCantidad('${item.producto_id}', ${item.cantidad - 1})"
              class="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors text-lg leading-none font-bold select-none">−</button>
            <span class="text-sm font-bold font-label w-5 text-center">${item.cantidad}</span>
            <button onclick="Cart.updateCantidad('${item.producto_id}', ${item.cantidad + 1})"
              class="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors text-lg leading-none font-bold select-none">+</button>
            <button onclick="Cart.remove('${item.producto_id}')"
              class="ml-auto text-secondary hover:text-error transition-colors p-1">
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Total
    const totalEl = document.getElementById('cart-total');
    if (totalEl) {
      totalEl.textContent = total > 0
        ? `$${Number(total).toLocaleString('es-AR')}`
        : 'A consultar';
    }

    // WhatsApp link
    const wppBtn = document.getElementById('cart-wpp-btn');
    if (wppBtn && items.length) {
      const lista = items.map(i => `• ${i.productos?.nombre || 'Producto'} x${i.cantidad}`).join('\n');
      wppBtn.href = `https://wa.me/541175200352?text=${encodeURIComponent(`Hola Danichap! Quiero consultar por los siguientes productos:\n${lista}\n¿Tienen stock y precio?`)}`;
    }
  },
};
