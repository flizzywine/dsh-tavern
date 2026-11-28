import { fileURLToPath } from 'node:url'
import { createManualCharacterDesign } from './task.js'

export const name = 'dsh-tavern-character-design'
export const inject = ['tavern']

export async function apply(ctx) {
  if (ctx.tavern.capabilities?.characterDesignRuntime !== 1) return
  const runtime = await ctx.tavern.characterDesignRuntime()
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(new Error('人物设计插件已停用')), 'character-design: cancel tasks on unload')
  ctx.tavern.skillSource({ role: 'background', dir: fileURLToPath(new URL('../skills/', import.meta.url)) })

  let revision = 0
  const design = createManualCharacterDesign({
    ...runtime, signal: lifetime.signal,
    onStatus(gameId) {
      runtime.onStatus?.(gameId)
      if (!lifetime.signal.aborted) void ctx.tavern.publishState({ gameId, name: 'archive', data: ++revision }).catch(() => {})
    },
  })

  ctx.tavern.handle(name + '/read', async ({ gameId }) => {
    const chat = await runtime.store.chatForSession(gameId)
    if (!chat) return null
    return { characters: runtime.archive.project(chat.characterDesignDocument).characters,
      task: design.project(chat), foregroundRunning: runtime.foregroundRunning(chat) }
  })
  ctx.tavern.handle(name + '/start', ({ gameId, guidance }) => design.start({ sessionId: gameId, guidance }))
  ctx.tavern.handle(name + '/remove', async ({ gameId, name }) => {
    const chat = await runtime.store.chatForSession(gameId)
    if (chat && runtime.foregroundRunning(chat)) throw new Error('前台正在生成，请完成后再删除人物档案。')
    return design.remove({ sessionId: gameId, name })
  })
}
