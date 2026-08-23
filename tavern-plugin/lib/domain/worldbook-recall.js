import { projectAgentContent } from './runtime-content-projection.js'
import { createBackgroundTaskCoordinator } from './background-task-coordinator.js'

const DIRECT_LIMIT = 200
const MATCH_LIMIT = 24
const READ_ENTRY_LIMIT = 8
const CONTEXT_LIMIT = 2500
const READ_COOLDOWN_TURNS = 10

const WORLD_BOOK_READ_TOOL = Object.freeze({
  name: 'tavern_read_worldbook_entries',
  description: '按条目引用读取世界书正文。优先读取当前标题目录；此前已读但处于隐藏期的条目仍可按引用或准确标题重读。最多调用 2 次、合计读取 8 条。',
  parameters: {
    type: 'object',
    properties: {
      entries: {
        type: 'array', minItems: 1, maxItems: READ_ENTRY_LIMIT,
        items: { type: 'string' },
        description: '条目的纯引用，例如 entry:12。当前目录未展示但此前读过的条目，也可凭记忆中的引用重读。'
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

function fingerprint(value) {
  const text = str(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return text.length.toString(36) + ':' + (hash >>> 0).toString(36)
}

function readRecord(chat, entry) {
  const reads = chat && chat.worldBookReads
  if (reads === null || typeof reads !== 'object' || Array.isArray(reads)) return null
  const record = reads[str(entry && entry.ref)]
  return record !== null && typeof record === 'object' && !Array.isArray(record) ? record : null
}

function isCoolingDown(chat, entry, turn) {
  const record = readRecord(chat, entry)
  if (record === null) return false
  const readTurn = Number(record && record.turn)
  const currentTurn = Number(turn)
  if (!Number.isSafeInteger(readTurn) || !Number.isSafeInteger(currentTurn)) return false
  if (str(record.fingerprint) !== fingerprint(entry && entry.content)) return false
  const elapsed = currentTurn - readTurn
  return elapsed >= 0 && elapsed <= READ_COOLDOWN_TURNS
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
    const result = projectAgentContent(text, {
      charName: str(card && card.name),
      macroState
    })
    macroState = result.macroState
    return result.agentText.trim()
  }
}

function latestBody(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== 'assistant') continue
    const text = messageText(message).trim()
    if (text !== '') return text
  }
  return ''
}

function keywordsOf(entry) {
  return (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : [])
    .concat(Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [])
    .map(function (value) { return str(value).trim() })
    .filter(Boolean)
}

function matchedEntries(entries, body) {
  const current = str(body).toLocaleLowerCase()
  return entries.map(function (entry, index) {
    const keys = keywordsOf(entry)
    const hits = keys.filter(function (key) { return current.includes(key.toLocaleLowerCase()) }).length
    return { entry, index, hits }
  }).filter(function (item) {
    return item.hits > 0
  }).sort(function (left, right) {
    return right.hits - left.hits || left.index - right.index
  }).slice(0, MATCH_LIMIT).map(function (item) { return item.entry })
}

function taskText(prepared) {
  const sections = ['【最新一轮正文】\n' + (prepared.body || '（无）')]
  if (prepared.constantCatalog.length > 0) {
    sections.push('【常驻条目标题目录】\n' + prepared.constantCatalog.map(function (entry) {
      return '[' + entry.ref + '] ' + entry.title
    }).join('\n'))
  }
  if (prepared.triggeredCatalog.length > 0) {
    sections.push('【关键词命中的非常驻条目标题目录】\n' + prepared.triggeredCatalog.map(function (entry) {
      return '[' + entry.ref + '] ' + entry.title
    }).join('\n'))
  } else {
    sections.push('【关键词命中的非常驻条目标题目录】\n（无）')
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
  const body = str(input.latestBody) || latestBody(input.chat)
  const constantEntries = entries.filter(function (entry) { return entry.constant === true })
  const triggeredEntries = matchedEntries(entries.filter(function (entry) { return entry.constant !== true }), body)
  const coolingEntries = entries.filter(function (entry) { return isCoolingDown(input.chat, entry, input.turn) })
  const visibleConstantEntries = constantEntries.filter(function (entry) { return !isCoolingDown(input.chat, entry, input.turn) })
  const visibleTriggeredEntries = triggeredEntries.filter(function (entry) { return !isCoolingDown(input.chat, entry, input.turn) })
  const visibleEntries = visibleConstantEntries.concat(visibleTriggeredEntries)
  const readableEntries = visibleEntries.concat(coolingEntries.filter(function (entry) { return !visibleEntries.includes(entry) }))
  const entryByRef = new Map(readableEntries.map(function (entry) { return [str(entry.ref), entry] }))
  const refByTitle = new Map()
  for (const entry of readableEntries) {
    const title = str(entry.title).trim() || '未命名条目'
    refByTitle.set(title, refByTitle.has(title) ? null : str(entry.ref))
  }
  function resolveEntryRefs(values) {
    const requested = Array.from(new Set(Array.isArray(values) ? values.map(function (value) { return str(value).trim() }).filter(Boolean) : []))
    if (requested.length === 0) throw new Error('至少提供一个世界书条目引用')
    const invalid = []
    const resolved = []
    for (const value of requested) {
      let ref = entryByRef.has(value) ? value : ''
      if (ref === '') {
        const bracketed = value.match(/^\[([^\]]+)\]/)
        if (bracketed && entryByRef.has(bracketed[1].trim())) ref = bracketed[1].trim()
      }
      if (ref === '' && refByTitle.has(value) && refByTitle.get(value) !== null) ref = refByTitle.get(value)
      if (ref === '') invalid.push(value)
      else if (!resolved.includes(ref)) resolved.push(ref)
    }
    if (invalid.length > 0) throw new Error('世界书条目不在本轮标题目录中: ' + invalid.join(', '))
    return resolved
  }
  const prepared = {
    kind: 'agent',
    context: '',
    totalChars,
    body,
    constantCatalog: visibleConstantEntries.map(function (entry) { return { ref: str(entry.ref), title: str(entry.title).trim() || '未命名条目' } }),
    triggeredCatalog: visibleTriggeredEntries.map(function (entry) {
      return { ref: str(entry.ref), title: str(entry.title).trim() || '未命名条目' }
    }),
    resolveEntryRefs,
    readEntries(refs) {
      return resolveEntryRefs(refs).map(function (ref) {
        const entry = entryByRef.get(ref)
        return { ref, title: str(entry.title).trim() || '未命名条目', content: project(entry.content) }
      })
    },
    recordReads(existing, refs, turn) {
      const next = clone(existing !== null && typeof existing === 'object' && !Array.isArray(existing) ? existing : {})
      for (const ref of refs) {
        const entry = entryByRef.get(ref)
        if (entry === undefined) continue
        next[ref] = { turn: Number(turn) || 0, fingerprint: fingerprint(entry.content) }
      }
      return next
    }
  }
  prepared.taskText = taskText(prepared)
  return prepared
}

export function createWorldBookRecall(options = {}) {
  const store = options.store
  const timeline = options.timeline
  const tasks = options.tasks || createBackgroundTaskCoordinator({ store, timeline })
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
      turn: input.turn,
      latestBody: input.latestBody
    })
    if (prepared.kind !== 'agent') return { chat, context: prepared.context, mode: prepared.kind, totalChars: prepared.totalChars }

    const taskRun = await tasks.begin(chat, 'worldbook')
    chat = taskRun.chat
    let traceSessionId = str(taskRun.participantRequest.sessionId)
    let traceBoundary = null
    let context = ''
    let error = null
    const readRefs = new Set()
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
          const resolved = prepared.resolveEntryRefs(refs)
          const nextRefs = new Set(readRefs)
          for (const ref of resolved) nextRefs.add(ref)
          if (nextRefs.size > READ_ENTRY_LIMIT) throw new Error('本轮最多读取 ' + READ_ENTRY_LIMIT + ' 条世界书条目')
          for (const ref of resolved) readRefs.add(ref)
          return JSON.stringify({ entries: prepared.readEntries(resolved) })
        },
        persistent: true,
        persistentSessionId: traceSessionId,
        rewindTo: taskRun.participantRequest.rewindTo
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

    const participant = taskRun.participant({ traceSessionId, traceBoundary })
    const completed = await taskRun.commit({
      stateChanged: false,
      participant,
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
        if (readRefs.size > 0) draft.worldBookReads = prepared.recordReads(draft.worldBookReads, readRefs, input.turn)
      }
    })
    if (completed.status === 'missing') return { chat, context: '', mode: 'agent', totalChars: prepared.totalChars, error: '聊天不存在' }
    if (completed.status !== 'committed') return { chat: completed.chat, context: '', mode: 'stale', totalChars: prepared.totalChars }
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
