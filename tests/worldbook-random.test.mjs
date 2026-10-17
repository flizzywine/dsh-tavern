import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { projectWorldBookTemplates } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { renderWorldbookRandom } from '../tavern-plugin/lib/domain/worldbook-random.js'
import { projectAgentContent } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()
test('固定前缀稳定，随机位置完整追加；同轮复用、新轮刷新且不进入冷却', async () => {
  const entries = [
    { ref: 'fixed', constant: true, content: '固定规则', position: 4, depth: 2, order: 5 },
    { ref: 'open', constant: true, content: '<角色库>', position: 4, depth: 2, order: 10 },
    { ref: 'pool', constant: true, content: '<%= Math.random() %> {{roll 1d20}} {{random::甲,乙}}', position: 4, depth: 2, order: 20 },
    { ref: 'close', constant: true, content: '</角色库>', position: 4, depth: 2, order: 30 }
  ].map(e => ({ enabled: true, ...e }))
  const worldBook = { view: { entries } }
  const project = createForegroundWorldbook({ bound: async () => worldBook, runtime: async () => runtime, globalVariables: async () => ({}) })
  const chat = { messages: [{ role: 'assistant', greeting: true, turn: 1, text: '开场' }] }
  const a = await project({ chat, card: {}, userText: '继续' })
  assert.equal(a.error, null)
  assert.equal(a.prefixContext, '固定规则')
  assert.match(a.context, /^<角色库>\n\n0\.\d+ \d+ [甲乙]\n\n<\/角色库>$/)
  assert.deepEqual(a.refs, [])
  chat.worldBookRandomState = a.randomState
  const repeat = await project({ chat, card: {}, userText: '继续' })
  assert.equal(repeat.context, a.context)
  const background = await projectWorldBookTemplates({ worldBook, runtime, includeConstants: true, chat, card: {}, randomSeed: 'different-background-seed', randomOutputs: a.randomState.outputs })
  assert.equal(background.foregroundContext, a.context)
  chat.messages.push({ role: 'assistant', turn: 2, text: '正文' })
  const b = await project({ chat, card: {}, userText: '继续' })
  assert.equal(b.prefixContext, a.prefixContext)
  assert.notEqual(b.context, a.context)
})

test('骰子与随机宏接受 SillyTavern 的单冒号、空格与纯数字写法', () => {
  const max = () => 0.999
  assert.equal(renderWorldbookRandom('通用{{roll: d8}}/{{roll:d4}}/{{roll::2d3+1}}/{{roll 1d20}}/{{roll:6}}', max), '通用8/4/7/20/6')
  assert.equal(renderWorldbookRandom('{{random:甲,乙}} {{random::丙::丁}}', () => 0), '甲 丙')
  assert.equal(renderWorldbookRandom('{{roll: x}}', max), '{{roll: x}}')
})

test('关键词条目等未经每轮渲染的骰子宏，在投影给模型时仍会掷出数字', () => {
  const text = projectAgentContent('<pic>SFW/塔菲/通用{{roll: d8}}</pic>', { charName: '塔菲' }).agentText
  assert.match(text, /^<pic>SFW\/塔菲\/通用[1-8]<\/pic>$/)
})
