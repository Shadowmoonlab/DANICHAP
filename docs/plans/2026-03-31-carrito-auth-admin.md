# Carrito + Auth + Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar carrito de compras persistente, autenticación de usuarios y panel admin para gestión de productos a DANICHAP (proyecto HTML/JS vanilla).

**Architecture:** Supabase como backend completo (Auth + Postgres + Realtime). El frontend sigue siendo HTML/JS vanilla con Tailwind CDN. Se agrega la librería `@supabase/supabase-js` vía CDN. Los productos migran de `data.js` estático a tabla Supabase con RLS. El admin accede a `/admin.html` protegido por rol. El scroll tipo Apple se implementa con Intersection Observer en `index.html`.

**Tech Stack:** HTML5 · Tailwind CSS (CDN) · Vanilla JS ES6 · Supabase JS v2 (CDN) · PostgreSQL (Supabase) · Supabase Auth (email/password)

---

## Resumen de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase.js` | Crear | Cliente Supabase singleton + helpers de auth |
| `auth.js` | Crear | Login/registro modal, estado de sesión, guard de rutas |
| `cart.js` | Crear | Lógica del carrito (add/remove/sync con Supabase) |
| `cart-ui.js` | Crear | Drawer del carrito, badge contador, renderizado |
| `admin.html` | Crear | Panel admin: CRUD de productos |
| `admin.js` | Crear | Lógica CRUD admin (upload imagen, form validación) |
| `login.html` | Crear | Página de login/registro standalone |
| `index.html` | Modificar | Agregar scroll Apple, incluir scripts nuevos |
| `catalogo.html` | Modificar | Botón "Agregar al carrito" en cada producto |
| `shared.css` | Modificar | Estilos del drawer, modal auth, scroll animations |
| `nav.js` | Modificar | Agregar badge carrito + botón user/logout en nav |

---

## Chunk 1: Supabase Setup + Schema

### Task 1: Crear proyecto Supabase y schema SQL

**Archivos:**
- Crear: `supabase-schema.sql` (referencia, no se ejecuta en código)
- Crear: `supabase.js`

- [ ] **Step 1.1: Crear proyecto en Supabase**
  1. Ir a https://supabase.com → New Project
  2. Nombre: `danichap` · Región: South America (São Paulo)
  3. Guardar: `Project URL` y `anon public key`

- [ ] **Step 1.2: Ejecutar schema en el SQL Editor de Supabase**

```sql
-- Tabla de productos (reemplaza data.js estático)
create table if not exists productos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  categoria   text not null,
  subcategoria text,
  marca_rep   text,
  precio      numeric(10,2),
  precio_antes numeric(10,2),
  descripcion text,
  imagen_url  text,
  stock       boolean default true,
  destacado   boolean default false,
  badge       text,
  vehiculos_compatibles text[],
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Tabla de carrito por usuario
create table if not exists carrito (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  producto_id uuid references productos(id) on delete cascade not null,
  cantidad    int default 1 check (cantidad > 0),
  created_at  timestamptz default now(),
  unique(user_id, producto_id)
);

-- Perfil de usuario (extiende auth.users)
create table if not exists perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text,
  telefono    text,
  rol         text default 'cliente' check (rol in ('cliente', 'admin')),
  created_at  timestamptz default now()
);

-- Trigger: crear perfil automáticamente al registrarse
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (new.id, new.raw_user_meta_data->>'nombre', 'cliente');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- RLS: productos (lectura pública, escritura solo admin)
alter table productos enable row level security;
create policy "Lectura pública de productos"
  on productos for select using (true);
create policy "Admin puede todo en productos"
  on productos for all
  using (
    exists (
      select 1 from perfiles
      where id = auth.uid() and rol = 'admin'
    )
  );

-- RLS: carrito (solo el dueño)
alter table carrito enable row level security;
create policy "Usuario ve su carrito"
  on carrito for select using (auth.uid() = user_id);
create policy "Usuario modifica su carrito"
  on carrito for insert with check (auth.uid() = user_id);
create policy "Usuario actualiza su carrito"
  on carrito for update using (auth.uid() = user_id);
create policy "Usuario elimina de su carrito"
  on carrito for delete using (auth.uid() = user_id);

-- RLS: perfiles
alter table perfiles enable row level security;
create policy "Usuario ve su perfil"
  on perfiles for select using (auth.uid() = id);
create policy "Admin ve todos los perfiles"
  on perfiles for select
  using (
    exists (select 1 from perfiles where id = auth.uid() and rol = 'admin')
  );

-- Storage bucket para imágenes de productos
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict do nothing;

create policy "Lectura pública storage productos"
  on storage.objects for select
  using (bucket_id = 'productos');
create policy "Admin sube imágenes"
  on storage.objects for insert
  with check (
    bucket_id = 'productos' and
    exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin')
  );
create policy "Admin elimina imágenes"
  on storage.objects for delete
  using (
    bucket_id = 'productos' and
    exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin')
  );
```

- [ ] **Step 1.3: Promover un usuario a admin** (después de registrarse por primera vez)
```sql
update perfiles set rol = 'admin' where id = '<uuid-del-usuario>';
-- O por email:
update perfiles set rol = 'admin'
where id = (select id from auth.users where email = 'admin@danichap.com');
```

- [ ] **Step 1.4: Crear `supabase.js`**

