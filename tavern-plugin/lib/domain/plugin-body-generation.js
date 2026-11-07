import { bodyGenerationFailure, bodyGenerationError } from './body-generation-failure.js'
import { createHash, randomUUID } from 'node:crypto'
import { buildBodyRegenerationMaterials, findBodyRegenerationFrame } from './body-regeneration-materials.js'
import { activeStoryTurn, STORY_GENERATE_TOOL_NAME } from './story-tool-submission.js'
import { untilAborted } from './plugin-callback.js'
import { inputEventForTurn } from './session-turn-input.js'
import { inputAttachments } from './player-input-content.js'
import { replayablePersistedTurn } from './rollback-surface.js'
import { bodyGenerationWorldbookResults } from './body-generation-worldbook.js'

export const BODY_GENERATION_PROMPT = '<output_method>本轮正文由插件生成。最终必须调用 tavern_generate_body，参数为 {}。不得自行撰写正文，不得调用 submit_story（历史中的调用仅是旧正文记录）。工具会取得完整材料、生成并提交正文；成功后结束本轮，不要转述或补充回复。调用失败则停止，不要换用其他生成方式或重试。</output_method>'
const routeMismatch = Symbol('body-generation-route-mismatch')
const error = (message, stage) => Object.assign(new Error(message), {
  code: 'TAVERN_PLUGIN_BODY_GENERATION_FAILED', ...(stage ? { stage, [routeMismatch]: stage === 'route' } : {}) })
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function configuredBodyGeneration(chat, settings) {
  return { mode: chat?.storyGenerationMode ?? settings?.storyGenerationMode ?? 'host',
    provider: chat?.storyGenerationProvider ?? settings?.storyGenerationProvider ?? '' }
}

/** The selected route is frozen in the frame; changing global settings affects the next turn. */
export function bodyGenerationRoute(chat, settings, turn) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) return { mode: 'host', provider: '' }
  const frames = Object.values(chat?.foregroundFrames || {})
  const frame = turn ? frames.findLast(item => Number(item.turn) === Number(turn)) : frames.findLast(item =>
    chat?.timeline?.operations?.[item.operationId]?.status === 'running')
  return frame?.source?.bodyGeneration || configuredBodyGeneration(chat, settings)
}

