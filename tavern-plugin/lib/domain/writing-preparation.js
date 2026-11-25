import { untilAborted } from './plugin-callback.js'
import { writingMaterialText } from './writing-material-text.js'
import { stripWritingSystemReminders } from './writing-system-reminders.js'
import receipts from './writing-material-receipts.cjs'

const SOURCE_LIMITS = {
  skill: { read: 6000, label: '写作指引' },
  worldbook: { read: 2800, label: '世界书' },
  memory: { read: 1600, label: '剧情记忆' },
  variables: { read: 5000, label: '当前变量' }
}

const TIMEOUT_MS = 120000
const NO_MATERIAL = '没有查到资料。'
const ALREADY_IN_CONTEXT = '命中的世界书条目已在上下文中，可以直接沿用。'
const VARIABLES_ALREADY_READ = '命中的变量已在本轮查询结果中。'
const VARIABLE_QUERY_HEADER = '【变量查询结果】\n'
const VARIABLE_FACTS_HEADER = '【当前状态】\n'
const VARIABLE_IDENTIFIER = /\b(?:[\dA-Fa-f]{8}(?:-[\dA-Fa-f]{4}){3}-[\dA-Fa-f]{12}|[a-z][a-z\d]+(?:_[a-z\d]+)+|[a-z][a-z\d]+[A-Z][A-Za-z\d]*)\b/
const SETTLED_CHANGES_INSTRUCTIONS = '以下是宿主已经保存的上轮结果，可以直接作为事实依据。用 submit_variable_facts 交接其中会影响正文的变化，保留最新数值和单位，用对局语言合并成短句。'
const { tavernIsWritingInjection, tavernWritingReceiptSections, tavernFormatPlotWorldbookReceipt } = receipts

function worldbookInContext(messages) {
  const seen = new Set()
  for (const message of messages || []) {
    if (!tavernIsWritingInjection(message)) continue
    for (const block of message.content || []) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      for (const section of tavernWritingReceiptSections(block.text)) {
        if (section.kind === '世界书') seen.add(tavernFormatPlotWorldbookReceipt(section.text).trimEnd())
      }
    }
  }
  return seen
}

