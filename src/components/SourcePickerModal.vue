<script setup>
import { ref, computed } from 'vue'
import { toRaw } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { useAuthStore } from '../stores/auth'
import { parseStravaZip, parseActivityFile } from '../utils/zipParser'
import { t } from '../i18n'
import { diffAndMergeActivities } from '../utils/mergeActivities'
import NotConnectedWarningModal from './NotConnectedWarningModal.vue'

const store = useActivitiesStore()
const authStore = useAuthStore()
const zipInputRef = ref(null)
const gpxInputRef = ref(null)

const hasExisting = computed(() => store.activities.length > 0)
const mergeMode = ref('keep') // 'keep' | 'replace' — only relevant when hasExisting

const step = ref('choose-source') // choose-source | parsing | confirm | saving | error
const parsingLabel = ref('')
const pending = ref(null) // { merged, newCount, overlapCount, fileName, trackFailures, failureBreakdown, originalFiles }
const errorMessage = ref('')
const showNotConnectedWarning = ref(false)
const pendingSource = ref(null) // 'strava' | 'gpx' — which input to open once the not-connected warning is resolved

function close() {
  store.closeSourcePicker()
}

function pickStravaFile() {
  if (authStore.status !== 'signed-in') {
    pendingSource.value = 'strava'
    showNotConnectedWarning.value = true
    return
  }
  zipInputRef.value?.click()
}

function pickGpxFiles() {
  if (authStore.status !== 'signed-in') {
    pendingSource.value = 'gpx'
    showNotConnectedWarning.value = true
    return
  }
  gpxInputRef.value?.click()
}

function warningContinue() {
  showNotConnectedWarning.value = false
  if (pendingSource.value === 'gpx') gpxInputRef.value?.click()
  else zipInputRef.value?.click()
  pendingSource.value = null
}
function warningCancel() {
  showNotConnectedWarning.value = false
  pendingSource.value = null
}

// Shared tail end for both sources: once we have a freshly-parsed
// activities array (plus its failure/track accounting), decide whether to
// commit directly (nothing to merge against yet) or go through the
// keep/replace confirmation step — the actual "is this a duplicate?"
// decision happens inside diffAndMergeActivities, via the single shared
// comparator in mergeActivities.js.
async function proceedWithParsed({ activities, fileName, trackFailures, failureBreakdown, originalFiles }) {
  if (!hasExisting.value) {
    await store.commitActivities({
      activities,
      fileName,
      trackFailures,
      failureBreakdown,
      originalFiles,
      resetFiltersToDefault: true,
    })
    close()
    return
  }

  const { merged, newCount, overlapCount } = diffAndMergeActivities(
    toRaw(store.activities), activities, mergeMode.value
  )
  pending.value = { merged, newCount, overlapCount, fileName, trackFailures, failureBreakdown, originalFiles }
  step.value = 'confirm'
}

async function onFileChosen(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // allow picking the same file again later
  if (!file) return

  step.value = 'parsing'
  parsingLabel.value = t('picker.starting')
  try {
    const result = await parseStravaZip(file, (p) => {
      parsingLabel.value = p.label
    })
    await proceedWithParsed({
      activities: result.activities,
      fileName: file.name,
      trackFailures: result.trackFailures,
      failureBreakdown: result.failureBreakdown,
      originalFiles: result.originalFiles,
    })
  } catch (err) {
    console.error(err)
    errorMessage.value = err?.message || t('picker.fileError')
    step.value = 'error'
  }
}

async function onGpxFilesChosen(e) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  if (!files.length) return

  step.value = 'parsing'
  parsingLabel.value = t('picker.processingGpx', { n: files.length }, files.length)
  try {
    const activities = []
    const originalFiles = []
    let trackFailures = 0
    const byReason = new Map()

    for (let i = 0; i < files.length; i++) {
      parsingLabel.value = t('picker.processingN', { i: i + 1, n: files.length })
      const { activity, trackFailure, failureReason, originalFile } = await parseActivityFile(files[i])
      activities.push(activity)
      if (originalFile) originalFiles.push(originalFile)
      if (trackFailure) {
        trackFailures++
        const entry = byReason.get(failureReason) || { count: 0, examples: [] }
        entry.count++
        if (entry.examples.length < 5) entry.examples.push(activity.name)
        byReason.set(failureReason, entry)
      }
    }

    const failureBreakdown = [...byReason.entries()].map(([reason, { count, examples }]) => ({
      reason, count, examples,
    }))

    await proceedWithParsed({
      activities,
      fileName: files.length === 1 ? files[0].name : t('picker.gpxFiles', { n: files.length }),
      trackFailures,
      failureBreakdown,
      originalFiles,
    })
  } catch (err) {
    console.error(err)
    errorMessage.value = err?.message || t('picker.gpxError')
    step.value = 'error'
  }
}

