// Local matting of RGB_KEY_BG sprites (flat #00FF00 / #FF00FF key backgrounds): Dot deliveries, the local image model
// (dsh-assets local-sprite) and auto-cast channels without transparency share this one implementation.
// Dependency-free core on raw pixels; PNG I/O lives with the caller (the authoring tools).
// Model: an edge pixel c = a*F + (1-a)*K. Alpha comes from key-channel dominance relative to the
// measured key and the nearest opaque foreground colour; colour is unmixed to straight alpha and the
// remaining key spill is limited to the foreground's own dominance. Only pixels reachable from the
// background through key-tinted pixels are matted, so enclosed key-like paint stays opaque.
export const KEYS = {'#00FF00': [0, 255, 0], '#FF00FF': [255, 0, 255]}
// SPILL_SEED: the key share (of the key's own dominance) from which a pixel counts as key-tinted (k05 paint stays below
// 0.16, its blended hair gaps measure 0.24..0.55); SPILL_THIN: the half-width in px up to which such a pocket is a gap.
const BAND_DEPTH = 12, COLOUR_DEPTH = 64, SNAP = 0.02, SPILL_SEED = 0.2, SPILL_THIN = 5
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
function dominance(K) {
  const H = [0, 1, 2].filter(c => K[c] >= 128), L = [0, 1, 2].filter(c => K[c] < 128)
  return (r, g, b) => {
    const p = [r, g, b]
    let hi = 255, lo = 0
    for (const c of H) hi = Math.min(hi, p[c])
    for (const c of L) lo = Math.max(lo, p[c])
    return hi - lo
  }
}
function borderIndexes(w, h, ring = 2) {
  const out = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < ring || y < ring || x >= w - ring || y >= h - ring) out.push(y * w + x)
  return out
}
const median = values => { const s = Float64Array.from(values).sort(); return s[s.length >> 1] }

// Finds which key colour fills the image border. Returns null when the border is not a flat key.
export function detectKey(data, w, h, channels, {key = 'auto', minBorder = 0.75} = {}) {
  const border = borderIndexes(w, h), candidates = key === 'auto' ? Object.keys(KEYS) : [key.toUpperCase()]
  let best = null
  for (const name of candidates) {
    const nominal = KEYS[name]
    if (!nominal) throw Object.assign(new Error('Unknown key colour ' + key), {code: 'INVALID_ARGUMENT'})
    const hits = border.filter(i => {
      const o = i * channels, dr = data[o] - nominal[0], dg = data[o + 1] - nominal[1], db = data[o + 2] - nominal[2]
      return dr * dr + dg * dg + db * db <= 70 * 70
    })
    if (!best || hits.length > best.hits.length) best = {name, hits}
  }
  const fraction = best.hits.length / border.length
  if (fraction < minBorder) return null
  const measured = [0, 1, 2].map(c => median(best.hits.map(i => data[i * channels + c])))
  const rms = Math.sqrt(best.hits.reduce((s, i) => s + [0, 1, 2].reduce((t, c) => t + (data[i * channels + c] - measured[c]) ** 2, 0), 0) / best.hits.length)
  return {nominal: best.name, measured, measuredHex: hex(measured), borderFraction: Number(fraction.toFixed(4)), noise: Number(rms.toFixed(2))}
}

