import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SQLITE_FORMAT = 3
export const SQLITE_FILENAME = 'chat.sqlite'
const HEX_REF = /^[a-f0-9]{64}$/
const SCHEMA_VERSION = '3'
const hash = value => createHash('sha256').update(value).digest('hex')

function conflict() {
  return Object.assign(new Error('Conversation revision conflict'), { code: 'CONVERSATION_CONFLICT' })
}

function assertRef(refHex) {
  if (typeof refHex !== 'string' || !HEX_REF.test(refHex)) throw new Error('Invalid block reference')
  return refHex
}

function dbPath(dir) {
  return path.join(dir, SQLITE_FILENAME)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function prepareStatements(db) {
  return {
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    getBlock: db.prepare('SELECT kind, encoding, data, byte_len FROM blocks WHERE ref = ?'),
    getBlockData: db.prepare('SELECT data, encoding, byte_len FROM blocks WHERE ref = ?'),
    insertBlock: db.prepare('INSERT INTO blocks (ref, kind, encoding, data, byte_len, touched_at) VALUES (?, ?, 0, ?, ?, ?)'),
    touchBlock: db.prepare('UPDATE blocks SET touched_at = ? WHERE ref = ?'),
    deleteBlockIfOld: db.prepare('DELETE FROM blocks WHERE ref = ? AND touched_at <= ?'),
    listBlocks: db.prepare('SELECT ref, touched_at, byte_len AS size FROM blocks'),
    freelistCount: db.prepare('PRAGMA freelist_count'),
  }
}

function configureExisting(db) {
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -65536; PRAGMA mmap_size = 268435456;')
}

function initializeSchema(db) {
  db.exec(`
    PRAGMA page_size = 8192;
    PRAGMA auto_vacuum = INCREMENTAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -65536;
    PRAGMA mmap_size = 268435456;
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS blocks (
      id         INTEGER PRIMARY KEY,
      ref        TEXT UNIQUE NOT NULL,
      kind       TEXT NOT NULL,
      encoding   INTEGER NOT NULL DEFAULT 0,
      data       TEXT NOT NULL,
      byte_len   INTEGER NOT NULL,
      touched_at INTEGER NOT NULL
    );
  `)
}

function decodeStoredBlock(row) {
  if (row.encoding !== 0) throw new Error('Unsupported block encoding')
  let value
  try {
    const text = typeof row.data === 'string'
      ? row.data
      : Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength).toString('utf8')
    value = JSON.parse(text)
  } catch { throw new Error('Invalid immutable block') }
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('Invalid immutable block')
  return value
}

/**
 * Single-file SQLite block store (Format 3) for content-addressed conversation graphs.
 * Preserves the exact SHA-256 block identity and upper-layer DAG contract of Format 1/2
 * while keeping every conversation to a fixed file count (head.json + chat.sqlite at rest).
 */
