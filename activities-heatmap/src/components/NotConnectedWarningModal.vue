<script setup>
import { useAuthStore } from '../stores/auth'
import { t } from '../i18n'

const authStore = useAuthStore()
const emit = defineEmits(['continue', 'cancel'])
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="dialog">
      <h2>{{ t('warn.title') }}</h2>
      <p>
        {{ t('warn.body1') }} <strong>{{ t('warn.body2') }}</strong>.
      </p>
      <p class="hint">{{ t('warn.hint') }}</p>

      <div class="actions">
        <button class="btn ghost" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button
          v-if="authStore.configured"
          class="btn secondary"
          @click="authStore.signIn()"
        >
          {{ t('nav.connect') }}
        </button>
        <button class="btn primary" @click="emit('continue')">{{ t('warn.continue') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(20, 24, 20, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.dialog {
  background: var(--surface);
  border-radius: var(--radius-md);
  padding: 28px;
  max-width: 440px;
  width: 100%;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.4);
}
h2 { font-size: 19px; margin: 0 0 14px; }
p {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-dim);
  margin: 0 0 12px;
}
p.hint { color: var(--text-muted); font-size: 12.5px; }
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 20px;
}
.btn {
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  font-weight: 600;
  border: 1px solid transparent;
}
.btn.primary { background: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: var(--accent-strong); }
.btn.secondary {
  background: transparent;
  border-color: var(--accent-strong);
  color: var(--accent-strong);
}
.btn.secondary:hover { background: var(--accent-soft); }
.btn.ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-dim);
}
.btn.ghost:hover { border-color: var(--danger); color: var(--danger); }
</style>
