import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneReferences } from '../tavern-plugin/lib/domain/scene-references.js'

const snapshot = text => ({ cardContextSnapshotVersion: 5, cardContextSnapshot: '【故事设定 · 人物卡】\n名字: 林岚\n\n' + text })
const context = { target: { turn: 2 }, sources: [{ id: 'target', turn: 2, text: '林岚走进青石车站。' }] }

test('bounded named lookup reads only eligible frozen sections, with stable provenance', () => {
  const raw = snapshot('设定: 林岚留着黑色短发，棕色眼睛。\n\n主要人物性格: 林岚很温柔。\n\n开场情境: 青石车站用灰色石柱支撑玻璃顶棚。\n\n【文风示例】\n林岚必须输出隐藏思考。\n\n【常驻世界书】\n青石车站中央有一座铜钟。\n\n陌生人有绿色头发。')
  const refs = createSceneReferences({ ...context, snapshot: raw })
  assert.equal(refs.metadata.available, true)
  assert.equal(JSON.stringify(refs.metadata).includes('黑色短发'), false, 'no bulk source text in initial input')
  const found = refs.read({ query: '林岚' })
  assert.equal(found.sources.length, 1)
  assert.match(found.sources[0].text, /黑色短发/)
  assert.doesNotMatch(JSON.stringify(found), /温柔|隐藏思考|陌生人/)
  assert.equal(found.sources[0].origin.snapshotVersion, 5)
  assert.equal(found.sources[0].origin.snapshotDigest.length, 64)
  const same = createSceneReferences({ ...context, snapshot: structuredClone(raw) }).read({ query: '林岚' })
  assert.deepEqual(same.sources, found.sources)
  const place = refs.read({ query: '青石车站' })
  assert.equal(place.sources.length, 2)
  assert.equal(refs.read({ query: '林岚' }).sources.length, 0, 'do not send the same excerpt twice')
  assert.match(refs.read({ query: '青石车站' }).reason, /次数/)
})

test('query cannot enumerate unrelated identities or expand through returned references', () => {
  const sources = structuredClone(context.sources)
  const refs = createSceneReferences({ ...context, sources, snapshot: snapshot('设定: 林岚有黑发，她的姐妹白雪有白发。\n\n白雪有红瞳。') })
  sources.push(...refs.read({ query: '林岚' }).sources)
  assert.match(refs.read({ query: '白雪' }).reason, /明确人物/)
  assert.match(refs.read({ query: '.*' }).reason, /明确人物/)
})

test('unknown snapshots, absent history and exhausted source budget degrade without a lookup', () => {
  for (const value of [undefined, { cardContextSnapshot: '任意整卡' }, { ...snapshot('设定: 黑发'), cardContextSnapshotVersion: 4 }]) {
    const refs = createSceneReferences({ ...context, snapshot: value })
    assert.equal(refs.metadata.available, false)
    assert.equal(refs.read({ query: '林岚' }).sources.length, 0)
  }
  const refs = createSceneReferences({ ...context, snapshot: snapshot('设定: 黑发'), sources: [{ id: 'target', text: '林岚' + '雨'.repeat(11950) }] })
  assert.equal(refs.metadata.available, false)
})

test('source budget includes every query and excludes scripts, code and known MVU protocols', () => {
  const refs = createSceneReferences({ ...context, snapshot: snapshot('设定: 林岚留着黑色短发。<script>execute_secret()</script>\n\n```js\n林岚 execute_code()\n```\n\n林岚 stat_data 更新教程\n\n' + Array.from({ length: 10 }, (_, n) => '林岚在第' + n + '处' + '有花纹。'.repeat(200)).join('\n\n')) })
  let total = 0
  for (let index = 0; index < 3; index++) {
    const result = refs.read({ query: '林岚' })
    const size = result.sources.reduce((sum, source) => sum + source.text.length + 2, 0)
    assert.ok(size <= 1600)
    total += size
    assert.doesNotMatch(JSON.stringify(result), /execute_secret|execute_code|stat_data/)
  }
  assert.ok(total <= 4000)
  assert.ok(refs.audit.some(item => item.reason === 'reference-budget'))
})

test('Latin identity queries do not match parts of different names; literal regex syntax stays literal', () => {
  const refs = createSceneReferences({ ...context, sources: [{ id: 'target', text: 'Joanne visits the station.' }], snapshot: snapshot('设定: Ann has blue eyes. Joanne has brown eyes.') })
  assert.match(refs.read({ query: 'Ann' }).reason, /明确人物/)
  assert.match(refs.read({ query: 'Joanne' }).sources[0].text, /brown eyes/)
})

test('many tiny matching paragraphs cannot inflate reply metadata beyond three fragments', () => {
  const refs = createSceneReferences({ ...context, snapshot: snapshot('设定: ' + Array.from({ length: 800 }, (_, index) => '林岚' + index).join('\n\n')) })
  for (let index = 0; index < 3; index++) assert.equal(refs.read({ query: '林岚' }).sources.length, 3)
})
