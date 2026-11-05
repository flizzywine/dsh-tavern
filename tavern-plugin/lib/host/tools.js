import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// DSH tool declarations were part of the assembly waterfall in 0.2.1;
// 0.2.2 owns them outside it. Keep that compatibility contract here.
const ADMITTED = Symbol('tavern.host.admitted-tools')

// One instance owns one policy for the lifetime of its mounting context. The
// transform returns its assembly with the approved tools; nested policies consume
// that result rather than restarting from the host's unfiltered declarations.
// Request middleware is a compatibility fallback: host request/header entries
// written earlier by 0.2.2 can still describe the original declarations.
export function createHostToolPolicy(ctx, { denial } = {}) {
  const admissions = new Map()
  const admissionDenial = exec => {
    const allowed = admissions.get(exec.agent?.session?.id)
    return allowed && !allowed.has(exec.name) ? '该工具未在当前任务开放。' : undefined
  }

  async function assemble(assembly, context, transform) {
    const agent = context?.agent
    const tools = assembly[ADMITTED] || (context?.toolSet && typeof ctx.tools?.schemas === 'function'
      ? await ctx.tools.schemas(agent, context.toolSet)
      : Array.isArray(assembly.tools) ? assembly.tools
        : typeof ctx.tools?.schemas === 'function' ? await ctx.tools.schemas(agent) : undefined)
    const result = await transform(assembly, tools)
    if (Array.isArray(tools) && Array.isArray(result.tools)) {
      result[ADMITTED] = result.tools
      if (agent?.session?.id) admissions.set(agent.session.id, new Set(result.tools.map(tool => tool.name)))
    } else if (agent?.session?.id) admissions.delete(agent.session.id)
    return result
  }

  ctx.on('llm/stream', (request, next) => {
    const allowed = request.purpose === undefined && admissions.get(request.sessionId)
    if (!allowed || !Array.isArray(request.tools)) return next()
    const tools = request.tools.filter(tool => allowed.has(tool.name))
    return tools.length === request.tools.length ? next() : ctx.llm.stream({ ...request, tools })
  }, { global: true })
  ctx.on('tools/pre-execute', async (exec, next) => {
    const reason = admissionDenial(exec) || await denial?.(exec.name, exec.agent?.session)
    return reason ? { kind: 'deny', reason } : next()
  })
  ctx.tools?.guard?.(admissionDenial)
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'turn/end') admissions.delete(session.id)
  })
  ctx.on('agent/error', ({ agent }) => { admissions.delete(agent?.session?.id) })
  ctx.effect?.(() => () => admissions.clear())
  return Object.freeze({ assemble })
}

// Tavern's contracts use direct tool calls. Select native execution in the
// Agent's own scope, leaving the deployment and other Agents untouched.
export async function useNativeTools(agentCtx) {
  if (typeof agentCtx.tools?.setExecutor !== 'function') return
  // Resolve from the running Host entry, not Tavern's linked package directory.
  // The latter neither owns nor installs a second copy of this runtime package.
  const hostEntry = process.env.DSH_BOOT_MODULE || process.argv[1]
  if (!hostEntry) throw new Error('无法定位当前 DSH 宿主入口，不能选择原生工具执行器')
  const hostRequire = createRequire(hostEntry)
  const entry = hostRequire.resolve('@deepseek-ai/dsh-tool-executor-native')
  const { NativeToolExecutor } = await import(pathToFileURL(entry).href)
  agentCtx.tools.setExecutor(new NativeToolExecutor(agentCtx))
}

export const name = 'tavern-native-tools'
export const inject = ['tools']
export { useNativeTools as apply }