```js
// supabase.js — Cliente Supabase singleton
const SUPABASE_URL = 'https://TU_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'TU_ANON_KEY';

const { createClient } = supabase; // supabase-js v2 via CDN
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth helpers
const Auth = {
  async getUser()       { const { data } = await _supabase.auth.getUser(); return data.user; },
  async getSession()    { const { data } = await _supabase.auth.getSession(); return data.session; },
  async signIn(email, password) {
    return _supabase.auth.signInWithPassword({ email, password });
  },
  async signUp(email, password, nombre) {
    return _supabase.auth.signUp({ email, password, options: { data: { nombre } } });
  },
  async signOut()       { return _supabase.auth.signOut(); },
  onAuthChange(cb)      { return _supabase.auth.onAuthStateChange(cb); },
};

// Perfil
const Perfiles = {
  async get(userId) {
    const { data } = await _supabase.from('perfiles').select('*').eq('id', userId).single();
    return data;
  },
  async isAdmin(userId) {
    const p = await Perfiles.get(userId);
    return p?.rol === 'admin';
  },
};

// Productos
const Productos = {
  async list(filtros = {}) {
    let q = _supabase.from('productos').select('*').eq('stock', true);
    if (filtros.categoria)    q = q.eq('categoria', filtros.categoria);
    if (filtros.destacado)    q = q.eq('destacado', true);
    if (filtros.busqueda)     q = q.ilike('nombre', `%${filtros.busqueda}%`);
    const { data, error } = await q.order('created_at', { ascending: false });
    return { data, error };
  },
  async get(id) {
    const { data } = await _supabase.from('productos').select('*').eq('id', id).single();
    return data;
  },
  async create(prod) {
    return _supabase.from('productos').insert(prod).select().single();
  },
  async update(id, updates) {
    return _supabase.from('productos').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  },
  async delete(id) {
    return _supabase.from('productos').delete().eq('id', id);
  },
  async uploadImagen(file) {
    const ext  = file.name.split('.').pop();
    const path = `${Date.now()}.${ext}`;
    const { error } = await _supabase.storage.from('productos').upload(path, file);
    if (error) return { url: null, error };
    const { data } = _supabase.storage.from('productos').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  },
};

// Carrito
const CarritoDB = {
  async get(userId) {
    const { data } = await _supabase
      .from('carrito')
      .select('*, productos(*)')
      .eq('user_id', userId);
    return data || [];
  },
  async add(userId, productoId, cantidad = 1) {
    return _supabase.from('carrito').upsert(
      { user_id: userId, producto_id: productoId, cantidad },
      { onConflict: 'user_id,producto_id', ignoreDuplicates: false }
    );
  },
  async updateCantidad(userId, productoId, cantidad) {
    if (cantidad <= 0) return CarritoDB.remove(userId, productoId);
    return _supabase.from('carrito')
      .update({ cantidad })
      .eq('user_id', userId)
      .eq('producto_id', productoId);
  },
  async remove(userId, productoId) {
    return _supabase.from('carrito')
      .delete()
      .eq('user_id', userId)
      .eq('producto_id', productoId);
  },
  async clear(userId) {
    return _supabase.from('carrito').delete().eq('user_id', userId);
  },
};
```

- [ ] **Step 1.5: Reemplazar `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los valores reales del proyecto**

---

## Chunk 2: Auth Modal + Estado de Sesión

### Task 2: `auth.js` — Login/Registro modal

**Archivos:**
- Crear: `auth.js`

- [ ] **Step 2.1: Crear `auth.js`**

```js
// auth.js — Modal de login/registro + estado de sesión global
let _currentUser  = null;
let _currentPerfil = null;

const AuthUI = {
  // Estado global accesible desde cualquier script
  get user()   { return _currentUser; },
  get perfil() { return _currentPerfil; },
  get isAdmin(){ return _currentPerfil?.rol === 'admin'; },

  async init() {
    // Escuchar cambios de sesión
    Auth.onAuthChange(async (event, session) => {
      _currentUser = session?.user ?? null;
      _currentPerfil = _currentUser ? await Perfiles.get(_currentUser.id) : null;
      this._updateNavUI();
      if (event === 'SIGNED_IN')  CartUI.syncFromDB();
      if (event === 'SIGNED_OUT') CartUI.clearLocal();
    });

    // Cargar sesión inicial
    const user = await Auth.getUser();
    if (user) {
      _currentUser  = user;
      _currentPerfil = await Perfiles.get(user.id);
    }
    this._injectModal();
    this._updateNavUI();
  },

  _injectModal() {
    if (document.getElementById('auth-modal')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <!-- AUTH MODAL -->
    <div id="auth-modal" class="hidden fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" id="auth-overlay"></div>
      <div class="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md p-8 border border-outline-variant z-10">
        <!-- Tabs -->
        <div class="flex gap-1 mb-8 bg-surface-container rounded-xl p-1">
          <button id="tab-login"    class="auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all bg-surface shadow text-on-surface">Iniciar sesión</button>
          <button id="tab-register" class="auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all text-secondary">Registrarse</button>
        </div>
        <!-- Login form -->
        <form id="form-login" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Email</label>
            <input type="email" name="email" required
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Contraseña</label>
            <input type="password" name="password" required
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <p id="login-error" class="text-error text-xs hidden"></p>
          <button type="submit"
            class="w-full bg-primary-container text-white py-3 rounded-xl font-bold font-headline uppercase text-sm hover:opacity-90 transition-opacity">
            Entrar
          </button>
        </form>
        <!-- Register form -->
        <form id="form-register" class="space-y-4 hidden">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Nombre</label>
            <input type="text" name="nombre" required
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Email</label>
            <input type="email" name="email" required
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Contraseña</label>
            <input type="password" name="password" required minlength="6"
              class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
          <p id="register-error" class="text-error text-xs hidden"></p>
          <p id="register-success" class="text-tertiary text-xs hidden">¡Registrado! Revisá tu email para confirmar.</p>
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

    // Eventos del modal
    document.getElementById('auth-overlay').addEventListener('click', () => this.close());
    document.getElementById('auth-close').addEventListener('click',   () => this.close());
    document.getElementById('tab-login').addEventListener('click',    () => this._switchTab('login'));
    document.getElementById('tab-register').addEventListener('click', () => this._switchTab('register'));

    document.getElementById('form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      const btn = e.target.querySelector('button[type=submit]');
      btn.textContent = 'Entrando...'; btn.disabled = true;
      const { error } = await Auth.signIn(fd.get('email'), fd.get('password'));
      btn.textContent = 'Entrar'; btn.disabled = false;
      if (error) { errEl.textContent = 'Email o contraseña incorrectos.'; errEl.classList.remove('hidden'); return; }
      this.close();
    });

    document.getElementById('form-register').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('register-error');
      const okEl  = document.getElementById('register-success');
      errEl.classList.add('hidden'); okEl.classList.add('hidden');
      const btn = e.target.querySelector('button[type=submit]');
      btn.textContent = 'Creando...'; btn.disabled = true;
      const { error } = await Auth.signUp(fd.get('email'), fd.get('password'), fd.get('nombre'));
      btn.textContent = 'Crear cuenta'; btn.disabled = false;
      if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      okEl.classList.remove('hidden');
    });
  },

  _switchTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('form-login').classList.toggle('hidden', !isLogin);
    document.getElementById('form-register').classList.toggle('hidden', isLogin);
    document.getElementById('tab-login').className    = `auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all ${isLogin  ? 'bg-surface shadow text-on-surface' : 'text-secondary'}`;
    document.getElementById('tab-register').className = `auth-tab flex-1 py-2 rounded-lg text-sm font-bold font-headline uppercase tracking-wide transition-all ${!isLogin ? 'bg-surface shadow text-on-surface' : 'text-secondary'}`;
  },

  open(tab = 'login') {
    document.getElementById('auth-modal').classList.remove('hidden');
    this._switchTab(tab);
  },
  close() {
    document.getElementById('auth-modal').classList.add('hidden');
  },

  _updateNavUI() {
    const loginBtn  = document.getElementById('nav-login-btn');
    const userBtn   = document.getElementById('nav-user-btn');
    const userLabel = document.getElementById('nav-user-label');
    const adminLink = document.getElementById('nav-admin-link');
    if (!loginBtn) return;

    if (_currentUser) {
      loginBtn.classList.add('hidden');
      userBtn.classList.remove('hidden');
      if (userLabel) userLabel.textContent = _currentPerfil?.nombre || _currentUser.email.split('@')[0];
      if (adminLink) adminLink.classList.toggle('hidden', !this.isAdmin);
    } else {
      loginBtn.classList.remove('hidden');
      userBtn.classList.add('hidden');
      if (adminLink) adminLink.classList.add('hidden');
    }
  },
};
```

---

## Chunk 3: Carrito (lógica + UI drawer)

### Task 3: `cart.js` — Lógica del carrito

**Archivos:**
- Crear: `cart.js`

- [ ] **Step 3.1: Crear `cart.js`**

```js
// cart.js — Estado del carrito (local + Supabase sync)
// Estructura item: { producto_id, cantidad, productos: {...} }
let _items = [];
let _listeners = [];

