import path from 'node:path'
import { parseChatHistory } from './chat-history-import.js'

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

export function cardNameFromText(text) {
  try {
    const doc = JSON.parse(str(text))
    if (!doc || typeof doc !== 'object') return ''
    return str(
      doc.name ||
      (doc.data && doc.data.name) ||
      (doc.raw && doc.raw.data && doc.raw.data.name) ||
      (doc.raw && doc.raw.name)
    ).trim()
  } catch {
    return ''
  }
}

export function isSillyTavernChatItem(entry, content) {
  const entryStr = str(entry).trim()
  if (/\.jsonl$/i.test(entryStr)) return true
  if (/\.dshsave$/i.test(entryStr)) return false
  if (!content) return false
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(str(content), 'utf8')
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return false
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('{')) return false
  const firstLine = head.split(/\r?\n/, 1)[0]
  try {
    const parsed = JSON.parse(firstLine)
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      ['chat_metadata', 'user_name', 'character_name'].some(key => Object.hasOwn(parsed, key)))
  } catch {
    return false
  }
}

export function inspectSillyTavernChatItem(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : str(content)
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/).find(line => line.trim())
  let header = null
  if (firstLine) {
    try { header = JSON.parse(firstLine) } catch { /* parseChatHistory will report line error */ }
  }
  const parsed = parseChatHistory(text)
  const headerCharName = str(
    header && (
      header.character_name ||
      header.ch_name ||
      (header.chat_metadata && (header.chat_metadata.character_name || header.chat_metadata.ch_name))
    )
  ).trim()
  const assistantName = str(parsed.messages.find(m => m.role === 'assistant' && m.name)?.name).trim()
  const characterName = headerCharName || assistantName
  return {
    text,
    characterName,
    userName: parsed.userName,
    digest: parsed.digest,
    messageCount: parsed.messages.length,
    hasMvu: parsed.hasMvu,
    warnings: parsed.warnings
  }
}

/**
 * Dialogs and saves for the transfer page: one `.dshsave` per game, exported and imported through
 * the same services the game itself uses (`exportGameSave` / `importGameSave`), plus SillyTavern
 * `.jsonl` chat histories packed by the migration helper (`importChatHistoryText`).
 */
export function createTransferChats(deps) {
  const { listSessions, readChat, exportSave, importSave, updateChat, importChatHistory, fileResources } = deps

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
      const digest = str(record && record.importHistory && record.importHistory.digest)
      if (digest) hashes.add(digest)
    }
    return hashes
  }

  async function resolveCardPathForCharacter(characterName, cardPathsByCharacter) {
    const key = str(characterName).trim().toLowerCase()
    if (!key) return ''
    if (cardPathsByCharacter && typeof cardPathsByCharacter.get === 'function') {
      const matched = str(cardPathsByCharacter.get(key)).trim()
      if (matched) return matched
    }
    if (!fileResources || typeof fileResources.list !== 'function') return ''
    let stemFallback = ''
    for (const cardPath of await fileResources.list('card').catch(() => [])) {
      const stem = path.posix.basename(str(cardPath), path.posix.extname(str(cardPath))).toLowerCase()
      if (!stemFallback && stem === key) stemFallback = cardPath
      if (typeof fileResources.readText === 'function') {
        const text = await fileResources.readText(cardPath).catch(() => undefined)
        if (typeof text === 'string' && cardNameFromText(text).toLowerCase() === key) return cardPath
      }
    }
    return stemFallback
  }

  // Importing decides the new ids and the real title inside the game services, not here.
  async function importOne(args) {
    const title = str(args && args.title) || '未命名对话'
    const given = args && args.content
    const content = Buffer.isBuffer(given) ? given : Buffer.from(given === undefined || given === null ? '' : given)
    if (isSillyTavernChatItem(args && args.entry, content)) {
      if (typeof importChatHistory !== 'function') {
        throw new Error('导入「' + title + '」失败：SillyTavern 聊天记录导入服务不可用')
      }
      let inspected
      try {
        inspected = inspectSillyTavernChatItem(content)
      } catch (error) {
        throw new Error('导入「' + title + '」失败：' + messageOf(error))
      }
      const cardPath = str(args && args.cardPath) ||
        await resolveCardPathForCharacter(inspected.characterName, args && args.cardPathsByCharacter)
      if (!cardPath) {
        throw new Error('导入「' + title + '」失败：缺少角色「' + (inspected.characterName || '未知角色') + '」对应的人物卡')
      }
      const fileName = path.posix.basename(str(args && args.entry)) || (title + '.jsonl')
      // 内容指纹随 plan 一起写进新对话：导入服务已经要落盘整档，不必再多读写一遍。
      const saveHash = str(args && args.sha256)
      const input = {
        cardPath,
        text: inspected.text,
        fileName,
        userName: inspected.userName,
        textOnly: Boolean(args && args.textOnly === true),
        ...(saveHash ? { saveHash, saveFormat: 'sillytavern-jsonl' } : {})
      }
      let imported
      try {
        imported = await importChatHistory({ ...input })
      } catch (error) {
        const msg = messageOf(error)
        if (!input.textOnly && /变量结构与人物卡不兼容|无法读取这张 MVU 卡的初始变量/.test(msg)) {
          try {
            imported = await importChatHistory({ ...input, textOnly: true })
          } catch (retryError) {
            throw new Error('导入「' + title + '」失败：' + messageOf(retryError))
          }
        } else {
          throw new Error('导入「' + title + '」失败：' + msg)
        }
      }
      return {
        chatId: str(imported && imported.chatId),
        sessionId: str(imported && imported.sessionId),
        title: str(imported && imported.title) || title,
        digest: inspected.digest
      }
    }
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
