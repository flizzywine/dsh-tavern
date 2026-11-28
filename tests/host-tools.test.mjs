import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHostToolPolicy, resolveNativeToolExecutorEntry } from '../tavern-plugin/lib/host/tools.js'
import { createBackgroundNativeRuntime } from './fixtures/background-native-runtime.mjs'

// Model the host waterfall, including redispatch and unrelated scoped policies.
function host() {
  const hooks = new Map(), received = []
  const run = (name, args, end) => {
    const chain = hooks.get(name) || []
    const dispatch = at => at === chain.length ? end() : chain[at](...args, () => dispatch(at + 1))
    return dispatch(0)
  }
  const ctx = {
    on(name, fn) { hooks.set(name, [...hooks.get(name) || [], fn]) },
    tools: { schemas: (_agent, set) => set?.schemas },
    llm: { stream: request => run('llm/stream', [request], () => { received.push(request); return request }) }
  }
  return { ctx, received, run, emit: (name, ...args) => (hooks.get(name) || []).forEach(fn => fn(...args)) }
}

for (const version of ['0.2.1', '0.2.2']) test(`${version}: policies compose for declarations and execution, then refresh and release`, async () => {
  const h = host()
  const first = createHostToolPolicy(h.ctx)
  const network = createHostToolPolicy(h.ctx, { denial: async name => name === 'web_search' ? '联网关闭' : undefined })
  const tools = Object.freeze(['submit_story', 'apply_patch', 'web_search'].map(name => Object.freeze({ name })))
  const agent = { session: { id: 'game' } }
  const context = { agent, ...(version === '0.2.2' ? { toolSet: { schemas: tools } } : {}) }
  const assemble = async names => {
    const initial = { sections: [], ...(version === '0.2.1' ? { tools } : {}) }
    const scoped = await first.assemble(initial, context, async (assembly, definitions) => ({ ...assembly,
      tools: definitions.filter(tool => names.includes(tool.name)) }))
    const result = await network.assemble(scoped, context, async (assembly, definitions) => ({ ...assembly,
      tools: definitions.filter(tool => tool.name !== 'web_search') }))
    return version === '0.2.2' ? { ...result, tools } : result
  }
  const result = await assemble(['submit_story', 'web_search'])
  const request = Object.freeze({ sessionId: 'game', tools: result.tools })
  assert.deepEqual(h.ctx.llm.stream(request).tools.map(tool => tool.name), ['submit_story'])
  assert.equal(request.tools, result.tools)
  const execute = name => h.run('tools/pre-execute', [{ agent, name }], () => ({ kind: 'allow' }))
  assert.equal((await execute('apply_patch')).kind, 'deny')
  assert.equal((await execute('web_search')).kind, 'deny')
  assert.equal((await execute('submit_story')).kind, 'allow')
  assert.equal(h.ctx.llm.stream({ ...request, sessionId: 'other' }).tools, result.tools)
  assert.equal(h.ctx.llm.stream({ ...request, purpose: 'compaction' }).tools, result.tools)
  await assemble([])
  assert.deepEqual(h.ctx.llm.stream(request).tools, [])
  const refreshed = await assemble(['apply_patch'])
  assert.deepEqual(h.ctx.llm.stream({ ...request, tools: refreshed.tools }).tools.map(tool => tool.name), ['apply_patch'])
  h.emit('session/event', agent.session, { type: 'turn/end' })
  assert.equal(h.ctx.llm.stream(request), request)
})

test('real resident background Agent refreshes worldbook and networking declarations between tasks', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const h = await createBackgroundNativeRuntime(process.env.DSH_BOOT_MODULE, {
    residentOptions: { resolveWorldbookSkills: input => input.worldbookSkillsEnabled }
  })
  t.after(() => h.dispose())
  const input = { sessionId: 'scene-parent', task: 'settlement', persistent: true,
    selection: { provider: 'scene-fixture', model: 'fixture-text' }, messages: [], tools: [] }
  const first = await h.runBackground({ ...input, worldbookSkillsEnabled: true, webSearchEnabled: true })
  const offered = () => (h.requests.at(-1).tools || []).map(tool => tool.name)
  assert.ok(offered().includes('read'))
  assert.ok(offered().includes('web_search'))
  const second = await h.runBackground({ ...input, persistentSessionId: first.traceSessionId, worldbookSkillsEnabled: false, webSearchEnabled: false })
  assert.equal(second.traceSessionId, first.traceSessionId)
  assert.ok(!offered().includes('read'))
  assert.ok(!offered().includes('web_search'))
  await h.runBackground({ ...input, persistentSessionId: first.traceSessionId, worldbookSkillsEnabled: true, webSearchEnabled: true })
  assert.ok(offered().includes('read'))
  assert.ok(offered().includes('web_search'))
})

test('resolveNativeToolExecutorEntry follows symlinked CLI bin entries to runtime node_modules', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-host-tools-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const binDir = path.join(root, 'runtime', 'bin')
  const dshLibDir = path.join(root, 'runtime', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  const executorDir = path.join(root, 'runtime', 'lib', 'node_modules', '@deepseek-ai', 'dsh-tool-executor-native')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(dshLibDir, { recursive: true })
  mkdirSync(path.join(executorDir, 'lib'), { recursive: true })
  const dshBin = path.join(dshLibDir, 'bin.js')
  const executorEntry = path.join(executorDir, 'lib', 'index.js')
  writeFileSync(dshBin, 'export {}\n')
  writeFileSync(path.join(executorDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-executor-native', main: './lib/index.js' }))
  writeFileSync(executorEntry, 'export class NativeToolExecutor {}\n')

  const symlinkBin = path.join(binDir, 'dsh')
  symlinkSync(path.relative(binDir, dshBin), symlinkBin)
  assert.equal(
    realpathSync(resolveNativeToolExecutorEntry({ env: {}, argv: [process.execPath, symlinkBin] })),
    realpathSync(executorEntry)
  )

  const jsSymlinkBin = path.join(binDir, 'dsh.mjs')
  symlinkSync(path.relative(binDir, dshBin), jsSymlinkBin)
  assert.equal(
    realpathSync(resolveNativeToolExecutorEntry({ env: {}, argv: [process.execPath, jsSymlinkBin] })),
    realpathSync(executorEntry)
  )

  assert.equal(
    realpathSync(resolveNativeToolExecutorEntry({ env: { DSH_BOOT_MODULE: symlinkBin }, argv: [process.execPath] })),
    realpathSync(executorEntry)
  )

  assert.throws(
    () => resolveNativeToolExecutorEntry({ env: {}, argv: [process.execPath] }),
    /无法定位当前 DSH 宿主入口/
  )
})
