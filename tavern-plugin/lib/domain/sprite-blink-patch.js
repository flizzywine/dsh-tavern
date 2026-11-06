// blink patches derived from exactly one native closed-eyes edit of a sprite.
// Pure RGBA arithmetic ({width, height, data: Uint8Array|Uint8ClampedArray|Buffer}); codecs,
// image generation and file I/O belong to callers (offline make-blink tool, later the asset-gen
// backend). Nothing here paints eyes: every patch pixel is a pixel of the aligned edit.

export const BLINK_PATCH_DEFAULTS = Object.freeze({
  threshold: 40,          // per-pixel change (0..255, max channel after compositing over grey)
  softThreshold: 24,      // lower bound used only inside the selected eye cluster
  minComponent: 0.00004,  // fraction of image pixels; smaller changed blobs are line-shift noise
  restMax: 0.02,          // max changed fraction of the opaque figure outside the head box
  spillMax: 0.35,         // max significant changed area outside the head, relative to the eye area
  alignMaxShift: 0.025,   // fraction of the larger image side
  alignScales: [0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.03],
  margin: 6, feather: 3, dilate: 2
})
const OUTPUT_SIZES = [[1024, 1024], [1024, 1536], [1536, 1024]]

function assertImage(image, label = 'image') {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || !image.data || image.data.length !== image.width * image.height * 4)
    throw new Error(label + ': expected RGBA {width,height,data}')
  return image
}
export function blankImage(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) } }

// The generator only emits fixed sizes. Pad (transparent, centred) to the nearest supported aspect.
export function blinkReferenceLayout(width, height) {
  const ratio = width / height
  const [ow, oh] = OUTPUT_SIZES.reduce((best, size) => Math.abs(Math.log(size[0] / size[1] / ratio)) < Math.abs(Math.log(best[0] / best[1] / ratio)) ? size : best)
  const paddedWidth = Math.max(width, Math.round(height * ow / oh)), paddedHeight = Math.max(height, Math.round(width * oh / ow))
  return { size: ow + 'x' + oh, output: [ow, oh], padded: [paddedWidth, paddedHeight], offset: [Math.floor((paddedWidth - width) / 2), Math.floor((paddedHeight - height) / 2)] }
}
export function padImage(image, layout) {
  assertImage(image)
  const [w, h] = layout.padded, [ox, oy] = layout.offset, out = blankImage(w, h)
  for (let y = 0; y < image.height; y++) out.data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + oy) * w + ox) * 4)
  return out
}
export function cropImage(image, x, y, width, height) {
  assertImage(image)
  const out = blankImage(width, height)
  for (let row = 0; row < height; row++) {
    const sy = y + row
    if (sy < 0 || sy >= image.height) continue
    for (let col = 0; col < width; col++) {
      const sx = x + col
      if (sx < 0 || sx >= image.width) continue
      const s = (sy * image.width + sx) * 4, d = (row * width + col) * 4
      out.data[d] = image.data[s]; out.data[d + 1] = image.data[s + 1]; out.data[d + 2] = image.data[s + 2]; out.data[d + 3] = image.data[s + 3]
    }
  }
  return out
}

