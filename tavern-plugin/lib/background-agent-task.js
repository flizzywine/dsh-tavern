import { createHostToolPolicy } from './host/tools.js'
import { backgroundRequestTemperature } from './domain/background-request-temperature.js'
import { withWorldbookFileInstructions } from './domain/worldbook-virtual-surface.js'
import { createBackgroundProgress } from './domain/background-progress.js'
import { worldbookSnapshot } from './domain/worldbook-snapshot.js'
import { CARD_SYSTEM_PROMPT_SECTION, cardSystemPromptSnapshot, cardSystemPromptSource } from './domain/card-system-prompt.js'
import { projectCandidateScriptContext } from './domain/candidate-script-context.js'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { prependSystemInstruction } from './domain/system-append.js'
import { backgroundSystemPrompt, backgroundTaskPrompt, usesSharedBackgroundContext, directorTaskTools, assertDirectorToolSurface } from './domain/background-task-prompt.js'
import { markTavernSectionsLiteral } from './domain/literal-sections.js'
import { rewindBackgroundSurface } from './domain/background-surface.js'
import { ensureSessionSystemHead, releaseOpeningTurn, sessionEvents } from './domain/session-events.js'
// expose provider-reported director usage before the temporary agent is disposed.
import { lastDirectorProviderUsage } from './domain/stage-director-tokens.js'
import { randomUUID } from 'node:crypto'
import {
  CHARACTER_DESIGN_FINISH_TOOL,
  createCharacterDesignStage
} from './domain/character-design-stage.js'
import { runtimePresetPhaseMessages } from './domain/runtime-preset-lifecycle.js'
import { ensureSessionStablePrefix, readSessionStablePrefix, sessionStablePrefixSections, withCurrentWorldbook } from './domain/session-stable-prefix.js'
import { promptSection } from './domain/prompt-section.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p002: "You are a Tavern background agent, apart from foreground story generation, doing a one-off plugin task. Output only what the task asks; don't continue the story or change game state yourself. Consult the lorebook and history as needed.",
  p003: "You are a Tavern background agent, apart from foreground story generation. In one story branch you handle state settlement and choice generation in turn; character design runs only when the user explicitly starts it. Follow the task protocol appended to each turn exactly, keeping each task's output format to that task. The latest authoritative state overrides older dynamic state in the session.",
  p004: "The card system prompt below only governs choice text; settlement, filtering, character design and other background tasks follow their own protocols."
})

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Tasks with a prefix of their own (its system prompt and tools only): 精修, a plugin member that
// defines one (tavern.member with `system`), and a director without the shared background context.
function ownsPrefix(input) {
  return input.task === 'polish' || input.ownPrefix === true || !usesSharedBackgroundContext(input)
}

function finalMessage(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const content = event.data && event.data.message && Array.isArray(event.data.message.content) ? event.data.message.content : []
    const text = content.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('').trim()
    if (text !== '') return { text, event, index: Number.isSafeInteger(event.seq) ? event.seq : index }
  }
  return null
}


function terminalError(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'turn/end') continue
    const reason = event.data && event.data.reason
    if (reason?.kind === 'aborted' || reason?.kind === 'interrupted') return new Error('后台 Agent 请求已中断，未完成结果不予提交')
    if (reason !== null && typeof reason === 'object' && reason.kind === 'max-tokens') {
      return new Error('后台 Agent 输出达到模型 token 上限，正式结果尚未生成')
    }
    if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') continue
    const detail = reason.error
    const message = str(detail && detail.message || detail).trim()
    if (message !== '') return new Error(message)
  }
  return null
}

