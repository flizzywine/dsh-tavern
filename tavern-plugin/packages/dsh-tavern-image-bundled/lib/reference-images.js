import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Local-only immutable references. No URLs, caller-selected paths, or network I/O. */
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp'])
const HASH = /^[0-9a-f]{64}$/
const writes = new Map()
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = (code, message) => Object.assign(new Error(message), { code, submissionNotStarted: true })
const mediaTypeOf = value => typeof value === 'string' ? value.trim().toLowerCase() : ''
const cleanText = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim() : ''
const cleanName = value => cleanText(value).replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').replace(/\s+/g, ' ').slice(0, 160) || '参考图'
const forbiddenLocation = value => ['path', 'filePath', 'url', 'href', 'src'].some(key => own(value, key))

/** Invalid persisted descriptors are never converted into a filesystem address. */
export function normalizeReferenceImage(value) {
  if (!record(value) || forbiddenLocation(value) || typeof value.id !== 'string' || !HASH.test(value.id)) return null
  const mediaType = mediaTypeOf(value.mediaType)
  if (!MEDIA.has(mediaType) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1) return null
  return { id: value.id, mediaType, name: cleanName(value.name), byteLength: value.byteLength }
}

export function normalizeConsistencyText(text) {
  return cleanText(text).slice(0, 4000)
}

function badImage(message = '参考图不是完整有效的 PNG、JPEG 或 WebP 图片') {
  throw fail('REFERENCE_IMAGE_INVALID', message)
}

// Container validation is deliberately stricter than a magic-byte sniff. It does
// not claim to decode every codec: the image provider still validates pixels.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}
function dimensions(width, height) {
  if (!width || !height || width > 65535 || height > 65535 || width * height > 100_000_000) badImage('参考图像素尺寸无效或过大')
}
function validatePng(bytes) {
  let offset = 8, header = false, image = false, palette = false, endedData = false, color = -1
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) badImage()
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    if (end > bytes.length) badImage()
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) badImage('PNG 区块校验失败')
    const data = offset + 8
    if (!header && type !== 'IHDR') badImage()
    if (type === 'IHDR') {
      if (header || length !== 13) badImage()
      dimensions(bytes.readUInt32BE(data), bytes.readUInt32BE(data + 4))
      color = bytes[data + 9]
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!depths[color]?.includes(bytes[data + 8]) || bytes[data + 10] || bytes[data + 11] || bytes[data + 12] > 1) badImage()
      header = true
    } else if (type === 'PLTE') {
      if (palette || image || !length || length % 3 || length > 768) badImage()
      palette = true
    } else if (type === 'IDAT') {
      if (endedData || (color === 3 && !palette)) badImage()
      if (length) image = true
    } else if (type === 'IEND') {
      if (length || !image || end !== bytes.length) badImage()
      return
    } else {
      if (image) endedData = true
      if (type[0] === type[0].toUpperCase()) badImage('PNG 包含不支持的关键区块')
    }
    offset = end
  }
  badImage()
}
function validateJpeg(bytes) {
  let offset = 2, frame = false, scan = false, entropy = false
  while (offset < bytes.length) {
    if (entropy) {
      if (bytes[offset++] !== 0xff) continue
      while (bytes[offset] === 0xff) offset++
      if (bytes[offset] === 0 || (bytes[offset] >= 0xd0 && bytes[offset] <= 0xd7)) { offset++; continue }
      offset--
      entropy = false
    }
    if (bytes[offset++] !== 0xff) badImage()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) {
      if (!frame || !scan || offset !== bytes.length) badImage()
      return
    }
    if (!marker || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) badImage()
    if (marker === 1) continue
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) badImage()
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 11 || frame) badImage()
      const components = bytes[offset + 7]
      if (!components || length !== 8 + components * 3 || ![8, 12, 16].includes(bytes[offset + 2])) badImage()
      dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
      frame = true
    }
    if (marker === 0xda) {
      const components = bytes[offset + 2]
      if (!frame || !components || length !== 6 + 2 * components) badImage()
      scan = true
      entropy = true
    }
    offset += length
  }
  badImage()
}
function validateWebp(bytes, frameOnly = false) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) badImage()
  let offset = 12, image = false, extended = false, animated = false
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) badImage()
    const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4)
    const data = offset + 8, end = data + length + (length % 2)
    if (end > bytes.length) badImage()
    if (type === 'VP8X') {
      if (frameOnly || offset !== 12 || length !== 10) badImage()
      dimensions(1 + bytes.readUIntLE(data + 4, 3), 1 + bytes.readUIntLE(data + 7, 3))
      extended = true
      animated = Boolean(bytes[data] & 2)
    } else if (type === 'VP8 ') {
      if (length < 10 || bytes[data] & 1 || bytes.toString('hex', data + 3, data + 6) !== '9d012a') badImage()
      dimensions(bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff)
      image = true
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[data] !== 0x2f || bytes[data + 4] & 0xe0) badImage()
      const bits = bytes.readUInt32LE(data + 1)
      dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
      image = true
    } else if (type === 'ANMF') {
      if (!extended || !animated || length < 24) badImage()
      dimensions(1 + bytes.readUIntLE(data + 6, 3), 1 + bytes.readUIntLE(data + 9, 3))
      // Validate the nested frame as an ordinary WebP container as well.
      const frame = bytes.subarray(data + 16, data + length)
      const wrapped = Buffer.alloc(12 + frame.length)
      wrapped.write('RIFF'); wrapped.writeUInt32LE(wrapped.length - 8, 4); wrapped.write('WEBP', 8); frame.copy(wrapped, 12)
      validateWebp(wrapped, true)
      image = true
    } else if (!extended && type !== 'ALPH') badImage()
    offset = end
  }
  if (!image) badImage()
}
function inspectImage(bytes) {
  if (bytes.length >= 8 && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a') { validatePng(bytes); return 'image/png' }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) { validateJpeg(bytes); return 'image/jpeg' }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') { validateWebp(bytes); return 'image/webp' }
  badImage()
}
function decodeUpload(value, maxBytes) {
  if (!record(value) || forbiddenLocation(value) || typeof value.data !== 'string') throw fail('REFERENCE_UPLOAD_INVALID', '只接受参考图的 Base64 或 data URL，不接受路径或远程 URL')
  let encoded = value.data, declared = mediaTypeOf(value.mediaType)
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 100) throw fail('REFERENCE_IMAGE_TOO_LARGE', '参考图超过允许的字节大小')
  if (declared && !MEDIA.has(declared)) throw fail('REFERENCE_MEDIA_TYPE_INVALID', '参考图仅支持 PNG、JPEG、WebP')
  if (encoded.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(encoded)
    if (!match) throw fail('REFERENCE_UPLOAD_INVALID', '参考图 data URL 格式无效')
    if (declared && declared !== match[1].toLowerCase()) throw fail('REFERENCE_MEDIA_TYPE_MISMATCH', '参考图声明类型与 data URL 不一致')
    declared ||= match[1].toLowerCase()
    encoded = match[2]
  }
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw fail('REFERENCE_UPLOAD_INVALID', '参考图 Base64 格式无效')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) throw fail('REFERENCE_UPLOAD_INVALID', '参考图 Base64 编码不规范')
  if (!bytes.length || bytes.length > maxBytes) throw fail('REFERENCE_IMAGE_TOO_LARGE', '参考图超过允许的字节大小')
  const mediaType = inspectImage(bytes)
  if (declared && mediaType !== declared) throw fail('REFERENCE_MEDIA_TYPE_MISMATCH', '参考图真实类型与声明不一致')
  return { bytes, descriptor: { id: hash(bytes), mediaType, name: cleanName(value.name), byteLength: bytes.length } }
}

