import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DATA_DIR = ['profile-data', 'tavern', 'data']
const RECORD_FILES = ['dsh-tavern-achievements.json', 'dsh-tavern-adventure-medal.json']
const TIER_TITLES = new Map([
  ['starter', '佳作'],
  ['bronze', '名篇'],
  ['silver', '传奇'],
  ['gold', '史诗'],
  ['rainbow', '神话'],
])

async function readChatIndex(dataRoot) {
  try {
    const raw = await readFile(join(dataRoot, 'index.json'), 'utf8')
    const { chats } = JSON.parse(raw.replace(/^\uFEFF/, ''))
    return Array.isArray(chats) ? chats.filter(chat => typeof chat?.cardPath === 'string' && chat.cardPath
      && ['story', 'script'].includes(chat.mode || 'story') && chat.requestMode !== 'sillytavern') : []
  } catch {
    return []
  }
}

function cardPathOf(tier, chats) {
  // A saved chat follows resource renames. The recorded path also works if the save was removed.
  const linked = tier.chatId && chats.find(chat => chat.id === tier.chatId)
  if (linked) return linked.cardPath
  if (typeof tier.cardPath === 'string' && tier.cardPath) return tier.cardPath
  if (typeof tier.cardName !== 'string' || !tier.cardName) return undefined

  const named = chats.filter(chat => chat.cardName === tier.cardName && !(chat.createdAt > tier.unlockedAt))
  const dated = tier.startedAt > 0 ? named.filter(chat => chat.createdAt === tier.startedAt) : []
  const paths = new Set((dated.length ? dated : named).map(chat => chat.cardPath))
  return paths.size === 1 ? paths.values().next().value : undefined
}

async function currentCovers(dataRoot, tiers, sourceRoot) {
  if (!tiers.some(tier => tier.cardPath || tier.cardName)) return () => undefined
  // The launcher can be installed separately in the original Profile.
  const coverModule = sourceRoot
    ? pathToFileURL(join(sourceRoot, 'tavern-plugin', 'lib', 'domain', 'achievement-cover.js'))
    : new URL('../../../lib/domain/achievement-cover.js', import.meta.url)
  const { createAchievementCoverReader } = await import(coverModule.href).catch(() => ({}))
  if (typeof createAchievementCoverReader !== 'function') return () => undefined
  const readCover = createAchievementCoverReader(dataRoot)
  const chats = await readChatIndex(dataRoot)
  const covers = new Map()
  return tier => {
    const path = cardPathOf(tier, chats)
    if (!path) return undefined
    if (!covers.has(path)) covers.set(path, readCover(path))
    return covers.get(path)
  }
}

export async function readAchievementLibrary(home, { sourceRoot } = {}) {
  const dataRoot = join(home, ...DATA_DIR)
  let raw
  for (const file of RECORD_FILES) {
    try {
      raw = await readFile(join(dataRoot, 'plugin-data', file), 'utf8')
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (raw === undefined) return []
  const saved = JSON.parse(raw)
  if (saved?.version !== 1 || !Array.isArray(saved.achievements) || saved.achievements.length > 100) {
    throw new Error('成就库格式无效')
  }
  // The original Profile may read the ledger before Tavern has migrated old grants.
  const tiers = saved.achievements.filter(tier => tier?.earned === true && typeof tier.id === 'string' && typeof tier.title === 'string'
    && Number.isSafeInteger(tier.rounds) && tier.rounds > 0
    && Number.isSafeInteger(tier.unlockedAt) && tier.unlockedAt > 0 && tier.unlockedAt <= 8.64e15)
  const coverOf = await currentCovers(dataRoot, tiers, sourceRoot)
  return await Promise.all(tiers.map(async tier => {
    const snapshot = typeof tier.cover === 'string' && tier.cover.length <= 200_023
      && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(tier.cover) ? tier.cover : undefined
    const cover = await coverOf(tier) ?? snapshot
    return {
      id: tier.id,
      title: TIER_TITLES.get(tier.id) ?? tier.title,
      rounds: tier.rounds,
      earned: true,
      unlockedAt: tier.unlockedAt,
      ...(typeof tier.cardName === 'string' ? { cardName: tier.cardName } : {}),
      ...(Number.isSafeInteger(tier.contextChars) && tier.contextChars >= 0
        ? { contextChars: tier.contextChars } : {}),
      ...(Number.isSafeInteger(tier.turnCount) && tier.turnCount >= 0
        ? { turnCount: tier.turnCount } : {}),
      ...(Number.isSafeInteger(tier.startedAt) && tier.startedAt > 0 && tier.startedAt <= 8.64e15
        ? { startedAt: tier.startedAt } : {}),
      ...(cover ? { cover } : {}),
    }
  }))
}
