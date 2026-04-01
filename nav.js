// nav.js — Hamburger + Auth + Cart listeners
document.addEventListener('DOMContentLoaded', async () => {

  // ── Hamburger ──────────────────────────────────────────────────────────────
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

  // ── Auth listeners (botones ya en HTML) ────────────────────────────────────
  document.getElementById('nav-login-btn')?.addEventListener('click', () => {
    AuthUI.open('login');
  });
  document.getElementById('nav-login-btn-mobile')?.addEventListener('click', () => {
    menu?.classList.add('hidden');
    if (icon) icon.textContent = 'menu';
    AuthUI.open('login');
  });
  document.getElementById('nav-logout-btn')?.addEventListener('click', async () => {
    await Auth.signOut();
  });

  // ── Cart listener ──────────────────────────────────────────────────────────
  document.getElementById('cart-nav-btn')?.addEventListener('click', () => {
    if (typeof CartUI !== 'undefined') CartUI.open();
  });

  // ── Dropdown usuario: click/touch fix para tablets ─────────────────────────
  const userBtn = document.getElementById('nav-user-btn');
  if (userBtn) {
    const dropdown = userBtn.querySelector('div.hidden, div[class*="group-hover"]');
    userBtn.querySelector('button')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = userBtn.querySelector('div.absolute');
      if (dd) {
        dd.classList.toggle('hidden');
        dd.classList.toggle('block');
      }
    });
    document.addEventListener('click', (e) => {
      if (!userBtn.contains(e.target)) {
        const dd = userBtn.querySelector('div.absolute');
        if (dd) { dd.classList.add('hidden'); dd.classList.remove('block'); }
      }
    });
  }

  // ── Inicializar módulos ────────────────────────────────────────────────────
  try { await AuthUI.init(); }    catch(e) { console.warn('AuthUI:', e); }
  try { CartUI.init(); }          catch(e) { console.warn('CartUI:', e); }
  try { await Cart.init(); }      catch(e) { console.warn('Cart:', e); }
});
