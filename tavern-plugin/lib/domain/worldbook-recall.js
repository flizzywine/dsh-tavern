import { projectRuntimeContent } from './runtime-content-projection.js'

const DIRECT_LIMIT = 200
const MATCH_LIMIT = 24
const READ_ENTRY_LIMIT = 8
const CONTEXT_LIMIT = 2500

const WORLD_BOOK_READ_TOOL = Object.freeze({
  name: 'tavern_read_worldbook_entries',
  description: '按条目引用读取本轮常驻世界书正文。只读取当前目录中确实可能与本轮或紧接后续剧情相关的条目；最多调用 2 次、合计读取 8 条。',
  parameters: {
    type: 'object',
    properties: {
      entries: {
        type: 'array', minItems: 1, maxItems: READ_ENTRY_LIMIT,
        items: { type: 'string' },
        description: '常驻目录中的条目引用。'
      }
    },
    required: ['entries'],
    additionalProperties: false
  }
})

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function charCount(value) {
  return Array.from(str(value).trim()).length
}

function messageText(message) {
  return str(message && message.sourceText) || str(message && message.text)
}

function projector(card, chat) {
  let macroState = {
    userName: str(chat && chat.macroState && chat.macroState.userName) || '你',
    local: clone(chat && chat.macroState && chat.macroState.local || {}),
    global: clone(chat && chat.macroState && chat.macroState.global || {})
  }
  return function project(text) {
    const result = projectRuntimeContent(text, {
      policy: 'play',
      charName: str(card && card.name),
      macroState
    })
    macroState = result.macroState
    return result.agentText.trim()
  }
}

function recentStory(chat) {
  return (Array.isArray(chat && chat.messages) ? chat.messages : []).slice(-8).map(function (message) {
    const text = messageText(message).trim()
    if (text === '') return ''
    return (message.role === 'assistant' ? '正文' : '玩家') + '：' + text
  }).filter(Boolean).join('\n')
}

function keywordsOf(entry) {
  return (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : [])
    .concat(Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [])
    .map(function (value) { return str(value).trim() })
    .filter(Boolean)
}

function matchedEntries(entries, playerText, story) {
  const current = str(playerText).toLocaleLowerCase()
  const history = str(story).toLocaleLowerCase()
  return entries.map(function (entry, index) {
    const keys = keywordsOf(entry)
    const currentHits = keys.filter(function (key) { return current.includes(key.toLocaleLowerCase()) }).length
    const historyHits = keys.filter(function (key) { return history.includes(key.toLocaleLowerCase()) }).length
    return { entry, index, currentHits, historyHits, hits: currentHits + historyHits }
  }).filter(function (item) {
    return item.hits > 0
  }).sort(function (left, right) {
    return Number(right.currentHits > 0) - Number(left.currentHits > 0) || right.hits - left.hits || right.historyHits - left.historyHits || left.index - right.index
  }).slice(0, MATCH_LIMIT).map(function (item) { return item.entry })
}

function taskText(prepared) {
  const sections = [
    '【当前玩家行动】\n' + (prepared.playerText || '（无）'),
    '【当前与历史正文】\n' + (prepared.story || '（无）')
  ]
  if (prepared.constantCatalog.length > 0) {
    sections.push('【常驻条目标题目录】\n' + prepared.constantCatalog.map(function (entry) {
      return '[' + entry.ref + '] ' + entry.title
    }).join('\n'))
  }
  if (prepared.triggeredEntries.length > 0) {
    sections.push('【程序关键词命中的非常驻条目】\n' + prepared.triggeredEntries.map(function (entry) {
      return '[' + entry.ref + '] ' + entry.title + '\n' + entry.content
    }).join('\n\n'))
  } else {
    sections.push('【程序关键词命中的非常驻条目】\n（无）')
  }
  return sections.join('\n\n')
}

export function prepareWorldBookRecall(input = {}) {
  const view = input.worldBook && input.worldBook.view
  if (view === null || typeof view !== 'object') return { kind: 'skip', context: '', totalChars: 0, reason: 'unbound' }
  const entries = (Array.isArray(view.entries) ? view.entries : []).filter(function (entry) {
    return entry && entry.enabled !== false && str(entry.content).trim() !== ''
  })
  const totalChars = entries.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  if (totalChars === 0) return { kind: 'skip', context: '', totalChars, reason: 'empty' }
  const project = projector(input.card, input.chat)
  if (totalChars <= DIRECT_LIMIT) {
    return {
      kind: 'direct',
      context: entries.map(function (entry) { return project(entry.content) }).filter(Boolean).join('\n\n'),
      totalChars
    }
  }
  const story = str(input.recentStory) || recentStory(input.chat)
  const constantEntries = entries.filter(function (entry) { return entry.constant === true })
  const triggered = matchedEntries(entries.filter(function (entry) { return entry.constant !== true }), input.playerText, story)
  const constantByRef = new Map(constantEntries.map(function (entry) { return [str(entry.ref), entry] }))
  const prepared = {
    kind: 'agent',
    context: '',
    totalChars,
    playerText: str(input.playerText).trim(),
    story,
    constantCatalog: constantEntries.map(function (entry) { return { ref: str(entry.ref), title: str(entry.title).trim() || '未命名条目' } }),
    triggeredEntries: triggered.map(function (entry) {
      return { ref: str(entry.ref), title: str(entry.title).trim() || '未命名条目', content: project(entry.content) }
    }),
    readConstantEntries(refs) {
      const requested = Array.from(new Set(Array.isArray(refs) ? refs.map(str) : []))
      if (requested.length === 0) throw new Error('至少提供一个世界书条目引用')
      const invalid = requested.filter(function (ref) { return !constantByRef.has(ref) })
      if (invalid.length > 0) throw new Error('世界书条目不在本轮常驻目录中: ' + invalid.join(', '))
      return requested.map(function (ref) {
        const entry = constantByRef.get(ref)
        return { ref, title: str(entry.title).trim() || '未命名条目', content: project(entry.content) }
      })
    }
  }
  prepared.taskText = taskText(prepared)
  return prepared
}

