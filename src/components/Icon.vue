<script setup>
// Small stroke icon set (24x24, currentColor) used instead of text glyphs,
// which render inconsistently across platforms (some do not draw ▭ at all).
defineProps({ name: { type: String, required: true }, size: { type: [Number, String], default: 18 } })
</script>

<template>
  <svg
    class="ui-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'funnel'"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" /></template>
    <template v-else-if="name === 'layers'"><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></template>
    <template v-else-if="name === 'area'"><rect x="4" y="5" width="15" height="13" rx="1.5" stroke-dasharray="3 3" /><circle cx="19" cy="18" r="2" fill="currentColor" stroke="none" /></template>
    <template v-else-if="name === 'flame'"><path fill="currentColor" stroke="none" d="M12 2c.6 3.2-1.2 4.6-2.7 6.3C7.8 10 6.5 11.7 6.5 14a5.5 5.5 0 0 0 11 0c0-2-1-3.5-2-4.6-.2 1.2-.8 2-1.7 2.4.5-3.5-.2-6.8-1.8-9.8z" /></template>
    <template v-else-if="name === 'download'"><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></template>
    <template v-else-if="name === 'refresh'"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></template>
    <template v-else-if="name === 'route'"><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" /></template>
    <template v-else-if="name === 'close'"><path d="M6 6l12 12M18 6 6 18" /></template>
    <template v-else-if="name === 'edit'"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></template>
    <template v-else-if="name === 'trash'"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></template>
    <template v-else-if="name === 'chevron-left'"><path d="m15 6-6 6 6 6" /></template>
    <template v-else-if="name === 'chevron-right'"><path d="m9 6 6 6-6 6" /></template>
    <template v-else-if="name === 'chevron-up'"><path d="m6 15 6-6 6 6" /></template>
    <template v-else-if="name === 'chevron-down'"><path d="m6 9 6 6 6-6" /></template>
    <template v-else-if="name === 'map'"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></template>
  </svg>
</template>

<style scoped>
.ui-icon { display: block; flex-shrink: 0; }
</style>
