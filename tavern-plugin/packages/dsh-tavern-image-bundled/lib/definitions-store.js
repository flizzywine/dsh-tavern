import { createHash } from 'node:crypto'

const conflict = () => Object.assign(new Error('人物库已在别处修改，请重新载入后再保存；当前草稿仍保留'), { code: 'REVISION_CONFLICT' })

/** All editors share one short write gate. Publish only after the disk write succeeds. */
// commit (previous, next, save): how every update is saved unless it names its own (Tavern's linked figures).
export function createDefinitionsStore({ initial, persist, onCommit, commit: commitEvery }) {
  let current, queue = Promise.resolve()
  function publish(value) {
    const { revision, ...data } = value
    current = { ...data, revision: createHash('sha256').update(JSON.stringify(data)).digest('hex') }
    onCommit(current)
    return current
  }
  publish(initial)
  function serial(work) {
    const run = queue.catch(() => {}).then(work)
    queue = run
    return run
  }
  return {
    update(change, { expectedRevision, requireRevision = false, commit = commitEvery } = {}) {
      return serial(async () => {
        if ((requireRevision || expectedRevision !== undefined) && expectedRevision !== current.revision) throw conflict()
        const previous = structuredClone(current), next = await change(previous)
        async function save(value, receiptId) {
          const saved = await persist(value, receiptId)
          if (saved === false) throw Object.assign(new Error('保存被拒绝，人物库未修改'), { code: 'SAVE_REFUSED' })
          return saved && typeof saved === 'object' ? saved : value
        }
        return publish(commit ? await commit(previous, next, save) : await save(next))
      })
    },
    reload(load) { return serial(async () => publish(await load())) },
  }
}
