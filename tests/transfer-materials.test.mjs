import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { createTransferMaterials } from '../tavern-plugin/lib/domain/transfer-materials.js'

// 内存版资源库：list 按 keys 给相对路径，readText 读 files，importText 按 unique 换号写回。
function memoryResources(seed = {}, extraKeys = []) {
  const files = new Map(Object.entries(seed))
  const keys = [...Object.keys(seed), ...extraKeys]
  const calls = []
  return {
    calls,
    files,
    async list(kind) {
      calls.push({ method: 'list', kind })
      return [...keys]
    },
    async readText(relative) {
      calls.push({ method: 'readText', relative })
      return files.has(relative) ? files.get(relative) : undefined
    },
    async importText(kind, entry, cardPath, options) {
      calls.push({ method: 'importText', kind, name: entry && entry.name, text: entry && entry.text, cardPath, options })
      const name = String(entry && entry.name)
      let target = (kind === 'source' ? 'materials/' : kind + '/') + name
      if (options && options.unique === true) {
        const parsed = path.posix.parse(target)
        for (let suffix = 1; files.has(target); suffix += 1) {
          target = path.posix.join(parsed.dir, parsed.name + ' (' + suffix + ')' + parsed.ext)
        }
      }
      files.set(target, String(entry && entry.text))
      return target
    }
  }
}

test('collect 未知或读不到的路径报「剧本素材不存在」', async () => {
  const resources = memoryResources({
    'materials/剧情大纲.txt': '第一幕\n'
  }, ['materials/读不到.txt'])
  const transfer = createTransferMaterials({ fileResources: resources })

  await assert.rejects(() => transfer.collect(['materials/不存在.txt']), /剧本素材不存在：materials\/不存在\.txt/)
  await assert.rejects(() => transfer.collect(['materials/读不到.txt']), /剧本素材不存在：materials\/读不到\.txt/)
  await assert.rejects(() => transfer.collect(['materials/剧情大纲.txt', 'materials/不存在.txt']), /剧本素材不存在：materials\/不存在\.txt/)
})