export function createWorldBookRecall(options = {}) {
  const store = options.store
  const timeline = options.timeline
  const model = options.model
  const prompt = options.prompt
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = options.logger || console
  if (!store || !timeline || !model || typeof prompt !== 'function') throw new Error('缺少世界书召回依赖')

  async function recall(input) {
    let chat = input.chat
    const prepared = prepareWorldBookRecall({
      worldBook: input.worldBook,
      card: input.card,
      chat,
      playerText: input.playerText,
      recentStory: input.recentStory
    })
    if (prepared.kind !== 'agent') return { chat, context: prepared.context, mode: prepared.kind, totalChars: prepared.totalChars }

    const begun = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'worldbook' } })
    chat = begun.chat
    await store.writeChat(chat)
    let traceSessionId = str(begun.value.participant && begun.value.participant.sessionId)
    let traceBoundary = null
    let context = ''
    let error = null
    let readCount = 0
    try {
      const selection = model.selection(input.sessionId)
      if (selection === null || selection === undefined) throw new Error('没有可用的模型配置')
      const run = await model.run({
        sessionId: input.sessionId,
        task: 'worldbook',
        selection,
        temperature: 0.2,
        system: prompt('worldbook-recall'),
        turnContext: '',
        messages: [{
          id: 'worldbook-' + now().toString(36),
          role: 'user',
          content: [{ type: 'text', text: prepared.taskText }],
          source: { kind: 'plugin', plugin: 'dsh-tavern' }
        }],
        tools: [WORLD_BOOK_READ_TOOL],
        maxToolCalls: 2,
        async onToolCall(call) {
          if (!call || call.name !== WORLD_BOOK_READ_TOOL.name) throw new Error('未知世界书召回工具')
          const refs = call.arguments && call.arguments.entries
          const unique = Array.from(new Set(Array.isArray(refs) ? refs.map(str) : []))
          readCount += unique.length
          if (readCount > READ_ENTRY_LIMIT) throw new Error('本轮最多读取 ' + READ_ENTRY_LIMIT + ' 条常驻世界书条目')
          return JSON.stringify({ entries: prepared.readConstantEntries(unique) })
        },
        persistent: true,
        persistentSessionId: traceSessionId,
        rewindTo: begun.value.participant && begun.value.participant.rewindTo
      })
      traceSessionId = str(run.traceSessionId)
      traceBoundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
      context = str(run.text).trim()
      if (charCount(context) > CONTEXT_LIMIT) throw new Error('世界书召回结果超过 ' + CONTEXT_LIMIT + ' 字')
    } catch (caught) {
      error = caught
      if (traceSessionId === '') traceSessionId = str(caught && caught.traceSessionId)
      if (logger && typeof logger.error === 'function') logger.error('dsh-tavern: 世界书召回失败，已跳过:', str(caught && caught.message || caught))
    }

    const latest = await store.readChat(chat.id)
    if (latest === undefined) return { chat, context: '', mode: 'agent', totalChars: prepared.totalChars, error: '聊天不存在' }
    const participant = traceSessionId === '' ? null : {
      sessionId: traceSessionId,
      lifetime: 'chat',
      boundary: traceBoundary
    }
    const completed = timeline.complete({
      chat: latest,
      operationId: begun.value.operationId,
      basedOn: begun.value.basedOn,
      outcome: { status: 'success', stateChanged: false, participant },
      apply(draft) {
        draft.worldBookError = error === null ? null : str(error && error.message || error)
        draft.lastWorldBookRecall = {
          ts: now(),
          turn: Number(input.turn) || 0,
          mode: 'agent',
          totalChars: prepared.totalChars,
          contextChars: charCount(context),
          empty: context === '',
          failed: error !== null
        }
      }
    })
    await store.writeChat(completed.chat)
    if (completed.value.status !== 'committed') return { chat: completed.chat, context: '', mode: 'stale', totalChars: prepared.totalChars }
    return {
      chat: completed.chat,
      context: error === null ? context : '',
      mode: 'agent',
      totalChars: prepared.totalChars,
      error: error === null ? null : str(error && error.message || error)
    }
  }

  return Object.freeze({ recall })
}

export const WORLD_BOOK_RECALL_LIMITS = Object.freeze({
  directChars: DIRECT_LIMIT,
  matchedEntries: MATCH_LIMIT,
  readEntries: READ_ENTRY_LIMIT,
  contextChars: CONTEXT_LIMIT
})
