import { randomUUID } from 'node:crypto'
import { assertPluginJson } from './tavern-chat-plugin-data.js'
import { gameModeForegroundId } from './game-mode-foreground.js'

const clone = value => structuredClone(value)
const keyPattern = /^[a-z][a-z0-9._-]{0,63}$/
function json(value) {
  assertPluginJson({ value })
  if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) throw new Error('玩法快照超过 8 MB')
  return clone(value)
}

// One durable document is the transaction: cursor, snapshots and accepted actions.
// Agents are disposable executors; only the state returned by advance is authoritative.
export function createPluginGameModes({ read, write, allowed, runAgent, foreground, changed = () => {}, timeoutMs = 600000 }) {
  const providers = new Map(), running = new Map()
  function register(owner, input) {
    if (!keyPattern.test(input?.name) || !Number.isSafeInteger(input?.version) || input.version < 1) throw new Error('玩法需要 name 和正整数 version')
    for (const name of ['create', 'advance', 'project']) if (typeof input[name] !== 'function') throw new Error('玩法需要 ' + name)
    const key = owner + ':' + input.name
    if (providers.has(key)) throw new Error('玩法已注册：' + key)
    const provider = { ...input, owner, key }
    providers.set(key, provider)
    return () => {
      providers.delete(key)
      for (const run of running.values()) if (run.key === key) run.controller.abort(new Error('玩法插件已卸载'))
    }
  }
  async function providerFor(gameId, key, version) {
    const provider = providers.get(key)
    if (!provider) throw new Error('玩法插件未加载，请恢复原插件')
    await allowed(provider.owner, gameId)
    if (version !== undefined && version !== provider.version) throw new Error('玩法存档版本不兼容，请恢复对应版本插件')
    return provider
  }
  async function foregroundText(provider, data) {
    const text = await provider.foreground({ data: clone(data) })
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('玩法前台正文无效')
    return text
  }
  async function view(gameId) {
    const doc = await read(gameId)
    if (!doc) return null
    const provider = await providerFor(gameId, doc.key, doc.version)
    const publicView = json(await provider.project({ state: clone(doc.frames[doc.cursor].state) }))
    const hasForeground = typeof foreground === 'function' && typeof provider.foreground === 'function'
    const text = hasForeground ? await foregroundText(provider, publicView) : null
    if (hasForeground && !running.has(gameId)) {
      await foreground(gameId, { key: doc.key, revision: doc.revision, text })
    }
    return { key: doc.key, revision: doc.revision, cursor: doc.cursor, length: doc.frames.length,
      foreground: hasForeground, foregroundMessageId: hasForeground ? gameModeForegroundId(doc.key, text) : null,
      busy: running.has(gameId), data: publicView }
  }
  async function execute(gameId, request) {
    if (running.has(gameId)) throw new Error('玩法正在运行')
    const controller = new AbortController(), signal = controller.signal
    const run = { controller, key: request.key }
    running.set(gameId, run)
    const timer = setTimeout(() => controller.abort(new Error('玩法操作超时')), timeoutMs)
    const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    let active = true
    const work = async () => {
      const previous = await read(gameId)
      if (previous && request.actionId && previous.frames.some(frame => frame.actionId === request.actionId)) return
      if (previous && request.revision !== previous.revision) throw new Error('玩法状态已变化，请刷新后重试')
      if (!previous && request.op !== 'create') throw new Error('请先创建玩法')
      if (previous && request.op === 'create') throw new Error('本局已有玩法')
      const provider = await providerFor(gameId, previous?.key || request.key, previous?.version)
      run.key = provider.key
      const doc = previous ? clone(previous) : { key: provider.key, version: provider.version, revision: 0, cursor: -1, frames: [] }
      if (request.op === 'seek') {
        if (!Number.isSafeInteger(request.cursor) || !doc.frames[request.cursor]) throw new Error('无效的玩法节点')
        doc.cursor = request.cursor
      } else {
        if (!['create', 'advance'].includes(request.op)) throw new Error('未知玩法操作')
        const context = { gameId, signal, agent: async ({ id, system, prompt }) => {
          if (!active) throw new Error('玩法操作已结束')
          signal.throwIfAborted()
          if (!keyPattern.test(id) || typeof system !== 'string' || !system.trim() || typeof prompt !== 'string') throw new Error('Agent 需要 id、system、prompt')
          if (system.length + prompt.length > 200000) throw new Error('Agent 上下文超过限制')
          return runAgent({ gameId, owner: provider.owner, id, system, prompt, signal })
        } }
        const result = await provider[request.op]({ ...context, state: previous ? clone(doc.frames[doc.cursor].state) : null,
          input: json(request.input ?? null) })
        signal.throwIfAborted()
        const state = json(result.state), events = json(result.events ?? [])
        if (!Array.isArray(events)) throw new Error('events 必须为数组')
        doc.frames = doc.frames.slice(0, doc.cursor + 1)
        if (doc.frames.length >= 2000) throw new Error('玩法节点达到 2000 条上限')
        doc.frames.push({ id: randomUUID(), actionId: request.actionId || randomUUID(), state, events })
        doc.cursor++
      }
      // Validate the public projection before committing, so a broken result never becomes current.
      const projected = json(await provider.project({ state: clone(doc.frames[doc.cursor].state) }))
      if (typeof foreground === 'function' && typeof provider.foreground === 'function') await foregroundText(provider, projected)
      await providerFor(gameId, doc.key, doc.version)
      signal.throwIfAborted()
      doc.revision++
      if (Buffer.byteLength(JSON.stringify(doc)) > 64 * 1024 * 1024) throw new Error('玩法存档超过 64 MB')
      await write(gameId, previous?.revision ?? null, doc)
      changed(gameId)
    }
    try { await Promise.race([work(), aborted]) }
    finally { active = false; clearTimeout(timer); if (running.get(gameId) === run) running.delete(gameId); changed(gameId) }
    return view(gameId)
  }
  return { register, view, execute, active: async gameId => Boolean(await read(gameId)),
    stop(gameId) { running.get(gameId)?.controller.abort(new Error('玩家已停止玩法')); },
    async list(gameId) {
      const result = []
      for (const p of providers.values()) {
        try { await allowed(p.owner, gameId); result.push({ key: p.key, title: p.title || p.name, version: p.version }) } catch {}
      }
      return result
    } }
}
