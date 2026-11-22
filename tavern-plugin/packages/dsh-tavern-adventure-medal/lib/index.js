// dsh-tavern-adventure-medal —— 宿主侧（Node）
// ============================================================================
// 旧版奖牌的只读接口仍可用。新版在游玩结算时写入全局成就进度。
//
//   1. dsh-tavern-adventure-medal/list
//      列出角色卡 + 每张卡下的游玩存档（来自酒馆的 index.json），
//      以及入口 render 拿到的 sessionId 对应的「当前游玩」。
//
//   2. dsh-tavern-adventure-medal/stats
//      读取指定存档的游玩轮数（与酒馆列表同口径）、正文码点数、角色卡持久上下文字数。
//
//   3. dsh-tavern-adventure-medal/counts
//      按需读出某张卡下每段存档的轮数（同口径），供选择器列表显示。
//
// 读取方式：
//   - 角色卡列表、角色卡内容、历史正文：优先用酒馆公开的
//     ctx.tavern.listCards / readCardRaw / getCard / getHistory。
//   - 存档目录：酒馆没有公开的「列出所有存档」接口，因此只读读取
//     <DSH_HOME>/profile-data/tavern/data/index.json。该文件是酒馆自己的
//     存档索引；成就记录通过酒馆的插件存储 API 单独保存。
//
// 所有 handler 的返回值都必须是可 JSON 序列化的；错误会原样回到浏览器侧。
// ============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'dsh-tavern-adventure-medal'
export const inject = ['tavern']

const NS = 'dsh-tavern-adventure-medal'
const CARD_FIELDS = ['description', 'personality', 'scenario', 'first_mes', 'mes_example']
const ACHIEVEMENTS = [
  { id: 'starter', rounds: 50, title: '佳作' },
  { id: 'bronze', rounds: 100, title: '名篇' },
  { id: 'silver', rounds: 300, title: '传奇' },
  { id: 'gold', rounds: 500, title: '史诗' },
  { id: 'rainbow', rounds: 1000, title: '神话' },
]
const NOTIFICATION_TTL_MS = 8000
const MAX_COVER_BYTES = 150_000

function str(value) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function codePoints(value) {
  return Array.from(str(value)).length
}

function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function fileName(filePath) {
  const text = str(filePath).replace(/\\/g, '/')
  return text.split('/').filter(Boolean).pop() || text
}

function stripExtension(name) {
  return str(name).replace(/\.[a-z0-9]+$/i, '')
}

/** SillyTavern V2/V3 卡的正文在 data 下；V1 卡在顶层。 */
function unwrapCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.kind === 'dsh-tavern-character-workspace' && raw.raw && typeof raw.raw === 'object' && !Array.isArray(raw.raw)) {
    return unwrapCard(raw.raw)
  }
  if ((raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
    return raw.data
  }
  return raw
}

/**
 * 酒馆自己的数据根：与 tavern-plugin/lib/domain/tavern-data.js 的
 * resolveTavernDataRoot 保持一致：<DSH_HOME>/profile-data/tavern/data。
 * 如果 profile 的 package.json 里记了 dshTavern.dataRoot，优先用它。
 */
function resolveDataRoot() {
  const home = process.env.DSH_HOME || process.env.DSH_TAVERN_CLI_HOME || process.env.DSH_TAVERN_LEGACY_DSH_HOME
  const candidates = []

  if (home) {
    try {
      const profilePackage = JSON.parse(readFileSync(path.join(home, 'profiles', 'tavern', 'package.json'), 'utf8'))
      const configured = profilePackage?.dshTavern?.dataRoot
      if (typeof configured === 'string' && configured.trim()) candidates.push(path.resolve(configured))
    } catch {
      // 没有 profile 包或读不到时继续用默认路径。
    }
    candidates.push(path.join(path.resolve(home), 'profile-data', 'tavern', 'data'))
  }

  candidates.push(path.join(os.homedir(), '.dsh', 'profile-data', 'tavern', 'data'))

  for (const dir of candidates) {
    try {
      if (existsSync(path.join(dir, 'index.json'))) return dir
    } catch {
      // 继续试下一个候选。
    }
  }
  return candidates[0] || path.join(os.homedir(), '.dsh', 'profile-data', 'tavern', 'data')
}

