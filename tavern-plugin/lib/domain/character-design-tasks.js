import { randomUUID } from 'node:crypto'
import { createDurableTaskMailbox } from './durable-task-mailbox.js'
import {
  CHARACTER_DESIGN_READ_TOOL,
  CHARACTER_DESIGN_SAVE_TOOL,
  createCharacterDesignDocumentSession
} from './character-design-document.js'

export const CHARACTER_DESIGN_REQUEST_TOOL_NAME = 'request_character_design'
export const CHARACTER_DESIGN_COMPLETE_TOOL_NAME = 'character_design_complete'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function boundedText(value, label, limit) {
  const result = str(value).trim()
  if (result === '') throw new Error(label + '不能为空')
  return result.slice(0, limit)
}

function normalizeSubjects(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('人物设计请求至少需要一个人物')
  return value.slice(0, 8).map(function (item, index) {
    const source = object(item)
    return {
      name: boundedText(source.name, '人物 #' + (index + 1) + ' 姓名', 200),
      need: boundedText(source.need, '人物 #' + (index + 1) + ' 设计需求', 800)
    }
  })
}

export const CHARACTER_DESIGN_REQUEST_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_REQUEST_TOOL_NAME,
  description: '当剧情确实需要建立、补全或修订可持续登场的重要人物时，提交一个独立人物设计任务。它不会在当前正文、姿势或变量任务内设计人物，也不会阻塞当前任务完成。',
  countsTowardLimit: false,
  parameters: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: {
      reason: { type: 'string', description: '为什么这些人物值得建立或更新长期设计。' },
      subjects: {
        type: 'array', minItems: 1, maxItems: 8,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', description: '人物姓名或当前稳定称呼。' },
            need: { type: 'string', description: '需要建立、补全或修订的原因与已知事实。' }
          },
          required: ['name', 'need']
        }
      }
    },
    required: ['reason', 'subjects']
  })
})

export const CHARACTER_DESIGN_COMPLETE_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_COMPLETE_TOOL_NAME,
  description: '完成人物设计任务。读取或保存所需档案后最后调用；saved 表示已保存，reused 表示现有档案已足够，skipped 表示经核对不应建档。',
  parameters: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: {
      outcome: { type: 'string', enum: ['saved', 'reused', 'skipped'] },
      names: { type: 'array', items: { type: 'string' }, description: '本任务核对过的人物姓名。' },
      summary: { type: 'string', description: '简短说明保存、复用或跳过的依据。' }
    },
    required: ['outcome', 'names', 'summary']
  })
})

function normalizeCompletion(args, changed) {
  const input = object(args)
  const outcome = str(input.outcome)
  if (!['saved', 'reused', 'skipped'].includes(outcome)) throw new Error('人物设计完成状态无效')
  if (outcome === 'saved' && !changed) throw new Error('尚未保存人物档案，不能以 saved 完成')
  const names = Array.isArray(input.names)
    ? Array.from(new Set(input.names.map(function (name) { return str(name).trim().slice(0, 200) }).filter(Boolean))).slice(0, 8)
    : []
  if (names.length === 0) throw new Error('人物设计完成记录缺少人物姓名')
  return { outcome, names, summary: boundedText(input.summary, '人物设计完成说明', 1000) }
}

