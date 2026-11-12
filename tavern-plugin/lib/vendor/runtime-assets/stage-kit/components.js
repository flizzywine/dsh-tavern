// dsh stage-kit components (Card Stage, src/client/card-stage.js).
// Declarative <stage-*> elements bound to MVU variables by path.
// Attributes are read when the element connects.
import { stage, watch, read, toNumber, clamp, follow, loop, parseHour, colorFor, mixColor, pixelRatio, onLayout, safeArea } from './core.js'
import { createParticles, presetForWeather, intensityForWeather } from './particles.js'

const TOKENS = `:host{--_text:var(--stage-text,#1d1f24);--_muted:var(--stage-muted,#6b7079);--_panel:var(--stage-panel,rgba(255,255,255,.78));--_border:var(--stage-border,rgba(0,0,0,.08));--_accent:var(--stage-accent,#4176e6)}
:host-context(html[data-scheme="dark"]){--_text:var(--stage-text,#eef0f3);--_muted:var(--stage-muted,#9aa1ab);--_panel:var(--stage-panel,rgba(22,22,26,.72));--_border:var(--stage-border,rgba(255,255,255,.08));--_accent:var(--stage-accent,#679efe)}`
const LAYER = ':host{position:fixed;inset:0;display:block;pointer-events:none}'

/** Resolve ".child" paths against the nearest <stage-each> item. */
function resolvePath(element, path) {
  if (!path || !path.startsWith('.')) return path
  const base = element.closest('[data-stage-base]')
  return base ? base.getAttribute('data-stage-base') + path : path.slice(1)
}
const flag = (el, name) => el.hasAttribute(name) && el.getAttribute(name) !== 'false'
const num = (el, name, fallback) => { const v = Number(el.getAttribute(name)); return el.hasAttribute(name) && Number.isFinite(v) ? v : fallback }

class StageElement extends HTMLElement {
  static css = ''
  connectedCallback() {
    if (!this.shadowRoot && this.constructor.shadow !== false) {
      this.attachShadow({ mode: 'open' })
      this.shadowRoot.innerHTML = `<style>${TOKENS}${this.constructor.css}</style>${this.template()}`
    }
    this._cleanups = []
    this.mount()
  }
  disconnectedCallback() { for (const fn of this._cleanups || []) fn(); this._cleanups = [] }
  template() { return '' }
  mount() {}
  $(selector) { return this.shadowRoot.querySelector(selector) }
  track(fn) { this._cleanups.push(fn) }
  /** Watch the value at attribute `name` (a variable path). */
  bindAttr(name, fn) {
    const path = resolvePath(this, this.getAttribute(name))
    if (!path) { fn(undefined); return }
    this.track(watch(path, fn))
  }
}

/* ---------------- text ---------------- */
// <stage-text bind="世界状态.时间" format="现在 {value}" fallback="—">
class StageText extends StageElement {
  static shadow = false
  mount() {
    const format = this.getAttribute('format') || '{value}'
    const fallback = this.getAttribute('fallback') ?? ''
    this.bindAttr('bind', value => {
      const empty = value === undefined || value === null || value === ''
      this.textContent = empty ? fallback : format.replaceAll('{value}', typeof value === 'object' ? JSON.stringify(value) : String(value))
      this.toggleAttribute('data-empty', empty)
    })
  }
}

/* ---------------- panel ---------------- */
// <stage-panel title="灵魂宝石" subtitle="第 1 周目">…</stage-panel>
class StagePanel extends StageElement {
  static css = `:host{display:block;box-sizing:border-box;padding:14px;border:1px solid var(--_border);border-radius:14px;background:var(--_panel);color:var(--_text);backdrop-filter:blur(14px) saturate(1.1);font:12px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    header{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 10px}header:empty{display:none}
    b{font-size:11px;font-weight:600;letter-spacing:.14em;color:var(--_accent);text-transform:uppercase}span{color:var(--_muted);font-size:11px}
    slot{display:flex;flex-direction:column;gap:10px}`
  template() {
    const title = this.getAttribute('title') || '', sub = this.getAttribute('subtitle') || ''
    this.removeAttribute('title')
    const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    return `<header>${title ? `<b>${esc(title)}</b>` : ''}${sub ? `<span>${esc(sub)}</span>` : ''}</header><slot></slot>`
  }
}

