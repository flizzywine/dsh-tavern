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
async function createStoryHost(bootModule) {
  const bootUrl = pathToFileURL(bootModule)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { defineTool } = await import(new URL('../../dsh-tools/lib/index.js', bootUrl))
  const { createStorySubmissionTool, storySubmissionForTurn } = await import(new URL('story-tool-submission.js', DOMAIN))
  const { assistantResultForTurn } = await import(new URL('session-turn-result.js', DOMAIN))
  const { sessionEvents } = await import(new URL('session-events.js', DOMAIN))

  const root = await mkdtemp(join(tmpdir(), 'tavern-story-host-'))
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-loop']
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

test('scripted LLM 仅返回 submit_story tool-call：总前台请求 1、turn 完成、提取正文成功', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([{ kind: 'tool', name: 'submit_story', args: { content: '雨水扑进房间。' } }])

  assert.equal(result.requests, 1, '提交即结束，不应再发起第二次前台请求')
  assert.equal(result.turnStarts, 1)
  assert.equal(result.turnEnds, 1, '回合应当正常结束')
  assert.equal(result.events.find(event => event.type === 'turn/end').data.reason.kind, 'completed')
  assert.equal(result.last, 'turn/end')

  const extracted = host.assistantResultForTurn(result.session, 1)
  assert.ok(extracted, '应当能从成功 tool result 提取正文')
  assert.equal(extracted.text, '雨水扑进房间。')
  assert.equal(extracted.storyToolSubmission, true)

  const submission = host.storySubmissionForTurn(result.session, 1)
  assert.ok(submission, 'storySubmissionForTurn 应识别本轮提交')
  assert.equal(submission.text, '雨水扑进房间。')
  assert.equal(submission.content, '雨水扑进房间。')
})

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

test('两轮工具正文保留合法上下文配对，下一轮能读取前一轮完整正文', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([
    { kind: 'tool', name: 'submit_story', args: { content: '第一轮：雨水扑进房间。' } },
    { kind: 'tool', name: 'submit_story', args: { content: '第二轮：她推开门。' } }
  ], { secondTurn: true })
  assert.equal(result.requests, 2)
  assert.equal(result.turnEnds, 2)
  assert.equal(host.assistantResultForTurn(result.session, 1).text, '第一轮：雨水扑进房间。')
  assert.equal(host.assistantResultForTurn(result.session, 2).text, '第二轮：她推开门。')
  const messages = result.inputs[1].messages
  const call = messages.flatMap(message => message.content).find(block => block.type === 'tool-call' && block.name === 'submit_story')
  const receipt = messages.flatMap(message => message.content).find(block => block.type === 'tool-result' && block.toolCallId === call.id)
  assert.ok(receipt)
  assert.equal(receipt.content[0].text, '第一轮：雨水扑进房间。')
})

test('未开启全局正文走工具调用时 submit_story 执行拒绝且不构成提交', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([{ kind: 'tool', name: 'submit_story', args: { content: '正文' } }], { enabled: false })

  const submission = host.storySubmissionForTurn(result.session, 1)
  assert.equal(submission, null, '未开启提交时不应识别到任何 story 提交')
  assert.ok(
    result.events.some(e => e.type === 'tool/result' && e.data && e.data.message &&
      e.data.message.content.some(part => part.isError === true)),
    '工具应以错误结果结束'
  )
})