/**
 * put/read are async. Files are addressed solely by a validated SHA-256, created
 * with O_EXCL and never overwritten. Replacing a library reference changes only
 * its descriptor; all older descriptors keep resolving to their original bytes.
 * root is a trusted application-selected directory, never a request field.
 */
export function createReferenceImageStore(root, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof root !== 'string' || !root.trim() || /^(?:https?|file|data):/i.test(root) || root.includes('\0')) throw fail('REFERENCE_STORE_INVALID', '参考图目录无效')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw fail('REFERENCE_STORE_INVALID', '参考图大小上限必须是正整数')
  const directory = resolve(root)
  let initialized
  async function ready() {
    initialized ||= (async () => {
      await mkdir(directory, { recursive: true })
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw fail('REFERENCE_PATH_INVALID', '参考图目录不能是符号链接')
      return realpath(directory)
    })()
    const canonical = await initialized
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== canonical) throw fail('REFERENCE_PATH_INVALID', '参考图目录发生了不安全的变更')
    return canonical
  }
  async function readStored(id, expected = null) {
    const directory = await ready(), file = join(directory, id)
    let before
    try { before = await lstat(file) } catch (error) {
      if (error.code === 'ENOENT') throw fail('REFERENCE_IMAGE_MISSING', '参考图文件不存在，请重新上传')
      throw error
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw fail('REFERENCE_PATH_INVALID', '参考图文件不是独立的普通文件')
    if (before.size > maxBytes) throw fail('REFERENCE_IMAGE_TOO_LARGE', '参考图超过允许的字节大小')
    if (!before.size || (expected && before.size !== expected.byteLength)) throw fail('REFERENCE_IMAGE_CORRUPT', '参考图文件长度与快照不一致')
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size) throw fail('REFERENCE_PATH_INVALID', '参考图文件发生了不安全的变更')
      const data = Buffer.alloc(before.size)
      let offset = 0
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      const extra = await handle.read(Buffer.alloc(1), 0, 1, data.length)
      if (offset !== data.length || extra.bytesRead || hash(data) !== id) throw fail('REFERENCE_IMAGE_CORRUPT', '参考图内容校验失败，不能用于旧快照')
      const mediaType = inspectImage(data)
      if (expected && mediaType !== expected.mediaType) throw fail('REFERENCE_MEDIA_TYPE_MISMATCH', '参考图快照类型与文件不一致')
      return { data, mediaType, name: expected?.name || id + ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[mediaType]) }
    } finally { await handle.close() }
  }
  async function read(value) {
    const descriptor = normalizeReferenceImage(value)
    if (!descriptor) throw fail('REFERENCE_DESCRIPTOR_INVALID', '参考图描述无效；不接受路径或 URL')
    if (descriptor.byteLength > maxBytes) throw fail('REFERENCE_IMAGE_TOO_LARGE', '参考图超过允许的字节大小')
    return readStored(descriptor.id, descriptor)
  }
  // Preview newly uploaded drafts before a descriptor is saved in the library.
  // A hash is the ONLY accepted selector; media type and size come from bytes.
  async function readById(id) {
    if (typeof id !== 'string' || !HASH.test(id)) throw fail('REFERENCE_DESCRIPTOR_INVALID', '参考图编号必须是 64 位小写 SHA-256，不接受路径或 URL')
    const result = await readStored(id)
    return { ...result, referenceImage: { id, mediaType: result.mediaType, name: result.name, byteLength: result.data.length } }
  }
  async function put(value) {
    const { bytes, descriptor } = decodeUpload(value, maxBytes)
    const directory = await ready(), file = join(directory, descriptor.id)
    let pending = writes.get(file)
    if (!pending) {
      pending = (async () => {
        let handle
        try { handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600) }
        catch (error) { if (error.code !== 'EEXIST') throw error }
        if (handle) {
          try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
        }
        // An existing file is verified, never repaired/overwritten in place.
        await read(descriptor)
      })()
      writes.set(file, pending)
      pending.finally(() => { if (writes.get(file) === pending) writes.delete(file) }).catch(() => {})
    }
    await pending
    return { ...descriptor }
  }
  // Native filesystem errors include absolute paths in their messages. Public
  // store operations must expose only stable domain errors or a safe errno.
  const ioGuard = operation => async (...args) => {
    try { return await operation(...args) }
    catch (error) {
      if (typeof error?.code === 'string' && /^REFERENCE_[A-Z0-9_]+$/.test(error.code)) throw error
      const errno = typeof error?.code === 'string' && /^E[A-Z0-9_]{1,47}$/.test(error.code) ? error.code : 'IO_ERROR'
      throw fail('REFERENCE_STORAGE_UNAVAILABLE', '本地参考图存储不可用（' + errno + '）')
    }
  }
  return { put: ioGuard(put), read: ioGuard(read), readById: ioGuard(readById) }
}