async function readIndex(dataRoot) {
  const file = path.join(dataRoot, 'index.json')
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await readFile(file, 'utf8')
      const parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
      return Array.isArray(parsed?.chats) ? parsed.chats : []
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  throw Object.assign(new Error('酒馆的游玩记录暂时打不开'), {
    code: 'ADVENTURE_MEDAL_INDEX',
    cause: lastError,
  })
}

/**
 * 酒馆的 chat 存储是内容寻址的块存储，公开的 getHistory 只返回 DSH 会话里
 * 「最近已结算」的那一段，老存档可能只读到 27 轮。为了拿到存档里真正的
 * AI 消息总数，这里只读复用酒馆自己的 chat-journal-store（同一份只读解码器），
 * 不自己猜块格式，也不写入任何文件。
 */
function resolveAppSource(dataRoot) {
  const home = path.resolve(dataRoot, '..', '..', '..')
  const candidates = []
  try {
    const pkg = JSON.parse(readFileSync(path.join(home, 'profiles', 'tavern', 'package.json'), 'utf8'))
    const source = pkg?.dshTavern?.source
    if (typeof source === 'string' && source.trim()) candidates.push(path.resolve(source))
  } catch {
    // profile 包读不到时继续试默认位置。
  }
  candidates.push(path.join(home, 'apps', 'dsh-tavern'))
  return candidates.find(dir => existsSync(path.join(dir, 'tavern-plugin', 'lib', 'domain', 'chat-journal-store.js'))) || ''
}

const chatStorePromises = new Map()
const fullChatCache = new Map()

async function getChatStore(dataRoot) {
  if (chatStorePromises.has(dataRoot)) return await chatStorePromises.get(dataRoot)
  const promise = (async () => {
    const source = resolveAppSource(dataRoot)
    if (!source) return null
    const storeUrl = pathToFileURL(path.join(source, 'tavern-plugin', 'lib', 'domain', 'chat-journal-store.js')).href
    const profileUrl = pathToFileURL(path.join(source, 'tavern-plugin', 'lib', 'profile-data-store.js')).href
    const [storeModule, profileModule] = await Promise.all([import(storeUrl), import(profileUrl)])
    if (typeof storeModule.createChatJournalStore !== 'function' || typeof profileModule.createProfileDataStore !== 'function') return null
    return storeModule.createChatJournalStore({
      dataRoot,
      legacyData: profileModule.createProfileDataStore({ dataRoot }),
      newConversations: true,
      backgroundSnapshots: false,
      migrateLegacy: false,
      logger: console,
    })
  })().catch(() => null)
  chatStorePromises.set(dataRoot, promise)
  return await promise
}

async function readFullChat(dataRoot, chatId, { fresh = false } = {}) {
  const id = str(chatId)
  if (!id) return null
  const key = dataRoot + '\u0000' + id
  const cached = fullChatCache.get(key)
  if (!fresh && cached && Date.now() - cached.at < 60000) return cached.chat
  const store = await getChatStore(dataRoot)
  if (!store || typeof store.read !== 'function') return null
  const chat = await store.read(id)
  if (!chat) return null
  fullChatCache.set(key, { at: Date.now(), chat })
  if (fullChatCache.size > 64) fullChatCache.delete(fullChatCache.keys().next().value)
  return chat
}

function assistantCountOf(chat) {
  if (!Array.isArray(chat?.messages)) return 0
  return chat.messages.filter(message => message && message.role === 'assistant').length
}

/**
 * 酒馆自己的轮数口径（与 tavern-plugin/lib/domain/tavern-conversation-registry.js 一致）：
 * 最大轮次编号减去开场白占用的那一轮。回退 / 重说会让编号出现空洞，
 * 所以这个数会大于「实际存在的 AI 楼层数」——酒馆列表显示的正是这个数。
 */