/** Own independent character-design requests; callers only submit and observe durable tasks. */
export function createCharacterDesignTasks(options = {}) {
  const chats = options.chats
  const model = options.model
  const selection = options.selection
  const messagesForChat = typeof options.messagesForChat === 'function' ? options.messagesForChat : function () { return [] }
  const ready = typeof options.ready === 'function'
    ? options.ready
    : function (chat) { return chat && chat.settleStatus === 'done' }
  const scopeForChat = typeof options.scopeForChat === 'function' ? options.scopeForChat : function () { return {} }
  const validScope = typeof options.validScope === 'function' ? options.validScope : function () { return true }
  const now = typeof options.now === 'function' ? options.now : Date.now
  if (!chats || typeof chats.read !== 'function' || typeof chats.write !== 'function' || typeof chats.update !== 'function' || typeof chats.forSession !== 'function') {
    throw new Error('Character Design Tasks 缺少聊天存储 adapter')
  }
  if (!model || typeof model.run !== 'function') throw new Error('Character Design Tasks 缺少后台 Agent adapter')
  if (typeof selection !== 'function') throw new Error('Character Design Tasks 缺少模型选择 adapter')

  const jobs = new Map()
  const chatTails = new Map()
  const mailbox = createDurableTaskMailbox({
    store: { readChat: chats.read, writeChat: chats.write },
    now,
    reconcile(chat, task) {
      if (task.kind !== 'character-design') return null
      const receipt = object(chat.characterDesignTaskReceipt)
      if (str(receipt.requestId) === task.requestId) {
        return { status: 'succeeded', stage: 'completed', result: receipt, error: '' }
      }
      if (task.status === 'running') return { status: 'queued', stage: 'recovered', error: '' }
      return null
    }
  })

  function serializeChat(chatId, work) {
    const previous = chatTails.get(chatId) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    chatTails.set(chatId, current)
    return current.finally(function () {
      if (chatTails.get(chatId) === current) chatTails.delete(chatId)
    })
  }

  async function execute(chatId, task) {
    let traceSessionId = ''
    try {
      await mailbox.transition(chatId, task.taskId, { status: 'running', stage: 'preparing', error: '' })
      const snapshot = await chats.read(chatId)
      if (!snapshot) throw new Error('人物设计任务所属聊天不存在')
      const selected = selection(snapshot)
      if (selected === null || selected === undefined) throw new Error('没有可用的模型配置，无法执行人物设计')
      const designs = createCharacterDesignDocumentSession({ document: snapshot.characterDesignDocument, now })
      let completion = null
      let toolTail = Promise.resolve()
      const run = await model.run({
        task: 'character-design', persistent: true,
        resolvePersistentSessionId: async function () {
          const latest = await chats.read(chatId)
          return str(latest && latest.characterDesignAgentSessionId)
        },
        async onPersistentSessionReady(sessionId) {
          traceSessionId = str(sessionId)
          await chats.update(chatId, function (latest) {
            if (!latest) return latest
            latest.characterDesignAgentSessionId = traceSessionId
            return latest
          }, { source: 'character-design.agent-session', requestId: task.requestId })
        },
        selection: selected,
        messages: messagesForChat(snapshot),
        turnContext: [
          '【独立人物设计请求】',
          '原因：' + str(task.input.reason),
          '人物：\n' + JSON.stringify(task.input.subjects || [], null, 2)
        ].join('\n'),
        system: [
          '这是独立的人物设计任务，不是正文、姿势结算或变量结算。',
          '第一步调用 skill 加载 tavern-character-design；随后严格按 Skill 使用人物档案工具。',
          '不得调用姿势或 MVU 工具，不得续写剧情。最后调用 character_design_complete。'
        ].join('\n'),
        tools: [CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL, CHARACTER_DESIGN_COMPLETE_TOOL],
        maxToolCalls: 24,
        toolLimitMessage: '人物设计工具调用次数已达上限，请调用 character_design_complete 结束任务。',
        stopToolsWhen: function () { return completion !== null },
        acceptWithoutText: function () { return completion !== null },
        temperature: 0.5,
        sessionId: snapshot.sessionId,
        turn: Math.max(0, Number(task.input.turn) || 0),
        webSearchEnabled: snapshot.webSearchEnabled === true,
        onToolCall(call) {
          const pending = toolTail.then(async function () {
            if (call && (call.name === CHARACTER_DESIGN_READ_TOOL.name || call.name === CHARACTER_DESIGN_SAVE_TOOL.name)) {
              if (completion !== null) return JSON.stringify({ ok: false, retryable: false, error: '人物设计任务已经完成' })
              return await designs.execute(call)
            }
            if (!call || call.name !== CHARACTER_DESIGN_COMPLETE_TOOL_NAME) {
              return JSON.stringify({ ok: false, retryable: true, error: '当前任务只允许使用人物设计工具' })
            }
            try {
              completion = normalizeCompletion(call.arguments, designs.changed())
              return JSON.stringify({ ok: true })
            } catch (error) {
              return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
            }
          })
          toolTail = pending.catch(function () {})
          return pending
        }
      })
      traceSessionId = str(run.traceSessionId) || traceSessionId
      await toolTail
      if (completion === null) throw new Error('人物设计 Agent 未调用 character_design_complete')
      const receipt = {
        requestId: task.requestId, taskId: task.taskId, traceSessionId,
        outcome: completion.outcome, names: completion.names, summary: completion.summary,
        changed: designs.changed(), completedAt: now()
      }
      await chats.update(chatId, function (latest) {
        if (!latest) return latest
        if (designs.changed()) latest.characterDesignDocument = designs.document()
        latest.characterDesignTaskReceipt = structuredClone(receipt)
        return latest
      }, { source: 'character-design.commit', requestId: task.requestId })
      await mailbox.transition(chatId, task.taskId, { status: 'succeeded', stage: 'completed', result: receipt, error: '' })
    } catch (error) {
      await mailbox.transition(chatId, task.taskId, {
        status: 'failed', stage: 'failed', operationId: traceSessionId,
        error: str(error && error.message || error) || '人物设计任务失败'
      })
    }
  }

  function schedule(chatId, task) {
    if (!task || task.status !== 'queued' || jobs.has(task.taskId)) return
    const job = serializeChat(chatId, async function () {
      const latest = await chats.read(chatId)
      if (!latest || !ready(latest)) return
      if (!validScope(latest, object(task.input.scope))) {
        await mailbox.transition(chatId, task.taskId, {
          status: 'stale', stage: 'stale', error: '触发人物设计的剧情已经被回退或替换，本次请求已作废'
        })
        return
      }
      await execute(chatId, task)
    }).finally(function () { jobs.delete(task.taskId) })
    jobs.set(task.taskId, job)
  }

  async function request(input = {}) {
    const sessionId = str(input.sessionId)
    const chat = await chats.forSession(sessionId)
    if (!chat || (chat.mode || 'story') === 'card') throw new Error('人物设计任务只能从游玩对话发起')
    const subjects = normalizeSubjects(input.subjects)
    const reason = boundedText(input.reason, '人物设计请求原因', 1200)
    const task = await mailbox.submit(chat.id, {
      requestId: str(input.requestId).trim() || 'character-design-' + randomUUID(),
      kind: 'character-design', stage: 'queued',
      input: {
        sessionId, reason, subjects, turn: Math.max(0, Number(input.turn) || 0),
        scope: scopeForChat(chat)
      }
    })
    schedule(chat.id, task)
    return { ok: true, taskId: task.taskId, status: task.status, message: '人物设计任务已独立排队；请继续并完成当前任务。' }
  }

  async function resume(chatId) {
    const listed = await mailbox.list(chatId, { kind: 'character-design' })
    for (const task of listed.tasks) {
      if (task.status === 'queued') schedule(chatId, task)
    }
    return listed.tasks.at(-1) || null
  }

  async function recover(chatIds) {
    for (const chatId of chatIds) {
      const recovered = await mailbox.recover(chatId)
      for (const task of recovered.tasks) {
        if (task.kind === 'character-design' && task.status === 'queued') schedule(chatId, task)
      }
    }
  }

  return Object.freeze({ request, resume, recover })
}