const arr = value => Array.isArray(value) ? value : []
const enabled = item => record(item) && item.enabled !== false
const idOf = item => typeof item?.id === 'string' ? item.id.trim() : ''
const keyOf = value => cleanText(value).toLowerCase().replace(/[\s_\-.'"（）()]+/g, '')
const aliases = item => [...new Set([item?.name, ...String(item?.match ?? '').split(/[,，、]/)].map(cleanText).filter(Boolean))]
const displayName = item => cleanText(item?.name) || idOf(item)
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MACRO = /\$\{([\s\S]*?)\}\$/g
const BARE = /\b(?:nude|naked|topless|bottomless|undress(?:ed|ing)?|unclothed|strip(?:ped|ping)|lingerie|underwear|bra|panties|shower(?:ing)?|bathing|bath(?:tub)?|onsen)\b|全裸|裸体|赤裸|一丝不挂|没穿衣|脱衣|脱光|脱下|脱掉|洗澡|沐浴|泡澡|内衣|内裤/i
const CHANGE = /\b(?:chang(?:e|ed|es|ing)\s+(?:her |his |their |the )?(?:clothes|outfit|into)|put(?:s|ting)? on|tak(?:e|es|ing) off|took off|remov(?:e|ed|ing))\b|换上|换下|换了|换衣|换装|穿上|脱下|脱掉|脱去/i
const GARMENT = /\b(?:dress|gown|skirt|shirt|blouse|sweater|cardigan|hoodie|jacket|coat|vest|apron|kimono|robe|pajamas|uniform|suit|pants|trousers|jeans|shorts|swimsuit|bikini|lingerie|bra|panties|underwear|stockings|socks|boots|heels|sandals)\b|衬衫|裙|裤|外套|大衣|毛衣|睡衣|制服|旗袍|汉服|浴袍|泳装|内衣|内裤/i
const NOT_WORN = /\b(?:hold(?:ing|s)?|carr(?:y|ies|ying)|remov(?:e|ed|ing)|took off|tak(?:e|ing) off|discard(?:ed|ing)?|on (?:the )?(?:floor|chair|bed|hanger))\b|手里|手中|拿着|提着|放在|挂在|脱下|脱掉|脱去|扔掉/i
const NAKED = /^(?:nude|naked|nothing|no clothes|completely (?:nude|naked)|全裸|裸体|赤裸|一丝不挂|没穿)/i

function catalog(definitions) {
  const people = arr(definitions?.characters).filter(enabled)
  const outfits = people.flatMap(person => arr(person.outfits).filter(enabled).map(item => ({ item, owner: person })))
    .concat(arr(definitions?.outfits).filter(enabled).map(item => ({ item, owner: null })))
  return { people, outfits }
}
function unique(items, label, required = false) {
  if (items.length > 1) throw fail('REFERENCE_ID_AMBIGUOUS', '参考图对象存在歧义：' + label)
  if (!items.length && required) throw fail('REFERENCE_ID_UNKNOWN', '找不到可用的参考图对象：' + label)
  return items[0] || null
}
function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) throw fail('REFERENCE_SUBJECT_INVALID', label + ' 必须是有效的精确 ID')
  return value.trim()
}
function personById(lib, id) {
  const key = requireId(id, 'characterId')
  return unique(lib.people.filter(item => idOf(item) === key), 'characterId=' + key, true)
}
function availableOutfits(lib, person) {
  return lib.outfits.filter(entry => !entry.owner || entry.owner === person)
}
function outfitById(lib, person, id) {
  const key = requireId(id, 'outfitId')
  return unique(availableOutfits(lib, person).filter(entry => idOf(entry.item) === key), 'outfitId=' + key, true)
}
function matchObject(item, name) {
  const key = keyOf(name)
  return key && [idOf(item), ...aliases(item)].some(alias => keyOf(alias) === key)
}
function outfitByName(lib, person, name) {
  const clean = cleanText(name).replace(/\s*[（(]\s*(?:这套是)?常穿\s*[)）]\s*$/, '')
  return unique(availableOutfits(lib, person).filter(entry => matchObject(entry.item, clean)), '服装=' + clean)
}
function referenceOf(item) {
  if (item?.referenceImage == null || item.referenceImage === '') return null
  const image = normalizeReferenceImage(item.referenceImage)
  if (!image) throw fail('REFERENCE_DESCRIPTOR_INVALID', '参考图描述无效：' + displayName(item))
  return image
}
/** 角色×服装设定图: a character's own outfit drawn on that character; fixes identity and clothing together. */
function sheetOf(item) {
  if (item?.characterOutfitImage == null || item.characterOutfitImage === '') return null
  const image = normalizeReferenceImage(item.characterOutfitImage)
  if (!image) throw fail('REFERENCE_DESCRIPTOR_INVALID', '角色×服装设定图描述无效：' + displayName(item))
  return image
}
function normalizeSubjects(input, lib) {
  if (!Array.isArray(input)) throw fail('REFERENCE_SUBJECTS_INVALID', 'subjects 必须是数组；缺省时才使用兼容识别')
  const result = [], seen = new Map()
  for (const entry of input) {
    if (!record(entry)) throw fail('REFERENCE_SUBJECT_INVALID', 'subjects 中每项必须是角色对象')
    if (entry.outfitId !== undefined && typeof entry.outfitId !== 'string') throw fail('REFERENCE_SUBJECT_INVALID', 'outfitId 必须是精确 ID 或空字符串')
    const outfitId = entry.outfitId?.trim() || ''
    // An explicit name-only subject is an unregistered, text-described person,
    // not a malformed library ID. Never guess a matching character from its name.
    const unnamedId = !own(entry, 'characterId') || entry.characterId === ''
    const name = cleanText(entry.name)
    if (unnamedId && !name) throw fail('REFERENCE_SUBJECT_INVALID', '未建库主体需要有效 name，已知人物需要 characterId')
    const person = unnamedId ? null : personById(lib, entry.characterId)
    // Name-only subjects may select a shared costume, never another person's
    // owned costume. Their description stays in the prompt and in the snapshot.
    const outfit = outfitId ? outfitById(lib, person, outfitId) : null
    const subject = person ? { characterId: idOf(person), outfitId }
      : { name, ...(own(entry, 'outfitId') ? { outfitId } : {}) }
    const identity = JSON.stringify(person ? ['character', subject.characterId] : ['text', name])
    if (seen.has(identity)) {
      if ((seen.get(identity).outfitId || '') !== outfitId) throw fail('REFERENCE_SUBJECT_CONFLICT', '同一画面给角色指定了不同服装：' + (subject.characterId || name))
      continue
    }
    seen.set(identity, subject)
    result.push({ person, outfit, subject, position: result.length * 2, outfitPosition: result.length * 2 + 1 })
  }
  return result
}
function nameMatches(text, values) {
  const found = []
  for (const value of values) {
    const needsBoundary = character => /[\p{L}\p{N}_]/u.test(character) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)
    const re = new RegExp((needsBoundary(value[0]) ? '(?<![\\p{L}\\p{N}_])' : '') + escape(value) + (needsBoundary(value.at(-1)) ? '(?![\\p{L}\\p{N}_])' : ''), 'giu')
    for (const match of text.matchAll(re)) found.push({ position: match.index, end: match.index + match[0].length })
  }
  return found
}
function sentenceAt(text, position) {
  const start = Math.max(text.lastIndexOf('\n', position - 1), text.lastIndexOf('。', position - 1), text.lastIndexOf(';', position - 1)) + 1
  const tail = text.slice(position).search(/[\n。;]/)
  return text.slice(start, tail < 0 ? text.length : position + tail)
}
function legacySubjects(text, lib) {
  const macroEvents = [], characterEvents = []
  const plain = text.replace(MACRO, (whole, body, position) => {
    let call
    try { call = JSON.parse('{' + body + '}') } catch { throw fail('REFERENCE_MACRO_INVALID', '人物／服装宏 JSON 无法解析') }
    const name = cleanText(call.name ?? call['名称'] ?? call['角色'])
    const person = own(call, 'characterId') ? personById(lib, call.characterId)
      : unique(lib.people.filter(item => matchObject(item, name)), '人物=' + name)
    const event = { position, end: position + whole.length, call, name, person }
    macroEvents.push(event)
    if (person) characterEvents.push(event)
    return ' '.repeat(whole.length)
  })
  const mentions = lib.people.flatMap(person => nameMatches(plain, aliases(person)).map(match => ({ ...match, person })))
    .sort((a, b) => a.position - b.position || b.end - a.end)
  let last = null
  for (const mention of mentions) {
    if (last && mention.position < last.end) {
      if (mention.position === last.position && mention.end === last.end && mention.person !== last.person) throw fail('REFERENCE_ID_AMBIGUOUS', '人物名称／别名存在歧义：' + plain.slice(mention.position, mention.end))
      continue
    }
    characterEvents.push(mention); last = mention
  }
  characterEvents.sort((a, b) => a.position - b.position)
  const rows = [], byPerson = new Map()
  for (const event of characterEvents) {
    personById(lib, idOf(event.person))
    let row = byPerson.get(event.person)
    if (!row) { row = { person: event.person, position: event.position, outfitPosition: event.position + 0.5, outfit: null, explicit: false, blocked: false }; rows.push(row); byPerson.set(event.person, row) }
    const call = event.call
    if (!call) continue
    const upper = String(call.upperBody ?? call.body ?? '').toLowerCase(), lower = String(call.lowerBody ?? '').toLowerCase()
    row.blocked ||= upper === 'nsfw' || lower === 'nsfw' || (upper === 'hidden' && lower === 'hidden')
    const field = ['outfitId', 'outfit', 'clothes', '服装'].find(key => own(call, key))
    if (field) {
      if (typeof call[field] !== 'string') throw fail('REFERENCE_SUBJECT_INVALID', '人物宏的服装必须是字符串')
      const value = call[field].trim()
      const outfit = !value ? null : (field === 'outfitId' ? outfitById(lib, event.person, value) : outfitByName(lib, event.person, value))
      if (row.explicit && row.outfit !== outfit && (row.outfit || outfit)) throw fail('REFERENCE_SUBJECT_CONFLICT', '同一画面的人物宏给出了不同服装：' + idOf(row.person))
      row.explicit = true; row.outfit = outfit; row.outfitPosition = event.position + 0.5
    }
  }
  const extra = []
  const preceding = position => characterEvents.filter(event => event.position <= position).at(-1)?.person || (rows.length === 1 ? rows[0].person : null)
  for (const event of macroEvents.filter(event => !event.person)) {
    const person = preceding(event.position)
    const candidates = person ? availableOutfits(lib, person) : lib.outfits.filter(entry => !entry.owner)
    const outfit = own(event.call, 'outfitId')
      ? unique(candidates.filter(entry => idOf(entry.item) === requireId(event.call.outfitId, 'outfitId')), 'outfitId=' + event.call.outfitId, true)
      : unique(candidates.filter(entry => matchObject(entry.item, event.name)), '服装=' + event.name)
    if (!outfit) continue // An unknown descriptive character is not a known library ID.
    if (person) {
      const row = byPerson.get(person)
      if (row.explicit && row.outfit !== outfit) throw fail('REFERENCE_SUBJECT_CONFLICT', '人物宏与服装宏相互矛盾：' + idOf(person))
      row.explicit = true; row.outfit = outfit; row.outfitPosition = event.position
    } else extra.push({ outfit, position: event.position })
  }
  for (const row of rows) {
    if (!row.explicit) {
      const named = availableOutfits(lib, row.person).flatMap(outfit => nameMatches(plain, aliases(outfit.item)).map(match => ({ ...match, outfit })))
        .filter(match => preceding(match.position) === row.person && !NOT_WORN.test(sentenceAt(plain, match.position)))
        .sort((a, b) => a.position - b.position || b.end - a.end)
      // Prefer complete longer names over a shorter name occurring inside them.
      const selected = []
      for (const match of named) {
        const prior = selected.at(-1)
        if (prior && match.position < prior.end && !(match.position === prior.position && match.end === prior.end)) continue
        if (!selected.some(item => item.outfit === match.outfit)) selected.push(match)
      }
      const choice = unique(selected, '画面中的服装：' + displayName(row.person))
      if (choice) { row.explicit = true; row.outfit = choice.outfit; row.outfitPosition = choice.position }
    }
    if (!row.explicit) {
      const context = plain // Conservative: uncertain undressing must not auto-dress another person.
      const current = cleanText(row.person.current?.outfit)
      if (!row.blocked && !BARE.test(context) && !CHANGE.test(context) && !GARMENT.test(context) && !NAKED.test(current)) {
        if (current) row.outfit = outfitByName(lib, row.person, current)
        else row.outfit = unique(lib.outfits.filter(entry => entry.owner === row.person && entry.item.default === true), '常穿服装：' + displayName(row.person))
      }
    }
    if (row.outfit) outfitById(lib, row.person, idOf(row.outfit.item))
    row.subject = { characterId: idOf(row.person), outfitId: row.outfit ? idOf(row.outfit.item) : '' }
  }
  // A standalone shared outfit can be the whole subject of an image. Do not
  // invent its wearer or pull an owner's character image into a clothing shot.
  if (!rows.length) {
    const mentions = lib.outfits.filter(entry => !entry.owner).flatMap(outfit => nameMatches(plain, aliases(outfit.item)).map(match => ({ ...match, outfit })))
      .filter(match => !NOT_WORN.test(sentenceAt(plain, match.position)))
      .sort((a, b) => a.position - b.position || b.end - a.end)
    let prior = null
    for (const mention of mentions) {
      if (prior && mention.position < prior.end) {
        if (mention.position === prior.position && mention.end === prior.end && mention.outfit !== prior.outfit) throw fail('REFERENCE_ID_AMBIGUOUS', '通用服装名称存在歧义')
        continue
      }
      requireId(idOf(mention.outfit.item), 'outfitId')
      unique(lib.outfits.filter(entry => !entry.owner && idOf(entry.item) === idOf(mention.outfit.item)), '通用服装=' + idOf(mention.outfit.item), true)
      extra.push({ outfit: mention.outfit, position: mention.position }); prior = mention
    }
  }
  return { rows, extra }
}

