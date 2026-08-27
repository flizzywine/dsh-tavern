import { randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

function inside(root, target) {
  const relative = path.relative(root, target)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function encoded(value) { return value === null ? null : Buffer.from(value).toString('base64') }
function decoded(value) { return value === null ? null : Buffer.from(value, 'base64') }

async function filePaths(target) {
  let info
  try { info = await stat(target) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
  if (info.isFile()) return [target]
  if (!info.isDirectory()) return []
  const result = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) result.push(...await filePaths(child))
    else if (entry.isFile()) result.push(child)
  }
  return result
}

/** Journal multi-file resource mutations so restart converges to one coherent graph. */
export function createResourceMutationJournal(options = {}) {
  const dataRoot = path.resolve(String(options.dataRoot || ''))
  const files = options.files || createDurableFilePromotion(options.filePromotion)
  const journalPath = path.join(dataRoot, '.resource-mutation-journal.json')
  const fault = typeof options.fault === 'function' ? options.fault : async function () {}
  let recovery = null

  function relative(target) {
    const absolute = path.resolve(target)
    if (!inside(dataRoot, absolute) || absolute === journalPath) throw new Error('资源 mutation 路径超出数据目录')
    return path.relative(dataRoot, absolute)
  }

  async function readJournal() {
    const source = await files.read(journalPath)
    return source === undefined ? null : JSON.parse(source.toString('utf8'))
  }

  async function writeJournal(journal) {
    await files.write(journalPath, JSON.stringify(journal, null, 2) + '\n')
  }

  async function apply(journal, side) {
    let index = 0
    for (const entry of journal.entries) {
      const target = path.join(dataRoot, entry.path)
      const value = decoded(entry[side])
      if (value === null) await files.remove(target)
      else await files.write(target, value)
      index += 1
      await fault({ journal, side, index, target })
    }
  }

  async function recoverNow() {
    const journal = await readJournal()
    if (journal === null) return { recovered: false }
    const side = journal.mode === 'rollback' ? 'before' : 'after'
    await apply(journal, side)
    await files.remove(journalPath)
    return { recovered: true, id: journal.id, mode: journal.mode }
  }

  async function recover() {
    if (recovery === null) recovery = recoverNow().finally(function () { recovery = null })
    return await recovery
  }

  async function run(label, build) {
    await recover()
    const desired = new Map()

    async function remember(target) {
      const key = path.resolve(target)
      if (!desired.has(key)) {
        const current = await files.read(key)
        desired.set(key, { before: current, after: current })
      }
      return desired.get(key)
    }

    const plan = Object.freeze({
      async write(target, value) { (await remember(target)).after = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8') },
      async remove(target) {
        const paths = await filePaths(path.resolve(target))
        if (paths.length === 0) { const current = await remember(target); current.after = null; return }
        for (const file of paths) (await remember(file)).after = null
      },
      async move(source, destination) {
        const from = path.resolve(source)
        const to = path.resolve(destination)
        const paths = await filePaths(from)
        if (paths.length === 0) {
          const existing = await files.read(to)
          if (existing !== undefined) return
          throw new Error('资源 mutation 找不到来源：' + path.relative(dataRoot, from))
        }
        for (const sourceFile of paths) {
          const suffix = path.relative(from, sourceFile)
          const destinationFile = suffix === '' ? to : path.join(to, suffix)
          const destinationState = await remember(destinationFile)
          if (destinationState.before !== undefined) throw new Error('资源 mutation 目标已存在：' + path.relative(dataRoot, destinationFile))
          destinationState.after = await files.read(sourceFile)
          ;(await remember(sourceFile)).after = null
        }
      }
    })

    await build(plan)
    const entries = []
    for (const [target, state] of desired) {
      const before = state.before === undefined ? null : state.before
      const after = state.after === undefined ? null : state.after
      if (Buffer.compare(before || Buffer.alloc(0), after || Buffer.alloc(0)) === 0 && (before === null) === (after === null)) continue
      entries.push({ path: relative(target), before: encoded(before), after: encoded(after) })
    }
    if (entries.length === 0) return { changed: false }
    const journal = { schemaVersion: 1, id: randomUUID(), label: String(label || 'resource-mutation'), mode: 'commit', entries }
    await writeJournal(journal)
    try {
      await apply(journal, 'after')
      await files.remove(journalPath)
      return { changed: true, id: journal.id }
    } catch (error) {
      if (error?.code === 'DSH_TAVERN_SIMULATED_CRASH') throw error
      journal.mode = 'rollback'
      await writeJournal(journal)
      await apply(journal, 'before')
      await files.remove(journalPath)
      throw error
    }
  }

  return Object.freeze({ recover, run })
}
