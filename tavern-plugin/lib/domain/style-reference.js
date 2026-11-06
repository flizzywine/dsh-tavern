// Foreground style association shares the writer context. The saved reference is
// for inspection; it is not automatically injected into the next turn.

import { activeStoryTurn } from './story-tool-submission.js'

export const STYLE_REFERENCE_SUBMIT_TOOL = {
  name: 'style_reference_submit',
  description: '提交文风联想：一段笔调贴合当前场景的范文；有对应的书时附上书名、作者。提交后任务完成。',
  parameters: { type: 'object', properties: {
    book: { type: 'string', description: '书名，不带书名号；没有可不填' },
    author: { type: 'string', description: '作者；没有可不填' },
    quote: { type: 'string', description: '一段范文，约 100～300 字，不超过 400 字' }
  }, required: ['quote'], additionalProperties: false }
}

const KEPT = 8
const MAX_QUOTE = 400

function str(value) {
  return typeof value === 'string' ? value : ''
}

export function readStyleReference(args) {
  const book = str(args?.book).trim().replace(/^《|》$/g, '')
  const author = str(args?.author).trim()
  const quote = str(args?.quote).trim()
  if (!quote) throw new Error('范文不能为空')
  if (quote.length > MAX_QUOTE) throw new Error('范文不超过 ' + MAX_QUOTE + ' 字，只写一段')
  return { book, author, quote }
}

/** 「《书名》作者」; empty for a passage saved without a book. */
export function styleReferenceSource(reference) {
  const book = str(reference?.book)
  return book ? '《' + book + '》' + str(reference?.author) : ''
}

export function latestStyleReference(chat) {
  if (chat?.backgroundTasks?.styleReference !== true) return null
  const list = Array.isArray(chat.styleReferences) ? chat.styleReferences : []
  const item = list.at(-1)
  return item ? { book: item.book, author: item.author, quote: item.quote, afterTurn: item.afterTurn } : null
}

export function rememberStyleReference(list, reference, afterTurn) {
  const kept = (Array.isArray(list) ? list : []).filter(item => item && Number(item.afterTurn) < afterTurn)
  return [...kept, { ...reference, afterTurn }].slice(-KEPT)
}


export function foregroundStyleReferencePrompt(chat, selectionPrompt, writingPrompt) {
  if ((chat?.mode || 'story') !== 'story' || chat?.backgroundTasks?.styleReference !== true) return ''
  return ['【前台文风联想】', selectionPrompt, writingPrompt,
    '本轮由你结合当前玩家输入与前情，在写正文之前完成文风联想。调用 style_reference_submit 记录参考后继续生成本轮正文，不要结束回合，也不要等待后台。选段要求中的“刚写完正文”指当前场景；历史上的旧参考不是本轮必须沿用的参考。',
    chat.styleReferenceGuidance ? '【玩家选段偏好】\n' + String(chat.styleReferenceGuidance) : ''
  ].filter(Boolean).join('\n\n')
}

export function createForegroundStyleReferenceTool({ chatForSession, save, isBackground = () => false }) {
  return {
    name: STYLE_REFERENCE_SUBMIT_TOOL.name,
    description: '记录本轮前台文风参考。成功后继续写本轮正文，不结束回合、不启动后台。',
    parameters: { book: { type: 'string' }, author: { type: 'string' }, quote: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      exec.signal?.throwIfAborted()
      const session = exec.agent?.session, sessionId = session?.id
      if (!sessionId || isBackground(sessionId)) throw Error('文风联想由前台写作回合执行')
      const turn = activeStoryTurn(session), chat = await chatForSession(sessionId)
      if (!turn || !chat || chat.sessionId !== sessionId || (chat.mode || 'story') !== 'story' || chat.backgroundTasks?.styleReference !== true) throw Error('本局未开启前台文风联想，或当前没有写作回合')
      const reference = readStyleReference(args)
      exec.signal?.throwIfAborted()
      await save(chat, reference, turn)
      return JSON.stringify({ ok: true, reference, next: '参考已记录，请继续生成本轮正文。' })
    }
  }
}