function tavernTurnsOf(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  if (!messages.length) return { turnCount: 0, maxTurn: 0, floors: 0 }
  let maxTurn = 0
  let floors = 0
  for (const message of messages) {
    if (!message || message.role !== 'assistant') continue
    floors += 1
    const turn = Number(message.turn)
    if (Number.isFinite(turn) && turn > maxTurn) maxTurn = turn
  }
  const greeting = messages[0] && messages[0].role === 'assistant' ? 1 : 0
  const turnCount = maxTurn > 0 ? Math.max(1, maxTurn - greeting) : floors
  return { turnCount, maxTurn, floors }
}

/**
 * 显示用轮数：只要 index.json 里有 preview.turnCount（哪怕是 0），就用酒馆自己算好的这个数，
 * 这样插件与酒馆列表永远是同一个数；老存档完全没有 preview 时才按酒馆公式现算。
 */
function displayTurns(chat, preview) {
  const value = preview && typeof preview === 'object' ? preview.turnCount : undefined
  const n = Number(value)
  if (Number.isFinite(n)) return { turnCount: Math.max(0, Math.round(n)), source: 'index' }
  return { turnCount: tavernTurnsOf(chat).turnCount, source: 'computed' }
}

/**
 * 酒馆的会话列表会跳过 API 测试会话：sessionId 形如 test-<uuid>，
 * 且 automation/<sessionId>.json 的 owner 就是它自己。插件照抄这条规则，
 * 免得把测试残留的存档混进玩家的游玩记录。
 */
const AUTOMATION_SESSION_ID = /^test-[0-9a-f-]{36}$/i

async function isAutomationTestChat(dataRoot, chat) {
  const sessionId = str(chat?.sessionId)
  if (!AUTOMATION_SESSION_ID.test(sessionId)) return false
  try {
    const text = await readFile(path.join(dataRoot, 'automation', sessionId + '.json'), 'utf8')
    const owner = JSON.parse(text.replace(/^\uFEFF/, ''))
    return str(owner?.sessionId) === sessionId
  } catch {
    return false
  }
}

function contextCharsOf(chat) {
  if (!Array.isArray(chat?.messages)) return 0
  return chat.messages.reduce((total, message) => {
    return total + codePoints(message?.sourceText ?? message?.text)
  }, 0)
}

