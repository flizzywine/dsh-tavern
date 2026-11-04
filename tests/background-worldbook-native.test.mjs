import { sharedWorldbookSearch } from '../tavern-plugin/lib/domain/worldbook-search.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { SCRIPT_READ_TOOL } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

test('原生后台按需检索与重启保持缓存前缀且不复制前台召回正文', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const root = await mkdtemp(join(tmpdir(), 'tavern-filter-native-'))
  let ctx, parent, runner
  t.after(async () => {
    await runner?.dispose()
    await parent?.dispose()
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const config = join(root, 'host.yml')
  const toolExecutor = await import(new URL('../../dsh-tool-executor-native/lib/index.js', bootUrl)).then(() => ['dsh-tool-executor-native'], () => [])
  const packages = ['dsh-system-prompt', 'dsh-tools', ...toolExecutor, 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-session-persistence-jsonl', 'dsh-token-meter', 'dsh-agent-loop']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href +
    (name === 'dsh-session-persistence-jsonl' ? '\n  config:\n    root: ' + join(root, 'sessions') + '\n    compression: none' : '')).join('\n'))
  ctx = await boot('background-worldbook-native-test', config)
  const requests = []
  let searchPhase = null
  const searchCalls = []
  const worldbookProjections = []
  class Model extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(input) {
      requests.push(structuredClone({ system: input.messages.filter(message => message.role === 'system').flatMap(message => message.content).map(block => block.text || '').join('\n\n'), messages: input.messages, tools: input.tools }))
      const current = input.messages.filter(message => message.role === 'user').at(-1)
      const lookup = searchPhase === null ? null : searchPhase++
      if (lookup !== null) assert.ok(input.tools.some(tool => tool.name === 'worldbook_search' && tool.parameters.properties.query))
      const block = lookup === 0 || lookup === 1
        ? { type: 'tool-call', id: 'lookup-' + requests.length, name: 'worldbook_search', arguments: JSON.stringify(lookup === 0 ? { query: '少林' } : { refs: ['entry:62'] }) }
        : { type: 'text', text: '结算完成' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['filter-fixture'], new Model())
  for (const name of ['read', 'worldbook_list', 'worldbook_grep', 'skill', 'tavern_read_skill_reference', 'web_search']) ctx.tools.register({
    name, description: 'Fixture tool', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'fixture'
  })
  const selection = { provider: 'filter-fixture', model: 'scripted' }
  parent = await ctx.agents.create({ sessionId: 'parent', agentOptions: selection })
  const makeRunner = () => createBackgroundAgentRunner({ agents: ctx.agents, backgroundTools: [],
    sharedTools: [sharedWorldbookSearch(async (sessionId, args) => { searchCalls.push({ sessionId, args }); return { entries: [{ ref: 'entry:62', text: '少林门规原文' }] } })],
    resolveCurrentWorldbook: async input => { worldbookProjections.push(input.task); return { prefixContext: '常驻：旅店规矩', foregroundContext: '' } },
    resolveForegroundWorldbookReads: async input => input.task === 'settlement' ? '【前台本轮完整查阅的世界书资料】\n少林门规只读快照' : '',
    resolveStablePrefix: async () => '固定背景：雨夜旅店', flushSession: session => ctx.sessions.flush(session) })
  runner = makeRunner()
  const run = persistentSessionId => runner.run({ sessionId: 'parent', task: 'settlement', persistent: true, selection,
    persistentSessionId, messages: [], tools: [] })
  const first = await run()
  const second = await run(first.traceSessionId)
  assert.equal(second.traceSessionId, first.traceSessionId)
  assert.doesNotMatch(JSON.stringify(requests), /少林门规只读快照/)
  assert.equal(requests[1].system, requests[0].system)
  assert.deepEqual(requests[1].tools, requests[0].tools)
  assert.match(requests[0].system, /常驻：旅店规矩/)
  await ctx.sessions.flush(runner.requestSession(first.traceSessionId))
  await runner.dispose()
  runner = makeRunner()
  const third = await run(first.traceSessionId)
  assert.equal(third.traceSessionId, first.traceSessionId)
  assert.equal(requests[2].system, requests[1].system)
  assert.deepEqual(requests[2].tools, requests[1].tools)
  assert.deepEqual(worldbookProjections, ['settlement', 'settlement', 'settlement'])
  const currentText = request => request.messages.filter(m => m.role === 'user').at(-1).content.map(b => b.text || '').join('')
  const normalized = request => request.messages.filter(m => m.content?.length).map(({role,content}) => ({role,content}))
  // Exercise script-window references through the same native append pipeline.
  const heading = '【剧本候选参考 · 游标 1 / 3】'
  const scriptText = heading + '\n[chunk-1]\n' + 'script-body-'.repeat(2000)
  const candidateInput = { sessionId: 'parent', task: 'candidate', persistent: true, selection,
    persistentSessionId: first.traceSessionId, messages: [], tools: [SCRIPT_READ_TOOL],
    turnContext: '当前指导\n\n' + scriptText,
    candidateScriptWindow: { heading, text: scriptText, positions: [1] },
    onToolCall: async () => JSON.stringify({ chunks: [{ text: scriptText }] }) }
  await runner.run(candidateInput)
  await ctx.sessions.flush(runner.requestSession(first.traceSessionId))
  await runner.dispose()
  runner = makeRunner()
  await runner.run(candidateInput)
  await runner.run(candidateInput)
  const scriptFirst = requests.at(-3), scriptSecond = requests.at(-2), scriptThird = requests.at(-1)
  assert.match(currentText(scriptFirst), /script-body-/)
  assert.doesNotMatch(currentText(scriptSecond), /script-body-/)
  assert.match(currentText(scriptSecond), /tavern_read_script/)
  assert.deepEqual(normalized(scriptThird).slice(0, normalized(scriptSecond).length), normalized(scriptSecond))
  assert.deepEqual(normalized(scriptSecond).slice(0, normalized(scriptFirst).length), normalized(scriptFirst))
  assert.equal(scriptSecond.system, scriptFirst.system)
  assert.deepEqual(scriptSecond.tools, scriptFirst.tools)
  assert.equal(scriptThird.system, scriptSecond.system)
  assert.deepEqual(scriptThird.tools, scriptSecond.tools)
  assert.ok(Buffer.byteLength(currentText(scriptSecond)) < 1200)
  console.log('script-window task bytes:', Buffer.byteLength(currentText(scriptFirst)), Buffer.byteLength(currentText(scriptSecond)))
  for (const task of ['settlement', 'candidate', 'character-design']) {
    searchPhase = 0
    await runner.run({ sessionId: 'parent', task, persistent: true, selection, persistentSessionId: first.traceSessionId,
      messages: [{ role: 'user', content: [{ type: 'text', text: '读取少林资料' }] }], tools: [] })
    assert.ok(searchPhase >= 3)
    assert.match(JSON.stringify(requests.at(-1).messages), /少林门规原文/)
  }
  assert.equal(searchCalls.length, 6)
  assert.ok(searchCalls.every(call => call.sessionId === 'parent'))
  const descriptors = sessionEvents(runner.requestSession(first.traceSessionId)).filter(event => event.type === 'subagent/descriptor')
  assert.equal(descriptors.length, 1)
  assert.equal(descriptors[0].data.label, '酒馆后台 Agent')
  assert.equal(descriptors[0].data.mode, 'continuable')
})
