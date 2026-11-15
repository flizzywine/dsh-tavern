// 出现条件 (an entry's recall.when on the card's settled variables) and 叠字 (a CG's caption over the picture).
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
import {mvuConditionHolds} from '../tavern-plugin/lib/domain/mvu-visibility.js'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
import {syntheticPack, cardExtension, PACK_ID, distinctMedia} from './fixtures/asset-packs/pack.mjs'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {prepareAssetPackDirector, createAssetPackTransaction} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-director.js'
import {initialAssetPackStage} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-tools.js'
import {settledStatData} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-items.js'
const {createStageCg} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/cg.cjs')

const stat = {好感: {小林: [65, '0-100'], 小周: 20}, 剧情: {阶段: '夏天', 结局: 'TE'}, 旗标: {看见: true}}

test('a variable condition reads stat_data: equals, atLeast, atMost, MVU tuples and all of a list', () => {
  assert.equal(mvuConditionHolds({path: '/好感/小林', atLeast: 60}, stat), true)
  assert.equal(mvuConditionHolds({path: '/好感/小林', atLeast: 66}, stat), false)
  assert.equal(mvuConditionHolds({path: '/好感/小周', atMost: 20}, stat), true)
  assert.equal(mvuConditionHolds({path: '/剧情/结局', equals: 'TE'}, stat), true)
  assert.equal(mvuConditionHolds({path: '/stat_data/旗标/看见', equals: true}, stat), true)
  assert.equal(mvuConditionHolds([{path: '/好感/小林', atLeast: 60}, {path: '/剧情/阶段', equals: '秋天'}], stat), false)
  assert.equal(mvuConditionHolds([{path: '/好感/小林', atLeast: 60}, {path: '/剧情/阶段', equals: '夏天'}], stat), true)
  assert.equal(mvuConditionHolds({path: '/剧情/阶段', atLeast: 1}, stat), false, 'a word is not a number')
  assert.equal(mvuConditionHolds({path: '/不存在', equals: true}, stat), false)
  assert.equal(mvuConditionHolds({path: '/好感/小林', atLeast: 1}, undefined), false, 'no settled variables yet')
})

const cg = (extra = {}, content = {}) => ({kind: 'cg', id: 'ending', name: '结局', enabled: true, directorNote: '', recall: {mode: 'constant', keywords: []},
  variants: {default: 'base', entries: [{id: 'base', name: 'Base', content: {media: 'a'.repeat(64), ...content}}]}, ...extra})
test('recall.when and caption are validated once, on write', () => {
  validateAsset(cg({recall: {mode: 'constant', keywords: [], when: {path: '/剧情/结局', equals: 'TE'}}}, {caption: {title: 'TE · 晚饭', line: '那天的味道', appear: 'type'}}))
  validateAsset(cg({recall: {mode: 'keyword', keywords: ['花火'], when: [{path: '/好感/小林', atLeast: 60}, {path: '/好感/小林', atMost: 90}]}}))
  validateAsset({kind: 'music', id: 'm', name: 'M', enabled: true, directorNote: '', recall: {mode: 'constant', keywords: [], when: {path: '/a', equals: 1}}, media: 'b'.repeat(64)})
  for (const when of [{path: '/a'}, {path: '/a', equals: 1, atLeast: 2}, {path: 'a', equals: 1}, {path: '/a', atLeast: '6'}, [], Array(9).fill({path: '/a', equals: 1}), {path: '/a', equals: {}}])
    assert.throws(() => validateAsset(cg({recall: {mode: 'constant', keywords: [], when}})), /INVALID_ASSET_PACK|LIMIT_EXCEEDED|UNKNOWN_FIELD|condition|path|number|exactly/i, JSON.stringify(when))
  assert.throws(() => validateAsset({kind: 'directions', id: 'd', name: 'D', enabled: true, directorNote: '', recall: {mode: 'constant', keywords: [], when: {path: '/a', equals: 1}}, text: ''}), {code: 'UNKNOWN_FIELD'})
  for (const caption of [{}, {appear: 'fade'}, {title: ''}, {title: 'a\nb'}, {line: 'x'.repeat(81)}, {title: 'T', appear: 'zoom'}, {title: 'T', color: 'red'}])
    assert.throws(() => validateAsset(cg({}, {caption})), undefined, JSON.stringify(caption))
})

async function fixture() {
  const pack = await syntheticPack(), image = Object.keys(pack.manifest.blobs).find(hash => pack.manifest.blobs[hash].mime === 'image/png')
  const add = (id, recall) => pack.manifest.assets.push(distinctMedia({kind: 'cg', id, name: id, enabled: true, directorNote: 'Ending picture.', recall,
    variants: {default: 'base', entries: [{id: 'base', name: 'Base', content: {description: 'End.', media: image, caption: {title: 'TE'}}}]}}, id))
  add('ending', {mode: 'constant', keywords: [], when: {path: '/剧情/结局', equals: 'TE'}})
  add('festival', {mode: 'keyword', keywords: ['花火'], when: {path: '/好感/小林', atLeast: 80}})
  const input = {baseline: initialAssetPackStage({}), raw: {first_mes: 'Opening', extensions: {dsh_tavern: cardExtension()}}, snapshots: [{...pack, revision: 'r1'}],
    assetStatus: Object.fromEntries(pack.manifest.assets.map(a => [assetRefKey({packId: PACK_ID, kind: a.kind, assetId: a.id}), {available: true}])),
    cardRevision: 'r1', engine: {dimensions: {}}, target: {sourceKey: 'cond', branchId: 'b1', revision: 1, turn: 1}, units: ['夏日的花火大会。', 'End.']}
  return input
}
const on = variables => when => mvuConditionHolds(when, variables)
const offered = prepared => prepared.context.catalogue.candidates.cg.map(row => row.ref.assetId)
const reason = (prepared, id) => prepared.context.catalogue.rows.find(row => row.ref.assetId === id).excluded

