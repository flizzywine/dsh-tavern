/* ------------------------------------------------------------------ *
 * monogatari.js —— 《化物语》SHAFT 剧场切卡、四主角导演与外置按需加载缓存引擎
 * 零内嵌视频/图片，所有 4 主角 WebM/JPG 均按需从 flizzywine/dsh-tavern@media-assets
 * 拉取并持久化到浏览器 Cache Storage，未选此皮肤时 0 KB 流量开销。
 * ------------------------------------------------------------------ */

const FD_MONO_DEFAULT_BASES = Object.freeze([
  'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@media-assets/fate-dice/monogatari',
  'https://raw.githubusercontent.com/flizzywine/dsh-tavern/media-assets/fate-dice/monogatari'
])
const FD_MONO_CACHE_NAME = 'dsh-fate-dice-monogatari-v1'
const FD_MONO_SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "Songti SC", "Noto Serif SC", "Georgia", serif'
const FD_MONO_CODE = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const FD_MONO_ALL_ACTORS = Object.freeze(['hitagi', 'shinobu', 'hanekawa', 'mayoi'])

const FD_MONO_ACTOR_META = Object.freeze({
  hitagi:   { code: 'HITAGI',   title: 'HITAGI SENJOGAHARA // CRAB',   border: '#d91e2a', label: '#d2a8ff', barBg: 'rgba(13, 10, 20, 0.96)', alignLeft: false },
  shinobu:  { code: 'SHINOBU',  title: 'KISS-SHOT // SHINOBU OSHINO',  border: '#f2b63d', label: '#f2b63d', barBg: 'rgba(14, 7, 10, 0.96)',  alignLeft: true  },
  hanekawa: { code: 'HANEKAWA', title: 'BLACK HANEKAWA // SAWARI NEKO', border: '#b074ff', label: '#e2c6ff', barBg: 'rgba(14, 9, 24, 0.96)',  alignLeft: false },
  mayoi:    { code: 'MAYOI',    title: 'MAYOI HACHIKUJI // LOST SNAIL', border: '#f5c518', label: '#f5c518', barBg: 'rgba(16, 14, 10, 0.96)', alignLeft: true  }
})

