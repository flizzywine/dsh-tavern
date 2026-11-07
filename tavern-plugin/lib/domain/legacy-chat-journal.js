import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual, promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'
import path from 'node:path'
import { applyJsonChangesShared } from './json-mutation.js'

const STORAGE_REVISION = '_storageRevision'
const SNAPSHOT_PATTERN = /^(\d{12})\.json(?:\.gz)?$/
const JOURNAL_PATTERN = /^(\d{12})-(open|(\d{12}))\.jsonl$/
const compress = promisify(gzip), decompress = promisify(gunzip)
const SNAPSHOT_COMPRESSION_BYTES = 64 * 1024
const revisionOf = value => Math.max(0, Number(value?.[STORAGE_REVISION]) || 0)
const jsonClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
async function exists(target) {
  try { await stat(target); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}
function revisionName(value) {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 999999999999) throw new Error('Chat storage revision 超出范围: ' + String(value))
  return String(revision).padStart(12, '0')
}

function encodeSnapshot(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

function encodeFrame(value) {
  return JSON.stringify(value) + '\n'
}

async function readJson(target) {
  try { return JSON.parse(await readFile(target, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
}


/** The legacy JSON/journal format owns encoding, replay, corruption recovery and disk stamps. */
export function createLegacyChatJournal({ layout, chatsRoot, legacyData, logger, now, maxSnapshotBytes,
  frameLimit = 200, byteLimit = 1024 * 1024, backgroundSnapshots, requestSnapshot }) {
  async function legacyRead(paths) {
    if (legacyData && typeof legacyData.readJson === 'function') return await legacyData.readJson(paths.legacyRelative)
    return await readJson(paths.legacy)
  }

  async function snapshotRows(paths) {
    let names
    try { names = await readdir(paths.snapshots) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = SNAPSHOT_PATTERN.exec(name)
      return match === null ? null : { name, revision: Number(match[1]), path: path.join(paths.snapshots, name) }
    }).filter(Boolean).sort(function (left, right) { return left.revision - right.revision })
  }

  async function journalRows(paths) {
    let names
    try { names = await readdir(paths.journals) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = JOURNAL_PATTERN.exec(name)
      if (match === null) return null
      return {
        name,
        start: Number(match[1]),
        end: match[2] === 'open' ? Number.POSITIVE_INFINITY : Number(match[3]),
        open: match[2] === 'open',
        path: path.join(paths.journals, name)
      }
    }).filter(Boolean).sort(function (left, right) { return left.start - right.start || Number(left.open) - Number(right.open) })
  }

  async function parseJournal(row, afterRevision, targetRevision) {
    const text = await readFile(row.path, 'utf8')
    const lines = text.split('\n')
    const frames = []
    let validBytes = 0
    let invalidLine = 0
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (line === '') {
        validBytes += index < lines.length - 1 ? 1 : 0
        continue
      }
      let frame
      try { frame = JSON.parse(line) } catch (error) {
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal 尾行损坏，忽略该行及后续内容:', row.path + ':' + invalidLine, String(error?.message || error))
        break
      }
      validBytes += Buffer.byteLength(line + '\n')
      const revision = Number(frame && frame.revision)
      if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(frame.changes)) {
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal frame 不合法，忽略该行及后续内容:', row.path + ':' + invalidLine)
        break
      }
      if (revision > afterRevision && revision <= targetRevision) frames.push(frame)
    }
    return { frames, lineCount: frames.length, bytes: Buffer.byteLength(text), validBytes, invalidLine }
  }

  async function materializeDirectory(paths, targetRevision = Number.POSITIVE_INFINITY) {
    const snapshots = await snapshotRows(paths)
    const eligible = snapshots.filter(function (row) { return row.revision <= targetRevision })
    let selected = null, chat
    for (const row of eligible.slice().reverse()) {
      chat = await readSnapshot(paths, row)
      if (chat !== undefined) { selected = row; break }
    }
    if (!selected) chat = await legacyRead(paths)
    const journals = await journalRows(paths)
    if (chat === undefined) {
      // An interrupted first write may have left only staging files/directories.
      if (snapshots.length === 0 && journals.length === 0) return null
      throw new Error('Chat Journal 缺少可用 snapshot: ' + paths.id)
    }
    let revision = selected ? selected.revision : revisionOf(chat)
    if (!selected && (chat === null || typeof chat !== 'object' || Array.isArray(chat) || chat.id !== paths.id)) {
      throw new Error('Legacy Chat 不合法: ' + paths.id)
    }
    let open = null
    let openFrameCount = 0
    let openValidBytes = 0
    let openInvalidLine = 0
    const changes = []
    for (const row of journals) {
      if (row.end <= revision || row.start > targetRevision) continue
      const parsed = await parseJournal(row, revision, targetRevision)
      for (const frame of parsed.frames) {
        if (Number(frame.baseRevision) !== revision || Number(frame.revision) !== revision + 1) {
          const error = new Error('Chat journal revision 不连续: ' + row.path + '，期望 ' + (revision + 1) + '，实际 ' + frame.revision)
          error.code = 'DSH_TAVERN_JOURNAL_GAP'
          throw error
        }
        if (!Array.isArray(frame.changes)) throw new Error('JSON mutation changes 必须是数组')
        for (const change of frame.changes) changes.push(change)
        revision = Number(frame.revision)
      }
      if (row.open) {
        open = row
        openFrameCount = parsed.frames.length
        openValidBytes = parsed.validBytes
        openInvalidLine = parsed.invalidLine
      }
    }
    // A corrupt published snapshot proves this revision once existed. Do not
    // silently return an older state when its replay chain is missing.
    const requiredRevision = eligible.at(-1)?.revision ?? revision
    if (revision < requiredRevision) throw new Error('Chat snapshot 恢复缺少完整 journal，期望 revision ' + requiredRevision + ': ' + paths.id)
    if (targetRevision !== Number.POSITIVE_INFINITY && revision !== targetRevision) {
      const error = new Error('Chat Journal 找不到 revision ' + targetRevision + ': ' + paths.id)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    // The parsed snapshot is private to this materialization. Replay by copying
    // changed ancestors; historical variables need no additional full clone.
    chat = applyJsonChangesShared(chat, changes)
    chat[STORAGE_REVISION] = revision
    return { chat, revision, snapshot: selected, open, openFrameCount, openValidBytes, openInvalidLine, legacy: selected === null }
  }

  async function materializeLegacy(chatId, targetRevision = Number.POSITIVE_INFINITY) {
    const paths = layout(chatId)
    if (await exists(paths.root)) return await materializeDirectory(paths, targetRevision)
    const chat = await legacyRead(paths)
    if (chat === undefined) return null
    const revision = revisionOf(chat)
    if (targetRevision !== Number.POSITIVE_INFINITY && targetRevision !== revision) {
      const error = new Error('Legacy Chat 只有 revision ' + revision + '，无法读取 revision ' + targetRevision)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    chat[STORAGE_REVISION] = revision
    return { chat: jsonClone(chat), revision, snapshot: null, open: null, openFrameCount: 0, legacy: true }
  }

  async function readSnapshot(paths, row) {
    try {
      const bytes = await readFile(row.path)
      const chat = JSON.parse((row.path.endsWith('.gz') ? await decompress(bytes, { maxOutputLength: maxSnapshotBytes }) : bytes).toString('utf8'))
      if (chat && typeof chat === 'object' && !Array.isArray(chat) && chat.id === paths.id &&
        Number.isSafeInteger(chat[STORAGE_REVISION]) && chat[STORAGE_REVISION] === row.revision) return chat
    } catch (error) {
      if (!(error instanceof SyntaxError) && !['Z_DATA_ERROR', 'Z_BUF_ERROR', 'ENOENT'].includes(error?.code)) throw error
    }
    logger?.warn?.('dsh-tavern: Chat snapshot 损坏，尝试历史快照与 journal:', row.path)
    return undefined
  }

  async function writeSnapshot(paths, chat, revision) {
    await mkdir(paths.snapshots, { recursive: true })
    const plainTarget = path.join(paths.snapshots, revisionName(revision) + '.json')
    for (const target of [plainTarget, plainTarget + '.gz']) {
      if (!(await exists(target))) continue
      const previous = await readSnapshot(paths, { path: target, revision })
      if (previous !== undefined) {
        if (!isDeepStrictEqual(previous, chat)) throw new Error('Chat snapshot revision 冲突: ' + target)
        return target
      }
    }
    // Encode only at the file boundary. Preserve property order for JSON/YAML
    // variable macros and LLM prefix caching; never reconstruct MVU display deltas.
    const json = JSON.stringify(chat)
    if (Buffer.byteLength(json) > maxSnapshotBytes) throw new Error('Chat snapshot 超过大小上限')
    const compressed = Buffer.byteLength(json) >= SNAPSHOT_COMPRESSION_BYTES
    const bytes = compressed ? await compress(json, { level: 1 }) : encodeSnapshot(chat)
    const target = plainTarget + (compressed ? '.gz' : '')
    if (await exists(target)) {
      // Preserve the failed old writer's bytes for diagnosis before replacement.
      await rename(target, target + '.corrupt-' + randomUUID())
    }
    const staging = target + '.staging-' + randomUUID()
    let handle
    try {
      handle = await open(staging, 'wx')
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close(); handle = null
      await rename(staging, target)
      // Flush the published directory entry before migration removes its source.
      if (process.platform !== 'win32') {
        handle = await open(paths.snapshots, 'r')
        try { await handle.sync() } catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error }
      }
    } finally {
      if (handle) await handle.close()
      await rm(staging, { force: true })
    }
    return target
  }

  async function migrateLegacy(paths, current) {
    await mkdir(paths.journals, { recursive: true })
    await writeSnapshot(paths, current, revisionOf(current))
    if (!(await exists(paths.legacy)) && !(legacyData && typeof legacyData.remove === 'function')) return
    const backup = path.join(chatsRoot, paths.id + '.legacy-' + now() + '.json')
    await writeFile(backup, encodeSnapshot(current), { encoding: 'utf8', flag: 'wx' })
    if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove(paths.legacyRelative)
    else await rm(paths.legacy, { force: true })
  }

  async function appendFrame(paths, frame, currentOpen) {
    await mkdir(paths.journals, { recursive: true })
    const openPath = currentOpen === null
      ? path.join(paths.journals, revisionName(frame.revision) + '-open.jsonl')
      : currentOpen.path
    await appendFile(openPath, encodeFrame(frame), 'utf8')
    return { path: openPath, start: currentOpen === null ? frame.revision : currentOpen.start, open: true }
  }

  async function maybeRotate(paths, state, open, frameCount) {
    const info = await stat(open.path)
    if (frameCount < frameLimit && info.size < byteLimit) return false
    if (backgroundSnapshots === true) {
      const sealed = path.join(paths.journals, revisionName(open.start) + '-' + revisionName(state.revision) + '.jsonl')
      await rename(open.path,sealed)
      requestSnapshot(paths.id,state.revision)
      return {background:true}
    }
    const snapshotPath = await writeSnapshot(paths, state.chat, state.revision)
    const sealed = path.join(paths.journals, revisionName(open.start) + '-' + revisionName(state.revision) + '.jsonl')
    await rename(open.path, sealed)
    return { path: snapshotPath, name: path.basename(snapshotPath), revision: state.revision }
  }

  async function legacyVersion(chatId) {
    const paths = layout(chatId)
    if (!(await exists(paths.root))) {
      if (legacyData && typeof legacyData.version === 'function') return await legacyData.version(paths.legacyRelative)
      try {
        const info = await stat(paths.legacy, { bigint: true })
        return ['legacy', info.size, info.mtimeNs].join(':')
      } catch (error) { if (error?.code === 'ENOENT') return ''; throw error }
    }
    const snapshots = await snapshotRows(paths)
    const journals = await journalRows(paths)
    const latestSnapshot = snapshots[snapshots.length - 1]
    // Recovery may use any earlier snapshot/journal, or the legacy source during
    // migration. All of those files must participate in cache invalidation.
    const stamps = await Promise.all([...snapshots, ...journals].map(async row => {
      const info = await stat(row.path, { bigint: true })
      return [row.name,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':')
    }))
    let legacyStamp = ''
    if (legacyData && typeof legacyData.version === 'function') legacyStamp = await legacyData.version(paths.legacyRelative)
    else {
      try {
        const info = await stat(paths.legacy, { bigint: true })
        legacyStamp = [info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
      } catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
    if (!stamps.length && !legacyStamp) return ''
    return ['journal', latestSnapshot?.name || '', ...stamps, legacyStamp].join(':')
  }

  return Object.freeze({ read: materializeLegacy, version: legacyVersion, writeSnapshot, migrateLegacy, appendFrame, maybeRotate })
}
