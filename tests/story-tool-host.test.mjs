import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

// Real DSH Agent Loop host test for the story-tool submission feature.
//
// It boots the actual DSH runtime (dsh-agent-loop + dsh-session + dsh-tools +
// dsh-llm + dsh-agent) the same way tests/fixtures/conversation-initialization-native.mjs
// does, registers the production `submit_story` tool (and a read-only `story_search`
// tool) into the real tool registry, drives the real agent loop with an in-memory
// scripted LLM (no network, no user data), and asserts the loop / tool / session
// behaviour end to end.
//
// The runtime is loaded from DSH_BOOT_MODULE first, falling back to the managed
// plugin's linked host. The tests skip when neither is available.

const DOMAIN = new URL('../tavern-plugin/lib/domain/', import.meta.url)

function resolveBootModule() {
  if (process.env.DSH_BOOT_MODULE) return process.env.DSH_BOOT_MODULE
  try {
    const pluginRequire = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))
    return createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-app-boot')
  } catch { return null }
}

const BOOT_MODULE = resolveBootModule()
const native = { skip: !BOOT_MODULE, timeout: 60000 }

// Boot the real runtime and register the story submission tool + a query tool.
async function createStoryHost(bootModule, configure) {
  const bootUrl = pathToFileURL(bootModule)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { defineTool } = await import(new URL('../../dsh-tools/lib/index.js', bootUrl))
  const { createStorySubmissionTool, storySubmissionForTurn } = await import(new URL('story-tool-submission.js', DOMAIN))
  const { assistantResultForTurn } = await import(new URL('session-turn-result.js', DOMAIN))
  const { sessionEvents } = await import(new URL('session-events.js', DOMAIN))

  const root = await mkdtemp(join(tmpdir(), 'tavern-story-host-'))
  const config = join(root, 'host.yml')
  const toolExecutor = await import(new URL('../../dsh-tool-executor-native/lib/index.js', bootUrl)).then(() => ['dsh-tool-executor-native'], () => [])
  const packages = ['dsh-system-prompt', 'dsh-tools', ...toolExecutor, 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-loop']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href + '\n').join(''))
  const ctx = await boot('story-tool-host-test', config)

  const selection = { provider: 'story-fixture', model: 'text' }

  // The chat backing the session; toggled per run to exercise the gate.
  const chatStore = { chat: { mode: 'story' }, enabled: true }
  ctx.tools.register(defineTool(createStorySubmissionTool({
    chatForSession: () => chatStore.chat,
    enabled: async () => chatStore.enabled,
    isBackground: () => false
  })))
  // A read-only query tool used to prove the loop re-requests before submitting.
  ctx.tools.register(defineTool({
    name: 'story_search',
    description: '查询背景资料',
    parameters: { query: { type: 'string', required: true, description: '查询词' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) { return '背景资料：' + (args && args.query || '') }
  }))

  if (configure) await configure(ctx, defineTool)

  // In-memory scripted LLM: replays a per-run plan of tool-call / text responses.
  const state = { plan: /** @type {any[]} */ ([]), index: 0, requests: 0, inputs: [] }
  class FixtureModel extends LlmAdapter {
    /** @param {any} _input */
    async *stream(_input) {
      state.requests += 1
      state.inputs.push(_input)
      const step = state.plan[state.index++] || { kind: 'text', text: '结束本轮。' }
      if (step.kind === 'tool') {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-' + (state.requests - 1), name: step.name, arguments: JSON.stringify(step.args) } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter([selection.provider], new FixtureModel())

  /**
   * Drive one foreground turn through the real agent loop.
   * @param {any[]} plan - ordered scripted model responses
   * @param {{ chat?: any }} [options]
   */
  async function runTurn(plan, options = {}) {
    chatStore.chat = options.chat || { mode: 'story' }
    chatStore.enabled = options.enabled !== false
    state.plan = plan
    state.index = 0
    state.requests = 0
    state.inputs = []
    const sessionId = 'story-' + randomUUID()
    const handle = await ctx.agents.create({ sessionId, seed: [], agentOptions: selection })
    const agent = handle.agent
    agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '开始。' }], source: { kind: 'human' } })
    await agent.whenIdle()
    if (options.secondTurn) {
      agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '继续。' }], source: { kind: 'human' } })
      await agent.whenIdle()
    }
    const session = agent.session
    const events = sessionEvents(session)
    const result = {
      requests: state.requests,
      inputs: state.inputs,
      session,
      events,
      turnStarts: events.filter(e => e.type === 'turn/start').length,
      turnEnds: events.filter(e => e.type === 'turn/end').length,
      last: events.at(-1) && events.at(-1).type
    }
    await handle.dispose()
    return result
  }

  async function dispose() {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }

  return { runTurn, dispose, assistantResultForTurn, storySubmissionForTurn }
}

