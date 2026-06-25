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