test('an entry with a condition is offered to the director only while the settled variables meet it', async () => {
  const input = await fixture()
  let prepared = prepareAssetPackDirector(input)
  assert.deepEqual(offered(prepared), [], 'no settled variables: nothing conditional, not even blue or a word hit')
  assert.equal(reason(prepared, 'ending'), 'condition-unmet'); assert.equal(reason(prepared, 'festival'), 'condition-unmet')
  prepared = prepareAssetPackDirector({...input, condition: on(stat)})
  assert.deepEqual(offered(prepared), ['ending'], 'blue with its condition met; the word hit still needs 好感 80')
  prepared = prepareAssetPackDirector({...input, condition: on({...stat, 好感: {小林: 85}})})
  assert.deepEqual(offered(prepared).sort(), ['ending', 'festival'])
  // a CG already on stage stays when its condition stops holding; only a new show needs it.
  const tx = createAssetPackTransaction({prepared, getCurrentBinding: () => prepared.binding})
  tx.submit({sequence: 1, through: 2, done: true, beats: [{at: 1, ops: [{op: 'cg.set', cg: {packId: PACK_ID, kind: 'cg', assetId: 'ending'}}]}]})
  tx.finish()
  const next = prepareAssetPackDirector({...input, record: tx.effect(), condition: on({})})
  assert.equal(next.baseline.cg?.ref.assetId, 'ending')
  assert.deepEqual(offered(next), [])
})

test('the director reads the variables of the latest settled round before its own', () => {
  const settled = (value, extra = {}) => ({role: 'assistant', swipeId: 0, variables: [{stat_data: value}], mvuBaseline: {swipeId: 0}, mvu: {receipt: {status: 'updated'}}, ...extra})
  const chat = {messages: [{role: 'user'}, settled({n: 1}), {role: 'user'}, settled({n: 2}, {mvu: {pending: true}}), {role: 'user'}, {role: 'assistant'}]}
  assert.deepEqual(settledStatData(chat, 5), {n: 1}, 'a settlement still pending does not count')
  assert.deepEqual(settledStatData(chat, 2), {n: 1})
  assert.equal(settledStatData(chat, 1), undefined)
})

function mountCaption() {
  const {window} = new JSDOM('<div class="fork-cg-stage"><img><img><div class="fork-cg-caption" hidden></div><div class="fork-cg-white"></div></div>')
  const element = window.document.querySelector('.fork-cg-stage'), refs = [], effects = []
  let options, presented
  const player = createStageCg({
    React: {useRef: value => {const ref = {current: value}; refs.push(ref); return ref}, useState: value => [value, () => {}], useMemo: fn => fn(),
      useLayoutEffect: fn => effects.push(fn), useCallback: fn => fn, createElement: () => null},
    window: {matchMedia: () => ({addEventListener() {}, removeEventListener() {}})}, ResizeObserver: class {observe() {} disconnect() {}},
    consumer: value => {options = value; return {policy() {}, redraw() {}, present(cg, how) {presented = how; return Promise.resolve()}, dispose() {}}},
    policy: () => ({}), rpc: async () => {}, paint: () => true,
  })
  const view = player.useStage('s', {getSnapshot: () => ({})}, {forward: true})
  refs[0].current = element; effects.forEach(fn => fn())
  return {element, box: element.querySelector('.fork-cg-caption'), view, frame: frame => options.onFrame(frame), presented: () => presented}
}
const shown = caption => ({ref: {packId: PACK_ID, kind: 'cg', assetId: 'ending'}, media: {identity: 'm1'}, ...(caption ? {caption} : {})})

test('the caption is laid over the shown CG, keyed so a new caption restarts its appearance and a snap shows it settled', async () => {
  const m = mountCaption()
  await m.view.accept({accepted: {cg: shown({title: 'TE · 晚饭', line: '那天'}), provenanceByChannel: {}}, transition: 'fade'})
  assert.equal(m.presented().snap, false)
  m.frame({current: shown({title: 'TE · 晚饭', line: '那天'}), previous: null, alpha: 1})
  assert.equal(m.box.hidden, false); assert.equal(m.box.dataset.appear, 'fade'); assert.equal(m.box.dataset.snap, undefined)
  assert.deepEqual([...m.box.children].map(row => [row.className, row.textContent]), [['fork-cg-caption-title', 'TE · 晚饭'], ['fork-cg-caption-line', '那天']])
  const first = m.box.firstChild
  m.frame({current: shown({title: 'TE · 晚饭', line: '那天'}), previous: null, alpha: 1})
  assert.equal(m.box.firstChild, first, 'repainting the same caption leaves its animation running')
  await m.view.accept({accepted: {cg: shown({title: '逐字', appear: 'type'}), provenanceByChannel: {}}, transition: 'snap'})
  m.frame({current: shown({title: '逐字', appear: 'type'}), previous: null, alpha: 1})
  assert.equal(m.box.dataset.snap, 'true'); assert.equal(m.box.dataset.appear, 'type')
  assert.deepEqual([...m.box.querySelectorAll('span')].map(span => [span.textContent, span.style.getPropertyValue('--i')]), [['逐', '0'], ['字', '1']])
  // leaving: the outgoing picture keeps its words while it fades; a CG without a caption shows none.
  m.frame({current: null, previous: shown({title: '逐字', appear: 'type'}), alpha: .5})
  assert.equal(m.box.hidden, false)
  m.frame({current: shown(), previous: null, alpha: 1})
  assert.equal(m.box.hidden, true); assert.equal(m.box.children.length, 0)
})