const Cart = {
  get items()  { return _items; },
  get count()  { return _items.reduce((s, i) => s + i.cantidad, 0); },
  get total()  { return _items.reduce((s, i) => s + (i.productos?.precio || 0) * i.cantidad, 0); },

  subscribe(fn) { _listeners.push(fn); },
  _notify()     { _listeners.forEach(fn => fn(_items)); },

  async add(producto) {
    const user = AuthUI.user;
    const existing = _items.find(i => i.producto_id === producto.id);
    if (existing) {
      existing.cantidad++;
    } else {
      _items.push({ producto_id: producto.id, cantidad: 1, productos: producto });
    }
    this._notify();
    this._saveLocal();

    if (user) {
      await CarritoDB.add(user.id, producto.id, existing ? existing.cantidad : 1);
    }
  },

  async remove(productoId) {
    _items = _items.filter(i => i.producto_id !== productoId);
    this._notify();
    this._saveLocal();
    const user = AuthUI.user;
    if (user) await CarritoDB.remove(user.id, productoId);
  },

  async updateCantidad(productoId, cantidad) {
    if (cantidad <= 0) return this.remove(productoId);
    const item = _items.find(i => i.producto_id === productoId);
    if (item) { item.cantidad = cantidad; this._notify(); this._saveLocal(); }
    const user = AuthUI.user;
    if (user) await CarritoDB.updateCantidad(user.id, productoId, cantidad);
  },

  async clear() {
    _items = [];
    this._notify();
    this._saveLocal();
    const user = AuthUI.user;
    if (user) await CarritoDB.clear(user.id);
  },

  // Sincronizar con Supabase al hacer login
  async syncFromDB() {
    const user = AuthUI.user;
    if (!user) return;
    const dbItems = await CarritoDB.get(user.id);
    // Merge: DB gana sobre local
    _items = dbItems;
    // Migrar items locales no sincronizados
    const local = this._loadLocal();
    for (const localItem of local) {
      const yaEnDB = dbItems.find(i => i.producto_id === localItem.producto_id);
      if (!yaEnDB) {
        const prod = await Productos.get(localItem.producto_id);
        if (prod) {
          _items.push({ producto_id: prod.id, cantidad: localItem.cantidad, productos: prod });
          await CarritoDB.add(user.id, prod.id, localItem.cantidad);
        }
      }
    }
    this._notify();
    this._saveLocal();
  },

  clearLocal() {
    _items = [];
    this._notify();
    localStorage.removeItem('danichap_cart');
  },

  _saveLocal() {
    localStorage.setItem('danichap_cart', JSON.stringify(
      _items.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad }))
    ));
  },

  _loadLocal() {
    try { return JSON.parse(localStorage.getItem('danichap_cart') || '[]'); } catch { return []; }
  },

  // Inicializar: cargar desde local (guest) o DB (logged in)
  async init() {
    const user = AuthUI.user;
    if (user) {
      await this.syncFromDB();
    } else {
      const local = this._loadLocal();
      for (const item of local) {
        const prod = await Productos.get(item.producto_id);
        if (prod) _items.push({ producto_id: prod.id, cantidad: item.cantidad, productos: prod });
      }
      this._notify();
    }
  },
};
```

### Task 4: `cart-ui.js` — Drawer del carrito

**Archivos:**
- Crear: `cart-ui.js`

- [ ] **Step 4.1: Crear `cart-ui.js`**

```js
// cart-ui.js — Drawer lateral del carrito
const CartUI = {
  syncFromDB() { return Cart.syncFromDB(); },
  clearLocal()  { return Cart.clearLocal(); },

  init() {
    this._injectDrawer();
    this._injectNavBadge();
    Cart.subscribe(() => this._render());
  },

  _injectDrawer() {
    if (document.getElementById('cart-drawer')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <!-- CART DRAWER -->
    <div id="cart-drawer" class="hidden fixed inset-0 z-[150]">
      <div id="cart-overlay" class="absolute inset-0 bg-black/30 backdrop-blur-sm"></div>
      <aside class="absolute right-0 top-0 h-full w-full max-w-md bg-surface shadow-2xl flex flex-col border-l border-outline-variant transform translate-x-0 transition-transform">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-5 border-b border-outline-variant">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary-container" style="font-variation-settings:'FILL' 1;">shopping_cart</span>
            <h2 class="font-headline font-black text-lg uppercase text-on-surface">Tu carrito</h2>
            <span id="cart-drawer-count" class="bg-primary-container text-white text-xs font-bold px-2 py-0.5 rounded-full font-label">0</span>
          </div>
          <button id="cart-close" class="text-secondary hover:text-on-surface transition-colors">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <!-- Items -->
        <div id="cart-items" class="flex-1 overflow-y-auto px-6 py-4 space-y-4"></div>
        <!-- Footer -->
        <div id="cart-footer" class="px-6 py-5 border-t border-outline-variant hidden">
          <div class="flex justify-between items-center mb-4">
            <span class="font-body text-secondary text-sm">Total estimado</span>
            <span id="cart-total" class="font-headline font-black text-2xl text-on-surface"></span>
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
        <!-- Empty state -->
        <div id="cart-empty" class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8 hidden">
          <span class="material-symbols-outlined text-6xl text-outline-variant">shopping_cart</span>
          <p class="text-secondary font-body text-sm">Tu carrito está vacío.<br/>Agregá productos desde el catálogo.</p>
          <a href="catalogo.html" class="text-primary-container font-bold text-sm font-headline uppercase hover:underline">Ver catálogo</a>
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
    // Insertar botón carrito en el nav (se llama después de que el nav esté en el DOM)
    const navActions = document.querySelector('nav .flex.items-center.gap-3');
    if (!navActions || document.getElementById('cart-nav-btn')) return;
    navActions.insertAdjacentHTML('afterbegin', `
      <button id="cart-nav-btn" class="relative p-2 rounded-lg hover:bg-surface-container transition-colors text-on-surface" title="Carrito">
        <span class="material-symbols-outlined text-2xl" style="font-variation-settings:'FILL' 0;">shopping_cart</span>
        <span id="cart-badge" class="hidden absolute -top-1 -right-1 bg-primary-container text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center font-label">0</span>
      </button>
    `);
    document.getElementById('cart-nav-btn').addEventListener('click', () => this.open());
  },

  open()  { document.getElementById('cart-drawer').classList.remove('hidden'); document.body.style.overflow = 'hidden'; },
  close() { document.getElementById('cart-drawer').classList.add('hidden'); document.body.style.overflow = ''; },

  _render() {
    const items   = Cart.items;
    const count   = Cart.count;
    const total   = Cart.total;
    const isEmpty = items.length === 0;

    // Badge nav
    const badge = document.getElementById('cart-badge');
    if (badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }

    // Drawer count
    const drawerCount = document.getElementById('cart-drawer-count');
    if (drawerCount) drawerCount.textContent = count;

    // Alternar empty/items
    document.getElementById('cart-empty').classList.toggle('hidden', !isEmpty);
    document.getElementById('cart-footer').classList.toggle('hidden', isEmpty);

    // Renderizar items
    const container = document.getElementById('cart-items');
    container.innerHTML = items.map(item => {
      const p = item.productos;
      const precio = p?.precio ? `$${Number(p.precio).toLocaleString('es-AR')}` : 'Consultar';
      return `
      <div class="flex gap-4 items-start">
        <div class="w-16 h-16 rounded-xl overflow-hidden bg-surface-container-low flex-shrink-0 border border-outline-variant">
          ${p?.imagen_url
            ? `<img src="${p.imagen_url}" alt="${p.nombre}" class="w-full h-full object-cover"/>`
            : `<div class="w-full h-full flex items-center justify-center"><span class="material-symbols-outlined text-2xl text-outline">inventory_2</span></div>`
          }
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-body font-bold text-sm text-on-surface truncate">${p?.nombre || 'Producto'}</p>
          ${p?.marca_rep ? `<p class="text-xs text-secondary font-label">${p.marca_rep}</p>` : ''}
          <p class="font-headline font-black text-primary-container text-sm mt-1">${precio}</p>
          <div class="flex items-center gap-2 mt-2">
            <button onclick="Cart.updateCantidad('${item.producto_id}', ${item.cantidad - 1})"
              class="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors font-bold">−</button>
            <span class="text-sm font-bold font-label w-5 text-center">${item.cantidad}</span>
            <button onclick="Cart.updateCantidad('${item.producto_id}', ${item.cantidad + 1})"
              class="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors font-bold">+</button>
            <button onclick="Cart.remove('${item.producto_id}')"
              class="ml-auto text-secondary hover:text-error transition-colors">
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Total
    if (document.getElementById('cart-total')) {
      document.getElementById('cart-total').textContent = total > 0
        ? `$${Number(total).toLocaleString('es-AR')}`
        : 'A consultar';
    }

    // WPP link
    const wppBtn = document.getElementById('cart-wpp-btn');
    if (wppBtn) {
      const lista = items.map(i => `• ${i.productos?.nombre} x${i.cantidad}`).join('%0A');
      wppBtn.href = `https://wa.me/541175200352?text=${encodeURIComponent(`Hola Danichap! Quiero consultar por los siguientes productos:\n${items.map(i => `• ${i.productos?.nombre} x${i.cantidad}`).join('\n')}\n¿Tienen stock y precio?`)}`;
    }
  },
};
```

---

## Chunk 4: Actualizar Nav + Catálogo

### Task 5: Modificar `nav.js` para incluir botón user/login y admin link

**Archivos:**
- Modificar: `nav.js`

- [ ] **Step 5.1: Reemplazar contenido de `nav.js`**

```js
// nav.js — Toggle hamburger + auth nav buttons
document.addEventListener('DOMContentLoaded', async () => {
  // Hamburger
  const btn  = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  const icon = document.getElementById('menu-icon');
  if (btn && menu) {
    btn.addEventListener('click', () => {
      const isOpen = !menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      icon.textContent = isOpen ? 'menu' : 'close';
    });
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => { menu.classList.add('hidden'); icon.textContent = 'menu'; });
    });
  }

  // Inyectar botones auth en nav desktop
  const navActions = document.querySelector('nav .flex.items-center.gap-3');
  if (navActions && !document.getElementById('nav-login-btn')) {
    navActions.insertAdjacentHTML('beforeend', `
      <button id="nav-login-btn"
        class="hidden md:flex items-center gap-2 border border-primary-container text-primary-container px-4 py-2 rounded-xl font-bold text-sm hover:bg-primary-container/10 transition-colors font-headline uppercase">
        <span class="material-symbols-outlined text-sm">person</span>
        Ingresar
      </button>
      <div id="nav-user-btn" class="hidden md:flex items-center gap-2 relative group">
        <button class="flex items-center gap-2 border border-outline-variant px-4 py-2 rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container transition-colors font-headline uppercase">
          <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">account_circle</span>
          <span id="nav-user-label">Mi cuenta</span>
        </button>
        <div class="absolute top-full right-0 mt-1 bg-surface border border-outline-variant rounded-xl shadow-lg py-1 w-44 hidden group-hover:block z-50">
          <a id="nav-admin-link" href="admin.html" class="hidden flex items-center gap-2 px-4 py-2.5 text-sm text-primary-container font-bold hover:bg-surface-container transition-colors font-headline uppercase">
            <span class="material-symbols-outlined text-sm">admin_panel_settings</span>Admin
          </a>
          <button id="nav-logout-btn" class="flex items-center gap-2 px-4 py-2.5 text-sm text-secondary hover:text-error hover:bg-surface-container transition-colors font-body w-full text-left">
            <span class="material-symbols-outlined text-sm">logout</span>Cerrar sesión
          </button>
        </div>
      </div>
    `);

    document.getElementById('nav-login-btn')?.addEventListener('click',  () => AuthUI.open('login'));
    document.getElementById('nav-logout-btn')?.addEventListener('click', async () => { await Auth.signOut(); });
  }

  // Inicializar auth y carrito
  if (typeof AuthUI !== 'undefined') await AuthUI.init();
  if (typeof CartUI !== 'undefined')  CartUI.init();
  if (typeof Cart   !== 'undefined')  await Cart.init();
});
```

### Task 6: Agregar scripts en `<head>` de todas las páginas

- [ ] **Step 6.1: Agregar en `index.html`, `catalogo.html`, `contacto.html` — antes del `</head>`**

```html
<!-- Supabase JS v2 -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<!-- Danichap modules -->
<script src="supabase.js"></script>
<script src="auth.js"></script>
<script src="cart.js"></script>
<script src="cart-ui.js" defer></script>
```

### Task 7: Botón "Agregar al carrito" en `catalogo.html`

**Archivos:**
- Modificar: `catalogo.js`

- [ ] **Step 7.1: En `catalogo.js`, buscar donde se renderiza la tarjeta de producto y agregar el botón**

Donde actualmente hay un botón de WhatsApp por producto, agregar **también**:
```js
// Dentro del template string de la card de producto, junto al botón WPP:
`<button
  onclick="agregarAlCarrito(event, ${JSON.stringify(producto).replace(/"/g, '&quot;')})"
  class="flex-1 flex items-center justify-center gap-1.5 bg-primary-container text-white px-3 py-2.5 rounded-xl text-xs font-bold hover:opacity-90 transition-opacity font-headline uppercase">
  <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">add_shopping_cart</span>
  Agregar
</button>`