/* ---------------- stat bar ---------------- */
// <stage-stat label="浑浊度" bind="….SG浑浊度" max="100" unit="%" color="#ff6fae" invert>
class StageStat extends StageElement {
  static css = `:host{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:baseline;color:var(--_text);font:12px/1.4 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    .label{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.value{color:var(--_muted);font-variant-numeric:tabular-nums}
    .bar{grid-column:1/-1;height:4px;border-radius:4px;background:color-mix(in srgb,var(--_text) 10%,transparent);overflow:hidden}
    .fill{height:100%;width:0;border-radius:inherit;background:var(--c,var(--_accent));transform-origin:left}
    :host([data-level="high"]) .value{color:var(--danger,#ff6b8a)}`
  template() { return '<span class="label"></span><span class="value"></span><div class="bar"><div class="fill"></div></div>' }
  mount() {
    const max = num(this, 'max', 100), min = num(this, 'min', 0)
    const unit = this.getAttribute('unit') ?? '', decimals = num(this, 'decimals', 0)
    const invert = flag(this, 'invert')
    const label = this.getAttribute('label')
    const color = this.getAttribute('color') || (label && flag(this, 'auto-color') ? colorFor(label) : '')
    if (color) this.style.setProperty('--c', color)
    this.$('.label').textContent = label ?? ''
    if (this.hasAttribute('label-bind')) this.track(watch(resolvePath(this, this.getAttribute('label-bind')), v => { this.$('.label').textContent = v ?? '' }))
    const fill = this.$('.fill'), value = this.$('.value')
    const ratio = follow(0, 4)
    ratio.onChange = r => { fill.style.width = (r * 100).toFixed(2) + '%' }
    this.bindAttr('bind', raw => {
      const n = toNumber(raw, min)
      const r = clamp((n - min) / (max - min || 1))
      ratio.set(r)
      value.textContent = raw === undefined ? '—' : n.toFixed(decimals) + unit
      this.dataset.level = (invert ? r >= 0.7 : r <= 0.2) ? 'high' : 'normal'
    })
  }
}

/* ---------------- ring gauge ---------------- */
// <stage-ring bind="修为.进度" max="100" label="筑基" size="72" color="#9fe6ff">
class StageRing extends StageElement {
  static css = `:host{display:inline-grid;place-items:center;position:relative;color:var(--_text);font:600 12px/1.2 system-ui,-apple-system,"Segoe UI","PingFang SC",sans-serif}
    svg{display:block;transform:rotate(-90deg)}.track{stroke:color-mix(in srgb,var(--_text) 10%,transparent)}.arc{stroke:var(--c,var(--_accent));stroke-linecap:round}
    .center{position:absolute;inset:0;display:grid;place-content:center;text-align:center}.center small{display:block;color:var(--_muted);font-weight:500;font-size:10px}`
  template() {
    const size = num(this, 'size', 72), stroke = num(this, 'thickness', 6), r = (size - stroke) / 2
    this._circ = 2 * Math.PI * r
    return `<svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${this._circ}" stroke-dashoffset="${this._circ}"/></svg><div class="center"><span class="v"></span><small class="l"></small></div>`
  }
  mount() {
    const max = num(this, 'max', 100)
    if (this.getAttribute('color')) this.style.setProperty('--c', this.getAttribute('color'))
    this.$('.l').textContent = this.getAttribute('label') || ''
    const arc = this.$('.arc'), text = this.$('.v')
    const ratio = follow(0, 4)
    ratio.onChange = r => arc.setAttribute('stroke-dashoffset', String(this._circ * (1 - r)))
    this.bindAttr('bind', raw => { const n = toNumber(raw); ratio.set(clamp(n / (max || 1))); text.textContent = raw === undefined ? '—' : String(Math.round(n)) })
  }
}

/* ---------------- alert ---------------- */
// <stage-alert bind="场景判定.附近的危险" label="DANGER">附近有危险：{value}</stage-alert>
class StageAlert extends StageElement {
  static css = `:host{display:none;box-sizing:border-box;padding:8px 10px;border:1px solid color-mix(in srgb,var(--c,#ff4d7a) 45%,transparent);border-radius:10px;
    background:color-mix(in srgb,var(--c,#ff4d7a) 16%,transparent);color:var(--_text);font:12px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC",sans-serif;animation:pulse 2.4s ease-in-out infinite}
    :host([data-on]){display:block}small{display:block;margin-bottom:2px;color:var(--c,#ff4d7a);font-size:9px;letter-spacing:.2em}
    @keyframes pulse{50%{box-shadow:0 0 18px color-mix(in srgb,var(--c,#ff4d7a) 35%,transparent)}}`
  template() { return '<small></small><span class="body"></span>' }
  mount() {
    if (this.getAttribute('color')) this.style.setProperty('--c', this.getAttribute('color'))
    this.$('small').textContent = this.getAttribute('label') || ''
    const format = (this._format ??= this.textContent.trim() || '{value}')
    const when = this.getAttribute('when') ? new RegExp(this.getAttribute('when')) : null
    this.bindAttr('bind', value => {
      const text = value === undefined || value === null ? '' : String(value).trim()
      const on = when ? when.test(text) : Boolean(text && text !== '0' && text !== 'false' && text !== '无')
      this.toggleAttribute('data-on', on)
      this.$('.body').textContent = format.replaceAll('{value}', text)
    })
  }
}

