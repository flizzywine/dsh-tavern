// Canvas 2D particle presets shared by <stage-weather> and <stage-particles>.
// One canvas per element, pooled particles, density scaled by area and quality.
import { loop, pixelRatio, quality, parseColor } from './core.js'

const rand = (a, b) => a + Math.random() * (b - a)

export const PRESETS = {
  rain: {
    density: 1 / 1600, color: '#a9bcdf',
    spawn: (p, w, h, top) => { p.x = rand(-40, w + 40); p.y = top ? rand(-h, 0) : rand(0, h); p.v = rand(900, 1300); p.l = rand(10, 22); p.a = rand(0.25, 0.6) },
    step: (p, dt, w, h, t, wind) => { p.y += p.v * dt; p.x += wind * 120 * dt; return p.y < h + 30 },
    draw: (g, p, rgb, wind) => { g.strokeStyle = `rgba(${rgb},${p.a})`; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - wind * p.l * 0.3, p.y - p.l); g.stroke() }
  },
  snow: {
    density: 1 / 4200, color: '#ffffff',
    spawn: (p, w, h, top) => { p.x = rand(0, w); p.y = top ? rand(-40, 0) : rand(0, h); p.r = rand(1, 3.2); p.v = rand(25, 70) * (p.r / 2); p.s = rand(0, 6.28); p.a = rand(0.4, 0.9) },
    step: (p, dt, w, h, t, wind) => { p.y += p.v * dt; p.x += (Math.sin(t * 0.8 + p.s) * 18 + wind * 40) * dt; return p.y < h + 10 },
    draw: (g, p, rgb) => { g.fillStyle = `rgba(${rgb},${p.a})`; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill() }
  },
  petals: {
    density: 1 / 14000, color: '#ffc4d8',
    spawn: (p, w, h, top) => { p.x = rand(-20, w); p.y = top ? rand(-40, 0) : rand(0, h); p.r = rand(4, 8); p.v = rand(30, 60); p.s = rand(0, 6.28); p.rot = rand(0, 6.28); p.a = rand(0.55, 0.9) },
    step: (p, dt, w, h, t, wind) => { p.y += p.v * dt; p.x += (Math.sin(t + p.s) * 30 + 25 + wind * 60) * dt; p.rot += dt * 1.6; return p.y < h + 20 && p.x < w + 30 },
    draw: (g, p, rgb) => { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(Math.sin(p.rot * 0.7)) * 0.6 + 0.4); g.fillStyle = `rgba(${rgb},${p.a})`; g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 6.283); g.fill(); g.restore() }
  },
  fireflies: {
    density: 1 / 26000, color: '#e8ff9a', glow: true,
    spawn: (p, w, h) => { p.x = rand(0, w); p.y = rand(h * 0.3, h); p.s = rand(0, 6.28); p.r = rand(1.2, 2.4); p.vx = rand(-12, 12); p.vy = rand(-12, 12) },
    step: (p, dt, w, h, t) => { p.x += (p.vx + Math.sin(t * 0.7 + p.s) * 10) * dt; p.y += (p.vy + Math.cos(t * 0.5 + p.s) * 10) * dt; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1; return true },
    draw: (g, p, rgb, wind, t) => { const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2 + p.s)); g.fillStyle = `rgba(${rgb},${a})`; g.beginPath(); g.arc(p.x, p.y, p.r * 3, 0, 6.283); g.fill() }
  },
  embers: {
    density: 1 / 16000, color: '#ffa04a', glow: true,
    spawn: (p, w, h, top) => { p.x = rand(0, w); p.y = top ? h + rand(0, 40) : rand(0, h); p.v = rand(30, 80); p.s = rand(0, 6.28); p.r = rand(0.8, 2.2); p.life = rand(3, 7); p.age = 0 },
    step: (p, dt, w, h, t, wind) => { p.age += dt; p.y -= p.v * dt; p.x += (Math.sin(t * 2 + p.s) * 20 + wind * 50) * dt; return p.age < p.life && p.y > -20 },
    draw: (g, p, rgb) => { const a = 1 - p.age / p.life; g.fillStyle = `rgba(${rgb},${a})`; g.beginPath(); g.arc(p.x, p.y, p.r * 2, 0, 6.283); g.fill() }
  },
  // Rising luminous wisps: spiritual energy, magic residue, auras.
  qi: {
    density: 1 / 20000, color: '#9fe6ff', glow: true,
    spawn: (p, w, h, top) => { p.x = rand(0, w); p.y = top ? h + rand(0, 60) : rand(0, h); p.v = rand(18, 45); p.s = rand(0, 6.28); p.r = rand(8, 26); p.life = rand(5, 10); p.age = 0 },
    step: (p, dt, w, h, t) => { p.age += dt; p.y -= p.v * dt; p.x += Math.sin(t * 0.6 + p.s) * 14 * dt; return p.age < p.life },
    draw: (g, p, rgb) => { const k = p.age / p.life, a = Math.sin(k * Math.PI) * 0.22; const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); grad.addColorStop(0, `rgba(${rgb},${a})`); grad.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = grad; g.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2) }
  },
  dust: {
    density: 1 / 18000, color: '#fff3d6',
    spawn: (p, w, h) => { p.x = rand(0, w); p.y = rand(0, h); p.s = rand(0, 6.28); p.r = rand(0.5, 1.5); p.vx = rand(-6, 6); p.vy = rand(-4, 4) },
    step: (p, dt, w, h, t) => { p.x = (p.x + (p.vx + Math.sin(t * 0.3 + p.s) * 4) * dt + w) % w; p.y = (p.y + p.vy * dt + h) % h; return true },
    draw: (g, p, rgb, wind, t) => { g.fillStyle = `rgba(${rgb},${0.2 + 0.3 * Math.abs(Math.sin(t * 0.8 + p.s))})`; g.fillRect(p.x, p.y, p.r * 2, p.r * 2) }
  },
  sparkles: {
    density: 1 / 22000, color: '#ffffff', glow: true,
    spawn: (p, w, h) => { p.x = rand(0, w); p.y = rand(0, h); p.s = rand(0, 6.28); p.r = rand(1.5, 3.5); p.life = rand(1.2, 2.8); p.age = rand(0, p.life) },
    step: (p, dt) => { p.age += dt; return p.age < p.life },
    draw: (g, p, rgb) => { const a = Math.sin(p.age / p.life * Math.PI); const r = p.r * a * 2; g.strokeStyle = `rgba(${rgb},${a})`; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x - r, p.y); g.lineTo(p.x + r, p.y); g.moveTo(p.x, p.y - r); g.lineTo(p.x, p.y + r); g.stroke() }
  }
}

