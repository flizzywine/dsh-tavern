import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createDurableFilePromotion } from '../durable-file-promotion.js'
import { createConversationPageStore } from './conversation-page-store.js'
import { SQLITE_FILENAME, SQLITE_FORMAT } from './conversation-sqlite-store.js'

const HEX_REF = /^[a-f0-9]{64}$/
const MIGRATE_BATCH_SIZE = 500
const hash = value => createHash('sha256').update(value).digest('hex')
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function hexRefs(value, out = []) {
  if (typeof value === 'string') { if (HEX_REF.test(value)) out.push(value) }
  else if (Array.isArray(value)) for (const item of value) hexRefs(item, out)
  else if (isRecord(value)) for (const item of Object.values(value)) hexRefs(item, out)
  return out
}

function conversationDir(root, chatId) {
  if (typeof chatId !== 'string' || !chatId || chatId === '.' || chatId === '..' || /[\\/\0]/.test(chatId)) {
    throw new Error('Invalid conversation id')
  }
  return path.join(path.resolve(root), chatId)
}

function blobPath(dir, ref) {
  if (!HEX_REF.test(ref)) throw new Error('Invalid block reference')
  return path.join(dir, 'blocks', ref.slice(0, 2), ref + '.json')
}

function decodeFileBlock(ref, rawBytes) {
  let value
  try { value = JSON.parse(rawBytes) } catch { throw new Error('Invalid immutable block') }
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('Invalid immutable block')
  if (value.kind !== 'record-pack-v1' && value.kind !== 'block-pack-v1') return value
  if (!Array.isArray(value.records)) throw new Error('Invalid immutable record pack')
  for (const entry of value.records) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid immutable record pack')
    if (entry[0] === ref) {
      const block = value.kind === 'block-pack-v1' ? entry[1] : { kind: 'record', value: entry[1] }
      if (!isRecord(block) || typeof block.kind !== 'string') throw new Error('Invalid immutable block')
      return block
    }
  }
  throw new Error('Immutable pack is missing requested block')
}

/**
 * Walk every block reachable from `headId` (including all retained keyed records
 * such as `chat-revision:*` and `chat-change:*`), calling `loadBlock(ref, required)`.
 * Returns Map<refHex, { block, bytes: Buffer }>.
 */
async function collectReachableBlocks(headId, loadBlock) {
  const blocks = new Map()
  const queue = [[headId, true]]
  while (queue.length) {
    const [ref, required] = queue.pop()
    if (blocks.has(ref)) continue
    const loaded = await loadBlock(ref, required)
    if (!loaded) continue
    const { block, bytes } = loaded
    if (hash(bytes) !== ref) throw new Error(`Block hash mismatch during migration: ${ref}`)
    blocks.set(ref, { block, bytes })
    const strong = [], optional = []
    if (block.kind === 'head') {
      for (const key of ['root', 'stateId', 'metadataId', ...(ref === headId ? ['recordRoot'] : [])]) {
        if (block[key]) strong.push(block[key])
      }
    } else if (block.kind === 'index') {
      strong.push(...block.children.filter(Boolean))
    } else if (block.kind === 'entries') {
      strong.push(...Object.values(block.children).filter(Boolean))
    } else if (block.kind === 'entry') {
      strong.push(block.valueRef)
    } else {
      for (const next of hexRefs(block)) if (!blocks.has(next)) optional.push(next)
    }
    for (const next of strong) queue.push([next, true])
    for (const next of optional) queue.push([next, false])
  }
  return blocks
}

async function writeDurableFile(target, content) {
  const staging = target + '.staging-' + randomUUID()
  let handle
  try {
    handle = await open(staging, 'wx')
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(staging, target)
  } finally {
    if (handle) await handle.close()
    await rm(staging, { force: true })
  }
}

/**
 * Inspect the storage format of one conversation directory under `root`.
 */
export async function inspectConversationFormat({ root, chatId }) {
  const dir = conversationDir(root, chatId)
  const promotion = createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER })
  const raw = await promotion.read(path.join(dir, 'head.json'))
  if (raw === undefined) return { status: 'missing', format: null }
  const pointer = JSON.parse(raw)
  if (pointer.format === SQLITE_FORMAT) {
    const file = path.join(dir, SQLITE_FILENAME)
    const info = await stat(file)
    const db = new DatabaseSync(file)
    try {
      const headId = db.prepare("SELECT value FROM meta WHERE key = 'head_id'").get()?.value
      const blockCount = db.prepare('SELECT count(*) AS count FROM blocks').get()?.count ?? 0
      return { status: 'sqlite', format: SQLITE_FORMAT, headId, blockCount, sqliteBytes: info.size }
    } finally {
      db.close()
    }
  }
  if (pointer.format === 1 || pointer.format === 2) {
    return { status: 'files', format: pointer.format, headId: pointer.headId }
  }
  throw new Error('Unsupported conversation format')
}

