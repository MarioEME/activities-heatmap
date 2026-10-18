<script setup>
import { ref, computed } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { t } from '../i18n'

const store = useActivitiesStore()

const newName = ref('')
const message = ref('')
// id -> text being typed, so a half-edited name doesn't write through on every keystroke
const drafts = ref({})

const rows = computed(() => store.availableTags)

function say(text) {
  message.value = text
  setTimeout(() => { if (message.value === text) message.value = '' }, 4000)
}

async function add() {
  const name = newName.value.trim()
  if (!name) return
  const exists = store.tagDefs.some((d) => d.name.toLowerCase() === name.toLowerCase())
  if (exists) {
    say(t('tags.exists', { name }))
    return
  }
  await store.addTag(name)
  newName.value = ''
}

async function commitRename(tag) {
  const draft = drafts.value[tag.id]
  delete drafts.value[tag.id]
  if (draft == null || draft.trim() === tag.name) return
  const ok = await store.renameTag(tag.id, draft)
  if (!ok) say(draft.trim() ? t('tags.exists', { name: draft.trim() }) : t('tags.emptyName'))
}

function cancelRename(tag) {
  delete drafts.value[tag.id]
}

async function remove(tag) {
  const detail = tag.count
    ? t('tags.deleteUsed', { n: tag.count }, tag.count)
    : t('tags.deleteUnused')
  if (window.confirm(t('tags.confirmDelete', { name: tag.name, detail }))) {
    await store.deleteTag(tag.id)
  }
}
</script>

<template>
  <div class="tags-page">
    <div class="toolbar">
      <h2>{{ t('nav.tags') }}</h2>
      <span class="mono count">{{ t('tags.count', { n: rows.length }, rows.length) }}</span>
    </div>
    <p class="hint">{{ t('tags.hint') }}</p>

    <form class="add-row" @submit.prevent="add">
      <input v-model="newName" type="text" maxlength="40" :placeholder="t('tags.newPlaceholder')" :aria-label="t('tags.newLabel')" />
      <button class="btn primary" type="submit" :disabled="!newName.trim()">{{ t('gear.add') }}</button>
    </form>
    <p v-if="message" class="message">{{ message }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('act.col.name') }}</th>
            <th class="num">{{ t('gear.col.count') }}</th>
            <th class="actions-head"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tag in rows" :key="tag.id">
            <td>
              <input
                class="name-input"
                type="text"
                maxlength="40"
                :value="drafts[tag.id] ?? tag.name"
                :aria-label="t('tags.nameOf', { name: tag.name })"
                @input="drafts[tag.id] = $event.target.value"
                @keydown.enter.prevent="$event.target.blur()"
                @keydown.esc.prevent="cancelRename(tag); $event.target.blur()"
                @blur="commitRename(tag)"
              />
            </td>
            <td class="num mono">{{ tag.count }}</td>
            <td class="actions-cell">
              <button class="row-icon-btn" :title="t('tags.deleteTitle')" @click="remove(tag)">🗑️</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="rows.length === 0" class="empty">{{ t('tags.empty') }}</p>
    </div>
  </div>
</template>

<style scoped>
.tags-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 24px 32px 0;
  max-width: 720px;
}
.toolbar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}
.toolbar h2 { font-size: 22px; }
.count { color: var(--text-muted); font-size: 12.5px; }
.hint {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0 0 16px;
}

.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.add-row input,
.name-input {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13.5px;
  font-family: inherit;
  padding: 8px 11px;
}
.add-row input { flex: 1; }
.name-input { width: 100%; background: transparent; border-color: transparent; }
.name-input:hover { border-color: var(--border); }
.add-row input:focus,
.name-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface-alt);
}
.message { font-size: 12.5px; color: var(--danger); margin: 0 0 8px; }

.btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
}
.btn.primary { background: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: var(--accent-strong); }
.btn.primary:disabled { opacity: 0.6; cursor: default; }

.table-wrap {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin: 8px 0 24px;
  overflow: auto;
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  background: var(--surface);
  text-align: left;
  padding: 10px 14px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
tbody tr { border-bottom: 1px solid var(--surface-alt); }
td { padding: 6px 14px; color: var(--text-dim); }
.num { text-align: right; width: 1%; white-space: nowrap; }
.actions-head { width: 1%; }
.actions-cell { text-align: right; white-space: nowrap; }
.row-icon-btn {
  background: transparent;
  border: none;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  line-height: 1;
}
.row-icon-btn:hover { background: var(--surface-alt); }
.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
