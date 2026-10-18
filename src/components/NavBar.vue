<script setup>
import { computed } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { useAuthStore } from '../stores/auth'
import { t, fmtDate, fmtTime } from '../i18n'
import LangSwitch from './LangSwitch.vue'

defineProps({ tab: String })
const emit = defineEmits(['update:tab'])
const store = useActivitiesStore()
const authStore = useAuthStore()

const items = ['heatmap', 'activities', 'gear', 'tags', 'trash']

const restoredLabel = computed(() => {
  if (!store.restoredAt) return null
  const d = new Date(store.restoredAt)
  return t('nav.synced', { when: `${fmtDate(d)} ${fmtTime(d)}` })
})
</script>

<template>
  <header class="navbar">
    <div class="brand">
      <span class="brand-mark">◍</span>
      <span class="brand-text">explorador<span class="brand-accent">.</span></span>
    </div>

    <nav class="tabs">
      <button
        v-for="item in items"
        :key="item"
        class="tab"
        :class="{ active: tab === item }"
        @click="emit('update:tab', item)"
      >
        {{ t('nav.' + item) }}
        <span v-if="item === 'trash' && store.trash.length" class="tab-badge mono">{{ store.trash.length }}</span>
      </button>
    </nav>

    <div class="meta">
      <span
        v-if="restoredLabel"
        class="mono restored-pill"
        :title="t('nav.restoredTitle', { label: restoredLabel })"
      >
        ↺ {{ restoredLabel }}
      </span>
      <span v-if="store.cloudSyncError" class="mono persist-warning" :title="store.cloudSyncError">{{ t('nav.cloud') }}</span>
      <span
        v-if="authStore.status !== 'signed-in'"
        class="mono persist-warning"
        :title="t('nav.notSavedTitle')"
      >
        ⚠<span class="warn-text"> {{ t('nav.notSaved') }}</span>
      </span>
      <button class="reset-btn" @click="store.openSourcePicker()">{{ t('nav.loadData') }}</button>
      <LangSwitch />

      <template v-if="authStore.configured">
        <div class="auth-sep" />
        <button v-if="authStore.status === 'signed-out'" class="signin-btn" @click="authStore.signIn()">
          {{ t('nav.connect') }}
        </button>
        <div v-else-if="authStore.status === 'signed-in'" class="user-chip" :title="authStore.user?.email">
          <img v-if="authStore.user?.photoUrl" :src="authStore.user.photoUrl" class="avatar" alt="" />
          <span class="user-name mono">{{ authStore.user?.name || authStore.user?.email }}</span>
          <span v-if="authStore.syncing" class="sync-dot" :title="t('nav.syncing')" />
          <button class="signout-btn" @click="authStore.signOut()">{{ t('nav.signOut') }}</button>
        </div>
      </template>
    </div>
  </header>
</template>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  height: var(--navbar-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: relative;
  z-index: 1000;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 18px;
  color: var(--text);
  white-space: nowrap;
}
.brand-mark {
  color: var(--accent-strong);
  font-size: 14px;
}
.brand-accent { color: var(--accent-strong); }

.tabs {
  display: flex;
  gap: 4px;
  flex: 1;
}
.tab {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  transition: color 0.15s ease, background 0.15s ease;
}
.tab:hover { color: var(--text); background: var(--surface-alt); }
.tab.active {
  color: var(--on-accent);
  background: var(--accent);
  font-weight: 600;
}
.tab-badge {
  display: inline-block;
  background: var(--danger);
  color: #fff;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 10px;
  margin-left: 4px;
  vertical-align: middle;
}
.tab.active .tab-badge { background: var(--on-accent); color: var(--accent-strong); }

.meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.restored-pill {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}
.persist-warning {
  color: var(--danger);
  font-size: 11px;
  white-space: nowrap;
}
.reset-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
}
.reset-btn:hover { border-color: var(--accent); color: var(--accent-strong); }

@media (max-width: 780px) {
  .brand-text, .restored-pill { display: none; }
}

.auth-sep {
  width: 1px;
  height: 20px;
  background: var(--border);
  flex-shrink: 0;
}
.signin-btn {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.signin-btn:hover { border-color: var(--accent); color: var(--accent-strong); }

.user-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
}
.user-name {
  font-size: 11.5px;
  color: var(--text-dim);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sync-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: sync-pulse 1s ease-in-out infinite;
}
@keyframes sync-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.signout-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  text-decoration: underline;
  padding: 0;
}
.signout-btn:hover { color: var(--danger); }

@media (max-width: 900px) {
  .user-name { display: none; }
}

/* Phones: row 1 = brand mark + actions, row 2 = tabs (scroll sideways if
   they still don't fit). Without this the bar is wider than the screen,
   which stretches the whole page and pushes fixed panels off to the right. */
@media (max-width: 720px) {
  .navbar {
    flex-wrap: wrap;
    align-content: flex-start;
    padding: 0 12px;
    gap: 0 8px;
  }
  .brand { order: 1; height: 50px; align-items: center; }
  .meta { order: 2; margin-left: auto; height: 50px; gap: 8px; min-width: 0; }
  .warn-text { display: none; }
  .auth-sep { display: none; }
  .tabs {
    order: 3;
    flex: 0 0 100%;
    height: 46px;
    align-items: center;
    gap: 2px;
    margin: 0 -12px;
    padding: 0 8px;
    border-top: 1px solid var(--surface-alt);
  }
  /* all five tabs share the row — no sideways scrolling to find one */
  .tab {
    flex: 1 1 auto;
    min-width: 0;
    text-align: center;
    font-size: 10.5px;
    letter-spacing: 0;
    padding: 7px 3px;
    white-space: nowrap;
  }
  /* the trash counter floats over the tab corner so it never widens the row */
  .tab { position: relative; }
  .tab-badge { position: absolute; top: -3px; right: -5px; margin: 0; padding: 0 4px; font-size: 9px; }
}
</style>
