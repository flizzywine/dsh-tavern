import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

// 大包导出后落在磁盘等客户端来取。token 就是文件名，元数据放同名 .json，所以服务重启、
// 页面刷新，或第一次下载被浏览器/内嵌 WebView 打断之后，同一个链接仍能再取一次；
// 只在过期之后由 sweep 清理。移动端 WebView 不支持下载时，重试不会再撞上 404。
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const META_SUFFIX = '.json'

export function createTransferExportStore({ root, now = Date.now, ttlMs = 60 * 60 * 1000 }) {
  const dir = path.resolve(root)
  const entries = new Map()

  const metaPath = file => file + META_SUFFIX
  async function drop(entry) {
    await rm(entry.file, { force: true }).catch(() => {})
    await rm(metaPath(entry.file), { force: true }).catch(() => {})
  }

  async function sweep(at = now()) {
    for (const [token, entry] of entries) {
      if (at - entry.at <= ttlMs) continue
      entries.delete(token)
      await drop(entry)
    }
    // A restart forgets the tokens; leftover files (and their metadata) are collected by age.
    for (const name of await readdir(dir).catch(() => [])) {
      if (name.endsWith(META_SUFFIX)) continue
      if (!TOKEN.test(name)) continue
      const file = path.join(dir, name)
      const info = await stat(file).catch(() => null)
      if (info && at - info.mtimeMs > ttlMs) await drop({ file })
    }
  }

  /** Keep a finished bundle until its token expires; returns the token the page puts in its URL. */
  async function put(buffer, filename) {
    await mkdir(dir, { recursive: true })
    await sweep()
    const token = randomUUID()
    const file = path.join(dir, token)
    const at = now()
    const name = String(filename || '')
    await writeFile(file, buffer)
    await writeFile(metaPath(file), JSON.stringify({ filename: name, bytes: buffer.length, at })).catch(() => {})
    entries.set(token, { at, file, filename: name, bytes: buffer.length })
    return { token, bytes: buffer.length }
  }

  /** Take ownership of a finished export file without reading a large archive into memory. */
  async function putFile(source, filename) {
    await mkdir(dir, { recursive: true })
    await sweep()
    const token = randomUUID(), file = path.join(dir, token), at = now()
    const { size: bytes } = await stat(source)
    try { await rename(source, file) }
    catch (error) {
      if (error.code !== 'EXDEV') throw error
      await copyFile(source, file)
      await rm(source)
    }
    const name = String(filename || '')
    await writeFile(metaPath(file), JSON.stringify({ filename: name, bytes, at })).catch(() => {})
    entries.set(token, { at, file, filename: name, bytes })
    return { token, bytes }
  }

  /** Resolve a token without dropping it: the route needs the path while it streams. */
  async function take(token) {
    const key = String(token)
    if (!TOKEN.test(key)) return null
    const at = now()
    let entry = entries.get(key)
    if (entry) {
      if (at - entry.at > ttlMs) { entries.delete(key); await drop(entry); return null }
      return { file: entry.file, filename: entry.filename, bytes: entry.bytes, stream: () => createReadStream(entry.file) }
    }
    // 重启或刷新后内存里没有 token：按文件名从磁盘恢复，文件还在就能继续下载。
    const file = path.join(dir, key)
    const info = await stat(file).catch(() => null)
    if (!info || !info.isFile()) return null
    let meta = {}
    try { meta = JSON.parse(await readFile(metaPath(file), 'utf8')) } catch (_error) { meta = {} }
    entry = { at: Number(meta.at) || info.mtimeMs, file, filename: String(meta.filename || ''), bytes: info.size }
    if (at - entry.at > ttlMs) { await drop(entry); return null }
    entries.set(key, entry)
    return { file: entry.file, filename: entry.filename, bytes: entry.bytes, stream: () => createReadStream(entry.file) }
  }

  async function remove(token) {
    const key = String(token)
    entries.delete(key)
    await drop({ file: path.join(dir, key) })
  }

  // 下载后不再立刻删，所以必须自己收拾过期文件（大包可能有几百 MB）。
  const timer = setInterval(() => { void sweep() }, Math.min(ttlMs, 10 * 60 * 1000))
  timer.unref?.()
  const close = () => { clearInterval(timer); void sweep() }

  return Object.freeze({ put, putFile, take, remove, sweep, close, dir })
}
