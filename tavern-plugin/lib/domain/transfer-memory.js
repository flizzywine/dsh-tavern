function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function fail(message) {
  throw new Error(message)
}

// 与 worldbook-recall-log.js 的目录规则一致：一格 chatId、一格 operationId，都是文件名安全字符。
const SEGMENT = /^[a-zA-Z0-9_-]+$/

function segmentOf(value, label) {
  const name = str(value)
  if (!SEGMENT.test(name)) fail(label + '标识无效：' + name.slice(0, 80))
  return name
}

/** 一局对话的世界书召回日志：按 chatId 分目录，index.json 记轮次，每条记录一个 JSON。 */
export function createTransferMemory({ store, listSessions } = {}) {
  const base = chatId => 'worldbook-recalls/' + chatId + '/'

  async function games() {
    const map = new Map()
    for (const chat of await listSessions()) {
      if (!chat || str(chat.requestMode) === 'sillytavern') continue
      if (str(chat.mode) === 'card') continue
      const key = str(chat.id) || str(chat.chatId)
      if (key && SEGMENT.test(key)) map.set(key, chat)
    }
    return map
  }

  function titleOf(chat) {
    return str(chat && chat.title) || str(chat && chat.cardName) || '未命名对话'
  }

  async function recordsOf(chatId) {
    const index = await store.readJson(base(chatId) + 'index.json').catch(() => null)
    const records = Array.isArray(index && index.records) ? index.records : []
    return records.filter(record => record && SEGMENT.test(str(record.operationId)) && str(record.path).startsWith(base(chatId)))
  }

  async function sizeOf(record) {
    try { return await store.size(record.path) } catch { return 0 }
  }

  async function list() {
    const items = []
    for (const [chatId, chat] of await games()) {
      const records = await recordsOf(chatId)
      if (!records.length) continue
      let bytes = 0
      for (const record of records) bytes += await sizeOf(record)
      items.push({ key: chatId, title: titleOf(chat), meta: records.length + ' 轮召回记录', bytes })
    }
    return items
  }

  /** 一项 = 一局的全部召回记录，合成一个 JSON：第几轮、哪条操作、当次的召回明细。 */
  async function collect(keys) {
    const map = await games()
    const items = []
    for (const key of (Array.isArray(keys) ? keys : [keys]).map(str).filter(Boolean)) {
      const chat = map.get(key)
      if (!chat) fail('对话不存在：' + key)
      const records = await recordsOf(key)
      if (!records.length) continue
      const packed = []
      for (const record of records) {
        const log = await store.readJson(record.path).catch(() => null)
        if (!log) continue
        packed.push({ turn: Number(record.turn) || 0, operationId: str(record.operationId), branchId: str(record.branchId), createdAt: Number(record.createdAt) || 0, log })
      }
      if (!packed.length) continue
      const title = titleOf(chat)
      items.push({ key, title, fileName: key + '.recalls.json',
        content: Buffer.from(JSON.stringify({ spec: 'dsh-tavern.transfer.recalls', version: 1, chatId: key, records: packed }, null, 2) + '\n', 'utf8') })
    }
    return items
  }

  /**
   * 并入一局：只认 operationId，已有的轮次不重复；导入后的文件按新 chatId 落盘，
   * 存档里被改写的 recallLog 路径因此仍能找到同一份记录。
   */
  async function importOne(payload) {
    const { content } = payload || {}
    const chatId = segmentOf(payload && payload.chatId, '对话')
    if (content === undefined || content === null) fail('召回记录内容为空')
    let document
    try { document = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : String(content)) } catch { fail('召回记录不是有效的 JSON') }
    if (!document || document.spec !== 'dsh-tavern.transfer.recalls') fail('不是酒馆的召回记录（spec 不符）')
    if (Number(document.version) !== 1) fail('不支持的召回记录版本：' + str(document.version))
    const records = Array.isArray(document.records) ? document.records : []
    if (!records.length) fail('召回记录是空的')
    const sessionId = str(payload && payload.sessionId)
    const known = new Set((await recordsOf(chatId)).map(record => str(record.operationId)))
    const added = []
    for (const record of records) {
      const operationId = segmentOf(record && record.operationId, '召回记录')
      if (known.has(operationId)) continue
      const log = record.log && typeof record.log === 'object' ? record.log : null
      if (!log) continue
      const path = base(chatId) + operationId + '.json'
      await store.writeJson(path, Object.assign({}, log, { chatId, ...(sessionId ? { sessionId } : {}) }))
      known.add(operationId)
      added.push({ path, turn: Number(record.turn) || Number(log.turn) || 0,
        operationId, branchId: str(record.branchId || log.branchId), createdAt: Number(record.createdAt) || Number(log.createdAt) || Date.now() })
    }
    if (added.length) {
      await store.updateJson(base(chatId) + 'index.json', previous => {
        const rows = Array.isArray(previous && previous.records) ? previous.records : []
        return { version: 1, records: rows.concat(added) }
      })
    }
    return { added: added.length, skipped: records.length - added.length }
  }

  return Object.freeze({ list, collect, importOne })
}
