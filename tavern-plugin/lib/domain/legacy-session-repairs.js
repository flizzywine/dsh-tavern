import { createBranchOriginRepair } from './branch-origin-repair.js'
import { createDirectorDescriptorRepair } from './director-descriptor-repair.js'

export function startLegacySessionRepairs(ctx, { dataRoot, loadCatalog, isLive, ownsChat }) {
  // Branches an older Tavern forked as subagent children have no subagent descriptor, so
  // DSH 0.2.1 refuses their whole history ("subagent descriptor is corrupt"). Repair the
  // header once at startup, while nothing is loaded, and again before a page reads one.
  const branchOrigin = createBranchOriginRepair({
    dataRoot,
    loadCatalog,
    isLive,
    // Ownership is the save's header; the page's windowed read must not load the whole save first.
    ownsChat,
    listSessions: () => ctx.get('sessionQuery')?.listSessions?.() ?? []
  })
  void branchOrigin.sweep().catch(error => console.warn('dsh-tavern: 检查旧分支会话头部失败', error?.message || error))
  // Stage-director children an earlier release wrote with a descriptor the host rejects.
  const directorDescriptors = createDirectorDescriptorRepair({
    dataRoot,
    loadCatalog,
    listSessions: async () => (await ctx.get('sessionQuery')?.listSessions?.()) ?? [],
    hostIdentity: header => {
      const values = ctx.get('sessionProjectionCache')?.cachedSnapshot(header, ['subagent'])?.values
      return values && Object.hasOwn(values, 'subagent') ? values.subagent : undefined
    },
    // The cache would otherwise keep serving the empty identity folded from the old descriptor.
    forgetProjections: id => ctx.get('sessionProjectionCache')?.table?.delete(id),
    isLive
  })
  void directorDescriptors.sweep().catch(error => console.warn('dsh-tavern: 修复舞台导演会话描述失败', error?.message || error))
  return branchOrigin
}
