function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

const UNKNOWN_TURNS = '轮次未知'
const SAVE_EXTENSION = '.dshsave'

function messageOf(error) {
  return str(error && error.message || error) || '未知错误'
}

// The player's title first, then the card. A row must never read "unnamed" when it has a card.
function titleOf(chat) {
  return str(chat && chat.title) || str(chat && chat.cardName) || '未命名对话'
}

function cardNameOf(chat) {
  return str(chat && chat.cardName).trim()
}

/**
 * Dialogs and saves for the transfer page: one `.dshsave` per game, exported and imported through
 * the same services the game itself uses (`exportGameSave` / `importGameSave`). This module only
 * decides which games and how they are named; packing the bundle stays the caller's job.
 */
export function createTransferChats(deps) {
  const { listSessions, readChat, exportSave, importSave, updateChat } = deps

  // A save is one playthrough. A chat in SillyTavern mode is the imported line itself, not a game.
  async function games() {
    const rows = await listSessions()
    const map = new Map()
    for (const chat of Array.isArray(rows) ? rows : []) {
      if (!chat || str(chat.requestMode) === 'sillytavern') continue
      // Card workbench chats are editing space, not a playthrough; they have no save to move.
      if (str(chat.mode) === 'card') continue
      const key = str(chat.id) || str(chat.chatId)
      if (!key) continue
      map.set(key, chat)
    }
    return map
  }

  async function turns(chat) {
    let record
    try { record = await readChat(str(chat.id) || str(chat.chatId)) } catch { return UNKNOWN_TURNS }
    if (!record || !Array.isArray(record.messages)) return UNKNOWN_TURNS
    let count = 0
    for (const message of record.messages) if (message && message.role === 'assistant') count += 1
    return count + ' 轮'
  }

  function metaOf(turnsText, chat) {
    const card = cardNameOf(chat)
    return card ? turnsText + ' · ' + card : turnsText
  }

  // Size stays 0: only exporting knows how big a save really is, so the list does not claim one.
  async function list() {
    const items = []
    for (const [key, chat] of await games()) {
      items.push({ key, title: titleOf(chat), meta: metaOf(await turns(chat), chat), bytes: 0 })
    }
    return items
  }

  function wanted(keys) {
    const picked = new Set()
    for (const key of Array.isArray(keys) ? keys : []) {
      const value = str(key).trim()
      if (value) picked.add(value)
    }
    return [...picked]
  }

  function fileNameOf(exported, title) {
    const name = str(exported && exported.filename).trim()
    if (!name) return title + SAVE_EXTENSION
    return /\.dshsave$/i.test(name) ? name : name + SAVE_EXTENSION
  }

  // One broken save fails loudly instead of quietly missing from the bundle.
  async function collect(keys, options = {}) {
    const map = await games()
    const items = []
    for (const key of wanted(keys)) {
      const chat = map.get(key)
      if (!chat) throw new Error('对话不存在：' + key)
      const title = titleOf(chat)
      let exported
      try {
        exported = await exportSave(chat.sessionId, { images: options.images !== false,
          embedWorldbook: options.embedWorldbook !== false, embedPreset: options.embedPreset !== false })
      }
      catch (error) { throw new Error('导出「' + title + '」失败：' + messageOf(error)) }
      const base64 = str(exported && exported.base64)
      if (!base64) throw new Error('导出「' + title + '」失败：存档内容为空')
      items.push({ key, title, fileName: fileNameOf(exported, title), content: Buffer.from(base64, 'base64') })
    }
    return items
  }

  // A save imported from a bundle remembers its content hash, so the same package twice is a skip.
  async function importedHashes() {
    const hashes = new Set()
    for (const chat of (await games()).values()) {
      let record
      try { record = await readChat(str(chat.id) || str(chat.chatId)) } catch { continue }
      const hash = str(record && record.importedSave && record.importedSave.sourceHash)
      if (hash) hashes.add(hash)
    }
    return hashes
  }

  // Importing decides the new ids and the real title inside the game services, not here.
  async function importOne(args) {
    const title = str(args && args.title) || '未命名对话'
    const given = args && args.content
    const content = Buffer.isBuffer(given) ? given : Buffer.from(given === undefined || given === null ? '' : given)
    let imported
    try { imported = await importSave({ fileB64: content.toString('base64'), latestOnly: args && args.latestOnly === true }) }
    catch (error) { throw new Error('导入「' + title + '」失败：' + messageOf(error)) }
    if (updateChat && imported && imported.chatId && str(args && args.sha256)) {
      try {
        await updateChat(imported.chatId, function (current) {
          return Object.assign({}, current, { importedSave: Object.assign({}, current && current.importedSave, { sourceHash: str(args.sha256) }) })
        }, { source: 'transfer.import' })
      } catch { /* the save is already imported; the hash only helps a later duplicate check */ }
    }
    return {
      chatId: str(imported && imported.chatId),
      sessionId: str(imported && imported.sessionId),
      title: str(imported && imported.title) || title
    }
  }

  return Object.freeze({ list, collect, importOne, importedHashes })
}
