import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture, IMAGE_PNG, imageJson } from './fixtures/image-plugin-runtime.mjs'
import { injectDefinitions } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const person = (id, name, match, face) => ({ id, name, match, enabled: true, traits: { face } })
const run = (text, characters) => injectDefinitions(text, { characters }, {}, { style: 'natural', raw: text })

const a = person('a', '鹿目圆', '鹿目', 'pink twin tails, gentle eyes')
const b = person('b', '鹿目詢子', '鹿目', 'short brown hair, sharp eyes')

test('a name shared by two different people injects neither look', () => {
  const { text, hits } = run('鹿目站在窗边', [a, b])
  assert.doesNotMatch(text, /pink twin tails|short brown hair/)
  assert.deepEqual(hits, [])
})

test('a unique full name still injects only that person', () => {
  const { text } = run('鹿目圆站在窗边', [a, b])
  assert.match(text, /pink twin tails/)
  assert.doesNotMatch(text, /short brown hair/)
})

test('forms of one character are not ambiguous', () => {
  const human = person('h', '殷雪（人形）', '殷雪', 'silver hair, pale skin')
  const fox = person('f', '殷雪（显形）', '殷雪', 'silver fox ears, silver tail')
  const { text } = run('殷雪站在窗边', [human, fox])
  assert.match(text, /silver hair/)
})
test('distinct records with exactly the same full name are ambiguous', () => {
  const { text, hits } = run('安娜站在窗边', [person('anna-a', '安娜', 'Anna A', 'red hair'), person('anna-b', '安娜', 'Anna B', 'blue hair')])
  assert.deepEqual(hits, [])
  assert.doesNotMatch(text, /red hair|blue hair/)
})


test('planner warns for a shared short name, but a unique full name is resolved without that warning', async t => {
  const fixture = await imagePluginFixture(t, { definitions: { characters: [a, b] }, llm: { async *stream({ messages }) {
    const text = (messages?.at(-1)?.content || []).map(part => part.text || '').join('')
    const scene = text.includes('鹿目圆') ? '鹿目圆站在窗边。' : '鹿目站在窗边。'
    yield { type: 'text-delta', text: '<images><image><regex>' + scene + '</regex><prompts>' + scene + '</prompts></image></images>' }
  } } })
  globalThis.fetch = async (url) => url.endsWith('/generateImage') ? imageJson({ data: { id: 'done', status: 'completed', outputs: ['https://images.example.test/result.png'] } }) : new Response(IMAGE_PNG)
  const runtime = await fixture.start()
  for (const [name, warn] of [['鹿目圆', false], ['鹿目', true]]) {
    const result = await runtime.request('plan', { text: name + '站在窗边。', messageId: 'name-warning-' + name, count: 1, manual: true })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.plans.length, 1, JSON.stringify(result.body))
    assert.equal((result.body.plan.characterWarnings || []).some(text => text.includes('不止一个人')), warn, JSON.stringify(result.body))
  }
})