/**
 * Explicit subjects (including []) are authoritative; omitted/empty outfitId
 * never means default clothing. Only subjects === undefined enables legacy
 * macro/name recognition against THIS image's text and character prompts.
 * Shared outfits have no characterId in references; subjects retain wearer IDs.
 */
export function resolveImageReferences({ text = '', characters = [], subjects, definitions = {} } = {}) {
  const lib = catalog(definitions)
  const source = [typeof text === 'string' ? text : '', ...arr(characters).map(item => typeof item?.prompt === 'string' ? item.prompt : '')].join('\n')
  const { rows, extra } = subjects === undefined ? legacySubjects(source, lib) : { rows: normalizeSubjects(subjects, lib), extra: [] }
  const candidates = []
  for (const row of rows) {
    // Tier 1: the character×outfit sheet stands alone for both identity and clothing.
    const sheet = row.person && row.outfit?.owner === row.person ? sheetOf(row.outfit.item) : null
    if (sheet) {
      candidates.push({ kind: 'character-outfit', item: row.outfit.item, person: row.person, position: row.position, image: sheet })
      continue
    }
    // Tiers 2–3: the character sheet plus the outfit image; an outfit without one stays text.
    if (row.person) candidates.push({ kind: 'character', item: row.person, person: row.person, position: row.position })
    if (row.outfit) candidates.push({ kind: 'outfit', item: row.outfit.item, person: row.outfit.owner,
      wearer: row.person || (row.subject?.name ? { name: row.subject.name } : null), position: row.outfitPosition })
  }
  for (const row of extra) candidates.push({ kind: 'outfit', item: row.outfit.item, person: row.outfit.owner, position: row.position })
  candidates.sort((a, b) => a.position - b.position)
  const references = [], seen = new Map()
  for (const entry of candidates) {
    const image = entry.image ?? referenceOf(entry.item)
    if (!image) continue
    const id = requireId(idOf(entry.item), entry.kind === 'character' ? 'characterId' : 'outfitId')
    if (entry.kind === 'outfit' && !entry.person) unique(lib.outfits.filter(item => !item.owner && idOf(item.item) === id), '通用服装=' + id, true)
    const key = JSON.stringify([entry.kind, entry.kind !== 'character' ? idOf(entry.person) : '', id])
    let saved = seen.get(key)
    if (!saved) {
      const label = entry.kind === 'character' ? displayName(entry.item) : (entry.person ? displayName(entry.person) + '／' : '通用服装／') + displayName(entry.item)
      const reference = { index: references.length + 1, kind: entry.kind,
        ...(entry.person ? { characterId: idOf(entry.person) } : {}),
        ...(entry.kind === 'character-outfit' ? { characterLabel: displayName(entry.person) } : {}),
        ...(entry.kind !== 'character' ? { outfitId: id } : {}),
        label, consistencyText: normalizeConsistencyText(entry.kind === 'character-outfit'
          ? [entry.person.consistencyText, entry.item.consistencyText].map(cleanText).filter(Boolean).join('\n')
          : entry.item.consistencyText), image }
      references.push(reference); saved = { reference, label, wearers: new Set() }; seen.set(key, saved)
    }
    if (entry.kind === 'outfit' && !entry.person && entry.wearer) {
      saved.wearers.add(displayName(entry.wearer) + (idOf(entry.wearer) ? ' [characterId=' + idOf(entry.wearer) + ']' : '（未建库人物）'))
      saved.reference.label = saved.label + '（本图穿着者：' + [...saved.wearers].join('、') + '）'
    }
  }
  return { references, subjects: rows.map(row => ({ ...row.subject })) }
}

