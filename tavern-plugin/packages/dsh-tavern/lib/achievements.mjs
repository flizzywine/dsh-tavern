import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const RECORD_PATH = ['profile-data', 'tavern', 'data', 'plugin-data', 'dsh-tavern-adventure-medal.json']
const TIER_TITLES = new Map([
  ['starter', '佳作'],
  ['bronze', '名篇'],
  ['silver', '传奇'],
  ['gold', '史诗'],
  ['rainbow', '神话'],
])

// The launcher also runs in the original Profile, where the Tavern plugin is absent.
export async function readAchievementLibrary(home) {
  const file = join(home, ...RECORD_PATH)
  let raw
  try { raw = await readFile(file, 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const saved = JSON.parse(raw)
  if (saved?.version !== 1 || !Array.isArray(saved.achievements) || saved.achievements.length > 100) {
    throw new Error('成就库格式无效')
  }
  // The original Profile may read the ledger before Tavern has migrated old grants.
  return saved.achievements.filter(tier => tier?.earned === true && typeof tier.id === 'string' && typeof tier.title === 'string'
    && Number.isSafeInteger(tier.rounds) && tier.rounds > 0
    && Number.isSafeInteger(tier.unlockedAt) && tier.unlockedAt > 0 && tier.unlockedAt <= 8.64e15).map(tier => ({
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
    ...(typeof tier.cover === 'string' && tier.cover.length <= 200_023
      && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(tier.cover) ? { cover: tier.cover } : {}),
  }))
}
