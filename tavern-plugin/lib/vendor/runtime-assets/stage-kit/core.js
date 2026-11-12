// dsh stage-kit core (Card Stage, src/client/card-stage.js).
// Runs inside a Card Stage iframe; wraps window.dshStage with reactive
// bindings, one shared animation loop and quality hints.

const S = window.dshStage
if (!S) throw new Error('stage-kit 只能在人物卡舞台中使用')
export const stage = S

/* ---------------- paths & values ---------------- */
function split(path) {
  return Array.isArray(path) ? path : String(path || '').split(/[./]/).filter(Boolean)
}
export function getPath(source, path, fallback) {
  let value = source
  for (const part of split(path)) {
    if (value === null || value === undefined) return fallback
    value = value[part]
  }
  return value === undefined ? fallback : value
}
/** "a.b" reads stat_data; "@a.b" reads the full variable object. */
export function read(path, fallback) {
  const text = String(path || '')
  if (text.startsWith('@')) return getPath(S.vars(), text.slice(1), fallback)
  return getPath(S.stat(), text, fallback)
}
export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : fallback
}
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
export const lerp = (a, b, t) => a + (b - a) * t
/** "21:30" / "晚上9点" → 21.5; falls back to noon. */
export function parseHour(value) {
  const text = String(value ?? '')
  const clock = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/)
  if (clock) return (Number(clock[1]) % 24) + Number(clock[2]) / 60
  const hour = text.match(/(\d{1,2})\s*[点時时]/)
  if (hour) {
    let h = Number(hour[1]) % 24
    if (/(下午|晚上|傍晚|夜)/.test(text) && h < 12) h += 12
    return h
  }
  if (/(深夜|午夜|凌晨)/.test(text)) return 1
  if (/(清晨|早晨|黎明)/.test(text)) return 6
  if (/(黄昏|傍晚)/.test(text)) return 18
  if (/(夜|晚)/.test(text)) return 21
  return 12
}

/* ---------------- reactive bindings ---------------- */
const watchers = new Set()
let snapshot = null
function notify() {
  for (const watcher of watchers) watcher.check()
}
S.on('vars', () => { snapshot = null; notify() })
/**
 * Call fn(value, previous) whenever the bound value changes (deep compare).
 * Returns an unsubscribe function.
 */
export function watch(path, fn, { immediate = true } = {}) {
  let last
  let first = true
  const watcher = {
    check() {
      const value = typeof path === 'function' ? path(S.stat(), S.vars()) : read(path)
      const key = JSON.stringify(value ?? null)
      if (!first && key === last) return
      const previous = last === undefined ? undefined : JSON.parse(last)
      last = key
      if (first && !immediate) { first = false; return }
      first = false
      fn(value, previous)
    }
  }
  watchers.add(watcher)
  watcher.check()
  return () => watchers.delete(watcher)
}
export function onHost(fn) { return S.on('host', fn) }
export function onLayout(fn) { return S.on('layout', fn) }
export function onTurn(fn) { return S.on('turn', fn) }

/* ---------------- one animation loop per frame ---------------- */
const tasks = new Set()
let raf = 0, last = 0
function running() {
  const host = S.host || {}
  return host.visible !== false && document.visibilityState !== 'hidden'
}
export function motionScale() { return S.host && S.host.reducedMotion ? 0.25 : 1 }
function frame(now) {
  raf = 0
  if (!tasks.size || !running()) { last = 0; return }
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
  last = now
  const scaled = dt * motionScale()
  for (const task of tasks) {
    try { task(scaled, now / 1000) } catch (error) { console.error(error); tasks.delete(task) }
  }
  raf = requestAnimationFrame(frame)
}
function kick() { if (!raf && tasks.size && running()) raf = requestAnimationFrame(frame) }
S.on('host', kick)
document.addEventListener('visibilitychange', kick)
/** Register fn(dt, seconds) on the shared loop. Paused while hidden. */
export function loop(fn) {
  tasks.add(fn)
  kick()
  return () => tasks.delete(fn)
}

/** Smoothly follows a target value on the shared loop. */
export function follow(initial = 0, rate = 5) {
  let value = initial, target = initial, stop = null
  const api = {
    get value() { return value },
    get target() { return target },
    set(next, { instant = false } = {}) {
      target = next
      if (instant) value = next
      if (!stop && value !== target) stop = loop(step)
      return api
    },
    onChange: null
  }
  function step(dt) {
    value += (target - value) * Math.min(1, dt * rate)
    if (Math.abs(target - value) < 1e-4) { value = target; stop(); stop = null }
    if (api.onChange) api.onChange(value)
  }
  return api
}

/* ---------------- quality ---------------- */
export function quality() {
  const host = S.host || {}
  if (host.reducedMotion) return 'low'
  const cores = navigator.hardwareConcurrency || 4
  return cores <= 4 ? 'medium' : 'high'
}
/** Device pixel ratio capped for canvases (full-screen backdrops are large). */
export function pixelRatio(max = 1.5) { return Math.min(window.devicePixelRatio || 1, quality() === 'low' ? 1 : max) }
export function safeArea() { return S.safeArea() }

/* ---------------- colors ---------------- */
export function parseColor(value) {
  const probe = parseColor.ctx || (parseColor.ctx = document.createElement('canvas').getContext('2d'))
  probe.fillStyle = '#000'
  probe.fillStyle = String(value || '#000')
  const hex = probe.fillStyle
  if (hex.startsWith('#')) return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 1]
  const parts = hex.match(/[\d.]+/g) || [0, 0, 0, 1]
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), Number(parts[3] ?? 1)]
}
export function mixColor(a, b, t) {
  const x = parseColor(a), y = parseColor(b)
  return `rgba(${Math.round(lerp(x[0], y[0], t))},${Math.round(lerp(x[1], y[1], t))},${Math.round(lerp(x[2], y[2], t))},${lerp(x[3], y[3], t).toFixed(3)})`
}
/** Stable pleasant hue for a name (for per-character accents). */
export function colorFor(name, saturation = 72, lightness = 64) {
  let hash = 0
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0
  return `hsl(${hash % 360} ${saturation}% ${lightness}%)`
}
