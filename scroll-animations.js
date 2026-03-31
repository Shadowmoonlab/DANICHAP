// scroll-animations.js — Apple-style reveal con Intersection Observer
(function () {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.10, rootMargin: '0px 0px -30px 0px' });

  function observe() {
    document.querySelectorAll('.reveal, .reveal-left, .reveal-right')
      .forEach(el => { if (!el.classList.contains('visible')) io.observe(el); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  } else {
    observe();
  }

  // Re-observar elementos agregados dinámicamente (productos por JS)
  new MutationObserver(observe).observe(document.body, { childList: true, subtree: true });
})();