/**
 * Explicitly migrate a Format 1/2 conversation directory to Format 3 (SQLite).
 * - Never touches existing `blocks/` directory (two-phase cleanup stays explicit).
 * - Verifies every migrated block byte-for-byte + SHA-256 + `PRAGMA integrity_check`
 *   before atomically promoting `head.json` to `{"format":3,"engine":"sqlite"}`.
 * - Preserves `head.json.v2-bak` when `keepBackup` is true for instant rollback.
 */
export async function migrateConversationToSqlite({
  root,
  chatId,
  dryRun = false,
  keepBackup = true,
  onProgress = () => {},
} = {}) {
  const dir = conversationDir(root, chatId)
  const promotion = createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER })
  const headPath = path.join(dir, 'head.json')
  const rawPointer = await promotion.read(headPath)
  if (rawPointer === undefined) return { status: 'missing', chatId }
  const pointer = JSON.parse(rawPointer)
  if (pointer.format === SQLITE_FORMAT) {
    return { status: 'sqlite', alreadyActive: true, chatId }
  }
  if (pointer.format !== 1 && pointer.format !== 2) {
    throw new Error('Unsupported conversation format')
  }
  const sourceHeadId = pointer.headId
  onProgress('collecting')
  const packCache = new Map()
  async function loadFromFormat2(ref, required) {
    if (packCache.has(ref)) {
      const block = packCache.get(ref)
      return { block, bytes: Buffer.from(JSON.stringify(block), 'utf8') }
    }
    let raw
    try { raw = await readFile(blobPath(dir, ref), 'utf8') }
    catch (error) {
      if (error.code === 'ENOENT' && !required) return undefined
      throw error
    }
    let parsed
    try { parsed = JSON.parse(raw) } catch { throw new Error('Invalid immutable block') }
    if (parsed?.kind === 'block-pack-v1' || parsed?.kind === 'record-pack-v1') {
      let target = null
      for (const [entryRef, item] of parsed.records) {
        const block = parsed.kind === 'block-pack-v1' ? item : { kind: 'record', value: item }
        if (packCache.size < 20000) packCache.set(entryRef, block)
        if (entryRef === ref) target = block
      }
      if (!target) throw new Error('Immutable pack is missing requested block')
      return { block: target, bytes: Buffer.from(JSON.stringify(target), 'utf8') }
    }
    const block = decodeFileBlock(ref, raw)
    return { block, bytes: Buffer.from(JSON.stringify(block), 'utf8') }
  }

  const blocks = await collectReachableBlocks(sourceHeadId, loadFromFormat2)
  packCache.clear()
  onProgress('writing')

  const stagingFile = path.join(dir, `${SQLITE_FILENAME}.staging-${randomUUID()}`)
  const nowMs = Date.now()
  let db
  try {
    db = new DatabaseSync(stagingFile)
    db.exec(`
      PRAGMA page_size = 8192;
      PRAGMA auto_vacuum = INCREMENTAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA temp_store = MEMORY;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE blocks (id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, encoding INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, byte_len INTEGER NOT NULL, touched_at INTEGER NOT NULL);
    `)
    const insertBlock = db.prepare('INSERT INTO blocks (ref, kind, encoding, data, byte_len, touched_at) VALUES (?, ?, 0, ?, ?, ?)')
    const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
    const entries = [...blocks.entries()]
    for (let i = 0; i < entries.length; i += MIGRATE_BATCH_SIZE) {
      const slice = entries.slice(i, i + MIGRATE_BATCH_SIZE)
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const [ref, { block, bytes }] of slice) {
          insertBlock.run(ref, block.kind, bytes.toString('utf8'), bytes.length, nowMs)
        }
        db.exec('COMMIT')
      } catch (error) {
        try { db.exec('ROLLBACK') } catch {}
        throw error
      }
      if (i + MIGRATE_BATCH_SIZE < entries.length) await new Promise(resolve => setImmediate(resolve))
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      setMeta.run('format_version', String(SQLITE_FORMAT))
      setMeta.run('chat_id', chatId)
      setMeta.run('schema_version', '3')
      setMeta.run('head_id', sourceHeadId)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    onProgress('verifying')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`)
    const storedCount = db.prepare('SELECT count(*) AS count FROM blocks').get()?.count
    if (storedCount !== blocks.size) {
      throw new Error(`Migrated block count mismatch: expected ${blocks.size}, got ${storedCount}`)
    }
    const storedHeadId = db.prepare("SELECT value FROM meta WHERE key = 'head_id'").get()?.value
    if (storedHeadId !== sourceHeadId) {
      throw new Error('Migrated head_id mismatch')
    }
    // Byte-for-byte verification of every migrated block.
    const getBlock = db.prepare('SELECT kind, encoding, data FROM blocks WHERE ref = ?')
    for (const [ref, { block, bytes }] of blocks) {
      const row = getBlock.get(ref)
      if (!row || row.encoding !== 0 || row.kind !== block.kind) {
        throw new Error(`Migrated block metadata mismatch: ${ref}`)
      }
      const storedBytes = typeof row.data === 'string' ? Buffer.from(row.data, 'utf8') : Buffer.from(row.data)
      if (Buffer.compare(storedBytes, bytes) !== 0) {
        throw new Error(`Migrated block payload mismatch: ${ref}`)
      }
    }
    db.close()
    db = null

    const sqliteBytes = (await stat(stagingFile)).size
    const totalPayloadBytes = [...blocks.values()].reduce((sum, item) => sum + item.bytes.length, 0)

    if (dryRun) {
      await rm(stagingFile, { force: true })
      await rm(stagingFile + '-wal', { force: true })
      await rm(stagingFile + '-shm', { force: true })
      return {
        status: 'dry-run',
        chatId,
        sourceFormat: pointer.format,
        headId: sourceHeadId,
        blocks: blocks.size,
        payloadBytes: totalPayloadBytes,
        sqliteBytes,
      }
    }

    onProgress('switching')
    await promotion.update(headPath, async current => {
      if (current === undefined || String(current) !== String(rawPointer)) throw new Error('Source conversation changed during migration')
      if (keepBackup) await writeDurableFile(path.join(dir, 'head.json.v2-bak'), rawPointer)
      const finalFile = path.join(dir, SQLITE_FILENAME)
      await rename(stagingFile, finalFile)
      return JSON.stringify({ format: SQLITE_FORMAT, engine: 'sqlite' })
    })

    return {
      status: 'sqlite',
      alreadyActive: false,
      chatId,
      sourceFormat: pointer.format,
      headId: sourceHeadId,
      blocks: blocks.size,
      payloadBytes: totalPayloadBytes,
      sqliteBytes,
      retainedLegacyBlocks: true,
    }
  } catch (error) {
    if (db) { try { db.close() } catch {} }
    await rm(stagingFile, { force: true })
    await rm(stagingFile + '-wal', { force: true })
    await rm(stagingFile + '-shm', { force: true })
    throw error
  }
}

/**
 * Losslessly export a Format 3 (SQLite) conversation back to Format 2 (block packs + head.json).
 * Supports writing to a separate target directory (for verification/downgrade) or in-place cutover.
 * Every exported block is verified byte-for-byte against Format 3 before completion.
 */
export async function exportConversationToFormat2({
  root,
  chatId,
  targetRoot = root,
  targetChatId = chatId,
  inPlace = false,
  keepSqliteBackup = true,
  onProgress = () => {},
} = {}) {
  const sourceDir = conversationDir(root, chatId)
  const promotion = createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER })
  const rawPointer = await promotion.read(path.join(sourceDir, 'head.json'))
  if (rawPointer === undefined) return { status: 'missing', chatId }
  const pointer = JSON.parse(rawPointer)
  if (pointer.format !== SQLITE_FORMAT) {
    throw new Error(`Conversation ${chatId} is not Format 3 (found format ${pointer.format})`)
  }
  const sqliteFile = path.join(sourceDir, SQLITE_FILENAME)
  let db = new DatabaseSync(sqliteFile)
  let sourceHeadId, blocks
  try {
    sourceHeadId = db.prepare("SELECT value FROM meta WHERE key = 'head_id'").get()?.value
    if (!sourceHeadId || !HEX_REF.test(sourceHeadId)) throw new Error('Invalid SQLite conversation head')
    const getBlock = db.prepare('SELECT kind, encoding, data FROM blocks WHERE ref = ?')
    onProgress('collecting')
    blocks = await collectReachableBlocks(sourceHeadId, async (ref, required) => {
      const row = getBlock.get(ref)
      if (!row) {
        if (!required) return undefined
        throw Object.assign(new Error('Block not found: ' + ref), { code: 'ENOENT' })
      }
      if (row.encoding !== 0) throw new Error('Unsupported block encoding')
      const text = typeof row.data === 'string' ? row.data : Buffer.from(row.data).toString('utf8')
      const bytes = Buffer.from(text, 'utf8')
      const block = JSON.parse(text)
      return { block, bytes }
    })
  } finally {
    db.close()
    db = null
  }

  const resolvedTargetRoot = path.resolve(targetRoot)
  const stagingRoot = inPlace ? path.join(resolvedTargetRoot, `.format2-staging-${randomUUID()}`) : resolvedTargetRoot
  const stagingDir = conversationDir(stagingRoot, targetChatId)
  await mkdir(stagingDir, { recursive: true })

  onProgress('writing')
  const entries = [...blocks.entries()]
  // Write all blocks as Format 2 packs (identical on-disk layout to conversation-page-store Format 2).
  try {
    const blocksRoot = path.join(stagingDir, 'blocks')
    const packDir = path.join(blocksRoot, '.packs')
    await mkdir(packDir, { recursive: true })
    const PACK_BYTES = 64 * 1024
    const PACK_ENTRIES = 256
    const groups = []
    let group = [], groupBytes = 64
    for (const [ref, { block, bytes }] of entries) {
      const size = bytes.length + 70
      if (group.length && (groupBytes + size > PACK_BYTES || group.length >= PACK_ENTRIES)) {
        groups.push(group); group = []; groupBytes = 64
      }
      group.push([ref, block, bytes])
      groupBytes += size
    }
    if (group.length) groups.push(group)

    const { link } = await import('node:fs/promises')
    for (const grp of groups) {
      if (grp.length === 1) {
        const [ref, , bytes] = grp[0]
        const dest = blobPath(stagingDir, ref)
        await mkdir(path.dirname(dest), { recursive: true })
        await writeDurableFile(dest, bytes)
        continue
      }
      const packBytes = Buffer.from(JSON.stringify({ kind: 'block-pack-v1', records: grp.map(([ref, block]) => [ref, block]) }), 'utf8')
      const packFile = path.join(packDir, hash(packBytes) + '.json')
      await writeDurableFile(packFile, packBytes)
      for (const [ref, , bytes] of grp) {
        const dest = blobPath(stagingDir, ref)
        await mkdir(path.dirname(dest), { recursive: true })
        try { await link(packFile, dest) }
        catch (error) {
          if (error.code === 'EEXIST') continue
          if (['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK'].includes(error.code)) {
            await writeDurableFile(dest, bytes)
          } else throw error
        }
      }
    }
    await writeDurableFile(path.join(stagingDir, 'head.json'), JSON.stringify({ format: 2, headId: sourceHeadId }))

    // Verify every single block read back from Format 2 matches Format 3 byte-for-byte.
    onProgress('verifying')
    const verifiedPointer = JSON.parse(await readFile(path.join(stagingDir, 'head.json'), 'utf8'))
    if (verifiedPointer.format !== 2 || verifiedPointer.headId !== sourceHeadId) {
      throw new Error('Exported Format 2 head.json mismatch')
    }
    const verifyStore = createConversationPageStore({ root: stagingRoot, format: 2 })
    const headView = await verifyStore.readHead(targetChatId)
    if (!headView || headView.snapshotCursor.snapshotId !== sourceHeadId) {
      throw new Error('Exported Format 2 head verification failed')
    }
    for (const [ref, { bytes }] of entries) {
      const raw = await readFile(blobPath(stagingDir, ref), 'utf8')
      const decoded = decodeFileBlock(ref, raw)
      const decodedBytes = Buffer.from(JSON.stringify(decoded), 'utf8')
      if (Buffer.compare(decodedBytes, bytes) !== 0) {
        throw new Error(`Exported Format 2 block mismatch: ${ref}`)
      }
    }

    if (inPlace) {
      onProgress('switching')
      const targetDir = conversationDir(resolvedTargetRoot, targetChatId)
      const oldBlocks = path.join(targetDir, 'blocks')
      const oldBlocksBackup = path.join(targetDir, `blocks.pre-export-${randomUUID()}`)
      let hadOldBlocks = false
      try { await stat(oldBlocks); hadOldBlocks = true } catch {}
      if (hadOldBlocks) await rename(oldBlocks, oldBlocksBackup)
      await rename(path.join(stagingDir, 'blocks'), oldBlocks)
      if (keepSqliteBackup) {
        await writeDurableFile(path.join(targetDir, 'head.json.v3-bak'), rawPointer)
      }
      await promotion.write(path.join(targetDir, 'head.json'), JSON.stringify({ format: 2, headId: sourceHeadId }))
      if (hadOldBlocks) await rm(oldBlocksBackup, { recursive: true, force: true })
      await rm(stagingRoot, { recursive: true, force: true })
    }

    return {
      status: 'format2',
      chatId: targetChatId,
      headId: sourceHeadId,
      blocks: blocks.size,
      inPlace,
    }
  } catch (error) {
    if (inPlace) await rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
}
