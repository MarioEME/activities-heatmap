<script setup>
// One button that cycles auto → light → dark.
import Icon from './Icon.vue'
import { themeMode, cycleTheme } from '../utils/theme'
import { t } from '../i18n'
const ICONS = { auto: 'contrast', light: 'sun', dark: 'moon' }
</script>

<template>
  <button class="theme-switch" :title="t('theme.title', { mode: t('theme.' + themeMode) })" :aria-label="t('theme.title', { mode: t('theme.' + themeMode) })" @click="cycleTheme">
    <Icon :name="ICONS[themeMode]" :size="16" />
  </button>
</template>

<style scoped>
.theme-switch {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  padding: 5px 7px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  line-height: 0;
}
.theme-switch:hover { border-color: var(--accent); color: var(--accent-strong); }
</style>
