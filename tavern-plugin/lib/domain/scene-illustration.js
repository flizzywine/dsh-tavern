import { createHash } from 'node:crypto'
import { projectAgentContent } from './runtime-content-projection.js'

// A reply's scene target: the key media of that reply is bound to (plugin pictures, the
// stage), so it follows the text version shown and a rewound or rewritten branch.
// (Pictures Tavern itself once drew are no longer kept; image plugins draw them now.)
const hash = value => createHash('sha256').update(value).digest('hex')

export function sceneTarget(chat, turn) {
  turn = Number(turn)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('正文轮次不合法')
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('请先打开游玩对话')
  if(chat.sceneTargets){
    if(chat.sceneTargets[turn])return {...chat.sceneTargets[turn]}
    throw Object.assign(new Error('这段正文已不存在'),{code:'SCENE_TARGET_UNAVAILABLE'})
  }
  return computeSceneTarget(chat, turn)
}

/** The key from the chat itself, ignoring any precomputed sceneTargets (they embed the chat id). */
/** The digest a reply's scene key uses for its text (computeSceneTarget). */
export function sceneSourceDigest(text) {
  return hash(String(text ?? ''))
}

export function computeSceneTarget(chat, turn) {
  turn = Number(turn)
  const index = (chat.messages || []).findIndex(message => message?.role === 'assistant' && Number(message.turn || (message.greeting ? 1 : 0)) === Number(turn))
  if (index < 0) throw Object.assign(new Error('这段正文已不存在'), { code: 'SCENE_TARGET_UNAVAILABLE' })
  const message = chat.messages[index]
  const swipeId = Math.max(0, Number(message.swipeId) || 0)
  const source = String(message.swipes?.[swipeId] ?? message.sourceText ?? message.text ?? '')
  // 自动精修 rewords a reply without changing its scene: it keeps the original text's digest.
  const sourceDigest = message.polishedFrom || hash(source)
  // A prefix digest distinguishes rolled-back/replaced story branches, while
  // appending later rounds or changing variable metadata does not invalidate art.
  const prefix = chat.messages.slice(0, index).map(item => [item.role, item.turn, item.sourceText ?? item.text])
  const key = hash(JSON.stringify([chat.id, prefix, index, turn, swipeId, sourceDigest]))
  return { key, turn: Number(turn), swipeId, sourceDigest, source }
}

export function projectedSceneText(source, macroState) {
  return projectAgentContent(source, { macroState }).agentText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '').trim()
}

/** Read-only access to old scene pictures; never writes story messages or game state. */
