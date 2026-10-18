<script setup>
import { computed } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import { t } from '../i18n'

const store = useActivitiesStore()
const bounds = computed(() => store.dataBounds)

function close() {
  store.closeFilters()
}

function toggleType(type) {
  const all = store.availableTypes.map((x) => x.type)
  // an empty array is shorthand for "everything selected" (all boxes shown
  // checked); the first uncheck must expand that shorthand into an explicit
  // list before removing the one just unchecked, otherwise unchecking one
  // type would flip the filter into "show only this type" instead
  const current = store.filters.types.length ? [...store.filters.types] : [...all]
  const idx = current.indexOf(type)
  if (idx === -1) current.push(type)
  else current.splice(idx, 1)
  // collapse back to the [] shorthand once everything is checked again
  store.filters.types = current.length === all.length ? [] : current
}

// Unlike the type checkboxes, tags work as "show only activities with at
// least one of the selected tags": nothing selected means no tag filter.
function toggleTag(id) {
  const current = [...store.filters.tags]
  const idx = current.indexOf(id)
  if (idx === -1) current.push(id)
  else current.splice(idx, 1)
  store.filters.tags = current
}

function dateInputValue(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : ''
}
function setDate(field, value) {
  store.filters[field] = value ? new Date(value) : null
}

function fmtKm(v) { return `${v} km` }
function fmtM(v) { return `${v} m` }
function fmtKmh(v) { return `${v} km/h` }
function fmtCoord(v) { return v.toFixed(3) }

function startAreaDraw() {
  store.startDrawingArea()
}
function cancelAreaDraw() {
  store.stopDrawingArea()
}
function clearArea() {
  store.clearPassageBox()
}

const RECENT_PRESETS = [100, 250, 500, 1000]
function setRecentLimit(n) {
  store.filters.recentLimit = n
}
function onRecentLimitInput(value) {
  const n = value === '' ? null : Math.max(1, Math.floor(Number(value)))
  store.filters.recentLimit = Number.isFinite(n) ? n : null
}
function clearRecentLimit() {
  store.filters.recentLimit = null
}
</script>