const FD_MONO_SCRIPTS = Object.freeze({
  hitagi: {
    throw:    { bg: '#0b0a0e', fg: '#f4f1ea', accent: '#8e55d6', koma: '黒コマ', head: '文房具、準備完了。', sub: '戦場ヶ原ひたぎ · 投擲' },
    fate:     { bg: '#f4f1ea', fg: '#0c0b10', accent: '#8e55d6', koma: '白コマ', head: '重さを、書き換えるわ。', sub: '重石蟹 · 逆転' },
    push:     { bg: '#c91826', fg: '#0c0b10', accent: '#f4f1ea', koma: '赤コマ', head: '暴言を吐くわよ？', sub: '危険 · 孤注一擲' },
    critical: { bg: '#c91826', fg: '#f4f1ea', accent: '#f5cb5c', koma: '赤コマ', head: '奇蹟 · 当然の結果ね。', sub: '戦場ヶ原ひたぎ · 大成功' },
    success:  { bg: '#f4f1ea', fg: '#0c0b10', accent: '#8e55d6', koma: '白コマ', head: '成立 · 悪くないわ。', sub: '戦場ヶ原ひたぎ · 成功' },
    costly:   { bg: '#0c0b10', fg: '#f4f1ea', accent: '#d91e2a', koma: '黒コマ', head: '代償 · 重石蟹の対価', sub: '戦場ヶ原ひたぎ · 辛勝' },
    failure:  { bg: '#0c0b10', fg: '#d8d6dc', accent: '#8e55d6', koma: '黒コマ', head: '不成立 · 失望したわ。', sub: '戦場ヶ原ひたぎ · 失敗' },
    fumble1:  { bg: '#08070a', fg: '#f4f1ea', accent: '#d91e2a', koma: '黒コマ', head: '黒', sub: 'SYSTEM // FAULT' },
    fumble2:  { bg: '#c91826', fg: '#0b0a0e', accent: '#f4f1ea', koma: '赤コマ', head: '破綻 · ……絶望ね。', sub: '戦場ヶ原ひたぎ · 大失敗' }
  },
  shinobu: {
    throw:    { bg: '#c91826', fg: '#0b0a0e', accent: '#f2b63d', koma: '赤コマ', head: '影より出でよ。', sub: '忍野忍 · 怪異の王' },
    fate:     { bg: '#f4f1ea', fg: '#0c0b10', accent: '#d91e2a', koma: '白コマ', head: '天命、書き換えじゃ。', sub: 'キスショット · 逆転' },
    push:     { bg: '#c91826', fg: '#f4f1ea', accent: '#f2b63d', koma: '赤コマ', head: '血を賭けよ、お前様。', sub: '妖刀心渡 · 一擲' },
    critical: { bg: '#c91826', fg: '#f4f1ea', accent: '#f2b63d', koma: '赤コマ', head: '奇蹟 · かっかっか！', sub: '忍野忍 · 大成功' },
    success:  { bg: '#0c0b10', fg: '#f2b63d', accent: '#d91e2a', koma: '金コマ', head: '成立 · 運が良いのう。', sub: '忍野忍 · 成功' },
    costly:   { bg: '#0c0b10', fg: '#f4f1ea', accent: '#f2b63d', koma: '黒コマ', head: '代償 · 少し血が足りん。', sub: '忍野忍 · 辛勝' },
    failure:  { bg: '#0c0b10', fg: '#d4d0c8', accent: '#f2b63d', koma: '黒コマ', head: '不成立 · ふんっ、つまらん。', sub: '忍野忍 · 失敗' },
    fumble1:  { bg: '#08070a', fg: '#f2b63d', accent: '#d91e2a', koma: '黒コマ', head: '怪異', sub: 'SHADOW // BREACH' },
    fumble2:  { bg: '#c91826', fg: '#0b0a0e', accent: '#f2b63d', koma: '赤コマ', head: '破綻 · 愚か者め。', sub: '忍野忍 · 大失敗' }
  },
  hanekawa: {
    throw:    { bg: '#0c0916', fg: '#f2eef8', accent: '#b074ff', koma: '黒コマ', head: 'にゃははっ、いくよ？', sub: 'ブラック羽川 · 障り猫' },
    fate:     { bg: '#f4f1ea', fg: '#120a1f', accent: '#9855f5', koma: '白コマ', head: '知ってることだけ、書き換えるにゃ。', sub: '障り猫 · 逆転' },
    push:     { bg: '#200b2e', fg: '#f8f4ff', accent: '#e02446', koma: '紫コマ', head: 'ご主人様、覚悟はいい？', sub: '銀爪疾斬 · 一擲' },
    critical: { bg: '#160b24', fg: '#f8f4ff', accent: '#f2c14e', koma: '紫コマ', head: '奇蹟 · にゃははっ、完璧！', sub: 'ブラック羽川 · 大成功' },
    success:  { bg: '#f4f1ea', fg: '#130b20', accent: '#9855f5', koma: '白コマ', head: '成立 · 知ってることだけ。', sub: 'ブラック羽川 · 成功' },
    costly:   { bg: '#0c0916', fg: '#f2eef8', accent: '#b074ff', koma: '黒コマ', head: '代償 · ちょっと爪が甘いかにゃ。', sub: 'ブラック羽川 · 辛勝' },
    failure:  { bg: '#0b0a0f', fg: '#d6d2df', accent: '#9855f5', koma: '黒コマ', head: '不成立 · それは知らないにゃ。', sub: 'ブラック羽川 · 失敗' },
    fumble1:  { bg: '#09070e', fg: '#e5d4ff', accent: '#b074ff', koma: '黒コマ', head: '障猫', sub: 'STRESS // OVERFLOW' },
    fumble2:  { bg: '#c91826', fg: '#f8f4ff', accent: '#b074ff', koma: '赤コマ', head: '破綻 · ストレス溜まるにゃあ。', sub: 'ブラック羽川 · 大失敗' }
  },
  mayoi: {
    throw:    { bg: '#f5c518', fg: '#0c0b10', accent: '#d91e2a', koma: '黄コマ', head: 'いきますよ、阿良々木さん！', sub: '八九寺真宵 · 迷い牛' },
    fate:     { bg: '#f4f1ea', fg: '#0c0b10', accent: '#2cb67d', koma: '白コマ', head: '道を変えちゃいますよ！', sub: '迷い牛 · 逆転' },
    push:     { bg: '#d91e2a', fg: '#f5c518', accent: '#0c0b10', koma: '赤コマ', head: 'わざとだ！全力突撃！', sub: '路標迷宮 · 一擲' },
    critical: { bg: '#f5c518', fg: '#0c0b10', accent: '#d91e2a', koma: '黄コマ', head: '奇蹟 · 迷わず大成功です！', sub: '八九寺真宵 · 大成功' },
    success:  { bg: '#f4f1ea', fg: '#0c0b10', accent: '#2cb67d', koma: '白コマ', head: '成立 · ちゃんと着きました！', sub: '八九寺真宵 · 成功' },
    costly:   { bg: '#0c0b10', fg: '#f5c518', accent: '#2cb67d', koma: '黒コマ', head: '代償 · ちょっと寄り道しました。', sub: '八九寺真宵 · 辛勝' },
    failure:  { bg: '#0c0b10', fg: '#f4f1ea', accent: '#f5c518', koma: '黒コマ', head: '不成立 · 失礼、噛みました！', sub: '八九寺真宵 · 失敗' },
    fumble1:  { bg: '#08070a', fg: '#f5c518', accent: '#d91e2a', koma: '黒コマ', head: '迷子', sub: 'ROUTE // LOST' },
    fumble2:  { bg: '#c91826', fg: '#f5c518', accent: '#0b0a0e', koma: '赤コマ', head: '破綻 · かみまみた！！', sub: '八九寺真宵 · 大失敗' }
  }
})

const FD_MONO_IMPACT_KANJI = Object.freeze(['落', '響', '撞', '反', '砕', '刻'])

/* 全局共享外置按需加载与 Cache Storage 持久化缓存（跨舞台复用，每角色仅拉取一次） */
const FD_MONO_PREFS = {
  actor: 'auto',
  introMode: 'full',
  mediaBase: ''
}

function fdSyncMonogatariPrefs(settings) {
  if (!settings || typeof settings !== 'object') return
  if (typeof settings.monogatariActor === 'string' && ['auto', 'hitagi', 'shinobu', 'hanekawa', 'mayoi', 'dual', 'dual2'].includes(settings.monogatariActor)) {
    FD_MONO_PREFS.actor = settings.monogatariActor
  }
  if (settings.monogatariIntroMode === 'fast' || settings.monogatariIntroMode === 'full') {
    FD_MONO_PREFS.introMode = settings.monogatariIntroMode
  }
  if (typeof settings.monogatariMediaBase === 'string') {
    const trimmed = settings.monogatariMediaBase.trim().replace(/\/+$/, '')
    if (trimmed !== FD_MONO_PREFS.mediaBase) {
      FD_MONO_PREFS.mediaBase = trimmed
      FD_MONO_MEDIA_POOL.resetForBaseChange()
    }
  }
}

