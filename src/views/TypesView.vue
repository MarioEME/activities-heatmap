<script setup>
import { ref, computed } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import Icon from '../components/Icon.vue'
import { t } from '../i18n'

const store = useActivitiesStore()
const message = ref('')
const drafts = ref({}) // type name -> text being typed
const rows = computed(() => store.availableTypes)

function say(text) {
  message.value = text
  setTimeout(() => { if (message.value === text) message.value = '' }, 4000)
}

async function commitRename(row) {
  const draft = drafts.value[row.name]
  delete drafts.value[row.name]
  if (draft == null || draft.trim() === row.name) return
  if (!(await store.renameType(row.name, draft))) say(t('types.emptyName'))
}

async function merge(row, event) {
  const into = event.target.value
  event.target.value = ''
  if (!into) return
  if (window.confirm(t('types.mergeConfirm', { from: row.name, into, n: row.count }))) await store.mergeType(row.name, into)
}
</script>

<template>
  <div class="types-page">
    <div class="toolbar">
      <h2>{{ t('nav.types') }}</h2>
      <span class="mono count">{{ t('types.count', { n: rows.length }, rows.length) }}</span>
    </div>
    <p class="hint">{{ t('types.hint') }}</p>
    <p v-if="message" class="message">{{ message }}</p>

    <ul class="list">
      <li v-for="row in rows" :key="row.name" class="item">
        <div class="line">
          <span class="dot" :style="{ background: colorForType(row.name) }"></span>
          <input
            class="name-input"
            type="text"
            maxlength="60"
            :value="drafts[row.name] ?? row.name"
            :aria-label="row.name"
            @input="drafts[row.name] = $event.target.value"
            @keydown.enter.prevent="$event.target.blur()"
            @keydown.esc.prevent="delete drafts[row.name]; $event.target.blur()"
            @blur="commitRename(row)"
          />
          <span class="num mono">{{ row.count }}</span>
          <select class="merge" :aria-label="t('types.mergeInto')" @change="merge(row, $event)">
            <option value="">{{ t('types.mergeInto') }}</option>
            <option v-for="o in rows.filter((r) => r.name !== row.name)" :key="o.name" :value="o.name">{{ o.name }}</option>
          </select>
        </div>
        <div v-if="row.aliases.length" class="aliases">
          <span class="muted">{{ t('types.aliases') }}</span>
          <span v-for="al in row.aliases" :key="al" class="alias">
            {{ al }}
            <button class="x" :title="t('types.removeAlias', { name: al })" :aria-label="t('types.removeAlias', { name: al })" @click="store.removeTypeAlias(row.name, al)"><Icon name="close" :size="12" /></button>
          </span>
        </div>
      </li>
    </ul>
    <p v-if="!rows.length" class="empty">{{ t('types.empty') }}</p>
  </div>
</template>

<style scoped>
.types-page { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 24px 32px 32px; max-width: 720px; overflow-y: auto; }
.toolbar { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.toolbar h2 { font-size: 22px; }
.count { color: var(--text-muted); font-size: 12.5px; }
.hint { font-size: 12.5px; color: var(--text-muted); line-height: 1.5; margin: 0 0 16px; }
.message { font-size: 12.5px; color: var(--danger); margin: 0 0 8px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 8px 12px; }
.line { display: flex; align-items: center; gap: 10px; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.name-input { flex: 1; min-width: 0; background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text); font: inherit; font-size: 14px; font-weight: 600; padding: 5px 8px; }
.name-input:hover { border-color: var(--border); }
.name-input:focus { outline: none; border-color: var(--accent); background: var(--surface-alt); }
.num { color: var(--text-dim); font-size: 12.5px; min-width: 28px; text-align: right; }
.merge { background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-dim); font: inherit; font-size: 12px; padding: 5px 6px; max-width: 150px; }
.aliases { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0 2px 20px; font-size: 12px; }
.muted { color: var(--text-muted); }
.alias { display: inline-flex; align-items: center; gap: 2px; background: var(--surface-alt); border: 1px solid var(--border); border-radius: 12px; padding: 1px 4px 1px 9px; color: var(--text-dim); }
.x { background: transparent; border: none; padding: 2px; line-height: 0; color: var(--text-muted); cursor: pointer; border-radius: 50%; }
.x:hover { color: var(--text); background: var(--border); }
.empty { padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px; }
@media (max-width: 720px) { .types-page { padding: 16px 12px 28px; } .merge { max-width: 110px; } }
</style>