function previewOf(chat) {
  const preview = chat?.preview && typeof chat.preview === 'object' ? chat.preview : {}
  const raw = str(preview.replyText) || str(preview.openingText) || str(preview.userText)
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function lastPlayedOf(chat) {
  return safeNumber(chat?.lastOpenedAt) || safeNumber(chat?.updatedAt) || safeNumber(chat?.createdAt)
}

function chatSummary(chat, cardName) {
  const name = str(chat?.title) || str(cardName) || '未命名对话'
  const turns = displayTurns(chat, chat?.preview)
  return {
    chatId: str(chat?.id),
    sessionId: str(chat?.sessionId),
    title: name,
    cardName: str(cardName) || str(chat?.cardName) || '未命名角色',
    turnCount: turns.turnCount,
    turnCountExact: false,
    turnCountSource: turns.source,
    messageCount: Math.max(0, Math.round(safeNumber(chat?.preview?.messageCount))),
    lastOpenedAt: lastPlayedOf(chat),
    updatedAt: safeNumber(chat?.updatedAt),
    createdAt: safeNumber(chat?.createdAt),
    previewText: previewOf(chat),
  }
}

/** 角色卡 + 每张卡下的游玩存档；只包含 story/script，不含卡片工作台。 */
async function listPayload(tavern, sessionId) {
  const dataRoot = resolveDataRoot()
  const chats = await readIndex(dataRoot)
  let cards = []
  try {
    cards = await tavern.listCards()
  } catch {
    cards = []
  }
  if (!Array.isArray(cards)) cards = []

  const cardById = new Map()
  for (const card of cards) {
    if (card && typeof card.id === 'string') cardById.set(card.id, card)
  }

  const groups = new Map()
  const ensureGroup = (cardPath, cardName) => {
    if (!groups.has(cardPath)) {
      const card = cardById.get(cardPath)
        || cards.find(item => item && (item.fileName === fileName(cardPath) || item.name === cardName))
      groups.set(cardPath, {
        id: cardPath,
        name: str(card?.name) || str(cardName) || stripExtension(fileName(cardPath)) || '未命名角色',
        imageUrl: str(card?.imageUrl),
        fileName: str(card?.fileName) || fileName(cardPath),
        missing: !card,
        chats: [],
      })
    }
    return groups.get(cardPath)
  }

  for (const chat of chats) {
    if (!chat || typeof chat !== 'object') continue
    const mode = str(chat.mode) || 'story'
    if (mode === 'card') continue
    const cardPath = str(chat.cardPath)
    if (!cardPath) continue
    if (await isAutomationTestChat(dataRoot, chat)) continue
    const group = ensureGroup(cardPath, chat.cardName)
    group.chats.push(chatSummary(chat, group.name))
  }

  // 没有游玩存档的卡也列出来，选择器里显示「暂无存档」。
  for (const card of cards) {
    if (!card || typeof card.id !== 'string' || !card.id) continue
    if (!groups.has(card.id)) {
      groups.set(card.id, {
        id: card.id,
        name: str(card.name) || stripExtension(fileName(card.id)) || '未命名角色',
        imageUrl: str(card.imageUrl),
        fileName: str(card.fileName) || fileName(card.id),
        missing: false,
        chats: [],
      })
    }
  }

  const list = Array.from(groups.values()).map(group => {
    group.chats.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.title.localeCompare(b.title, 'zh'))
    return {
      ...group,
      lastPlayedAt: group.chats.reduce((max, chat) => Math.max(max, chat.lastOpenedAt), 0),
      chatCount: group.chats.length,
    }
  })
  list.sort((a, b) => {
    const aHas = a.chats.length > 0 ? 1 : 0
    const bHas = b.chats.length > 0 ? 1 : 0
    return bHas - aHas || b.lastPlayedAt - a.lastPlayedAt || a.name.localeCompare(b.name, 'zh')
  })

  const currentChat = chats.find(chat => str(chat?.sessionId) === str(sessionId) && str(chat?.mode) !== 'card' && str(chat?.cardPath))
  let current = null
  if (currentChat && !(await isAutomationTestChat(dataRoot, currentChat))) {
    const group = list.find(item => item.id === str(currentChat.cardPath))
    current = {
      ...chatSummary(currentChat, group?.name || currentChat.cardName),
      cardId: str(currentChat.cardPath),
      cardName: group?.name || str(currentChat.cardName) || '未命名角色',
    }
    try {
      const full = await readFullChat(dataRoot, str(currentChat.id))
      if (full) {
        current.turnCount = assistantCountOf(full)
        current.messageCount = Array.isArray(full.messages) ? full.messages.length : current.messageCount
        current.turnCountExact = true
      }
    } catch {
      // 读不到完整 chat 时保留 index.json 的预览值。
    }
  }

  return { cards: list, current }
}

/** 选中一张卡后，按需读出这张卡下每段存档的真实 AI 消息数。 */
async function countsPayload(args) {
  const dataRoot = resolveDataRoot()
  const chats = await readIndex(dataRoot)
  const ids = Array.isArray(args?.chatIds) ? args.chatIds.map(str).filter(Boolean).slice(0, 50) : []
  const result = {}
  let cursor = 0
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor]
      cursor += 1
      const chat = chats.find(item => str(item?.id) === id)
      if (!chat) continue
      if (await isAutomationTestChat(dataRoot, chat)) continue
      try {
        const full = await readFullChat(dataRoot, id)
        if (full) {
          const turns = displayTurns(full, chat?.preview)
          result[id] = {
            turnCount: turns.turnCount,
            turnCountSource: turns.source,
            messageCount: Array.isArray(full.messages) ? full.messages.length : 0,
          }
        }
      } catch {
        // 单份读不到不影响其他存档。
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker))
  return result
}

