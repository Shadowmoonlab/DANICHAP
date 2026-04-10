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
        <div id="cart-footer" class="hidden px-4 py-4 border-t border-outline-variant flex-shrink-0 space-y-3">
          <!-- Nota / auto del cliente -->
          <div>
            <label for="cart-nota" class="block text-[10px] font-bold uppercase tracking-wide text-secondary mb-1">
              <span class="material-symbols-outlined text-xs leading-none align-middle">directions_car</span>
              Tu auto (opcional, para mejor asesoramiento)
            </label>
            <input id="cart-nota" type="text" maxlength="80"
              placeholder="Ej: Volkswagen Gol 2018 1.6"
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-container transition-colors placeholder:text-outline"/>
          </div>
          <!-- Total -->
          <div class="flex justify-between items-center">
            <span class="font-body text-secondary text-sm">Total estimado</span>
            <span id="cart-total" class="font-headline font-black text-xl text-on-surface"></span>
          </div>
          <!-- WhatsApp -->
          <button id="cart-wpp-btn"
             class="flex items-center justify-center gap-2 w-full bg-tertiary-container text-on-tertiary-container py-3.5 rounded-xl font-bold font-headline uppercase text-sm hover:bg-tertiary transition-colors">
            <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1;">chat</span>
            Enviar consulta por WhatsApp
          </button>
          <button id="cart-clear-btn"
            class="w-full text-secondary hover:text-error text-xs font-label uppercase tracking-wide transition-colors py-1.5">
            Vaciar carrito
          </button>
        </div>
      </aside>
    </div>`);

    document.getElementById('cart-overlay').addEventListener('click', () => this.close());
    document.getElementById('cart-close').addEventListener('click',   () => this.close());
    document.getElementById('cart-clear-btn').addEventListener('click', () => {
      this._confirmClear();
    });
    document.getElementById('cart-wpp-btn').addEventListener('click', () => {
      this._sendWhatsApp();
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
    if (badge) {
      badge.textContent = count;
      if (count === 0) {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
      } else {
        badge.classList.remove('hidden');
        badge.classList.add('flex');
      }
    }

    const drawerCount = document.getElementById('cart-drawer-count');
    if (drawerCount) drawerCount.textContent = count;

    // Toggle empty/footer
    const emptyEl  = document.getElementById('cart-empty');
    const footerEl = document.getElementById('cart-footer');
    const itemsEl  = document.getElementById('cart-items');
    if (!emptyEl) return;

    emptyEl.classList.toggle('hidden', !isEmpty);
    footerEl.classList.toggle('hidden', isEmpty);

    // Items — XSS-safe: usar DOM, no innerHTML con datos de usuario
    itemsEl.innerHTML = '';
    items.forEach(item => {
      const p      = item.productos;
      const precio = p?.precio ? `$${Number(p.precio).toLocaleString('es-AR')}` : 'Consultar';
      const subtotal = p?.precio ? `$${Number(p.precio * item.cantidad).toLocaleString('es-AR')}` : null;

      const row = document.createElement('div');
      row.className = 'flex gap-3 items-start py-2 border-b border-outline-variant/50 last:border-0';

      // Imagen
      const imgWrap = document.createElement('div');
      imgWrap.className = 'w-14 h-14 rounded-xl overflow-hidden bg-surface-container-low flex-shrink-0 border border-outline-variant';
      if (p?.imagen_url) {
        const img = document.createElement('img');
        img.className = 'w-full h-full object-cover';
        img.alt = '';
        img.src = p.imagen_url;
        imgWrap.appendChild(img);
      } else {
        imgWrap.innerHTML = '<div class="w-full h-full flex items-center justify-center"><span class="material-symbols-outlined text-xl text-outline">inventory_2</span></div>';
      }

      // Info
      const info = document.createElement('div');
      info.className = 'flex-1 min-w-0';

      const nombre = document.createElement('p');
      nombre.className = 'font-body font-bold text-sm text-on-surface leading-snug';
      nombre.textContent = p?.nombre || 'Producto';
      info.appendChild(nombre);

      if (p?.marca_rep) {
        const marca = document.createElement('p');
        marca.className = 'text-[10px] text-secondary font-label mt-0.5';
        marca.textContent = p.marca_rep;
        info.appendChild(marca);
      }

      // Precio + subtotal
      const precioRow = document.createElement('div');
      precioRow.className = 'flex items-baseline gap-2 mt-1';
      const precioEl = document.createElement('span');
      precioEl.className = 'font-headline font-black text-primary-container text-sm';
      precioEl.textContent = precio;
      precioRow.appendChild(precioEl);
      if (subtotal && item.cantidad > 1) {
        const sub = document.createElement('span');
        sub.className = 'text-[10px] text-secondary font-label';
        sub.textContent = `= ${subtotal}`;
        precioRow.appendChild(sub);
      }
      info.appendChild(precioRow);

      // Controles cantidad
      const controls = document.createElement('div');
      controls.className = 'flex items-center gap-2 mt-2';

      const btnMenos = document.createElement('button');
      btnMenos.type = 'button';
      btnMenos.className = 'w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors text-base leading-none font-bold select-none';
      btnMenos.textContent = '−';
      btnMenos.addEventListener('click', () => Cart.updateCantidad(item.producto_id, item.cantidad - 1));

      const cant = document.createElement('span');
      cant.className = 'text-sm font-bold font-label w-6 text-center tabular-nums';
      cant.textContent = item.cantidad;

      const btnMas = document.createElement('button');
      btnMas.type = 'button';
      btnMas.className = 'w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors text-base leading-none font-bold select-none';
      btnMas.textContent = '+';
      btnMas.addEventListener('click', () => Cart.updateCantidad(item.producto_id, item.cantidad + 1));

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'ml-auto text-secondary hover:text-error transition-colors p-1 rounded-lg hover:bg-error-container/20';
      btnDel.title = 'Quitar';
      btnDel.innerHTML = '<span class="material-symbols-outlined text-sm leading-none">delete</span>';
      btnDel.addEventListener('click', () => Cart.remove(item.producto_id));

      controls.append(btnMenos, cant, btnMas, btnDel);
      info.appendChild(controls);

      row.append(imgWrap, info);
      itemsEl.appendChild(row);
    });

    // Total
    const totalEl = document.getElementById('cart-total');
    if (totalEl) {
      totalEl.textContent = total > 0
        ? `$${Number(total).toLocaleString('es-AR')}`
        : 'A consultar';
    }
  },

  _buildWppText() {
    const items = Cart.items;
    const total = Cart.total;
    const nota  = (document.getElementById('cart-nota')?.value || '').trim();

    const lineas = items.map(item => {
      const p    = item.productos;
      const nom  = p?.nombre || 'Producto';
      const cant = item.cantidad;
      const prec = p?.precio ? ` — $${Number(p.precio).toLocaleString('es-AR')} c/u` : '';
      const sub  = p?.precio && cant > 1 ? ` (subtotal: $${Number(p.precio * cant).toLocaleString('es-AR')})` : '';
      return `• ${nom} x${cant}${prec}${sub}`;
    }).join('\n');

    const totalLinea = total > 0
      ? `\n*Total estimado: $${Number(total).toLocaleString('es-AR')}*`
      : '\n_(algunos precios se consultan)_';

    const autoLinea = nota ? `\n\n🚗 Mi auto: ${nota}` : '';

    return `¡Hola DANICHAP! 👋 Quiero consultar por los siguientes repuestos:\n\n${lineas}${totalLinea}${autoLinea}\n\n¿Tienen stock y precio actualizado?`;
  },

  _sendWhatsApp() {
    const text = this._buildWppText();
    window.open(`https://wa.me/541123409187?text=${encodeURIComponent(text)}`, '_blank');
  },

  _confirmClear() {
    let dlg = document.getElementById('cart-confirm-dlg');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'cart-confirm-dlg';
      dlg.className = 'hidden fixed inset-0 z-[500] flex items-center justify-center p-4';
      dlg.innerHTML = `
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" id="ccdlg-bd"></div>
        <div class="relative bg-surface rounded-2xl shadow-2xl w-full max-w-xs border border-outline-variant p-5 z-10">
          <p class="text-sm text-on-surface mb-4 leading-relaxed">¿Vaciar el carrito? Se eliminarán todos los productos seleccionados.</p>
          <div class="flex gap-2 justify-end">
            <button id="ccdlg-no" class="px-4 py-2 border border-outline-variant rounded-xl text-sm text-secondary hover:bg-surface-container transition-colors">Cancelar</button>
            <button id="ccdlg-si" class="px-4 py-2 bg-error text-white rounded-xl text-sm font-bold uppercase hover:opacity-90 transition-opacity">Vaciar</button>
          </div>
        </div>`;
      document.body.appendChild(dlg);
      document.getElementById('ccdlg-bd').addEventListener('click', () => dlg.classList.add('hidden'));
      document.getElementById('ccdlg-no').addEventListener('click', () => dlg.classList.add('hidden'));
      document.getElementById('ccdlg-si').addEventListener('click', async () => {
        dlg.classList.add('hidden');
        await Cart.clear();
      });
    }
    dlg.classList.remove('hidden');
  },
};
