import { createHash } from 'node:crypto'
import { applyPolishEdits, parsePolishReview, polishReviewContext } from './polish-review.js'

const OWNER = 'dsh-tavern.polish-agent'
const hash = value => createHash('sha256').update(value).digest('hex')
const text = value => typeof value === 'string' ? value : ''

export const POLISH_TOOLS = [
  { name: 'polish_edit', description: '提交一处修改到本次精修草稿。find 必须唯一匹配本次原文，不能与已接受的修改重叠；失败时按返回信息修正后重试。不会直接保存正文。',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: '一句话说明修改原因' }, find: { type: 'string', description: '从本次原文逐字复制的唯一片段' }, replace: { type: 'string', description: '替换文字；删除时为空字符串' } }, required: ['reason', 'find', 'replace'], additionalProperties: false } },
  { name: 'polish_finish', description: '全部修改已提交，结束本次精修；没有需要修改的地方也必须调用。',
    parameters: { type: 'object', properties: {}, additionalProperties: false } }
]

const PROTOCOL = `你是独立的正文精修 Agent，不续写剧情。人物设定与精修标准留在固定前缀中，以后每次任务追加当前正文；历史审稿只是参考，不是当前任务。只有用户消息确认的正文版本才是已发生的剧情，工具提交的改法是草稿。
本次任务会标明「原则精修」或「只按意见修改」。只按意见修改时不要重新执行整套审稿标准。
以下工具协议优先于标准中可能保留的旧 JSON 格式要求：每确定一处修改立即调用 polish_edit，不要先攒整份清单，不要输出 JSON 修改清单。可在同一轮输出多个互不重叠的调用。每处修改仍定位本次输入的原文，不定位前一个工具的替换结果。原因保持一句短话。最多接受 12 处修改。
工具成功只表示已加入草稿；失败的修改未加入，可按错误修正。全部提交后调用 polish_finish；无修改也调用。完成后不再输出总结或重抄正文。`

/** One draft uses immutable source positions, so concurrent calls cannot edit each other's output. */
export function createPolishDraft(texts, onChange = () => {}) {
  const edits = []
  let finished = false
  return {
    get finished() { return finished },
    result: () => ({ edits: edits.map(edit => ({ ...edit })), fallback: '' }),
    call({ name, arguments: args }) {
      if (finished) return JSON.stringify({ ok: false, error: '本次精修已结束' })
      if (name === 'polish_finish') { finished = true; onChange(edits, true); return JSON.stringify({ ok: true, count: edits.length }) }
      if (name !== 'polish_edit') return JSON.stringify({ ok: false, error: '只能调用精修工具' })
      if (!args || !['find', 'replace', 'reason'].every(key => typeof args[key] === 'string') || !args.reason.trim()) return JSON.stringify({ ok: false, error: 'find、replace、reason 必须是字符串，原因不能为空' })
      const duplicate = edits.find(edit => edit.find === args.find && edit.replace === args.replace)
      if (duplicate) return JSON.stringify({ ok: true, duplicate: true, count: edits.length })
      if (edits.length >= 12) return JSON.stringify({ ok: false, error: '已接受 12 处修改，请调用 polish_finish' })
      const edit = parsePolishReview(JSON.stringify({ edits: [...edits, args] }), texts).edits.at(-1)
      const errors = { missing: '原文中找不到 find，请逐字复制，包括标点和换行', ambiguous: 'find 在原文出现多次，请扩大范围以唯一定位', overlap: '与已接受的修改重叠，请只提交未修改的范围' }
      if (!args.find.trim() || !edit || edit.status !== 'ok') return JSON.stringify({ ok: false, error: errors[edit?.status] || 'find 不能为空' })
      if (edit.find === edit.replace) return JSON.stringify({ ok: false, error: '替换前后相同，无需提交' })
      edits.push(edit)
      onChange(edits, false)
      return JSON.stringify({ ok: true, count: edits.length })
    }
  }
}

