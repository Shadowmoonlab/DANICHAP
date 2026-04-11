// auth.js — Modal login/registro + estado de sesión global
// v3 · robusto: sin re-inyección, fire-and-forget en listeners, timeout real
let _currentUser   = null;
let _currentPerfil = null;
let _modalInjected = false;

const AuthUI = {
  get user()    { return _currentUser; },
  get perfil()  { return _currentPerfil; },
  get isAdmin() { return _currentPerfil?.rol === 'admin'; },

  async init() {
    // 1. Inyectar modal primero (idempotente) — permite open() inmediato
    this._injectModal();

    // 2. Sesión inicial (rápido: usa getSession local, sin roundtrip)
    try {
      const user = await Auth.getUser();
      if (user) {
        _currentUser = user;
        // Perfil: fire-and-forget, no bloquear el init
        Perfiles.get(user.id)
          .then(p => { _currentPerfil = p; this._updateNavUI(); })
          .catch(e => console.warn('[auth] perfil inicial:', e));
      }
    } catch(e) { console.warn('[auth] getUser init:', e); }

    // 3. Listener de cambios — NUNCA bloqueante
    try {
      Auth.onAuthChange((event, session) => {
        if (event === 'INITIAL_SESSION') return;
        _currentUser = session?.user ?? null;

        if (event === 'SIGNED_OUT') {
          _currentPerfil = null;
          this._updateNavUI();
          if (typeof CartUI !== 'undefined') { try { CartUI.clearLocal(); } catch(_){} }
          return;
        }

        if (event === 'SIGNED_IN' && _currentUser) {
          // Fire-and-forget: el perfil se actualiza cuando llegue, sin bloquear
          Perfiles.get(_currentUser.id)
            .then(p => { _currentPerfil = p; this._updateNavUI(); })
            .catch(e => console.warn('[auth] perfil signIn:', e));
          if (typeof CartUI !== 'undefined') {
            CartUI.syncFromDB?.().catch(e => console.warn('[auth] cart sync:', e));
          }
        }

        this._updateNavUI();
      });
    } catch(e) { console.warn('[auth] onAuthChange:', e); }

    this._updateNavUI();
  },

  _injectModal() {
    if (_modalInjected || document.getElementById('auth-modal')) {
      _modalInjected = true;
      return;
    }
    _modalInjected = true;

    document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-modal" class="hidden fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" id="auth-overlay"></div>
      <div class="relative bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-8 border border-outline-variant z-10">
        <div class="flex gap-1 mb-7 bg-surface-container rounded-xl p-1">
          <button id="tab-login"    class="auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all bg-surface shadow text-on-surface">Ingresar</button>
          <button id="tab-register" class="auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all text-secondary">Registrarse</button>
        </div>
        <form id="form-login" class="space-y-4" novalidate>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Email</label>
            <input type="email" name="email" required autocomplete="email"
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Contraseña</label>
            <input type="password" name="password" required autocomplete="current-password"
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <p id="login-error" class="text-error text-xs hidden font-body"></p>
          <button type="submit" id="login-submit"
            class="w-full bg-primary-container text-white py-3 rounded-xl font-bold font-headline uppercase text-sm hover:opacity-90 transition-opacity disabled:opacity-60">
            Entrar
          </button>
        </form>
        <form id="form-register" class="space-y-4 hidden" novalidate>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Nombre</label>
            <input type="text" name="nombre" required autocomplete="name"
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Email</label>
            <input type="email" name="email" required autocomplete="email"
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Contraseña</label>
            <input type="password" name="password" required minlength="6" autocomplete="new-password"
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <p id="register-error"   class="text-error   text-xs hidden font-body"></p>
          <p id="register-success" class="text-tertiary text-xs hidden font-body">¡Cuenta creada! Revisá tu email para confirmar.</p>
          <button type="submit" id="register-submit"
            class="w-full bg-primary-container text-white py-3 rounded-xl font-bold font-headline uppercase text-sm hover:opacity-90 transition-opacity disabled:opacity-60">
            Crear cuenta
          </button>
        </form>
        <button id="auth-close" class="absolute top-4 right-4 text-secondary hover:text-on-surface transition-colors" aria-label="Cerrar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>`);

    document.getElementById('auth-overlay').addEventListener('click', () => this.close());
    document.getElementById('auth-close').addEventListener('click',   () => this.close());
    document.getElementById('tab-login').addEventListener('click',    () => this._switchTab('login'));
    document.getElementById('tab-register').addEventListener('click', () => this._switchTab('register'));

    document.getElementById('form-login').addEventListener('submit', this._handleLogin.bind(this));
    document.getElementById('form-register').addEventListener('submit', this._handleRegister.bind(this));
  },

  async _handleLogin(e) {
    e.preventDefault();
    const form  = e.target;
    const fd    = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const pass  = String(fd.get('password') || '');
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-submit');

    errEl.classList.add('hidden');
    errEl.textContent = '';

    if (!email || !pass) {
      errEl.textContent = 'Completá email y contraseña.';
      errEl.classList.remove('hidden');
      return;
    }

    // Spinner
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin align-middle mr-2"></span>Entrando…';
    btn.disabled = true;
    const reset = () => { btn.innerHTML = originalHTML; btn.disabled = false; };

    console.log('[auth] signIn start:', email);

    // Timeout real — 12s
    let result;
    try {
      result = await Promise.race([
        Auth.signIn(email, pass).then(r => ({ ok: true, ...r })).catch(err => ({ ok: false, error: err })),
        new Promise(resolve => setTimeout(() => resolve({ ok: false, error: { message: 'timeout' } }), 12000)),
      ]);
    } catch (ex) {
      console.warn('[auth] signIn exception:', ex);
      result = { ok: false, error: ex };
    }

    console.log('[auth] signIn resolved:', result?.ok, result?.error?.message);

    // SIEMPRE liberar botón antes de ramas
    reset();

    if (!result || result.error) {
      const rawMsg = String(result?.error?.message || '').toLowerCase();
      let uiMsg;
      if (rawMsg === 'timeout') {
        uiMsg = 'La conexión tardó demasiado. Revisá tu internet e intentá de nuevo.';
      } else if (rawMsg.includes('invalid') || rawMsg.includes('credentials') || rawMsg.includes('not found')) {
        uiMsg = 'Email o contraseña incorrectos.';
      } else if (rawMsg.includes('email not confirmed')) {
        uiMsg = 'Confirmá tu email antes de ingresar. Revisá tu casilla de correo.';
      } else if (rawMsg.includes('network') || rawMsg.includes('fetch') || rawMsg.includes('failed')) {
        uiMsg = 'Sin conexión. Revisá tu internet.';
      } else {
        uiMsg = 'No se pudo iniciar sesión. Intentá más tarde.';
      }
      errEl.textContent = uiMsg;
      errEl.classList.remove('hidden');
      return;
    }

    // Guard: email no confirmado devuelve error:null, user:null
    if (!result.data?.user?.id) {
      errEl.textContent = 'Confirmá tu email antes de ingresar. Revisá tu casilla de correo.';
      errEl.classList.remove('hidden');
      return;
    }

    // Login OK — cerrar modal INMEDIATAMENTE
    console.log('[auth] signIn OK, closing modal');
    this.close();

    // Redirección admin — fire-and-forget con timeout propio para no colgar
    const userId = result.data.user.id;
    Promise.race([
      Perfiles.get(userId),
      new Promise(resolve => setTimeout(() => resolve(null), 3000)),
    ]).then(perfil => {
      if (perfil?.rol === 'admin') {
        window.location.href = 'admin.html';
      }
      // usuarios normales: se quedan en la página actual; onAuthChange refresca navbar
    }).catch(e => console.warn('[auth] perfil redirect:', e));
  },

  async _handleRegister(e) {
    e.preventDefault();
    const form  = e.target;
    const fd    = new FormData(form);
    const errEl = document.getElementById('register-error');
    const okEl  = document.getElementById('register-success');
    const btn   = document.getElementById('register-submit');

    errEl.classList.add('hidden');
    okEl.classList.add('hidden');

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin align-middle mr-2"></span>Creando…';
    btn.disabled = true;
    const reset = () => { btn.innerHTML = originalHTML; btn.disabled = false; };

    let result;
    try {
      result = await Promise.race([
        Auth.signUp(fd.get('email'), fd.get('password'), fd.get('nombre'))
          .then(r => ({ ok: true, ...r })).catch(err => ({ ok: false, error: err })),
        new Promise(resolve => setTimeout(() => resolve({ ok: false, error: { message: 'timeout' } }), 12000)),
      ]);
    } catch (ex) {
      result = { ok: false, error: ex };
    }

    reset();

    if (!result || result.error) {
      errEl.textContent = result?.error?.message || 'No se pudo crear la cuenta.';
      errEl.classList.remove('hidden');
      return;
    }
    okEl.classList.remove('hidden');
    form.reset();
  },

  _switchTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('form-login').classList.toggle('hidden', !isLogin);
    document.getElementById('form-register').classList.toggle('hidden', isLogin);
    const base = 'auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all';
    document.getElementById('tab-login').className    = `${base} ${isLogin  ? 'bg-surface shadow text-on-surface' : 'text-secondary'}`;
    document.getElementById('tab-register').className = `${base} ${!isLogin ? 'bg-surface shadow text-on-surface' : 'text-secondary'}`;
  },

  open(tab = 'login') {
    this._injectModal();
    document.getElementById('auth-modal').classList.remove('hidden');
    this._switchTab(tab);
    document.body.style.overflow = 'hidden';
  },

  close() {
    document.getElementById('auth-modal')?.classList.add('hidden');
    document.body.style.overflow = '';
    // Limpiar errores y resetear form por si reabren
    const errEl = document.getElementById('login-error');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
  },

  _updateNavUI() {
    const loginBtn       = document.getElementById('nav-login-btn');
    const loginBtnMobile = document.getElementById('nav-login-btn-mobile');
    const userBtn        = document.getElementById('nav-user-btn');
    const userLabel      = document.getElementById('nav-user-label');
    const adminLink      = document.getElementById('nav-admin-link');
    if (!loginBtn) return;

    if (_currentUser) {
      loginBtn.classList.add('hidden');
      if (loginBtnMobile) loginBtnMobile.classList.add('hidden');
      userBtn?.classList.remove('hidden');
      userBtn?.classList.add('flex');
      if (userLabel) userLabel.textContent = _currentPerfil?.nombre || _currentUser.email.split('@')[0];
      if (adminLink) {
        adminLink.classList.toggle('hidden', !this.isAdmin);
        if (this.isAdmin) adminLink.classList.add('flex');
      }
    } else {
      loginBtn.classList.remove('hidden');
      if (loginBtnMobile) loginBtnMobile.classList.remove('hidden');
      userBtn?.classList.remove('flex');
      userBtn?.classList.add('hidden');
      if (adminLink) adminLink.classList.add('hidden');
    }
  },
};