export function createPluginBodyGeneration({ chatForSession, routeChatForSession = chatForSession, readRevision, updateChat, settings, providers,
  isBackground = () => false, isWorldbookPath = () => false, regenerateWithProvider }) {
  const tasks = new Map(), regenerations = new Map()
  async function route(sessionId, turn) {
    const chat = await routeChatForSession(sessionId)
    const control = chat && ['story', 'script'].includes(chat.mode || 'story') ? await providers.controlRoute?.(sessionId) : null
    return bodyGenerationRoute(control ? { ...chat, storyGenerationMode: control.mode, storyGenerationProvider: control.provider } : chat, await settings(), turn)
  }
  async function materialsFor(chat, turn) {
    const frame = findBodyRegenerationFrame(chat, turn)
    const op = chat.timeline?.operations?.[frame?.operationId]
    if (!frame || !op || op.status !== 'running' || frame.branchId !== chat.timeline?.branchId
      || frame.basedOnRevision !== chat.timeline?.revision) throw error('本轮正文生成操作已过期')
    const beforeChat = await readRevision(chat.id, op.beforeRevision)
    return buildBodyRegenerationMaterials({ chat, beforeChat, turn, operationId: op.id, kind: 'generate',
      targetInput: { raw: frame.userInput.sourceText } })
  }
  async function generate(session, signal) {
    const turn = activeStoryTurn(session)
    const chat = await chatForSession(session.id)
    // The prompt contract and visibleTools both gate on route(sessionId), which
    // reads the frame of the running operation. Looking the frame up by turn
    // here can disagree after a crashed turn left an older operation running:
    // the model is then told to call a tool that reports itself disabled.
    const selected = await route(session.id)
    if (!turn || !['story', 'script'].includes(chat?.mode || 'story') || !selected.mode?.startsWith('plugin-')) throw error('当前回合未启用插件正文生成', 'route')
    if (inputAttachments(inputEventForTurn(session, turn)?.data?.content).length) throw error('插件正文生成目前只支持文本输入，请移除本轮附件或切换为宿主生成')
    let materials = await materialsFor(chat, turn)
    const operationId = materials.target.operationId
    const key = chat.id + ':' + operationId
    const existing = chat.timeline.operations[operationId].bodyGeneration
    if (existing?.status === 'ready' && existing.materialsDigest === materials.digest) {
      signal.throwIfAborted()
      await providers.require(selected.provider, session.id)
      return existing.receipt
    }
    signal.throwIfAborted()
    if (tasks.has(key)) return untilAborted(tasks.get(key), signal)
    if (existing) throw bodyGenerationError(existing.failure ? { failure: existing.failure } : existing.error || '上次插件生成未完成；请重新生成本轮，避免重复请求模型')
    const toolResults = bodyGenerationWorldbookResults(session, turn, isWorldbookPath)
    const validate = async current => {
      signal.throwIfAborted()
      if (activeStoryTurn(session) !== turn || (await materialsFor(current, turn)).digest !== materials.digest) throw error('生成期间本轮输入、历史或状态已变化')
    }
    const run = async () => {
      await updateChat(chat.id, async current => {
        await validate(current)
        if (current.timeline.operations[operationId].bodyGeneration) throw error('本轮插件生成已启动')
        // Freeze the lookup supplement with the original frame before the paid
        // request. Receipt validation, restarts and regeneration reuse it even
        // after the native tool messages have been folded or removed.
        const frame = findBodyRegenerationFrame(current, turn)
        frame.source = { ...frame.source, bodyGenerationToolResults: toolResults }
        materials = await materialsFor(current, turn)
        current.timeline.operations[operationId].bodyGeneration = { status: 'running', materialsDigest: materials.digest, provider: selected.provider }
        return current
      }, { source: 'foreground.plugin-generation-start' })
      try {
        const snapshot = selected.snapshot || await providers.prepare(selected.provider, { gameId: session.id, reason: 'normal', signal })
        await updateChat(chat.id, async current => {
          await validate(current)
          current.timeline.operations[operationId].bodyGeneration.snapshot = snapshot
          return current
        }, { source: 'foreground.plugin-generation-config' })
        const result = await providers.generate(selected.provider, { materials, snapshot, signal })
        const receipt = { version: 1, operationId, text: result.text, digest: digest(result.text) }
        await updateChat(chat.id, async current => {
          await validate(current)
          const provider = await providers.require(selected.provider, session.id)
          if (provider.registration !== snapshot.registration) throw error('正文生成插件已更换，请重新生成')
          signal.throwIfAborted()
          current.timeline.operations[operationId].bodyGeneration = {
            status: 'ready', materialsDigest: materials.digest, provider: selected.provider, receipt
          }
          return current
        }, { source: 'foreground.plugin-generation-ready' })
        signal.throwIfAborted()
        return receipt
      } catch (cause) {
        await updateChat(chat.id, current => {
          const operation = current.timeline?.operations?.[operationId]
          if (operation?.status !== 'running' || !['running', ...(signal.aborted ? ['ready'] : [])].includes(operation.bodyGeneration?.status)) return undefined
          operation.bodyGeneration = { ...operation.bodyGeneration, status: 'failed', error: bodyGenerationFailure(cause).message, failure: bodyGenerationFailure(cause) }
          return current
        }, { source: 'foreground.plugin-generation-failed' })
        throw cause
      }
    }
    const pending = Promise.resolve().then(run)
    tasks.set(key, pending)
    try { return await pending } finally { tasks.delete(key) }
  }
  return {
    route,
    async prepare(sessionId) {
      const selected = await route(sessionId)
      if (!selected.mode?.startsWith('plugin-') || selected.snapshot) return selected
      return { ...selected, snapshot: await providers.prepare(selected.provider, { gameId: sessionId, reason: 'normal' }) }
    },
    async direct(session, signal) {
      if (!session || isBackground(session.id)) return null
      const selected = await route(session.id, activeStoryTurn(session))
      if (selected.mode !== 'plugin-direct') return null
      signal?.throwIfAborted()
      // Dispatch the host tool locally through the native loop; no foreground model request.
      return (async function * () {
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: randomUUID(), name: STORY_GENERATE_TOOL_NAME, arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      })()
    },
    async validateResult(session, turn, result) {
      const selected = await route(session.id, turn)
      if (!selected.mode?.startsWith('plugin-')) return
      await providers.require(selected.provider, session.id)
      const chat = await chatForSession(session.id)
      const frame = findBodyRegenerationFrame(chat, turn)
      const stored = chat?.timeline?.operations?.[frame?.operationId]?.bodyGeneration
      if (!result?.pluginBodyGeneration || stored?.status !== 'ready' || stored.receipt.text.trim() !== result.text
        || stored.receipt.operationId !== result.operationId) throw bodyGenerationError(stored?.failure || result?.failure ? { failure: stored?.failure || result.failure } : stored?.error || result?.generationError || '本轮未通过正文生成插件成功提交，请重新生成')
      if ((await materialsFor(chat, turn)).digest !== stored.materialsDigest) throw error('插件正文对应的材料已过期')
    },
    tool: {
      name: STORY_GENERATE_TOOL_NAME,
      description: '仅在本局启用插件生成时调用，由已选插件生成并提交本轮完整正文。无需参数；成功后结束本轮。未启用时不要调用，应直接撰写正文。',
      parameters: {},
      output: { schema: { type: 'string' }, render(_args, value) { return [{ type: 'text', text: value }] } },
      isConcurrencySafe() { return false },
      async execute(args, exec) {
        const session = exec?.agent?.session
        if (!session?.id || isBackground(session.id)) throw error('正文生成工具只用于前台游玩回合')
        if (args && Object.keys(args).length) throw error('正文生成工具不接受参数')
        if (typeof exec.concludeTurn !== 'function') throw error('当前 DSH 不支持工具结束回合，请更新 DSH')
        exec.signal.throwIfAborted()
        try {
          const receipt = await generate(session, exec.signal)
          exec.signal.throwIfAborted()
          exec.concludeTurn()
          return JSON.stringify(receipt)
        } catch (cause) {
          if (exec.signal.aborted) throw cause
          const failure = bodyGenerationFailure(cause)
          // A route mismatch is decided before any paid request. Hosts that
          // overwrite the tool list still expose this tool when plugin generation
          // is off; ending the turn here would leave an empty reply. Report a
          // real tool error instead so the model can still write the prose.
          if (cause?.[routeMismatch]) {
            throw bodyGenerationError({ ...failure,
              message: `${failure.message}；请直接撰写本轮正文，不要调用 ${STORY_GENERATE_TOOL_NAME}` }, 'route')
          }
          // A paid failure is terminal: a typed receipt stops the loop without
          // letting the model silently retry the request; turn-stopping rejects
          // the receipt as a body.
          exec.concludeTurn()
          return JSON.stringify({ version: 1, status: 'failed', message: failure.message, failure })
        }
      }
    },
    async regenerate(gameId, guidance = '') {
      const selection = await providers.controlRoute?.(gameId) || configuredBodyGeneration(await routeChatForSession(gameId), await settings())
      const selected = { storyGenerationMode: selection.mode, storyGenerationProvider: selection.provider }
      if (!selected.storyGenerationMode?.startsWith('plugin-')) return null
      // A persisted tail user has no assistant body of its own to replace: the
      // native path regenerates the round the caller picked instead.
      if (replayablePersistedTurn(await chatForSession(gameId))) return null
      if (regenerations.has(gameId)) throw error('正文正在重新生成')
      const provider = await providers.require(selected.storyGenerationProvider, gameId)
      if (regenerations.has(gameId)) throw error('正文正在重新生成')
      const controller = new AbortController(), task = { controller, pending: null, committed: false }
      const pending = Promise.resolve().then(() => regenerateWithProvider({ gameId, signal: controller.signal,
        onPhase: phase => { if (phase === 'committed') task.committed = true },
        providerId: selected.storyGenerationProvider,
        prepare: input => providers.prepare(selected.storyGenerationProvider, input),
        guidance,
        validateProvider: async () => {
          if (await providers.require(selected.storyGenerationProvider, gameId) !== provider) throw error('正文生成插件已更换，请重新生成')
        },
        generate: async ({ materials, signal, snapshot }) => {
          try { return await providers.generate(selected.storyGenerationProvider, { materials, signal, snapshot }) }
          catch (cause) { throw bodyGenerationError(cause) }
        } }))
      task.pending = pending
      regenerations.set(gameId, task)
      try { return await pending } catch (cause) { throw bodyGenerationError(cause, 'regenerate') } finally { if (regenerations.get(gameId) === task) regenerations.delete(gameId) }
    },
    async cancelRegeneration(gameId) {
      const task = regenerations.get(gameId)
      if (!task) return false
      if (task.committed) return true
      task.controller.abort(error('用户已取消重新生成'))
      await task.pending.catch(() => {})
      return true
    }
  }
}
