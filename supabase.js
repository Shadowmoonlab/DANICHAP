// supabase.js — Cliente Supabase singleton + helpers
const SUPABASE_URL     = 'https://stambpkmtwtnhfjmxztl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zZnI3YWriVpzNiqKpRMcnQ_a5hv_Y7m';

const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── Auth ─────────────────────────────────────────────────────────────────── */
const Auth = {
  async getUser() {
    const { data } = await _supabase.auth.getUser();
    return data.user;
  },
  async getSession() {
    const { data } = await _supabase.auth.getSession();
    return data.session;
  },
  async signIn(email, password) {
    return _supabase.auth.signInWithPassword({ email, password });
  },
  async signUp(email, password, nombre) {
    return _supabase.auth.signUp({
      email, password,
      options: { data: { nombre } },
    });
  },
  async signOut() { return _supabase.auth.signOut(); },
  onAuthChange(cb) { return _supabase.auth.onAuthStateChange(cb); },
};

/* ── Perfiles ─────────────────────────────────────────────────────────────── */
const Perfiles = {
  async get(userId) {
    const { data } = await _supabase
      .from('perfiles').select('*').eq('id', userId).single();
    return data;
  },
  async isAdmin(userId) {
    const p = await Perfiles.get(userId);
    return p?.rol === 'admin';
  },
};

/* ── Productos ────────────────────────────────────────────────────────────── */
const Productos = {
  async list(filtros = {}) {
    let q = _supabase.from('productos').select('*').eq('stock', true);
    if (filtros.categoria)  q = q.eq('categoria', filtros.categoria);
    if (filtros.destacado)  q = q.eq('destacado', true);
    if (filtros.busqueda)   q = q.ilike('nombre', `%${filtros.busqueda}%`);
    const { data, error } = await q.order('created_at', { ascending: false });
    return { data: data || [], error };
  },
  async get(id) {
    const { data } = await _supabase
      .from('productos').select('*').eq('id', id).single();
    return data;
  },
  async create(prod) {
    return _supabase.from('productos').insert(prod).select().single();
  },
  async update(id, updates) {
    return _supabase.from('productos')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
  },
  async delete(id) {
    return _supabase.from('productos').delete().eq('id', id);
  },
  async uploadImagen(file) {
    const ext  = file.name.split('.').pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await _supabase.storage
      .from('productos').upload(path, file, { upsert: false });
    if (error) return { url: null, error };
    const { data } = _supabase.storage.from('productos').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  },
};

/* ── Carrito DB ───────────────────────────────────────────────────────────── */
const CarritoDB = {
  async get(userId) {
    const { data } = await _supabase
      .from('carrito')
      .select('*, productos(*)')
      .eq('user_id', userId);
    return data || [];
  },
  async add(userId, productoId, cantidad = 1) {
    // Upsert: si ya existe, sumar cantidad
    const { data: existing } = await _supabase
      .from('carrito')
      .select('cantidad')
      .eq('user_id', userId)
      .eq('producto_id', productoId)
      .single();

    if (existing) {
      return _supabase.from('carrito')
        .update({ cantidad: existing.cantidad + 1 })
        .eq('user_id', userId)
        .eq('producto_id', productoId);
    }
    return _supabase.from('carrito')
      .insert({ user_id: userId, producto_id: productoId, cantidad });
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
