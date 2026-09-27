import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * MVU 变量的每档 SQLite 存储（第一阶段）：快照链 + 当前态。
 * 一档一库 chats/<chatId>/variables.db，WAL，全同步 API——投影函数是同步的，
 * DatabaseSync 单行读写亚毫秒，允许直接在投影路径调用。
 *
 * 表语义（impl-sqlite-variable-store.md §二）：
 * - variable_snapshots：每轮结算后的完整变量树（回退物理删除的对象；时间旅行 = turn<=N 最新一行）
 * - variable_state：当前态单行缓存（脚本级小写只更新它；回退后从快照链回拨）
 */
export function createVariableSqliteStore(options = {}) {
  const chatsRoot = path.resolve(String(options.chatsRoot || ''))
  if (chatsRoot === '') throw new Error('Variable SQLite Store 缺少 chatsRoot')
  const logger = options.logger || console
  const now = typeof options.now === 'function' ? options.now : Date.now
  const maxOpen = Math.max(1, Number(options.maxOpen) || 8)
  const warnTreeBytes = Math.max(65536, Number(options.warnTreeBytes) || 1024 * 1024)
  const open = new Map()
  // snapshotAll 的解析缓存：Map<chatId, Map<turn, tree>>。树对象按共享只读约定出借
  // （调用方需要改写时自行 clone——投影函数内部本就有 clone）。任何写路径统一失效。
  const snapshotCache = new Map()
  const maxCachedSnapshots = Math.max(1, Number(options.maxCachedSnapshots) || 2)

  function invalidateSnapshots(chatId) {
    snapshotCache.delete(safeChatId(chatId))
  }

  function safeChatId(value) {
    const id = String(value || '')
    if (id === '' || id.includes('/') || id.includes('\\') || id === '.' || id === '..') throw new Error('Tavern Chat ID 不合法')
    return id
  }

  function dbFile(chatId) {
    return path.join(chatsRoot, safeChatId(chatId), 'variables.db')
  }

  function handle(chatId, { create = false } = {}) {
    const id = safeChatId(chatId)
    const file = dbFile(id)
    if (!create && !existsSync(file)) return null
    const existing = open.get(id)
    if (existing) {
      open.delete(id)
      open.set(id, existing)
      return existing
    }
    if (create) mkdirSync(path.dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(`CREATE TABLE IF NOT EXISTS variable_snapshots (
      turn INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      tree_json TEXT NOT NULL,
      operations_json TEXT,
      uid TEXT,
      created_at INTEGER NOT NULL
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS variable_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tree_json TEXT NOT NULL,
      turn INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    open.set(id, db)
    while (open.size > maxOpen) {
      const oldest = open.keys().next().value
      try { open.get(oldest).close() } catch { /* Already closed by drop(). */ }
      open.delete(oldest)
    }
    return db
  }

  function encodeTree(tree) {
    const json = JSON.stringify(tree === null || typeof tree !== 'object' ? {} : tree)
    if (json.length > warnTreeBytes) logger?.warn?.('dsh-tavern: 变量树超过告警阈值:', json.length, 'bytes')
    return json
  }

  /** Batch load the whole snapshot chain as Map<turn, tree> (cached; shared read-only trees). */
  function snapshotAll(chatId) {
    const id = safeChatId(chatId)
    const cached = snapshotCache.get(id)
    if (cached) {
      snapshotCache.delete(id)
      snapshotCache.set(id, cached)
      return cached
    }
    const db = handle(chatId)
    if (!db) return undefined
    const map = new Map()
    for (const row of db.prepare('SELECT turn, tree_json FROM variable_snapshots ORDER BY turn').all()) {
      try { map.set(Number(row.turn), JSON.parse(row.tree_json)) } catch { /* Skip corrupt rows; single-row reads still fail loudly. */ }
    }
    snapshotCache.set(id, map)
    while (snapshotCache.size > maxCachedSnapshots) {
      snapshotCache.delete(snapshotCache.keys().next().value)
    }
    return map
  }

  /** One settlement result: the authoritative snapshot for this turn plus the state bump. */
  function commitSettlement(chatId, { turn, tree, operations, uid }) {
    invalidateSnapshots(chatId)
    const db = handle(chatId, { create: true })
    const normalizedTurn = Math.max(0, Math.floor(Number(turn) || 0))
    const treeJson = encodeTree(tree)
    const opsJson = operations === undefined || operations === null ? null : JSON.stringify(operations)
    const stamp = now()
    db.exec('BEGIN')
    try {
      db.prepare(`INSERT INTO variable_snapshots (turn, source, tree_json, operations_json, uid, created_at)
        VALUES (?, 'settlement', ?, ?, ?, ?)
        ON CONFLICT(turn) DO UPDATE SET source = 'settlement', tree_json = excluded.tree_json,
          operations_json = excluded.operations_json, uid = excluded.uid, created_at = excluded.created_at`)
        .run(normalizedTurn, treeJson, opsJson, uid === undefined || uid === null ? null : String(uid), stamp)
      db.prepare(`INSERT INTO variable_state (id, tree_json, turn, updated_at) VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET tree_json = excluded.tree_json, turn = excluded.turn, updated_at = excluded.updated_at`)
        .run(treeJson, normalizedTurn, stamp)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* Connection-level failure; nothing to roll back. */ }
      throw error
    }
    return { turn: normalizedTurn }
  }

  /** Script/API-level variable writes bump the state only, never the snapshot chain. */
  function updateState(chatId, { turn, tree }) {
    const db = handle(chatId, { create: true })
    const treeJson = encodeTree(tree)
    const normalizedTurn = Math.max(0, Math.floor(Number(turn) || 0))
    db.prepare(`INSERT INTO variable_state (id, tree_json, turn, updated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET tree_json = excluded.tree_json, turn = excluded.turn, updated_at = excluded.updated_at`)
      .run(treeJson, normalizedTurn, now())
    return { turn: normalizedTurn }
  }

  function snapshot(chatId) {
    const db = handle(chatId)
    if (!db) return undefined
    const row = db.prepare('SELECT tree_json FROM variable_state WHERE id = 1').get()
    return row === undefined ? undefined : JSON.parse(row.tree_json)
  }

  /** Time travel is exact: the variable tree a turn settled to, or undefined when that turn never settled. */
  function snapshotAt(chatId, turn) {
    const db = handle(chatId)
    if (!db) return undefined
    const row = db.prepare('SELECT tree_json FROM variable_snapshots WHERE turn = ?')
      .get(Math.max(0, Math.floor(Number(turn) || 0)))
    return row === undefined ? undefined : JSON.parse(row.tree_json)
  }

  function has(chatId) {
    const db = handle(chatId)
    return db !== null && db.prepare('SELECT 1 AS ok FROM variable_state WHERE id = 1').get() !== undefined
  }

  /**
   * Rollback physics: snapshots at or after the hidden turn cease to exist and
   * the state rewinds to the newest surviving snapshot (cleared when none does).
   */
  function deleteFrom(chatId, turn) {
    invalidateSnapshots(chatId)
    const db = handle(chatId)
    if (!db) return { deleted: 0, state: false }
    const from = Math.max(1, Math.floor(Number(turn) || 0))
    db.exec('BEGIN')
    try {
      const removed = db.prepare('DELETE FROM variable_snapshots WHERE turn >= ?').run(from)
      const latest = db.prepare('SELECT tree_json, turn FROM variable_snapshots ORDER BY turn DESC LIMIT 1').get()
      if (latest !== undefined) {
        db.prepare('UPDATE variable_state SET tree_json = ?, turn = ?, updated_at = ? WHERE id = 1')
          .run(latest.tree_json, latest.turn, now())
      } else {
        db.prepare('DELETE FROM variable_state WHERE id = 1').run()
      }
      db.exec('COMMIT')
      return { deleted: Number(removed.changes), state: latest !== undefined }
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* Connection-level failure; nothing to roll back. */ }
      throw error
    }
  }

  /** Bulk import for migration: ordered snapshot rows in one transaction. */
  function importSnapshots(chatId, rows) {
    invalidateSnapshots(chatId)
    const db = handle(chatId, { create: true })
    const list = Array.isArray(rows) ? rows : []
    db.exec('BEGIN')
    try {
      for (const row of list) {
        const normalizedTurn = Math.max(0, Math.floor(Number(row.turn) || 0))
        db.prepare(`INSERT INTO variable_snapshots (turn, source, tree_json, operations_json, uid, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(turn) DO UPDATE SET source = excluded.source, tree_json = excluded.tree_json,
            operations_json = excluded.operations_json, uid = excluded.uid, created_at = excluded.created_at`)
          .run(normalizedTurn, String(row.source || 'import'), encodeTree(row.tree),
            row.operations === undefined || row.operations === null ? null : JSON.stringify(row.operations),
            row.uid === undefined || row.uid === null ? null : String(row.uid), now())
      }
      const latest = db.prepare('SELECT tree_json, turn FROM variable_snapshots ORDER BY turn DESC LIMIT 1').get()
      if (latest !== undefined) {
        db.prepare(`INSERT INTO variable_state (id, tree_json, turn, updated_at) VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET tree_json = excluded.tree_json, turn = excluded.turn, updated_at = excluded.updated_at`)
          .run(latest.tree_json, latest.turn, now())
      }
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* Connection-level failure; nothing to roll back. */ }
      throw error
    }
    return { imported: list.length }
  }

  function drop(chatId) {
    invalidateSnapshots(chatId)
    const id = safeChatId(chatId)
    const entry = open.get(id)
    if (entry) {
      try { entry.close() } catch { /* Already closed. */ }
      open.delete(id)
    }
    const file = dbFile(id)
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(file + suffix, { force: true }) } catch { /* Best effort. */ }
    }
  }

  function stats(chatId) {
    const db = handle(chatId)
    if (!db) return null
    const snapshots = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(tree_json)), 0) AS bytes FROM variable_snapshots').get()
    const state = db.prepare('SELECT turn, LENGTH(tree_json) AS bytes, updated_at FROM variable_state WHERE id = 1').get()
    return {
      snapshots: { count: Number(snapshots.n), bytes: Number(snapshots.bytes) },
      state: state === undefined ? null : { turn: Number(state.turn), bytes: Number(state.bytes), updatedAt: Number(state.updated_at) }
    }
  }

  function dispose() {
    for (const db of open.values()) {
      try { db.close() } catch { /* Already closed. */ }
    }
    open.clear()
  }

  return Object.freeze({ has, snapshot, snapshotAt, snapshotAll, commitSettlement, updateState, deleteFrom, importSnapshots, drop, stats, dispose })
}
