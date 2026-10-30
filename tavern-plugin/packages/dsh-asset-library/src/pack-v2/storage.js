import path from 'node:path'
import { channel } from 'node:diagnostics_channel'
const readTiming = channel('dsh.asset.read')
import { lstat, readdir, mkdir, readFile, open, rename, rm, rmdir, copyFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { absent, checkedPath } from './storage-path.js'
import { createMediaStore } from './media-store.js'
export { checkedPath } from './storage-path.js'
import { check, relativePath, validateUuid } from '../asset-packs/common.js'
import { readDocument, jsonBytes, budget, StoredFile } from './validation.js'

export const supportsIndependentFiles = true
const roots = new Map()
// staging ownership is shared by all storage instances in this process.
const ownerToken = randomUUID()
const staleOwnerMs = 24 * 60 * 60 * 1000
async function durableWrite(file, bytes) {
  await mkdir(path.dirname(file), {recursive:true})
  const handle = await open(file, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
// One gate per explicit profile root, shared by service instances in this process.
// Reads also enter it, so neither replacement gaps nor recovery trees are observable.
export function createPackStorage({assetRoot, limits, cardTransactions, mediaStore, inspectPath = lstat, fault = async () => {}}) {
  check(typeof assetRoot === 'string' && path.isAbsolute(assetRoot), '$.assetRoot', 'An absolute profile assetRoot is required')
  const root = path.resolve(assetRoot), key = process.platform === 'win32' ? root.toLowerCase() : root
  let shared = roots.get(key)
  if (!shared) { shared = {queue:[], readers:0, exclusive:false, subscribers:new Set()}; roots.set(key, shared) }
  mediaStore ||= createMediaStore({root})
  const locate = relative => checkedPath(root, relative, inspectPath)
  const exists = async relative => !!await lstat(await locate(relative)).catch(absent)
  const read = async (relative, maxBytes = limits.entrySize) => {
    const started = performance.now()
    const file = await locate(relative), info = await lstat(file).catch(absent)
    if (!info) return undefined
    check(info.isFile() && !info.isSymbolicLink(), relative, 'Reparse/special file rejected', 'INVALID_PATH')
    check(info.size <= maxBytes, relative, 'Stored file exceeds budget', 'LIMIT_EXCEEDED')
    const bytes = await readFile(file)
    check(bytes.length <= maxBytes, relative, 'Stored file exceeds budget', 'LIMIT_EXCEEDED')
    if (readTiming.hasSubscribers) readTiming.publish({name:'pack.read.' + (/^packs\/[^/]+\/manifest\.json$/.test(relative) ? 'manifest' : 'document'), packId:relative.split('/')[1]?.replace(/\.json$/, ''), bytes:bytes.length, durationMs:performance.now() - started})
    return bytes
  }
  // Stored media is served by byte range; the handle closes before the caller's fence is released.
  const readRange = async (relative, position, length) => {
    const file = await locate(relative), info = await lstat(file).catch(absent)
    check(info, relative, 'Missing stored file', 'FILE_CLOSURE_MISMATCH')
    check(info.isFile() && !info.isSymbolicLink(), relative, 'Reparse/special file rejected', 'INVALID_PATH')
    const handle = await open(file, 'r')
    try {
      const {bytesRead, buffer} = await handle.read(Buffer.allocUnsafe(length), 0, length, position)
      check(bytesRead === length, relative, 'Stored file shorter than its manifest', 'FILE_CLOSURE_MISMATCH')
      return buffer
    } finally { await handle.close() }
  }
  async function createTransaction() {
    const id = randomUUID(), pending = 'staging-pending/' + id, tx = 'staging/' + id
    // Publish the directory and its durable owner together, before any content.
    await durableWrite(await locate(pending + '/owner.json'), jsonBytes({pid:process.pid, token:ownerToken, createdAt:Date.now()}))
    await mkdir(await locate('staging'), {recursive:true})
    await rename(await locate(pending), await locate(tx))
    return tx
  }
  async function recoverable(tx) {
    const info = await lstat(await locate(tx)).catch(absent)
    if (!info) return false
    const old = Date.now() - info.mtimeMs > staleOwnerMs
    // Pending metadata may still be being written or renamed into staging.
    if (tx.startsWith('staging-pending/') && !old) return false
    const bytes = await read(tx + '/owner.json')
    if (bytes) {
      const owner = readDocument(bytes)
      check(Number.isInteger(owner.pid) && owner.pid > 0 && typeof owner.token === 'string' && Number.isFinite(owner.createdAt), tx, 'Invalid staging owner', 'RECOVERY_REQUIRED')
      // The local gate guarantees our previous transaction is no longer active.
      if (owner.pid === process.pid && owner.token === ownerToken) return true
      try { process.kill(owner.pid, 0); return false }
      catch (error) { return error.code === 'ESRCH' }
    }
    return old
  }
  async function tree(relative) {
    const files = new Map(), spelling = new Map()
    let total = 0, count = 0
    // retain every path/byte check, but do not serialize thousands of
    // independent cold reads. Reservations happen before I/O so concurrency cannot exceed budgets.
    const jobs = [() => visit(relative)], concurrency = 8
    async function visit(folder, prefix = '') {
      for (const item of await readdir(await locate(folder), {withFileTypes:true})) {
        const name = prefix + item.name, full = folder + '/' + item.name
        relativePath(name)
        check(!spelling.has(name.toLowerCase()), name, 'Case collision', 'INVALID_PATH'); spelling.set(name.toLowerCase(), name)
        jobs.push(async () => {
          const info = await lstat(await locate(full))
          check(!info.isSymbolicLink() && (info.isFile() || info.isDirectory()), full, 'Reparse/special file rejected', 'INVALID_PATH')
          if (info.isDirectory()) await visit(full, name + '/')
          else {
            total += info.size; count++
            check(info.size <= limits.entrySize && total <= limits.totalSize && count <= limits.entries, name, 'Stored tree exceeds budget', 'LIMIT_EXCEEDED')
            files.set(name, await read(full))
          }
        })
      }
    }
    await new Promise((resolve, reject) => {
      let active = 0, next = 0, failure
      function pump() {
        while (!failure && active < concurrency && next < jobs.length) {
          const job = jobs[next++]; active++
          Promise.resolve().then(job).catch(error => { failure ||= error }).finally(() => { active--; pump() })
        }
        if (!active) { if (failure) reject(failure); else if (next === jobs.length) resolve() }
      }
      pump()
    })
    budget(files, limits); return files
  }
  // Publication replaces these documents. Cache invalidation needs their file
  // identity/timestamps, not another read and digest of the stored manifest.
  async function stamp(id) {
    validateUuid(id)
    const manifest = await lstat(await locate(`packs/${id}/manifest.json`)).catch(absent)
    if (!manifest) return null
    const local = await lstat(await locate(`local/${id}.json`)).catch(absent)
    check(local, id, 'Incomplete local state', 'RECOVERY_REQUIRED')
    return [manifest, local].map(s => [s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':')).join('/')
  }
  async function erase(relative) {
    if (!await exists(relative)) return
    const info = await lstat(await locate(relative))
    if (info.isDirectory()) {
      // Cleanup may contain both old and new trees; do not apply the single-pack byte cap.
      const order = name => name === 'owner.json' ? 3 : name === 'committed' ? 2 : name === 'journal.json' ? 1 : 0
      for (const item of (await readdir(await locate(relative))).sort((a,b) => order(a) - order(b))) await erase(relative + '/' + item)
    }
    if (info.isDirectory()) await rmdir(await locate(relative))
    else await rm(await locate(relative), {force:true})
  }
  async function rollback(tx, journal) {
    if (journal.version === 3) {
      for (const name of [...journal.files, '@local']) {
        const live = name === '@local' ? `local/${journal.id}.json` : `packs/${journal.id}/${name}`
        const backup = `${tx}/old/${name}`
        // Replace in place: the restored file is never absent for a reader in another process.
        if (await exists(backup)) { await mkdir(path.dirname(await locate(live)), {recursive:true}); await rename(await locate(backup), await locate(live)) }
        else if (journal.added?.includes(name)) await erase(live)
      }
      return
    }
    for (const [live, backup, had] of [[`packs/${journal.id}`, `${tx}/old-pack`, journal.hadPack], [`local/${journal.id}.json`, `${tx}/old-local.json`, journal.hadLocal]]) {
      if (await exists(backup)) { await erase(live); await rename(await locate(backup), await locate(live)) }
      else if (!had) await erase(live)
    }
  }
  async function recover(readOnly = false) {
    for (const parent of ['staging-pending', 'staging']) {
      for (const entry of await readdir(await locate(parent), {withFileTypes:true}).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
        validateUuid(entry.name)
        const tx = parent + '/' + entry.name
        check(entry.isDirectory() && !entry.isSymbolicLink(), tx, 'Unsafe staging tree', 'RECOVERY_REQUIRED')
        if (!await recoverable(tx)) continue
        check(!readOnly, tx, 'Recovery must complete before a read-only operation', 'RECOVERY_REQUIRED')
        const bytes = await read(tx + '/journal.json')
        if (bytes) {
          const journal = readDocument(bytes)
          if (journal.version === 2) {
            check(Array.isArray(journal.packs) && cardTransactions, tx, 'Card recovery adapter required', 'RECOVERY_REQUIRED')
            for (const item of journal.packs) { validateUuid(item.id); check(typeof item.hadPack === 'boolean' && typeof item.hadLocal === 'boolean', tx, 'Invalid journal', 'RECOVERY_REQUIRED') }
            if (!await exists(tx + '/committed')) {
              const status = await cardTransactions.recover(journal.card)
              check(['before','after'].includes(status), tx, 'Card recovery is ambiguous', 'RECOVERY_REQUIRED')
              if (status === 'before') for (const item of [...journal.packs].reverse()) await rollback(tx + '/' + item.id, item)
            }
          } else {
            validateUuid(journal.id)
            if (journal.version === 3) {
              check(Array.isArray(journal.files) && journal.files.length > 0 && new Set(journal.files).size === journal.files.length && journal.files.every(name => typeof name === 'string' && name !== '@local'), tx, 'Invalid file journal', 'RECOVERY_REQUIRED')
              for (const name of journal.files) relativePath(name)
              if (journal.added) check(Array.isArray(journal.added) && journal.added.every(name => journal.files.includes(name)), tx, 'Invalid added files', 'RECOVERY_REQUIRED')
            }
            else check(journal.version === 1 && typeof journal.hadPack === 'boolean' && typeof journal.hadLocal === 'boolean', tx, 'Invalid recovery journal', 'RECOVERY_REQUIRED')
            if (!await exists(tx + '/committed')) await rollback(tx, journal)
          }
        }
        await erase(tx)
      }
    }
  }
  // FIFO phases: contiguous readers share a stable publication; a queued writer
  // closes admission immediately. Recovery runs exclusively before each phase.
  function pump() {
    if (shared.exclusive || !shared.queue.length) return
    if (shared.readers) {
      while (shared.queue[0]?.reading) shared.queue.shift().start()
      return
    }
    const first = shared.queue.shift()
    shared.exclusive = true
    first.recover().then(() => {
      if (first.reading) {
        shared.exclusive = false
        first.start()
        pump()
      } else first.start()
    }, error => {
      shared.exclusive = false; first.reject(error); pump()
    })
  }
  function enter(ids, task, readOnly, reading) {
    ids.forEach(validateUuid)
    const queued = performance.now()
    return new Promise((resolve, reject) => {
      shared.queue.push({reading, reject,
        async recover() {
          const recovery = performance.now()
          try { await recover(readOnly) } catch (cause) { throw Object.assign(new Error('Pack recovery required', {cause}), {code:'RECOVERY_REQUIRED'}) }
          if (readTiming.hasSubscribers) readTiming.publish({name:'pack.recovery', packIds:ids, durationMs:performance.now() - recovery})
        },
        start() {
          if (reading) shared.readers++
          if (readTiming.hasSubscribers) readTiming.publish({name:'pack.gate.wait', packIds:ids, mode:reading?'read':'write', durationMs:performance.now() - queued})
          const held = performance.now()
          Promise.resolve().then(task).then(resolve, reject).finally(() => {
            if (reading) shared.readers--; else shared.exclusive = false
            if (readTiming.hasSubscribers) readTiming.publish({name:'pack.gate.hold', packIds:ids, mode:reading?'read':'write', durationMs:performance.now() - held})
            pump()
          })
        }
      })
      pump()
    })
  }
  const run = (ids, task, readOnly = false) => enter(ids, task, readOnly, false)
  const readRun = (ids, task, readOnly = false) => enter(ids, task, readOnly, true)
  async function load(id) {
    validateUuid(id)
    if (!await exists('packs/' + id)) return null
    const files = await tree('packs/' + id), bytes = files.get('manifest.json')
    check(bytes, id, 'Missing manifest', 'FILE_CLOSURE_MISMATCH')
    files.delete('manifest.json')
    const manifest = readDocument(bytes), local = await readLocal(id)
    check(manifest.id === id && local, id, 'Incomplete pack publication', 'RECOVERY_REQUIRED')
    check(typeof local.revision === 'string' && Array.isArray(local.retired), id, 'Invalid local state', 'RECOVERY_REQUIRED')
    return {manifest, files, local}
  }
  async function listIds() {
    const started = performance.now()
    const entries = await readdir(await locate('packs'), {withFileTypes:true}).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))
    if (readTiming.hasSubscribers) readTiming.publish({name:'pack.registry-scan', count:entries.length, durationMs:performance.now() - started})
    return entries.map(entry => { validateUuid(entry.name); check(entry.isDirectory() && !entry.isSymbolicLink(), entry.name, 'Unsafe pack directory', 'INVALID_PATH'); return entry.name }).sort()
  }
  // Reuse validated content identities; metadata and publication journals stay pack-owned.
  async function stageFiles(base, pack) {
    const descriptors = new Map(pack.manifest.files.map(file => [file.path, file]))
    for (const [name, bytes] of pack.files) {
      const descriptor = descriptors.get(name)
      // Lazy export/merge inputs hydrate one file at a time, not the entire source pack.
      const source = bytes instanceof StoredFile ? await read(path.relative(root, bytes.file).split(path.sep).join('/'), bytes.length) : bytes
      const ref = await mediaStore.put(source, {ref:descriptor, maxBytes:limits.entrySize})
      await mediaStore.materialize(ref, await locate(base + '/' + name))
    }
  }
  async function publish(id, pack, local, before) {
    if (pack && before) {
      const prior = new Map(before.manifest.files.map(file => [file.path, file])), updates = new Map()
      for (const file of pack.manifest.files) {
        const old = prior.get(file.path)
        if (!old || old.sha256 !== file.sha256 || old.size !== file.size) updates.set(file.path, pack.files.get(file.path))
        prior.delete(file.path)
      }
      for (const name of prior.keys()) updates.set(name, null)
      return publishMetadata(id, pack.manifest, updates, local)
    }
    const tx = await createTransaction()
    const journal = {version:1, id, hadPack:await exists('packs/' + id), hadLocal:await exists(`local/${id}.json`)}
    let committed = false
    try {
      if (pack) {
        await stageFiles(`${tx}/new-pack`,pack)
        await durableWrite(await locate(`${tx}/new-pack/manifest.json`), jsonBytes(pack.manifest))
      }
      // Tombstone local state survives removal so retired identities cannot be recycled.
      await durableWrite(await locate(tx + '/new-local.json'), jsonBytes(local))
      await durableWrite(await locate(tx + '/journal.json'), jsonBytes(journal))
      await fault('prepared')
      await mkdir(await locate('packs'), {recursive:true}); await mkdir(await locate('local'), {recursive:true})
      if (journal.hadPack) await rename(await locate('packs/' + id), await locate(tx + '/old-pack'))
      if (journal.hadLocal) await rename(await locate(`local/${id}.json`), await locate(tx + '/old-local.json'))
      await fault('backed-up')
      if (pack) await rename(await locate(tx + '/new-pack'), await locate('packs/' + id))
      await fault('pack-published')
      await rename(await locate(tx + '/new-local.json'), await locate(`local/${id}.json`))
      await fault('local-published')
      await durableWrite(await locate(tx + '/committed'), Buffer.from('1'))
      committed = true
    } catch (error) {
      try { if (await exists(tx + '/journal.json')) await rollback(tx, journal); await erase(tx) }
      catch (cause) { throw Object.assign(new Error('Pack rollback requires recovery', {cause}), {code:'RECOVERY_REQUIRED'}) }
      throw error
    }
    // Cleanup failure is recoverable on the next entry, never a failed committed edit.
    if (committed) await erase(tx).catch(() => {})
  }
  // Metadata and resource edits share one journal: only changed files move.
  // Null removes a file; added paths are recorded so rollback also removes new files.
  async function publishMetadata(id, manifest, updates, local) {
    const tx = await createTransaction(), files = new Map([...updates, ['manifest.json', jsonBytes(manifest)]])
    const journal = {version:3, id, files:[...files.keys()], added:[]}
    for (const name of files.keys()) if (!await exists(`packs/${id}/${name}`)) journal.added.push(name)
    files.set('@local', jsonBytes(local))
    try {
      const resources = new Map([...updates].filter(([, bytes]) => bytes !== null))
      if (resources.size) await stageFiles(`${tx}/new`, {manifest, files:resources})
      await durableWrite(await locate(`${tx}/new/manifest.json`), files.get('manifest.json'))
      await durableWrite(await locate(`${tx}/new/@local`), files.get('@local'))
      await durableWrite(await locate(tx + '/journal.json'), jsonBytes(journal))
      await fault('prepared')
      // The gate above is per process; another process installing assets reads this tree
      // without it. Back up by copy and replace each file by one rename over it, manifest and local state last and
      // removals after them, so such a reader never finds the manifest or local state missing (an absent pack:
      // a stage would drop the pack's skin, figures and media) - only, briefly, a mix it re-reads on the next stamp.
      for (const name of files.keys()) {
        const live = name === '@local' ? `local/${id}.json` : `packs/${id}/${name}`
        const backup = await locate(`${tx}/old/${name}`)
        if (!journal.added.includes(name)) {
          await mkdir(path.dirname(backup), {recursive:true})
          // Complete or absent: recovery restores whatever backup exists over the untouched live file.
          await copyFile(await locate(live), backup + '.part')
          const handle = await open(backup + '.part', 'r+')
          try { await handle.sync() } finally { await handle.close() }
          await rename(backup + '.part', backup)
        }
      }
      await fault('backed-up')
      for (const name of journal.files) if (files.get(name) !== null && name !== 'manifest.json') {
        const destination = await locate(`packs/${id}/${name}`)
        await mkdir(path.dirname(destination), {recursive:true})
        await rename(await locate(`${tx}/new/${name}`), destination)
      }
      await rename(await locate(`${tx}/new/manifest.json`), await locate(`packs/${id}/manifest.json`))
      await fault('pack-published')
      await rename(await locate(tx + '/new/@local'), await locate(`local/${id}.json`))
      for (const name of journal.files) if (files.get(name) === null) await erase(`packs/${id}/${name}`)
      await fault('local-published')
      await durableWrite(await locate(tx + '/committed'), Buffer.from('1'))
    } catch (error) {
      try { if (await exists(tx + '/journal.json')) await rollback(tx, journal); await erase(tx) }
      catch (cause) { throw Object.assign(new Error('Pack rollback requires recovery', {cause}), {code:'RECOVERY_REQUIRED'}) }
      throw error
    }
    await erase(tx).catch(() => {})
  }
  async function publishMany(entries, card) {
    const tx = await createTransaction(), packs = []
    for (const entry of entries) packs.push({id:entry.pack.manifest.id, hadPack:await exists('packs/' + entry.pack.manifest.id), hadLocal:await exists(`local/${entry.pack.manifest.id}.json`)})
    const journal = {version:2, packs, card:card.record}
    try {
      for (const {pack, local} of entries) {
        const base = `${tx}/${pack.manifest.id}`
        await stageFiles(`${base}/new-pack`,pack)
        await durableWrite(await locate(base + '/new-pack/manifest.json'), jsonBytes(pack.manifest))
        await durableWrite(await locate(base + '/new-local.json'), jsonBytes(local))
      }
      await durableWrite(await locate(tx + '/journal.json'), jsonBytes(journal))
      await fault('batch-prepared')
      await mkdir(await locate('packs'), {recursive:true}); await mkdir(await locate('local'), {recursive:true})
      for (const item of packs) {
        const base = `${tx}/${item.id}`
        if (item.hadPack) await rename(await locate('packs/' + item.id), await locate(base + '/old-pack'))
        if (item.hadLocal) await rename(await locate(`local/${item.id}.json`), await locate(base + '/old-local.json'))
        await fault('batch-backed-up', item.id)
        await rename(await locate(base + '/new-pack'), await locate('packs/' + item.id))
        await fault('batch-pack-published', item.id)
        await rename(await locate(base + '/new-local.json'), await locate(`local/${item.id}.json`))
        await fault('batch-local-published', item.id)
      }
      await fault('batch-before-card')
      await card.commit()
      await fault('batch-card-committed')
      await durableWrite(await locate(tx + '/committed'), Buffer.from('1'))
    } catch (error) {
      try {
        // The card lock is still held. Never reacquire it through the recovery adapter.
        const status = await card.status()
        check(['before','after'].includes(status), tx, 'Card commit outcome unknown', 'RECOVERY_REQUIRED')
        if (status === 'before') {
          if (await exists(tx + '/journal.json')) for (const item of [...packs].reverse()) await rollback(tx + '/' + item.id, item)
          await erase(tx)
          throw error
        }
        // A durable card write is the commit point even if its acknowledgement was lost.
      } catch (cause) {
        if (cause === error) throw error
        throw Object.assign(new Error('Card bundle recovery required', {cause}), {code:'RECOVERY_REQUIRED'})
      }
    }
    // Never discard the journal before recording the durable commit decision.
    if (!await exists(tx + '/committed')) await durableWrite(await locate(tx + '/committed'), Buffer.from('1'))
    await erase(tx).catch(() => {})
  }
  // old installs use the local commit file's mtime until their next write.
  // This reads metadata only; the normal publication transaction persists the fill.
  async function readLocal(id) {
    const name = `local/${id}.json`, bytes = await read(name)
    if (!bytes) return null
    const local = readDocument(bytes)
    if (local.installedAt === undefined || local.updatedAt === undefined) {
      const time = Math.trunc((await lstat(await locate(name))).mtimeMs)
      local.installedAt ??= time; local.updatedAt ??= time
    }
    return local
  }
  return {run, readRun, load, stamp, listIds, publish, publishMetadata, publishMany, locate, tree, read, readRange, exists, subscribers:shared.subscribers,
    local:readLocal,
    async retainArchive(source) {
      const relative = 'export-outbox/' + randomUUID() + '.zip', file = await locate(relative)
      await mkdir(await locate('export-outbox'), {recursive:true})
      await rename(source, file)
      return {file, size:(await lstat(file)).size, dispose:() => erase(relative)}
    },
    async temporary(task) {
      const tx = await createTransaction()
      try { return await task(await locate(tx + '/archive.zip')) } finally { await erase(tx) }
    }
  }
}
