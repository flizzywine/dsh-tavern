import { createHash } from 'node:crypto'

const conflict = () => Object.assign(new Error('人物库已在别处修改，请重新载入后再保存；当前草稿仍保留'), { code: 'REVISION_CONFLICT' })

/** All editors share one short write gate. Publish only after the disk write succeeds. */
export function createDefinitionsStore({ initial, persist, onCommit }) {
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
    update(change, { expectedRevision, requireRevision = false } = {}) {
      return serial(async () => {
        if ((requireRevision || expectedRevision !== undefined) && expectedRevision !== current.revision) throw conflict()
        const next = await change(structuredClone(current))
        const saved = await persist(next)
        if (saved === false) throw Object.assign(new Error('保存被拒绝，人物库未修改'), { code: 'SAVE_REFUSED' })
        return publish(saved && typeof saved === 'object' ? saved : next)
      })
    },
    reload(load) { return serial(async () => publish(await load())) },
  }
}
