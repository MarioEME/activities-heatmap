// ==UserScript==
// @name         Strava → Explorador (enviar atividade)
// @namespace    activities-heatmap
// @version      1.0
// @description  Na página de uma atividade do Strava, envia o ficheiro original + um ficheiro de metadados (nome, descrição, tipo, equipamento, tags) para a pasta /import da tua Dropbox.
// @match        https://www.strava.com/activities/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      api.dropboxapi.com
// @connect      content.dropboxapi.com
// @connect      www.strava.com
// @connect      strava.com
// @connect      *.amazonaws.com
// @connect      *.cloudfront.net
// @connect      *.strava.com
// ==/UserScript==

// A MESMA chave da app Dropbox que usas no Explorador (DROPBOX_APP_KEY em src/env.js).
// Não é segredo. Tem de ser a mesma app, para que /import seja a mesma pasta.
const APP_KEY = 'COLOCA_AQUI_A_CHAVE_DROPBOX'

;(() => {
  'use strict'
  const id = (location.pathname.match(/^\/activities\/(\d+)/) || [])[1]
  if (!id) return

  // ---------- helpers ----------
  const gm = (opts) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({ ...opts, onload: resolve, onerror: () => reject(new Error('Pedido falhou: ' + opts.url)), ontimeout: () => reject(new Error('Tempo esgotado')) })
  })
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const rand = () => b64url(crypto.getRandomValues(new Uint8Array(48)))
  const form = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

  // ---------- Dropbox auth (PKCE, sem redirect: o Dropbox mostra um código para copiar) ----------
  async function connect() {
    const verifier = rand()
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const url = 'https://www.dropbox.com/oauth2/authorize?' + form({
      client_id: APP_KEY, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline',
    })
    window.open(url, '_blank')
    const code = (prompt('Autoriza na janela do Dropbox, copia o código que aparece e cola-o aqui:') || '').trim()
    if (!code) throw new Error('Ligação cancelada')
    const r = await gm({
      method: 'POST', url: 'https://api.dropboxapi.com/oauth2/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form({ code, grant_type: 'authorization_code', code_verifier: verifier, client_id: APP_KEY }),
    })
    const j = JSON.parse(r.responseText || '{}')
    if (!j.refresh_token) throw new Error('Dropbox recusou o código (' + (j.error_description || r.status) + ')')
    GM_setValue('refresh', j.refresh_token)
  }

  async function accessToken() {
    if (!GM_getValue('refresh')) await connect()
    const r = await gm({
      method: 'POST', url: 'https://api.dropboxapi.com/oauth2/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form({ grant_type: 'refresh_token', refresh_token: GM_getValue('refresh'), client_id: APP_KEY }),
    })
    const j = JSON.parse(r.responseText || '{}')
    if (!j.access_token) { GM_deleteValue('refresh'); throw new Error('Sessão Dropbox expirou — tenta outra vez para voltar a ligar') }
    return j.access_token
  }

  async function upload(token, path, bytes) {
    const r = await gm({
      method: 'POST', url: 'https://content.dropboxapi.com/2/files/upload',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }) },
      data: new Blob([bytes]),
    })
    if (r.status !== 200) throw new Error(`Upload falhou (${r.status}): ${(r.responseText || '').slice(0, 120)}`)
  }

  // ---------- ficheiro original do Strava ----------
  function sniffExt(u8, headers) {
    const cd = /filename\*?=(?:UTF-8'')?"?([^";\r\n]+)/i.exec(headers || '')
    const fromName = cd && /\.(fit|gpx|tcx)(\.gz)?$/i.exec(cd[1])
    if (fromName && !fromName[2]) return fromName[1].toLowerCase()
    if (u8[0] === 0x1f && u8[1] === 0x8b) return 'gz'
    if (String.fromCharCode(...u8.slice(8, 12)) === '.FIT') return 'fit'
    const head = new TextDecoder().decode(u8.slice(0, 600))
    if (/TrainingCenterDatabase/i.test(head)) return 'tcx'
    if (/<gpx/i.test(head)) return 'gpx'
    return fromName ? fromName[1].toLowerCase() : null
  }

  async function downloadOriginal() {
    const r = await gm({ method: 'GET', url: `https://www.strava.com/activities/${id}/export_original`, responseType: 'arraybuffer', anonymous: false })
    if (r.status !== 200) throw new Error(`O Strava não deu o ficheiro original (${r.status}). Só funciona nas tuas atividades.`)
    const u8 = new Uint8Array(r.response)
    const ext = sniffExt(u8, r.responseHeaders)
    if (!ext || ext === 'gz') throw new Error('Formato do original não reconhecido (precisa de ser FIT, GPX ou TCX).')
    return { u8, ext }
  }

  // ---------- metadados da página (melhor esforço: o Strava muda o HTML) ----------
  const txt = (sels) => {
    for (const s of sels) {
      const el = document.querySelector(s)
      const t = el && el.textContent.replace(/\s+/g, ' ').trim()
      if (t) return t
    }
    return ''
  }
  function readPage() {
    let name = txt(['h1.activity-name', '[data-testid="activity_name"]', 'h1[class*="Title"]', 'h1'])
    if (!name) name = (document.querySelector('meta[property="og:title"]')?.content || document.title).replace(/\s*\|\s*Strava.*$/i, '').trim()
    const description = txt(['.activity-description', '[data-testid="description"]', '[class*="ActivityDescription"]', '[class*="description"] p'])
    const gear = txt(['.gear-name', '[data-testid="gear"] a', '[class*="GearName"]', '[class*="gear"] a'])
    const type = txt(['[data-testid="activity_type"]', '.activity-type', '[class*="ActivityType"]'])
    return { name, description, gear, type }
  }

  // ---------- interface ----------
  const css = document.createElement('style')
  css.textContent = `
  #ahx-btn{position:fixed;right:16px;bottom:16px;z-index:99999;background:#0b7a75;color:#fff;border:0;border-radius:22px;padding:10px 16px;font:600 14px system-ui;cursor:pointer;box-shadow:0 2px 8px #0005}
  #ahx-box{position:fixed;right:16px;bottom:64px;z-index:99999;width:320px;max-width:calc(100vw - 32px);background:#fff;color:#222;border-radius:10px;padding:14px;font:13px system-ui;box-shadow:0 4px 18px #0006}
  #ahx-box label{display:block;margin:8px 0 2px;font-weight:600}
  #ahx-box input,#ahx-box textarea{width:100%;box-sizing:border-box;padding:6px;border:1px solid #bbb;border-radius:5px;font:inherit}
  #ahx-box .row{display:flex;gap:8px;margin-top:12px}
  #ahx-box button{flex:1;padding:8px;border-radius:6px;border:0;font:600 13px system-ui;cursor:pointer}
  #ahx-go{background:#0b7a75;color:#fff}#ahx-x{background:#ddd}
  #ahx-msg{margin-top:8px;min-height:1.2em}`
  document.head.appendChild(css)

  const btn = document.createElement('button')
  btn.id = 'ahx-btn'
  btn.textContent = 'Enviar para o Explorador'
  document.body.appendChild(btn)

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  btn.onclick = () => {
    const old = document.getElementById('ahx-box')
    if (old) { old.remove(); return }
    const m = readPage()
    const box = document.createElement('div')
    box.id = 'ahx-box'
    box.innerHTML = `
      <label>Nome</label><input id="ahx-name" value="${esc(m.name)}">
      <label>Descrição</label><textarea id="ahx-desc" rows="3">${esc(m.description)}</textarea>
      <label>Tipo (ex.: Run, Ride, Hike — vazio = o do ficheiro)</label><input id="ahx-type" value="${esc(m.type)}">
      <label>Equipamento</label><input id="ahx-gear" value="${esc(m.gear)}">
      <label>Tags (separadas por vírgula)</label><input id="ahx-tags" value="">
      <div class="row"><button id="ahx-go">Enviar</button><button id="ahx-x">Fechar</button></div>
      <div id="ahx-msg"></div>`
    document.body.appendChild(box)
    const msg = (t, bad) => { const el = box.querySelector('#ahx-msg'); el.textContent = t; el.style.color = bad ? '#b00020' : '#0b7a75' }
    box.querySelector('#ahx-x').onclick = () => box.remove()
    box.querySelector('#ahx-go').onclick = async () => {
      const go = box.querySelector('#ahx-go')
      go.disabled = true
      try {
        msg('A descarregar o original…')
        const file = await downloadOriginal()
        const meta = {
          source: 'strava', stravaId: id,
          name: box.querySelector('#ahx-name').value.trim(),
          description: box.querySelector('#ahx-desc').value.trim(),
          type: box.querySelector('#ahx-type').value.trim(),
          gear: box.querySelector('#ahx-gear').value.trim(),
          tags: box.querySelector('#ahx-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
        }
        msg('A enviar para o Dropbox…')
        const token = await accessToken()
        // primeiro os metadados, depois o original: a app só importa quando vê o original
        await upload(token, `/import/strava-${id}.json`, new TextEncoder().encode(JSON.stringify(meta, null, 2)))
        await upload(token, `/import/strava-${id}.${file.ext}`, file.u8)
        msg('Enviado. Abre o Explorador para importar.')
      } catch (e) {
        msg(e.message || String(e), true)
      } finally {
        go.disabled = false
      }
    }
  }

  GM_registerMenuCommand('Ligar de novo ao Dropbox', async () => {
    try { GM_deleteValue('refresh'); await connect(); alert('Ligado.') } catch (e) { alert(e.message) }
  })
})()
