<script setup>
// Renders its content only once it has come near the screen (and keeps it
// afterwards), so a long feed does not load every chart up front.
import { ref, onMounted, onBeforeUnmount } from 'vue'
defineProps({ minHeight: { type: String, default: '280px' } })
const el = ref(null)
const shown = ref(false)
let io = null
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { shown.value = true; return }
  io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { shown.value = true; io.disconnect() }
  }, { rootMargin: '700px 0px' })
  io.observe(el.value)
})
onBeforeUnmount(() => io?.disconnect())
</script>

<template>
  <div ref="el" :style="{ minHeight: shown ? undefined : minHeight }"><slot v-if="shown" /></div>
</template>
