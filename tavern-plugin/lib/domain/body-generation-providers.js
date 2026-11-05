import { bodyGenerationError } from './body-generation-failure.js'
import { randomUUID } from 'node:crypto'
import { untilAborted } from './plugin-callback.js'
import { publicBodyMaterials } from './body-generation-materials.js'

function jsonConfig(value) {
  if (value === undefined) return null
  const json = JSON.stringify(value)
  if (json === undefined || Buffer.byteLength(json) > 2 * 1024 * 1024) throw new Error('生成器配置必须是最多 2 MB 的 JSON')
  return JSON.parse(json)
}
export function createBodyGenerationProviders({ allowed, timeoutMs = 600000 }) {
  const providers = new Map(), running = new Set()
  async function requireProvider(id, gameId) {
    const provider = providers.get(id)
    if (!provider || !await allowed(provider.owner, gameId) || providers.get(id) !== provider) throw new Error('正文生成插件不可用，请检查插件和正文生成设置')
    return provider
  }
  async function invoke(provider, gameId, signal, callback) {
    signal?.throwIfAborted()
    const controller = new AbortController(), task = { provider, gameId, controller }
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
    const timer = setTimeout(() => controller.abort(Object.assign(new Error('插件正文生成超时'), { code: 'TAVERN_PLUGIN_BODY_TIMEOUT' })), timeoutMs)
    running.add(task)
    try {
      const value = await untilAborted(Promise.resolve().then(() => { combined.throwIfAborted(); return callback(combined) }), combined)
      combined.throwIfAborted()
      if (await requireProvider(provider.id, gameId) !== provider) throw new Error('正文生成插件已更换')
      return value
    } finally { clearTimeout(timer); running.delete(task); controller.abort() }
  }
  return {
    register(owner, entry) {
      const id = owner + ':' + entry.name
      if (providers.has(id)) throw new Error('正文生成器已注册：' + id)
      const provider = { ...entry, owner, id, registration: randomUUID() }
      providers.set(id, provider)
      return () => {
        if (providers.get(id) === provider) providers.delete(id)
        for (const task of running) if (task.provider === provider) task.controller.abort(new Error('正文生成插件已卸载'))
      }
    },
    async list(gameId) {
      const result = []
      for (const { id, owner, name, title } of providers.values()) {
        if (!gameId || await Promise.resolve().then(() => allowed(owner, gameId)).catch(() => false)) result.push({ id, owner, name, title })
      }
      return result
    },
    require: requireProvider,
    async prepare(id, { gameId, reason, signal }) {
      const provider = await requireProvider(id, gameId)
      let config
      try { config = await invoke(provider, gameId, signal, signal => provider.prepare?.({ gameId, reason, signal })) }
      catch (cause) { throw bodyGenerationError(cause, 'prepare') }
      return { config: jsonConfig(config), registration: provider.registration }
    },
    async generate(id, { materials, snapshot, signal }) {
      const provider = await requireProvider(id, materials.gameId)
      if (snapshot?.registration && snapshot.registration !== provider.registration) throw new Error('正文生成插件已更换，请重新生成')
      const result = await invoke(provider, materials.gameId, signal, signal => provider.generate({
        materials: publicBodyMaterials(materials), config: structuredClone(snapshot?.config ?? null), signal,
      }))
      const text = result?.text
      if (typeof text !== 'string' || !text.trim() || text.length > 200000) throw new Error('插件必须返回 { text }，正文非空且最多 200000 字符')
      return { text }
    },
    stop(gameId) {
      let stopped = false
      for (const task of running) if (task.gameId === gameId) { stopped = true; task.controller.abort(new Error('正文生成已取消')) }
      return stopped
    },
  }
}
