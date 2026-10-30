// host validation for explicit figure calibration; no image decoder or Cubism dependency.
import { createHash } from 'node:crypto'
import { normalizeFigureExtension, figurePatch } from '../../packages/dsh-presentation-protocol/src/figure-scale.cjs'
export { figureCharacter } from '../../packages/dsh-presentation-protocol/src/figure-scale.cjs'
const pair = (v, max) => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n > 0 && n <= max)
// Figure calibration binds to the portrait WebP canvas, read from its RIFF chunks (no decoder).
function portraitWebpSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid layered WebP')
  let size, payload = false
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), p = offset + 8
    if (p + length > bytes.length) throw new Error('Truncated layered WebP')
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('Animated portrait layers are not supported')
    if (kind === 'VP8X' && length >= 10) { if (bytes[p] & 2) throw new Error('Animated portrait layers are not supported'); size = [1 + bytes.readUIntLE(p + 4, 3), 1 + bytes.readUIntLE(p + 7, 3)] }
    if (kind === 'VP8L' && length >= 5 && bytes[p] === 0x2f) { const bits = bytes.readUInt32LE(p + 1); const decoded = [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)]; if (size && String(size) !== String(decoded)) throw new Error('WebP canvas mismatch'); size = decoded; payload = true }
    if (kind === 'VP8 ' && length >= 10 && bytes[p + 3] === 0x9d && bytes[p + 4] === 1 && bytes[p + 5] === 0x2a) { const decoded = [bytes.readUInt16LE(p + 6) & 0x3fff, bytes.readUInt16LE(p + 8) & 0x3fff]; if (size && String(size) !== String(decoded)) throw new Error('WebP canvas mismatch'); size = decoded; payload = true }
    offset = p + length + (length & 1)
    if (offset === bytes.length) break
    if (offset > bytes.length - 8) throw new Error('Invalid layered WebP chunks')
  }
  if (!payload || !pair(size, 4096)) throw new Error('Invalid layered WebP dimensions')
  return size
}
function canonical(value) { return value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])])) : value }
export const figureRevision = value => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex')
export function checkFigureRevision(expected, current) {
  if (expected !== figureRevision(current)) throw new Error('Figure revision conflict; reload before confirming')
}
export function normalizeFigure(raw, sources, model = false) {
  try { return normalizeFigureExtension(raw, sources, model) }
  catch { return raw == null ? undefined : { ...raw, status: 'stale' } }
}
export async function confirmPortraitFigure(entry, patch, read) {
  const figure = normalizeFigureExtension(figurePatch(entry.figure, patch), entry.images)
  if (patch?.version === 1) normalizeFigureExtension({ ...patch, slots: Object.fromEntries(Object.entries(patch.slots || {}).filter(([, record]) => record !== null)) }, entry.images, false, true)
  if (figure?.version === 1) for (const record of Object.values(figure.slots)) {
    if (record.status === 'stale') continue
    const bytes = await read(record.sourceSha)
    if (!bytes || String(portraitWebpSize(bytes)) !== String(record.canvas)) throw new Error('Figure canvas does not match portrait bytes')
  }
  return figure
}
export function confirmModelFigure(figure, revision, canvas) {
  const normalized = normalizeFigureExtension(figure, revision, true, true)
  if (normalized?.version === 1 && (!canvas || String(canvas) !== String(normalized.canvas))) throw new Error('Figure canvas does not match model')
  return normalized
}
