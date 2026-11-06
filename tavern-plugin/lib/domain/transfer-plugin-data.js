// 导出/导入里的插件数据子模块：只处理插件数据 JSON，文件命名与凭据剥离都在这里。
// 插件数据的 key 就是插件文件夹名，真实接线时由 rpc 层注入 pluginDataStore 与 userPluginInstaller.list()。
const SPEC = 'dsh-tavern.transfer.plugin-data'
const VERSION = 1
const MAX_REDACTED_KEYS = 20
const REDACTED_VALUE = '[已移除]'
// 键名像凭据就整条替换：插件数据里常存 token / API key，导出不能带走。
const SENSITIVE_KEY = /api[-_]?key|token|secret|password|credential|bearer|authorization/i
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|]/g

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

/** 文件名里不允许出现 /\:*?"<>|，出现就换掉。 */
function fileNameOf(folder) {
  return str(folder).replace(ILLEGAL_FILE_CHARS, '_') + '.json'
}

/** JSON 值深拷贝：插件数据本来就是 JSON，序列化往返足够且不会带上原型。 */
function cloneJson(value) {
  const text = JSON.stringify(value)
  return text === undefined ? null : JSON.parse(text)
}

/** 把命中凭据规则的字段换成占位串，并记下点路径（最多 20 条）。 */
function redactSecrets(root) {
  const redactedKeys = []
  function remember(pathText) {
    if (redactedKeys.length < MAX_REDACTED_KEYS) redactedKeys.push(pathText)
  }
  function walk(value, prefix) {
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, prefix + '[' + index + ']'))
    }
    if (!value || typeof value !== 'object') return value
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const pathText = prefix ? prefix + '.' + key : key
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED_VALUE
        remember(pathText)
        continue
      }
      out[key] = walk(item, pathText)
    }
    return out
  }
  const data = walk(root, '')
  return { data, redacted: redactedKeys.length > 0, redactedKeys }
}

/**
 * deps.pluginDataStore 是插件数据存储（createPluginDataStore 的实例），
 * deps.listPlugins() 返回插件列表（真实实现 userPluginInstaller.list()）。
 */
export function createTransferPluginData(deps) {
  const { pluginDataStore, listPlugins } = deps || {}
  if (!pluginDataStore) fail('缺少插件数据存储')

  async function installed() {
    if (typeof listPlugins !== 'function') return []
    try {
      const rows = await listPlugins()
      return Array.isArray(rows) ? rows : []
    } catch { return [] }
  }

  async function readData(folder) {
    const data = await pluginDataStore.read(folder)
    return data === undefined ? null : data
  }

  async function list() {
    const plugins = await installed()
    const rows = []
    for (const plugin of plugins) {
      const folder = str(plugin && plugin.folder)
      if (!folder) continue
      const data = await readData(folder)
      // 没有数据的插件不进导出列表。
      if (data === null) continue
      rows.push({
        key: folder,
        title: str(plugin && plugin.name) || folder,
        meta: '插件数据',
        bytes: Buffer.byteLength(JSON.stringify(data))
      })
    }
    return rows
  }

  async function collect(folders) {
    const wanted = (Array.isArray(folders) ? folders : [folders]).map(str).filter(Boolean)
    const plugins = await installed()
    const items = []
    for (const folder of wanted) {
      const data = await readData(folder)
      if (data === null) fail('插件数据不存在：' + folder)
      const known = plugins.find(plugin => str(plugin && plugin.folder) === folder)
      const title = str(known && known.name) || folder
      const { data: cleaned, redacted, redactedKeys } = redactSecrets(cloneJson(data))
      const payload = { spec: SPEC, version: VERSION, plugin: folder, data: cleaned, redacted, redactedKeys }
      items.push({
        key: folder,
        title,
        fileName: fileNameOf(folder),
        content: Buffer.from(JSON.stringify(payload, null, 2))
      })
    }
    return items
  }

  async function importOne(payload) {
    const { key, title, content } = payload || {}
    if (content === undefined || content === null) fail('插件数据内容为空')
    const label = str(key) || str(title)
    let parsed
    try {
      parsed = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : String(content))
    } catch {
      fail('插件数据不是有效的 JSON：' + label)
    }
    if (!parsed || typeof parsed !== 'object' || parsed.spec !== SPEC || !('data' in parsed)) {
      fail('插件数据格式不符：' + label)
    }
    const plugin = str(key) || str(parsed.plugin)
    if (!plugin) fail('缺少插件名')
    await pluginDataStore.save(plugin, parsed.data)
    return { plugin, redacted: Boolean(parsed.redacted) }
  }

  return Object.freeze({ list, collect, importOne })
}