// Separable tent filter on premultiplied alpha: an area filter when shrinking, bilinear when growing.
function resampleAxis(src, sw, sh, dw, horizontal, kernel) {
  const n = horizontal ? sw : sh, lines = horizontal ? sh : sw, out = new Float32Array((horizontal ? dw * sh : sw * dw) * 4)
  const scale = n / dw, filterScale = Math.max(1, scale), support = filterScale * (kernel === 'lanczos3' ? 3 : 1)
  for (let i = 0; i < dw; i++) {
    const center = (i + 0.5) * scale - 0.5, lo = Math.max(0, Math.floor(center - support)), hi = Math.min(n - 1, Math.ceil(center + support))
    const weights = []
    let total = 0
    for (let j = lo; j <= hi; j++) {
      const x = Math.abs(j - center) / filterScale
      const w = kernel === 'lanczos3' ? (x === 0 ? 1 : x >= 3 ? 0 : Math.sin(Math.PI*x)*Math.sin(Math.PI*x/3)/(Math.PI*Math.PI*x*x/3)) : Math.max(0, 1-x)
      weights.push(w); total += w
    }
    for (let line = 0; line < lines; line++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let j = lo, k = 0; j <= hi; j++, k++) {
        const w = weights[k]
        if (!w) continue
        const s = (horizontal ? line * sw + j : j * sw + line) * 4
        r += src[s] * w; g += src[s + 1] * w; b += src[s + 2] * w; a += src[s + 3] * w
      }
      const d = (horizontal ? line * dw + i : i * sw + line) * 4
      out[d] = r / total; out[d + 1] = g / total; out[d + 2] = b / total; out[d + 3] = a / total
    }
  }
  return out
}
export function resizeImage(image, width, height, kernel = 'tent') {
  assertImage(image)
  if (image.width === width && image.height === height) return { width, height, data: new Uint8ClampedArray(image.data) }
  const pre = new Float32Array(image.data.length)
  for (let i = 0; i < pre.length; i += 4) { const a = image.data[i + 3] / 255; pre[i] = image.data[i] * a; pre[i + 1] = image.data[i + 1] * a; pre[i + 2] = image.data[i + 2] * a; pre[i + 3] = image.data[i + 3] }
  const tmp = resampleAxis(pre, image.width, image.height, width, true, kernel)
  const res = resampleAxis(tmp, width, image.height, height, false, kernel)
  const out = blankImage(width, height)
  for (let i = 0; i < res.length; i += 4) {
    const a = res[i + 3], k = a > 0 ? 255 / a : 0
    out.data[i] = res[i] * k; out.data[i + 1] = res[i + 1] * k; out.data[i + 2] = res[i + 2] * k; out.data[i + 3] = a
  }
  return out
}
// The returned edit, mapped back onto the original sprite canvas.
export function restoreEditCanvas(edit, layout, width, height) {
  const padded = resizeImage(assertImage(edit, 'edit'), layout.padded[0], layout.padded[1])
  return cropImage(padded, layout.offset[0], layout.offset[1], width, height)
}