/* ---------------- repeat ---------------- */
// <stage-each bind="活跃魔法少女"><template><div><b data-key></b><stage-stat bind=".SG浑浊度"></stage-stat></div></template></stage-each>
// Inside the template, ".path" is relative to the current entry; "$key" in any attribute
// becomes the key; [data-key] gets the key as text;
// [data-key-color] gets --key-color from the key.
class StageEach extends StageElement {
  static shadow = false
  mount() {
    const template = this._template ??= this.querySelector(':scope > template')
    if (!template) return
    const base = resolvePath(this, this.getAttribute('bind'))
    const limit = num(this, 'limit', 50)
    let keysKey = ''
    this.track(watch(() => {
      const value = read(base)
      if (Array.isArray(value)) return value.map((_, index) => String(index))
      return value && typeof value === 'object' ? Object.keys(value) : []
    }, keys => {
      const next = JSON.stringify(keys)
      if (next === keysKey) return
      keysKey = next
      for (const node of Array.from(this.children)) if (node !== template) node.remove()
      for (const key of keys.slice(0, limit)) {
        const item = document.createElement('div')
        item.className = 'stage-each-item'
        item.setAttribute('data-stage-base', base + '.' + key)
        item.style.setProperty('--key-color', colorFor(key))
        item.appendChild(template.content.cloneNode(true))
        const shortKey = key.replace(/（.*?）|\(.*?\)/g, '')
        for (const node of item.querySelectorAll('*')) {
          for (const attr of Array.from(node.attributes)) if (attr.value.includes('$key')) node.setAttribute(attr.name, attr.value.replaceAll('$key', shortKey))
        }
        for (const node of item.querySelectorAll('[data-key]')) node.textContent = key.replace(/（.*?）|\(.*?\)/g, '')
        for (const node of item.querySelectorAll('[data-key-color]')) node.style.setProperty('--c', colorFor(key))
        this.appendChild(item)
      }
      this.toggleAttribute('data-empty', keys.length === 0)
    }))
  }
}

/* ---------------- margin container ---------------- */
// <stage-margin side="left|right" min-width="180" align="center|top|bottom">…</stage-margin>
// Positions its content in the empty space beside the reading column.
class StageMargin extends StageElement {
  static css = ':host{position:fixed;display:flex;flex-direction:column;justify-content:center;align-items:center;box-sizing:border-box;padding:16px;pointer-events:none}:host([hidden]){display:none}::slotted(*){pointer-events:auto;max-width:100%}'
  template() { return '<slot></slot>' }
  mount() {
    const side = this.getAttribute('side') === 'left' ? 'left' : 'right'
    const min = num(this, 'min-width', 160)
    this.style.justifyContent = { top: 'flex-start', bottom: 'flex-end' }[this.getAttribute('align')] || 'center'
    const place = () => {
      const area = safeArea(), zone = area[side]
      this.hidden = zone.width < min
      Object.assign(this.style, { left: zone.x + 'px', width: zone.width + 'px', top: area.column.top + 'px', height: Math.max(0, area.column.bottom - area.column.top) + 'px' })
      this.toggleAttribute('data-roomy', zone.width >= min * 1.6)
    }
    place()
    this.track(onLayout(place))
    addEventListener('resize', place)
    this.track(() => removeEventListener('resize', place))
  }
}

/* ---------------- sky ---------------- */
// <stage-sky bind-time="世界状态.时间" bind-weather="世界状态.天气" dim="0.6">
const SKY = [[0, '#05040c', '#0d0a1a'], [5, '#141a33', '#3a2c4a'], [6.5, '#5d7fb8', '#f0c6b4'], [9, '#6f9ad6', '#cfe0f4'], [15, '#7aa0d8', '#e6eef8'],
  [17.5, '#5a6aa8', '#f4b690'], [18.7, '#2c2656', '#b8607a'], [20, '#0f0d24', '#2a1e3c'], [24, '#05040c', '#0d0a1a']]
