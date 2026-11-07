import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { projectHistoryAsToolCalls } from '../tavern-plugin/lib/domain/history-tool-call.js'
import { appendVariableChanges } from '../tavern-plugin/lib/hooks/request.js'

// The panel is a client fragment concatenated into the built bundle, so exercise
// the source file the way the other feature tests do.
const client = vm.createContext({})
vm.runInContext(readFileSync(new URL('../tavern-plugin/src/client/features/request-context.js', import.meta.url), 'utf8'), client, { filename: 'request-context.js' })
// vm 里造出来的数组和对象带的是那边的原型，deepEqual 会判成不相等；先搬回本 realm。
const sections = request => structuredClone(client.requestContextSections(request))
const tokens = text => client.estimateTavernTokens(text)
const titles = request => sections(request).map(section => section.title)
const rendered = request => sections(request).map(section => section.title + '\n' + section.text).join('\n')

const preset = (phase, text) => ({
  role: phase === 'back' ? 'user' : 'system',
  content: [{ type: 'text', text }],
  source: { kind: 'plugin:dsh-tavern', form: 'snapshot', sections: [{ name: 'tavern:runtime-preset-' + phase, text }] }
})

test('工具定义夹在前置系统消息与普通消息之间，消息下标保持原样', () => {
  const request = {
    tools: [{ type: 'function', function: { name: 'tavern_read_play_chat' } }],
    messages: [preset('front', '前段'), { role: 'system', content: '系统' }, { role: 'user', content: '正文' }, { role: 'assistant', content: '回复' }]
  }
  // 工具是请求字段，不是最后一条消息；挪到末尾会让人以为它跟着对话走。
  assert.deepEqual(titles(request), ['messages[0] · system · 预设前段', 'messages[1] · system', 'tools · 工具定义', 'messages[2] · user', 'messages[3] · assistant'])
})

test('预设前段、后段会从消息正文里切出来，仍归属同一条消息', () => {
  const body = '我推开门，风灌进来。'
  const back = '【写作规则】保持克制。'
  const request = {
    messages: [
      // 系统消息：前段 + 系统正文拼成一条，靠来源节切分。
      { role: 'system', content: '【前段】' + '你是叙述者。', source: { sections: [{ name: 'tavern:runtime-preset-front', text: '【前段】' }, { name: 'tavern:dsh-system', text: '你是叙述者。' }] } },
      // 回合输入与末尾预设被合并进同一条 user 消息，这是运行时本来的形状。
      { role: 'user', content: body + '\n\n' + back, source: { sections: [{ name: 'tavern:turn', text: body }, { name: 'tavern:runtime-preset-back', text: back }] } }
    ]
  }
  assert.deepEqual(titles(request), ['messages[0] · system · 预设前段', 'messages[0] · system · 消息正文', 'messages[1] · user · 消息正文', 'messages[1] · user · 预设后段'])
  const byTitle = Object.fromEntries(sections(request).map(section => [section.title, section]))
  assert.equal(byTitle['messages[0] · system · 预设前段'].text, '【前段】')
  assert.equal(byTitle['messages[0] · system · 消息正文'].text, '你是叙述者。')
  assert.equal(byTitle['messages[1] · user · 预设后段'].text, back)
  assert.ok(byTitle['messages[1] · user · 消息正文'].text.startsWith(body))
  // 切分后每节的字符数只算正文，不含分节之间补的分隔符。
  for (const section of Object.values(byTitle)) assert.equal(section.count, section.body.reduce((sum, text) => sum + text.length, 0))
})

test('token 估算：中文约 1.5、拉丁约每 4 字母 1 个、数字约每 3 位 1 个', () => {
  assert.equal(tokens(''), 0)
  assert.equal(tokens(undefined), 0)
  assert.equal(tokens('汉'.repeat(100)), 150)
  assert.equal(tokens('a'.repeat(400)), 100)
  assert.equal(tokens('1'.repeat(30)), 10)
  // 只做量级比较：加字不会让估算变少。
  for (let length = 1; length <= 40; length += 3) assert.ok(tokens('汉'.repeat(length + 3)) >= tokens('汉'.repeat(length)))
})

test('输入走工具调用后，完整上下文仍能看到全部正文，只是换了形状', () => {
  const history = [
    { id: 'm1', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '开场白：风从海上来了。' }] },
    { id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '我推门进去。' }] },
    { id: 'm3', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '本轮输入' }] }
  ]
  const projected = projectHistoryAsToolCalls(history, { toolName: 'submit_story', layout: 'all' })
  const request = { tools: [{ type: 'function', function: { name: 'submit_story' } }], messages: projected }
  // 历史正文改成 submit_story 的调参，每条调用后面跟一条回执。
  assert.deepEqual(titles(request), ['tools · 工具定义', 'messages[0] · user', 'messages[1] · assistant', 'messages[2] · tool', 'messages[3] · assistant', 'messages[4] · tool', 'messages[5] · user'])
  const text = rendered(request)
  // 换形状不换内容：每段正文都还在，而且只出现一次（回执只有「已收到。」）。
  for (const body of ['开场白：风从海上来了。', '我推门进去。']) assert.equal(text.split(body).length - 1, 1, body)
  // 工具必须带着声明进请求，否则回放的调用在供应商那边对不上。
  assert.ok(text.includes('"submit_story"'))
  // 本轮输入仍是普通 user 消息，不会被回放成调用。
  const last = sections(request).at(-1)
  assert.equal(last.title, 'messages[5] · user')
  assert.equal(last.text, '本轮输入')
})

test('候选重生成不附加旧正文产生的上轮变量变化', () => {
  const assistant = hp => ({ role: 'assistant', swipeId: 0, variables: [{ stat_data: { hp } }] })
  const chat = { mode: 'story', mvu: { enabled: true }, messages: [assistant(1), assistant(2)] }
  const decision = { kind: 'enter', messages: [] }
  const ordinary = appendVariableChanges({ chat, payload: { step: 1 }, decision })
  assert.equal(ordinary.messages.length, 1)
  const candidate = appendVariableChanges({ chat: { ...chat, regenRecovery: { candidateFrame: { kind: 'foreground' } } }, payload: { step: 1 }, decision })
  assert.equal(candidate, decision)
})