const FD_MONO_MEDIA_POOL = (() => {
  const images = Object.create(null)
  const videos = Object.create(null)
  const inflight = Object.create(null)

  function candidateBases() {
    const list = []
    if (FD_MONO_PREFS.mediaBase) list.push(FD_MONO_PREFS.mediaBase)
    for (const b of FD_MONO_DEFAULT_BASES) {
      if (!list.includes(b)) list.push(b)
    }
    return list
  }

  async function fetchWithCache(relPath, mimeHint) {
    if (typeof fetch !== 'function') return null
    const bases = candidateBases()
    const cacheKeyUrl = `${bases[0]}/${relPath}`
    let cache = null
    try {
      if (typeof caches !== 'undefined' && caches && typeof caches.open === 'function') {
        cache = await caches.open(FD_MONO_CACHE_NAME)
        const hit = await cache.match(cacheKeyUrl)
        if (hit && hit.ok) {
          const blob = await hit.blob()
          if (blob && blob.size > 0) return URL.createObjectURL(blob)
        }
      }
    } catch {}

    for (const base of bases) {
      const url = `${base}/${relPath}`
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
        if (!res || !res.ok) continue
        if (cache) {
          try { await cache.put(cacheKeyUrl, res.clone()) } catch {}
        }
        const blob = await res.blob()
        if (blob && blob.size > 0) {
          return URL.createObjectURL(mimeHint ? new Blob([blob], { type: mimeHint }) : blob)
        }
      } catch {}
    }
    return null
  }

  function ensureActorImage(actor) {
    if (typeof Image === 'undefined' || !FD_MONO_ALL_ACTORS.includes(actor)) return null
    if (images[actor]) return images[actor]
    const key = `img:${actor}`
    if (!inflight[key]) {
      inflight[key] = fetchWithCache(`${actor}-keyframe.jpg`, 'image/jpeg').then(blobUrl => {
        if (!blobUrl) return null
        const img = new Image()
        img.src = blobUrl
        images[actor] = img
        return img
      }).finally(() => { delete inflight[key] })
    }
    return null
  }

  function ensureActorVideo(actor) {
    if (typeof document === 'undefined' || !FD_MONO_ALL_ACTORS.includes(actor)) return null
    if (videos[actor]) return videos[actor]
    const key = `vid:${actor}`
    if (!inflight[key]) {
      inflight[key] = fetchWithCache(`${actor}-cutin.webm`, 'video/webm').then(blobUrl => {
        if (!blobUrl) return null
        const vid = document.createElement('video')
        vid.muted = true
        vid.playsInline = true
        vid.preload = 'auto'
        vid.loop = true
        vid.src = blobUrl
        try { vid.load() } catch {}
        videos[actor] = vid
        return vid
      }).finally(() => { delete inflight[key] })
    }
    return null
  }

  function warmActor(actorMode) {
    const targets = actorMode === 'dual'
      ? ['hitagi', 'shinobu']
      : (actorMode === 'dual2'
        ? ['hanekawa', 'mayoi']
        : (FD_MONO_ALL_ACTORS.includes(actorMode) ? [actorMode] : FD_MONO_ALL_ACTORS))
    for (const a of targets) {
      ensureActorImage(a)
      if (FD_MONO_PREFS.introMode !== 'fast') ensureActorVideo(a)
    }
  }

  function resetForBaseChange() {
    for (const a of FD_MONO_ALL_ACTORS) {
      delete images[a]
      delete videos[a]
    }
  }

  return {
    getImage: a => images[a] || null,
    getVideo: a => videos[a] || null,
    ensureActorImage,
    ensureActorVideo,
    warmActor,
    resetForBaseChange
  }
})()

function fdMonoClamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v) }
function fdMonoEaseOut(t) { const x = fdMonoClamp01(t); return 1 - Math.pow(1 - x, 3) }

class FdMonogatariDirector {
  constructor() {
    this.actor = 'hitagi'
    this.episodeNo = 1
    this.komaQueue = []
    this.komaTimer = 0
    this.activeKoma = null
    this.introHolding = false
    this.cutInAge = 99
    this.cutInDur = 6.0
    this.cutInActor = 'hitagi'
    this.cutInCaption = ''
    this.slashAge = 99
    this.slashKind = 'kokorowatari'
    this.stapleAge = 99
    this.revealRipAge = 99
    this.impactPops = []
    this.fxFlash = 0
    this.fxMono = 0
    this.camRollRad = 0
  }

  _pickActor(mode, tier) {
    const pref = FD_MONO_PREFS.actor || 'auto'
    if (pref !== 'auto') return pref
    if (tier === 'critical') return Math.random() < 0.6 ? 'shinobu' : 'hanekawa'
    if (mode === 'fate' || mode === 'push') return Math.random() < 0.55 ? 'shinobu' : 'hanekawa'
    if (tier === 'failure') return Math.random() < 0.55 ? 'mayoi' : 'hitagi'
    if (tier === 'fumble') return FD_MONO_ALL_ACTORS[Math.floor(Math.random() * FD_MONO_ALL_ACTORS.length)]
    return FD_MONO_ALL_ACTORS[this.episodeNo % FD_MONO_ALL_ACTORS.length]
  }

  _scriptFor(actor, key) {
    const table = FD_MONO_SCRIPTS[actor] || FD_MONO_SCRIPTS.hitagi
    return table[key] || table.success
  }

