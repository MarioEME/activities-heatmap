<script setup>
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { useActivitiesStore } from '../stores/activities'
import { useAuthStore } from '../stores/auth'
import { t, fmtDate, fmtTime } from '../i18n'
import LangSwitch from './LangSwitch.vue'
import logoUrl from '/favicon.svg?url'

const props = defineProps({ tab: String })
const emit = defineEmits(['update:tab'])
const store = useActivitiesStore()
const authStore = useAuthStore()

const userMenuOpen = ref(false)
const drawerOpen = ref(false) // phones: the tabs live in a side drawer
function go(item) { emit('update:tab', item); drawerOpen.value = false }
const userInitial = computed(() => (authStore.user?.name || authStore.user?.email || '?').trim().charAt(0).toUpperCase())

const items = ['heatmap', 'activities', 'gear', 'tags', 'trash']

const restoredLabel = computed(() => {
  if (!store.restoredAt) return null
  const d = new Date(store.restoredAt)
  return t('nav.synced', { when: `${fmtDate(d)} ${fmtTime(d)}` })
})
</script>

<template>
  <header class="navbar">
    <button class="burger" :aria-label="t('nav.menu')" :aria-expanded="drawerOpen" @click="drawerOpen = true">
      <Icon name="menu" :size="22" />
    </button>
    <div class="brand" title="Explorador">
      <img class="brand-icon" :src="logoUrl" alt="Explorador" width="30" height="30" />
    </div>
    <span class="cur-tab">{{ t('nav.' + props.tab) }}</span>

    <template v-if="drawerOpen">
      <div class="drawer-backdrop" @click="drawerOpen = false" />
      <nav class="drawer" :aria-label="t('nav.menu')">
        <div class="drawer-head">
          <img class="brand-icon" :src="logoUrl" alt="" width="30" height="30" />
          <button class="drawer-close" :aria-label="t('common.close')" @click="drawerOpen = false"><Icon name="close" :size="18" /></button>
        </div>
        <button v-for="item in items" :key="item" class="drawer-item" :class="{ active: tab === item }" @click="go(item)">
          {{ t('nav.' + item) }}
          <span v-if="item === 'trash' && store.trash.length" class="tab-badge mono">{{ store.trash.length }}</span>
        </button>
      </nav>
    </template>

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
      <span v-if="store.uploadProgress" class="mono upload-pill" :title="t('nav.uploadingTitle')">
        ↑ {{ t('nav.uploading', { done: store.uploadProgress.done, total: store.uploadProgress.total }) }}
      </span>
      <span v-if="store.syncing && !store.uploadProgress" class="mono upload-pill" :title="t('nav.savingTitle')">↑ {{ t('nav.saving') }}</span>
      <span v-if="store.cloudSyncError" class="mono persist-warning" :title="store.cloudSyncError">{{ t('nav.cloud') }}</span>
      <span
        v-if="authStore.status !== 'signed-in'"
        class="mono persist-warning"
        :title="t('nav.notSavedTitle')"
      >
        ⚠<span class="warn-text"> {{ t('nav.notSaved') }}</span>
      </span>
      <button class="reset-btn" :disabled="store.syncing" :title="store.syncing ? t('nav.savingTitle') : ''" @click="store.openSourcePicker()">{{ t('nav.loadData') }}</button>
      <LangSwitch />

      <template v-if="authStore.configured">
        <div class="auth-sep" />
        <button v-if="authStore.status === 'signed-out'" class="signin-btn" @click="authStore.signIn()">
          {{ t('nav.connect') }}
        </button>
        <div v-else-if="authStore.status === 'signed-in'" class="user-chip" :title="authStore.user?.email">
          <!-- the avatar doubles as the account button on phones, where the
               name and "sair" don't fit in the bar -->
          <button
            class="avatar-btn"
            :aria-label="t('nav.account')"
            :aria-expanded="userMenuOpen"
            @click="userMenuOpen = !userMenuOpen"
          >
            <img v-if="authStore.user?.photoUrl" :src="authStore.user.photoUrl" class="avatar" alt="" />
            <span v-else class="avatar avatar-initial">{{ userInitial }}</span>
          </button>
          <span class="user-name mono">{{ authStore.user?.name || authStore.user?.email }}</span>
          <span v-if="authStore.syncing" class="sync-dot" :title="t('nav.syncing')" />
          <button class="signout-btn" @click="authStore.signOut()">{{ t('nav.signOut') }}</button>

          <template v-if="userMenuOpen">
            <div class="menu-backdrop" @click="userMenuOpen = false" />
            <div class="user-menu" role="dialog" :aria-label="t('nav.account')">
              <div class="menu-label">{{ t('nav.account') }}</div>
              <div class="menu-name">{{ authStore.user?.name }}</div>
              <div class="menu-email mono">{{ authStore.user?.email }}</div>
              <button class="menu-signout" @click="userMenuOpen = false; authStore.signOut()">{{ t('nav.signOut') }}</button>
            </div>
          </template>
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
.reset-btn:disabled { opacity: 0.5; cursor: default; }
.brand {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 18px;
  color: var(--text);
  white-space: nowrap;
}
.brand-icon { display: block; width: 30px; height: 30px; border-radius: 7px; }
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
.upload-pill {
  color: var(--accent-strong);
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
  .restored-pill { display: none; }
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
.avatar-btn {
  background: transparent;
  border: none;
  padding: 0;
  display: flex;
  cursor: default;
}
.avatar-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 11px;
  font-weight: 700;
}
.user-chip { position: relative; }
.menu-backdrop { display: none; }
.user-menu { display: none; }
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
  /* no room for name + "sair": the avatar opens a small account menu instead */
  .signout-btn { display: none; }
  .avatar-btn { cursor: pointer; }
  .avatar { width: 26px; height: 26px; }
  .avatar-initial { font-size: 13px; }
  .menu-backdrop { display: block; position: fixed; inset: 0; z-index: 1190; }
  .user-menu {
    display: block;
    position: fixed;
    top: 54px;
    right: 10px;
    z-index: 1200;
    min-width: 220px;
    max-width: calc(100vw - 20px);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: 0 14px 34px -14px rgba(28, 35, 29, 0.45);
    padding: 12px 14px;
  }
  .menu-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 6px; }
  .menu-name { font-size: 14px; color: var(--text); font-weight: 600; word-break: break-word; }
  .menu-email { font-size: 11.5px; color: var(--text-dim); margin: 2px 0 10px; word-break: break-all; }
  .menu-signout {
    width: 100%;
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--danger);
    font-size: 12.5px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
  }
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
  .burger { order: 0; display: flex; }
  .brand { order: 1; height: 50px; align-items: center; }
  .cur-tab { order: 1; }
  .meta { order: 2; margin-left: auto; height: 50px; gap: 8px; min-width: 0; }
  .warn-text { display: none; }
  .auth-sep { display: none; }
  .tabs { display: none; }
  .reset-btn, .signin-btn { padding: 6px 8px; font-size: 11.5px; }
  .meta { gap: 6px; }
  .navbar { flex-wrap: nowrap; align-items: center; }
  .navbar .brand, .navbar .meta, .burger { height: 50px; }
}