// Luminance-ish signal composited over mid grey, so alpha changes count as changes.
function signal(image) {
  const out = new Float32Array(image.width * image.height)
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const a = image.data[i + 3] / 255
    out[p] = (0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]) * a + 128 * (1 - a)
  }
  return out
}
function sampleBilinear(image, x, y, out, o) {
  const { width, height, data } = image
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return }
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = x - x0, fy = y - y0
  let r = 0, g = 0, b = 0, a = 0
  for (const [px, py, w] of [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]]) {
    if (!w) continue
    const s = (py * width + px) * 4, alpha = data[s + 3] * w
    r += data[s] * alpha; g += data[s + 1] * alpha; b += data[s + 2] * alpha; a += alpha
  }
  out[o] = a ? r / a : 0; out[o + 1] = a ? g / a : 0; out[o + 2] = a ? b / a : 0; out[o + 3] = a
}
// Similarity about the canvas centre: out(x) = edit(c + (x - c - d) / s).
export function warpImage(image, dx, dy, scale) {
  assertImage(image)
  const out = blankImage(image.width, image.height), cx = (image.width - 1) / 2, cy = (image.height - 1) / 2
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++)
    sampleBilinear(image, cx + (x - cx - dx) / scale, cy + (y - cy - dy) / scale, out.data, (y * image.width + x) * 4)
  return out
}
function alignmentCost(baseSignal, editSignal, width, height, dx, dy, scale, step) {
  const cx = (width - 1) / 2, cy = (height - 1) / 2
  let cost = 0, count = 0
  for (let y = 0; y < height; y += step) {
    const sy = Math.round(cy + (y - cy - dy) / scale)
    if (sy < 0 || sy >= height) continue
    for (let x = 0; x < width; x += step) {
      const sx = Math.round(cx + (x - cx - dx) / scale)
      if (sx < 0 || sx >= width) continue
      const a = baseSignal[y * width + x], b = editSignal[sy * width + sx]
      if (a === 128 && b === 128) continue
      cost += Math.min(48, Math.abs(a - b)); count++
    }
  }
  return count ? cost / count : Infinity
}
function alignmentCostSmooth(baseSignal, editSignal, width, height, dx, dy, scale, step) {
  const cx = (width - 1) / 2, cy = (height - 1) / 2
  let cost = 0, count = 0
  for (let y = 0; y < height; y += step) {
    const sy = cy + (y - cy - dy) / scale, y0 = Math.floor(sy), fy = sy - y0
    if (y0 < 0 || y0 >= height - 1) continue
    for (let x = 0; x < width; x += step) {
      const sx = cx + (x - cx - dx) / scale, x0 = Math.floor(sx), fx = sx - x0
      if (x0 < 0 || x0 >= width - 1) continue
      const q = y0 * width + x0
      const b = (editSignal[q] * (1 - fx) + editSignal[q + 1] * fx) * (1 - fy) + (editSignal[q + width] * (1 - fx) + editSignal[q + width + 1] * fx) * fy
      const a = baseSignal[y * width + x]
      if (a === 128 && Math.abs(b - 128) < 0.5) continue
      cost += Math.min(48, Math.abs(a - b)); count++
    }
  }
  return count ? cost / count : Infinity
}
// Coarse-to-fine similarity search. Truncated L1 keeps the edited eyes from dominating the fit.
export function alignEdit(base, edit, options = {}) {
  assertImage(base, 'base'); assertImage(edit, 'edit')
  if (base.width !== edit.width || base.height !== edit.height) throw new Error('alignEdit: restore the edit canvas first')
  const o = { ...BLINK_PATCH_DEFAULTS, ...options }, longest = Math.max(base.width, base.height)
  const levels = [], factor = Math.max(1, longest / 256)
  for (let f = factor; ; f /= 2) { levels.push(Math.max(1, f)); if (f <= 1) break }
  let best = { dx: 0, dy: 0, scale: 1, cost: Infinity }
  for (const [index, f] of levels.entries()) {
    const w = Math.max(8, Math.round(base.width / f)), h = Math.max(8, Math.round(base.height / f))
    const sb = signal(resizeImage(base, w, h)), se = signal(resizeImage(edit, w, h)), rx = w / base.width
    const step = Math.max(1, Math.round(Math.sqrt(w * h / 160000)))
    const radius = index === 0 ? Math.ceil(o.alignMaxShift * longest * rx) : 2
    const scales = index === 0 ? o.alignScales : [best.scale - 0.0025, best.scale, best.scale + 0.0025]
    const center = index === 0 ? { dx: 0, dy: 0 } : { dx: Math.round(best.dx * rx), dy: Math.round(best.dy * rx) }
    let local = { cost: Infinity }
    for (const scale of scales) for (let dy = center.dy - radius; dy <= center.dy + radius; dy++) for (let dx = center.dx - radius; dx <= center.dx + radius; dx++) {
      const cost = alignmentCost(sb, se, w, h, dx, dy, scale, step)
      if (cost < local.cost) local = { dx, dy, scale, cost }
    }
    best = { dx: local.dx / rx, dy: local.dy / rx, scale: local.scale, cost: local.cost }
  }
  // Sub-pixel refinement on the full canvas: regenerated line art is unforgiving to half pixels.
  {
    const sb = signal(base), se = signal(edit), step = Math.max(1, Math.round(Math.sqrt(base.width * base.height / 250000)))
    best = { ...best, cost: alignmentCostSmooth(sb, se, base.width, base.height, best.dx, best.dy, best.scale, step) }
    for (const [delta, scaleDelta] of [[0.5, 0.002], [0.25, 0.001]]) {
      let local = best
      for (const ds of [-scaleDelta, 0, scaleDelta]) for (const oy of [-delta, 0, delta]) for (const ox of [-delta, 0, delta]) {
        if (!ds && !ox && !oy) continue
        const candidate = { dx: best.dx + ox, dy: best.dy + oy, scale: best.scale + ds }
        candidate.cost = alignmentCostSmooth(sb, se, base.width, base.height, candidate.dx, candidate.dy, candidate.scale, step)
        if (candidate.cost < local.cost) local = candidate
      }
      best = local
    }
  }
  const identity = alignmentCost(signal(base), signal(edit), base.width, base.height, 0, 0, 1, Math.max(1, Math.round(Math.sqrt(base.width * base.height / 160000))))
  return { dx: best.dx, dy: best.dy, scale: best.scale, cost: best.cost, identityCost: identity, image: warpImage(edit, best.dx, best.dy, best.scale) }
}