test('先查询后提交：2 次前台请求且无第 3 次', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([
    { kind: 'tool', name: 'story_search', args: { query: '天气' } },
    { kind: 'tool', name: 'submit_story', args: { content: '她推开门。' } }
  ])

  assert.equal(result.requests, 2, '查询一次 + 提交一次，共两次前台请求')
  assert.equal(result.turnEnds, 1, '提交后回合结束')
  assert.equal(result.last, 'turn/end')
  assert.ok(!result.events.some(e => e.type === 'assistant/message' && e.data && e.data.message && e.data.message.content.some(b => b.type === 'text' && b.text === '结束本轮。')), '提交结束回合后不应再出现兜底文本请求')

  const extracted = host.assistantResultForTurn(result.session, 1)
  assert.ok(extracted, '应当能从成功 tool result 提取正文')
  assert.equal(extracted.text, '她推开门。')
  assert.equal(extracted.storyToolSubmission, true)
})


async function nativePluginHost(text, { fail = false, worldbook = false, direct = false } = {}) {
  let calls = 0, stored, observed
  const { createPluginBodyGeneration } = await import(new URL('plugin-body-generation.js', DOMAIN))
  const { createBodyGenerationProviders } = await import(new URL('body-generation-providers.js', DOMAIN))
  const { captureBodyRegenerationSource } = await import(new URL('body-regeneration-materials.js', DOMAIN))
  const host = await createStoryHost(BOOT_MODULE, async (ctx, defineTool) => {
    const before = { id: 'chat', sessionId: '', mode: 'story', messages: [], posture: '起点', variables: { hp: 10 }, cardContextSnapshot: '人物设定' }
    const route = { mode: direct ? 'plugin-direct' : 'plugin-tool-call', provider: 'native:body' }
    const source = { ...captureBodyRegenerationSource({ chat: before, card: { name: '角色' } }), bodyGeneration: route }
    stored = { ...structuredClone(before), timeline: { branchId: 'branch', revision: 0,
      operations: { op: { id: 'op', status: 'running', kind: 'body', turn: 1, beforeRevision: 1 } } },
      foregroundFrames: { op: { kind: 'foreground', operationId: 'op', chatId: 'chat', turn: 1, branchId: 'branch', basedOnRevision: 0,
        userInput: { sourceText: '开始。', projectedText: '开始。' }, contributions: [], source } } }
    const providers = createBodyGenerationProviders({ allowed: async () => true })
    providers.register('native', { name: 'body', title: 'Native', async generate({ materials }) { calls++; observed = materials; if (fail) throw new Error('插件明确失败'); return { text } } })
    const controller = createPluginBodyGeneration({ providers, settings: async () => ({ storyGenerationMode: 'plugin-tool-call', storyGenerationProvider: 'native:body' }),
      isWorldbookPath: filePath => filePath === '/worldbook/harbor.md',
      chatForSession: async id => { stored.sessionId = id; return structuredClone(stored) }, readRevision: async () => structuredClone(before),
      updateChat: async (id, mutate) => { const next = await mutate(structuredClone(stored)); if (next) stored = next; return structuredClone(stored) } })
    ctx.tools.register(defineTool(controller.tool))
    if (direct) ctx.on('llm/stream', (options, next) => (async function * () {
      const session = ctx.agents.get(options.sessionId)?.session
      const output = await controller.direct(session, options.signal)
      yield * (output || next())
    })())
    if (worldbook) {
      const { registerWorldbookFileTools } = await import('../tavern-plugin/lib/tools/worldbook-files.js')
      registerWorldbookFileTools(ctx.tools, {
        async searchFiles() { return { matches: [{ path: '/worldbook/harbor.md', line: 1, text: '港口夜间关闭' }] } },
        async listFiles() { return { files: [{ path: '/worldbook/harbor.md', title: '港口' }] } },
      })
      ctx.tools.register(defineTool({ name: 'read', description: '读取世界书文件',
        parameters: { file_path: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute(args) { assert.equal(args.file_path, '/worldbook/harbor.md'); return '完整设定：港口夜间关闭，持令牌者可通行。' },
      }))
    }
    ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
      const { assistantResultForTurn } = await import(new URL('session-turn-result.js', DOMAIN))
      await controller.validateResult(agent.session, turn, assistantResultForTurn(agent.session, turn))
    })
  })
  return { ...host, calls: () => calls, stored: () => stored, materials: () => observed }
}