<template>
  <aside class="popup-panel" :class="{ drawing: store.drawingArea }">
    <div class="popup-header">
      <h2>{{ t('filter.title') }}</h2>
      <button class="icon-btn" @click="close" :aria-label="t('common.close')">✕</button>
    </div>
    <p class="sub">{{ t('filter.sub') }}</p>

      <div class="popup-body">
        <section class="panel">
          <h3 class="panel-title">{{ t('filter.search') }}</h3>
          <input
            class="text-input"
            type="text"
            :placeholder="t('filter.searchPlaceholder')"
            v-model="store.filters.search"
          />
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('filter.recent') }}</h3>
          <p class="panel-hint">{{ t('filter.recentHint') }}</p>
          <div class="presets">
            <button
              v-for="n in RECENT_PRESETS"
              :key="n"
              class="preset-btn"
              :class="{ active: store.filters.recentLimit === n }"
              @click="setRecentLimit(n)"
            >
              {{ n }}
            </button>
            <button class="preset-btn" :class="{ active: store.filters.recentLimit == null }" @click="clearRecentLimit">
              {{ t('filter.all') }}
            </button>
          </div>
          <input
            class="text-input recent-input"
            type="number"
            min="1"
            :placeholder="t('filter.custom')"
            :value="store.filters.recentLimit ?? ''"
            @input="onRecentLimitInput($event.target.value)"
          />
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('filter.area') }}</h3>
          <p class="panel-hint">{{ t('filter.areaHint') }}</p>

          <div v-if="store.drawingArea" class="area-status drawing">
            <span class="pulse-dot" /> {{ t('filter.areaDrag') }}
            <button class="link-btn" @click="cancelAreaDraw">{{ t('common.cancelLower') }}</button>
          </div>
          <div v-else-if="store.filters.passageBox" class="area-status set">
            <span class="mono">
              {{ fmtCoord(store.filters.passageBox.south) }}, {{ fmtCoord(store.filters.passageBox.west) }}
              → {{ fmtCoord(store.filters.passageBox.north) }}, {{ fmtCoord(store.filters.passageBox.east) }}
            </span>
            <button class="link-btn" @click="clearArea">{{ t('filter.clear') }}</button>
          </div>
          <button v-else class="area-btn" @click="startAreaDraw">
            <span class="tool-icon">▭</span> {{ t('filter.areaDraw') }}
          </button>
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('filter.type') }}</h3>
          <div class="type-list">
            <label v-for="ty in store.availableTypes" :key="ty.type" class="type-row">
              <input
                type="checkbox"
                :checked="store.filters.types.length === 0 || store.filters.types.includes(ty.type)"
                @change="toggleType(ty.type)"
              />
              <span class="swatch" :style="{ background: colorForType(ty.type) }" />
              <span class="type-name">{{ ty.type }}</span>
              <span class="mono type-count">{{ ty.count }}</span>
            </label>
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('nav.tags') }}</h3>
          <p class="panel-hint">{{ t('filter.tagsHint') }}</p>
          <div v-if="store.availableTags.length" class="type-list">
            <label v-for="tg in store.availableTags" :key="tg.id" class="type-row">
              <input
                type="checkbox"
                :checked="store.filters.tags.includes(tg.id)"
                @change="toggleTag(tg.id)"
              />
              <span class="type-name">{{ tg.name }}</span>
              <span class="mono type-count">{{ tg.count }}</span>
            </label>
          </div>
          <p v-else class="panel-hint">{{ t('edit.tagsEmpty') }}</p>
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('filter.dates') }}</h3>
          <div class="row">
            <label class="field">
              <span>{{ t('filter.from') }}</span>
              <input type="date" :value="dateInputValue(store.filters.dateFrom)" @input="setDate('dateFrom', $event.target.value)" />
            </label>
            <label class="field">
              <span>{{ t('filter.to') }}</span>
              <input type="date" :value="dateInputValue(store.filters.dateTo)" @input="setDate('dateTo', $event.target.value)" />
            </label>
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('act.distance') }}</h3>
          <div class="slider-row">
            <span class="mono val">{{ fmtKm(store.filters.distanceMin) }}</span>
            <input type="range" min="0" :max="bounds.distanceMax || 100" v-model.number="store.filters.distanceMin" />
          </div>
          <div class="slider-row">
            <span class="mono val">{{ fmtKm(store.filters.distanceMax ?? bounds.distanceMax) }}</span>
            <input type="range" min="0" :max="bounds.distanceMax || 100"
                   :value="store.filters.distanceMax ?? bounds.distanceMax"
                   @input="store.filters.distanceMax = Number($event.target.value)" />
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('filter.elevation') }}</h3>
          <div class="slider-row">
            <span class="mono val">{{ fmtM(store.filters.elevationMin) }}</span>
            <input type="range" min="0" :max="bounds.elevationMax || 1000" step="10" v-model.number="store.filters.elevationMin" />
          </div>
          <div class="slider-row">
            <span class="mono val">{{ fmtM(store.filters.elevationMax ?? bounds.elevationMax) }}</span>
            <input type="range" min="0" :max="bounds.elevationMax || 1000" step="10"
                   :value="store.filters.elevationMax ?? bounds.elevationMax"
                   @input="store.filters.elevationMax = Number($event.target.value)" />
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('filter.speed') }}</h3>
          <div class="slider-row">
            <span class="mono val">{{ fmtKmh(store.filters.speedMin) }}</span>
            <input type="range" min="0" :max="bounds.speedMax || 60" v-model.number="store.filters.speedMin" />
          </div>
          <div class="slider-row">
            <span class="mono val">{{ fmtKmh(store.filters.speedMax ?? bounds.speedMax) }}</span>
            <input type="range" min="0" :max="bounds.speedMax || 60"
                   :value="store.filters.speedMax ?? bounds.speedMax"
                   @input="store.filters.speedMax = Number($event.target.value)" />
          </div>
        </section>

        <section class="panel">
          <h3 class="panel-title">{{ t('filter.other') }}</h3>
          <label class="toggle-row">
            <input type="checkbox" v-model="store.filters.onlyWithGps" />
            <span>{{ t('filter.onlyGps') }}</span>
          </label>
          <label class="toggle-row">
            <input type="checkbox" v-model="store.filters.excludeCommutes" />
            <span>{{ t('filter.noCommutes') }}</span>
          </label>
        </section>
      </div>

      <div class="popup-footer">
        <span class="mono summary">
          {{ t('filter.summary', { n: store.filteredStats.count, km: store.filteredStats.distance.toFixed(0) }, store.filteredStats.count) }}
        </span>
        <button class="clear-btn" @click="store.resetFilters()">{{ t('filter.reset') }}</button>
      </div>
  </aside>
