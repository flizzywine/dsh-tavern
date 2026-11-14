import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return fallback }
}

// Read only the lightweight conversation index; the selected story is read via Tavern's turn API.
export async function listDesignGames(dataRoot) {
  const [index, links] = await Promise.all([
    readJson(join(dataRoot, 'index.json'), {}), readJson(join(dataRoot, 'sessions.json'), {}),
  ])
  const rows = Array.isArray(index?.chats) ? index.chats : []
  const sessionForChat = new Map(Object.entries(links || {}).map(([session, chat]) => [chat, session]))
  const sessions = new Map()
  for (const row of rows) {
    const id = String(row?.sessionId || sessionForChat.get(row?.id) || '')
    if (!id || row?.requestMode === 'sillytavern' || ['card', 'workbench'].includes(row?.mode)) continue
    sessions.set(id, { id, title: String(row.title || row.cardName || '未命名游玩'),
      cardName: String(row.cardName || ''), at: Number(row.lastOpenedAt || row.updatedAt || row.createdAt) || 0 })
  }
  return [...sessions.values()].sort((a, b) => b.at - a.at).slice(0, 100)
}

export async function resolveDesignSources({ dataRoot, tavern, sessionId, sources }) {
  const parts = []
  const game = String(sessionId || '').trim()
  const count = Number(sources?.recentTurns || 0)
  if (!Number.isSafeInteger(count) || count < 0 || count > 20) throw new Error('最近轮数需为 1–20')
  let turn = 0
  if (sources?.card || count) {
    if (!game || typeof tavern?.getTurnState !== 'function') throw new Error('请选择有游玩记录的对话')
    const state = await tavern.getTurnState({ gameId: game })
    turn = Number(state?.turn) || 0
    if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('所选对话还没有可读取的正文')
    if (state?.busy || state?.settled === false) throw new Error('请等待当前正文生成与结算完成后再读取')
  }
  if (sources?.card) {
    if (typeof tavern?.getCardContext !== 'function') throw new Error('当前 Tavern 不能读取卡片设定')
    const card = await tavern.getCardContext({ gameId: game, turn })
    if (!card) throw new Error('无法读取所选对话的卡片设定')
    const content = [card.description, card.personality, card.scenario].filter(value => typeof value === 'string' && value.trim()).join('\n')
    if (!content) throw new Error('所选对话的卡片没有可用的设定')
    parts.push('【卡片设定】\n' + content.slice(0, 10000))
  }
  if (sources?.worldbook) {
    const card = String(sources.worldbookCard || '')
    if (!/^cards\/[^/\\]+\.json$/i.test(card) || basename(card) === '.' || basename(card) === '..') throw new Error('请选择要读取世界书的卡片')
    const payload = typeof tavern?.readCardRaw === 'function'
      ? await tavern.readCardRaw({ card })
      : await readJson(join(dataRoot, 'resources', card), null)
    if (!payload) throw new Error('读取选定卡片失败')
    const raw = payload.raw ?? payload
    const book = raw.character_book ?? raw.characterBook ?? raw.data?.character_book
    const entries = Array.isArray(book?.entries) ? book.entries
      : book?.entries && typeof book.entries === 'object' ? Object.values(book.entries) : []
    const content = entries.filter(entry => entry && entry.enabled !== false && entry.disable !== true && entry.disabled !== true)
      .map(entry => [String(entry.comment || entry.name || '').trim(), String(entry.content || entry.text || '').trim()].filter(Boolean).join('：'))
      .filter(Boolean).join('\n\n').slice(0, 30000)
    if (!content) throw new Error('所选卡片没有可用的世界书条目')
    parts.push('【选定卡片的世界书】\n' + content)
  }
  if (count) {
    if (typeof tavern?.getTurn !== 'function') throw new Error('当前 Tavern 不能读取正文')
    const first = Math.max(1, turn - count + 1)
    const numbers = Array.from({ length: turn - first + 1 }, (_, i) => first + i)
    const turns = await Promise.all(numbers.map(async number => {
      const [snapshot, request] = await Promise.all([
        tavern.getTurn({ gameId: game, turn: number }),
        typeof tavern.getRequestContext === 'function'
          ? tavern.getRequestContext({ gameId: game, turn: number }).catch(() => null) : null,
      ])
      const input = typeof request?.input === 'string' ? request.input.trim().slice(-3000) : ''
      const text = typeof snapshot?.text === 'string' ? snapshot.text.trim().slice(-6000) : ''
      return input || text ? ['第 ' + number + ' 轮：', input ? '玩家：' + input : '', text ? '正文：' + text : ''].filter(Boolean).join('\n') : ''
    }))
    const lines = turns.filter(Boolean)
    if (!lines.length) throw new Error('所选范围内没有可读取的正文')
    parts.push('【最近正文】\n' + lines.join('\n\n').slice(-30000))
  }
  return parts
}