/** Native child history survives idle disposal/restart. Only new material is appended. */
export function createPolishReviewer({ latestFloors, readCard, prompt, runAgent, selection, data }) {
  const queues = new Map(), progress = new Map()
  async function run(sessionId, texts, guidance, signal) {
    signal?.throwIfAborted()
    const chat = await latestFloors(sessionId, 4)
    const card = await readCard(chat.cardPath).catch(() => undefined) || chat.cardDefinitionSnapshot?.raw?.data || chat.cardDefinitionSnapshot?.raw
    const context = polishReviewContext(chat.messages)
    const floor = (Number.isSafeInteger(chat.messageCount) ? chat.messageCount : chat.messages.length) - 1
    const body = texts.join('\n\n')
    if (!body.trim()) throw new Error('这轮没有可精修的正文')
    const principles = text(prompt('polish')).trim(), instructions = text(prompt('polish-guidance')).trim()
    if (!principles) throw new Error('正文精修原则为空，请在系统提示词里填写')
    if (guidance && !instructions) throw new Error('精修按意见修改的提示词为空，请在系统提示词里填写')
    const setting = ['description', 'personality', 'scenario'].map(key => text(card?.[key]).trim()).filter(Boolean).join('\n\n').slice(0, 6000)
    const system = [PROTOCOL, '【原则精修标准】\n' + principles, '【按意见修改标准】\n' + instructions,
      '【人物卡：' + (text(card?.name) || '未命名') + '】\n' + setting, '【玩家角色】' + (text(chat.macroState?.userName) || '你')].join('\n\n')
    const prefix = hash(system)
    const saved = await data.readGame({ chatId: chat.id, owner: OWNER })
    // One 润色 Session per game (and per prompt prefix): it continues through regeneration,
    // rollback and failed or cut-short reviews. When the story did not simply move on from the
    // last finished review, the task says so and gives the current previous floor.
    const previous = saved?.version === 1 && saved.parent === sessionId && saved.prefix === prefix && saved.traceSessionId ? saved : null
    const known = value => previous && [previous.original, previous.draft].includes(hash(value))
    const linear = Boolean(previous?.complete) && (floor === previous.floor ? known(body) : floor === previous.floor + 2 && known(context.previous))
    const reusable = Boolean(previous)
    let continued = false
    const state = { version: 1, parent: sessionId, prefix, floor, complete: false, original: hash(body), traceSessionId: previous?.traceSessionId || '' }
    const status = { phase: 'running', edits: [], startedAt: Date.now(), traceSessionId: '' }
    progress.set(sessionId, status)
    const draft = createPolishDraft(texts, edits => { status.edits = edits.map(edit => ({ ...edit })) })
    try {
      await data.saveGame({ chatId: chat.id, owner: OWNER, data: state })
      const result = await runAgent({
        task: 'polish', sessionId, persistent: true, persistentSessionId: reusable ? previous.traceSessionId : '', newSession: !reusable,
        selection: await selection(sessionId), signal, system, webSearchEnabled: false,
        tools: POLISH_TOOLS, maxToolCalls: 32, toolLimitMessage: '精修调用次数已达上限，请结束任务。',
        onToolCall: call => draft.call(call), stopToolsWhen: () => draft.finished, acceptWithoutText: () => draft.finished,
        async onPersistentSessionReady(id) {
          continued = Boolean(reusable && id === previous.traceSessionId)
          state.traceSessionId = id; status.traceSessionId = id
          await data.saveGame({ chatId: chat.id, owner: OWNER, data: state })
        },
        taskText: () => {
          const sections = []
          if (continued && linear && floor === previous.floor) {
            sections.push('仍是同一轮；以此前提交的' + (hash(body) === previous.original ? '原文' : '精修草稿') + '作为本次原文，重新开始一份独立草稿。')
          } else if (continued && linear) {
            sections.push('上一轮实际采用' + (hash(context.previous) === previous.original ? '此前输入的原文（未应用精修草稿）' : '此前的精修草稿') + '。')
          } else {
            if (continued) sections.push('【剧情有变】此前审过的内容可能已被回退、重写，或上次没有审完；以下面的前文和本轮正文为准。')
            if (context.previous) sections.push('【补充前文（上一轮实际正文）】\n' + context.previous.slice(-3000))
          }
          sections.push('【本轮执行提醒】\n' + (guidance ? '本轮只按玩家意见修改，不额外扩展原则精修。' : '按固定前缀中的完整精修原则审读本轮正文，只改明确的问题。') +
            '保留剧情事实、力量等级、人物意图和有效信息；不要把正常比喻当作错误，不为改而改，不补造情节。每处修改调用 polish_edit；没有必要修改就直接调用 polish_finish。')
          // Always give the current target verbatim, including guided passes after compaction.
          sections.push('【本轮正文】\n' + body)
          if (context.input) sections.push('【本轮玩家输入】\n' + context.input.slice(0, 2000))
          sections.push(guidance ? '【任务：只按意见修改】\n' + guidance.slice(0, 1000) : '【任务：原则精修】')
          return sections.join('\n\n')
        }
      })
      signal?.throwIfAborted()
      if (!draft.finished) throw new Error('精修 Agent 未调用完成工具，草稿未保存，请重试')
      const reviewed = draft.result()
      state.draft = hash(applyPolishEdits(texts, reviewed.edits).join('\n\n'))
      state.complete = true; state.traceSessionId = result.traceSessionId
      await data.saveGame({ chatId: chat.id, owner: OWNER, data: state })
      status.phase = 'completed'
      return reviewed
    } catch (error) { status.phase = 'failed'; status.error = text(error?.message); throw error }
  }
  function enqueue(sessionId, texts, guidance, signal) {
    const pending = (queues.get(sessionId) || Promise.resolve()).catch(() => {}).then(() => run(sessionId, texts, guidance, signal))
    queues.set(sessionId, pending)
    return pending.finally(() => { if (queues.get(sessionId) === pending) queues.delete(sessionId) })
  }
  return Object.freeze({
    review: (sessionId, texts, signal) => enqueue(sessionId, texts, '', signal),
    guide: (sessionId, texts, guidance, signal) => enqueue(sessionId, texts, text(guidance).trim(), signal),
    progress: sessionId => progress.has(sessionId) ? structuredClone(progress.get(sessionId)) : null
  })
}