/* Phones: hamburger + side drawer instead of the tab row */
.burger, .cur-tab { display: none; }
.burger {
  align-items: center; justify-content: center; width: 36px; background: transparent;
  border: none; color: var(--text-dim); padding: 0; margin-left: -6px; cursor: pointer;
}
.cur-tab { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.drawer-backdrop { position: fixed; inset: 0; background: rgba(20, 20, 20, 0.4); z-index: 1290; }
.drawer {
  position: fixed; top: 0; left: 0; bottom: 0; width: min(78vw, 280px); z-index: 1300;
  background: var(--surface); box-shadow: 8px 0 30px -10px rgba(0, 0, 0, 0.4);
  display: flex; flex-direction: column; padding: 8px 10px; gap: 2px; overflow-y: auto;
}
.drawer-head { display: flex; align-items: center; justify-content: space-between; height: 50px; padding: 0 4px; }
.drawer-close { background: transparent; border: none; color: var(--text-dim); padding: 6px; cursor: pointer; line-height: 0; }
.drawer-item {
  text-align: left; background: transparent; border: none; color: var(--text); font-size: 14px;
  letter-spacing: 0.04em; text-transform: uppercase; padding: 12px 12px; border-radius: var(--radius-sm); cursor: pointer;
}
.drawer-item.active { background: var(--accent); color: var(--on-accent); font-weight: 600; }
.drawer .tab-badge { position: static; margin-left: 6px; }
@media (max-width: 720px) { .burger { display: flex; } }
@media (min-width: 521px) and (max-width: 720px) { .cur-tab { display: block; } }
.reset-btn { white-space: nowrap; }
@media (min-width: 721px) { .drawer, .drawer-backdrop { display: none; } }
</style>
