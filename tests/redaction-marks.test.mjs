// 数据删除 (mods/redaction/README.md): the text marks the director puts over words of a paragraph, from the
// manifest declaration through the submit tool's verbatim-quote check to the views that project them and the taps that
// open them.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {validateDistributionManifest} from '../tavern-plugin/lib/domain/mod-system.js'
import * as runtime from '../tavern-plugin/mods/redaction/runtime.js'
import stage from '../tavern-plugin/mods/redaction/stage.js'
import {createRedactionExtension, REDACTION_TAPS} from '../tavern-plugin/mods/redaction/host/extension.js'
import {installedFixture} from './helpers/mod-system-production-host.mjs'
import {createBuiltinModService} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mod-service.js'
import {fixture} from './helpers/stage-director-harness.mjs'

const require = createRequire(import.meta.url)
const marks = require('../tavern-plugin/packages/dsh-presentation-protocol/src/text-marks.cjs')
const {createStageText} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/text.cjs')
const feature = require('../tavern-plugin/mods/redaction/client/stage.cjs')
const {glitchCover, eraserDabs} = require('../tavern-plugin/mods/redaction/client/marks.cjs')
const manifest = JSON.parse(await readFile(new URL('../tavern-plugin/mods/redaction/mod.json', import.meta.url), 'utf8'))
const KINDS = [{modId:'dsh.redaction', command:'redact', quote:'quote'}]
const op = (quote, extra = {}) => ({op:'mod.command', modId:'dsh.redaction', commandId:'redact', params:{quote, ...extra}})

test('a paragraph has the sealed marks the director put on it, counted in record order', () => {
  const direction = {phase:'partial', through:2, entries:[
    {at:1, ops:[op('长青大厦'), {op:'mod.command', modId:'dsh.phone', commandId:'mark', params:{quote:'x'}}, op('十三楼')]},
    {at:2, ops:[op('低语者')]}, {at:3, ops:[op('未封口')]}]}
  assert.deepEqual(marks.textMarksAt(direction, 1, KINDS).map(row => [row.quote, row.index]), [['长青大厦', 0], ['十三楼', 1]])
  assert.deepEqual(marks.textMarksAt(direction, 3, KINDS), [], 'past the sealed prefix nothing shows yet')
  assert.deepEqual(marks.textMarksAt({...direction, phase:'running'}, 1, KINDS), [])
  assert.deepEqual(marks.textMarksAt(direction, 1, []), [], 'no feature declares a text mark: no marks')
})

test('every occurrence is covered and the earlier mark wins an overlap', () => {
  const list = [{quote:'十三楼', index:0}, {quote:'大厦十三', index:1}]
  assert.deepEqual(marks.textMarkRanges('去长青大厦十三楼，十三楼见', list).map(row => [row.start, row.end, row.mark.index]), [[5, 8, 0], [9, 12, 0]])
  const nodes = marks.textMarkNodes('ab十三楼cd', 0, 7, [{start:2, end:5, render:(text, key) => ({text, key})}])
  assert.deepEqual(nodes, ['ab', {text:'十三楼', key:'m0'}, 'cd'])
})

test('words that run over a page break are covered on both pages, and a quoted line shifts them', () => {
  const pages = ['我们在长青', '大厦等你']
  const first = marks.textMarkPageRanges(pages, 0, [{quote:'长青大厦', index:0}]), second = marks.textMarkPageRanges(pages, 1, [{quote:'长青大厦', index:0}])
  assert.deepEqual(first.map(row => [row.start, row.end, row.head, row.tail]), [[3, 5, true, false]])
  assert.deepEqual(second.map(row => [row.start, row.end, row.head, row.tail]), [[0, 2, false, true]])
  const quoted = marks.textMarkShift(second, 0, 4).map(row => ({...row, start:row.start + 1, end:row.end + 1}))
  assert.deepEqual(quoted.map(row => [row.start, row.end]), [[1, 3]])
})

test('the manifest declares a text-mark command whose quote is a required string', () => {
  validateDistributionManifest(manifest)
  assert.deepEqual(manifest.commands[0].textMark, {quote:'quote'})
  const broken = structuredClone(manifest)
  broken.commands[0].params.required = []
  assert.throws(() => validateDistributionManifest(broken), /quoted words/)
  const unknown = structuredClone(manifest)
  unknown.commands[0].textMark = {quote:'quote', speech:'omit'}
  assert.throws(() => validateDistributionManifest(unknown))
  const {open, noise, ...named} = feature.textMark({redaction:{RedactionMark:'Mark', open:'open'}})
  assert.equal(open, 'open'); assert.equal(typeof noise, 'function')
  assert.deepEqual(named, {modId:manifest.id, command:manifest.commands[0].id, quote:manifest.commands[0].textMark.quote, Mark:'Mark'},
    'the stage feature names the command and parameter the manifest declares')
})

test('the card default kind rides on the admission and an omitted kind records it; 遮挡指引 replaces the general line', async () => {
  const [command] = runtime.configure({manifest, settings:{values:{kind:'glitch', guidance:''}}}).commands
  assert.equal(command.admission.kind, 'glitch')
  assert.deepEqual(stage.admitParams(command, {quote:'低语者'}), {quote:'低语者', kind:'glitch'})
  assert.deepEqual(stage.admitParams(command, {quote:'低语者', kind:'bar'}), {quote:'低语者', kind:'bar'})
  const host = guidance => ({settings:{get:async () => ({values:{kind:'bar', guidance}})}})
  assert.equal(await runtime.prepare({}, host('  ')), null)
  assert.deepEqual(await runtime.prepare({}, host('异常的真名、\n伤亡人数')), {sections:[{id:'redact-guidance', text:'<redaction_guidance>异常的真名、 伤亡人数</redaction_guidance>\n'}]})
  assert.equal(await runtime.command(), null, 'a sealed mark runs nothing: the record is the mark')
})

