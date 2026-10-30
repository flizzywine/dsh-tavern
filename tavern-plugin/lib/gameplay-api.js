import { randomUUID, createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { selectCandidate } from './domain/candidate-selection.js'

// A transport facade over the production conversation and native Session services.
// No prompt construction, worldbook selection, settlement or model loop lives here.
export function createGameplayApi(deps) {
  const { controller, registry, llm, store, dispatch, chatForSession } = deps
  const locks = new Set()
  async function owned(sessionId) {
    if (typeof sessionId !== 'string' || !/^test-[a-f0-9-]{36}$/.test(sessionId)) throw new Error('需要测试 API 创建的独立会话')
    const owner = await store.readJson('automation/' + sessionId + '.json')
    if (!owner) throw new Error('测试会话不存在')
    return owner
  }
  async function call(method, args = {}) {
    if (method === 'capabilities') return { version: 1, transport: 'production-session', browserScriptRuntime: false }
    if (method === 'cards') return { cards: await deps.listCards() }
    if (method === 'create') {
      if (!['story', 'card'].includes(args.mode || 'story')) throw new Error('不支持的游戏模式')
      const cards = await deps.listCards()
      let cardPath = ''
      if (args.sourceCard) {
        if (typeof args.sourceCard !== 'string' || /[/\\]|^\./.test(args.sourceCard)) throw new Error('sourceCard 必须是文件名')
        cardPath = 'cards/' + args.sourceCard
        if (!cards.some(card => card.path === cardPath)) throw new Error('正式酒馆没有该人物卡')
      } else if (args.cardName) {
        const matches = cards.filter(card => card.name === args.cardName)
        if (matches.length !== 1) throw new Error('人物卡名称不存在或不唯一，请引用 sourceCard 文件名')
        cardPath = matches[0].path
      }
      if (!cardPath && args.mode !== 'card') throw new Error('需要正式人物卡文件名')
      // rc.1 selectModel also saves the global default. Reuse its native selection
      // controller below without that side effect; fail closed on incompatible hosts.
      const host = controller()
      if (typeof host?.agents?.selectForNextRequest !== 'function') throw new Error('DSH 不支持独立会话模型选择')
      if (!args.model?.provider || !args.model?.model) throw new Error('需要 provider 和 model')
      const resolved = await llm.resolveCallConfig(args.model)
      const selected = { provider: resolved.provider, model: resolved.model, ...(resolved.reasoningEffort ? { reasoningEffort: resolved.reasoningEffort } : {}) }
      const sessionId = 'test-' + randomUUID()
      await store.writeJson('automation/' + sessionId + '.json', { sessionId, createdAt: Date.now(), model: selected })
      try {
        await host.create({ sessionId, cwd: path.join(deps.dataRoot, 'resources'), agentPreset: 'tavern' })
        await dispatch('preparePlayStart', {})
        await dispatch('startChat', { path: cardPath, sessionId, mode: args.mode || 'story', userName: args.userName || '你', requestMode: 'dsh', cardTask: args.mode === 'card' ? (cardPath ? 'edit' : 'create') : undefined })
        // startChat applies the player's defaults; the test override must follow it.
        host.agents.selectForNextRequest(registry.get(sessionId), selected)
        const chat = await chatForSession(sessionId)
        return { sessionId, chat, model: selected, requiresBrowser: chat.mode !== 'card' && await deps.requiresBrowser(chat) }
      } catch (error) {
        // Keep the partially initialized identity recoverable in failure reports.
        return { sessionId, chat: await chatForSession(sessionId), error: String(error.message || error) }
      }
    }
    const owner = await owned(args.sessionId)
    const chat = await chatForSession(args.sessionId)
    if (method === 'native') {
      const id = args.nativeSessionId || args.sessionId
      if (id !== args.sessionId && !(await deps.requestIndex(chat)).some(request => request.sessionId === id)) throw new Error('该 Agent 不属于本次测试')
      return { events: await deps.native(id) }
    }
    if (method === 'state') return { chat, activity: (await dispatch('getSessionActivity', args)).activity }
    if (method === 'requests') return { requests: chat ? await deps.requests(chat) : [] }
    if (method === 'resources') {
      const result = {}
      for (const entry of await readdir(path.join(deps.dataRoot, 'resources'), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const file = path.join(entry.parentPath || entry.path, entry.name)
        const content = await readFile(file)
        result[path.relative(deps.dataRoot, file)] = { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }
      }
      return { resources: result }
    }
    if (method === 'cancel') {
      if (registry.get(args.sessionId)) await controller().cancel({ sessionId: args.sessionId })
      if (chat) {
        const activity = (await dispatch('getSessionActivity', args)).activity
        if (activity?.busy) await dispatch('stopBackground', { sessionId: args.sessionId, operationId: activity.operationId })
      }
      if (owner.image) {
        const { illustration } = await dispatch('sceneImageStatus', { sessionId: args.sessionId, turn: owner.image.turn })
        if (illustration.status === 'running' && illustration.requestId === owner.image.requestId) await dispatch('cancelSceneImage', { sessionId: args.sessionId, ...owner.image })
      }
      return { cancelled: true }
    }
    if (!chat) throw new Error('测试对话尚未初始化')
    if (method === 'imageStatus') {
      const last = chat.messages.findLast(message => message.role === 'assistant')
      const { illustration } = await dispatch('sceneImageStatus', { sessionId: args.sessionId, turn: Number(last?.turn || 1) })
      return { target: { key: illustration.key, turn: illustration.turn }, record: illustration }
    }
    if (locks.has(args.sessionId)) throw new Error('会话已有操作正在提交')
    locks.add(args.sessionId)
    try {
      if (method === 'send') {
        if (chat.mode !== 'card' && await deps.requiresBrowser(chat)) throw new Error('此卡需要正式浏览器脚本运行时，当前纯 API 尚未提供；没有发送输入')
        const activity = (await dispatch('getSessionActivity', args)).activity
        if (activity?.busy || registry.get(args.sessionId)?.phase?.kind === 'running') throw new Error('上一轮尚未完成')
        const selection = args.inputFrom ? selectCandidate(chat.candidates, args.inputFrom, args.previousRequestId) : null
        const input = selection?.input ?? args.input
        if (typeof input !== 'string' || !input.trim() || input.length > 1000000) throw new Error('输入为空或过长')
        controller().agents.selectForNextRequest(registry.get(args.sessionId), owner.model)
        await controller().prompt({ sessionId: args.sessionId, requestId: randomUUID(), content: [{ type: 'text', text: input }], mode: 'followup' }, new AbortController().signal)
        return { accepted: true, input, selection }
      }
      if (method === 'candidates') {
        const view = (await dispatch('getSession', args)).view
        return await dispatch('submitTask', { sessionId: args.sessionId, kind: 'candidate', requestId: args.requestId || randomUUID(), messageId: view.latestAssistantMessageId })
      }
      if (method === 'image') {
        const { target } = await call('imageStatus', args)
        const image = { ...target, requestId: args.requestId || randomUUID() }
        await store.writeJson('automation/' + args.sessionId + '.json', { ...owner, image })
        return await dispatch('generateSceneImage', { sessionId: args.sessionId, ...image })
      }
      throw new Error('未知游戏 API 方法')
    } finally { locks.delete(args.sessionId) }
  }
  return { call }
}