test('插件直接生成经过原生工具和结束流程，零次前台模型请求', native, async t => {
  const host = await nativePluginHost('直接生成的正文', { direct: true }); t.after(() => host.dispose())
  const result = await host.runTurn([])
  assert.equal(result.requests, 0)
  assert.equal(host.calls(), 1)
  assert.equal(host.assistantResultForTurn(result.session, 1)?.text, '直接生成的正文')
  assert.equal(result.events.at(-1).data.reason.kind, 'completed')
})

test('原生插件正文工具：一次调度请求，完整长正文可提取，无再次转述', native, async t => {
  const text = '<div>' + '插件完整长正文。'.repeat(6000) + '</div>'
  const host = await nativePluginHost(text); t.after(() => host.dispose())
  const result = await host.runTurn([{ kind: 'tool', name: 'tavern_generate_body', args: {} }])
  assert.equal(result.requests, 1)
  assert.equal(host.calls(), 1)
  const reply = host.assistantResultForTurn(result.session, 1)
  assert.equal(reply?.text, text)
  assert.equal(reply.pluginBodyGeneration, true)
  assert.equal(result.events.at(-1).data.reason.kind, 'completed')
  assert.equal(host.stored().timeline.operations.op.bodyGeneration.status, 'ready')
})

test('原生插件失败：结束当前轮且不自动重试或采用模型普通文本', native, async t => {
  const host = await nativePluginHost('', { fail: true }); t.after(() => host.dispose())
  const result = await host.runTurn([{ kind: 'tool', name: 'tavern_generate_body', args: {} }])
  assert.equal(result.requests, 1)
  assert.equal(host.calls(), 1)
  assert.notEqual(result.events.at(-1).data.reason.kind, 'completed')
  assert.equal(host.stored().timeline.operations.op.bodyGeneration.status, 'failed')
})

test('原生 agent loop 先搜索和读取世界书，再把工具结果交给正文插件', native, async t => {
  const host = await nativePluginHost('持令牌穿过港口。', { worldbook: true }); t.after(() => host.dispose())
  const result = await host.runTurn([
    { kind: 'tool', name: 'worldbook_grep', args: { query: '港口' } },
    { kind: 'tool', name: 'read', args: { file_path: '/worldbook/harbor.md' } },
    { kind: 'tool', name: 'tavern_generate_body', args: {} },
  ])
  assert.equal(result.requests, 3)
  assert.equal(host.calls(), 1)
  assert.deepEqual(host.stored().foregroundFrames.op.source.bodyGenerationToolResults.map(item => item.tool), ['worldbook_grep', 'read'])
  assert.match(host.materials().context.find(item => item.id === 'worldbook').text, /港口夜间关闭[\s\S]*完整设定：港口夜间关闭，持令牌者可通行/)
  assert.equal(host.assistantResultForTurn(result.session, 1)?.text, '持令牌穿过港口。')
  assert.equal(result.events.at(-1).data.reason.kind, 'completed')
})
