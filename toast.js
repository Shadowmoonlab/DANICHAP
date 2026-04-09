/* toast.js — Sistema de notificaciones premium estilo Sonner — DANICHAP */
(function () {
  'use strict';

  /* ── Contenedor ────────────────────────────────────────────────────────── */
  let container = null;
  function getContainer() {
    if (container && document.contains(container)) return container;
    container = document.createElement('div');
    container.id = 'toast-container';
    Object.assign(container.style, {
      position:      'fixed',
      bottom:        '24px',
      right:         '24px',
      left:          'auto',
      zIndex:        '9999',
      display:       'flex',
      flexDirection: 'column-reverse',
      gap:           '10px',
      alignItems:    'flex-end',
      pointerEvents: 'none',
      maxWidth:      'calc(100vw - 32px)',
    });
    // Mobile: center-bottom
    const mq = window.matchMedia('(max-width: 640px)');
    const applyMq = (e) => {
      if (e.matches) {
        container.style.right  = '0';
        container.style.left   = '0';
        container.style.bottom = '16px';
        container.style.alignItems = 'center';
      } else {
        container.style.right  = '24px';
        container.style.left   = 'auto';
        container.style.bottom = '24px';
        container.style.alignItems = 'flex-end';
      }
    };
    mq.addEventListener('change', applyMq);
    applyMq(mq);
    document.body.appendChild(container);
    return container;
  }

  /* ── Iconos SVG inline ─────────────────────────────────────────────────── */
  const ICONS = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    loading: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:toast-spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
  };

  /* ── Colores ────────────────────────────────────────────────────────────── */
  const STYLES = {
    success: { bg: '#001e4b', border: '#1a5aaa', icon: '#60c8a0', text: '#f0f4ff' },
    error:   { bg: '#2d0a0a', border: '#7f1d1d', icon: '#f87171', text: '#fff1f1' },
    info:    { bg: '#001e4b', border: '#1a5aaa', icon: '#93c5fd', text: '#f0f4ff' },
    warning: { bg: '#1c1200', border: '#78350f', icon: '#fbbf24', text: '#fffbeb' },
    loading: { bg: '#001e4b', border: '#1a5aaa', icon: '#93c5fd', text: '#f0f4ff' },
  };

  /* ── Keyframes (inyectar una sola vez) ─────────────────────────────────── */
  if (!document.getElementById('toast-styles')) {
    const s = document.createElement('style');
    s.id = 'toast-styles';
    s.textContent = `
      @keyframes toast-in {
        from { opacity:0; transform:translateY(12px) scale(.96); }
        to   { opacity:1; transform:translateY(0)    scale(1);   }
      }
      @keyframes toast-out {
        from { opacity:1; transform:translateY(0)    scale(1);   max-height:80px; margin:0; }
        to   { opacity:0; transform:translateY(8px)  scale(.95); max-height:0;   margin:0; }
      }
      @keyframes toast-spin { to { transform:rotate(360deg); } }
      #toast-container > div {
        animation: toast-in .28s cubic-bezier(.16,1,.3,1) forwards;
      }
      #toast-container > div.toast-hiding {
        animation: toast-out .22s ease-in forwards;
      }
    `;
    document.head.appendChild(s);
  }

  let toastId = 0;

  /* ── Crear toast ─────────────────────────────────────────────────────────── */
  function create(msg, type = 'success', opts = {}) {
    const { duration = type === 'loading' ? 0 : 4000, id: customId } = opts;
    const c = getContainer();

    // Si hay customId, actualizar existente
    if (customId) {
      const existing = document.getElementById('toast-' + customId);
      if (existing) {
        existing.querySelector('.toast-msg').textContent = msg;
        const iconEl = existing.querySelector('.toast-icon');
        const s = STYLES[type] || STYLES.info;
        iconEl.innerHTML = ICONS[type] || ICONS.info;
        iconEl.style.color = s.icon;
        existing.style.borderColor = s.border;
        existing.style.background  = s.bg;
        existing.style.color       = s.text;
        return customId;
      }
    }

    const id   = customId || ++toastId;
    const s    = STYLES[type] || STYLES.info;
    const el   = document.createElement('div');
    el.id      = 'toast-' + id;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    Object.assign(el.style, {
      display:       'flex',
      alignItems:    'center',
      gap:           '10px',
      padding:       '12px 16px',
      borderRadius:  '12px',
      border:        `1px solid ${s.border}`,
      background:    s.bg,
      color:         s.text,
      fontSize:      '13.5px',
      fontWeight:    '600',
      fontFamily:    'Inter, system-ui, sans-serif',
      lineHeight:    '1.4',
      boxShadow:     '0 8px 32px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.2)',
      backdropFilter:'blur(12px)',
      pointerEvents: 'all',
      cursor:        'pointer',
      userSelect:    'none',
      minWidth:      '220px',
      maxWidth:      'min(380px, calc(100vw - 48px))',
      position:      'relative',
      overflow:      'hidden',
    });

    // Shimmer bar de progreso
    if (duration > 0) {
      const bar = document.createElement('div');
      Object.assign(bar.style, {
        position:        'absolute',
        bottom:          '0',
        left:            '0',
        height:          '2px',
        background:      s.icon,
        width:           '100%',
        transformOrigin: 'left',
        transition:      `transform ${duration}ms linear`,
        transform:       'scaleX(1)',
        opacity:         '0.6',
      });
      el.appendChild(bar);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { bar.style.transform = 'scaleX(0)'; });
      });
    }

    // Icono
    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.style.color     = s.icon;
    iconEl.style.flexShrink = '0';
    iconEl.style.display   = 'flex';
    iconEl.innerHTML       = ICONS[type] || ICONS.info;
    el.appendChild(iconEl);

    // Texto
    const txt = document.createElement('span');
    txt.className = 'toast-msg';
    txt.textContent = msg;
    txt.style.flex  = '1';
    el.appendChild(txt);

    // Botón cerrar
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    Object.assign(closeBtn.style, {
      background: 'none', border: 'none', color: s.text,
      opacity: '0.5', fontSize: '18px', lineHeight: '1',
      cursor: 'pointer', padding: '0 0 0 4px', flexShrink: '0',
    });
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(id); });
    el.appendChild(closeBtn);

    el.addEventListener('click', () => dismiss(id));
    c.appendChild(el);

    let timer = null;
    if (duration > 0) {
      timer = setTimeout(() => dismiss(id), duration);
    }
    el._timer = timer;

    return id;
  }

  function dismiss(id) {
    const el = document.getElementById('toast-' + id);
    if (!el || el.classList.contains('toast-hiding')) return;
    clearTimeout(el._timer);
    el.classList.add('toast-hiding');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  /* ── API pública ─────────────────────────────────────────────────────────── */
  window.toast = {
    success: (msg, opts) => create(msg, 'success', opts),
    error:   (msg, opts) => create(msg, 'error',   opts),
    info:    (msg, opts) => create(msg, 'info',     opts),
    warning: (msg, opts) => create(msg, 'warning',  opts),
    loading: (msg, opts) => create(msg, 'loading',  { duration: 0, ...opts }),
    dismiss,
    // Compat con showToast(msg, 'success'/'error') del admin viejo
    show:    (msg, type = 'success') => create(msg, type === 'error' ? 'error' : 'success'),
  };

  // Alias global para compatibilidad con admin.js showToast()
  window.showToast = (msg, type = 'success') => window.toast.show(msg, type);

})();
