<script setup>
import { useAuthStore } from '../stores/auth'
import { t } from '../i18n'

const authStore = useAuthStore()
</script>

<template>
  <div class="overlay">
    <div class="dialog">
      <h2>{{ t('conflict.title') }}</h2>
      <p>
        {{ t('conflict.signedAs') }} <strong>{{ authStore.user?.email }}</strong>.
        {{ t('conflict.empty') }}
        <strong>{{ t('conflict.count', { n: authStore.conflict?.pendingCount }, authStore.conflict?.pendingCount) }}</strong>
        {{ t('conflict.inSession') }}
      </p>
      <p class="hint">{{ t('conflict.hint') }}</p>
      <div class="actions">
        <button class="btn ghost" :disabled="authStore.syncing" @click="authStore.resolveConflictLogout()">
          {{ t('conflict.fresh') }}
        </button>
        <button class="btn primary" :disabled="authStore.syncing" @click="authStore.resolveConflictContinue()">
          {{ authStore.syncing ? t('conflict.saving') : t('conflict.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
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
h2 {
  font-size: 19px;
  margin: 0 0 14px;
}
p {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-dim);
  margin: 0 0 12px;
}
p.warn { color: var(--danger); font-size: 12.5px; }
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
.btn.primary {
  background: var(--accent);
  color: var(--on-accent);
}
.btn.primary:hover { background: var(--accent-strong); }
.btn.ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-dim);
}
.btn.ghost:hover { border-color: var(--danger); color: var(--danger); }
.btn:disabled { opacity: 0.6; cursor: default; }
</style>
