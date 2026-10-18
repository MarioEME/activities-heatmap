<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useActivitiesStore } from './stores/activities'
import { useAuthStore } from './stores/auth'
import { t, locale } from './i18n'
import UploadScreen from './components/UploadScreen.vue'
import NavBar from './components/NavBar.vue'
import FilterPopup from './components/FilterPopup.vue'
import ConflictModal from './components/ConflictModal.vue'
import SourcePickerModal from './components/SourcePickerModal.vue'
import HeatmapView from './views/HeatmapView.vue'
import ActivitiesView from './views/ActivitiesView.vue'
import GearView from './views/GearView.vue'
import TrashView from './views/TrashView.vue'
import TagsView from './views/TagsView.vue'

const store = useActivitiesStore()
const authStore = useAuthStore()
const tab = ref('heatmap')

const showApp = computed(() => store.status === 'ready')
// authStore.init() owns ALL boot-time loading now — there is no local-only
// restore path any more (signed-out data never persists), so this is the
// only "please wait" state left.
const restoring = computed(() => authStore.status === 'checking')

onMounted(() => {
  authStore.init()
})

// Copying original files to Dropbox can take minutes; closing/reloading in
// the middle would leave some of them behind, so ask first.
function warnBeforeLeaving(e) {
  if (!store.uploadProgress) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeLeaving))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeLeaving))

// default tags the person never renamed follow the language
watch(locale, () => { if (store.status === 'ready') store.localizeDefaultTags() })

// drawing the "área de passagem" rectangle needs the map visible, so jump to
// the Heatmap tab automatically if the user starts drawing from elsewhere
watch(() => store.drawingArea, (active) => {
  if (active) tab.value = 'heatmap'
})

// Persist filter changes (debounced). This is a no-op while signed out —
// see activities.js persistFilters() — dragging a distance slider still
// shouldn't trigger a write on every pixel while signed in, so we wait for
// a short pause before saving.
let filterSaveTimer = null
watch(
  () => store.filters,
  () => {
    if (store.status !== 'ready') return
    clearTimeout(filterSaveTimer)
    filterSaveTimer = setTimeout(() => store.persistFilters(), 500)
  },
  { deep: true }
)
</script>

<template>
  <div class="shell">
    <template v-if="showApp">
      <NavBar v-model:tab="tab" />
      <main class="content">
        <HeatmapView v-show="tab === 'heatmap'" />
        <ActivitiesView v-if="tab === 'activities'" />
        <GearView v-if="tab === 'gear'" />
        <TagsView v-if="tab === 'tags'" />
        <TrashView v-if="tab === 'trash'" />
      </main>
      <FilterPopup v-if="store.filtersOpen" />
    </template>
    <div v-else-if="restoring" class="restoring-screen">
      <span class="dot" /> {{ t('app.connecting') }}
    </div>
    <UploadScreen v-else />
    <ConflictModal v-if="authStore.conflict" />
    <SourcePickerModal v-if="store.sourcePickerOpen" />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.content {
  flex: 1;
  min-height: 0;
  display: flex;
}
.restoring-screen {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 13.5px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
</style>
