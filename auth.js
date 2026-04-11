// auth.js — Modal login/registro + estado de sesión global
let _currentUser   = null;
let _currentPerfil = null;

const AuthUI = {
  get user()    { return _currentUser; },
  get perfil()  { return _currentPerfil; },
  get isAdmin() { return _currentPerfil?.rol === 'admin'; },

  async init() {
    // Escuchar cambios de sesión
    try {
      Auth.onAuthChange(async (event, session) => {
        try {
          _currentUser   = session?.user ?? null;
          _currentPerfil = _currentUser ? await Perfiles.get(_currentUser.id) : null;
          this._updateNavUI();
          if (event === 'SIGNED_IN')  { if (typeof CartUI !== 'undefined') await CartUI.syncFromDB(); }
          if (event === 'SIGNED_OUT') { if (typeof CartUI !== 'undefined') CartUI.clearLocal(); }
        } catch(e) { console.warn('onAuthChange handler error:', e); }
      });
    } catch(e) { console.warn('Auth listener error:', e); }

    // Sesión inicial
    try {
      const user = await Auth.getUser();
      if (user) {
        _currentUser   = user;
        _currentPerfil = await Perfiles.get(user.id);
      }
    } catch(e) { console.warn('Auth getUser error:', e); }

    this._injectModal();
    this._updateNavUI();
  },

  _injectModal() {
    if (document.getElementById('auth-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="auth-modal" class="hidden fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" id="auth-overlay"></div>
      <div class="relative bg-surface rounded-2xl shadow-2xl w-full max-w-sm p-8 border border-outline-variant z-10">
        <!-- Tabs -->
        <div class="flex gap-1 mb-7 bg-surface-container rounded-xl p-1">
          <button id="tab-login"    class="auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all bg-surface shadow text-on-surface">Ingresar</button>
          <button id="tab-register" class="auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all text-secondary">Registrarse</button>
        </div>
        <!-- Login -->
        <form id="form-login" class="space-y-4">
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
          <button type="submit"
            class="w-full bg-primary-container text-white py-3 rounded-xl font-bold font-headline uppercase text-sm hover:opacity-90 transition-opacity">
            Entrar
          </button>
        </form>
        <!-- Register -->
        <form id="form-register" class="space-y-4 hidden">
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
          <button type="submit"
            class="w-full bg-primary-container text-white py-3 rounded-xl font-bold font-headline uppercase text-sm hover:opacity-90 transition-opacity">
            Crear cuenta
          </button>
        </form>
        <button id="auth-close" class="absolute top-4 right-4 text-secondary hover:text-on-surface transition-colors">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>`);

    document.getElementById('auth-overlay').addEventListener('click', () => this.close());
    document.getElementById('auth-close').addEventListener('click',   () => this.close());
    document.getElementById('tab-login').addEventListener('click',    () => this._switchTab('login'));
    document.getElementById('tab-register').addEventListener('click', () => this._switchTab('register'));

    document.getElementById('form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const fd    = new FormData(e.target);
      const errEl = document.getElementById('login-error');
      const btn   = e.target.querySelector('button[type=submit]');
      errEl.classList.add('hidden');
      btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin align-middle mr-2"></span>Entrando…';
      btn.disabled = true;

      let data, error;
      try {
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), 12000)
        );
        ({ data, error } = await Promise.race([
          Auth.signIn(fd.get('email'), fd.get('password')),
          timeout
        ]));
      } catch (ex) {
        error = ex;
      }

      btn.innerHTML = 'Entrar'; btn.disabled = false;

      if (error) {
        const msg = error.message || '';
        if (msg === 'timeout') {
          errEl.textContent = 'La conexión tardó demasiado. Revisá tu internet e intentá de nuevo.';
        } else if (msg.includes('Invalid login') || msg.includes('invalid_credentials')) {
          errEl.textContent = 'Email o contraseña incorrectos.';
        } else if (msg.includes('network') || msg.includes('fetch')) {
          errEl.textContent = 'Sin conexión. Revisá tu internet.';
        } else {
          errEl.textContent = 'No se pudo iniciar sesión. Intentá más tarde.';
        }
        errEl.classList.remove('hidden');
        return;
      }

      this.close();
    });

    document.getElementById('form-register').addEventListener('submit', async e => {
      e.preventDefault();
      const fd    = new FormData(e.target);
      const errEl = document.getElementById('register-error');
      const okEl  = document.getElementById('register-success');
      const btn   = e.target.querySelector('button[type=submit]');
      errEl.classList.add('hidden'); okEl.classList.add('hidden');
      btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin align-middle mr-2"></span>Creando…';
      btn.disabled = true;
      let error;
      try {
        ({ error } = await Auth.signUp(fd.get('email'), fd.get('password'), fd.get('nombre')));
      } catch (ex) {
        error = ex;
      }
      btn.innerHTML = 'Crear cuenta'; btn.disabled = false;
      if (error) { errEl.textContent = error.message || 'No se pudo crear la cuenta.'; errEl.classList.remove('hidden'); return; }
      okEl.classList.remove('hidden');
      e.target.reset();
    });
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
    if (!document.getElementById('auth-modal')) this._injectModal();
    document.getElementById('auth-modal').classList.remove('hidden');
    this._switchTab(tab);
    document.body.style.overflow = 'hidden';
  },
  close() {
    document.getElementById('auth-modal')?.classList.add('hidden');
    document.body.style.overflow = '';
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
      userBtn.classList.remove('hidden');
      userBtn.classList.add('flex');
      if (userLabel) userLabel.textContent = _currentPerfil?.nombre || _currentUser.email.split('@')[0];
      if (adminLink) {
        adminLink.classList.toggle('hidden', !this.isAdmin);
        if (this.isAdmin) adminLink.classList.add('flex');
      }
    } else {
      loginBtn.classList.remove('hidden');
      if (loginBtnMobile) loginBtnMobile.classList.remove('hidden');
      userBtn.classList.remove('flex');
      userBtn.classList.add('hidden');
      if (adminLink) adminLink.classList.add('hidden');
    }
  },
};