// Al final del archivo catalogo.js, agregar:
async function agregarAlCarrito(e, producto) {
  e.preventDefault();
  if (!AuthUI.user) { AuthUI.open('login'); return; }
  await Cart.add(producto);
  // Feedback visual
  const btn = e.currentTarget;
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="material-symbols-outlined text-sm" style="font-variation-settings:\'FILL\' 1;">check</span> Agregado';
  btn.disabled = true;
  setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);
}
```

---

## Chunk 5: Panel Admin

### Task 8: `admin.html` — Página del panel admin

**Archivos:**
- Crear: `admin.html`
- Crear: `admin.js`

- [ ] **Step 8.1: Crear `admin.html`**

```html
<!DOCTYPE html>
<html lang="es" class="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Admin — DANICHAP</title>
<script src="https://cdn.tailwindcss.com?plugins=forms"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="shared.css"/>
<script id="tailwind-config">
/* Copiar el mismo tailwind.config de index.html */
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="supabase.js"></script>
<script src="auth.js"></script>
</head>
<body class="bg-surface font-body text-on-surface min-h-screen">

<!-- Guard: se maneja en admin.js -->
<div id="admin-guard" class="hidden fixed inset-0 bg-surface flex items-center justify-center z-[300]">
  <div class="text-center">
    <span class="material-symbols-outlined text-6xl text-outline-variant">lock</span>
    <p class="mt-4 text-secondary font-body">Acceso restringido. <a href="index.html" class="text-primary-container font-bold hover:underline">Volver al inicio</a></p>
  </div>