export function maximumBackgroundTokens(selection) {
  const provider = str(selection && selection.provider).trim().toLowerCase()
  const model = str(selection && selection.model).trim().toLowerCase()
  if (provider === 'deepseek-official' && (model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro')) return 384000
  return undefined
}

export function traceError(error, traceSessionId, task) {
  const fallback = task === 'settlement' ? '后台状态结算失败' : task === 'plugin' ? '插件后台任务失败' : '后台候选生成失败'
  const wrapped = new Error(str(error && error.message || error) || fallback, { cause: error })
  wrapped.traceSessionId = traceSessionId
  return wrapped
}

// A task operates on a leased DSH Agent; it does not create or retain sessions.
export function createBackgroundAgentTask(options) {
  const setupAgent = typeof options.setupAgent === 'function' ? options.setupAgent : null
  const sharedBackgroundTools = Array.isArray(options.sharedTools) ? options.sharedTools.filter(function (item) {
    return item && item.tool && typeof item.tool.name === 'string' && typeof item.execute === 'function'
  }) : []
  const sharedByName = new Map(sharedBackgroundTools.map(function (item) { return [item.tool.name, item] }))
  const stableBackgroundTools = []
  const stableNames = new Set()
  const configuredBackgroundTools = Array.isArray(options.backgroundTools) ? options.backgroundTools : []
  const hasCharacterDesignTools = configuredBackgroundTools.some(function (tool) {
    return tool && (tool.name === 'character_design_read' || tool.name === 'character_design_save')
  })
  const backgroundToolCatalog = configuredBackgroundTools
    .concat(hasCharacterDesignTools ? [CHARACTER_DESIGN_FINISH_TOOL] : [])
    .concat(sharedBackgroundTools.map(function (item) { return item.tool }))
  for (const tool of backgroundToolCatalog) {
    if (!tool || typeof tool.name !== 'string' || stableNames.has(tool.name)) continue
    stableNames.add(tool.name)
    stableBackgroundTools.push(tool)
  }
  // Host-owned capability: null when disabled; generation changes with settings,
  // authorization or sources. Readers receive a host anchor, never a model chat id.
  async function resolveReadCapability(input) {
    if (ownsPrefix(input) || input.task === 'stage-director' || !options.resolveSharedReadTools) return null
    const value = await options.resolveSharedReadTools({ sessionId: input.sessionId })
    if (!value) return null
    if (typeof value.generation !== 'string' || !value.generation || typeof value.readHistory !== 'function' ||
      !Array.isArray(value.sources) || value.sources.some(id => typeof id !== 'string' || !id) ||
      (value.sources.length > 0 && typeof value.readSource !== 'function')) throw new TypeError('共享只读工具需要代际、来源 ID 和绑定 reader')
    const sources = [...new Set(value.sources)].sort()
    const tool = sources.length ? {
      name: 'tavern_read_source',
      description: '只读查询当前会话声明来源的锚点原文。仅可读取宿主授权锚点及之前的内容；正文请用 tavern_recall_history。',
      parameters: { type: 'object', additionalProperties: false, required: ['sourceId', 'turn'], properties: {
        sourceId: { type: 'string', enum: sources },
        turn: { type: 'integer', minimum: 1, description: '原文所属剧情轮次，最晚到当前授权锚点那一轮。' },
        para: { type: 'integer', minimum: 0, description: '可选的段落锚点。' }
      } }
    } : null
    return Object.freeze({ key: JSON.stringify([value.generation, sources]), tool,
      readHistory: value.readHistory, readSource: value.readSource })
  }

  async function checkReadCapability(state) {
    const current = await resolveReadCapability(state.input)
    if ((current?.key ?? null) === (state.readCapability?.key ?? null)) return
    state.sharedRequest = null
    state.sharedAnchor = null
    throw Object.assign(new Error('共享只读工具代际已变化，请等待当前后台任务建立新快照'), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  }

  function readTool(state, name) {
    if (!state.readCapability) return null
    if (name === 'tavern_recall_history') return sharedByName.get(name)?.tool
    return state.readCapability.tool?.name === name ? state.readCapability.tool : null
  }

  async function executeReadTool(state, name, args, { anchor, signal, scope }) {
    signal?.throwIfAborted()
    await checkReadCapability(state)
    signal?.throwIfAborted()
    if (!anchor || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('请提供有效查询参数和当前原文锚点')
    const capability = state.readCapability
    const context = { sessionId: state.input.sessionId, anchor: structuredClone(anchor), args, signal, scope }
    if (name === 'tavern_recall_history') {
      if (Object.keys(args).some(key => !Object.hasOwn(sharedByName.get(name).tool.parameters.properties, key))) {
        throw new Error('正文召回仅接受当前会话的查询参数，不能指定外部会话或来源')
      }
      return capability.readHistory(context)
    }
    const sources = capability.tool.parameters.properties.sourceId.enum
    if (Object.keys(args).some(key => !['sourceId', 'turn', 'para'].includes(key)) || !sources.includes(args.sourceId) ||
      !Number.isInteger(args.turn) || args.turn < 1 || args.turn > anchor.turn ||
      (args.para !== undefined && (!Number.isInteger(args.para) || args.para < 0 ||
        args.turn === anchor.turn && anchor.para !== undefined && args.para > anchor.para))) {
      throw new Error('请只查询已声明来源及当前授权锚点以内的轮次、段落')
    }
    return capability.readSource(context)
  }

  // Settlement items (domain/background-pipeline.js): Tavern's optional items and the plugins' tools and notes.
  const settlementItems = () => typeof options.settlementItems === 'function' ? options.settlementItems() : null
  function pluginTools() {
    const tools = settlementItems()?.tools() || []
    return tools.filter(tool => tool && !stableNames.has(tool.name) && !sharedByName.has(tool.name))
  }
  function completedBoundary(events) {
    for (let index = (events || []).length - 1; index >= 0; index--) {
      const event = events[index]
      if (event && event.type === 'turn/end' && Number.isSafeInteger(event.seq)) return event.seq
    }
    return null
  }

  function setupFor(state, descriptor, appendDescriptor) {
    const backgroundPersona = promptSection('background_role', state.input.task === 'plugin'
      ? PROMPT_PROSE.p002
      : PROMPT_PROSE.p003)
    let descriptorAppended = !appendDescriptor
    return async function (childCtx) {
      // Legacy directors retain their exact preview; shared-context directors keep scoped native tools.
      const director = state.input.task === 'stage-director'
      // The preset mount is still required (DSH agent wiring); tools and prompt are narrowed below.
      if (setupAgent !== null) await setupAgent(childCtx)
      if (director) childCtx.tools.presentAs('native')
      state.ctx = childCtx
      if (typeof options.resolveSharedTaskAnchor === 'function') {
        childCtx.on('llm/stream', function (request, next) {
          if (request.sessionId === state.session?.id && state.sharedAnchor && !state.runningSharedTask) {
            const { signal: _signal, ...snapshot } = request
            state.sharedRequest = { anchor: structuredClone(state.sharedAnchor), request: structuredClone(snapshot) }
          }
          return next()
        }, { global: true })
      }
      state.modelSelection = { current: { ...state.input.selection }, assembled: undefined }
      // 0.2.1 routes each request through this mutable selection. 0.2.2 ignores
      // the second argument and only adds the switch notice: the Agent's own
      // model/selection event decides the route (set at creation and on reuse
      // in background-agent-sessions.js). Passing it keeps both host lines.
      installModelSelection(childCtx, state.modelSelection)
      // DSH frames wrap native chunks; argumentsDelta is a fragment,
      // not a snapshot. Attempt + block index isolates retries and parallel calls.
      const directionCalls = new Map()
      childCtx.on('agent/assistant-stream', ({frame}) => {
        state.progress?.frame(frame)
        if (!director || typeof state.input.onToolCallDelta !== 'function') return
        if (frame.type === 'start') { directionCalls.clear(); return }
        const chunk = frame.type === 'chunk' ? frame.chunk : null
        if (chunk?.type !== 'tool-call-delta') return
        const call = directionCalls.get(chunk.index) || { name: '', argumentsText: '', streamId: frame.attemptId + ':' + chunk.index }
        if (chunk.name) call.name = chunk.name
        call.argumentsText += chunk.argumentsDelta || ''
        directionCalls.set(chunk.index, call)
        state.input.onToolCallDelta({ ...call })
      })
      childCtx.on('agent/pre-step', async function ({ agent, turn, step }, next) {
        const decision = await next()
        if (!descriptorAppended && decision.kind === 'enter') {
          descriptorAppended = true
          agent.session.append('subagent/descriptor', descriptor)
        }
        if (decision.kind !== 'enter') return decision
        if (director && !usesSharedBackgroundContext(state.input)) return decision
        const input = state.input || {}
        // A prefix of its own carries no card preset either.
        const snapshot = input.task !== 'polish' && input.ownPrefix !== true && typeof options.resolveRuntimePresetSnapshot === 'function'
          ? await options.resolveRuntimePresetSnapshot({ sessionId: input.sessionId, operation: input.task || 'background' })
          : null
        const messageOptions = { scope: 'background', turn, step }
        if (typeof options.stageRuntimePresetSnapshot === 'function') {
          options.stageRuntimePresetSnapshot({ sessionId: agent.session.id, turn, step, snapshot, scope: 'background' })
        }
        const middleMessages = Number(step) === 1 ? runtimePresetPhaseMessages(snapshot, 'middle', messageOptions) : []
        return middleMessages.length === 0 ? decision : Object.assign({}, decision, {
          messages: middleMessages.concat(decision.messages)
        })
      })
      childCtx.systemPrompt.section({
        name: 'deployment:persona',
        order: 0,
        complete: true,
        // The assembled text carries card and worldbook snapshots verbatim, so a
        // literal {{name}} in them must not be interpolated by the host.
        interpolate: false,
        // DSH restores complete sections after the assembly waterfall, so the
        // additional instruction must be part of this authoritative text.
        text: () => {
          if (ownsPrefix(state.input)) return str(state.input.system)
          // Settlement and candidates share a Session: scope the fixed writing
          // instruction without changing its system prefix when the task switches.
          const fixed = sessionStablePrefixSections(state.session).flatMap(section => {
            if (section.name !== CARD_SYSTEM_PROMPT_SECTION) return [section]
            return [{ ...section, text: promptSection('card_system_scope', PROMPT_PROSE.p004) + '\n\n' + section.text }]
          })
          let sections = state.currentWorldbook === undefined ? fixed : withCurrentWorldbook(fixed, state.currentWorldbook)
          if (state.input.worldbookSkillsEnabled) sections = withWorldbookFileInstructions(sections)
          else sections = sections.filter(section => section.name !== 'tavern:worldbook-skills')
          return backgroundSystemPrompt({ input: state.input, sections,
            persona: backgroundPersona,
            systemAppend: options.systemAppend?.() })
        }
      })
      childCtx.systemPrompt.suppressRuntimeContext()
      childCtx.tools.restrict({ allow: director || ownsPrefix(state.input) ? [] : ['skill', 'read', 'worldbook_list', 'worldbook_grep', 'tavern_read_skill_reference', 'web_search', ...(childCtx.tools.get?.('web_fetch') ? ['web_fetch'] : [])] })
      const hostTools = createHostToolPolicy(childCtx)
      childCtx.on('system-prompt/assemble', async function (_assembly, context, next) {
        return hostTools.assemble(await next(), context, async (assembly, tools) => {
          if (tools) assembly.tools = tools
          if (state.input.task === 'polish' || state.input.ownPrefix === true) {
            const names = new Set((state.input.tools || []).map(tool => tool.name))
            assembly.tools = (assembly.tools || []).filter(tool => names.has(tool.name))
            assembly.sections = (assembly.sections || []).filter(section => !section?.name?.startsWith('tool:') || names.has(section.name.slice(5)))
            markTavernSectionsLiteral(assembly)
            return assembly
          }
          if (director && !usesSharedBackgroundContext(state.input)) return markTavernSectionsLiteral(assembly)
          prependSystemInstruction(assembly, options.systemAppend?.())
          markTavernSectionsLiteral(assembly)
          if (!state.input.worldbookSkillsEnabled) {
            assembly.sections = (assembly.sections || []).filter(section => !['tool:read', 'tool:worldbook_list', 'tool:worldbook_grep'].includes(section?.name))
            assembly.tools = (assembly.tools || []).filter(tool => !['read', 'worldbook_list', 'worldbook_grep'].includes(tool?.name))
          }
          if (state.input.webSearchEnabled === true) return assembly
          assembly.sections = (assembly.sections || []).filter(function (section) { return section && !['tool:web_search', 'tool:web_fetch'].includes(section.name) })
          assembly.tools = (assembly.tools || []).filter(function (tool) { return tool && !['web_search', 'web_fetch'].includes(tool.name) })
          return assembly
        })
      })
      state.refreshConfiguredTools = function () {
        if (director || ownsPrefix(state.input) || state.stableToolDisposers) return
        // Every task sharing this Session sees one fixed tool list: tool definitions sit in the
        // cached request prefix. What a task may call is enforced when the tool executes.
        // Plugin tools join the list when the Session is set up; a plugin loaded later
        // reaches Sessions set up after it.
        state.baseToolCatalog ??= structuredClone(stableBackgroundTools.concat(pluginTools()))
        state.stableToolDisposers = state.baseToolCatalog.concat(state.readCapability?.tool || []).map(function (tool) {
          return childCtx.tools.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: {
              schema: { type: 'string' },
              render: function (_args, value) { return [{ type: 'text', text: value }] }
            },
            async execute(args, execution) {
              const active = state.activeToolTask
              if (active === null || active === undefined) {
                return JSON.stringify({ ok: false, retryable: true, error: '当前没有正在执行的后台任务，请等待下一条任务指令。' })
              }
              return active.execute(tool, args, execution)
            }
          })
        }).filter(function (dispose) { return typeof dispose === 'function' })
      }
      state.refreshConfiguredTools()
      // agent/request only carries model config; tools exist at the LLM boundary.
      if (director) childCtx.on('llm/stream', function (request, next) {
        if (request.sessionId === state.session?.id) assertDirectorToolSurface(state.input, request.tools, state.directorTools)
        return next()
      }, { global: true })
      childCtx.on('agent/request', async function (_payload, next) {
        const input = state.input || {}
        const inherited = await next()
        const { maxTokens: _oldLimit, ...request } = inherited
        const limit = Number.isSafeInteger(input.maxTokens) && input.maxTokens > 0 ? input.maxTokens : maximumBackgroundTokens(input.selection)
        if (limit !== undefined) request.maxTokens = limit
        return backgroundRequestTemperature(request, input, state.characterDesignStage)
      })
    }
  }

  function installTaskTools(state, input, session) {
    let tools = (input.task === 'stage-director' ? directorTaskTools(input, sharedBackgroundTools) : (Array.isArray(input.tools) ? input.tools : []))
    if (input.task === 'stage-director') state.directorTools = tools
    const hasCharacterDesignTools = tools.some(function (tool) {
      return tool && (tool.name === 'character_design_read' || tool.name === 'character_design_save')
    })
    if (hasCharacterDesignTools && !tools.some(function (tool) { return tool && tool.name === CHARACTER_DESIGN_FINISH_TOOL.name })) {
      tools = tools.concat([CHARACTER_DESIGN_FINISH_TOOL])
    }
    const characterDesignStage = hasCharacterDesignTools
      ? createCharacterDesignStage({ temperature: input.characterDesignTemperature })
      : null
    state.characterDesignStage = characterDesignStage
    // director turns end by transaction/model choice, not a call quota.
    const maxToolCalls = input.task === 'stage-director' ? Infinity : Number.isInteger(input.maxToolCalls) && input.maxToolCalls > 0 ? input.maxToolCalls : 8
    let toolCallCount = 0
    let refusedCount = 0
    const readScope = {}
    let removed = false
    const allowed = new Map(tools.map(function (tool) { return [tool.name, tool] }))
    // reply-specific director schemas and own-prefix tasks cannot use the stable background catalogue.
    if ((stableBackgroundTools.length > 0 || state.readCapability) && !['stage-director', 'polish'].includes(input.task) && input.ownPrefix !== true) {
      state.activeToolTask = {
        async execute(tool, args, execution) {
          const registeredShared = sharedByName.get(tool.name)
          const shared = (input.task !== 'character-design' || registeredShared?.allowDuringCharacterDesign === true) ? registeredShared : undefined
          const readable = readTool(state, tool.name)
          const current = readable || allowed.get(tool.name) || (shared && shared.tool)
          if (current === undefined && input.task === 'settlement' && state.settlementCall && settlementItems()?.has(tool.name)) {
            const result = await state.settlementCall(tool.name, args)
            if (result !== undefined) return result
          }
          if (current === undefined) {
            // Refused calls cost no budget, so a model repeating one must still be stopped.
            refusedCount++
            if (refusedCount > maxToolCalls) {
              execution?.concludeTurn?.()
              return JSON.stringify({ ok: false, retryable: false, message: '多次调用了当前任务不允许的工具，本轮结束。' })
            }
            return JSON.stringify({
              ok: false,
              retryable: true,
              error: '当前任务不允许调用 ' + tool.name + '；请改用：' + (Array.from(allowed.keys()).join('、') || '无工具')
            })
          }
          if (typeof input.stopToolsWhen === 'function' && input.stopToolsWhen()) {
            return JSON.stringify({ ok: false, retryable: false, message: '当前任务已经提交完成，请结束本轮。' })
          }
          if (current.countsTowardLimit !== false) {
            toolCallCount++
            if (toolCallCount > maxToolCalls) {
              return JSON.stringify({ ok: false, retryable: false, message: input.toolLimitMessage || '当前任务的工具调用次数已达上限，请结束本轮。' })
            }
          }
          const invoke = async function () {
            input.signal?.throwIfAborted()
            if (readable) return str(await executeReadTool(state, tool.name, args, {
              anchor: state.sharedAnchor, signal: input.signal, scope: readScope
            }))
            return shared
              ? str(await shared.execute({ input, args, execution }))
              : str(await input.onToolCall({ name: tool.name, arguments: args }))
          }
          const result = characterDesignStage
            ? str(await characterDesignStage.execute(tool.name, invoke))
            : await invoke()
          if (typeof input.stopToolsWhen === 'function' && input.stopToolsWhen()) execution?.concludeTurn?.()
          return result
        }
      }
      // A plugin task runs in its own one-off Session: its own tools join the fixed list there.
      const active = state.activeToolTask
      const extraDisposers = input.task === 'plugin' && !state.readCapability ? tools.filter(tool => !stableNames.has(tool.name)).map(tool => state.ctx.tools.register({
        name: tool.name, description: tool.description, parameters: tool.parameters,
        output: { schema: { type: 'string' }, render: function (_args, value) { return [{ type: 'text', text: value }] } },
        execute: (args, execution) => active.execute(tool, args, execution)
      })).filter(dispose => typeof dispose === 'function') : []
      return async function () {
        for (const dispose of extraDisposers.reverse()) await dispose()
        if (state.activeToolTask !== null && state.activeToolTask !== undefined) state.activeToolTask = null
        if (state.characterDesignStage === characterDesignStage) state.characterDesignStage = null
      }
    }
    async function removeTools() {
      if (removed) return
      removed = true
      for (let index = disposers.length - 1; index >= 0; index--) await disposers[index]()
    }
    const disposers = tools.map(function (tool) {
      return state.ctx.tools.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          output: {
            schema: { type: 'string' },
            render: function (_args, value) { return [{ type: 'text', text: value }] }
          },
          async execute(args, execution) {
            // ignore parallel/late submissions after terminal acceptance.
            if (input.task === 'stage-director' && input.stopToolsWhen?.()) {
              execution?.concludeTurn?.()
              return str(await input.onToolCall({name:tool.name,arguments:args}))
            }
            if (input.task === 'polish' && input.stopToolsWhen?.()) return JSON.stringify({ ok: false, error: '本次精修已完成。' })
            if (tool.countsTowardLimit !== false) {
              toolCallCount++
              if (toolCallCount > maxToolCalls) {
                if (input.task === 'polish') execution?.concludeTurn?.()
                return JSON.stringify({ message: input.toolLimitMessage || '已达到剧本查询上限，请停止查询，基于已有材料开始推理并输出最终候选。' })
              }
            }
            const call = { name: tool.name, arguments: args }
            const shared = input.task === 'stage-director' && usesSharedBackgroundContext(input) ? sharedByName.get(tool.name) : undefined
            const invoke = async function () {
              input.signal?.throwIfAborted()
              return shared ? str(await shared.execute({ input, args, execution })) : str(await input.onToolCall(call, { signal: input.signal }))
            }
            const result = characterDesignStage
              ? str(await characterDesignStage.execute(tool.name, invoke))
              : await invoke()
            if (typeof input.stopToolsWhen === 'function') {
              const complete = input.stopToolsWhen()
              if (complete) execution?.concludeTurn?.()
              if (input.task !== 'polish' && (complete || toolCallCount >= maxToolCalls)) await removeTools()
            }
            // Rejections are native tool errors, not successful submissions. The
            // same session/step budget remains available for the model's repair.
            if (input.task === 'stage-director' && !shared) {
              const feedback = JSON.parse(result)
              if (feedback.retryable && feedback.errors?.length) throw new Error(result)
            }
            return result
          }
        })
    }).filter(function (dispose) { return typeof dispose === 'function' })
    return async function () {
      await removeTools()
      if (state.characterDesignStage === characterDesignStage) state.characterDesignStage = null
    }
  }

  // Hide the latest task (its request and everything after) from the model's
  // surface in the same Session; raw events stay for the trace. Fixed seeds remain.
  async function undoLastTask(session, traceSessionId, agent) {
    const events = new Map(sessionEvents(session).map(event => [event.seq, event]))
    const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []
    const start = nodes.findLast(seq => {
      const event = events.get(seq)
      return event?.type === 'user/message' && !String(event.data?.id || '').startsWith('tavern-session-prefix:')
    })
    if (start === undefined) return { traceSessionId, undone: false }
    try { rewindBackgroundSurface(session, start - 1, agent) }
    catch (error) { throw new Error('撤销失败，对话未改变。原因：' + str(error?.message || error), { cause: error }) }
    if (typeof options.flushSession === 'function') await options.flushSession(session)
    return { traceSessionId, undone: true }
  }

  async function execute({ agent, state, traceSessionId, persistent }, input) {
    state.session = agent.session
    state.sharedRequest = null
    state.sharedAnchor = null
    if (input.undoLastTask === true) return undoLastTask(agent.session, traceSessionId, agent)
    const runtimeInput = state.input
    state.sharedAnchor = persistent && !ownsPrefix(input) && typeof options.resolveSharedTaskAnchor === 'function'
      ? await options.resolveSharedTaskAnchor(input) : null
    try { rewindBackgroundSurface(agent.session, input.rewindTo, agent, input.rewindFormatVersion || 3) }
    catch (error) {
      const failure = new Error('后台历史回退失败，本次任务已停止，未基于旧上下文继续执行。原因：' + str(error?.message || error), { cause: error })
      failure.code = 'BACKGROUND_REWIND_FAILED'
      throw failure
    }
    const progress = createBackgroundProgress({idleMs:options.modelIdleTimeoutMs, onCancel:()=>{state.abandoned=true;agent.cancel?.({kind:'user'})}})
    state.progress=progress
    runtimeInput.signal=input.signal ? AbortSignal.any([input.signal,progress.signal]) : progress.signal
    const removeTaskTools = installTaskTools(state, runtimeInput, agent.session)
    const items = input.task === 'settlement' ? settlementItems() : null
    const pluginContext = { gameId: str(input.sessionId), turn: Math.max(0, Number(input.turn) || 0) }
    state.settlementCall = items ? items.calls(pluginContext, { stopped: () => typeof input.stopToolsWhen === 'function' && input.stopToolsWhen() }) : null
    const cancel = () => progress.cancel()
    input.signal?.addEventListener('abort', cancel, { once: true })

    try {
      input.signal?.throwIfAborted()
      if (persistent && typeof input.onPersistentSessionReady === 'function') {
        // Persist the native session before publishing its identity, even if the first task fails.
        if (typeof options.flushSession === 'function') await options.flushSession(agent.session)
        await input.onPersistentSessionReady(traceSessionId)
      }
      // keep native tool-call/result history untouched between correction steps.
      const director = input.task === 'stage-director'
      const sharedContext = !ownsPrefix(input)
      if (sharedContext) {
        const existing = readSessionStablePrefix(agent.session)
        const revision = typeof options.resolveStablePrefixRevision === 'function' ? await options.resolveStablePrefixRevision(input) : 0
        const background = existing && revision <= existing.revision ? existing.text : typeof options.resolveStablePrefix === 'function'
          ? await options.resolveStablePrefix(input) : input.backgroundContext
        const prefix = await ensureSessionStablePrefix(agent.session, background, options.stablePrefixStorage, revision)
        // A background session never appends a greeting, so the turn reserved
        // with its system head must close before this task opens its own turn.
        releaseOpeningTurn(agent.session, agent)
        if (prefix && prefix.event !== existing?.event && typeof options.flushSession === 'function') await options.flushSession(agent.session)
      }
      else {
        if (input.task === 'polish') ensureSessionSystemHead(agent.session)
        releaseOpeningTurn(agent.session, agent)
      }
      const projectsWorldbook = sharedContext
      const worldbook = projectsWorldbook && typeof options.resolveCurrentWorldbook === 'function'
        ? await options.resolveCurrentWorldbook(input) : undefined
      if (projectsWorldbook) state.currentWorldbook = worldbook && typeof worldbook === 'object' ? worldbook.prefixContext : worldbook
      const turnWorldbookSource = worldbook
      const turnWorldbook = turnWorldbookSource && typeof turnWorldbookSource === 'object' ? str(turnWorldbookSource.foregroundContext).trim() : ''
      const eventStart = sessionEvents(agent.session).length
      const scriptContext = projectCandidateScriptContext(agent.session, input)
      const snapshot = turnWorldbookSource && typeof turnWorldbookSource === 'object'
        ? worldbookSnapshot(agent.session, [{ ref: 'background:worldbook', text: turnWorldbook }]) : null
      const systemUpdate = input.task === 'candidate' && typeof input.systemPromptText === 'string'
        ? cardSystemPromptSnapshot(agent.session, input.systemPromptText) : null
      // Tool definitions stay fixed for the cache; which ones may be called is stated each
      // turn, so a plugin turned off and on again is usable without stale refusals.
      const settlementText = items ? await items.text(pluginContext) : ''
      const candidateNotes = input.task === 'candidate' && typeof options.pluginCandidate === 'function'
        ? await options.pluginCandidate()?.sections(pluginContext).catch(() => []) || [] : []
      const candidateText = candidateNotes.length ? promptSection('plugin_task', promptSection('plugin_choice_requirements', candidateNotes.map(note => note.text).join('\n\n'))) : ''
      const ownTaskText = input.task === 'polish' || input.ownPrefix === true
      const taskText = ownTaskText ? (typeof input.taskText === 'function' ? input.taskText() : input.taskText)
        : backgroundTaskPrompt({ input, turnContext: scriptContext?.turnContext ?? input.turnContext, worldbook: snapshot, systemUpdate,
          pluginText: [settlementText, candidateText].filter(Boolean).join('\n\n') })
      if (!sharedContext && !ownTaskText) {
        for (const message of input.messages || []) agent.followup({ ...message, id: randomUUID(), source: message.source || { kind: 'plugin:dsh-tavern' } })
      } else agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: taskText }],
        source: { kind: 'plugin:dsh-tavern', ...(systemUpdate ? { trace: cardSystemPromptSource(systemUpdate) } : {}), ...(snapshot ? { worldbookSnapshot: snapshot } : {}), ...(scriptContext?.body ? {
          candidateScriptWindow: { version: 1, start: taskText.indexOf(scriptContext.body), length: scriptContext.body.length, digest: scriptContext.digest }
        } : {}) }
      })
      await progress.wait(agent.whenIdle())
      input.signal?.throwIfAborted()
      // Transport failure must not become success after an earlier tool submission,
      // including settlement and candidate tasks, not only the director.
      if (director) {
        const usage = lastDirectorProviderUsage(sessionEvents(agent.session), eventStart)
        if (usage) input.onProviderUsage?.(usage)
      }
      const transportFailure = terminalError(sessionEvents(agent.session), eventStart)
      if (transportFailure !== null) throw transportFailure
      const rawResult = finalMessage(sessionEvents(agent.session), eventStart)
      if (rawResult === null) {
        if (typeof runtimeInput.acceptWithoutText !== 'function' || runtimeInput.acceptWithoutText() !== true) {
          if (director) throw new Error('导演模型没有调用工具，请换一个支持工具调用的模型')
          throw new Error(input.task === 'settlement' ? '后台 Agent 没有返回结算文本' : input.task === 'plugin' ? '后台 Agent 没有返回任务结果' : '后台 Agent 没有返回候选文本')
        }
      }
      if (input.task === 'polish') await options.flushSession?.(agent.session)
      const text = rawResult === null ? '' : rawResult.text.trim()
      return { text, traceSessionId, persistent, traceBoundary: completedBoundary(sessionEvents(agent.session)) }
    } catch (error) {
      throw traceError(error, traceSessionId, input.task)
    } finally {
      progress.dispose()
      state.progress=null
      input.signal?.removeEventListener('abort', cancel)
      state.settlementCall = null
      await removeTaskTools()
    }
  }

  async function runSharedTask(state, { instruction, signal }) {
    // Loaded only when a shared task runs, like model-calls' tool rounds: hosts without the SDK never import it.
    const { BlockAssembler, createToolResultMessage, createUserMessage } = await import('@deepseek-ai/dsh-llm')
    const snapshot = state.sharedRequest.request
    const request = { ...structuredClone(snapshot), signal,
      messages: [...structuredClone(snapshot.messages), createUserMessage({
        content: [{ type: 'text', text: instruction }], source: { kind: 'plugin:dsh-tavern' }
      })] }
    const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null), 'utf8')
    // JSON UTF-8 at llm/stream, before adapter projection; system is a subset
    // of messages, not an additional request field or an additive section.
    const measurement = { scope: 'pre-adapter', sections: {
      system: bytes(snapshot.messages.filter(message => message.role === 'system')),
      messages: bytes(snapshot.messages), instruction: bytes(instruction)
    }, toolSchemaBytes: bytes(request.tools ?? []) }
    const progress = createBackgroundProgress({ idleMs: options.modelIdleTimeoutMs, onCancel: () => {
      state.sharedRequest = null
      state.sharedAnchor = null
    } })
    state.progress = progress
    request.signal = signal ? AbortSignal.any([signal, progress.signal]) : progress.signal
    const cancel = () => progress.cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    let usage
    let toolCalls = 0
    const readScope = {}
    const maxToolCalls = Number.isInteger(state.input.maxToolCalls) && state.input.maxToolCalls > 0 ? state.input.maxToolCalls : 8
    state.runningSharedTask = true
    try {
      request.signal.throwIfAborted()
      return await progress.wait((async () => {
        for (let step = 0; step <= maxToolCalls; step++) {
          request.signal.throwIfAborted()
          await checkReadCapability(state)
          request.signal.throwIfAborted()
          const attemptId = 'shared:' + step
          const assembled = new BlockAssembler()
          let finished = false
          progress.frame({ type: 'start', attemptId })
          for await (const chunk of state.ctx.llm.stream(request)) {
            progress.frame({ type: 'chunk', attemptId, chunk })
            request.signal.throwIfAborted()
            assembled.push(chunk)
            if (chunk.type === 'finish') finished = true
          }
          progress.frame({ type: 'end', attemptId })
          request.signal.throwIfAborted()
          await checkReadCapability(state)
          request.signal.throwIfAborted()
          if (!finished) throw new Error('共享后台任务缺少完成信号')
          if (assembled.finish.kind !== 'stop') throw new Error(assembled.finish.failure?.message || '共享后台任务未正常完成')
          if (assembled.usage) {
            usage ??= {}
            for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
              if (assembled.usage[key] !== undefined) usage[key] = (usage[key] || 0) + assembled.usage[key]
            }
          }
          const message = assembled.message({ provider: request.provider, model: request.model,
            ...(assembled.replayState === undefined ? {} : { replayState: assembled.replayState }) })
          const calls = message.content.filter(block => block.type === 'tool-call')
          if (!calls.length) return { output: message.content.filter(block => block.type === 'text').map(block => block.text).join(''), usage, measurement }
          if (step === maxToolCalls) throw new Error('共享后台任务工具调用已达上限，请使用已有资料完成任务')
          request.messages.push(message)
          for (const call of calls) {
            request.signal.throwIfAborted()
            let text, isError = false
            try {
              if (++toolCalls > maxToolCalls) throw new Error('工具调用已达上限，请使用已有资料完成任务')
              if (!request.tools?.some(tool => tool.name === call.name) || !readTool(state, call.name)) {
                throw new Error('本任务只允许已授权的只读原文查询，不能执行 ' + call.name + '；请改用只读工具或直接完成任务')
              }
              const args = call.arguments ? JSON.parse(call.arguments) : {}
              text = str(await executeReadTool(state, call.name, args, {
                anchor: state.sharedRequest.anchor, signal: request.signal, scope: readScope
              }))
              request.signal.throwIfAborted()
            } catch (error) {
              request.signal.throwIfAborted()
              if (error.code === 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE') throw error
              isError = true
              text = JSON.stringify({ ok: false, retryable: toolCalls < maxToolCalls, error: str(error.message) })
            }
            request.messages.push(createToolResultMessage({ callId: call.id, content: [{ type: 'text', text }], isError }))
          }
        }
      })())
    } finally {
      progress.dispose()
      state.progress = null
      signal?.removeEventListener('abort', cancel)
      state.runningSharedTask = false
    }
  }

  return Object.freeze({ setup: setupFor, execute, runSharedTask, resolveReadCapability, checkReadCapability })
}
