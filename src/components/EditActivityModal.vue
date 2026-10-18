<script setup>
import { ref, computed } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { t, intlLocale } from '../i18n'

const props = defineProps({ activity: { type: Object, required: true } })
const emit = defineEmits(['close'])

const store = useActivitiesStore()
const name = ref(props.activity.name || '')
const description = ref(props.activity.description || '')
const saving = ref(false)
const selectedTags = ref([...(props.activity.tags || [])])
// '' = no equipment. The list is managed in the Gear tab.
const gearId = ref(props.activity.gearId && store.gearDefs.some((g) => g.id === props.activity.gearId) ? props.activity.gearId : '')
const gearOptions = computed(() => [...store.gearDefs].sort((a, b) => a.name.localeCompare(b.name, intlLocale())))
// Tags still on the activity but deleted from the list can't be shown as a
// chip, so they simply drop off when saved.
const tagOptions = computed(() => store.tagDefs)

function toggleTag(id) {
  const i = selectedTags.value.indexOf(id)
  if (i === -1) selectedTags.value.push(id)
  else selectedTags.value.splice(i, 1)
}

async function save() {
  saving.value = true
  try {
    await store.updateActivity(props.activity.id, { name: name.value.trim() || t('edit.unnamed'), description: description.value, tags: selectedTags.value.filter((id) => store.tagDefs.some((d) => d.id === id)), gearId: gearId.value || null })
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h2>{{ t('edit.title') }}</h2>
        <button class="icon-btn" @click="emit('close')" :aria-label="t('common.close')">✕</button>
      </div>

      <label class="field">
        <span class="field-label">{{ t('edit.name') }}</span>
        <input v-model="name" type="text" maxlength="200" />
      </label>

      <label class="field">
        <span class="field-label">{{ t('edit.description') }}</span>
        <textarea v-model="description" rows="4" maxlength="2000" :placeholder="t('edit.noDescription')"></textarea>
      </label>

      <label class="field">
        <span class="field-label">{{ t('edit.gear') }}</span>
        <select v-model="gearId">
          <option value="">{{ t('edit.noGear') }}</option>
          <option v-for="g in gearOptions" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <span v-if="!gearOptions.length" class="gear-hint">{{ t('edit.gearEmpty') }}</span>
      </label>

      <div class="field">
        <span class="field-label">{{ t('edit.tags') }}</span>
        <div v-if="tagOptions.length" class="tag-chips">
          <button
            v-for="tag in tagOptions"
            :key="tag.id"
            type="button"
            class="tag-chip"
            :class="{ on: selectedTags.includes(tag.id) }"
            :aria-pressed="selectedTags.includes(tag.id)"
            @click="toggleTag(tag.id)"
          >
            {{ tag.name }}
          </button>
        </div>
        <p v-else class="tag-empty">{{ t('edit.tagsEmpty') }}</p>
      </div>

      <div class="actions">
        <button class="btn ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? t('edit.saving') : t('common.save') }}</button>
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
  padding: 24px;
  max-width: 440px;
  width: 100%;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.4);
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
h2 { font-size: 19px; margin: 0; }
.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 15px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
}
.icon-btn:hover { background: var(--surface-alt); color: var(--text); }

.field {
  display: block;
  margin-bottom: 14px;
}
.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 5px;
}
.field input,
.field select,
.field textarea {
  width: 100%;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13.5px;
  font-family: inherit;
  padding: 9px 11px;
  resize: vertical;
}
.field input:focus,
.field select:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.tag-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-chip {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12.5px;
  padding: 5px 11px;
  border-radius: 20px;
}
.tag-chip:hover { border-color: var(--accent); }
.tag-chip.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.tag-empty { font-size: 12px; color: var(--text-muted); margin: 0; }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.btn {
  padding: 9px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
}
.btn.primary { background: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: var(--accent-strong); }
.btn.primary:disabled { opacity: 0.6; cursor: default; }
.btn.ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-dim);
}
.btn.ghost:hover { border-color: var(--text-muted); }
.gear-hint { display: block; margin-top: 5px; font-size: 11.5px; color: var(--text-muted); }
</style>
