<script setup>
// The same details + chart panel as on the map, for the Activities tab (table
// row on desktop, full-screen sheet on phones). It loads its own chart data.
import { shallowRef, watch } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import ActivityPanel from './ActivityPanel.vue'
import { loadActivitySeries } from '../utils/activitySeries'
import { downloadOriginal, downloadGpx } from '../utils/activityDownloads'
import { selectedColor } from '../utils/viewPrefs'

const props = defineProps({ activity: { type: Object, required: true } })
const emit = defineEmits(['edit', 'remove', 'hover'])
const store = useActivitiesStore()

const profileState = shallowRef({ status: 'loading' })
const paceState = shallowRef({ status: 'loading' })
let token = 0
watch(() => props.activity.id, async () => {
  const my = ++token
  profileState.value = { status: 'loading' }
  paceState.value = { status: 'loading' }
  const s = await loadActivitySeries(store, props.activity)
  if (my !== token) return
  profileState.value = s.profile
  paceState.value = s.pace
}, { immediate: true })
</script>

<template>
  <ActivityPanel
    :activity="activity"
    :profile-state="profileState"
    :pace-state="paceState"
    :color="selectedColor"
    class="full-panel"
    @edit="emit('edit', activity)"
    @remove="emit('remove', activity)"
    @download="downloadOriginal(store, activity)"
    @convert="downloadGpx(store, activity)"
    @hover="emit('hover', $event)"
  />
</template>

<style scoped>
.full-panel { max-height: none; }
</style>
