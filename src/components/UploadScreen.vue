<script setup>
import { ref } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { useAuthStore } from '../stores/auth'
import NotConnectedWarningModal from './NotConnectedWarningModal.vue'
import LangSwitch from './LangSwitch.vue'
import { t } from '../i18n'

const store = useActivitiesStore()
const authStore = useAuthStore()
const isDragging = ref(false)
const inputRef = ref(null)
const pendingFile = ref(null) // set while the not-connected warning is up

function handleFiles(files) {
  const file = files?.[0]
  if (!file) return
  if (!/\.zip$/i.test(file.name)) {
    store.errorMessage = t('upload.notZip')
    store.status = 'error'
    return
  }
  if (authStore.status !== 'signed-in') {
    pendingFile.value = file
    return
  }
  store.loadFromZip(file)
}

function confirmImportAnyway() {
  const file = pendingFile.value
  pendingFile.value = null
  if (file) store.loadFromZip(file)
}
function cancelImport() {
  pendingFile.value = null
}

function onDrop(e) {
  isDragging.value = false
  handleFiles(e.dataTransfer.files)
}
function onPick(e) {
  handleFiles(e.target.files)
}
function openPicker() {
  inputRef.value?.click()
}

const pct = () => {
  if (!store.progress.total) return 0
  return Math.min(100, Math.round((store.progress.done / store.progress.total) * 100))
}
</script>

<template>
  <div class="stage">
    <svg class="contours" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="M-50,650 C150,600 300,700 500,640 C700,580 850,660 1050,600 C1150,570 1250,600 1300,580"
            fill="none" stroke="var(--border)" stroke-width="1.5"/>
      <path d="M-50,600 C150,540 320,650 520,580 C720,510 860,600 1060,540 C1160,510 1250,540 1300,520"
            fill="none" stroke="var(--border)" stroke-width="1.5"/>
      <path d="M-50,550 C160,480 330,590 530,510 C730,430 870,530 1070,470 C1170,440 1250,470 1300,450"
            fill="none" stroke="var(--border)" stroke-width="1.5"/>
      <path d="M-50,500 C170,420 340,530 540,440 C740,350 880,460 1080,390 C1180,360 1250,390 1300,370"
            fill="none" stroke="var(--border)" stroke-width="1.5"/>
      <circle cx="720" cy="470" r="3.5" fill="var(--accent)" />
    </svg>

    <div class="card">
      <div class="lang-corner"><LangSwitch /></div>
      <p class="eyebrow mono">{{ t('upload.eyebrow') }}</p>
      <h1>{{ t('upload.title') }}</h1>
      <p class="lede">{{ t('upload.lede') }}</p>

      <div
        class="dropzone"
        :class="{ dragging: isDragging, busy: store.status === 'parsing' }"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
        @click="store.status !== 'parsing' && openPicker()"
      >
        <input ref="inputRef" type="file" accept=".zip" hidden @change="onPick" />

        <template v-if="store.status === 'parsing'">
          <p class="mono progress-label">{{ store.progress.label }}</p>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: pct() + '%' }" />
          </div>
          <p class="mono progress-pct">{{ pct() }}%</p>
        </template>

        <template v-else>
          <div class="drop-icon">⇩</div>
          <p class="drop-title">{{ t('upload.dropTitle') }} <span class="mono">export_*.zip</span></p>
          <p class="drop-sub">{{ t('upload.dropSub') }}</p>
        </template>
      </div>

      <p v-if="store.status === 'error'" class="error">⚠ {{ store.errorMessage }}</p>

      <p class="alt-import">
        {{ t('upload.altBefore') }}
        <button class="link-btn" @click="store.openSourcePicker()">{{ t('upload.altLink') }}</button>
        {{ t('upload.altAfter') }}
      </p>

      <details class="howto">
        <summary>{{ t('upload.howtoTitle') }}</summary>
        <ol>
          <li>{{ t('upload.howto1') }} <strong>Settings → My Account</strong></li>
          <li>{{ t('upload.howto2') }} <strong>Download Request</strong></li>
          <li>{{ t('upload.howto3') }}</li>
          <li>{{ t('upload.howto4') }}</li>
        </ol>
      </details>

      <div v-if="authStore.configured && authStore.status === 'signed-out'" class="signin-offer">
        <span>{{ t('upload.offer') }}</span>
        <button class="signin-btn" @click="authStore.signIn()">{{ t('nav.connect') }}</button>
      </div>
      <p v-if="authStore.syncError" class="error">⚠ {{ authStore.syncError }}</p>
    </div>

    <NotConnectedWarningModal
      v-if="pendingFile"
      @continue="confirmImportAnyway"
      @cancel="cancelImport"
    />
  </div>
</template>

<style scoped>
.lang-corner { position: absolute; top: 12px; right: 12px; }
.stage {
  position: relative;
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 24px;
}
.contours {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.6;
}
.card {
  position: relative;
  z-index: 1;
  max-width: 560px;
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 40px 40px 32px;
  box-shadow: 0 30px 80px -30px rgba(0,0,0,0.6);
}
.eyebrow {
  color: var(--accent-strong);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin: 0 0 12px;
}
h1 {
  font-size: 34px;
  line-height: 1.1;
  margin-bottom: 14px;
}
.lede {
  color: var(--text-dim);
  line-height: 1.55;
  margin: 0 0 28px;
  font-size: 15px;
}
.dropzone {
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-md);
  padding: 36px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.dropzone:hover, .dropzone.dragging {
  border-color: var(--accent);
  background: rgba(201, 138, 62, 0.06);
}
.dropzone.busy { cursor: default; }
.drop-icon {
  font-size: 22px;
  color: var(--accent-strong);
  margin-bottom: 10px;
}
.drop-title {
  color: var(--text);
  font-size: 15px;
  margin: 0 0 4px;
}
.drop-sub {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}
.progress-label {
  color: var(--text-dim);
  font-size: 12.5px;
  margin: 0 0 14px;
}
.progress-track {
  height: 6px;
  border-radius: 4px;
  background: var(--surface-strong);
  overflow: hidden;
  margin-bottom: 8px;
}
.progress-fill {
  height: 100%;
  background: var(--accent-strong);
  transition: width 0.2s ease;
}
.progress-pct {
  color: var(--accent-strong);
  font-size: 12px;
  margin: 0;
}
.error {
  color: var(--danger);
  font-size: 13px;
  margin: 16px 0 0;
}
.alt-import {
  font-size: 12.5px;
  color: var(--text-muted);
  margin: 14px 0 0;
  text-align: center;
}
.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent-strong);
  font-size: inherit;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
.link-btn:hover { color: var(--accent); }
.howto {
  margin-top: 24px;
  font-size: 13px;
  color: var(--text-dim);
}
.howto summary {
  cursor: pointer;
  color: var(--accent-strong);
  font-size: 13px;
  margin-bottom: 8px;
}
.howto ol {
  margin: 8px 0 0;
  padding-left: 18px;
  line-height: 1.7;
}
.signin-offer {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.signin-btn {
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
}
.signin-btn:hover { border-color: var(--accent); color: var(--accent-strong); }
</style>