</div>

<!-- Header admin -->
<header class="bg-surface border-b border-outline-variant px-6 py-4 flex items-center justify-between sticky top-0 z-40">
  <div class="flex items-center gap-3">
    <a href="index.html" class="text-secondary hover:text-on-surface transition-colors">
      <span class="material-symbols-outlined">arrow_back</span>
    </a>
    <h1 class="font-headline font-black text-lg uppercase text-on-surface">Panel Admin</h1>
    <span class="text-xs font-label uppercase tracking-widest text-primary-container bg-primary-container/10 px-2 py-1 rounded-full">DANICHAP</span>
  </div>
  <button id="admin-logout" class="text-secondary hover:text-error text-sm font-body flex items-center gap-1 transition-colors">
    <span class="material-symbols-outlined text-sm">logout</span> Salir
  </button>
</header>

<!-- Main -->
<main class="max-w-screen-xl mx-auto px-6 py-10">
  <!-- Stats rápidas -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
    <div class="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
      <div class="text-3xl font-black font-headline text-primary-container" id="stat-total">—</div>
      <div class="text-xs font-label uppercase tracking-wide text-secondary mt-1">Productos total</div>
    </div>
    <div class="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
      <div class="text-3xl font-black font-headline text-primary-container" id="stat-destacados">—</div>
      <div class="text-xs font-label uppercase tracking-wide text-secondary mt-1">Destacados</div>
    </div>
    <div class="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
      <div class="text-3xl font-black font-headline text-primary-container" id="stat-sin-precio">—</div>
      <div class="text-xs font-label uppercase tracking-wide text-secondary mt-1">Sin precio</div>
    </div>
    <div class="bg-surface-container-low rounded-2xl p-5 border border-outline-variant">
      <div class="text-3xl font-black font-headline text-primary-container" id="stat-categorias">—</div>
      <div class="text-xs font-label uppercase tracking-wide text-secondary mt-1">Categorías</div>
    </div>
  </div>

  <!-- Toolbar -->
  <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between mb-6">
    <div class="flex gap-3 items-center">
      <input id="admin-search" type="text" placeholder="Buscar producto..."
        class="bg-surface-container-low border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-container w-64 transition-colors"/>
      <select id="admin-filter-cat" class="bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary-container transition-colors">
        <option value="">Todas las categorías</option>
      </select>
    </div>
    <button id="btn-nuevo-producto"
      class="flex items-center gap-2 bg-primary-container text-white px-5 py-2.5 rounded-xl font-bold text-sm font-headline uppercase hover:opacity-90 transition-opacity">
      <span class="material-symbols-outlined text-sm">add</span>
      Nuevo producto
    </button>
  </div>

  <!-- Tabla de productos -->
  <div class="bg-surface border border-outline-variant rounded-2xl overflow-hidden shadow-sm">
    <table class="w-full text-sm">
      <thead class="bg-surface-container-low border-b border-outline-variant">
        <tr>
          <th class="text-left px-4 py-3 font-label font-bold uppercase tracking-wide text-secondary text-xs">Producto</th>
          <th class="text-left px-4 py-3 font-label font-bold uppercase tracking-wide text-secondary text-xs hidden md:table-cell">Categoría</th>
          <th class="text-left px-4 py-3 font-label font-bold uppercase tracking-wide text-secondary text-xs hidden sm:table-cell">Precio</th>
          <th class="text-center px-4 py-3 font-label font-bold uppercase tracking-wide text-secondary text-xs">Destacado</th>
          <th class="text-right px-4 py-3 font-label font-bold uppercase tracking-wide text-secondary text-xs">Acciones</th>
        </tr>
      </thead>
      <tbody id="admin-productos-table" class="divide-y divide-outline-variant"></tbody>
    </table>
    <div id="admin-empty" class="hidden py-16 text-center text-secondary font-body text-sm">
      No hay productos. <button id="btn-nuevo-empty" class="text-primary-container font-bold hover:underline">Crear el primero</button>
    </div>
  </div>