async function readCardForChat(tavern, chat) {
  const gameId = str(chat?.sessionId)
  let raw = null
  if (gameId) {
    try {
      raw = await tavern.getCard({ gameId })
    } catch {
      raw = null
    }
  }
  if (!raw && str(chat?.cardPath)) {
    try {
      raw = await tavern.readCardRaw({ card: str(chat.cardPath) })
    } catch {
      raw = null
    }
  }
  return unwrapCard(raw)
}

/**
 * 读取这局的游玩统计。
 * - 游玩轮数：与酒馆列表同一个口径（index.json 的 preview.turnCount；没有时按
 *   酒馆公式「最大轮次编号 − 开场白」现算），所以两边不会出现两个数。
 * - 总字数：所有消息正文（sourceText ?? text）的码点总数，AI 与玩家都算。
 * - 持久上下文（角色卡五字段码点）仍然返回，但奖牌上不再展示。
 */
async function statsPayload(tavern, args) {
  const sessionId = str(args?.sessionId)
  const chatId = str(args?.chatId)
  const dataRoot = resolveDataRoot()
  const chats = await readIndex(dataRoot)
  const chat = chats.find(item => str(item?.id) === chatId) || chats.find(item => str(item?.sessionId) === sessionId)
  if (!chat) {
    throw Object.assign(new Error('没有找到这个游玩存档'), { code: 'ADVENTURE_MEDAL_NOT_FOUND' })
  }

  const gameId = str(chat.sessionId) || sessionId
  let fullChat = null
  try {
    fullChat = await readFullChat(dataRoot, str(chat.id))
  } catch {
    fullChat = null
  }
  const cardChat = fullChat
    ? {
        ...chat,
        cardPath: str(fullChat.cardPath) || str(chat.cardPath),
        cardName: str(fullChat.cardName) || str(chat.cardName),
      }
    : chat
  const card = await readCardForChat(tavern, cardChat)
  const cardName = str(card?.name) || str(fullChat?.cardName) || str(chat.cardName) || stripExtension(fileName(cardChat.cardPath)) || '未命名角色'

  const turns = displayTurns(fullChat || chat, chat?.preview)
  let turnCount = turns.turnCount
  let contextChars = 0
  let messageCount = Math.max(0, Math.round(safeNumber(chat?.preview?.messageCount)))
  let warning = ''

  if (fullChat) {
    messageCount = Array.isArray(fullChat.messages) ? fullChat.messages.length : messageCount
    contextChars = contextCharsOf(fullChat)
  } else {
    const expectedTurns = Math.max(0, Math.round(safeNumber(chat?.preview?.turnCount)))
    let history = []
    let historyError = null
    if (gameId) {
      try {
        const cap = Math.max(expectedTurns, 1)
        let from = 1
        while (from <= cap) {
          const to = Math.min(cap, from + 49)
          const chunk = await tavern.getHistory({ gameId, from, to })
          if (!Array.isArray(chunk) || chunk.length === 0) break
          history.push(...chunk)
          if (chunk.length < to - from + 1) break
          from += 50
        }
      } catch (error) {
        historyError = error
      }
    }

    if (historyError && history.length === 0 && expectedTurns > 0) {
      throw Object.assign(new Error('暂时读不到这局的对话正文'), {
        code: 'ADVENTURE_MEDAL_HISTORY',
        cause: historyError,
      })
    }

    turnCount = expectedTurns > 0 ? expectedTurns : history.length
    messageCount = history.length > 0 ? history.length : messageCount
    contextChars = history.reduce((total, turn) => {
      return total + codePoints(turn?.rawText ?? turn?.text) + codePoints(turn?.input)
    }, 0)
    if (historyError && history.length > 0) warning = '部分正文暂时读不出来，奖牌先按已读到的部分计算。'
    else if (!historyError && expectedTurns > history.length + 5) warning = '完整存档暂时读不出来，奖牌先按最近一段计算。'
  }

  let persistentChars = null
  if (card) {
    persistentChars = CARD_FIELDS.reduce((total, field) => total + codePoints(card[field]), 0)
  }

  return {
    chatId: str(chat.id),
    sessionId: gameId,
    cardId: str(cardChat.cardPath),
    cardName,
    turnCount,
    turnCountSource: turns.source,
    contextChars,
    messageCount,
    persistentChars,
    createdAt: safeNumber(chat.createdAt),
    lastOpenedAt: lastPlayedOf(chat),
    updatedAt: safeNumber(chat.updatedAt),
    title: str(fullChat?.title) || str(chat.title) || cardName,
    previewText: previewOf(chat),
    warning,
  }
}