async function confirmImport() {
  if (!pending.value) return
  await store.commitActivities({
    activities: pending.value.merged,
    fileName: pending.value.fileName,
    trackFailures: pending.value.trackFailures,
    failureBreakdown: pending.value.failureBreakdown,
    originalFiles: pending.value.originalFiles,
    resetFiltersToDefault: false,
  })
  close()
}

function cancelImport() {
  pending.value = null
  step.value = 'choose-source'
}
</script>

<template>
  <div class="overlay" @click.self="step === 'choose-source' && close()">
    <div class="dialog">
      <template v-if="step === 'choose-source'">
        <div class="dialog-header">
          <h2>{{ t('nav.loadData') }}</h2>
          <button class="icon-btn" @click="close" :aria-label="t('common.close')">✕</button>
        </div>
        <p class="sub">{{ t('picker.where') }}</p>

        <div v-if="hasExisting" class="merge-mode">
          <p class="merge-title">{{ t('picker.ifExists') }}</p>
          <label class="merge-option">
            <input type="radio" value="keep" v-model="mergeMode" />
            <span>{{ t('picker.keep') }}</span>
          </label>
          <label class="merge-option">
            <input type="radio" value="replace" v-model="mergeMode" />
            <span>{{ t('picker.replace') }}</span>
          </label>
          <p class="merge-hint">{{ t('picker.mergeHint') }}</p>
        </div>

        <div class="sources">
          <button class="source-row" @click="pickStravaFile">
            <span class="source-icon">📦</span>
            <span class="source-text">
              <span class="source-title">{{ t('picker.stravaTitle') }}</span>
              <span class="source-desc">{{ t('picker.stravaDesc') }}</span>
            </span>
            <span class="source-arrow">→</span>
          </button>

          <button class="source-row" @click="pickGpxFiles">
            <span class="source-icon">🗺️</span>
            <span class="source-text">
              <span class="source-title">{{ t('picker.gpxTitle') }}</span>
              <span class="source-desc">{{ t('picker.gpxDesc') }}</span>
            </span>
            <span class="source-arrow">→</span>
          </button>
        </div>

        <input ref="zipInputRef" type="file" accept=".zip" hidden @change="onFileChosen" />
        <input ref="gpxInputRef" type="file" accept=".gpx,.fit,.tcx" multiple hidden @change="onGpxFilesChosen" />
      </template>

      <template v-else-if="step === 'parsing'">
        <div class="dialog-header">
          <h2>{{ t('picker.processing') }}</h2>
        </div>
        <p class="sub mono">{{ parsingLabel }}</p>
      </template>

      <template v-else-if="step === 'confirm'">
        <div class="dialog-header">
          <h2>{{ t('picker.confirmTitle') }}</h2>
        </div>
        <p class="sub">
          <strong>{{ pending.newCount }}</strong> {{ t('picker.newCount', null, pending.newCount) }}
          <template v-if="pending.overlapCount">
            <br /><strong>{{ pending.overlapCount }}</strong> {{ t('picker.overlap', null, pending.overlapCount) }}
            <strong>{{ mergeMode === 'replace' ? t('picker.willReplace', null, pending.overlapCount) : t('picker.willKeep', null, pending.overlapCount) }}</strong>.
          </template>
        </p>
        <div class="actions">
          <button class="btn ghost" @click="cancelImport">{{ t('common.cancel') }}</button>
          <button class="btn primary" @click="confirmImport">{{ t('picker.confirm') }}</button>
        </div>
      </template>

      <template v-else-if="step === 'error'">
        <div class="dialog-header">
          <h2>{{ t('picker.failedTitle') }}</h2>
          <button class="icon-btn" @click="close" :aria-label="t('common.close')">✕</button>
        </div>
        <p class="sub error-text">⚠ {{ errorMessage }}</p>
        <div class="actions">
          <button class="btn ghost" @click="cancelImport">{{ t('picker.tryAnother') }}</button>
        </div>
      </template>
    </div>

    <NotConnectedWarningModal
      v-if="showNotConnectedWarning"
      @continue="warningContinue"
      @cancel="warningCancel"
    />
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1900;
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
.sub {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.55;
  margin: 6px 0 18px;
}
.error-text { color: var(--danger); }

.merge-mode {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 16px;
}
.merge-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 8px;
}
.merge-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
  cursor: pointer;
}
.merge-option:last-of-type { margin-bottom: 8px; }
.merge-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 4px 0 0;
  line-height: 1.4;
}

.sources {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.source-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}
button.source-row:hover { border-color: var(--accent); background: var(--accent-soft); }
.source-icon { font-size: 20px; flex-shrink: 0; }
.source-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.source-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
.source-desc { font-size: 11.5px; color: var(--text-muted); }
.source-arrow { color: var(--accent-strong); font-size: 16px; flex-shrink: 0; }

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
.btn.ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-dim);
}
.btn.ghost:hover { border-color: var(--text-muted); }
</style>
