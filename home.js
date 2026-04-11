// home.js — Renderizado dinámico de index.html
// Requiere: data.js (PROMOCIONES, CATEGORIAS, PRODUCTOS, RESENAS, wppLink)

const _esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

document.addEventListener('DOMContentLoaded', () => {

  // ─── PROMOCIONES ────────────────────────────────────────────────────────────
  const [heroPromo, ...sidePromos] = PROMOCIONES;

  document.getElementById('promo-hero').innerHTML = `
  <div class="relative h-full flex flex-col bg-gradient-to-br from-primary/80 to-slate-900 border border-primary-container/30 rounded-2xl overflow-hidden p-7 min-h-[340px]">
    <div class="absolute top-0 right-0 w-64 h-64 bg-primary-container/20 blur-[60px] rounded-full pointer-events-none"></div>
    <div class="flex items-center gap-3 mb-6 relative z-10">
      <span class="bg-primary-container text-white text-[11px] font-black px-3 py-1 rounded-full font-label uppercase tracking-widest promo-pulse">${heroPromo.badge}</span>
      <span class="text-primary-container font-bold text-sm font-label">${heroPromo.titulo}</span>
    </div>
    <div class="relative z-10 flex-1">
      <h3 class="text-white font-headline font-black text-3xl md:text-4xl uppercase leading-tight mb-3">${heroPromo.desc}</h3>
      <p class="text-slate-300 font-body text-sm mb-6">${heroPromo.detalle}</p>
      <ul class="space-y-2 mb-8">
        <li class="flex items-center gap-2 text-slate-300 text-xs font-body">
          <span class="material-symbols-outlined text-tertiary-container text-sm" style="font-variation-settings:'FILL' 1;">check_circle</span>
          Asesoramiento técnico incluido
        </li>
        <li class="flex items-center gap-2 text-slate-300 text-xs font-body">
          <span class="material-symbols-outlined text-tertiary-container text-sm" style="font-variation-settings:'FILL' 1;">check_circle</span>
          Garantía de fábrica
        </li>
        <li class="flex items-center gap-2 text-slate-300 text-xs font-body">
          <span class="material-symbols-outlined text-tertiary-container text-sm" style="font-variation-settings:'FILL' 1;">check_circle</span>
          Precio mejor que cualquier lubricentro
        </li>
      </ul>
    </div>
    <div class="relative z-10 flex items-end justify-between gap-4">
      <div>
        ${heroPromo.antes ? `<div class="text-slate-400 text-sm line-through font-body mb-1">${heroPromo.antes}</div>` : ''}
        ${heroPromo.precio
          ? `<div class="text-primary-container font-black font-headline text-4xl leading-none">${heroPromo.precio}</div>
             <div class="text-slate-400 text-xs font-label mt-1 uppercase">Precio final</div>`
          : `<div class="text-tertiary-container font-black font-headline text-xl">Precio especial</div>
             <div class="text-slate-400 text-xs font-label mt-1">Consultá sin compromiso</div>`
        }
      </div>
      <a href="https://wa.me/541123409187?text=${encodeURIComponent(heroPromo.wpp_msg)}"
         target="_blank"
         class="flex items-center gap-2 bg-tertiary-container text-on-tertiary-container px-6 py-3.5 rounded-xl font-black text-sm hover:bg-tertiary transition-colors font-headline uppercase tracking-wide shadow-xl">
        <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1;">chat</span>
        Lo quiero
      </a>
    </div>
  </div>`;

  document.getElementById('promos-side').innerHTML = sidePromos.map(p => `
  <div class="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 hover:border-primary-container/30 hover:bg-white/[0.07] transition-all group flex flex-col justify-between">
    <div>
      <div class="flex items-start justify-between gap-2 mb-3">
        <span class="text-slate-400 font-label text-[10px] uppercase tracking-widest">${p.titulo}</span>
        <span class="bg-primary-container/20 text-primary-container text-[10px] font-bold px-2 py-0.5 rounded-full font-label uppercase tracking-wide flex-shrink-0">${p.badge}</span>
      </div>
      <h4 class="text-white font-headline font-bold text-lg uppercase leading-tight mb-1">${p.desc}</h4>
      <p class="text-slate-500 text-xs font-body">${p.detalle}</p>
    </div>
    <div class="flex items-center justify-between gap-2 mt-5 pt-4 border-t border-white/10">
      <div>
        ${p.precio
          ? `<div class="text-primary-container font-black font-headline text-2xl leading-none">${p.precio}</div>
             ${p.antes ? `<div class="text-slate-600 text-xs line-through font-body">${p.antes}</div>` : ''}`
          : `<div class="text-tertiary-container font-bold text-sm font-body flex items-center gap-1">
               <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">chat</span>
               Por WhatsApp
             </div>`
        }
      </div>
      <a href="https://wa.me/541123409187?text=${encodeURIComponent(p.wpp_msg)}"
         target="_blank"
         class="flex items-center gap-1.5 bg-tertiary-container text-on-tertiary-container px-4 py-2.5 rounded-xl font-bold text-xs font-label uppercase tracking-wide hover:bg-tertiary transition-colors flex-shrink-0">
        <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">chat</span>
        Consultar
      </a>
    </div>
  </div>`).join('');

  // ─── CATEGORÍAS ─────────────────────────────────────────────────────────────
  document.getElementById('categorias-home').innerHTML = CATEGORIAS.map(c => `
  <a href="catalogo.html?cat=${c.slug}"
     class="bg-surface-container-low border border-outline-variant p-6 rounded-xl hover:bg-primary-container hover:border-primary-container transition-all cursor-pointer group flex flex-col items-center text-center gap-3">
    <span class="material-symbols-outlined text-5xl text-primary-container group-hover:text-white transition-colors">${c.icon}</span>
    <span class="text-on-surface font-headline font-bold uppercase tracking-wide text-sm group-hover:text-white transition-colors">${c.label}</span>
    <span class="text-secondary text-xs font-body group-hover:text-white/80 transition-colors">${c.subs.length} subcategorías</span>
  </a>`).join('');

  // ─── RESEÑAS ─────────────────────────────────────────────────────────────────
  const grid = document.getElementById('resenas-grid');
  const avatarBg = ['#2563EB','#16a34a','#7c3aed','#e11d48','#d97706','#0d9488','#4f46e5','#db2777','#0891b2'];
  const starsHtml = n => Array.from({length:5}, (_,i) =>
    `<span class="material-symbols-outlined text-[11px]" style="color:#FBBF24;font-variation-settings:'FILL' ${i<n?1:0.2};">star</span>`
  ).join('');
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const googleGSvg = `<svg width="14" height="14" viewBox="0 0 24 24" style="opacity:0.7;flex-shrink:0"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`;

  grid.innerHTML = RESENAS.map((r, i) => `
    <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;transition:background 0.2s;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <div style="width:32px;height:32px;border-radius:50%;background:${avatarBg[i%avatarBg.length]};display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-weight:900;color:white;font-size:12px;flex-shrink:0;">${esc(r.foto)}</div>
          <div style="min-width:0;">
            <div style="color:white;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.nombre)}</div>
            <div style="color:rgba(255,255,255,0.6);font-size:10px;font-family:Inter,sans-serif;">${esc(r.fecha)}</div>
          </div>
        </div>
        ${googleGSvg}
      </div>
      <div style="display:flex;gap:2px;">${starsHtml(r.estrellas)}</div>
      <p style="color:rgba(255,255,255,0.9);font-family:Inter,sans-serif;font-size:12px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">"${esc(r.texto)}"</p>
    </div>`).join('');

  // ─── PRODUCTOS DESTACADOS ────────────────────────────────────────────────────
  (async () => {
    const container = document.getElementById('featured-products');
    let destacados = [];
    try {
      if (typeof Productos !== 'undefined') {
        // 1. Traer todos los productos con stock
        const { data: todos } = await Productos.list();
        if (todos && todos.length > 0) {
          const marcados   = todos.filter(p => p.destacado);
          const normales   = todos.filter(p => !p.destacado);
          // 2. Priorizar destacados, completar con normales hasta 6
          const relleno    = [...marcados, ...normales].slice(0, 6);
          destacados = relleno;
        }
      }
    } catch(e) {}
    if (destacados.length === 0) {
      container.innerHTML = `<div class="col-span-full text-center py-12">
        <span class="material-symbols-outlined text-5xl text-outline-variant mb-3 block">inventory_2</span>
        <p class="text-secondary font-body text-sm mb-4">Próximamente más productos destacados.</p>
        <a href="catalogo.html" class="inline-flex items-center gap-2 text-primary-container font-bold font-headline uppercase text-sm hover:underline">
          Ver catálogo completo <span class="material-symbols-outlined text-sm">arrow_forward</span>
        </a></div>`;
      return;
    }
    container.innerHTML = destacados.map(p => {
      const cat = CATEGORIAS.find(c => c.slug === p.categoria);
      const wpp = wppLink(p.nombre, '');
      const precioHtml = p.precio
        ? `<span class="text-xl font-black text-on-surface font-headline">$ ${Number(p.precio).toLocaleString('es-AR')}</span>`
        : `<span class="text-sm font-bold text-tertiary font-body flex items-center gap-1"><span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">chat</span>Consultar</span>`;
      const hasImg = !!p.imagen_url;
      const imagenHtml = hasImg
        ? `<img src="${_esc(p.imagen_url)}" alt="${_esc(p.nombre)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy"/>`
        : `<span class="material-symbols-outlined text-7xl text-surface-dim group-hover:scale-110 transition-transform duration-500">${cat ? cat.icon : 'build'}</span>`;
      const badgeHtml = p.badge
        ? `<span class="absolute top-3 right-3 bg-primary-container text-white text-[10px] font-black px-2 py-1 uppercase tracking-widest font-label rounded">${_esc(p.badge)}</span>`
        : '';
      const marcaHtml = p.marca_rep
        ? `<span class="absolute top-3 left-3 bg-inverse-surface text-white text-[10px] font-bold px-2 py-1 uppercase tracking-widest font-label rounded">${_esc(p.marca_rep)}</span>`
        : '';
      const compat = _esc(p.compatibilidades?.[0] || 'Universal');
      const imgWrapClass = hasImg
        ? 'relative h-44 product-img-wrap'
        : 'relative h-44 bg-surface-container-low flex items-center justify-center overflow-hidden';
      return `<div class="bg-surface-container-lowest rounded-xl overflow-hidden group hover:shadow-xl transition-all duration-300 border border-surface-container flex flex-col">
        <div class="${imgWrapClass}">${imagenHtml}${badgeHtml}${marcaHtml}</div>
        <div class="p-5 flex flex-col flex-1">
          <span class="text-[10px] font-bold uppercase tracking-widest text-secondary font-label mb-1">${cat ? _esc(cat.label) : ''}</span>
          <h3 class="font-headline font-bold text-base uppercase mb-2 leading-tight">${_esc(p.nombre)}</h3>
          <p class="text-xs text-tertiary font-body mb-4">✓ ${compat}</p>
          <div class="mt-auto flex items-center justify-between gap-3">
            ${precioHtml}
            <a href="${wpp}" target="_blank" rel="noopener"
               class="flex-shrink-0 bg-tertiary-container text-on-tertiary-container px-3 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 hover:bg-tertiary transition-colors font-label uppercase">
              <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">chat</span>Consultar
            </a>
          </div>
        </div>
      </div>`;
    }).join('');
  })();

});