  _restartActorVideos(actorMode) {
    const targets = actorMode === 'dual'
      ? ['hitagi', 'shinobu']
      : (actorMode === 'dual2' ? ['hanekawa', 'mayoi'] : [actorMode])
    for (const a of targets) {
      FD_MONO_MEDIA_POOL.ensureActorImage(a)
      const vid = FD_MONO_MEDIA_POOL.ensureActorVideo(a) || FD_MONO_MEDIA_POOL.getVideo(a)
      if (!vid) continue
      try {
        vid.currentTime = 0
        const p = vid.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch {}
    }
  }

  onThrow({ mode, tier, silentStatic, compactMode }) {
    this.episodeNo = (this.episodeNo % 99) + 1
    this.actor = this._pickActor(mode, tier)
    this.impactPops.length = 0
    this.komaQueue.length = 0
    this.activeKoma = null
    this.introHolding = false
    this.cutInAge = 99
    this.slashAge = 99
    this.stapleAge = 99
    this.revealRipAge = 99
    this.fxFlash = 0
    this.fxMono = 0

    // 触发按需外置资源预热（不阻塞投骰）
    FD_MONO_MEDIA_POOL.warmActor(this.actor)
    if (silentStatic) return

    const openKey = mode === 'fate' ? 'fate' : (mode === 'push' ? 'push' : 'throw')
    const leadActor = this.actor === 'dual' ? 'hitagi' : (this.actor === 'dual2' ? 'hanekawa' : this.actor)
    const card = this._scriptFor(leadActor, openKey)
    this._enqueueKoma({ ...card, duration: 0.40, ep: this.episodeNo })
    this.fxFlash = 0.42

    // 完整模式且非迷你胶囊时：前置播放主角四镜头高燃动画（绝不提前剧透结果，点击舞台可跳过）
    if (!compactMode && FD_MONO_PREFS.introMode !== 'fast') {
      this.introHolding = true
      this.cutInActor = this.actor
      this.cutInAge = 0
      const primaryVid = FD_MONO_MEDIA_POOL.getVideo(leadActor)
      const hasVid = Boolean(primaryVid && primaryVid.readyState >= 2 && Number.isFinite(primaryVid.duration) && primaryVid.duration > 2.0)
      this.cutInDur = hasVid ? Math.min(6.5, primaryVid.duration) : 2.2
      this.cutInCaption = card.head
      this._restartActorVideos(this.actor)
    }
  }

  isHoldingRoll() {
    if (!this.introHolding) return false
    if (this.activeKoma || this.cutInAge < this.cutInDur) return true
    this.introHolding = false
    return false
  }

  skipIntro() {
    if (!this.introHolding) return false
    this.introHolding = false
    this.komaQueue.length = 0
    this.activeKoma = null
    this.cutInAge = this.cutInDur + 1
    this.fxFlash = 0.48
    return true
  }

  onBounce({ x, y, z, strength, isHeavyFirst }) {
    if (strength < 0.22 && !isHeavyFirst) return
    const kanji = FD_MONO_IMPACT_KANJI[(this.impactPops.length + this.episodeNo) % FD_MONO_IMPACT_KANJI.length]
    this.impactPops.push({
      x, y, z, kanji, age: 0,
      dur: isHeavyFirst ? 0.62 : 0.45,
      scale: isHeavyFirst ? 1.28 : 0.98,
      red: isHeavyFirst || (this.impactPops.length % 2 === 1)
    })
    if (this.impactPops.length > 8) this.impactPops.shift()
    if (isHeavyFirst) this.fxFlash = Math.max(this.fxFlash, 0.70)
  }

  onSettle({ mode, tier, silentStatic }) {
    if (mode === 'hidden') return
    if (silentStatic) {
      this.fxMono = (tier === 'failure' || tier === 'fumble') ? 0.88 : 0
      this.stapleAge = 0.5
      return
    }
    const activeActor = this.actor === 'dual'
      ? (tier === 'critical' ? 'shinobu' : 'hitagi')
      : (this.actor === 'dual2' ? (tier === 'failure' || tier === 'fumble' ? 'mayoi' : 'hanekawa') : this.actor)

    this.introHolding = false
    this.cutInAge = this.cutInDur + 1
    this.komaQueue.length = 0
    this.activeKoma = null

    if (tier === 'fumble') {
      this._enqueueKoma({ ...this._scriptFor(activeActor, 'fumble1'), duration: 0.34, ep: this.episodeNo })
      this._enqueueKoma({ ...this._scriptFor(activeActor, 'fumble2'), duration: 0.54, ep: this.episodeNo })
      this.fxFlash = 0.85
    } else {
      const key = ['critical', 'success', 'costly', 'failure'].includes(tier) ? tier : 'success'
      this._enqueueKoma({ ...this._scriptFor(activeActor, key), duration: tier === 'critical' ? 0.58 : 0.46, ep: this.episodeNo })
      this.fxFlash = tier === 'critical' ? 0.68 : 0.32
    }

    if (activeActor === 'shinobu' && (tier === 'critical' || mode === 'fate' || mode === 'push')) {
      this.slashKind = 'kokorowatari'
      this.slashAge = 0
    } else if (tier === 'fumble' || (activeActor === 'hitagi' && tier === 'costly')) {
      this.slashKind = 'cutter'
      this.slashAge = 0
    }
    if (activeActor === 'hitagi' || this.actor === 'dual') this.stapleAge = 0
  }

  onRevealHidden() {
    this.revealRipAge = 0
    this.slashKind = this.actor === 'shinobu' ? 'kokorowatari' : 'cutter'
    this.slashAge = 0
    this.fxFlash = 0.78
  }

  _enqueueKoma(card) {
    this.komaQueue.push(card)
    if (!this.activeKoma) {
      this.activeKoma = this.komaQueue.shift()
      this.komaTimer = 0
    }
  }

  step(dt, { charging, chargeTime, chargeMode, settled, settleTime, tier, fateSlowAmount }) {
    if (this.activeKoma) {
      this.komaTimer += dt
      if (this.komaTimer >= this.activeKoma.duration) {
        this.activeKoma = this.komaQueue.length > 0 ? this.komaQueue.shift() : null
        this.komaTimer = 0
        if (!this.activeKoma && this.cutInAge === 0 && this.introHolding) {
          this._restartActorVideos(this.cutInActor)
        }
      }
    } else {
      if (this.cutInAge < 20) this.cutInAge += dt
      if (this.slashAge < 10) this.slashAge += dt
      if (this.stapleAge < 10) this.stapleAge += dt
      if (this.revealRipAge < 10) this.revealRipAge += dt
    }

    for (let i = this.impactPops.length - 1; i >= 0; i--) {
      this.impactPops[i].age += dt
      if (this.impactPops[i].age >= this.impactPops[i].dur) this.impactPops.splice(i, 1)
    }

    this.fxFlash = Math.max(0, this.fxFlash - dt * 4.2)
    const targetMono = (settled && !charging && (tier === 'failure' || tier === 'fumble')) ? 0.92 : 0.0
    this.fxMono += (targetMono - this.fxMono) * Math.min(1, dt * 8.0)

    let targetRoll = 0
    if (charging) {
      const c01 = Math.min(1, chargeTime / 0.88)
      targetRoll = chargeMode === 'push' ? (-0.095 * c01) : (0.075 * c01)
    } else if (fateSlowAmount > 0.05) {
      targetRoll = -0.11 * fateSlowAmount
    } else if (settled && tier === 'fumble' && settleTime < 1.8) {
      targetRoll = 0.068 * Math.max(0, 1 - settleTime / 2.2)
    } else if (settled && tier === 'critical' && settleTime < 1.1) {
      targetRoll = -0.048 * Math.max(0, 1 - settleTime / 1.1)
    }
    this.camRollRad += (targetRoll - this.camRollRad) * Math.min(1, dt * 9.0)
  }

  hasActiveFX() {
    return Boolean(this.activeKoma) ||
      this.introHolding ||
      this.cutInAge < this.cutInDur + 0.15 ||
      this.slashAge < 1.15 ||
      this.stapleAge < 0.8 ||
      this.revealRipAge < 0.7 ||
      this.impactPops.length > 0 ||
      this.fxFlash > 0.01
  }

  renderOverlay(ctx, state) {
    const {
      W, H, clock, charging, chargeTime, chargeMode,
      settled, settleTime, tier, mode, total, dice,
      hiddenMask, compactMode, fateSlowAmount, projectToUV
    } = state

    ctx.save()

    // 1. 电影遮幅
    if (!compactMode) {
      let barRatio = 0
      if (charging && chargeMode === 'push') barRatio = 0.11 * fdMonoClamp01(chargeTime / 0.5)
      else if (fateSlowAmount > 0.05) barRatio = 0.105 * fateSlowAmount
      else if (settled && !hiddenMask && (tier === 'failure' || tier === 'fumble')) {
        barRatio = 0.085 * fdMonoEaseOut(settleTime / 0.28)
      }
      if (barRatio > 0.005) {
        const bh = Math.round(H * barRatio)
        ctx.fillStyle = '#070609'
        ctx.fillRect(0, 0, W, bh)
        ctx.fillRect(0, H - bh, W, bh)
        ctx.fillStyle = tier === 'fumble' || (charging && chargeMode === 'push') ? '#d91e2a' : 'rgba(244, 241, 234, 0.28)'
        ctx.fillRect(0, bh - 1.5, W, 1.5)
        ctx.fillRect(0, H - bh, W, 1.5)
      }
    }

    // 2. 撞击拟声字
    if (this.impactPops.length > 0 && !this.introHolding) {
      this._drawImpactPops(ctx, W, H, projectToUV)
    }

    // 3. 落定标尺与暗骰封条
    if (settled && !charging) {
      if (hiddenMask) {
        this._drawHiddenCensorSeals(ctx, W, H, dice, clock, projectToUV)
      } else if (!compactMode && !this.activeKoma) {
        this._drawDiceLeaderLines(ctx, W, H, dice, tier, settleTime, projectToUV)
      }
    }

    // 4. 终结斩击
    if (this.slashAge < 1.15 && !this.activeKoma) {
      this._drawFinisherSlash(ctx, W, H)
    }

    // 5. 前置四主角实拍 Cut-in 动画（带点击跳过提示）
    if (!compactMode && !this.activeKoma && this.cutInAge < this.cutInDur) {
      this._drawCharacterCutIn(ctx, W, H, clock)
      if (this.introHolding) {
        ctx.save()
        ctx.fillStyle = 'rgba(11, 10, 14, 0.72)'
        ctx.fillRect(W - 148, H - 40, 132, 24)
        ctx.strokeStyle = 'rgba(244, 241, 234, 0.42)'
        ctx.lineWidth = 1
        ctx.strokeRect(W - 148, H - 40, 132, 24)
        ctx.fillStyle = '#f4f1ea'
        ctx.font = `600 11px ${FD_MONO_CODE}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('CLICK TO SKIP ▸', W - 82, H - 28)
        ctx.restore()
      }
    }

    // 6. 物语风章节落款卡
    if (settled && !charging && !hiddenMask && !this.activeKoma) {
      this._drawChapterSignature(ctx, W, H, { tier, total, settleTime, compactMode })
    }

    // 7. 最顶层：全屏切卡（黒/赤/白/紫/黄コマ）
    if (this.activeKoma) {
      this._drawFullscreenKoma(ctx, W, H, this.activeKoma, this.komaTimer, compactMode)
    }

    ctx.restore()
  }

  _drawFullscreenKoma(ctx, W, H, card, timer, compactMode) {
    ctx.save()
    ctx.fillStyle = card.bg
    ctx.fillRect(0, 0, W, H)
    const pad = compactMode ? 8 : 20
    ctx.strokeStyle = card.accent
    ctx.globalAlpha = 0.65
    ctx.lineWidth = compactMode ? 1.5 : 2
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2)

    ctx.globalAlpha = 0.14
    ctx.fillStyle = card.accent
    ctx.beginPath()
    ctx.moveTo(W * 0.72, 0); ctx.lineTo(W * 0.86, 0)
    ctx.lineTo(W * 0.68, H); ctx.lineTo(W * 0.54, H)
    ctx.closePath(); ctx.fill()

    ctx.globalAlpha = 1
    ctx.fillStyle = card.accent
    ctx.font = `700 ${compactMode ? 9 : 12}px ${FD_MONO_CODE}`
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(`${card.koma} // EP.${String(card.ep || 1).padStart(3, '0')}`, pad + 10, pad + 8)

    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillStyle = card.fg; ctx.globalAlpha = 0.74
    ctx.font = `700 ${compactMode ? 9 : 13}px ${FD_MONO_SERIF}`
    ctx.fillText(card.sub || '', W - pad - 10, H - pad - 8)

    const jx = (Math.sin(timer * 180) > 0 ? 1 : -1) * 0.8
    ctx.globalAlpha = 1; ctx.fillStyle = card.fg
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const baseSize = compactMode ? Math.max(16, Math.min(26, W * 0.085)) : Math.max(28, Math.min(56, W * 0.06))
    const fontSize = card.head.length <= 2 ? baseSize * 1.6 : (card.head.length > 9 ? baseSize * 0.74 : baseSize)
    ctx.font = `900 ${Math.round(fontSize)}px ${FD_MONO_SERIF}`
    ctx.fillText(card.head, W * 0.5 + jx, H * 0.5)

    const p = fdMonoClamp01(timer / Math.max(0.05, card.duration))
    ctx.fillStyle = card.accent
    ctx.fillRect(pad, H - pad - 3, (W - pad * 2) * p, 3)
    ctx.restore()
  }

  _drawCharacterCutIn(ctx, W, H, clock) {
    const t = this.cutInAge / Math.max(0.1, this.cutInDur)
    const enter = fdMonoEaseOut(this.cutInAge / 0.24)
    const exit = t > 0.86 ? (1 - fdMonoClamp01((t - 0.86) / 0.14)) : 1
    const alpha = enter * exit
    if (alpha <= 0.01) return

    ctx.save()
    ctx.globalAlpha = alpha
    const stripH = Math.max(160, Math.min(420, H * 0.74))
    const cy = H * 0.50

    if (this.cutInActor === 'dual' || this.cutInActor === 'dual2') {
      const [topA, botA] = this.cutInActor === 'dual' ? ['hitagi', 'shinobu'] : ['hanekawa', 'mayoi']
      const dualH = Math.max(110, Math.min(240, H * 0.42))
      this._drawSingleCutInBand(ctx, W, H * 0.28, dualH, topA, enter, exit, clock, -0.014)
      this._drawSingleCutInBand(ctx, W, H * 0.72, dualH, botA, enter, exit, clock, 0.014)
    } else {
      const meta = FD_MONO_ACTOR_META[this.cutInActor] || FD_MONO_ACTOR_META.hitagi
      this._drawSingleCutInBand(ctx, W, cy, stripH, this.cutInActor, enter, exit, clock, meta.alignLeft ? -0.012 : 0.012)
    }
    ctx.restore()
  }

  _drawSingleCutInBand(ctx, W, cy, bandH, actor, enter, exit, clock, tilt) {
    const meta = FD_MONO_ACTOR_META[actor] || FD_MONO_ACTOR_META.hitagi
    const alignLeft = meta.alignLeft
    const slideOffset = (1 - enter) * (alignLeft ? 100 : -100) + (1 - exit) * (alignLeft ? -60 : 60)

    ctx.save()
    ctx.translate(W * 0.5 + slideOffset, cy)
    ctx.rotate(tilt)
    const bw = W * 1.12
    const top = -bandH * 0.5
    ctx.fillStyle = meta.barBg
    ctx.fillRect(-bw * 0.5, top, bw, bandH)
    ctx.beginPath(); ctx.rect(-bw * 0.5, top, bw, bandH); ctx.clip()

    const vid = FD_MONO_MEDIA_POOL.getVideo(actor)
    const img = FD_MONO_MEDIA_POOL.getImage(actor)
    let drewMedia = false

    const drawProportional = (src, natW, natH) => {
      const scale = Math.max((W * 1.02) / natW, (bandH * 1.04) / natH) * (1.03 - enter * 0.03)
      const dw = natW * scale
      const dh = natH * scale
      ctx.drawImage(src, -dw * 0.5, -dh * 0.5, dw, dh)
      const grad = ctx.createLinearGradient(-W * 0.5, 0, W * 0.5, 0)
      if (alignLeft) {
        grad.addColorStop(0, 'rgba(10, 4, 8, 0.80)')
        grad.addColorStop(0.32, 'rgba(10, 4, 8, 0.16)')
        grad.addColorStop(0.62, 'rgba(10, 4, 8, 0.0)')
        grad.addColorStop(1, 'rgba(10, 4, 8, 0.12)')
      } else {
        grad.addColorStop(0, 'rgba(10, 6, 18, 0.12)')
        grad.addColorStop(0.38, 'rgba(10, 6, 18, 0.0)')
        grad.addColorStop(0.68, 'rgba(10, 6, 18, 0.16)')
        grad.addColorStop(1, 'rgba(10, 6, 18, 0.80)')
      }
      ctx.fillStyle = grad
      ctx.fillRect(-bw * 0.5, top, bw, bandH)
      drewMedia = true
    }

    if (vid && vid.readyState >= 2 && vid.videoWidth > 0 && vid.videoHeight > 0) {
      drawProportional(vid, vid.videoWidth, vid.videoHeight)
    } else if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      drawProportional(img, img.naturalWidth, img.naturalHeight)
    }

    if (!drewMedia) {
      ctx.strokeStyle = meta.border
      ctx.globalAlpha = 0.25
      ctx.lineWidth = 1.2
      for (let i = -8; i <= 8; i++) {
        const lx = i * 64 + ((clock * 120) % 64)
        ctx.beginPath(); ctx.moveTo(lx - 26, top); ctx.lineTo(lx + 26, top + bandH); ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    ctx.textAlign = alignLeft ? 'left' : 'right'
    ctx.textBaseline = 'middle'
    const tx = alignLeft ? -W * 0.43 : W * 0.43
    ctx.fillStyle = meta.label
    ctx.font = `700 11px ${FD_MONO_CODE}`
    ctx.shadowColor = 'rgba(0,0,0,0.92)'; ctx.shadowBlur = 10
    ctx.fillText(meta.title, tx, -bandH * 0.14)
    ctx.fillStyle = '#fbf8f2'
    ctx.font = `900 ${Math.round(Math.min(34, bandH * 0.145))}px ${FD_MONO_SERIF}`
    ctx.fillText(this.cutInCaption || '確定。', tx, bandH * 0.08)
    ctx.fillStyle = meta.border
    ctx.fillRect(alignLeft ? tx : tx - 130, bandH * 0.22, 130, 2.5)
    ctx.shadowBlur = 0
    ctx.restore()

    ctx.save()
    ctx.translate(W * 0.5 + slideOffset, cy)
    ctx.rotate(tilt)
    ctx.fillStyle = meta.border
    ctx.fillRect(-bw * 0.5, top, bw, 3)
    ctx.fillRect(-bw * 0.5, top + bandH - 3, bw, 3)
    ctx.restore()
  }

  _drawImpactPops(ctx, W, H, projectToUV) {
    const tmp = { u: 0, v: 0, visible: false }
    for (const pop of this.impactPops) {
      projectToUV(pop.x, pop.y, pop.z + 18, tmp)
      if (!tmp.visible) continue
      const p = fdMonoClamp01(pop.age / pop.dur)
      const alpha = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8
      ctx.save()
      ctx.translate(tmp.u * W, (1 - tmp.v) * H - p * 16)
      ctx.globalAlpha = alpha
      ctx.rotate(pop.red ? -0.14 : 0.11)
      const sz = Math.round(26 * pop.scale)
      ctx.fillStyle = pop.red ? '#d91e2a' : '#0b0a0e'
      ctx.fillRect(-sz * 0.55, -sz * 0.55, sz * 1.1, sz * 1.1)
      ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 1.3
      ctx.strokeRect(-sz * 0.55, -sz * 0.55, sz * 1.1, sz * 1.1)
      ctx.fillStyle = '#f4f1ea'
      ctx.font = `900 ${Math.round(sz * 0.72)}px ${FD_MONO_SERIF}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(pop.kanji, 0, 1)
      ctx.restore()
    }
  }

  _drawFinisherSlash(ctx, W, H) {
    const p = fdMonoClamp01(this.slashAge / 1.1)
    const isKokoro = this.slashKind === 'kokorowatari'
    const alpha = p < 0.14 ? p / 0.14 : Math.pow(1 - (p - 0.14) / 0.86, 1.5)
    if (alpha <= 0.01) return
    ctx.save()
    ctx.globalAlpha = alpha
    const x0 = isKokoro ? W * 0.06 : W * 0.92
    const y0 = isKokoro ? H * 0.86 : H * 0.16
    const x1 = isKokoro ? W * 0.94 : W * 0.08
    const y1 = isKokoro ? H * 0.14 : H * 0.84
    ctx.strokeStyle = isKokoro ? '#d91e2a' : '#8e55d6'
    ctx.lineWidth = (isKokoro ? 20 : 13) * (1 - p * 0.7)
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
    ctx.strokeStyle = isKokoro ? '#fff6d6' : '#f4f1ea'
    ctx.lineWidth = (isKokoro ? 6 : 4) * (1 - p * 0.5)
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
    ctx.restore()
  }

  _drawDiceLeaderLines(ctx, W, H, dice, tier, settleTime, projectToUV) {
    if (!dice || dice.length === 0 || dice.length > 6) return
    const appear = fdMonoEaseOut((settleTime - 0.16) / 0.24)
    if (appear <= 0.01) return
    const tmp = { u: 0, v: 0, visible: false }
    const accent = tier === 'critical' ? '#f2b63d' : (tier === 'fumble' ? '#d91e2a' : '#f4f1ea')
    ctx.save()
    ctx.globalAlpha = appear * 0.92
    for (let i = 0; i < dice.length; i++) {
      const d = dice[i]
      projectToUV(d.x, d.y, d.z + d.radius * 0.6, tmp)
      if (!tmp.visible) continue
      const px = tmp.u * W, py = (1 - tmp.v) * H
      const dir = px > W * 0.52 ? 1 : -1
      const kx = px + dir * 22, ky = py - 22, ex = kx + dir * 52
      ctx.fillStyle = '#d91e2a'; ctx.fillRect(px - 2.5, py - 2.5, 5, 5)
      ctx.strokeStyle = accent; ctx.lineWidth = 1.15
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(kx, ky); ctx.lineTo(ex, ky); ctx.stroke()
      const faceVal = d.faceValue !== undefined ? d.faceValue : (d.targetFace ? d.targetFace.value : '?')
      const tag = `${String(d.meshKey || 'D').toUpperCase()} // ${faceVal}`
      ctx.font = `700 10px ${FD_MONO_CODE}`
      const tw = ctx.measureText(tag).width + 10
      const bx = dir > 0 ? ex - tw : ex
      ctx.fillStyle = 'rgba(11, 10, 14, 0.86)'; ctx.fillRect(bx, ky - 16, tw, 15)
      ctx.fillStyle = accent; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(tag, bx + 5, ky - 8.5)
    }
    ctx.restore()
  }

  _drawHiddenCensorSeals(ctx, W, H, dice, clock, projectToUV) {
    const tmp = { u: 0, v: 0, visible: false }
    const pulse = 0.72 + 0.28 * Math.sin(clock * 4.5)
    ctx.save()
    for (let i = 0; i < Math.min(6, dice.length); i++) {
      const d = dice[i]
      projectToUV(d.x, d.y, d.z + d.radius * 0.7, tmp)
      if (!tmp.visible) continue
      ctx.save()
      ctx.translate(tmp.u * W, (1 - tmp.v) * H)
      ctx.rotate(i % 2 === 0 ? -0.18 : 0.14)
      ctx.fillStyle = '#0b0a0e'; ctx.fillRect(-38, -12, 76, 24)
      ctx.strokeStyle = `rgba(217, 30, 42, ${pulse})`; ctx.lineWidth = 1.8
      ctx.strokeRect(-38, -12, 76, 24)
      ctx.fillStyle = '#d91e2a'; ctx.font = `900 11px ${FD_MONO_SERIF}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('検閲済', 0, 1)
      ctx.restore()
    }
    ctx.restore()
  }

  _drawChapterSignature(ctx, W, H, { tier, total, settleTime, compactMode }) {
    const appear = fdMonoEaseOut((settleTime - 0.10) / 0.22)
    if (appear <= 0.01) return
    const lead = this.actor === 'dual' ? 'hitagi' : (this.actor === 'dual2' ? 'hanekawa' : this.actor)
    const meta = FD_MONO_ACTOR_META[lead] || FD_MONO_ACTOR_META.hitagi
    const cardW = compactMode ? 96 : 132
    const cardH = compactMode ? 46 : 62
    const sx = compactMode ? W - cardW * 0.5 - 10 : W - cardW * 0.5 - 18
    const sy = compactMode ? H - cardH * 0.5 - 10 : Math.min(118, H * 0.28)
    const tierLabel = { critical: '大成功', success: '成立', costly: '代償', failure: '不成立', fumble: '大失敗', normal: '確定' }[tier] || '成立'

    ctx.save()
    ctx.translate(sx, sy + (1 - appear) * 8)
    ctx.globalAlpha = appear
    ctx.fillStyle = 'rgba(11, 10, 14, 0.94)'
    ctx.fillRect(-cardW * 0.5, -cardH * 0.5, cardW, cardH)
    ctx.strokeStyle = tier === 'fumble' ? '#d91e2a' : 'rgba(244, 241, 234, 0.72)'
    ctx.lineWidth = 1.4
    ctx.strokeRect(-cardW * 0.5, -cardH * 0.5, cardW, cardH)
    ctx.fillStyle = meta.border
    ctx.fillRect(-cardW * 0.5, -cardH * 0.5, 6, cardH)

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillStyle = meta.label; ctx.font = `700 ${compactMode ? 8 : 9}px ${FD_MONO_CODE}`
    ctx.fillText(`第${String(this.episodeNo).padStart(2, '0')}話 // ${meta.code}`, -cardW * 0.5 + 14, -cardH * 0.24)
    ctx.fillStyle = tier === 'fumble' ? '#ff4252' : '#f4f1ea'
    ctx.font = `900 ${compactMode ? 14 : 18}px ${FD_MONO_SERIF}`
    ctx.fillText(tierLabel, -cardW * 0.5 + 14, compactMode ? 5 : 4)
    ctx.textAlign = 'right'; ctx.fillStyle = meta.border
    ctx.font = `900 ${compactMode ? 15 : 21}px ${FD_MONO_SERIF}`
    ctx.fillText(String(total), cardW * 0.5 - 10, compactMode ? 5 : 6)

    if (lead === 'hitagi' && this.stapleAge < 90) {
      ctx.strokeStyle = '#e8ecf2'; ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(-cardW * 0.5 - 4, -cardH * 0.5 + 10); ctx.lineTo(-cardW * 0.5 + 12, -cardH * 0.5 - 4)
      ctx.moveTo(cardW * 0.5 - 12, cardH * 0.5 + 4); ctx.lineTo(cardW * 0.5 + 4, cardH * 0.5 - 10)
      ctx.stroke()
    }
    ctx.restore()
  }
}
