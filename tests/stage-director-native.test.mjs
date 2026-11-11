import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {createAssetPackTransaction,runAssetPackDirector} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-director.js'
import {createDirectorHandles} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-director-handles.js'

// both isolated submission protocols must cross the real LLM boundary.
for (const reject of [false,true]) for (const toolName of ['submit_direction','stage_update']) test(toolName + (reject ? ': native model stopping after partial acceptance seals scoped drops' : ': native director retains accepted ops and repairs only dropped anchors'), { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const root = await mkdtemp(join(tmpdir(), 'tavern-director-native-'))
  // the designated Windows executor forbids recursive cleanup.
  if (!process.env.DSH_KEEP_TEST_DATA) t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-session-persistence-jsonl', 'dsh-token-meter', 'dsh-agent-loop']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href + (name === 'dsh-session-persistence-jsonl' ? '\n  config:\n    root: ' + join(root, 'sessions') + '\n    compression: none' : '') + '\n').join(''))
  const ctx = await boot('director-native-test', config)
  t.after(() => ctx.fiber.dispose())
  const requests = [], deltas = []
  class Model extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(input) {
      requests.push(structuredClone(input))
      // model stop, not a harness cap, closes the rejected scenario.
      if(reject && requests.length===2) {yield {type:'finish',reason:{kind:'stop'}};return}
      const first = requests.length === 1
      const id = reject ? 'rejected-'+requests.length : first ? 'bad-call' : 'good-call'
      const ref = prepared.context.catalogue.candidates.backgrounds[0].ref
      const ops = [{op:'scene.set',background:reject||requests.length<=9?'missing':handles.ref(ref),time:null},...(first ? [{op:'screen.play',effect:'flash'}] : [])]
      const text = JSON.stringify({beats:[{at:1,ops}],...(toolName === 'stage_update' ? {sequence:1,through:8,done:true} : {})})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      for (let offset = 0; offset < text.length; offset += 5) {
        yield { type: 'tool-call-delta', index: 0, id, ...(offset === 0 ? { name: toolName } : {}), argumentsDelta: text.slice(offset, offset + 5) }
      }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: toolName, arguments: text } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.llm.registerAdapter(['director-fixture'], new Model())
  ctx.tools.register({ name: 'forbidden_global', parameters: { type: 'object' }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'forbidden' })
  const parent = await ctx.agents.create({ sessionId: 'director-parent', agentOptions: { provider: 'director-fixture', model: 'fixture' } })
  t.after(() => parent.dispose())
  const runner = createBackgroundAgentRunner({ agents: ctx.agents, systemAppend: () => 'FORBIDDEN APPEND', backgroundTools: [{ name: 'posture_submit', parameters: { type: 'object' } }] })
  t.after(() => runner.dispose())
  const f = await performanceFixture(), prepared = f.prepare(), handles = createDirectorHandles(prepared.context)
  const tx = createAssetPackTransaction({prepared,incremental:toolName === 'stage_update',getCurrentBinding:()=>prepared.binding})
  let accepted = false, submissions = 0
  if(reject) {
    const result = await runAssetPackDirector({prepared,incremental:toolName==='stage_update',getCurrentBinding:()=>prepared.binding,
      runAgent:input=>runner.run({...input,sessionId:'director-parent',selection:{provider:'director-fixture',model:'fixture'}})})
    assert.equal(result.effect.partial,true)
    assert.equal(result.effect.stats.droppedOps,1)
    assert.deepEqual(result.effect.entries[0].ops,[{op:'screen.play',effect:'flash'}])
    assert.equal(result.effect.diagnostics.find(item=>item.dropped).code,'REF_UNAVAILABLE')
    assert.equal(requests.length,2)
    for(const request of requests) assert.deepEqual(request.tools.map(tool=>tool.name),[toolName])
    assert.ok(requests[1].messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('partial')))
    return
  }
  const result = await runner.run({ sessionId: 'director-parent', task: 'stage-director', persistent: false,
    selection: { provider: 'director-fixture', model: 'fixture' }, system: 'EXACT DIRECTOR PERSONA',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'EXACT REPLY' }] }],
    tools: tx.request.tools,
    stopToolsWhen: () => accepted, acceptWithoutText: () => submissions > 0,
    onToolCallDelta(call) { deltas.push({ ...call, submissions }); },
    onToolCall(call) { submissions++; const reply = tx.submitModel(typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments); accepted = reply.sealed; return JSON.stringify(reply) }
  })
  assert.deepEqual(tx.effect().entries[0].ops.map(op=>op.op),['scene.set','screen.play'])
  assert.equal(result.text, '')
  assert.equal(submissions, 10)
  assert.equal(requests.length, 10)
  const streams = [...new Set(deltas.map(call => call.streamId))]
  assert.equal(streams.length, 10, 'retries have distinct attempt identities despite reusing block index 0')
  for (const [index, streamId] of streams.entries()) {
    const chunks = deltas.filter(call => call.streamId === streamId)
    assert.ok(chunks.length > 2)
    assert.equal(chunks[0].argumentsText, '{"bea')
    assert.ok(chunks.every(call => call.name === toolName && call.submissions === index), 'callbacks arrive before execution')
    assert.equal(JSON.parse(chunks.at(-1).argumentsText).beats[0].ops[0].background, index===9 ? handles.ref(prepared.context.catalogue.candidates.backgrounds[0].ref) : 'missing')
  }
  for (const request of requests) {
    assert.deepEqual(request.tools.map(tool => tool.name), [toolName])
    assert.equal(request.messages.filter(message => message.role === 'system').flatMap(message => message.content).map(block => block.text).join('\n'), 'EXACT DIRECTOR PERSONA')
  }
  const content = requests[1].messages.flatMap(message => message.content || [])
  assert.ok(content.some(block => block.type === 'tool-call' && block.id === 'bad-call'))
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.toolCallId === 'bad-call' && JSON.stringify(message.content).includes('beats[0].ops[0].background')))
})
