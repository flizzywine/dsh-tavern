import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, constants } from 'node:fs'
import { mkdir, lstat, rename, rm, link, copyFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { check } from '../asset-packs/common.js'
import { absent, checkedPath } from './storage-path.js'

// Like pack storage, one process owns a profile. All handles share its publication gate.
const roots = new Map()
export function createMediaStore({ root, linkFile = link, copyOnly = process.env.DSH_STORAGE_COPY_ONLY === '1' }) {
  check(typeof root === 'string' && path.isAbsolute(root), '$.root', 'An absolute media root is required', 'INVALID_PATH')
  root = path.resolve(root)
  const key = process.platform === 'win32' ? root.toLowerCase() : root
  if (!roots.has(key)) roots.set(key, new Map())
  const pending = roots.get(key), locate = relative => checkedPath(root, relative)
  function validate(ref) {
    check(/^[0-9a-f]{64}$/.test(ref?.sha256) && Number.isSafeInteger(ref.size) && ref.size >= 0, '$.ref', 'Invalid media reference', 'INVALID_PATH')
  }
  async function resolve(ref) {
    validate(ref)
    const absolutePath = await locate(`blobs/${ref.sha256.slice(0, 2)}/${ref.sha256}`)
    const info = await lstat(absolutePath).catch(absent)
    if (!info) return undefined
    check(info.isFile() && info.size === ref.size, '$.ref', 'Stored media size or structure changed', 'RECOVERY_REQUIRED')
    return { absolutePath, size: ref.size }
  }
  async function publish(temporary, ref) {
    const previous = pending.get(ref.sha256) || Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      if (await resolve(ref)) return
      const target = await locate(`blobs/${ref.sha256.slice(0, 2)}/${ref.sha256}`)
      await mkdir(path.dirname(target), { recursive: true })
      await rename(temporary, target)
    })
    pending.set(ref.sha256, operation)
    try { await operation } finally { if (pending.get(ref.sha256) === operation) pending.delete(ref.sha256) }
  }
  // ref is host-only: a previously validated descriptor, never an untrusted declared hash.
  // Byte inputs reuse it without hashing again; new streams derive their identity once.
  async function put(source, { maxBytes = Infinity, ref } = {}) {
    if (ref) {
      validate(ref)
      check(source instanceof Uint8Array && source.byteLength === ref.size, '$.ref', 'Media byte size mismatch', 'FILE_CLOSURE_MISMATCH')
      check(ref.size <= maxBytes, '$.ref', 'Media exceeds budget', 'LIMIT_EXCEEDED')
      if (await resolve(ref)) return { sha256: ref.sha256, size: ref.size }
    }
    const temporary = await locate('tmp/' + randomUUID())
    await mkdir(path.dirname(temporary), { recursive: true })
    const hash = ref ? null : createHash('sha256')
    let size = 0
    const meter = new Transform({ transform(chunk, _encoding, done) {
      size += chunk.length
      if (size > maxBytes) { done(Object.assign(new Error('Media exceeds budget'), { code: 'LIMIT_EXCEEDED' })); return }
      hash?.update(chunk); done(null, chunk)
    } })
    try {
      await pipeline(source instanceof Uint8Array ? Readable.from([source]) : source, meter, createWriteStream(temporary, { flags: 'wx', flush: true }))
      const stored = { sha256: ref?.sha256 || hash.digest('hex'), size }
      await publish(temporary, stored)
      return stored
    } finally {
      // Never remove published objects: another pack may already reference them.
      await rm(temporary, { force: true })
    }
  }
  async function materialize(ref, target) {
    const source = await resolve(ref)
    check(source, '$.ref', 'Media not found', 'MEDIA_NOT_FOUND')
    check(path.isAbsolute(target), '$.target', 'An absolute destination is required', 'INVALID_PATH')
    target = await checkedPath(path.dirname(target), path.basename(target))
    await mkdir(path.dirname(target), { recursive: true })
    if (!copyOnly) {
      try {
        await linkFile(source.absolutePath, target)
        return { mode: 'hardlink', savedBytes: ref.size }
      } catch (error) {
        if (error.code === 'EEXIST') throw error
        // Cross-volume/unsupported links and NTFS link limits use independent bytes.
      }
    }
    await copyFile(source.absolutePath, target, constants.COPYFILE_EXCL)
    return { mode: 'copy', savedBytes: 0 }
  }
  return Object.freeze({ put, resolve, materialize })
}