function checkedReferences(value) {
  if (!Array.isArray(value)) throw fail('REFERENCE_LIST_INVALID', 'references 必须是数组')
  return value.map((reference, index) => {
    if (!record(reference) || reference.index !== index + 1 || !['character', 'character-outfit', 'outfit'].includes(reference.kind) || !normalizeReferenceImage(reference.image)) throw fail('REFERENCE_LIST_INVALID', '参考图编号、对象或描述无效')
    if (reference.kind !== 'outfit') requireId(reference.characterId, 'characterId')
    if (reference.kind !== 'character') requireId(reference.outfitId, 'outfitId')
    return reference
  })
}

export function buildReferenceText(references) {
  const items = checkedReferences(references)
  if (!items.length) return ''
  const lines = ['【参考图绑定与必要一致性约束】',
    '下面的参考图序号严格对应本次上传图片的顺序，不得交换人物身份或服装归属。',
    '角色身份图只约束面部、发型和体态，不继承其中的衣服、姿势、表情或背景。服装图只约束服饰设计，不继承模特身份、脸、发型、体态、姿势或背景。角色×服装设定图同时约束该人物身份与该套服饰，不继承姿势、表情或背景。',
    '动作、表情、镜头、环境和服装状态以本张剧情描述为准；剧情明确的换装、湿衣、破损、脱衣及外观状态变化优先于参考图中的旧状态。禁止照搬任何参考场景。']
  for (const reference of items) {
    const binding = reference.kind === 'character' ? 'characterId=' + reference.characterId
      : (reference.characterId ? 'characterId=' + reference.characterId + '，' : '通用服装，') + 'outfitId=' + reference.outfitId
    lines.push('参考图' + reference.index + ' → ' + cleanText(reference.label).replace(/\n/g, ' ') + '（' + binding + '）：' + (reference.kind === 'character' ? '用于该角色身份一致性，不作为服装或场景参考。' : reference.kind === 'character-outfit' ? '角色×服装设定图，同时用于该角色身份与该套服装的一致性，不作为场景参考。' : '用于该套服装的一致性，不作为人物身份或场景参考。'))
    const extra = normalizeConsistencyText(reference.consistencyText)
    if (extra) lines.push('该对象的用户补充（仍须服从上述用途边界与剧情变化）：\n' + extra)
  }
  return lines.join('\n')
}