</main>

<!-- MODAL Producto -->
<div id="producto-modal" class="hidden fixed inset-0 z-[200] flex items-center justify-center p-4">
  <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" id="modal-overlay"></div>
  <div class="relative bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-outline-variant z-10">
    <div class="flex items-center justify-between px-6 py-5 border-b border-outline-variant sticky top-0 bg-surface z-10">
      <h2 id="modal-title" class="font-headline font-black text-lg uppercase text-on-surface">Nuevo Producto</h2>
      <button id="modal-close" class="text-secondary hover:text-on-surface transition-colors">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <form id="form-producto" class="px-6 py-6 space-y-5">
      <input type="hidden" id="prod-id"/>
      <!-- Nombre -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Nombre *</label>
        <input type="text" id="prod-nombre" required
          class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
      </div>
      <!-- Categoría + Subcategoría -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Categoría *</label>
          <input type="text" id="prod-categoria" required list="cat-list"
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
          <datalist id="cat-list"></datalist>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Subcategoría</label>
          <input type="text" id="prod-subcategoria"
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
        </div>
      </div>
      <!-- Marca + Badge -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Marca</label>
          <input type="text" id="prod-marca"
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Badge (ej: OFERTA)</label>
          <input type="text" id="prod-badge"
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
        </div>
      </div>
      <!-- Precio + Precio antes -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Precio ($)</label>
          <input type="number" id="prod-precio" min="0" step="0.01"
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Precio anterior ($)</label>
          <input type="number" id="prod-precio-antes" min="0" step="0.01"
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
        </div>
      </div>
      <!-- Descripción -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Descripción</label>
        <textarea id="prod-descripcion" rows="3"
          class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors resize-none"></textarea>
      </div>
      <!-- Imagen -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Imagen</label>
        <div class="flex gap-3 items-start">
          <div id="img-preview" class="w-20 h-20 rounded-xl bg-surface-container-low border border-outline-variant flex items-center justify-center flex-shrink-0 overflow-hidden">
            <span class="material-symbols-outlined text-3xl text-outline">image</span>
          </div>
          <div class="flex-1">
            <input type="file" id="prod-imagen" accept="image/*"
              class="w-full text-sm text-secondary file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-primary-container/10 file:text-primary-container hover:file:bg-primary-container/20 transition-colors"/>
            <input type="text" id="prod-imagen-url" placeholder="O pegar URL de imagen"
              class="mt-2 w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
          </div>
        </div>
      </div>
      <!-- Switches -->
      <div class="flex gap-6">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="prod-destacado" class="w-4 h-4 accent-[#2563EB]"/>
          <span class="text-sm font-body text-on-surface">Destacado</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="prod-stock" checked class="w-4 h-4 accent-[#2563EB]"/>
          <span class="text-sm font-body text-on-surface">En stock</span>
        </label>
      </div>
      <!-- Error -->
      <p id="form-error" class="text-error text-xs hidden"></p>
      <!-- Botones -->
      <div class="flex gap-3 justify-end pt-2 border-t border-outline-variant">
        <button type="button" id="btn-cancel-modal"
          class="px-5 py-2.5 border border-outline-variant rounded-xl text-sm font-body text-secondary hover:bg-surface-container transition-colors">
          Cancelar
        </button>
        <button type="submit" id="btn-save-modal"
          class="px-6 py-2.5 bg-primary-container text-white rounded-xl text-sm font-bold font-headline uppercase hover:opacity-90 transition-opacity">
          Guardar
        </button>
      </div>
    </form>
  </div>
</div>