function achievementChat(row) {
  return Boolean(row?.sessionId) && ['story', 'script'].includes(row.mode || 'story') && row.requestMode !== 'sillytavern'
}

function createAchievementSnapshot(dataRoot) {
  let coverReader
  async function openCoverReader() {
    const source = resolveAppSource(dataRoot)
    if (!source) return null
    const resourcesFile = path.join(source, 'tavern-plugin', 'lib', 'domain', 'file-resources.js')
    const { createFileResourceStore } = await import(pathToFileURL(resourcesFile).href)
    const resources = createFileResourceStore({ dataRoot })
    const sharp = createRequire(resourcesFile)('sharp')
    return async cardPath => {
      const cover = await resources.cardImagePreview(cardPath)
      if (!cover) return undefined
      const bytes = await sharp(await cover.read(), { limitInputPixels: 40_000_000 })
        .resize({ width: 480, height: 720, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toBuffer()
      return bytes.length <= MAX_COVER_BYTES ? 'data:image/webp;base64,' + bytes.toString('base64') : undefined
    }
  }

  async function readCover(cardPath) {
    if (!cardPath) return undefined
    coverReader ??= openCoverReader().catch(() => null)
    try { return await (await coverReader)?.(cardPath) } catch { return undefined }
  }

  return async (row, fullChat = readAchievementChat(dataRoot, row)) => {
    const cardPath = str(row.cardPath)
    const cardName = str(row.cardName) || stripExtension(fileName(cardPath))
    const [cover, chat] = await Promise.all([readCover(cardPath), fullChat])
    const startedAt = safeNumber(row.createdAt) || safeNumber(chat?.createdAt)
    const hasTurns = Number.isFinite(row.preview?.turnCount) || Array.isArray(chat?.messages)
    return {
      ...(cardName ? { cardName } : {}),
      ...(cover ? { cover } : {}),
      ...(startedAt > 0 && startedAt <= 8.64e15 ? { startedAt } : {}),
      ...(hasTurns ? { turnCount: displayTurns(chat ?? row, row.preview).turnCount } : {}),
      ...(Array.isArray(chat?.messages) ? { contextChars: contextCharsOf(chat) } : {}),
    }
  }
}

function readAchievementChat(dataRoot, row) {
  // Stats reads may have cached the chat before this turn was saved.
  return readFullChat(dataRoot, row.id, { fresh: true }).catch(() => null)
}

function createAchievementRecorder(tavern, dataRoot, snapshot) {
  let ledger
  let tail = Promise.resolve()
  const notifications = new Map()

  function serial(work) {
    const result = tail.then(work)
    tail = result.catch(() => {})
    return result
  }

  async function highestIndexedRounds(highest) {
    const index = await readIndex(dataRoot).catch(error => {
      if (error.cause?.code === 'ENOENT') return []
      throw error
    })
    for (const row of index) {
      if (!achievementChat(row) || !(row.preview?.turnCount > highest) || await isAutomationTestChat(dataRoot, row)) continue
      highest = displayTurns(row, row.preview).turnCount
    }
    return highest
  }

  async function loadLedger() {
    if (ledger) return ledger
    const stored = await tavern.readPluginData()
    if (stored != null && (stored.version !== 1 || !Array.isArray(stored.achievements))) throw new Error('无法读取该版本的成就库')
    const records = new Map((stored?.achievements || []).filter(tier => tier?.id).map(tier => [tier.id, tier]))
    const missing = ACHIEVEMENTS.filter(tier => !records.has(tier.id))
    let highest = Math.max(0, ...ACHIEVEMENTS.filter(tier => records.get(tier.id)?.earned === true).map(tier => tier.rounds))
    if (missing.some(tier => tier.rounds > highest)) highest = await highestIndexedRounds(highest)
    const achievements = ACHIEVEMENTS.map(tier => {
      const record = records.get(tier.id)
      records.delete(tier.id)
      return record ? { ...record, ...tier } : { ...tier, earned: highest >= tier.rounds, unlockedAt: null }
    }).concat([...records.values()])
    const updated = { ...stored, version: 1, achievements }
    if (missing.length) await tavern.savePluginData({ data: updated })
    ledger = updated
    return ledger
  }

  function settle(event) {
    if (event.greeting || !event.gameId) return
    return serial(async () => {
      const current = await loadLedger()
      if (current.achievements.every(tier => tier.earned)) return
      const row = (await readIndex(dataRoot)).find(chat => chat?.sessionId === event.gameId)
      if (!achievementChat(row) || await isAutomationTestChat(dataRoot, row)) return
      const fullChat = row.preview?.turnCount === undefined ? await readAchievementChat(dataRoot, row) : undefined
      const { turnCount } = displayTurns(fullChat ?? row, row.preview)
      const qualifies = tier => !tier.earned && turnCount >= tier.rounds
      if (!current.achievements.some(qualifies)) return
      const unlock = { earned: true, unlockedAt: Date.now(), ...await snapshot(row, fullChat) }
      const achievements = current.achievements.map(tier => qualifies(tier) ? { ...tier, ...unlock } : tier)
      const newest = achievements.findLast((tier, i) => tier !== current.achievements[i])

      const saved = { version: 1, achievements }
      await tavern.savePluginData({ data: saved })
      ledger = saved
      notifications.set(event.gameId, { tier: newest, expiresAt: Date.now() + NOTIFICATION_TTL_MS })
      await tavern.publishState({ gameId: event.gameId, name: 'achievement', data: { id: newest.id } })
    })
  }

  function claim({ gameId, id } = {}) {
    const pending = notifications.get(gameId)
    if (!pending || pending.tier.id !== id) return null
    notifications.delete(gameId)
    return Date.now() < pending.expiresAt ? pending.tier : null
  }

  return { initialize: () => serial(loadLedger), settle, claim }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  if (!tavern || typeof tavern.handle !== 'function') return
  if (typeof tavern.apiVersion === 'number' && tavern.apiVersion < 2) return

  ctx.effect(
    () => tavern.handle(NS + '/list', async args => await listPayload(tavern, str(args?.sessionId))),
    'adventure-medal: list handler',
  )
  ctx.effect(
    () => tavern.handle(NS + '/stats', async args => await statsPayload(tavern, args)),
    'adventure-medal: stats handler',
  )
  ctx.effect(
    () => tavern.handle(NS + '/counts', async args => await countsPayload(args)),
    'adventure-medal: counts handler',
  )
  if (['onTurnSettled', 'readPluginData', 'savePluginData', 'publishState'].some(method => typeof tavern[method] !== 'function')) return
  const dataRoot = resolveDataRoot()
  const snapshot = createAchievementSnapshot(dataRoot)
  const achievements = createAchievementRecorder(tavern, dataRoot, snapshot)
  ctx.effect(
    () => tavern.handle(NS + '/claim-achievement', achievements.claim),
    'adventure-medal: claim achievement notification',
  )
  ctx.effect(() => {
    void achievements.initialize().catch(error => console.warn('[adventure-medal] 成就库初始化失败:', error.message))
    return tavern.onTurnSettled(achievements.settle)
  }, 'adventure-medal: unlock achievements')
}
