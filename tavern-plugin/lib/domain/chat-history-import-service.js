import { rescueHistoryInput, rescueHistoryNotice } from './chat-history-rescue.js'
import { prepareWorldBookRecall } from './worldbook-recall.js'
import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { parseChatHistory, chatHistoryPreview } from './chat-history-import.js'
import { buildImportedConversation, appendImportedEvents } from './chat-history-session.js'
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Static initial values only. Executable templates remain the card runtime's responsibility.
export function importInitialVariables(card, worldBook) {
  let data = {}
  const opening = String(card.first_mes || '').match(/<initvar>([\s\S]*?)<\/initvar>/i)
  const entries = opening ? [{ content: opening[1] }] : (worldBook?.view?.entries || []).filter(e => /\[initvar\]/i.test(e.comment || e.title || e.name || ''))
  for (const entry of entries) {
    const text = String(entry.content || '').replace(/^\s*```[^\n]*\n|\n```\s*$/g, '').replace(/<\/?initvar>/gi, '').trim()
    if (!text) continue
    if (/<%|\{\{/.test(text)) throw new Error('人物卡初始变量包含动态模板，暂无法在导入预览中解析')
    const value = parseYaml(text, { maxAliasCount: 50 })
    if (!object(value)) throw new Error('人物卡初始变量必须为对象')
    data = { ...data, ...value }
  }
  return Object.keys(data).length ? { stat_data: data, schema: { type: 'object', properties: {} }, initialized_lorebooks: {} } : undefined
}

export function incompatibleState(expected, actual, path = '') {
  if (!object(expected)) return false
  if (!object(actual)) return true
  return Object.entries(expected).some(([key, value]) => {
    if (key === '$meta') return false
    if (!Object.hasOwn(actual, key)) return true
    const candidate = actual[key]
    if (object(value)) return incompatibleState(value, candidate, path + '/' + key)
    if (Array.isArray(value)) return !Array.isArray(candidate)
    return value !== null && typeof candidate !== typeof value
  })
}

function assertImportedWorldbook(projected) {
  if (projected.error) throw new Error(projected.error)
  if (projected.diagnostics?.length) {
    throw new Error('条目模板处理失败：' + projected.diagnostics.map(item => `${item.ref || '未知条目'} (${item.code || item.kind || 'error'})`).join('、'))
  }
}

export function createChatHistoryImportService({ initialization, cards, worldBooks, store, chats, native, planner, projectWorldBookTemplates, projectForegroundWorldbook, drafts }) {
  const pending = new Map()
  async function inspect(input) {
    const parsed = parseChatHistory(input.text)
    const card = await cards.read(input.cardPath)
    if (!card) throw new Error('人物卡不存在，请重新选择')
    if (input.rescue) return { parsed, card, worldBook: null, incompatible: false }
    const worldBook = await worldBooks.bound(input.cardPath, card)
    let initialVariables, initialError = ''
    try { initialVariables = importInitialVariables(card, worldBook) } catch (error) { initialError = error.message }
    const incompatible = parsed.hasMvu && initialVariables !== undefined && parsed.messages.some(m => m.variables && incompatibleState(initialVariables.stat_data, m.variables.stat_data))
    return { parsed, card, worldBook, initialVariables, initialError, incompatible }
  }
  async function preview(input) {
    const result = await inspect(input)
    return { ...chatHistoryPreview(result.parsed), incompatible: result.incompatible,
      warnings: [...result.parsed.warnings, ...(result.initialError ? [result.initialError] : []),
        ...(!result.parsed.hasMvu ? ['未找到 MVU 快照；如人物卡有初始变量，将使用初始值'] : [])] }
  }
  async function perform(input) {
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(input.operationId || '') || !input.sessionId) throw new Error('导入操作或 Session 标识无效')
    const { parsed, card, worldBook, initialVariables, initialError, incompatible } = await inspect(input)
    if (incompatible && !input.textOnly) throw new Error('变量结构与人物卡不兼容，请换卡或选择仅导入正文')
    const identity = createHash('sha256').update(JSON.stringify([input.cardPath, parsed.digest, input.textOnly === true, input.userName || parsed.userName, input.rescue || null])).digest('hex')
    const path = 'chat-imports/' + input.operationId + '.json'
    let journal = await store.readJson(path)
    if (journal && (journal.identity !== identity || journal.sessionId !== input.sessionId)) throw new Error('同一导入操作不能更换人物卡、内容或 Session')
    const existing = await chats.resolve(input.sessionId)
    if (existing) {
      if (existing.importHistory?.operationId !== input.operationId) throw new Error('导入目标必须是新 Session')
      return { sessionId: input.sessionId, mode: existing.mode || 'story' }
    }
    if (!journal) {
      const chat = await initialization.prepareImport({ cardPath: input.cardPath, sessionId: input.sessionId, userName: input.userName || parsed.userName })
      // Frames are built before this draft is published under its Session, so world book
      // templates cannot resolve it by session id yet. The host holds it only while frames
      // are built and releases it, with its template runtime, before anything is written.
      drafts?.hold?.(input.sessionId, chat)
      if (input.rescue) {
        chat.mvu = input.rescue.mvuSnapshot ? { ...chat.mvu, enabled: true, owner: 'official', runtime: 'magvarupdate' } : { enabled: false }
        chat.variables = {}
        chat.macroState = { userName: input.userName || parsed.userName, local: {}, global: {} }
        chat.mode = 'story'
        chat.scriptState = null
        chat.backgroundTasks = { ...chat.backgroundTasks, variables: Boolean(input.rescue.mvuSnapshot) }
      }
      if (!input.rescue && chat.mvu?.enabled && (input.textOnly || parsed.messages.some(m => !m.variables)) && !initialVariables) throw new Error(initialError || '无法读取这张 MVU 卡的初始变量，请补充有效快照后重试')
      const plan = await buildImportedConversation(chat, parsed, {
        operationId: input.operationId, fileName: input.fileName, initialVariables, textOnly: input.textOnly === true,
        prepareFrame: async ({ chat, turn, userText }) => {
          if (input.rescue) return { text: '以下是从损坏存档迁入的剧情文字，仅作为历史参考。' + rescueHistoryNotice(input.rescue) }

          if (projectForegroundWorldbook) {
            let projected
            try {
              projected = await projectForegroundWorldbook({ chat, card, userText, userTextInHistory: true, worldBook, purpose: 'history-import', requestKey: `import:${input.operationId}:${turn}` })
              assertImportedWorldbook(projected)
            } catch (error) {
              throw new Error(`导入第 ${turn} 轮世界书上下文失败：${error.message || error}`, { cause: error })
            }
            if (projected.reads) chat.worldBookReads = projected.reads
            if (projected.randomState) chat.worldBookRandomState = projected.randomState
            if (projected.virtualState) chat.worldBookVirtualState = projected.virtualState
            const plan = await planner.plan({ purpose: 'body', card, chat: projected.macroState ? { ...chat, macroState: projected.macroState } : chat,
              userText, sessionId: input.sessionId, nativeTurn: turn, scriptReference: null, worldBookContext: projected.context })
            return { ...plan, ...(projected.virtualState ? { virtualWorldbook: { scope: projected.virtualState.scope,
              entries: Object.fromEntries((projected.changedVirtualRefs || []).map(ref => [ref, projected.virtualState.entries[ref]?.renderHash])) } } : {}) }
          }
          const recalled = prepareWorldBookRecall({ chat, card, worldBook, turn: turn - 1, userText, userTextInHistory: true })
          chat.worldBookReads = recalled.recordReads(chat.worldBookReads)
          let templates
          try {
            templates = projectWorldBookTemplates ? await projectWorldBookTemplates(chat, card) : null
            if (templates) assertImportedWorldbook(templates)
          } catch (error) {
            throw new Error(`导入第 ${turn} 轮世界书上下文失败：${error.message || error}`, { cause: error })
          }
          return planner.plan({ purpose: 'body', card, chat, userText, sessionId: input.sessionId,
            nativeTurn: turn, scriptReference: null,
            worldBookContext: [recalled.context, templates?.context].filter(Boolean).join('\n\n') })
        }
            }).finally(() => drafts?.clear?.(input.sessionId))
      if (input.rescue) {
        plan.chat.timeline.checkpoints = []
        plan.chat.importHistory.rescue = input.rescue
        plan.chat.importHistory.warnings.push(rescueHistoryNotice(input.rescue))
      }
      const checkpointInputs = plan.chat.timeline.checkpoints.map(c => ({ id: c.id, messageCount: c.importMessageCount, before: c.importBefore }))
      journal = { version: 1, identity, sessionId: input.sessionId, status: 'writing', plan, checkpointInputs }
      await store.writeJson(path, journal)
    }
    if (journal.plan) {
      // Materialize ordinary Chat revisions for the native checkpoint mechanism.
      // Intermediate records are deliberately absent from the conversation registry.
      for (const checkpoint of journal.plan.chat.timeline.checkpoints) {
        if (checkpoint.beforeRevision !== undefined && await chats.readRevision(journal.plan.chat.id, checkpoint.beforeRevision)) continue
        const savedInput = journal.checkpointInputs.find(c => c.id === checkpoint.id)
        const latest = await chats.read(journal.plan.chat.id)
        const before = { ...structuredClone(journal.plan.chat), ...structuredClone(savedInput.before),
          messages: structuredClone(journal.plan.chat.messages.slice(0, savedInput.messageCount)),
          _storageRevision: latest?._storageRevision || 0 }
        before.timeline.checkpoints = []
        delete before.participants
        const saved = await chats.write(before, { source: 'chat-import.checkpoint' })
        checkpoint.beforeRevision = saved._storageRevision
        delete checkpoint.importBefore
        delete checkpoint.importMessageCount
        journal.plan.chat._storageRevision = saved._storageRevision
        await store.writeJson(path, journal)
      }
      journal.status = 'prepared'
      await store.writeJson(path, journal)
    }
    const target = await native.wait(input.sessionId)
    await native.ensurePrefix(target.session, journal.plan.chat.cardContextSnapshot)
    await appendImportedEvents(target.session, journal.plan, native.flush)
    if (target.agent?.phase?.kind === 'idle') target.agent.phase.lastTurn = Math.max(target.agent.phase.lastTurn || 0, journal.plan.lastTurn)
    journal.plan.chat._storageRevision = (await chats.read(journal.plan.chat.id))?._storageRevision || 0
    await chats.publish(journal.plan.chat)
    await store.writeJson(path, { version: 1, identity, sessionId: input.sessionId, status: 'ready' })
    return { sessionId: input.sessionId, mode: journal.plan.chat.mode || 'story' }
  }
  function importPrepared(input) {
    const key = input.operationId
    const signature = JSON.stringify(input)
    if (pending.has(key)) {
      const existing = pending.get(key)
      return existing.signature === signature ? existing.task : Promise.reject(new Error('同一导入操作正在处理其他内容'))
    }
    const task = perform(input).finally(() => pending.delete(key))
    pending.set(key, { signature, task })
    return task
  }
  return { preview, import(input) { const { rescue, ...ordinary } = input; return importPrepared(ordinary) },
    async rescue(input) {
      const source = await chats.read(input.sourceChatId)
      if (source?.sessionId === input.sessionId) throw new Error('救援必须使用新的对话')
      return importPrepared({ ...rescueHistoryInput(source), operationId: input.operationId, sessionId: input.sessionId })
    }
  }
}
