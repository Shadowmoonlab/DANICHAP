// cart.js — Estado del carrito (local guest + Supabase sync)
let _items     = [];
let _listeners = [];

const Cart = {
  get items()  { return _items; },
  get count()  { return _items.reduce((s, i) => s + i.cantidad, 0); },
  get total()  { return _items.reduce((s, i) => s + (i.productos?.precio || 0) * i.cantidad, 0); },

  subscribe(fn) { _listeners.push(fn); },
  _notify()     { _listeners.forEach(fn => fn(_items)); },

  async add(producto) {
    const existing = _items.find(i => i.producto_id === producto.id);
    if (existing) {
      existing.cantidad++;
    } else {
      _items.push({ producto_id: producto.id, cantidad: 1, productos: producto });
    }
    this._notify();
    this._saveLocal();

    const user = typeof AuthUI !== 'undefined' ? AuthUI.user : null;
    if (user) await CarritoDB.add(user.id, producto.id);
  },

  async remove(productoId) {
    _items = _items.filter(i => i.producto_id !== productoId);
    this._notify();
    this._saveLocal();
    const user = typeof AuthUI !== 'undefined' ? AuthUI.user : null;
    if (user) await CarritoDB.remove(user.id, productoId);
  },

  async updateCantidad(productoId, cantidad) {
    if (cantidad <= 0) return this.remove(productoId);
    const item = _items.find(i => i.producto_id === productoId);
    if (item) { item.cantidad = cantidad; this._notify(); this._saveLocal(); }
    const user = typeof AuthUI !== 'undefined' ? AuthUI.user : null;
    if (user) await CarritoDB.updateCantidad(user.id, productoId, cantidad);
  },

  async clear() {
    _items = [];
    this._notify();
    this._saveLocal();
    const user = typeof AuthUI !== 'undefined' ? AuthUI.user : null;
    if (user) await CarritoDB.clear(user.id);
  },

  // Llamado al hacer login: trae los items de DB y fusiona con local
  async syncFromDB() {
    const user = typeof AuthUI !== 'undefined' ? AuthUI.user : null;
    if (!user) return;

    const dbItems = await CarritoDB.get(user.id);

    // Migrar items locales no sincronizados
    const local = this._loadLocal();
    for (const localItem of local) {
      const yaEnDB = dbItems.find(i => i.producto_id === localItem.producto_id);
      if (!yaEnDB) {
        const prod = await Productos.get(localItem.producto_id);
        if (prod) {
          dbItems.push({ producto_id: prod.id, cantidad: localItem.cantidad, productos: prod });
          await CarritoDB.add(user.id, prod.id, localItem.cantidad);
        }
      }
    }
    _items = dbItems;
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
    try { return JSON.parse(localStorage.getItem('danichap_cart') || '[]'); }
    catch { return []; }
  },

  async init() {
    const user = typeof AuthUI !== 'undefined' ? AuthUI.user : null;
    if (user) {
      await this.syncFromDB();
    } else {
      const local = this._loadLocal();
      for (const item of local) {
        const prod = await Productos.get(item.producto_id).catch(() => null);
        if (prod) _items.push({ producto_id: prod.id, cantidad: item.cantidad, productos: prod });
      }
      this._notify();
    }
  },
};
