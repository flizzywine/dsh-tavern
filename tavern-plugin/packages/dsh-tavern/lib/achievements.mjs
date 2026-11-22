import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const RECORD_PATH = ['profile-data', 'tavern', 'data', 'plugin-data', 'dsh-tavern-adventure-medal.json']
const TIER_TITLES = new Map([
  ['bronze', '渐入佳境'],
  ['silver', '酒馆熟客'],
  ['gold', '故事收藏家'],
  ['rainbow', '千轮留名'],
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
  return saved.achievements.filter(tier => typeof tier?.id === 'string' && typeof tier.title === 'string'
    && Number.isSafeInteger(tier.rounds) && tier.rounds > 0).map(tier => ({
    id: tier.id,
    title: TIER_TITLES.get(tier.id) ?? tier.title,
    rounds: tier.rounds,
    earned: tier.earned === true,
    unlockedAt: tier.earned === true && Number.isSafeInteger(tier.unlockedAt) && tier.unlockedAt > 0
      && tier.unlockedAt <= 8.64e15 ? tier.unlockedAt : null,
    ...(tier.earned === true && typeof tier.cardName === 'string' ? { cardName: tier.cardName } : {}),
    ...(tier.earned === true && Number.isSafeInteger(tier.contextChars) && tier.contextChars >= 0
      ? { contextChars: tier.contextChars } : {}),
    ...(tier.earned === true && Number.isSafeInteger(tier.turnCount) && tier.turnCount >= 0
      ? { turnCount: tier.turnCount } : {}),
    ...(tier.earned === true && Number.isSafeInteger(tier.startedAt) && tier.startedAt > 0 && tier.startedAt <= 8.64e15
      ? { startedAt: tier.startedAt } : {}),
    ...(tier.earned === true && typeof tier.cover === 'string' && tier.cover.length <= 200_023
      && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(tier.cover) ? { cover: tier.cover } : {}),
  }))
}