export function changeMap(base, edit) {
  assertImage(base, 'base'); assertImage(edit, 'edit')
  const n = base.width * base.height, out = new Uint8Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a1 = base.data[i + 3] / 255, a2 = edit.data[i + 3] / 255
    let m = Math.abs(base.data[i + 3] - edit.data[i + 3])
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(base.data[i + c] * a1 + 128 * (1 - a1) - edit.data[i + c] * a2 - 128 * (1 - a2)))
    out[p] = Math.min(255, Math.round(m))
  }
  return out
}
function morph(mask, width, height, radius, grow) {
  // Separable square structuring element.
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = grow ? 0 : 1
    for (let k = -radius; k <= radius; k++) { const xx = x + k, s = xx < 0 || xx >= width ? 0 : mask[y * width + xx]; if (grow ? s : !s) { v = grow ? 1 : 0; break } }
    tmp[y * width + x] = v
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = grow ? 0 : 1
    for (let k = -radius; k <= radius; k++) { const yy = y + k, s = yy < 0 || yy >= height ? 0 : tmp[yy * width + x]; if (grow ? s : !s) { v = grow ? 1 : 0; break } }
    out[y * width + x] = v
  }
  return out
}
function components(mask, width, height) {
  const labels = new Int32Array(mask.length).fill(-1), list = [], stack = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue
    const c = { id: list.length, area: 0, x0: width, y0: height, x1: -1, y1: -1, sx: 0, sy: 0 }
    labels[start] = c.id; stack.push(start)
    while (stack.length) {
      const p = stack.pop(), x = p % width, y = (p - x) / width
      c.area++; c.sx += x; c.sy += y
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, q = ny * width + nx
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height && mask[q] && labels[q] < 0) { labels[q] = c.id; stack.push(q) }
      }
    }
    c.cx = c.sx / c.area; c.cy = c.sy / c.area; c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1
    list.push(c)
  }
  return { labels, list }
}
const union = boxes => boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
const overlapsOutside = (c, box) => c.x0 < box.x0 || c.y0 < box.y0 || c.x1 > box.x1 || c.y1 > box.y1
// A changed eye pixel past the mouth's mid-line, within a quarter mouth width of its sides: a tilted eye that
// only drops beside the mouth is not a mouth change, an eye that runs down into the mouth is.
function reachesMouth(labels, width, height, ids, m) {
  const g = Math.round(0.25 * m.w), mid = m.y + m.h * 0.5
  for (let y = Math.floor(mid) + 1; y < height; y++)
    for (let x = Math.max(0, m.x - g); x < Math.min(width, m.x + m.w + g); x++)
      if (ids.has(labels[y * width + x])) return true
  return false
}