</template>

<style scoped>
.popup-panel {
  position: fixed;
  top: var(--navbar-h); /* below navbar */
  right: 0;
  bottom: 0;
  z-index: 900;
  width: var(--filter-panel-width);
  max-width: 92vw;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -18px 0 40px -20px rgba(28, 35, 29, 0.35);
  display: flex;
  flex-direction: column;
  animation: slide-in 0.18s ease-out;
}
@keyframes slide-in {
  from { transform: translateX(24px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 0;
}
.popup-header h2 { font-size: 21px; }
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
.sub {
  color: var(--text-muted);
  font-size: 12.5px;
  margin: 6px 20px 16px;
}

.popup-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
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
.panel-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 10px;
  line-height: 1.4;
}

.text-input {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.preset-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 20px;
}
.preset-btn:hover { border-color: var(--accent); color: var(--accent-strong); }
.preset-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.recent-input { font-size: 13px; }

.area-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  justify-content: center;
  background: var(--surface);
  border: 1px dashed var(--border-strong);
  color: var(--text-dim);
  font-size: 13px;
  padding: 10px;
  border-radius: var(--radius-sm);
}
.area-btn:hover { border-color: var(--accent); color: var(--accent-strong); }
.tool-icon { font-size: 11px; }

.area-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
.area-status.drawing { border-color: var(--accent); color: var(--accent-strong); }
.pulse-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
.area-status .mono { flex: 1; font-size: 10.5px; word-break: break-all; }
.link-btn {
  background: transparent;
  border: none;
  color: var(--accent-strong);
  font-size: 11px;
  text-decoration: underline;
  flex-shrink: 0;
  padding: 0;
}

.type-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}
.type-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
}
.swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.type-name { flex: 1; }
.type-count { color: var(--text-muted); font-size: 11px; }

.row { display: flex; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-muted); flex: 1; }
.field input {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color-scheme: light;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.slider-row:last-child { margin-bottom: 0; }
.slider-row .val { width: 64px; color: var(--text-dim); font-size: 11.5px; flex-shrink: 0; }
.slider-row input[type="range"] { flex: 1; accent-color: var(--accent-strong); }

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 10px;
  cursor: pointer;
}
.toggle-row:last-child { margin-bottom: 0; }

.popup-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}
.summary { color: var(--text-muted); font-size: 11.5px; }
.clear-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.clear-btn:hover { border-color: var(--accent); color: var(--accent-strong); }

/* Phones: a bottom sheet instead of a side panel. The map stays full width
   behind it; while a passage area is being drawn the sheet steps aside. */
@media (max-width: 720px) {
  .popup-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-width: 100%;
    height: 64vh;
    border-left: none;
    border-top: 1px solid var(--border);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -18px 40px -20px rgba(28, 35, 29, 0.4);
    animation: slide-up 0.18s ease-out;
  }
  .popup-panel.drawing { display: none; }
  .popup-header { padding-top: 14px; }
}
@keyframes slide-up {
  from { transform: translateY(24px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>
