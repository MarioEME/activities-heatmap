<script setup>
// A min/max pair for one numeric filter: typed values (easy on a phone, where
// dragging a slider to an exact number is fiddly) plus the sliders for quick
// coarse changes. `max` is null while there's no upper limit (= dataset max).
import { t } from '../i18n'

const props = defineProps({
  title: { type: String, required: true },
  unit: { type: String, default: '' },
  min: { type: Number, default: 0 },
  max: { type: Number, default: null },
  bound: { type: Number, required: true }, // highest value in the data
  step: { type: Number, default: 1 },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['update:min', 'update:max'])

function commitMin(e) {
  const raw = e.target.value.trim().replace(',', '.')
  const n = raw === '' ? 0 : Number(raw)
  const v = Number.isFinite(n) ? Math.max(0, n) : 0
  emit('update:min', v)
  e.target.value = v
}
function commitMax(e) {
  const raw = e.target.value.trim().replace(',', '.')
  if (raw === '') { emit('update:max', null); e.target.value = props.bound; return }
  const n = Number(raw)
  if (!Number.isFinite(n)) { e.target.value = props.max ?? props.bound; return }
  const v = Math.max(0, n)
  emit('update:max', v >= props.bound ? null : v)
  e.target.value = v >= props.bound ? props.bound : v
}
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">{{ title }}</h3>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <div class="range-row">
      <label class="lbl">{{ t('filter.min') }}</label>
      <input class="num" type="text" inputmode="decimal" enterkeyhint="done" :value="min" @change="commitMin" />
      <span class="unit">{{ unit }}</span>
      <input type="range" min="0" :max="bound" :step="step" :value="min" @input="emit('update:min', Number($event.target.value))" />
    </div>
    <div class="range-row">
      <label class="lbl">{{ t('filter.max') }}</label>
      <input class="num" type="text" inputmode="decimal" enterkeyhint="done" :value="max ?? bound" @change="commitMax" />
      <span class="unit">{{ unit }}</span>
      <input type="range" min="0" :max="bound" :step="step" :value="max ?? bound" @input="emit('update:max', Number($event.target.value) >= bound ? null : Number($event.target.value))" />
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 16px;
}
.panel-title {
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-strong);
  font-family: var(--font-body);
  font-weight: 600;
  margin: 0 0 10px;
}
.hint { font-size: 12px; color: var(--text-muted); margin: 0 0 10px; line-height: 1.4; }
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.range-row:last-child { margin-bottom: 0; }
.lbl { width: 30px; font-size: 11.5px; color: var(--text-muted); flex-shrink: 0; }
.num {
  width: 70px;
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  font-size: 14px; /* >=16px would avoid iOS zoom-on-focus, see media query */
  text-align: right;
}
.num:focus { outline: none; border-color: var(--accent); }
.unit { width: 34px; font-size: 11.5px; color: var(--text-muted); flex-shrink: 0; }
input[type="range"] { flex: 1; min-width: 0; accent-color: var(--accent-strong); }
@media (max-width: 720px) {
  .num { font-size: 16px; padding: 8px; } /* 16px stops iOS Safari zooming the page on focus */
  .range-row { gap: 6px; }
}
</style>
