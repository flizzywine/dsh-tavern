// Undo for "export / import": the import step records every file it created
// together with the sha256 of what it wrote. Undo only deletes files whose
// content still matches that recorded hash, so anything the user edited after
// the import survives and is reported instead of being removed.

const text = value => typeof value === 'string' ? value : (value == null ? '' : String(value))

function recordOf(item) {
  const source = item && typeof item === 'object' ? item : {}
  return { kind: text(source.kind), title: text(source.title), path: text(source.path), sha256: text(source.sha256) }
}

// A record is usable only when it names a kind, a path and the hash captured at
// import time; everything else is reported as incomplete instead of guessed at.
function complete(record) {
  return record.kind !== '' && record.path !== '' && record.sha256 !== ''
}

export function createTransferUndo(options = {}) {
  const hashOf = options.hashOf
  const remove = options.remove
  if (typeof hashOf !== 'function' || typeof remove !== 'function') throw new Error('缺少导入记录哈希或删除能力')

  async function undo(records) {
    const removed = []
    const skipped = []
    const list = Array.isArray(records) ? records : []
    for (const item of list) {
      const record = recordOf(item)
      const entry = { kind: record.kind, title: record.title, path: record.path }
      if (!complete(record)) {
        skipped.push({ ...entry, reason: '记录不完整' })
        continue
      }
      let current
      try {
        current = await hashOf(record.kind, record.path)
      } catch (error) {
        skipped.push({ ...entry, reason: '读取失败：' + text(error?.message ?? error) })
        continue
      }
      if (current == null) {
        skipped.push({ ...entry, reason: '文件已不存在' })
        continue
      }
      if (text(current) !== record.sha256) {
        skipped.push({ ...entry, reason: '导入后内容已改动' })
        continue
      }
      try {
        await remove(record.kind, record.path)
        removed.push(entry)
      } catch (error) {
        skipped.push({ ...entry, reason: '删除失败：' + text(error?.message ?? error) })
      }
    }
    return { removed, skipped }
  }

  return Object.freeze({ undo })
}
