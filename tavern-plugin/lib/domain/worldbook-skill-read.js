const WORLDBOOK_SKILL_RESOURCE_ROOT = '/__tavern_worldbook__/'

export function nativeWorldbookReadAvailable(tools, scope) {
  const tool = tools?.get('read', scope)
  const schema = tool?.output?.schema
  return Boolean(tool?.parameters?.properties?.file_path && schema?.properties?.path && schema?.properties?.lines && schema?.properties?.totalLines)
}

/** Scope guard only: filesystem IO, pagination, rendering and limits belong to
 * the native read tool. No synthetic read results or virtual files. */
export function installWorldbookSkillRead(ctx, provider, { virtualOnly = async () => false } = {}) {
  return ctx.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'read') return next()
    const requested = exec.arguments?.file_path
    if (String(requested || '').startsWith(WORLDBOOK_SKILL_RESOURCE_ROOT)) throw Error('Worldbook entries now use real files. Use worldbook_list or worldbook_grep for current paths.')
    if (!provider.ownsPath(requested)) {
      if (await virtualOnly(exec.agent)) throw Error('This game’s read tool is limited to its generated worldbook files')
      return next()
    }
    exec.signal?.throwIfAborted()
    if (!exec.agent?.session?.id) throw Error('Worldbook files require the current game')
    if (!await provider.authorizeRead(requested, { scope: exec.agent, signal: exec.signal })) throw Error('Worldbook resource is unknown or no longer available in this game')
    exec.signal?.throwIfAborted()
    return next()
  })
}
