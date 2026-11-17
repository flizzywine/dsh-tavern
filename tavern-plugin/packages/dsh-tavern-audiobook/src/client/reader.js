/* ------------------------------------------------------------------ *
 * reader.js — the one reader (owner 11-16): continuous reading of the story, a page = one screen of it.
 * What is read and how a line sounds are Tavern's (tavernUi.readingUnits / playReading, the stage's own reading);
 * this file decides where to start, follows the sentence down the story and keeps the reader's place.
 * ------------------------------------------------------------------ */
const AB_SWITCH_KEY = 'dsh-tavern-audiobook'
const AB_PREFS_KEY = 'dsh-tavern-audiobook-prefs'
const AB_PLACES_KEY = 'dsh-tavern-audiobook-places'
const AB_AHEAD = 3
const AB_BREATH = 160
const AB_HIGHLIGHT = 'dsh-audiobook'
// The voice service itself is away (not this line's voice): skipping on would lose the sentences, so the reading stops at
// this one and 播放 says it again.
const AB_SERVICE_DOWN = new Set(['voice-unavailable', 'SERVICE_OFFLINE', 'TTS_UNAVAILABLE', 'TTS_DISABLED', 'PLUGIN_UNAVAILABLE', 'TIMEOUT'])

function abStore(key, initial, parse) {
  let value = initial
  try { const raw = window.localStorage.getItem(key); if (raw !== null) value = parse(raw) } catch (_) {}
  const listeners = new Set()
  return {
    get: () => value,
    set(next) {
      value = next
      try { window.localStorage.setItem(key, typeof next === 'string' ? next : JSON.stringify(next)) } catch (_) {}
      for (const fn of Array.from(listeners)) fn()
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
  }
}
// The switch (语音后端 › 朗读全文 › 有声书), kept in this browser; default off.
const abSwitch = abStore(AB_SWITCH_KEY, 'off', raw => raw)
// The panel's settings: volume 0..1, rate, voice (null = 旁白声音; {figure, name} | {browser, name}), lines (figure | reader).
const abPrefs = abStore(AB_PREFS_KEY, { volume: 0.8, rate: 1, voice: null, lines: 'figure' }, raw => ({ volume: 0.8, rate: 1, voice: null, lines: 'figure', ...JSON.parse(raw) }))

// Where a reading stops, kept per chat (the 40 read last): the unit and the start of its words.
function abPlace(unit) { return { row: unit.row, n: unit.n, text: unit.text.slice(0, 24) } }
function abPlaces() { try { return JSON.parse(window.localStorage.getItem(AB_PLACES_KEY) || '{}') } catch (_) { return {} } }
function abKeepPlace(gameId, place) {
  const places = abPlaces()
  delete places[gameId]
  places[gameId] = place
  const keys = Object.keys(places)
  for (const key of keys.slice(0, Math.max(0, keys.length - 40))) delete places[key]
  try { window.localStorage.setItem(AB_PLACES_KEY, JSON.stringify(places)) } catch (_) {}
}
function abPlaceIndex(units, place) {
  if (!place) return -1
  const same = units.findIndex(unit => unit.row === place.row && unit.n === place.n && unit.text.startsWith(place.text))
  return same >= 0 ? same : units.findIndex(unit => unit.row === place.row)
}
// The owner's rule for 播放: the reader did not scroll or jump since (moved false) → go on where it stopped; otherwise → the
// first sentence of the screen (`screen`, read only when needed). Neither: the newest reply's first sentence.
function abStartIndex({ units, place, moved, screen }) {
  if (!units.length) return -1
  const kept = moved ? -1 : abPlaceIndex(units, place)
  if (kept >= 0) return kept
  const shown = screen()
  if (shown >= 0) return shown
  const last = units[units.length - 1].row
  return units.findIndex(unit => unit.row === last)
}
// The pause before a unit (ms): none inside a paragraph, a short breath between paragraphs.
function abPause(previous, next) { return previous && next && previous.row === next.row && previous.para === next.para ? 0 : AB_BREATH }
// The page's words without white space, with where each character came from.
function abFlat(nodes) {
  let text = ''
  const at = []
  nodes.forEach(node => { const value = node.nodeValue || ''; for (let i = 0; i < value.length; i++) if (!/\s/.test(value[i])) { text += value[i]; at.push([node, i]) } })
  return { text, at }
}
// Where a unit's words stand in the flattened page text, from `from` on (then from the start): [start, end) or null. A unit
// whose page text was rewritten (a card's display regex) matches by its first words.
function abFind(flat, needle, from = 0) {
  const want = String(needle).replace(/\s+/g, '')
  if (!want) return null
  for (const probe of [want, want.slice(0, 12)]) {
    let start = flat.indexOf(probe, from)
    if (start < 0) start = flat.indexOf(probe)
    if (start >= 0) return [start, start + probe.length]
  }
  return null
}
// The story's scrolling box: the visible [data-conversation-scroll] holding story rows ([data-story-row][data-row-key]).
function abScroller() {
  const boxes = Array.from(document.querySelectorAll('[data-conversation-scroll]')).filter(node => node.querySelector('[data-story-row]'))
  return boxes.find(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 }) || null
}
function abRowFlat(element) {
  const nodes = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: node =>
    node.parentElement && node.parentElement.closest(".dsh-tavern-story-floor-head, .fork-bubble-head, button, [aria-hidden='true'], script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
  return abFlat(nodes)
}

// state: {gameId, status: idle | loading | playing | paused, unit, following, error}
function createAudiobook(ui) {
  let state = { gameId: '', status: 'idle', unit: null, following: true, error: '' }
  const listeners = new Set(), flats = new WeakMap()
  // units, where it is, token (a newer step cancels older ones), moved (the reader scrolled or jumped since)
  let units = [], index = -1, token = 0, moved = true, failures = 0, offIntent = null
  function set(patch) { state = { ...state, ...patch }; for (const fn of Array.from(listeners)) fn() }
  function current() { return index >= 0 ? units[index] || null : null }
  function options() { const prefs = abPrefs.get(); return { voice: prefs.voice, lines: prefs.lines, volume: prefs.volume, rate: prefs.rate } }
  // ---- the page ---------------------------------------------------------------------------------------------------
  function locate(unit) {
    const box = abScroller(), element = box ? box.querySelector('[data-story-row][data-row-key="' + CSS.escape(unit.row) + '"]') : null
    if (!element || element.classList.contains('dsh-tavern-story-held')) return { box, element, range: null }
    let flat = flats.get(element)
    if (!flat || flat.revision !== element.textContent.length) { flat = { ...abRowFlat(element), revision: element.textContent.length, cursor: new Map() }; flats.set(element, flat) }
    const previous = units[units.indexOf(unit) - 1]
    const from = previous && previous.row === unit.row ? flat.cursor.get(previous.n) || 0 : 0
    const found = abFind(flat.text, unit.text, from)
    if (!found) return { box, element, range: null }
    flat.cursor.set(unit.n, found[1])
    const range = document.createRange(), [startNode, startOffset] = flat.at[found[0]], [endNode, endOffset] = flat.at[found[1] - 1]
    range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset + 1)
    return { box, element, range }
  }
  function light(range) {
    if (typeof CSS === 'undefined' || !CSS.highlights) return
    if (range && typeof Highlight === 'function') CSS.highlights.set(AB_HIGHLIGHT, new Highlight(range))
    else CSS.highlights.delete(AB_HIGHLIGHT)
  }
  // Keep the sentence on screen: near the bottom (or above the top) it glides up to stand 12% below the top. A floor still
  // held (long chats mount only floors near the reader) is scrolled to first and looked for again.
  function follow(unit, attempt = 0) {
    const at = locate(unit)
    light(at.range)
    if (!at.box || !state.following) return
    const view = at.box.getBoundingClientRect()
    const rect = at.range ? at.range.getBoundingClientRect() : at.element ? at.element.getBoundingClientRect() : null
    if (!rect) return
    if (rect.top < view.top + 8 || rect.bottom > view.bottom - view.height * 0.15) at.box.scrollTo({ top: at.box.scrollTop + rect.top - view.top - view.height * 0.12, behavior: at.range ? 'smooth' : 'auto' })
    if (!at.range && attempt < 12) setTimeout(() => { if (current() === unit) follow(unit, attempt + 1) }, 80)
  }
  // The first sentence of the screen: the first unit whose words start inside the visible story.
  function screenIndex() {
    const box = abScroller()
    if (!box) return -1
    const view = box.getBoundingClientRect()
    for (const element of box.querySelectorAll('[data-story-row][data-role="assistant"]')) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom <= view.top || rect.top >= view.bottom) continue
      const key = element.getAttribute('data-row-key')
      for (let i = units.findIndex(unit => unit.row === key); i >= 0 && i < units.length && units[i].row === key; i++) {
        const range = locate(units[i]).range, top = range ? range.getBoundingClientRect().top : null
        if (top !== null && top >= view.top - 1 && top < view.bottom) return i
      }
    }
    return -1
  }
  // A wheel, touch drag, scrolling key or a floor jump by the reader: 播放 then starts at the screen, and while reading the
  // story stops following (回到朗读处 brings it back). The reader's own scrolling is not a move.
  function watchIntent() {
    offIntent?.()
    const box = abScroller()
    if (!box) return
    const move = () => { moved = true; if (state.following && state.status !== 'idle') set({ following: false }) }
    const key = event => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key)) move() }
    const jump = event => { if (event.target && event.target.closest && event.target.closest('.dsh-tavern-turn-rail, .fork-jump-latest')) move() }
    box.addEventListener('wheel', move, { passive: true }); box.addEventListener('touchmove', move, { passive: true }); box.addEventListener('keydown', key)
    document.addEventListener('pointerdown', jump, true)
    offIntent = () => { box.removeEventListener('wheel', move); box.removeEventListener('touchmove', move); box.removeEventListener('keydown', key); document.removeEventListener('pointerdown', jump, true); offIntent = null }
  }
  // ---- reading ----------------------------------------------------------------------------------------------------
  // Synthesize units one after another, each once the one before is ready (or failed): the voice service says one line at a
  // time in the order asked, and lines asked together race (whose voice opens first goes first), so the next sentence could
  // wait behind a later one. A newer step (token) ends the chain.
  function inOrder(keys, mine = token) {
    const gameId = state.gameId, o = options()
    return keys.reduce((chain, key) => chain.then(() => { if (mine === token && state.gameId === gameId) return ui.prepareReading(gameId, key, o).catch(() => {}) }), Promise.resolve())
  }
  const ahead = () => units.slice(index + 1, index + 1 + AB_AHEAD).map(unit => unit.key)
  async function playUnit() {
    const mine = ++token
    const unit = current()
    if (!unit) { finish(); return }
    abKeepPlace(state.gameId, abPlace(unit))
    set({ unit, status: state.status === 'playing' ? 'playing' : 'loading', error: '' })
    follow(unit)
    mediaSession(unit)
    // this sentence asks for its voice first, the ones ahead after it (Drama 3, 11-16: a sentence queued behind its prefetched
    // followers sounded after 5.1 s instead of 1.7 s)
    const playing = ui.playReading(state.gameId, unit.key, { ...options(), onStart: () => { if (mine === token) { failures = 0; set({ status: 'playing' }) } } })
    void inOrder([unit.key, ...ahead()], mine)
    const result = await playing
    if (mine !== token) return
    if (result.stopped) { set({ status: 'paused' }); return }
    if (result.error) {
      // a line that cannot be said is skipped; three in a row (or the last one) stop the reading with the reason
      if (AB_SERVICE_DOWN.has(result.error) || ++failures >= 3 || index + 1 >= units.length) { set({ status: 'paused', error: result.error }); return }
      index++; return playUnit()
    }
    const before = unit, next = units[index + 1]
    index++
    const wait = result.ended ? abPause(before, next) : 0
    if (wait) setTimeout(() => { if (mine === token) void playUnit() }, wait); else void playUnit()
  }
  function finish() {
    light(null); index = -1
    set({ status: 'idle', unit: null })
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'
  }
  function mediaSession(unit) {
    if (typeof navigator === 'undefined' || !navigator.mediaSession || typeof MediaMetadata !== 'function') return
    navigator.mediaSession.metadata = new MediaMetadata({ title: '第 ' + unit.floor + ' 楼', artist: unit.speaker || '旁白', album: '有声书' })
    navigator.mediaSession.playbackState = 'playing'
    const actions = { play: () => api.play(), pause: () => api.pause(), previoustrack: () => api.step(-1), nexttrack: () => api.step(1), stop: () => api.pause() }
    for (const [name, run] of Object.entries(actions)) { try { navigator.mediaSession.setActionHandler(name, run) } catch (_) {} }
  }
  const api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    get: () => state,
    // the chip of a chat binds the reader to it; another chat's reading stops.
    bind(gameId) {
      if (state.gameId === gameId) return
      api.stop()
      moved = !abPlaces()[gameId]
      set({ gameId, following: true, error: '' })
      // scrolling before 播放 (and after 结束朗读) is a move too: the watch stays on while the chat is bound
      watchIntent()
    },
    // Warm the start: the panel opened, so 播放 is likely; its first lines are synthesized now.
    async prepare() {
      const gameId = state.gameId
      if (!gameId || state.status !== 'idle') return
      watchIntent()
      try {
        units = await ui.readingUnits(gameId)
        if (state.gameId !== gameId || state.status !== 'idle') return
        const start = abStartIndex({ units, place: abPlaces()[gameId], moved, screen: screenIndex })
        if (start >= 0) void inOrder(units.slice(start, start + 2).map(unit => unit.key))
      } catch (_) {}
    },
    async play() {
      const gameId = state.gameId
      if (!gameId) return
      if (state.status === 'paused' && !moved && ui.resumeReading()) { set({ status: 'playing', following: true }); return }
      const mine = ++token
      ui.stopReading()
      set({ status: 'loading', error: '', following: true })
      try { units = await ui.readingUnits(gameId) }
      catch (error) { if (mine === token) set({ status: 'idle', error: error && error.code || 'STORY_UNAVAILABLE' }); return }
      if (mine !== token) return
      index = abStartIndex({ units, place: abPlaces()[gameId], moved, screen: screenIndex })
      moved = false; failures = 0
      watchIntent()
      if (index < 0) { finish(); return }
      await playUnit()
    },
    pause() {
      if (ui.pauseReading()) set({ status: 'paused' })
      else if (state.status === 'loading') { token++; ui.stopReading(); set({ status: 'paused' }) }
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
    },
    // 上一句 / 下一句: from the sentence before or after the one being read (or last read), playing.
    step(by) {
      if (!units.length || index < 0) return
      index = Math.max(0, Math.min(units.length - 1, index + by))
      moved = false
      set({ following: true, status: 'playing' })
      void playUnit()
    },
    // 回到朗读处: follow again and bring the sentence back on screen.
    refollow() { moved = false; set({ following: true }); const unit = current(); if (unit) follow(unit) },
    stop() { token++; ui.stopReading(); finish() },
    // the plugin unloads: stop and let go of the story's scrolling box
    dispose() { api.stop(); offIntent?.() },
    tune() { const prefs = abPrefs.get(); ui.tuneReading({ volume: prefs.volume, rate: prefs.rate }) },
    // a new voice or reading of lines starts the current sentence again in it
    revoice() { if (state.status === 'playing' || state.status === 'loading') void playUnit() },
    diagnostics: () => ({ gameId: state.gameId, status: state.status, error: state.error, index, units: units.length, moved, following: state.following, unit: state.unit && state.unit.key })
  }
  return api
}