// The eye cluster is the largest change plus the other eye on the same face band. A tilted head
// lowers the far eye in proportion to the eye distance, so the band widens by up to 30° of tilt.
const EYE_PAIR_TILT = Math.tan(Math.PI / 6)
// Both eyes sit on one head: the straight line between them crosses only the opaque figure (the face
// between the eyes), however far apart a mascot's eyes are. A change across a transparent gap is not on this head.
function onSameHead(base, a, b) {
  const steps = Math.ceil(Math.hypot(b.cx - a.cx, b.cy - a.cy))
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a.cx + (b.cx - a.cx) * i / steps), y = Math.round(a.cy + (b.cy - a.cy) * i / steps)
    if (base.data[(y * base.width + x) * 4 + 3] <= 16) return false
  }
  return true
}
// An optional mouth rect (layered sprites) rejects clusters that are not above the mouth.
function eyeCluster(list, hints) {
  let candidates = list
  if (hints.mouth) {
    const m = hints.mouth, mcx = m.x + m.w / 2
    candidates = list.filter(c => c.cy < m.y + m.h * 0.25 && Math.abs(c.cx - mcx) < Math.max(4 * m.w, 0.5 * (hints.width || 0) * 0.25))
  }
  if (!candidates.length) return null
  const seed = candidates.reduce((a, b) => b.area > a.area ? b : a)
  const band = Math.max(seed.h, 8)
  // The partner eye: same band, beside the seed on the same head, the most similar size and not a tall hair strand.
  const partner = candidates.filter(c => c !== seed && Math.abs(c.cy - seed.cy) <= band + Math.abs(c.cx - seed.cx) * EYE_PAIR_TILT && Math.abs(c.cx - seed.cx) >= seed.w * 0.6 && onSameHead(hints.base, seed, c) &&
      c.area >= seed.area * 0.15 && c.h <= Math.max(c.w * 1.6, seed.h * 1.3))
    .sort((a, b) => Math.abs(Math.log(a.area / seed.area)) - Math.abs(Math.log(b.area / seed.area)))[0]
  const eyes = partner ? [seed, partner] : [seed]
  // Fragments of the same eyes (split lashes, highlights) touch an eye box grown by a third of its height.
  const near = c => eyes.some(e => { const g = e.h / 3; return c.x0 <= e.x1 + g && c.x1 >= e.x0 - g && c.y0 <= e.y1 + g && c.y1 >= e.y0 - g })
  return candidates.filter(c => eyes.includes(c) || (near(c) && c.h <= Math.max(c.w * 1.6, seed.h)))
}

