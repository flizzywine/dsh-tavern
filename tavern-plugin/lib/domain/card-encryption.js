import { open, readFile, rm } from 'node:fs/promises'
import { PassThrough, Readable, Writable } from 'node:stream'
import { openZipFile, zipEntryPath } from './zip-file.js'
import { cardAssetSource, isPng, pngWithTextChunks } from './card-assets.js'
import { readCardArchive } from './card-archive.js'
import { Reader, ZipReader, ZipWriter, ERR_INVALID_PASSWORD, ERR_INVALID_AUTHENTICATION_CODE } from '../vendor/zipjs/zip-native.js'

export const CARD_PASSWORD_REQUIRED = 'TAVERN_CARD_PASSWORD_REQUIRED'
export const CARD_PASSWORD_INVALID = 'TAVERN_CARD_PASSWORD_INVALID'
export const isCardPasswordError = error => [CARD_PASSWORD_REQUIRED, CARD_PASSWORD_INVALID].includes(error?.code)
function passwordError(error) {
  if ([ERR_INVALID_PASSWORD, ERR_INVALID_AUTHENTICATION_CODE].includes(error?.message)) return Object.assign(new Error('密码不正确，或加密卡包已损坏，请重试'), { code: CARD_PASSWORD_INVALID })
  return error
}

class FileReader extends Reader {
  constructor(handle, size, offset = 0) { super(); this.handle = handle; this.size = size - offset; this.offset = offset; this.initialized = true }
  async readUint8Array(offset, length) {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await this.handle.read(buffer, 0, length, offset + this.offset)
    if (bytesRead !== length) throw new Error('人物卡压缩数据被截断')
    return buffer
  }
}

/** Plain archives keep the existing streamed ZIP reader. Encrypted entries authenticate before any import writes. */
export async function openCardZip(file, { label = 'DSH 人物卡', password } = {}) {
  const metadata = await openZipFile(file, { label, allowEncrypted: true })
  if (![...metadata.entries.values()].some(entry => entry.encrypted)) return metadata
  const size = metadata.size
  const prefix = metadata.prefix
  await metadata.close()
  if (typeof password !== 'string' || !password.length) throw Object.assign(new Error('这张人物卡已加密，请输入密码'), { code: CARD_PASSWORD_REQUIRED })
  const handle = await open(file, 'r')
  const reader = new ZipReader(new FileReader(handle, size, prefix), { useWebWorkers: false })
  try {
    const items = await reader.getEntries()
    if (items.length > 50000) throw new Error('人物卡压缩包文件数量过多')
    const entries = new Map()
    for (const item of items) {
      const entryPath = zipEntryPath(item.filename)
      if (!entryPath || item.directory) continue
      if (!Number.isSafeInteger(item.uncompressedSize) || item.uncompressedSize < 0) throw new Error('人物卡文件长度无效')
      // Check the complete archive, not just card.json: a later asset may have a different password or damaged authentication.
      let seen = 0
      await item.getData(new WritableStream({ write(chunk) {
        seen += chunk.length
        if (seen > item.uncompressedSize) throw new Error('人物卡解压长度超出声明值')
      } }), { password, checkSignature: true, useWebWorkers: false })
      if (seen !== item.uncompressedSize) throw new Error('人物卡解压长度不一致')
      entries.set(entryPath, { path: entryPath, size: item.uncompressedSize, compressedSize: item.compressedSize, item })
    }
    async function stream(entry) {
      const output = new PassThrough()
      void entry.item.getData(Writable.toWeb(output), { password, checkSignature: true, useWebWorkers: false }).catch(error => output.destroy(passwordError(error)))
      return output
    }
    return { entries, size, prefix, stream, async readBuffer(entry, limit = 32 * 1024 * 1024) {
      if (entry.size > limit) throw new Error(label + '：' + entry.path + ' 超过读取上限')
      const chunks = []
      for await (const chunk of await stream(entry)) chunks.push(chunk)
      return Buffer.concat(chunks)
    }, async close() { await reader.close(); await handle.close() } }
  } catch (error) {
    await reader.close().catch(() => {})
    await handle.close()
    throw passwordError(error)
  }
}

async function sourceCard(input, { name = '', password } = {}) {
  if (/\.(dshcard|charx)\.png$/i.test(name)) throw new Error('卡包请使用 .dshcard 文件')
  const ordinary = /\.(json|png)$/i.test(name)
  if (ordinary) {
    const bytes = await readFile(input), png = isPng(bytes)
    const source = cardAssetSource(png ? { kind: 'png', fileB64: bytes.toString('base64') } : { kind: 'text', text: bytes.toString('utf8').replace(/^\uFEFF/, '') })
    if (!source.card || typeof source.card !== 'object' || Array.isArray(source.card)) throw new Error('文件中没有人物卡数据')
    // Keep the original ST schema and every extension, including Risu PNG asset references.
    const replace = value => {
      if (typeof value === 'string' && value.startsWith('__asset:')) {
        const data = source.resolve(value)
        if (!data) throw new Error('PNG 人物卡缺少内嵌素材：' + value)
        return 'data:application/octet-stream;base64,' + data.toString('base64')
      }
      if (Array.isArray(value)) return value.map(replace)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
      return value
    }
    const card = replace(source.card), data = card.data && typeof card.data === 'object' ? card.data : card
    const icon = (Array.isArray(data.assets) ? data.assets : []).find(asset => asset?.type === 'icon' && asset.name === 'main')
    const files = new Map()
    if (png && (!icon || icon.uri === 'ccdefault:')) {
      const file = 'assets/icon/image/encrypted-cover.png'
      files.set(file, pngWithTextChunks(bytes, []))
      data.assets = [{ type: 'icon', name: 'main', ext: 'png', uri: 'embeded://' + file }, ...(Array.isArray(data.assets) ? data.assets.filter(asset => !(asset?.type === 'icon' && asset.name === 'main')) : [])]
    }
    files.set('card.json', Buffer.from(JSON.stringify(card)))
    files.set('dsh.json', Buffer.from(JSON.stringify({ format: 'dshcard', formatVersion: 1 })))
    return { entries: new Map([...files].map(([path, bytes]) => [path, { path, bytes }])), stream: async entry => Readable.from([entry.bytes]), close: async () => {} }
  }
  const zip = await openCardZip(input, { password })
  try {
    await readCardArchive(zip)
    return zip
  } catch (error) { await zip.close(); throw error }
}

/** A standard ZIP container: the card, cover, plugins and assets all stay inside it. */
export async function encryptCardArchiveFile(input, output, password, options = {}) {
  if (!options.decrypt && (typeof password !== 'string' || !password.length)) throw new Error('请设置人物卡密码')
  if (input === output) throw new Error('加密输出不能覆盖输入文件')
  const zip = await sourceCard(input, { name: options.name, password: options.decrypt ? password : options.sourcePassword })
  let writer, destination, outputHandle
  try {
    outputHandle = await open(output, 'wx', 0o600)
    destination = outputHandle.createWriteStream()
    writer = new ZipWriter(Writable.toWeb(destination), { ...(options.decrypt ? {} : { password, encryptionStrength: 3 }), useWebWorkers: false })
    for (const entry of zip.entries.values()) {
      await writer.add(entry.path, Readable.toWeb(await zip.stream(entry)))
    }
    await writer.close()
    return { entries: zip.entries.size }
  } catch (error) {
    destination?.destroy()
    if (outputHandle) { await outputHandle.close().catch(() => {}); await rm(output, { force: true }).catch(() => {}) }
    throw error
  } finally { await zip.close() }
}
