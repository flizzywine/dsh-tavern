import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { hostRequireCandidates } from '../domain/host-package-resolution.js'

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

const NATIVE_TOOL_EXECUTOR_PACKAGE = '@deepseek-ai/dsh-tool-executor-native'

function realpathOrSelf(filePath) {
  try { return realpathSync(filePath) } catch { return filePath }
}

// Resolve from the running Host entry, not Tavern's linked package directory.
// CLI installations launch through a symlinked `runtime/bin/dsh` whose directory
// has no `node_modules`; follow symlinks and reuse the shared host resolution
// candidates so both CLI and Desktop asar hosts resolve their own runtime copy.
export function resolveNativeToolExecutorEntry({ env = process.env, argv = process.argv } = {}) {
  const boot = env.DSH_BOOT_MODULE
  if (boot) return createRequire(realpathOrSelf(boot)).resolve(NATIVE_TOOL_EXECUTOR_PACKAGE)
  const { resolvable } = hostRequireCandidates({ names: [NATIVE_TOOL_EXECUTOR_PACKAGE], env, argv })
  const hostCandidate = resolvable.find(candidate => candidate.label !== 'plugin-package')
  if (hostCandidate) return hostCandidate.require.resolve(NATIVE_TOOL_EXECUTOR_PACKAGE)
  const entry = argv[1]
  if (!entry) throw new Error('无法定位当前 DSH 宿主入口，不能选择原生工具执行器')
  return createRequire(realpathOrSelf(entry)).resolve(NATIVE_TOOL_EXECUTOR_PACKAGE)
}

// Tavern's contracts use direct tool calls. Select native execution in the
// Agent's own scope, leaving the deployment and other Agents untouched.
export async function useNativeTools(agentCtx) {
  if (typeof agentCtx.tools?.setExecutor !== 'function') return
  const entry = resolveNativeToolExecutorEntry()
  const { NativeToolExecutor } = await import(pathToFileURL(entry).href)
  agentCtx.tools.setExecutor(new NativeToolExecutor(agentCtx))
}

// 0.2.0-0.2.1 select the presentation per scope with tools.presentAs(); 0.2.2
// removed it. There the Agent's preset already mounted useNativeTools above, so
// nothing is left to select.
export function presentNativeTools(agentCtx) {
  if (typeof agentCtx.tools?.presentAs === 'function') agentCtx.tools.presentAs('native')
}

export const name = 'tavern-native-tools'
export const inject = ['tools']
export { useNativeTools as apply }