<script src="admin.js" defer></script>
</body>
</html>
```

- [ ] **Step 8.2: Crear `admin.js`**

```js
// admin.js — CRUD de productos en panel admin
document.addEventListener('DOMContentLoaded', async () => {
  // Guard: solo admins
  const user = await Auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }
  const perfil = await Perfiles.get(user.id);
  if (perfil?.rol !== 'admin') {
    document.getElementById('admin-guard').classList.remove('hidden');
    return;
  }

  let allProductos = [];
  let editingId    = null;

  // Logout
  document.getElementById('admin-logout').addEventListener('click', async () => {
    await Auth.signOut(); window.location.href = 'index.html';
  });

  // Cargar productos
  async function loadProductos() {
    const { data } = await _supabase.from('productos').select('*').order('created_at', { ascending: false });
    allProductos = data || [];
    renderStats();
    renderTabla(allProductos);
    populateCatFilter();
  }

  function renderStats() {
    document.getElementById('stat-total').textContent        = allProductos.length;
    document.getElementById('stat-destacados').textContent   = allProductos.filter(p => p.destacado).length;
    document.getElementById('stat-sin-precio').textContent   = allProductos.filter(p => !p.precio).length;
    const cats = new Set(allProductos.map(p => p.categoria));
    document.getElementById('stat-categorias').textContent   = cats.size;

    // Llenar datalist de categorías en el form
    const dl = document.getElementById('cat-list');
    dl.innerHTML = [...cats].map(c => `<option value="${c}"/>`).join('');
  }

  function populateCatFilter() {
    const sel = document.getElementById('admin-filter-cat');
    const cats = [...new Set(allProductos.map(p => p.categoria))].sort();
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  function renderTabla(productos) {
    const tbody = document.getElementById('admin-productos-table');
    document.getElementById('admin-empty').classList.toggle('hidden', productos.length > 0);
    if (productos.length === 0) { tbody.innerHTML = ''; return; }
    tbody.innerHTML = productos.map(p => `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-surface-container flex-shrink-0 overflow-hidden border border-outline-variant">
              ${p.imagen_url
                ? `<img src="${p.imagen_url}" class="w-full h-full object-cover"/>`
                : `<div class="w-full h-full flex items-center justify-center"><span class="material-symbols-outlined text-sm text-outline">inventory_2</span></div>`}
            </div>
            <div>
              <p class="font-bold text-on-surface text-sm">${p.nombre}</p>
              ${p.marca_rep ? `<p class="text-xs text-secondary">${p.marca_rep}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="px-4 py-3 hidden md:table-cell">
          <span class="text-xs bg-surface-container px-2 py-1 rounded-lg font-label text-secondary">${p.categoria}</span>
        </td>
        <td class="px-4 py-3 hidden sm:table-cell text-sm font-body ${p.precio ? 'text-on-surface font-bold' : 'text-secondary italic'}">
          ${p.precio ? `$${Number(p.precio).toLocaleString('es-AR')}` : 'Sin precio'}
        </td>
        <td class="px-4 py-3 text-center">
          <span class="material-symbols-outlined text-sm ${p.destacado ? 'text-primary-container' : 'text-outline-variant'}"
            style="font-variation-settings:'FILL' ${p.destacado ? 1 : 0};">star</span>
        </td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-2">
            <button onclick="openModal('${p.id}')"
              class="text-secondary hover:text-primary-container transition-colors p-1.5 rounded-lg hover:bg-surface-container">
              <span class="material-symbols-outlined text-sm">edit</span>
            </button>
            <button onclick="deleteProducto('${p.id}', '${p.nombre.replace(/'/g, "\\'")}')"
              class="text-secondary hover:text-error transition-colors p-1.5 rounded-lg hover:bg-surface-container">
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </td>
      </tr>`).join('');
  }

  // Filtros
  document.getElementById('admin-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const cat = document.getElementById('admin-filter-cat').value;
    filtrar(q, cat);
  });
  document.getElementById('admin-filter-cat').addEventListener('change', e => {
    const q = document.getElementById('admin-search').value.toLowerCase();
    filtrar(q, e.target.value);
  });
  function filtrar(q, cat) {
    let r = allProductos;
    if (q)   r = r.filter(p => p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
    if (cat) r = r.filter(p => p.categoria === cat);
    renderTabla(r);
  }

  // Modal
  function openModal(id = null) {
    editingId = id;
    const prod = id ? allProductos.find(p => p.id === id) : null;
    document.getElementById('modal-title').textContent = id ? 'Editar Producto' : 'Nuevo Producto';
    document.getElementById('prod-id').value          = prod?.id || '';
    document.getElementById('prod-nombre').value      = prod?.nombre || '';
    document.getElementById('prod-categoria').value   = prod?.categoria || '';
    document.getElementById('prod-subcategoria').value= prod?.subcategoria || '';
    document.getElementById('prod-marca').value       = prod?.marca_rep || '';
    document.getElementById('prod-badge').value       = prod?.badge || '';
    document.getElementById('prod-precio').value      = prod?.precio || '';
    document.getElementById('prod-precio-antes').value= prod?.precio_antes || '';
    document.getElementById('prod-descripcion').value = prod?.descripcion || '';
    document.getElementById('prod-imagen-url').value  = prod?.imagen_url || '';
    document.getElementById('prod-destacado').checked = prod?.destacado || false;
    document.getElementById('prod-stock').checked     = prod?.stock ?? true;
    document.getElementById('form-error').classList.add('hidden');

    const preview = document.getElementById('img-preview');
    preview.innerHTML = prod?.imagen_url
      ? `<img src="${prod.imagen_url}" class="w-full h-full object-cover"/>`
      : `<span class="material-symbols-outlined text-3xl text-outline">image</span>`;

    document.getElementById('producto-modal').classList.remove('hidden');
  }
  window.openModal = openModal;

  function closeModal() {
    document.getElementById('producto-modal').classList.add('hidden');
    editingId = null;
  }

  document.getElementById('modal-close').addEventListener('click',   closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-nuevo-producto').addEventListener('click', () => openModal());
  document.getElementById('btn-nuevo-empty')?.addEventListener('click', () => openModal());

  // Preview imagen
  document.getElementById('prod-imagen').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('img-preview').innerHTML = `<img src="${ev.target.result}" class="w-full h-full object-cover"/>`;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('prod-imagen-url').addEventListener('input', e => {
    const url = e.target.value;
    if (url) document.getElementById('img-preview').innerHTML = `<img src="${url}" class="w-full h-full object-cover" onerror="this.src=''"/>`;
  });

  // Submit form
  document.getElementById('form-producto').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-modal');
    const errEl = document.getElementById('form-error');
    btn.textContent = 'Guardando...'; btn.disabled = true;
    errEl.classList.add('hidden');

    // Subir imagen si hay archivo nuevo
    let imagenUrl = document.getElementById('prod-imagen-url').value;
    const fileInput = document.getElementById('prod-imagen');
    if (fileInput.files[0]) {
      const { url, error } = await Productos.uploadImagen(fileInput.files[0]);
      if (error) { errEl.textContent = 'Error subiendo imagen: ' + error.message; errEl.classList.remove('hidden'); btn.textContent = 'Guardar'; btn.disabled = false; return; }
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
      imagen_url:   imagenUrl || null,
      destacado:    document.getElementById('prod-destacado').checked,
      stock:        document.getElementById('prod-stock').checked,
    };

    const { error } = editingId
      ? await Productos.update(editingId, payload)
      : await Productos.create(payload);

    btn.textContent = 'Guardar'; btn.disabled = false;
    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
    closeModal();
    await loadProductos();
  });

  // Eliminar
  window.deleteProducto = async (id, nombre) => {
    if (!confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) return;
    const { error } = await Productos.delete(id);
    if (error) { alert('Error al eliminar: ' + error.message); return; }
    await loadProductos();
  };

  // Cargar al inicio
  await loadProductos();
});
```

---

## Chunk 6: Scroll tipo Apple (index.html)

### Task 9: Scroll animado tipo Apple en la sección hero de `index.html`

**Archivos:**
- Modificar: `index.html`
- Modificar: `shared.css`

- [ ] **Step 9.1: Agregar CSS en `shared.css`**

```css
/* ── Apple-style scroll animations ─────────────────────────────────────────── */
.reveal {
  opacity: 0;
  transform: translateY(40px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
.reveal-left {
  opacity: 0;
  transform: translateX(-40px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal-left.visible {
  opacity: 1;
  transform: translateX(0);
}
.reveal-right {
  opacity: 0;
  transform: translateX(40px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal-right.visible {
  opacity: 1;
  transform: translateX(0);
}
/* Stagger: retraso por índice */
.reveal-delay-1 { transition-delay: 0.1s; }
.reveal-delay-2 { transition-delay: 0.2s; }
.reveal-delay-3 { transition-delay: 0.3s; }
.reveal-delay-4 { transition-delay: 0.4s; }
.reveal-delay-5 { transition-delay: 0.5s; }

/* Hero sticky scroll (sección hero) */
.hero-sticky-wrap {
  position: relative;
}
```

- [ ] **Step 9.2: Crear `scroll-animations.js`**

```js
// scroll-animations.js — Intersection Observer para animaciones tipo Apple
(function () {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target); // solo una vez
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  function initReveal() {
    document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => io.observe(el));
  }

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReveal);
  } else {
    initReveal();
  }
  // Re-observar si se agregan elementos dinámicamente (productos JS)
  const mo = new MutationObserver(() => {
    document.querySelectorAll('.reveal:not(.visible), .reveal-left:not(.visible), .reveal-right:not(.visible)')
      .forEach(el => io.observe(el));
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
```

- [ ] **Step 9.3: Agregar clases `reveal` a las secciones en `index.html`**

Agregar en estas secciones (ejemplos, aplicar criterio similar al resto):

```html
<!-- Hero - texto principal -->
<div class="space-y-7 reveal-left">

<!-- Hero - mapa -->
<div class="relative hidden lg:block reveal-right">

<!-- Trust badges — cada item -->
<div class="flex items-center gap-4 group reveal reveal-delay-1">
<div class="flex items-center gap-4 group reveal reveal-delay-2">
<div class="flex items-center gap-4 group reveal reveal-delay-3">
<div class="flex items-center gap-4 group reveal reveal-delay-4">

<!-- Categorías section -->
<h2 class="... reveal">

<!-- Productos destacados section -->
<div class="flex justify-between items-end mb-10 reveal">

<!-- Por qué elegirnos — imagen -->
<div class="relative reveal-left">
<!-- Por qué elegirnos — lista -->
<div class="reveal-right">

<!-- Sección números — texto -->
<div class="relative z-10 reveal-left">

<!-- Reseñas header -->
<div class="text-center mb-12 reveal">
```

- [ ] **Step 9.4: Agregar `scroll-animations.js` en `index.html`, `catalogo.html`, `contacto.html`**

```html
<script src="scroll-animations.js" defer></script>
```

---

## Chunk 7: `login.html` standalone

### Task 10: Página de login standalone (para redirect desde admin)

**Archivos:**
- Crear: `login.html`

- [ ] **Step 10.1: Crear `login.html`**

```html
<!DOCTYPE html>
<html lang="es" class="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Ingresar — DANICHAP</title>
<script src="https://cdn.tailwindcss.com?plugins=forms"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700;900&family=Inter:wght@400;500&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="shared.css"/>
<script>/* mismo tailwind.config que index.html */</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="supabase.js"></script>
</head>
<body class="bg-surface font-body text-on-surface min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <a href="index.html" class="flex items-center gap-2 mb-10 justify-center">
      <!-- Logo SVG igual al de index.html -->
      <span class="font-headline font-black text-2xl uppercase text-on-surface">DANICHAP</span>
    </a>
    <div class="bg-surface border border-outline-variant rounded-2xl shadow-sm p-8">
      <h1 class="font-headline font-black text-xl uppercase text-on-surface mb-6">Ingresar</h1>
      <form id="login-form" class="space-y-4">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Email</label>
          <input type="email" name="email" required autofocus
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wide text-secondary mb-1.5">Contraseña</label>
          <input type="password" name="password" required
            class="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary-container transition-colors"/>
        </div>
        <p id="login-error" class="text-error text-xs hidden"></p>
        <button type="submit"
          class="w-full bg-primary-container text-white py-3 rounded-xl font-bold font-headline uppercase text-sm hover:opacity-90 transition-opacity">
          Entrar
        </button>
      </form>
    </div>
    <p class="text-center text-secondary text-xs font-body mt-6">
      <a href="index.html" class="hover:text-on-surface transition-colors">← Volver al sitio</a>
    </p>
  </div>
  <script>
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      const btn = e.target.querySelector('button');
      btn.textContent = 'Entrando...'; btn.disabled = true;
      const { error } = await Auth.signIn(fd.get('email'), fd.get('password'));
      if (error) {
        errEl.textContent = 'Email o contraseña incorrectos.';
        errEl.classList.remove('hidden');
        btn.textContent = 'Entrar'; btn.disabled = false;
        return;
      }
      // Redirect a admin si tiene rol admin, sino a index
      const user = await Auth.getUser();
      const perfil = await Perfiles.get(user.id);
      window.location.href = perfil?.rol === 'admin' ? 'admin.html' : 'index.html';
    });
  </script>
</body>
</html>
```

---

## Orden de implementación

1. **Task 1** — Supabase setup + `supabase.js`
2. **Task 2** — `auth.js`
3. **Task 3 + 4** — `cart.js` + `cart-ui.js`
4. **Task 5 + 6** — `nav.js` + scripts en `<head>`
5. **Task 7** — Botón carrito en `catalogo.js`/`catalogo.html`
6. **Task 8** — `admin.html` + `admin.js`
7. **Task 9** — Scroll animations
8. **Task 10** — `login.html`

---

## Notas importantes

- **Variables de entorno**: `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `supabase.js` deben ser los valores reales del proyecto Supabase. No commitear las keys en git público.
- **Primer admin**: El primer usuario debe ser promovido manualmente con SQL en el dashboard de Supabase.
- **Migración de productos**: Los productos de `data.js` pueden importarse masivamente con un script SQL INSERT o usando el CSV import de Supabase.
- **Orden de scripts en HTML**: `supabase.js` → `auth.js` → `cart.js` → `cart-ui.js` → `data.js` (si aún se usa) → scripts específicos de página → `nav.js`