export function createConversationSqliteBackend({ onIO = () => {}, keepOpenMs = 0, maxOpen = 12 } = {}) {
  // dir -> { db, stmts, pins, timer, backend, inReadTx }
  const handles = new Map()
  // dir -> Promise tail (in-process write serialization)
  const writeLocks = new Map()

  function clearIdleTimer(entry) {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null }
  }

  function endReadTx(entry) {
    if (entry?.inReadTx && entry.db) {
      entry.inReadTx = false
      try { entry.db.exec('COMMIT') }
      catch { try { entry.db.exec('ROLLBACK') } catch {} }
    }
  }

  function closeEntry(dir) {
    const entry = handles.get(dir)
    if (!entry) return
    clearIdleTimer(entry)
    endReadTx(entry)
    handles.delete(dir)
    if (entry.db) {
      try { entry.db.close() } catch {}
      entry.db = null
      entry.stmts = null
    }
  }

  function evictIfNeeded(keepDir) {
    let openCount = 0
    for (const entry of handles.values()) if (entry.db) openCount++
    if (openCount <= maxOpen) return
    for (const [dir, entry] of handles) {
      if (openCount <= maxOpen) break
      if (dir === keepDir || entry.pins > 0 || !entry.db) continue
      closeEntry(dir)
      openCount--
    }
  }

  function scheduleIdleClose(dir, entry) {
    clearIdleTimer(entry)
    endReadTx(entry)
    if (entry.pins > 0) return
    if (keepOpenMs <= 0) {
      closeEntry(dir)
      return
    }
    const timer = setTimeout(() => {
      const current = handles.get(dir)
      if (current && current.pins === 0) closeEntry(dir)
    }, keepOpenMs)
    timer.unref?.()
    entry.timer = timer
  }

  function openHandle(dir, { createIfMissing = false } = {}) {
    let entry = handles.get(dir)
    if (entry?.db) {
      clearIdleTimer(entry)
      handles.delete(dir)
      handles.set(dir, entry)
      return entry
    }
    const file = dbPath(dir)
    const existed = existsSync(file)
    if (!existed && !createIfMissing) {
      throw Object.assign(new Error('SQLite conversation database not found'), { code: 'ENOENT' })
    }
    if (!existed) mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(file)
    try {
      const needsInit = !existed || statSync(file).size === 0
      if (needsInit) {
        initializeSchema(db)
      } else {
        configureExisting(db)
        if (createIfMissing) {
          const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blocks'").get()
          if (!row) initializeSchema(db)
        }
      }
      const stmts = prepareStatements(db)
      if (!entry) {
        entry = { db, stmts, pins: 0, timer: null, backend: null, inReadTx: false }
        handles.set(dir, entry)
      } else {
        entry.db = db
        entry.stmts = stmts
        entry.inReadTx = false
        handles.delete(dir)
        handles.set(dir, entry)
      }
      evictIfNeeded(dir)
      return entry
    } catch (error) {
      try { db.close() } catch {}
      throw error
    }
  }

  /**
   * Pin a directory's SQLite handle for the duration of `work`.
   * Opening is lazy: Format 1/2 saves pay zero cost when wrapped in `withSession`.
   * When the last active session finishes, the handle closes cleanly (and SQLite
   * checkpoints + removes -wal/-shm when keepOpenMs === 0).
   */
  async function withSession(dir, work) {
    let entry = handles.get(dir)
    if (!entry) {
      entry = { db: null, stmts: null, pins: 0, timer: null, backend: null, inReadTx: false }
      handles.set(dir, entry)
    }
    clearIdleTimer(entry)
    entry.pins++
    try {
      return await work()
    } finally {
      entry.pins--
      if (entry.pins === 0) {
        endReadTx(entry)
        if (!entry.db) handles.delete(dir)
        else scheduleIdleClose(dir, entry)
      }
    }
  }

  function getSessionBackend(dir) {
    const entry = handles.get(dir)
    return entry && entry.pins > 0 ? entry.backend : null
  }

  function setSessionBackend(dir, backend) {
    const entry = handles.get(dir)
    if (entry && entry.pins > 0) entry.backend = backend
  }

  function withDbSync(dir, options, fn) {
    const entry = openHandle(dir, options)
    entry.pins++
    try {
      if (options.write) endReadTx(entry)
      return fn(entry.db, entry.stmts, entry)
    } finally {
      entry.pins--
      if (entry.pins === 0) scheduleIdleClose(dir, entry)
    }
  }

  function serializeWrite(dir, work) {
    const previous = writeLocks.get(dir) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    writeLocks.set(dir, current)
    return current.finally(() => {
      if (writeLocks.get(dir) === current) writeLocks.delete(dir)
    })
  }

  function hasDatabase(dir) {
    if (handles.get(dir)?.db) return true
    return existsSync(dbPath(dir))
  }

  function getHeadId(dir, { fresh = false } = {}) {
    return withDbSync(dir, { createIfMissing: false, write: fresh }, (_db, stmts) => {
      const row = stmts.getMeta.get('head_id')
      return row ? row.value : undefined
    })
  }

  function readBlockRaw(dir, refHex) {
    assertRef(refHex)
    const entry = handles.get(dir)
    if (entry?.db && entry.pins > 0) {
      if (!entry.inReadTx) {
        entry.db.exec('BEGIN DEFERRED')
        entry.inReadTx = true
      }
      const row = entry.stmts.getBlock.get(refHex)
      if (!row) return undefined
      return { kind: row.kind, encoding: row.encoding, data: row.data, byteLen: row.byte_len }
    }
    return withDbSync(dir, { createIfMissing: false }, (db, stmts, opened) => {
      if (opened.pins > 1 && !opened.inReadTx) {
        db.exec('BEGIN DEFERRED')
        opened.inReadTx = true
      }
      const row = stmts.getBlock.get(refHex)
      if (!row) return undefined
      return { kind: row.kind, encoding: row.encoding, data: row.data, byteLen: row.byte_len }
    })
  }

  function readBlock(dir, refHex) {
    const raw = readBlockRaw(dir, refHex)
    if (!raw) return undefined
    return { value: decodeStoredBlock(raw), bytes: raw.byteLen }
  }

  /**
   * Deduplicate, corruption-check, and insert blocks inside an ALREADY-OPEN transaction.
   * All corruption checks run before any insertion or onIO write event so an invalid batch
   * never publishes or emits writes.
   */
  function writeEntriesInTx(stmts, entries, nowMs) {
    const unique = new Map()
    for (const entry of entries) {
      const text = typeof entry.bytes === 'string'
        ? entry.bytes
        : Buffer.isBuffer(entry.bytes)
          ? entry.bytes.toString('utf8')
          : JSON.stringify(entry.block)
      const refHex = entry.ref ?? hash(text)
      if (!HEX_REF.test(refHex)) throw new Error('Invalid block reference')
      const prev = unique.get(refHex)
      if (prev) {
        if (prev.text !== text) throw new Error('Immutable block corruption')
      } else {
        unique.set(refHex, { refHex, block: entry.block, text, bytes: Buffer.byteLength(text) })
      }
    }
    const toInsert = []
    const toTouch = []
    for (const item of unique.values()) {
      const existing = stmts.getBlockData.get(item.refHex)
      if (existing) {
        if (existing.encoding !== 0) throw new Error('Unsupported block encoding')
        const storedText = typeof existing.data === 'string'
          ? existing.data
          : Buffer.from(existing.data.buffer, existing.data.byteOffset, existing.data.byteLength).toString('utf8')
        if (storedText !== item.text) throw new Error('Immutable block corruption')
        toTouch.push({ item, bytes: existing.byte_len })
      } else {
        toInsert.push(item)
      }
    }
    for (const { item, bytes } of toTouch) {
      onIO({ kind: 'read', type: item.block.kind, bytes, reason: 'deduplication' })
      stmts.touchBlock.run(nowMs, item.refHex)
    }
    if (toInsert.length > 0) {
      onIO({ kind: 'write', type: 'sqlite-tx', bytes: 0, blocks: toInsert.length })
    }
    for (const item of toInsert) {
      stmts.insertBlock.run(item.refHex, item.block.kind, item.text, item.bytes, nowMs)
      onIO({ kind: 'write', type: item.block.kind, bytes: item.bytes })
    }
    return unique
  }

  function writeBlocks(dir, entries, { nowMs = Date.now() } = {}) {
    if (!entries.length) return []
    const refs = entries.map(entry => {
      const text = typeof entry.bytes === 'string'
        ? entry.bytes
        : Buffer.isBuffer(entry.bytes)
          ? entry.bytes.toString('utf8')
          : JSON.stringify(entry.block)
      return entry.ref ?? hash(text)
    })
    withDbSync(dir, { createIfMissing: true, write: true }, (db, stmts) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        writeEntriesInTx(stmts, entries, nowMs)
        db.exec('COMMIT')
      } catch (error) {
        try { db.exec('ROLLBACK') } catch {}
        throw error
      }
    })
    return refs
  }

  function createInitial(dir, id, entries, headId, { nowMs = Date.now() } = {}) {
    withDbSync(dir, { createIfMissing: true, write: true }, (db, stmts) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        writeEntriesInTx(stmts, entries, nowMs)
        stmts.setMeta.run('format_version', String(SQLITE_FORMAT))
        stmts.setMeta.run('chat_id', id)
        stmts.setMeta.run('schema_version', SCHEMA_VERSION)
        stmts.setMeta.run('head_id', headId)
        db.exec('COMMIT')
      } catch (error) {
        try { db.exec('ROLLBACK') } catch {}
        throw error
      }
    })
  }

  function commitHead(dir, expectedHeadId, entries, nextHeadId, { nowMs = Date.now(), assertCurrent } = {}) {
    withDbSync(dir, { createIfMissing: false, write: true }, (db, stmts) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const current = stmts.getMeta.get('head_id')?.value
        if (current === undefined || (expectedHeadId !== undefined && current !== expectedHeadId)) {
          throw conflict()
        }
        writeEntriesInTx(stmts, entries, nowMs)
        assertCurrent?.()
        stmts.setMeta.run('head_id', nextHeadId)
        db.exec('COMMIT')
      } catch (error) {
        try { db.exec('ROLLBACK') } catch {}
        throw error
      }
    })
  }

  function listBlocks(dir) {
    return withDbSync(dir, { createIfMissing: false }, (_db, stmts) => {
      const rows = stmts.listBlocks.all()
      return rows.map(row => ({
        ref: typeof row.ref === 'string' ? row.ref : Buffer.from(row.ref).toString('hex'),
        touchedAt: row.touched_at,
        size: row.size,
      }))
    })
  }

  function deleteBlocksBatch(dir, candidates, cutoffMs) {
    if (!candidates.length) return { removed: 0, bytes: 0 }
    return withDbSync(dir, { createIfMissing: false, write: true }, (db, stmts) => {
      let removed = 0, bytes = 0
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const item of candidates) {
          const result = stmts.deleteBlockIfOld.run(item.ref, cutoffMs)
          if (result.changes > 0) {
            removed += result.changes
            bytes += item.size
          }
        }
        db.exec('COMMIT')
      } catch (error) {
        try { db.exec('ROLLBACK') } catch {}
        throw error
      }
      return { removed, bytes }
    })
  }

  async function reclaimSpace(dir, { pagesPerStep = 256, minFreePages = 64, signal } = {}) {
    for (;;) {
      if (signal?.aborted) break
      const freePages = withDbSync(dir, { createIfMissing: false, write: true }, (db, stmts) => {
        const count = stmts.freelistCount.get()?.freelist_count ?? 0
        if (count > minFreePages) db.exec(`PRAGMA incremental_vacuum(${pagesPerStep})`)
        return count
      })
      if (freePages <= minFreePages) break
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  function close(dir) {
    closeEntry(dir)
  }

  function closeAll() {
    for (const dir of [...handles.keys()]) closeEntry(dir)
  }

  return Object.freeze({
    withSession,
    getSessionBackend,
    setSessionBackend,
    serializeWrite,
    hasDatabase,
    getHeadId,
    readBlockRaw,
    readBlock,
    writeBlocks,
    createInitial,
    commitHead,
    listBlocks,
    deleteBlocksBatch,
    reclaimSpace,
    close,
    closeAll,
  })
}
