// Infinite scroll for long lists: render `limit` items and grow it by `step`
// whenever the sentinel element (placed after the list) comes near the screen.
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'

export function useInfiniteList(total, step = 60) {
  const limit = ref(step)
  const sentinel = ref(null)
  let io = null

  function check() {
    const el = sentinel.value
    if (!el || limit.value >= total.value) return
    const r = el.getBoundingClientRect()
    if (r.top < window.innerHeight + 800) limit.value += step
  }
  function start() {
    io?.disconnect()
    if (typeof IntersectionObserver === 'undefined' || !sentinel.value) return
    io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) check() }, { rootMargin: '800px 0px' })
    io.observe(sentinel.value)
  }
  watch(sentinel, start)
  // after the list grows, the sentinel may still be in view: look again
  watch(limit, async () => { await nextTick(); start(); check() })
  onBeforeUnmount(() => io?.disconnect())
  const reset = () => { limit.value = step }
  return { limit, sentinel, reset }
}
