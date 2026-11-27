import { createBackgroundSessionRetirement, installRetiredBackgroundFilter, installRetiredCatalogView } from './background-session-retirement.js'
import { createBackgroundCatalogBackfill } from './background-catalog.js'

export function installBackgroundSessionLifecycle(ctx, { profileData, readState, agentRegistry, sessionSignals }) {
  const isRunning = id => agentRegistry.get(id)?.status === 'running'
  const backgroundRetirement = createBackgroundSessionRetirement(profileData, { readState, isRunning })
  ctx.effect(() => installRetiredBackgroundFilter(ctx.get('subagents'), backgroundRetirement, ctx.get('sessionQuery')))
  void backgroundRetirement.load().catch(error => console.warn('dsh-tavern: 读取已退休后台会话失败', String(error?.message || error || '')))
  ctx.effect(() => installRetiredCatalogView(ctx.get('sessionProjections'), backgroundRetirement, { isRunning }))
  // Games whose background agents predate their catalog entry get them listed when opened.
  const backgroundCatalog = createBackgroundCatalogBackfill({ agents: agentRegistry, sessionQuery: ctx.get('sessionQuery'),
    onListed: parentId => sessionSignals.publish(parentId, { kind: 'subagents', version: String(Date.now()) + ':' + Math.random().toString(36).slice(2) }) })
  return { backgroundRetirement, backgroundCatalog }
}
