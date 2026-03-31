// nav.js — Hamburger + Auth buttons + Cart badge
document.addEventListener('DOMContentLoaded', async () => {

  // ── Hamburger ────────────────────────────────────────────────────────────
  const btn  = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  const icon = document.getElementById('menu-icon');
  if (btn && menu) {
    btn.addEventListener('click', () => {
      const isOpen = !menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      if (icon) icon.textContent = isOpen ? 'menu' : 'close';
    });
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        menu.classList.add('hidden');
        if (icon) icon.textContent = 'menu';
      });
    });
  }

  // ── Inyectar botones auth en nav desktop ─────────────────────────────────
  const navActions = document.querySelector('nav .flex.items-center.gap-3');
  if (navActions && !document.getElementById('nav-login-btn')) {
    navActions.insertAdjacentHTML('beforeend', `
      <button id="nav-login-btn"
        class="hidden md:flex items-center gap-2 border border-primary-container text-primary-container px-4 py-2 rounded-xl font-bold text-sm hover:bg-primary-container/10 transition-colors font-headline uppercase">
        <span class="material-symbols-outlined text-sm">person</span>
        Ingresar
      </button>
      <div id="nav-user-btn" class="hidden md:flex items-center gap-2 relative group">
        <button class="flex items-center gap-2 border border-outline-variant px-3 py-2 rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container transition-colors font-headline uppercase">
          <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">account_circle</span>
          <span id="nav-user-label" class="max-w-[100px] truncate">Mi cuenta</span>
        </button>
        <!-- Dropdown -->
        <div class="absolute top-full right-0 mt-1 bg-surface border border-outline-variant rounded-xl shadow-lg py-1.5 w-44 hidden group-hover:block z-50">
          <a id="nav-admin-link" href="admin.html"
            class="hidden items-center gap-2 px-4 py-2.5 text-sm text-primary-container font-bold hover:bg-surface-container-low transition-colors font-headline uppercase">
            <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">admin_panel_settings</span>
            Admin
          </a>
          <button id="nav-logout-btn"
            class="flex items-center gap-2 px-4 py-2.5 text-sm text-secondary hover:text-error hover:bg-surface-container-low transition-colors font-body w-full text-left">
            <span class="material-symbols-outlined text-sm">logout</span>
            Cerrar sesión
          </button>
        </div>
      </div>`);

    document.getElementById('nav-login-btn')?.addEventListener('click', () => {
      if (typeof AuthUI !== 'undefined') AuthUI.open('login');
    });
    document.getElementById('nav-logout-btn')?.addEventListener('click', async () => {
      if (typeof Auth !== 'undefined') await Auth.signOut();
    });
  }

  // ── Inicializar módulos ───────────────────────────────────────────────────
  if (typeof AuthUI !== 'undefined') await AuthUI.init();
  if (typeof CartUI !== 'undefined') CartUI.init();
  if (typeof Cart   !== 'undefined') await Cart.init();
});