test('the submit tool admits only words quoted verbatim from the beat paragraph; the record keeps the card kind', async t => {
  const native = await installedFixture(t, {enabled:['dsh.redaction']})
  const service = createBuiltinModService({management:native.production, variables:{}, readCard:native.readWorkspace, stage:{read:async () => undefined, update:async () => {}}})
  t.after(() => service.dispose())
  const replies = [], prompts = []
  const runModel = async request => {
    prompts.push(JSON.stringify(request.messages || request))
    const submit = beats => request.onToolCall({name:'stage_update', arguments:{sequence:1, through:2, done:true, beats}}).then(JSON.parse)
    replies.push(await submit([{at:1, ops:[{op:'mod.dsh.redaction.redact', quote:'dusk'}]}]))
    replies.push(await submit([{at:1, ops:[{op:'mod.dsh.redaction.redact', quote:'fixture'}]}]))
  }
  const h = await fixture(runModel, {mods:service})
  t.after(() => h.dispose())
  await h.director.get(h.read(), 1); await h.director.drain()
  assert.equal(replies[0].ok, false)
  assert.match(JSON.stringify(replies[0].errors), /paragraph at=1/)
  assert.equal(replies[1].ok, true, JSON.stringify(replies[1]))
  const record = h.read().messages.at(-1).stageDirectionAssetPacks
  const marked = record.entries.flatMap(entry => entry.ops.map(row => ({at:entry.at, ...row}))).filter(row => row.modId === 'dsh.redaction')
  assert.deepEqual(marked, [{at:1, op:'mod.command', modId:'dsh.redaction', commandId:'redact', params:{quote:'fixture', kind:'bar'}}])
  assert.match(prompts[0], /mod_redaction/)
  assert.match(prompts[0], /redaction_guidance/)
})

test('taps are kept per game and round; a regenerated round is covered again; ids never become paths', async () => {
  const files = new Map()
  const profileData = {readJson:async path => structuredClone(files.get(path) ?? null),
    updateJson:async (path, fn) => { const next = await fn(structuredClone(files.get(path) ?? null)); if (next !== undefined) files.set(path, next); return next }}
  const {requests} = createRedactionExtension({profileData})
  const call = (method, args) => requests.call(method, args)
  const place = {sessionId:'session-1', turn:4, source:'src-a', para:2, index:0}
  for (let i = 0; i < REDACTION_TAPS + 1; i++) await call('tapStageRedaction', place)
  assert.deepEqual(await call('getStageRedactions', {sessionId:'session-1'}), {status:'ready', turns:{4:{source:'src-a', marks:{'2:0':REDACTION_TAPS}}}})
  assert.deepEqual(await call('tapStageRedaction', {...place, source:'src-b'}), {status:'ready', taps:1})
  assert.deepEqual((await call('getStageRedactions', {sessionId:'session-1'})).turns[4], {source:'src-b', marks:{'2:0':1}})
  assert.equal((await call('getStageRedactions', {sessionId:'../index'})).status, 'unavailable')
  assert.equal((await call('tapStageRedaction', {...place, para:0})).status, 'unavailable')
  assert.deepEqual([...files.keys()], ['redaction/session-1.json'])
})

test('a mark is one typing step drawn by its mod; plain glyphs around it type as before', () => {
  const React = {useState:initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef:current => ({current}), useMemo:fn => fn(),
    useEffect() {}, useLayoutEffect() {}, createElement:(type, props, ...children) => ({type, props, children:children.flat(Infinity)})}
  const text = createStageText({React, document:{}, defaultTextSpeed:28, clock:{now:() => 0, setTimeout:() => 0, clearTimeout() {}}})
  const drawn = []
  const node = text.Typewriter({text:'去长青大厦十三楼', instant:true, marks:[{start:5, end:8, render:(words, key) => (drawn.push(words), {mark:words, key})}]})
  const shown = node.children.find(child => child?.props?.className === 'fork-gal-type-shown')
  assert.deepEqual(shown.children, ['去长青大厦', {mark:'十三楼', key:'m5'}])
  assert.deepEqual(drawn, ['十三楼'])
})

test('a glitch cover keeps the words width and settles from the left; the eraser is the same for the same seed', () => {
  assert.equal(Array.from(glitchCover(Array.from('长青13'), 0, 0)).length, 4)
  assert.match(glitchCover(Array.from('长青13'), 0, 0).slice(2), /^[#%&@$?*!]{2}$/)
  assert.equal(glitchCover(Array.from('长青13'), 2, 5).slice(0, 2), '长青')
  assert.deepEqual(eraserDabs(42, 1, 4), eraserDabs(42, 1, 4))
  assert.notDeepEqual(eraserDabs(42, 1, 4), eraserDabs(43, 1, 4))
  for (const dab of eraserDabs(7, 2, 6)) assert.ok(dab[0] >= -0.05 && dab[0] <= 1.05 && dab[3] > 0)
})