function skyAt(hour) {
  for (let i = 0; i < SKY.length - 1; i += 1) {
    const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1]
    if (hour >= h0 && hour <= h1) { const t = (hour - h0) / (h1 - h0); return [mixColor(t0, t1, t), mixColor(b0, b1, t)] }
  }
  return [SKY[0][1], SKY[0][2]]
}
class StageSky extends StageElement {
  static css = LAYER + 'canvas{width:100%;height:100%;display:block}'
  template() { return '<canvas></canvas>' }
  mount() {
    const canvas = this.$('canvas'), g = canvas.getContext('2d')
    const dim = num(this, 'dim', 0.55)
    const hour = follow(12, 0.8), cloud = follow(0, 0.8)
    const stars = Array.from({ length: 140 }, () => [Math.random(), Math.random() * 0.7, Math.random() * 6.28, Math.random() * 1.2 + 0.3])
    let w = 0, h = 0, lastKey = ''
    const resize = () => { lastKey = ''; const r = pixelRatio(1); w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * r; canvas.height = h * r; g.setTransform(r, 0, 0, r, 0, 0) }
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize(); this.track(() => ro.disconnect())
    if (this.hasAttribute('hour')) hour.set(num(this, 'hour', 12), { instant: true })
    this.bindAttr('bind-time', v => { if (v !== undefined) hour.set(parseHour(v), { instant: hour.value === 12 && hour.target === 12 }) })
    this.bindAttr('bind-weather', v => cloud.set(/(阴|雨|雪|雾|云)/.test(String(v || '')) ? 1 : 0))
    this.track(loop((dt, t) => {
      const night = hour.value < 5.5 || hour.value > 19.5
      const key = hour.value.toFixed(3) + cloud.value.toFixed(3)
      if (!night && key === lastKey) return  // static daytime sky: skip redraws
      lastKey = key
      const [top, bottom] = skyAt(hour.value)
      const grad = g.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, mixColor(top, '#3a3d44', cloud.value * 0.6))
      grad.addColorStop(1, mixColor(bottom, '#50535a', cloud.value * 0.6))
      g.fillStyle = grad; g.fillRect(0, 0, w, h)
      if (night) {
        const a = (1 - cloud.value) * 0.9
        for (const [x, y, p, s] of stars) { g.fillStyle = `rgba(255,255,255,${a * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.6 + p)))})`; g.fillRect(x * w, y * h, s, s) }
      }
      g.fillStyle = `rgba(0,0,0,${dim})`; g.fillRect(0, 0, w, h)
    }))
  }
}

/* ---------------- weather & particles ---------------- */
// <stage-weather bind="世界状态.天气" wind="0.3">   <stage-particles type="qi" bind-intensity="灵气.浓度" max="100">
class StageParticleLayer extends StageElement {
  static css = LAYER + 'canvas{width:100%;height:100%;display:block}'
  template() { return '<canvas></canvas>' }
  mount() {
    const system = createParticles(this.$('canvas'), { type: this.getAttribute('type') || '', intensity: num(this, 'intensity', 1), color: this.getAttribute('color') || '', wind: num(this, 'wind', 0) })
    this.track(() => system.dispose())
    this.configure(system)
  }
  configure(system) {
    const max = num(this, 'max', 100), base = num(this, 'intensity', 1)
    if (this.hasAttribute('bind-intensity')) this.bindAttr('bind-intensity', v => system.set({ intensity: base * 2 * clamp(toNumber(v) / (max || 1)) }))
    if (this.hasAttribute('bind-type')) this.bindAttr('bind-type', v => system.set({ type: String(v || '') }))
  }
}
class StageWeather extends StageParticleLayer {
  configure(system) {
    const base = num(this, 'intensity', 1)
    const fixed = this.getAttribute('type')
    this.bindAttr('bind', v => system.set(fixed ? { intensity: base } : { type: presetForWeather(v), intensity: base * intensityForWeather(v) }))
  }
}