export function extractBlinkPatch(base, alignedEdit, hints = {}, options = {}) {
  assertImage(base, 'base'); assertImage(alignedEdit, 'edit')
  const o = { ...BLINK_PATCH_DEFAULTS, ...options }, { width, height } = base, n = width * height
  const diff = changeMap(base, alignedEdit), warnings = []
  const hard = new Uint8Array(n)
  for (let p = 0; p < n; p++) hard[p] = diff[p] > o.threshold ? 1 : 0
  // Opening removes the 1–2 px slivers that a regenerated line leaves along every contour.
  const opened = morph(morph(hard, width, height, 1, false), width, height, 1, true)
  const minArea = Math.max(24, Math.round(o.minComponent * n))
  const { labels, list: all } = components(opened, width, height)
  const significant = all.filter(c => c.area >= minArea)
  const cluster = eyeCluster(significant, { ...hints, width, base })
  let figure = 0
  for (let p = 0; p < n; p++) if (base.data[p * 4 + 3] > 16 || alignedEdit.data[p * 4 + 3] > 16) figure++
  const stats = { components: significant.length, figurePixels: figure }
  if (!cluster?.length) return { ok: false, warnings: ['no-eye-change: the edit did not visibly change any eye region'], stats, diff }
  const eye = union(cluster), eyeW = eye.x1 - eye.x0 + 1, eyeH = eye.y1 - eye.y0 + 1
  const eyeArea = cluster.reduce((s, c) => s + c.area, 0)
  const head = { x0: Math.round(eye.x0 - 0.45 * eyeW), x1: Math.round(eye.x1 + 0.45 * eyeW), y0: Math.round(eye.y0 - 1.1 * eyeW), y1: Math.round(eye.y1 + 0.9 * eyeW) }
  if (hints.mouth) { head.y1 = Math.max(head.y1, hints.mouth.y + hints.mouth.h * 2) }
  Object.assign(stats, { eye: { x: eye.x0, y: eye.y0, w: eyeW, h: eyeH }, eyeBlobs: cluster.length, eyeArea, head: { x: head.x0, y: head.y0, w: head.x1 - head.x0 + 1, h: head.y1 - head.y0 + 1 } })
  // 1. Spill: significant changed blobs reaching outside the head.
  const spill = significant.filter(c => !cluster.includes(c) && overlapsOutside(c, head))
  stats.spillArea = spill.reduce((s, c) => s + c.area, 0)
  stats.spillBlobs = spill.slice(0, 12).map(c => ({ x: c.x0, y: c.y0, w: c.w, h: c.h, area: c.area }))
  if (stats.spillArea > o.spillMax * eyeArea) warnings.push(`diff-spill: ${stats.spillArea}px of significant change outside the head (eye change ${eyeArea}px)`)
  // 2. Rest of the image: changed fraction of the figure outside the head box. Uses the opened mask:
  // a regenerated contour that moved by a pixel is not a noticeable change, a repainted area is.
  let rest = 0, restFigure = 0, restRaw = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= head.x0 && x <= head.x1 && y >= head.y0 && y <= head.y1) continue
    const p = y * width + x
    if (base.data[p * 4 + 3] <= 16 && alignedEdit.data[p * 4 + 3] <= 16) continue
    restFigure++; if (opened[p]) rest++; if (hard[p]) restRaw++
  }
  stats.restChanged = restFigure ? rest / restFigure : 0
  stats.restChangedRaw = restFigure ? restRaw / restFigure : 0
  if (stats.restChanged > o.restMax) warnings.push(`rest-changed: ${(100 * stats.restChanged).toFixed(2)}% of the figure outside the head changed (limit ${(100 * o.restMax).toFixed(1)}%)`)
  // 3. Shape sanity: closed eyes are a wide band in the upper face, not a tall blob.
  if (eyeH > eyeW * 1.2) warnings.push(`eye-shape: changed region ${eyeW}x${eyeH} is taller than wide`)
  if (hints.mouth && reachesMouth(labels, width, height, new Set(cluster.map(c => c.id)), hints.mouth)) warnings.push('eye-position: changed region reaches the mouth')
  // Patch mask: the cluster's own pixels at the soft threshold, hole-filled, dilated and feathered.
  const margin = Math.max(o.margin, Math.round(0.12 * eyeH)) + o.dilate + o.feather
  const rx = Math.max(0, eye.x0 - margin), ry = Math.max(0, eye.y0 - margin)
  const rw = Math.min(width, eye.x1 + margin + 1) - rx, rh = Math.min(height, eye.y1 + margin + 1) - ry
  const ids = new Set(cluster.map(c => c.id))
  let mask = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (ids.has(labels[(y + ry) * width + x + rx])) mask[y * rw + x] = 1
  const near = morph(mask, rw, rh, 4, true)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const q = y * rw + x; if (near[q] && diff[(y + ry) * width + x + rx] > o.softThreshold) mask[q] = 1 }
  mask = morph(morph(mask, rw, rh, 2, true), rw, rh, 2, false) // close
  // Fill holes: anything not reachable from the rect border is inside an eye.
  const outside = new Uint8Array(rw * rh), stack = []
  for (let x = 0; x < rw; x++) for (const y of [0, rh - 1]) stack.push(y * rw + x)
  for (let y = 0; y < rh; y++) for (const x of [0, rw - 1]) stack.push(y * rw + x)
  while (stack.length) {
    const q = stack.pop()
    if (outside[q] || mask[q]) continue
    outside[q] = 1
    const x = q % rw, y = (q - x) / rw
    if (x > 0) stack.push(q - 1); if (x < rw - 1) stack.push(q + 1); if (y > 0) stack.push(q - rw); if (y < rh - 1) stack.push(q + rw)
  }
  for (let q = 0; q < mask.length; q++) if (!outside[q]) mask[q] = 1
  if (o.dilate) mask = morph(mask, rw, rh, o.dilate, true)
  const soft = new Float32Array(rw * rh)
  for (let q = 0; q < mask.length; q++) soft[q] = mask[q]
  const blurred = o.feather ? boxBlur(soft, rw, rh, o.feather) : soft
  const patch = blankImage(rw, rh)
  let covered = 0
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const q = y * rw + x, s = ((y + ry) * width + x + rx) * 4, d = q * 4, m = Math.min(1, blurred[q])
    if (m <= 0.004) continue
    covered++
    patch.data[d] = alignedEdit.data[s]; patch.data[d + 1] = alignedEdit.data[s + 1]; patch.data[d + 2] = alignedEdit.data[s + 2]
    patch.data[d + 3] = Math.round(m * Math.min(alignedEdit.data[s + 3], Math.max(base.data[s + 3], alignedEdit.data[s + 3])))
  }
  stats.coverage = covered / (rw * rh)
  return { ok: warnings.length === 0, warnings, rect: [rx, ry, rw, rh], patch, stats, diff }
}
function boxBlur(values, width, height, radius) {
  const tmp = new Float32Array(values.length), out = new Float32Array(values.length), size = radius * 2 + 1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let s = 0; for (let k = -radius; k <= radius; k++) { const xx = Math.min(width - 1, Math.max(0, x + k)); s += values[y * width + xx] }
    tmp[y * width + x] = s / size
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let s = 0; for (let k = -radius; k <= radius; k++) { const yy = Math.min(height - 1, Math.max(0, y + k)); s += tmp[yy * width + x] }
    out[y * width + x] = s / size
  }
  return out
}
// Straight-alpha "over" of a patch at its rect; the base is never mutated.
export function compositePatch(base, patch, rect, blend = 'over') {
  assertImage(base, 'base'); assertImage(patch, 'patch')
  const out = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) }, [rx, ry] = rect
  for (let y = 0; y < patch.height; y++) for (let x = 0; x < patch.width; x++) {
    const bx = rx + x, by = ry + y
    if (bx < 0 || by < 0 || bx >= base.width || by >= base.height) continue
    const s = (y * patch.width + x) * 4, d = (by * base.width + bx) * 4, a = patch.data[s + 3] / 255
    if (!a) continue
    // Authored replacement pixels carry coverage, not a second layer of opacity.
    if (blend === 'replace') { out.data.set(patch.data.subarray(s, s + 4), d); continue }
    const ba = out.data[d + 3] / 255, oa = a + ba * (1 - a)
    for (let c = 0; c < 3; c++) out.data[d + c] = Math.round((patch.data[s + c] * a + out.data[d + c] * ba * (1 - a)) / oa)
    out.data[d + 3] = Math.round(oa * 255)
  }
  return out
}
// One call for callers: restore the edit canvas, align, extract.
export function makeBlinkPatch(base, edit, layout, hints = {}, options = {}) {
  const restored = restoreEditCanvas(edit, layout, base.width, base.height)
  const alignment = alignEdit(base, restored, options)
  const result = extractBlinkPatch(base, alignment.image, hints, options)
  result.alignment = { dx: alignment.dx, dy: alignment.dy, scale: alignment.scale, cost: alignment.cost, identityCost: alignment.identityCost }
  result.aligned = alignment.image
  return result
}