export function createWritingPreparation({ allowed, runAgent, readSources }) {
  const entries = new Map()

  function register(owner, { prepare, settingsForGame } = {}) {
    if (typeof prepare !== 'function') throw new TypeError('writingPreparation 需要 prepare 函数')
    if (settingsForGame !== undefined && typeof settingsForGame !== 'function') throw new TypeError('settingsForGame 必须是函数')
    if (entries.has(owner)) throw new Error('插件已注册白手套 Agent')
    const entry = { owner, prepare, settingsForGame, lifetime: new AbortController() }
    entries.set(owner, entry)
    return () => {
      if (entries.get(owner) !== entry) return
      entries.delete(owner)
      entry.lifetime.abort(new Error('白手套 Agent 插件已停用'))
    }
  }

  async function forGame(gameId) {
    if (!entries.size) return null
    const applicable = []
    for (const entry of entries.values()) {
      if (!await allowed(entry.owner, gameId)) continue
      const settings = await entry.settingsForGame?.(gameId)
      if (settings?.enabled !== false && !entry.lifetime.signal.aborted) {
        applicable.push({ ...entry, selection: settings?.selection })
      }
    }
    if (applicable.length > 1) throw new Error('本局有多个白手套 Agent 插件，请只启用一个')
    return applicable[0] ?? null
  }

  async function prepare(entry, { gameId, frame, chat, context, foregroundSelection, signal }) {
    const done = new AbortController()
    const requestSignal = AbortSignal.any([done.signal, entry.lifetime.signal, AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])])
    const toolResults = []
    const worldbookSeen = worldbookInContext(context.messages)
    const variablesSeen = new Set()
    const titleHints = stripWritingSystemReminders(frame.context?.worldbookTitleHints || '')
    const queryContext = titleHints.trim() ? {
      ...context,
      worldbookTitleHints: {
        id: frame.frameId + ':worldbook-title-hints',
        role: 'user',
        content: [{ type: 'text', text: titleHints }],
        source: { kind: 'plugin:dsh-tavern-pure-writer', form: 'worldbook-title-hints' }
      }
    } : context
    let submitted
    let variableEvidence = false
    let variableFacts = ''
    const sourceReaders = readSources({ gameId, frame, chat, signal: requestSignal })

    async function read(kind, args) {
      requestSignal.throwIfAborted()
      if (submitted) throw new Error('本轮已提交 inject')
      const limits = SOURCE_LIMITS[kind]
      const rows = await sourceReaders[kind](args ?? {})
      requestSignal.throwIfAborted()
      const variables = kind === 'variables'
      const material = rows.slice(0, 8).flatMap(row => {
        let text = writingMaterialText(row.text).slice(0, limits.read)
        if (variables) {
          text = text.split('\n').filter(line => {
            if (!line || variablesSeen.has(line)) return false
            variablesSeen.add(line)
            return true
          }).join('\n')
        }
        const title = writingMaterialText(row.title).slice(0, 120)
        return text ? ['【' + limits.label + (title ? ' · ' + title : '') + '】\n' + text] : []
      })
      if (!material.length) return variables && rows.length ? VARIABLES_ALREADY_READ : NO_MATERIAL
      if (variables) {
        variableEvidence = true
        return VARIABLE_QUERY_HEADER + material.join('\n\n')
      }
      if (kind !== 'worldbook') return material.join('\n\n')
      const fresh = material.map(tavernFormatPlotWorldbookReceipt).filter(entry => {
        const key = entry.trimEnd()
        if (worldbookSeen.has(key)) return false
        worldbookSeen.add(key)
        return true
      })
      return fresh.length ? fresh.join('\n\n') : ALREADY_IN_CONTEXT
    }

    function collectToolText() {
      return untilAborted(Promise.all(toolResults), requestSignal).then(results => {
        const material = results.filter(result => result.ok && result.text !== NO_MATERIAL && result.text !== ALREADY_IN_CONTEXT
          && result.text !== VARIABLES_ALREADY_READ && !result.text.startsWith(VARIABLE_QUERY_HEADER)).map(result => result.text)
        if (variableFacts) material.push(variableFacts)
        return material.join('\n\n')
      })
    }

    function submitVariableFacts({ facts } = {}) {
      requestSignal.throwIfAborted()
      if (submitted || variableFacts) throw new Error('本轮已交接资料')
      if (!variableEvidence) throw new Error('请先查询本轮相关的变量')
      if (!Array.isArray(facts) || !facts.length || facts.length > 4
        || facts.some(fact => typeof fact !== 'string' || fact.length > 200 || VARIABLE_IDENTIFIER.test(fact) || /[`\n\r]/.test(fact))) {
        throw new Error('请提交一至四条简短的剧情事实，使用角色名和对局语言')
      }
      const sentences = [...new Set(facts.map(writingMaterialText))]
      if (sentences.some(sentence => !sentence)) throw new Error('剧情事实需要包含自然语言')
      variableFacts = VARIABLE_FACTS_HEADER + sentences.join('\n')
      return { accepted: true }
    }

    function inject(args = {}) {
      requestSignal.throwIfAborted()
      if (submitted) throw new Error('本轮已提交 inject')
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('inject 不接收参数')
      submitted = collectToolText()
      return submitted.then(() => ({ accepted: true }))
    }

    try {
      requestSignal.throwIfAborted()
      await untilAborted(Promise.resolve().then(() => entry.prepare({
        gameId, turn: frame.turn, signal: requestSignal,
        listSkills: () => {
          requestSignal.throwIfAborted()
          return sourceReaders.listSkills()
        },
        readSkill: args => read('skill', args),
        findWorldbook: args => read('worldbook', args),
        recallMemory: args => read('memory', args),
        readVariables: args => read('variables', args),
        submitVariableFacts,
        inject,
        runAgent: async task => {
          requestSignal.throwIfAborted()
          const selection = task.selection ?? entry.selection ?? foregroundSelection
          const changes = typeof task.prompt === 'string' && task.prompt.trim() && Array.isArray(task.tools)
            && task.tools.some(tool => tool?.name === 'submit_variable_facts')
            ? await sourceReaders.settledChanges?.() : null
          requestSignal.throwIfAborted()
          if (changes) variableEvidence = true
          const prompt = changes ? task.prompt + '\n\n' + SETTLED_CHANGES_INSTRUCTIONS + '\n' + changes : task.prompt
          return runAgent(entry.owner, { ...task, prompt, gameId, selection, signal: requestSignal }, queryContext, (name, result) => {
            // Keep call order for concurrent tools and reuse the exact model-facing receipt.
            if (!submitted && name !== 'inject' && name !== 'load_writing_skill' && name !== 'submit_variable_facts') toolResults.push(result)
          })
        }
      })), requestSignal)
      requestSignal.throwIfAborted()
      return await (submitted ?? collectToolText())
    } finally {
      done.abort()
    }
  }

  return { register, forGame, prepare }
}
