// Single animation controller — call initAnimations() once after mount.
// Returns a cleanup function.

const EASING = 'cubic-bezier(0.16,1,0.3,1)'

export function initAnimations() {
  // Respect user preference — reveal everything instantly
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('[data-animate]').forEach(el => el.classList.add('is-visible'))
    return () => {}
  }

  const cleanups = [
    watchScrollAnimations(),
    watchNavScroll(),
    watchActiveSections(),
  ]
  return () => cleanups.forEach(fn => fn?.())
}

// ── scroll-triggered entry animations ────────────────────────────────────────
function watchScrollAnimations() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return
      const el = entry.target

      // For stagger containers, set per-child delays before revealing
      if (el.dataset.animate === 'stagger-children') {
        const gap = parseInt(el.dataset.staggerDelay ?? '100')
        Array.from(el.children).forEach((child, i) => {
          child.style.transitionDelay = `${i * gap}ms`
        })
      }

      // Double-rAF ensures the browser paints initial (hidden) state first
      requestAnimationFrame(() =>
        requestAnimationFrame(() => el.classList.add('is-visible'))
      )
      obs.unobserve(el)
    })
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' })

  document.querySelectorAll('[data-animate]').forEach(el => obs.observe(el))
  return () => obs.disconnect()
}

// ── nav background on scroll ──────────────────────────────────────────────────
function watchNavScroll() {
  const nav = document.querySelector('[data-nav]')
  if (!nav) return

  const tick = () => nav.classList.toggle('nav-scrolled', window.scrollY > 100)
  window.addEventListener('scroll', tick, { passive: true })
  tick() // set initial state
  return () => window.removeEventListener('scroll', tick)
}

// ── active nav link underline ─────────────────────────────────────────────────
function watchActiveSections() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      const link = document.querySelector(`a[data-nav-link="#${target.id}"]`)
      if (link) link.classList.toggle('nav-link-active', isIntersecting)
    })
  }, { threshold: 0.35 })

  ;['how', 'incidents', 'anatomy', 'verdicts'].forEach(id => {
    const el = document.getElementById(id)
    if (el) obs.observe(el)
  })
  return () => obs.disconnect()
}

// ── count-up for stats numbers ────────────────────────────────────────────────
export function countUp(from, to, duration, onUpdate) {
  const easeOutQuart = t => 1 - Math.pow(1 - t, 4)
  const start = performance.now()
  const range = to - from

  function tick(now) {
    const p = Math.min((now - start) / duration, 1)
    onUpdate(Math.round(from + range * easeOutQuart(p)))
    if (p < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
