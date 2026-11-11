import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'


// The panel is a client fragment concatenated into the built bundle, so exercise
// the source file the way the other feature tests do.
const client = vm.createContext({})
vm.runInContext(readFileSync(new URL('../tavern-plugin/src/client/features/request-context.js', import.meta.url), 'utf8'), client, { filename: 'request-context.js' })
// vm 里造出来的数组和对象带的是那边的原型，deepEqual 会判成不相等；先搬回本 realm。
const sections = request => structuredClone(client.requestContextSections(request))
const tokens = text => client.estimateTavernTokens(text)
const titles = request => sections(request).map(section => section.title)

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