/* ---------------- aura ---------------- */
// <stage-aura bind="灵气.浓度" max="100" color="#9fe6ff" x="50%" y="70%" size="70vmin">
class StageAura extends StageElement {
  static css = LAYER + `.a{position:absolute;left:var(--x);top:var(--y);width:var(--size);aspect-ratio:1;transform:translate(-50%,-50%) scale(var(--s,1));border-radius:50%;
    background:radial-gradient(circle,color-mix(in srgb,var(--c) 70%,transparent) 0,color-mix(in srgb,var(--c) 22%,transparent) 38%,transparent 70%);opacity:var(--o,0);
    mix-blend-mode:screen;filter:blur(8px);animation:breathe var(--speed,4s) ease-in-out infinite}
    @keyframes breathe{50%{transform:translate(-50%,-50%) scale(calc(var(--s,1) * 1.08))}}@media (prefers-reduced-motion:reduce){.a{animation:none}}`
  template() { return '<div class="a"></div>' }
  mount() {
    const a = this.$('.a'), max = num(this, 'max', 100)
    a.style.setProperty('--c', this.getAttribute('color') || 'var(--_accent)')
    a.style.setProperty('--x', this.getAttribute('x') || '50%')
    a.style.setProperty('--y', this.getAttribute('y') || '60%')
    a.style.setProperty('--size', this.getAttribute('size') || '70vmin')
    const level = follow(0, 1.2)
    level.onChange = v => { a.style.setProperty('--o', (v * 0.9).toFixed(3)); a.style.setProperty('--s', (0.6 + v * 0.6).toFixed(3)); a.style.setProperty('--speed', (5 - v * 3).toFixed(2) + 's') }
    if (this.hasAttribute('bind')) this.bindAttr('bind', v => level.set(clamp(toNumber(v) / (max || 1))))
    else level.set(num(this, 'level', 0.6))
  }
}

/* ---------------- image ---------------- */
// <stage-image bind="世界状态.所在地点" map='{"学校":"https://…/school.jpg","*":"https://…/city.jpg"}' dim="0.5">
// or <stage-image src="…">. Crossfades on change; keys match as substrings.
class StageImage extends StageElement {
  static css = LAYER + `img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1.2s ease}img.on{opacity:1}
    .dim{position:absolute;inset:0;background:#000;opacity:var(--dim,.45)}`
  template() { return '<img alt=""><img alt=""><div class="dim"></div>' }
  mount() {
    this.style.setProperty('--dim', this.getAttribute('dim') ?? '0.45')
    const [a, b] = this.shadowRoot.querySelectorAll('img')
    let front = a, current = ''
    const show = url => {
      if (!url || url === current) return
      current = url
      const back = front === a ? b : a
      back.onload = () => { back.classList.add('on'); front.classList.remove('on'); front = back }
      back.src = url
    }
    let map = {}
    try { map = JSON.parse(this.getAttribute('map') || '{}') } catch { console.warn('stage-image map 不是合法 JSON') }
    if (this.hasAttribute('src')) show(this.getAttribute('src'))
    if (this.hasAttribute('bind')) this.bindAttr('bind', v => {
      const text = String(v ?? '')
      const hit = Object.keys(map).find(key => key !== '*' && text.includes(key))
      show(hit ? map[hit] : map['*'])
    })
  }
}

/* ---------------- vignette ---------------- */
class StageVignette extends StageElement {
  static css = LAYER + ':host{background:radial-gradient(ellipse at center,transparent 45%,var(--c,#000) 120%);opacity:var(--o,.7)}'
  mount() { this.style.setProperty('--c', this.getAttribute('color') || '#000'); this.style.setProperty('--o', this.getAttribute('strength') || '0.7') }
}

/* ---------------- flash ---------------- */
// <stage-flash bind="主角.生命值" when="down" color="#ff2a4a">: a brief screen flash on change.
class StageFlash extends StageElement {
  static css = LAYER + ':host{background:var(--c,#fff);opacity:0}:host(.go){animation:f .7s ease-out}@keyframes f{0%{opacity:.35}100%{opacity:0}}'
  mount() {
    this.style.setProperty('--c', this.getAttribute('color') || '#fff')
    const when = this.getAttribute('when') || 'change'
    this.bindAttr('bind', (value, previous) => {
      if (previous === undefined) return
      const d = toNumber(value) - toNumber(previous)
      if (when === 'up' && !(d > 0)) return
      if (when === 'down' && !(d < 0)) return
      if (stage.host && stage.host.reducedMotion) return
      this.classList.remove('go'); void this.offsetWidth; this.classList.add('go')
    })
  }
}

export const COMPONENTS = {
  'stage-text': StageText, 'stage-panel': StagePanel, 'stage-stat': StageStat, 'stage-ring': StageRing,
  'stage-alert': StageAlert, 'stage-each': StageEach, 'stage-margin': StageMargin,
  'stage-sky': StageSky, 'stage-weather': StageWeather, 'stage-particles': StageParticleLayer,
  'stage-aura': StageAura, 'stage-image': StageImage, 'stage-vignette': StageVignette, 'stage-flash': StageFlash
}
export function defineAll() {
  for (const [tag, ctor] of Object.entries(COMPONENTS)) if (!customElements.get(tag)) customElements.define(tag, ctor)
}
export { StageElement }
