<script setup>
// Language picker: a compact PT / EN select. Used in the navbar and on the
// first (upload) screen, so the language can be chosen before loading data.
import { locale, setLocale, LOCALES, t } from '../i18n'
</script>

<template>
  <select
    class="lang-switch mono"
    :value="locale"
    :aria-label="t('lang.label')"
    :title="t('lang.label')"
    @change="setLocale($event.target.value)"
  >
    <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.short }}</option>
  </select>
</template>

<style scoped>
.lang-switch {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 11.5px;
  padding: 5px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.lang-switch:hover { border-color: var(--accent); color: var(--accent-strong); }
</style>