/** Keyword → preset for free-text weather variables. */
export function presetForWeather(text) {
  const value = String(text || '')
  if (/雪/.test(value)) return 'snow'
  if (/雨/.test(value)) return 'rain'
  if (/(樱|花瓣|落花)/.test(value)) return 'petals'
  if (/萤/.test(value)) return 'fireflies'
  if (/(火|烬|焰)/.test(value)) return 'embers'
  if (/(灵气|仙气|魔力)/.test(value)) return 'qi'
  if (/(沙|尘)/.test(value)) return 'dust'
  return ''
}
export function intensityForWeather(text) {
  const value = String(text || '')
  if (/(暴|大|狂|倾盆)/.test(value)) return 1.8
  if (/(小|细|微|零星)/.test(value)) return 0.5
  return 1
}

/**
 * Attach a particle system to a canvas.
 * @returns {{ set(options), dispose() }} options: { type, intensity, color, wind }
 */
export function createParticles(canvas, initial = {}) {
  const g = canvas.getContext('2d')
  let options = { type: '', intensity: 1, color: '', wind: 0, ...initial }
  let pool = [], width = 0, height = 0, ratio = 1, level = 0
  function resize() {
    ratio = pixelRatio(1.5)
    width = canvas.clientWidth; height = canvas.clientHeight
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio))
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  function target() {
    const preset = PRESETS[options.type]
    if (!preset) return 0
    const q = { low: 0.4, medium: 0.75, high: 1 }[quality()]
    return Math.min(1500, Math.round(width * height * preset.density * options.intensity * q))
  }
  const stop = loop((dt, t) => {
    const preset = PRESETS[options.type]
    g.clearRect(0, 0, width, height)
    // fade in/out when the preset or intensity changes
    level += ((preset ? 1 : 0) - level) * Math.min(1, dt * 1.5)
    if (!preset) { pool.length = 0; return }
    const want = target()
    while (pool.length < want) { const p = {}; preset.spawn(p, width, height, false); pool.push(p) }
    if (pool.length > want) pool.length = want
    const rgb = parseColor(options.color || preset.color).slice(0, 3).join(',')
    g.globalAlpha = level
    g.globalCompositeOperation = preset.glow ? 'lighter' : 'source-over'
    for (const p of pool) {
      if (!preset.step(p, dt, width, height, t, options.wind)) preset.spawn(p, width, height, true)
      preset.draw(g, p, rgb, options.wind, t)
    }
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  })
  return {
    set(next) {
      if (next.type !== undefined && next.type !== options.type) pool = []
      options = { ...options, ...next }
    },
    dispose() { stop(); observer.disconnect() }
  }
}
