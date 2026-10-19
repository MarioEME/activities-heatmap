import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { t } from '../i18n'
import {
  dropboxConfigured, startAuth, handleRedirectCallback, refreshAccessToken, revokeToken,
  getCurrentAccount, getFileMeta, setUnauthorizedHandler,
  downloadIndex, uploadIndex, downloadTrash, uploadTrash, downloadMeta, uploadMeta,
  downloadFilters, uploadFilters, downloadLegacyData, downloadTags, uploadTags, downloadGear, uploadGear,
} from '../utils/dropboxSync'
import { uploadOriginalFiles, downloadOriginalFile } from '../utils/dropboxFiles'
import { INDEX_FILE_PATH } from '../dropboxConfig'
import {
  saveActivities, saveFilters, loadActivities, loadFilters, clearSession,
  saveDropboxAuth, loadDropboxAuth, clearDropboxAuth,
} from '../utils/sessionStorage'
import { useActivitiesStore, toPlainFilters } from './activities'

// Refresh a bit before actual expiry, so a slow network request doesn't
// straddle the boundary and get rejected mid-flight.
const REFRESH_SAFETY_MARGIN_MS = 60_000

// --- The flow, as agreed with the user (do not "simplify" this away) ---
//
// * Not signed in: nothing ever persists across a reload. Every visit
//   while signed out starts from zero, even if Dropbox isn't configured
//   at all. The UI is responsible for warning before that data is lost
//   (NotConnectedWarningModal), this store just never writes to local
//   storage while signed out.
// * Signed in, ordinary revisit (a saved refresh token already exists
//   when the app boots): Dropbox is authoritative, no questions asked —
//   always pull from Dropbox and overwrite whatever (if anything) is in
//   memory. There is no comparison here, so there is no conflict prompt
//   on a plain reload — that was the bug.
// * Signed in via a *fresh* connect (the user just clicked "Ligar ao
//   Dropbox", possibly after already working with unsaved local data):
//     - Dropbox already has data -> Dropbox wins silently, same as an
//       ordinary revisit (NotConnectedWarningModal already warned the user
//       up front that unsaved local data doesn't persist, so there's no
//       need to ask again here).
//     - Dropbox is empty but there is pending local data -> ask: start
//       from zero (discard local), or push the local data up to Dropbox.
//       This is the only conflict prompt left.
//     - Dropbox is empty and there is no pending local data -> nothing to
//       ask, just continue signed in with an empty dataset.
// * Explicit "sair" (sign out): disconnect and wipe the in-memory data
//   immediately, same as if the site had just been opened signed out.
export const useAuthStore = defineStore('auth', {
  state: () => ({
    configured: dropboxConfigured, // false = Dropbox not set up; auth UI stays hidden entirely
    status: 'checking', // checking | signed-out | signed-in
    user: null, // { name, email, photoUrl }
    conflict: null, // { mode: 'cloud-empty-pending-local', pendingCount }
    syncing: false,
    syncError: '',
    _accessToken: null,
    _refreshToken: null,
    _expiresAt: 0,
    _refreshing: null, // in-flight forced token refresh (see _forceRefresh)
    _pendingLocal: null, // snapshot of local data captured just before a fresh connect, held until the conflict (if any) is resolved
  }),

  actions: {
    // Runs once on boot. Three distinct situations, each handled on its
    // own path — see the comment above the store.
    async init() {
      setUnauthorizedHandler(() => this._forceRefresh())
      if (!this.configured) {
        this.status = 'signed-out'
        return
      }

      try {
        const fromRedirect = await handleRedirectCallback()
        if (fromRedirect) {
          await this._adoptTokens(fromRedirect)
          await this._reconcileAfterConnect()
          return
        }
      } catch (e) {
        console.warn('[activities-heatmap] Falha ao concluir o login do Dropbox:', e)
        this.syncError = t('err.loginFailed')
        this.status = 'signed-out'
        return
      }

      const saved = await loadDropboxAuth().catch(() => null)
      if (!saved?.refreshToken) {
        this.status = 'signed-out'
        return
      }

      // Ordinary revisit with a still-valid session: Dropbox is
      // authoritative, always pull, never ask. This is deliberate — any
      // comparison here is what caused the conflict modal to reappear on
      // every single reload even with zero real differences.
      try {
        this._refreshToken = saved.refreshToken
        await this._ensureFreshToken(saved)
        this.user = await getCurrentAccount(this._accessToken)
        await this._pullFromCloud()
        this.status = 'signed-in'
      } catch (e) {
        console.warn('[activities-heatmap] Sessão do Dropbox expirada ou inválida:', e)
        await clearDropboxAuth().catch(() => {})
        this.status = 'signed-out'
      }
    },

    // Called right before redirecting to Dropbox, so that whatever is in
    // memory right now (possibly never saved anywhere, since signed-out
    // data never persists) survives the full-page redirect. Stashed in
    // IndexedDB as a one-off "bridge" record — not the normal session
    // storage — and consumed (deleted) once the post-connect conflict (if
    // any) has been resolved.
    async signIn() {
      this.syncError = ''
      try {
        const activitiesStore = useActivitiesStore()
        if (activitiesStore.activities.length || activitiesStore.trash.length) {
          // The store already only holds lightweight metadata — GPS
          // geometry and original files live in IndexedDB (trackStore.js /
          // originalsStore.js), which survives the full-page OAuth
          // redirect on its own. The bridge snapshot only needs to carry
          // the metadata back.
          await saveActivities({
            activities: toRaw(activitiesStore.activities),
            trash: toRaw(activitiesStore.trash),
            tagDefs: activitiesStore.tagDefs.map((t) => ({ ...t })),
            gear: activitiesStore.gearSnapshot(),
            fileName: activitiesStore.fileName,
            trackFailures: activitiesStore.trackFailures,
            failureBreakdown: toRaw(activitiesStore.failureBreakdown),
          })
          await saveFilters(toPlainFilters(activitiesStore.filters))
        }
        await startAuth() // full-page redirect — nothing after this runs
      } catch (e) {
        console.warn('[activities-heatmap] Falha ao iniciar login com o Dropbox:', e)
        this.syncError = t('err.loginStart')
      }
    },

    // Explicit "sair": disconnect and wipe data immediately, exactly as
    // if the site had just been opened signed-out.
    async signOut() {
      await this._disconnect()
      useActivitiesStore().clearAll()
    },

    async _disconnect() {
      if (this._accessToken) await revokeToken(this._accessToken).catch(() => {})
      await clearDropboxAuth().catch(() => {})
      await clearSession().catch(() => {})
      this._accessToken = null
      this._refreshToken = null
      this._expiresAt = 0
      this.user = null
      this.conflict = null
      this._pendingLocal = null
      this.status = 'signed-out'
    },

    async _adoptTokens({ accessToken, refreshToken, expiresAt }) {
      this._accessToken = accessToken
      this._refreshToken = refreshToken
      this._expiresAt = expiresAt
      await saveDropboxAuth({ refreshToken }).catch((e) => {
        console.warn('[activities-heatmap] Não foi possível guardar a sessão do Dropbox:', e)
      })
    },

    // Used when Dropbox answers 401 mid-flight: get a new access token right
    // now (one refresh shared by every request that hit the 401 together).
    _forceRefresh() {
      if (!this._refreshing) {
        const refreshToken = this._refreshToken
        if (!refreshToken) return Promise.reject(new Error(t('err.noRefreshToken')))
        this._refreshing = refreshAccessToken(refreshToken)
          .then((fresh) => {
            this._accessToken = fresh.accessToken
            this._expiresAt = fresh.expiresAt
            return fresh.accessToken
          })
          .finally(() => { this._refreshing = null })
      }
      return this._refreshing
    },

    async _ensureFreshToken(stored) {
      const needsRefresh = !this._accessToken || Date.now() > this._expiresAt - REFRESH_SAFETY_MARGIN_MS
      if (!needsRefresh) return
      const refreshToken = this._refreshToken || stored?.refreshToken
      if (!refreshToken) throw new Error(t('err.noRefreshToken'))
      const fresh = await refreshAccessToken(refreshToken)
      this._accessToken = fresh.accessToken
      this._refreshToken = refreshToken
      this._expiresAt = fresh.expiresAt
    },

    // Runs right after a fresh OAuth connect. If Dropbox already has data,
    // it wins silently (no prompt — same as an ordinary revisit). The only
    // remaining conflict prompt is when Dropbox is empty but there is
    // pending local data worth keeping.
    async _reconcileAfterConnect() {
      this.syncing = true
      this.syncError = ''
      try {
        this.user = await getCurrentAccount(this._accessToken)
        // Checks for the current-format index first; a legacy-only account
        // (just the old single-blob file, no index.ndjson yet) is treated
        // the same as "cloud already has data" — _pullFromCloud() below
        // handles migrating it, rather than asking the "keep my pending
        // local data?" question for an account that isn't actually empty.
        let cloudMeta = await getFileMeta(this._accessToken, INDEX_FILE_PATH)
        if (!cloudMeta) cloudMeta = await getFileMeta(this._accessToken)

        if (cloudMeta) {
          await this._pullFromCloud()
          await clearSession().catch(() => {})
          this._pendingLocal = null
          this.status = 'signed-in'
        } else {
          const pending = await loadActivities().catch(() => null)
          const pendingCount = pending?.activities?.length || 0
          this._pendingLocal = pending
          if (pendingCount > 0) {
            this.conflict = { mode: 'cloud-empty-pending-local', pendingCount }
          } else {
            await clearSession().catch(() => {})
          }
          this.status = 'signed-in'
        }
      } catch (e) {
        console.warn('[activities-heatmap] Falha ao verificar dados no Dropbox:', e)
        this.syncError = t('err.checkData')
        this.status = 'signed-in'
      } finally {
        this.syncing = false
      }
    },

    // "Continuar": push the pending local data up to Dropbox.
    async resolveConflictContinue() {
      this.syncing = true
      try {
        await this._pushPendingToCloud()
      } catch (e) {
        console.warn('[activities-heatmap] Falha ao sincronizar com o Dropbox:', e)
        this.syncError = t('err.sync')
      } finally {
        await clearSession().catch(() => {})
        this._pendingLocal = null
        this.syncing = false
        this.conflict = null
      }
    },

    // "Começar do zero" — discard the pending local data and start fresh
    // on Dropbox, while staying connected.
    async resolveConflictLogout() {
      await clearSession().catch(() => {})
      this._pendingLocal = null
      useActivitiesStore().clearAll({ keepSignedIn: true })
      this.conflict = null
    },

    async _pullFromCloud() {
      const activitiesStore = useActivitiesStore()
      const index = await downloadIndex(this._accessToken)
      if (index) {
        const [trash, meta, cloudFilters, tagDefs, gear] = await Promise.all([
          downloadTrash(this._accessToken).catch(() => []),
          downloadMeta(this._accessToken).catch(() => null),
          downloadFilters(this._accessToken).catch(() => null),
          downloadTags(this._accessToken).catch(() => null),
          downloadGear(this._accessToken).catch(() => null),
        ])
        await activitiesStore.restoreFromBridge({
          activities: index,
          trash: trash || [],
          tagDefs,
          gear,
          fileName: meta?.fileName || '',
          trackFailures: meta?.trackFailures || 0,
          failureBreakdown: meta?.failureBreakdown || [],
          filters: cloudFilters,
        })
        return
      }

      // No current-format index yet — either an empty account, or one that
      // connected before this format existed (just the old single blob).
      // The latter still has real data and embedded geometry, so it's a
      // one-time migration, not "empty".
      const legacy = await downloadLegacyData(this._accessToken)
      if (!legacy) {
        activitiesStore.clearAll({ keepSignedIn: true })
        return
      }
      const cloudFilters = await downloadFilters(this._accessToken).catch(() => null)
      const legacyTagDefs = await downloadTags(this._accessToken).catch(() => null)
      const legacyGear = await downloadGear(this._accessToken).catch(() => null)
      await activitiesStore.restoreFromLegacyBridge({
        tagDefs: legacyTagDefs,
        gear: legacyGear,
        activities: legacy.activities,
        trash: legacy.trash,
        fileName: legacy.fileName,
        trackFailures: legacy.trackFailures,
        failureBreakdown: legacy.failureBreakdown,
        filters: cloudFilters,
      })
    },

    async _pushPendingToCloud() {
      const pending = this._pendingLocal
      if (!pending?.activities?.length && !pending?.trash?.length) return
      const activitiesStore = useActivitiesStore()
      let filters = null
      try { filters = await loadFilters() } catch (e) { /* best effort */ }
      await activitiesStore.restoreFromBridge({
        activities: pending.activities,
        trash: pending.trash,
        tagDefs: pending.tagDefs,
        gear: pending.gear,
        fileName: pending.fileName,
        trackFailures: pending.trackFailures,
        failureBreakdown: pending.failureBreakdown,
        filters,
      })
      await activitiesStore._syncToCloud()
      await uploadFilters(this._accessToken, toPlainFilters(activitiesStore.filters))
      // The pending data may have been imported while signed out, in which
      // case its original FIT/GPX/TCX files were only ever cached locally
      // (originalsStore.js) — back them up to Dropbox now too.
      await activitiesStore.uploadCachedOriginals()
    },

    // Original files are uploaded as their own step (see dropboxFiles.js) —
    // best-effort, since one failing shouldn't block the metadata sync
    // that already succeeded.
    async uploadOriginals(files, onProgress) {
      if (!files?.length) return { failed: [] }
      try {
        await this._ensureFreshToken({ refreshToken: this._refreshToken })
        const { failed } = await uploadOriginalFiles(() => this._accessToken, files, { onProgress })
        if (failed.length) {
          console.warn(`[activities-heatmap] ${failed.length} ficheiro(s) original(ais) não foram enviados para a Dropbox:`, failed)
        }
        return { failed }
      } catch (e) {
        console.warn('[activities-heatmap] Falha ao enviar ficheiros originais para a Dropbox:', e)
        return { failed: files.map((f) => ({ id: f.id, error: e?.message || String(e) })) }
      }
    },

    // On-demand fallback for a single activity's geometry (see
    // activities.js resolveTracks): downloads and gunzips its original file
    // straight from Dropbox. Returns null rather than throwing on any
    // failure (not signed in, token refresh failure, file missing) — a
    // track that can't be rebuilt right now just stays absent from the map,
    // same as any other "missing geometry" case already handled upstream.
    async downloadOriginalForTrack(sourceFile) {
      if (this.status !== 'signed-in') return null
      try {
        await this._ensureFreshToken({ refreshToken: this._refreshToken })
        return await downloadOriginalFile(this._accessToken, sourceFile)
      } catch (e) {
        console.warn(`[activities-heatmap] Falha ao descarregar o ficheiro original "${sourceFile}" da Dropbox:`, e)
        return null
      }
    },

    // Called by the activities store after every import/merge while
    // signed in, so the Dropbox copy stays in sync automatically. Metadata
    // only (no geometry) — original files are uploaded separately, see
    // uploadOriginals above.
    async syncCurrentData({ activities, trash, fileName, trackFailures, failureBreakdown }) {
      if (this.status !== 'signed-in') return
      try {
        await this._ensureFreshToken({ refreshToken: this._refreshToken })
        await uploadIndex(this._accessToken, activities)
        await uploadTrash(this._accessToken, trash || [])
        await uploadMeta(this._accessToken, { fileName, trackFailures, failureBreakdown })
        this.syncError = ''
      } catch (e) {
        console.warn('[activities-heatmap] Não foi possível sincronizar com o Dropbox:', e)
        this.syncError = t('err.saveCloud')
        throw e
      }
    },

    // The tag list is its own tiny file (see downloadTags in dropboxSync.js),
    // so adding/renaming a tag never rewrites the activities index.
    async syncTags(tagDefs) {
      if (this.status !== 'signed-in') return
      try {
        await this._ensureFreshToken({ refreshToken: this._refreshToken })
        await uploadTags(this._accessToken, tagDefs)
        this.syncError = ''
      } catch (e) {
        console.warn('[activities-heatmap] Não foi possível sincronizar as tags com o Dropbox:', e)
        this.syncError = t('err.saveTags')
        throw e
      }
    },

    // Equipment list + its totals: one small file, so renaming a piece of
    // gear or recalculating never rewrites the activities index.
    async syncGear(gear) {
      if (this.status !== 'signed-in') return
      try {
        await this._ensureFreshToken({ refreshToken: this._refreshToken })
        await uploadGear(this._accessToken, gear)
        this.syncError = ''
      } catch (e) {
        console.warn('[activities-heatmap] Não foi possível sincronizar o equipamento com o Dropbox:', e)
        this.syncError = t('err.saveGear')
        throw e
      }
    },

    // Lightweight path for filter-only changes — never touches the
    // (potentially large) activities file.
    async syncFilters(filters) {
      if (this.status !== 'signed-in') return
      try {
        await this._ensureFreshToken({ refreshToken: this._refreshToken })
        await uploadFilters(this._accessToken, filters)
        this.syncError = ''
      } catch (e) {
        console.warn('[activities-heatmap] Não foi possível sincronizar os filtros com o Dropbox:', e)
        this.syncError = t('err.saveFilters')
        throw e
      }
    },
  },
})