// data: raw opaque RGB or RGBA (channels 3|4). Returns straight-alpha RGBA.
export function matteKey(data, w, h, channels, {key = 'auto'} = {}) {
  if (channels === 4) for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) throw Object.assign(new Error('Input already has transparency; RGB_KEY_BG mattes opaque key-background images only'), {code: 'PRECONDITION', nextAction: 'Use the transparent PNG as delivered; only RGB key-background deliveries are matted.'})
  const found = detectKey(data, w, h, channels, {key})
  if (!found) throw Object.assign(new Error('Image border is not a flat ' + (key === 'auto' ? '#00FF00/#FF00FF' : key) + ' key background'), {code: 'PRECONDITION', nextAction: 'Check that this is an RGB_KEY_BG delivery with the figure inside a flat key-colour border; pass --key when auto picks the wrong colour.'})
  const K = found.measured, dom = dominance(K), dK = dom(...K), N = w * h
  const tol = Math.max(24, 3 * found.noise)
  const d = new Float32Array(N)
  for (let i = 0; i < N; i++) { const o = i * channels; d[i] = dom(data[o], data[o + 1], data[o + 2]) }
  const borderDominance = borderIndexes(w, h).map(i => d[i]).filter(v => v > dK * 0.5).sort((a, b) => a - b)
  // Strong key = within the border's own noise of the key; everything weaker keeps a measured alpha.
  const hi = Math.max(0.6 * dK, Math.min(dK - 6, borderDominance[Math.floor(borderDominance.length * 0.02)] - 2)), lo = Math.max(4, 0.015 * dK)
  const strong = i => d[i] >= hi
  const pure = i => { const o = i * channels; return (data[o] - K[0]) ** 2 + (data[o + 1] - K[1]) ** 2 + (data[o + 2] - K[2]) ** 2 <= tol * tol }
  const neighbours = (i, visit) => {
    const x = i % w, y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) visit(ny * w + nx)
    }
  }
  // 1. Background: strong key connected to the border, plus enclosed pockets of the flat key itself
  //    (gaps between arm and body, hair strands). Key-like paint is never the measured flat key.
  const bg = new Uint8Array(N)
  let queue = borderIndexes(w, h, 1).filter(strong)
  for (const i of queue) bg[i] = 1
  for (let q = 0; q < queue.length; q++) neighbours(queue[q], n => { if (!bg[n] && strong(n)) { bg[n] = 1; queue.push(n) } })
  // Enclosed pockets: a flat-key pocket is background; a pocket that is mostly key (>= 75% dominance
  // somewhere, e.g. a half-transparent gap between fingers) is matted like an edge. Paint the figure
  // really has stays below that, because Dot switches key colour when the figure has the key's hue.
  const keyish = i => d[i] >= 0.75 * dK
  const seen = new Uint8Array(N), pocket = new Uint8Array(N), holes = {count: 0, pixels: 0, pockets: 0, pocketPixels: 0, spill: 0, spillPixels: 0}
  for (let s = 0; s < N; s++) {
    if (bg[s] || seen[s] || !keyish(s)) continue
    const part = [s]; seen[s] = 1
    for (let q = 0; q < part.length; q++) neighbours(part[q], n => { if (!seen[n] && !bg[n] && keyish(n)) { seen[n] = 1; part.push(n) } })
    const flat = part.filter(i => strong(i) && pure(i))
    // A hole's own anti-aliased rim stays out of bg; it is matted as an edge below.
    if (flat.length >= 0.9 * part.filter(strong).length && flat.length >= 0.5 * part.length) { for (const i of part) if (strong(i) && pure(i)) bg[i] = 1; else pocket[i] = 1; holes.count++; holes.pixels += flat.length }
    else { for (const i of part) pocket[i] = 1; holes.pockets++; holes.pocketPixels += part.length }
  }
  // Narrow key gaps (between hair strands, inside outlines) are too thin for any pixel to reach the 75% above: every pixel
  // there is the key blended with the strokes around it (magenta was left in a sprite's hair gaps). A
  // key-tinted pocket no more than SPILL_THIN px from its own rim anywhere is such a gap and is matted like an edge; a
  // painted area of key-like colour is wider than that and stays opaque (the key is chosen against the figure's colours).
  const tinted = i => d[i] >= SPILL_SEED * dK, inside = new Int32Array(N).fill(-1)
  for (let s = 0, id = 0; s < N; s++, id++) {
    if (bg[s] || pocket[s] || seen[s] || !tinted(s)) continue
    const part = [s]; seen[s] = 1; inside[s] = id
    for (let q = 0; q < part.length; q++) neighbours(part[q], n => { if (!seen[n] && !bg[n] && !pocket[n] && tinted(n)) { seen[n] = 1; inside[n] = id; part.push(n) } })
    // Peel the pocket from its rim; a pixel left after SPILL_THIN rings means a wide (painted) area.
    let rim = part.filter(i => { let edge = false; neighbours(i, n => { if (inside[n] !== id) edge = true }); return edge }), left = part.length - rim.length
    const peeled = new Set(rim)
    for (let ring = 1; ring < SPILL_THIN && left > 0; ring++) {
      const next = []
      for (const i of rim) neighbours(i, n => { if (inside[n] === id && !peeled.has(n)) { peeled.add(n); next.push(n) } })
      rim = next; left -= next.length
    }
    if (left > 0) continue
    for (const i of part) pocket[i] = 1
    holes.spill++; holes.spillPixels += part.length
  }
  // 2. Edge band: key-tinted pixels reachable from the background, at most BAND_DEPTH px inward.
  const band = new Uint8Array(N), depth = new Uint8Array(N)
  queue = []
  for (let i = 0; i < N; i++) if (bg[i]) queue.push(i); else if (pocket[i]) { band[i] = 1; depth[i] = 1; queue.push(i) }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    if (!bg[i] && depth[i] >= BAND_DEPTH) continue
    neighbours(i, n => { if (!bg[n] && !band[n] && d[n] > lo) { band[n] = 1; depth[n] = bg[i] ? 1 : depth[i] + 1; queue.push(n) } })
  }
  // 3. Nearest opaque foreground colour, propagated into the band layer by layer.
  const F = new Float32Array(N * 3), hasF = new Uint8Array(N)
  let frontier = []
  for (let i = 0; i < N; i++) if (!bg[i] && !band[i]) { hasF[i] = 1; const o = i * channels; F[i * 3] = data[o]; F[i * 3 + 1] = data[o + 1]; F[i * 3 + 2] = data[o + 2] }
  for (let i = 0; i < N; i++) if (band[i]) { let near = false; neighbours(i, n => { if (hasF[n]) near = true }); if (near) frontier.push(i) }
  for (let layer = 0; layer < COLOUR_DEPTH && frontier.length; layer++) {
    const values = frontier.map(i => { let r = 0, g = 0, b = 0, k = 0; neighbours(i, n => { if (hasF[n]) { r += F[n * 3]; g += F[n * 3 + 1]; b += F[n * 3 + 2]; k++ } }); return [r / k, g / k, b / k] })
    frontier.forEach((i, j) => { hasF[i] = 1; F.set(values[j], i * 3) })
    const next = new Set()
    for (const i of frontier) neighbours(i, n => { if (band[n] && !hasF[n]) next.add(n) })
    frontier = [...next]
  }
  // 4. Alpha, unmixing and despill.
  const out = new Uint8Array(N * 4), stats = {transparent: 0, partial: 0, opaque: 0, despilled: 0, bandPixels: 0}
  for (let i = 0; i < N; i++) {
    const o = i * channels, p = i * 4, c = [data[o], data[o + 1], data[o + 2]]
    if (bg[i]) { stats.transparent++; continue }
    if (!band[i]) { out.set(c, p); out[p + 3] = 255; stats.opaque++; continue }
    stats.bandPixels++
    const f = hasF[i] ? [F[i * 3], F[i * 3 + 1], F[i * 3 + 2]] : null
    const dF = f ? Math.min(dom(...f), 0.6 * dK) : 0
    let a = d[i] >= hi ? 0 : (dK - d[i]) / (dK - dF)
    a = a < SNAP ? 0 : a > 1 - SNAP ? 1 : a
    let rgb
    if (a === 0) rgb = f ?? [0, 0, 0]
    else if (a < 0.25 && f) rgb = f
    else rgb = c.map((v, k) => Math.min(255, Math.max(0, (v - (1 - a) * K[k]) / a)))
    // Spill: limit key dominance to the nearest foreground's own (keeps yellow-green hair; a skin or
    // outline edge returns to its own hue balance instead of a neutral olive).
    const spill = dom(...rgb) - dF
    if (spill > 0.5) {
      rgb = rgb.map((v, k) => K[k] >= 128 ? Math.max(0, v - spill) : v)
      stats.despilled++
    }
    out.set(rgb.map(Math.round), p); out[p + 3] = Math.round(a * 255)
    if (a === 0) stats.transparent++; else if (a === 1) stats.opaque++; else stats.partial++
  }
  return {data: out, key: {...found, tolerance: Number(tol.toFixed(1)), dominance: dK, hi: Number(hi.toFixed(1)), lo}, holes, stats}
}
