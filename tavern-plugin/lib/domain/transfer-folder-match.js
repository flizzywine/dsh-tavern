import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

// 导入是「加一份新的」：同一个包再进来一次，不该多出一个 (2)。判断依据是内容而不是名字——
// 目录里的文件逐字节等于包里的条目、也没有包外的文件，才算同一个东西。隐藏文件（.tavern-status.json
// 这类装载标记）不算内容，插件管理器写它们不该让比较失败。
async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const entry of entries) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...await listFiles(path.join(dir, entry.name), relative))
    else out.push(relative)
  }
  return out
}

export async function folderHoldsZip(dir, zipEntries) {
  const expected = new Map()
  for (const [name, data] of zipEntries) expected.set(String(name).replace(/\\/g, '/'), data)
  if (!expected.size) return false
  for (const [relative, data] of expected) {
    const file = path.resolve(dir, relative)
    if (file !== path.resolve(dir) && !file.startsWith(path.resolve(dir) + path.sep)) return false
    let bytes
    try { bytes = await readFile(file) } catch { return false }
    if (!Buffer.from(data).equals(bytes)) return false
  }
  for (const relative of await listFiles(dir)) {
    if (expected.has(relative)) continue
    if (path.posix.basename(relative).startsWith('.')) continue
    return false
  }
  return true
}
