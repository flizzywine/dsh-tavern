// Run only against the isolated documentation fixture, never a user Profile.
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createUserPreferenceProfile } from '../../tavern-plugin/lib/domain/user-preference-profile.js'
const root = process.argv[2]
if (!root?.startsWith('/tmp/tavern-doc-screenshots.') || !root.endsWith('/home/profile-data/tavern/data')) throw Error('An isolated screenshot Profile is required')
const profile = createUserPreferenceProfile({ store: createProfileDataStore({ dataRoot: root }) })
const draft = await profile.saveDraft({
  summary: '【公开虚构样例，不是真实用户画像】\n偏好温暖的日常探索和轻悬疑；喜欢由玩家决定行动。人物可以有分歧，但不强制冲突或突然跳过重要情节。对白简洁，环境描写具体。',
  injectionText: '样例偏好：温暖日常、轻悬疑、简洁对白；保留玩家选择，不强迫情感走向。',
  rawAnswers: [{ question: '这次想体验什么样的故事？', answer: '轻松的小镇探索，带一点点谜题。' }, { question: '希望故事怎样推进？', answer: '一步一步来，让我自己决定下一步行动。' }],
  dimensions: [{ id: 'tone', label: '故事基调', conclusion: '温暖日常与轻悬疑。', confidence: 'confirmed', evidence: '原创问答样例：轻松的小镇探索。' }, { id: 'agency', label: '玩家主动性', conclusion: '保留玩家决定行动的空间。', confidence: 'confirmed', evidence: '原创问答样例：自己决定下一步。' }],
  uncertainties: ['尚未讨论长篇主线与短篇单元故事的偏好。'],
})
if (process.argv.includes('--confirmed')) await profile.confirm({ confirmation: '确认保存用户画像', draftRevision: draft.draft.revision })
console.log('Original fictional preference fixture saved; no real user answers were used.')