const cleanReferenceLabel = value => cleanText(value).replace(/\s*\[characterId=[^\]\r\n]*\]/g, '').replace(/\n/g, ' ')
const identityLabel = item => item.kind === 'character-outfit' ? item.characterLabel : item.label

function structuredIdentityNames(items) {
  const identities = items.filter(item => item.kind !== 'outfit')
  return new Map(identities.map(item => {
    const label = cleanReferenceLabel(identityLabel(item))
    const duplicate = identities.some(other => other.characterId !== item.characterId && cleanReferenceLabel(identityLabel(other)) === label)
    return [item.characterId, label + (duplicate ? '（对象' + item.index + '）' : '')]
  }))
}

function structuredReferenceLabels(items, definitions) {
  const identities = items.filter(item => item.kind !== 'outfit')
  const names = structuredIdentityNames(items)
  for (const person of arr(definitions?.characters)) if (person.promptLabel) names.set(idOf(person), person.promptLabel)
  const labels = items.map(item => {
    if (item.kind === 'character') return names.get(item.characterId)
    let label = cleanText(item.label)
    const owner = identities.find(person => person.characterId === item.characterId)
    const ownerLabel = owner ? identityLabel(owner) : arr(definitions?.characters).find(person => idOf(person) === item.characterId)?.name
    if (ownerLabel && names.has(item.characterId) && label.startsWith(ownerLabel + '／')) label = names.get(item.characterId) + label.slice(ownerLabel.length)
    // Shared costumes may belong to several wearers, not to their library owner.
    for (const person of identities) label = label.replaceAll(identityLabel(person) + ' [characterId=' + person.characterId + ']', names.get(person.characterId))
    return cleanReferenceLabel(label.replace(/([^（：、]+) \[characterId=([^\]\r\n]+)\]/g, (match, name, id) => names.get(id) || name))
  })
  return labels.map((label, index) => items[index].kind !== 'character' && items.some((other, at) => at !== index && other.kind === items[index].kind && labels[at] === label)
    ? label + '（对象' + (index + 1) + '）' : label)
}

