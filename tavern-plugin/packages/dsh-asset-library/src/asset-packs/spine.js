// Spine figure outfits and their `kind: "spine"` bundles.
// The bundle entry is the skeleton (`.skel` binary or `.json`); its atlas is the sibling `<stem>.atlas`, whose
// pages are bundle images. Only data the vendored pixi-spine 3.1 runtime can read is installable.
import { check, shape, text, array, unique, record, relativePath, validateShortId, validateStateId } from './common.js'

// Binary 3.7 has no reader in the runtime's version dispatch; 3.7 JSON does.
export const SPINE_VERSIONS = Object.freeze({binary:Object.freeze(['3.8', '4.0', '4.1']), json:Object.freeze(['3.7', '3.8', '4.0', '4.1'])})
export const SPINE_IMAGE = /\.(png|webp|jpe?g)$/i
export const spineAtlasPath = entry => entry.replace(/\.(skel|json)$/i, '.atlas')

const name = (value, path) => text(value, path, 160)
// `hideSlots` names exact slots; a trailing `*` matches a slot-name prefix (scenery such as `rain_*`).
export function spineSlotHidden(patterns, slot) {
  return (patterns || []).some(pattern => pattern.endsWith('*') ? slot.startsWith(pattern.slice(0, -1)) : slot === pattern)
}
export function validateSpineOutfit(value, path = '$.spine') {
  shape(value, ['bundleKey', 'defaultAnimation', 'talkAnimation', 'emotionMap', 'hideSlots', 'skin', 'frame', 'anatomy', 'bottomFade'], ['bundleKey', 'defaultAnimation'], path)
  validateShortId(value.bundleKey, path + '.bundleKey')
  name(value.defaultAnimation, path + '.defaultAnimation')
  if (value.talkAnimation !== undefined) name(value.talkAnimation, path + '.talkAnimation')
  if (value.skin !== undefined) name(value.skin, path + '.skin')
  if (value.emotionMap !== undefined) record(value.emotionMap, path + '.emotionMap', (mapping, q, emotion) => {
    validateStateId(emotion, q); shape(mapping, ['animation', 'talk'], [], q); check(Object.keys(mapping).length > 0, q)
    for (const v of Object.values(mapping)) name(v, q)
  })
  if (value.hideSlots !== undefined) {
    array(value.hideSlots, path + '.hideSlots', 256)
    value.hideSlots.forEach(slot => { name(slot, path + '.hideSlots'); check(slot !== '*', path + '.hideSlots', 'A pattern cannot hide every slot') })
    unique(value.hideSlots, path + '.hideSlots')
  }
  // Display box in the runtime's y-down skeleton units [x, y, width, height]; anatomy fractions refer to it.
  if (value.frame !== undefined) {
    array(value.frame, path + '.frame', 4)
    check(value.frame.length === 4 && value.frame.every(Number.isFinite) && value.frame[2] > 0 && value.frame[3] > 0 && value.frame.every(v => Math.abs(v) <= 1e6), path + '.frame')
  }
  // Share of the visible height the stage fades out at the bottom; 0 turns the automatic cut-off fade off.
  if (value.bottomFade !== undefined) check(Number.isFinite(value.bottomFade) && value.bottomFade >= 0 && value.bottomFade <= 0.5, path + '.bottomFade')
  return value
}

function readVarint(bytes, at) {
  let result = 0
  for (let shift = 0; shift < 35; shift += 7) {
    if (at.i >= bytes.length) return -1
    const b = bytes[at.i++]
    result |= (b & 0x7f) << shift
    if (!(b & 0x80)) return result >>> 0
  }
  return -1
}
function readString(bytes, at) {
  const count = readVarint(bytes, at)
  if (count < 2 || count > 65 || at.i + count - 1 > bytes.length) return null
  const value = new TextDecoder('utf-8', {fatal:false}).decode(bytes.subarray(at.i, at.i + count - 1))
  at.i += count - 1
  return value
}
const versionOf = value => /^(\d+\.\d+)\.\d+/.exec(value || '')
// Binary headers: 4.x stores an 8-byte hash then the version string; 3.x stores hash and version strings.
export function spineSkeletonVersion(bytes, entry) {
  if (/\.json$/i.test(entry)) {
    let document
    try { document = JSON.parse(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes)) } catch { document = null }
    const match = versionOf(document?.skeleton?.spine)
    return match ? {format:'json', version:match[0], minor:match[1]} : null
  }
  for (const start of [8, 0]) {
    const at = {i:start}
    let value = readString(bytes, at)
    if (start === 0) value = readString(bytes, at)
    const match = versionOf(value)
    if (match) return {format:'binary', version:match[0], minor:match[1]}
  }
  return null
}
export function spineVersionSupported(info) {
  return Boolean(info && SPINE_VERSIONS[info.format].includes(info.minor))
}
// Page names are the first line of each blank-line separated block (the runtime's own atlas reader rule).
export function spineAtlasPages(source) {
  const pages = []
  let expectPage = true
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) { expectPage = true; continue }
    if (expectPage) { pages.push(line); expectPage = false }
  }
  return pages
}
// Closed bundle check: skeleton + sibling atlas + its pages; nothing executable or undeclared.
export function validateSpineBundle(bundleEntry, files, prefix) {
  const entry = prefix + bundleEntry
  check(/\.(skel|json)$/i.test(bundleEntry) && files.has(entry), entry, 'Spine entry must be a .skel or .json skeleton', 'MISSING_DEPENDENCY')
  const skeleton = files.get(entry)
  check(skeleton.length <= 64 * 1024 ** 2, entry, 'Spine skeleton exceeds 64 MiB', 'LIMIT_EXCEEDED')
  const info = spineSkeletonVersion(skeleton, bundleEntry)
  check(info, entry, 'Unreadable Spine skeleton version', 'UNSUPPORTED_SPINE_VERSION')
  check(spineVersionSupported(info), entry, `Spine ${info.version} (${info.format}) is not supported; use ${SPINE_VERSIONS[info.format].join('/')}`, 'UNSUPPORTED_SPINE_VERSION')
  const atlas = prefix + spineAtlasPath(bundleEntry)
  check(files.has(atlas), atlas, 'Missing Spine atlas', 'MISSING_DEPENDENCY')
  check(files.get(atlas).length <= 4 * 1024 ** 2, atlas, 'Spine atlas exceeds 4 MiB', 'LIMIT_EXCEEDED')
  const dir = bundleEntry.includes('/') ? bundleEntry.slice(0, bundleEntry.lastIndexOf('/') + 1) : ''
  const pages = spineAtlasPages(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(files.get(atlas))).map(page => {
    relativePath(dir + page, atlas)
    check(SPINE_IMAGE.test(page), atlas, 'Spine atlas page must be a PNG/WebP/JPEG image', 'INVALID_PATH')
    check(files.has(prefix + dir + page), prefix + dir + page, 'Missing Spine atlas page', 'MISSING_DEPENDENCY')
    return prefix + dir + page
  })
  check(pages.length > 0 && pages.length <= 32, atlas, 'Spine atlas needs 1–32 pages', 'LIMIT_EXCEEDED')
  const declared = new Set([entry, atlas, ...pages])
  for (const name of files.keys()) if (name.startsWith(prefix)) check(declared.has(name) || /\.(md|txt)$/i.test(name), name, 'Executable or undeclared Spine resource rejected')
  return {...info, pages}
}
