<script setup>
// List tab: every activity (independent of the map filters), newest first, as a
// feed of cards. On wide screens the cards flow into as many columns as fit.
import { ref, computed } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import EditActivityModal from '../components/EditActivityModal.vue'
import ActivityFeed from '../components/ActivityFeed.vue'
import { t } from '../i18n'

const store = useActivitiesStore()
const editingActivity = ref(null)
const total = computed(() => store.activities.length)

function removeActivity(a) {
  if (window.confirm(t('act.confirmRemove', { name: a.name }))) store.removeActivity(a.id)
}
</script>

<template>
  <div class="activities-page">
    <div class="toolbar">
      <h2>{{ t('nav.activities') }}</h2>
      <span class="mono count">{{ total }}</span>
    </div>

    <p v-if="!total" class="empty">{{ t('act.empty') }}</p>
    <ActivityFeed v-else @edit="editingActivity = $event" @remove="removeActivity" />

    <EditActivityModal v-if="editingActivity" :activity="editingActivity" @close="editingActivity = null" />
  </div>
</template>

<style scoped>
.activities-page { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 24px 32px 0; }
.toolbar { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
.toolbar h2 { font-size: 22px; }
.count { color: var(--text-muted); font-size: 12.5px; }
.empty { padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px; }
@media (max-width: 720px) {
  .activities-page { padding: 14px 10px 0; }
  .toolbar { margin-bottom: 10px; }
}
</style>
