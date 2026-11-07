import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// 插件自己的数据（不跟某一局走）：每个插件一份 JSON，放在 Tavern 数据目录的 plugin-data/，
// 不在插件文件夹里，所以更新插件不会冲掉；所有设备读到的是同一份。
export const MAX_PLUGIN_DATA = 256 * 1024 * 1024

export function pluginDataFile(dataRoot, plugin) {
  const name = String(plugin || '').trim()
  if (!name) throw new Error('缺少插件名')
  return path.join(path.resolve(dataRoot), 'plugin-data', name.replace(/[^\w.@-]+/g, '_').replace(/^\.+/, '_') + '.json')
}

export function createPluginDataStore({ dataRoot }) {
  const tails = new Map()
  // One write at a time per plugin; reads see the last finished write.
  const serial = (plugin, work) => {
    const run = (tails.get(plugin) || Promise.resolve()).then(work, work)
    tails.set(plugin, run.catch(() => {}))
    return run
  }
  return {
    async read(plugin) {
      try { return JSON.parse(await readFile(pluginDataFile(dataRoot, plugin), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
    },
    save(plugin, data) {
      if (data === undefined) throw new TypeError('data 不能省略；要清除请传 null')
      const file = pluginDataFile(dataRoot, plugin)
      const text = data === null ? null : JSON.stringify(data)
      if (text === undefined) throw new TypeError('data 需要是能转成 JSON 的值')
      if (text !== null && Buffer.byteLength(text) > MAX_PLUGIN_DATA) throw new RangeError('插件全局数据超过 256 MiB（按 JSON UTF-8 字节计算）；请减少预设数量或内容')
      return serial(plugin, async () => {
        if (text === null) { await rm(file, { force: true }); return }
        await mkdir(path.dirname(file), { recursive: true })
        const temporary = file + '.' + process.pid + '.tmp'
        await writeFile(temporary, text)
        await rename(temporary, file)
      })
    },
  }
}