/** Render trusted bindings once; IDs stay in the job metadata, not visual prose. */
export function buildStructuredReferenceText(references, definitions) {
  const items = checkedReferences(references)
  if (!items.length) return ''
  const lines = []
  if (items.some(item => item.kind === 'character')) lines.push('人物的面部特征、发型和体型比例依据对应身份参考图及随附说明。')
  if (items.some(item => item.kind === 'outfit')) lines.push('服装图仅约束服饰设计，不继承模特身份、面部、发型、体型、姿势或背景。')
  if (items.some(item => item.kind === 'character-outfit')) lines.push('角色×服装设定图同时约束人物身份与该套服饰，不继承姿势、表情或背景。')
  lines.push('')
  const labels = structuredReferenceLabels(items, definitions)
  for (const [index, item] of items.entries()) {
    const label = labels[index]
    const purpose = item.kind === 'character' ? '身份参考' : item.kind === 'character-outfit' ? '角色×服装参考' : '服装参考'
    const extra = normalizeConsistencyText(item.consistencyText)
    lines.push('参考图' + item.index + ' → ' + label + '（' + purpose + '）' + (extra ? '：' + extra : ''))
  }
  return lines.join('\n')
}

/** Planner gets labels/IDs/availability, never bytes, local paths, or remote URLs. */
export function referencePlannerGuidance(definitions = {}, { structured = false } = {}) {
  const lib = catalog(definitions)
  const lines = ['【参考图模式规划规则】',
    '只为当前这张 image 中实际出现的人物选择参考图，不得把整个图库或仅在正文被提及但不出镜的人物传入。',
    '每个 <image> 内必须输出一次 <subjects>JSON数组</subjects>，例如 <subjects>[{"characterId":"精确角色ID","outfitId":"当刻精确服装ID或空字符串"}]</subjects>。ID 必须从下列清单原样复制，不使用姓名代替 ID，不猜测 ID。无人时输出 []。',
    '同一角色仅列一次。outfitId 必须对应该角色在这一张画面、这一时刻实际穿的服装；未指定图库服装、裸露、衣物不可见或用纯文字描述衣物时填 ""，不要因此补常穿。未知或未建库人物保留在画面描述中，可在 subjects 中写 {"name":"该人物名称"}，不要编造 characterId；若穿通用服装，可另外填写该通用服装的 outfitId。',
    '服装可以只用文字描述，不必从图库挑一套；当前剧情明确的衣着、状态变化优先，脱下、拿在手中或放在一旁的衣服不作为正在穿着的服装。',
    '有图对象以图片及其一致性补充约束固定外观，不再完整堆叠它的固定 traits 或服装标签；缺图对象继续使用完整文字描述。角色图不继承服装、姿势或背景，服装图不继承模特身份；动作和场景依据当前剧情。',
    '取图顺序由插件决定，照常填写 characterId 与 outfitId 即可：服装标有 characterOutfitImage（角色×服装设定图）时只用这一张同时约束身份与服装；否则用角色图加服装图；服装没有图时保留服装文字。',
    '后台插件会按实际上传顺序绑定参考图编号，不要自行猜测编号。若整张图没有任何可用参考图，后端会暂停并提示，不自动退回纯文生图。',
    ...(structured ? [
      '有身份参考图的人物，结构化画面正文只写人物名称及本张可见状态，不再描述年龄、性别、面部、发型或固有体型等固定身份属性，不用“年轻男性”“青年男子”等概括词重新定义身份，也不从姓名、正文或人物库复述这些固定属性。剧情明确的外观变化与用户明确的一致性补充仍须保留并归属到具体人物；当前表情、衣着、姿态不是固定身份属性，应按本张描述。',
      '此限制仅适用于有身份图的人物；只有服装图或没有身份图的人物仍用库内文字与正文描述可见外貌，不把其他人物的参考图套给他们。',
      '不要重复写“身份以参考图为准”、参考图编号、内部ID或通用参考图约束，不另设人物及参考图对应分节；绑定与用途说明由插件生成一次，人物节只描述本张状态。精确ID放在 subjects 元数据中。同名人物需要区别动作时，使用人物宏 ${"name":"精确角色ID"}$ 绑定各自描述，朝向与动作直接写在句子里。独立成行的人物宏可填写朝向。普通正文使用可读称呼。',
      '多人同框时，写清每个动作及身体接触的双方；按前后景、裁切和遮挡交代可见范围，只描写入镜部位的细节。',
    ] : []),
    '【可用对象与参考图清单；仅文字元数据】']
  for (const person of lib.people) {
    personById(lib, idOf(person))
    const image = referenceOf(person)
    lines.push(JSON.stringify({ characterId: idOf(person), name: displayName(person), referenceImage: image ? '有图' : '无图', consistencyText: normalizeConsistencyText(person.consistencyText) }))
    for (const entry of lib.outfits.filter(entry => entry.owner === person)) {
      outfitById(lib, person, idOf(entry.item))
      lines.push('  ' + JSON.stringify({ characterId: idOf(person), outfitId: idOf(entry.item), name: displayName(entry.item), referenceImage: referenceOf(entry.item) ? '有图' : '无图',
        ...(sheetOf(entry.item) ? { characterOutfitImage: '有图' } : {}), consistencyText: normalizeConsistencyText(entry.item.consistencyText) }))
    }
  }
  for (const entry of lib.outfits.filter(entry => !entry.owner)) {
    const id = requireId(idOf(entry.item), 'outfitId')
    unique(lib.outfits.filter(item => !item.owner && idOf(item.item) === id), '通用服装=' + id, true)
    const image = referenceOf(entry.item)
    // Shared costumes are not part of characterRoster. With no image, the
    // planner needs their actual description, not just an ID and a short name.
    const description = Object.fromEntries(['imagePrompt', 'body', 'full', 'bodyBack', 'fullBack', 'upper', 'lower', 'shoes', 'accessory', 'back', 'negative']
      .map(key => [key, cleanText(entry.item[key])]).filter(([, value]) => value))
    lines.push(JSON.stringify({ shared: true, outfitId: id, name: displayName(entry.item), referenceImage: image ? '有图' : '无图',
      consistencyText: normalizeConsistencyText(entry.item.consistencyText), ...(!image && Object.keys(description).length ? { description } : {}) }))
  }
  return lines.join('\n')
}

/**
 * Clone, never mutate the library. Supplying resolved subjects also restricts
 * automatic outfit injection to the exact per-image choice ('' means none).
 * Legacy tag callers retain face/upper markers. Natural-language callers use
 * markers:false: identity and reference numbering travel as separate metadata,
 * never as fake visual traits. Re-scoping also upgrades old frozen definitions.
 */
export function referenceScopedDefinitions(definitions = {}, references = [], { subjects, markers = true } = {}) {
  const result = structuredClone(definitions)
  const checked = checkedReferences(references)
  // Shared clothes use the legacy body/full/bodyBack/fullBack schema. They
  // also enter per-character expansion below, whose schema is upper/full/back.
  // Map on the clone (including standalone shared macros), keeping author data
  // untouched. Pictured costumes will subsequently have all these fields erased.
  for (const outfit of arr(result.outfits).filter(enabled)) {
    if (!cleanText(outfit.upper) && cleanText(outfit.body)) outfit.upper = outfit.body
    if (!cleanText(outfit.back)) {
      const back = [outfit.bodyBack, outfit.fullBack].map(cleanText).filter(Boolean).join('\n')
      if (back) outfit.back = back
    }
  }
  const original = catalog(result)
  const characterRefs = new Map(checked.filter(ref => ref.kind !== 'outfit').map(ref => [ref.characterId, ref]))
  const outfitRefs = new Map(checked.filter(ref => ref.kind !== 'character').map(ref => [JSON.stringify([ref.characterId || '', ref.outfitId]), ref]))
  const identityNames = markers ? null : structuredIdentityNames(checked)
  const trimOutfit = (outfit, reference) => {
    if (!reference) return outfit
    for (const key of ['imagePrompt', 'imageDetails', 'upper', 'lower', 'shoes', 'accessory', 'full', 'back', 'body', 'bodyBack', 'fullBack', 'negative']) delete outfit[key]
    const marker = '服装「' + displayName(outfit) + '」[outfitId=' + idOf(outfit) + ']外观参照图' + reference.index
    if (markers) { outfit.upper = marker; outfit.body = marker }
    return outfit
  }
  for (const person of original.people) {
    const reference = characterRefs.get(idOf(person))
    if (reference) {
      delete person.imagePrompt
      delete person.imageDetails
      if (!markers) person.promptLabel = identityNames.get(reference.characterId) || displayName(person)
      const feature = person.traits?.feature
      const marker = '角色「' + displayName(person) + '」[characterId=' + idOf(person) + ']身份参照图' + reference.index
      person.traits = { ...(typeof feature === 'string' ? { feature } : {}), ...(markers ? { face: marker, faceBack: marker } : {}) }
    }
    for (const outfit of arr(person.outfits)) trimOutfit(outfit, outfitRefs.get(JSON.stringify([idOf(person), idOf(outfit)])))
  }
  for (const outfit of arr(result.outfits)) trimOutfit(outfit, outfitRefs.get(JSON.stringify(['', idOf(outfit)])))
  // Even in two-argument mode, don't expand old recorded prose over a pictured outfit.
  for (const person of original.people) {
    const known = arr(person.outfits).filter(outfit => outfitRefs.has(JSON.stringify([idOf(person), idOf(outfit)])))
    if (known.length === 1 && person.current?.outfit) person.current = { ...person.current, outfit: displayName(known[0]), previous: '' }
  }
  if (subjects !== undefined) {
    const selected = normalizeSubjects(subjects, original)
    result.characters = selected.filter(row => row.person).map(({ person, outfit }) => {
      // No unselected default/previous costume may be pulled back in by old macros.
      delete person.current
      person.outfits = outfit ? [{ ...structuredClone(outfit.item), default: true }] : []
      if (outfit && !outfit.owner) trimOutfit(person.outfits[0], outfitRefs.get(JSON.stringify(['', idOf(outfit.item)])))
      return person
    })
    const selectedShared = new Set(selected.filter(row => row.outfit && !row.outfit.owner).map(row => idOf(row.outfit.item)))
    result.outfits = arr(result.outfits).filter(outfit => selectedShared.has(idOf(outfit)))
    // With no library subjects, an explicitly selected standalone shared outfit
    // remains usable by a legacy clothing macro, without inventing a wearer.
    for (const reference of checked.filter(ref => ref.kind === 'outfit' && !ref.characterId)) {
      if (!result.outfits.some(item => idOf(item) === reference.outfitId)) {
        const entry = original.outfits.find(item => !item.owner && idOf(item.item) === reference.outfitId)
        if (entry) result.outfits.push(entry.item)
      }
    }
  }
  if (!markers) {
    const people = arr(result.characters).filter(enabled)
    const counts = new Map()
    for (const person of people) {
      const name = displayName(person)
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    let next = checked.length + 1
    for (const person of people) {
      const name = displayName(person)
      if (counts.get(name) > 1) {
        person.promptLabel = name + '（对象' + (characterRefs.get(idOf(person))?.index ?? next++) + '）'
      } else if (characterRefs.has(idOf(person))) person.promptLabel = name
    }
  }
  return result
}
