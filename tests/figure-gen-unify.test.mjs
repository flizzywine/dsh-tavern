// The figure's 「编辑」 and 「生图」 pages generate through one flow — one batch plan
// (genOutfitPlan), one heading tool (GenOutfitTool) and one ✕｜✓ decision on a tile (GenTileDecide), all in asset-pack-gen-ui.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const read = file => readFile(new URL('../tavern-plugin/' + file, import.meta.url), 'utf8').then(source => source.replace(/\r\n/g, '\n'))

async function stageViews() {
  const entry = await read('packages/dsh-tavern-stage/src/client/entry.js')
  const start = entry.indexOf('function createStageAssetPackViews(core) {'), end = entry.indexOf('__STAGE_FEATURES__', start)
  const sources = {
    __STAGE_CARD_STAGE_MODE__: 'packages/dsh-presentation-protocol/src/card-stage-mode.cjs',
    __STAGE_ASSET_PACK_GEN_UI__: 'packages/dsh-tavern-stage/src/client/asset-pack-gen-ui.js',
    __STAGE_ASSET_PACK_CARD_UI__: 'packages/dsh-tavern-stage/src/client/asset-pack-card-ui.js',
    __STAGE_ASSET_PACK_ENGINE_UI__: 'packages/dsh-tavern-stage/src/client/asset-pack-engine-ui.js',
    __STAGE_MOD_MANAGER__: 'packages/dsh-tavern-stage/src/client/mod-manager.js',
  }
  let factory = entry.slice(start, end)
  for (const [token, file] of Object.entries(sources)) factory = factory.replace(token, await read(file))
  const create = new Function('"use strict";\n' + factory + '\nreturn createStageAssetPackViews;')()
  // A plain element tree: {type, props, children}; helpers of the core are small stand-ins for the slots used here.
  const createElement = (type, props, ...children) => ({type, props: props || {}, children: children.flat()})
  const IconButton = props => props, Spinner = () => null
  const given = {React: {memo: view => view, createElement, Fragment: 'fragment'}, h: createElement, IconButton, Spinner,
    directorCommands: require('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'),
    emotionMapped: (kind, outfit, manifest, id) => !!outfit.stills?.[id],
    outfitImageId: (outfit, id) => id,
    spriteSlotTakesStill: (outfit, manifest, id) => !outfit.talking?.includes(id)}
  const names = new Proxy(given, {get: (target, name) => Object.hasOwn(target, name) ? target[name] : () => null})
  return {views: create(names), IconButton}
}

const fakeGen = (overrides = {}) => ({jobFor: () => null, pending: {}, errors: {}, adoptErrors: {}, after: new Set(), progress: null, jobs: [], ...overrides})
const figure = {id: 'hero', emotions: [{id: 'calm', label: '平和'}, {id: 'joy', label: '喜悦'}, {id: 'sad', label: '悲伤'}, {id: 'shy', label: '害羞'}, {id: 'talk', label: '说话'}]}
const rows = figure.emotions
// calm: 立绘 + 头像; joy: 立绘 only; sad: nothing; shy: nothing but 回退; talk: a talking 立绘 without 头像.
const outfit = {key: 'daily', label: '日常', defaultEmotion: 'calm', stills: {calm: 'h1', joy: 'h2', talk: 'h3'}, avatars: {calm: 'a1'}, fallbackEmotions: ['shy'], talking: ['talk']}

test('one plan: a missing 立绘 brings its 头像 as the follow-up, a 差分 with a 立绘 gets its 头像, nothing is replaced', async () => {
  const {views} = await stageViews()
  const plan = views.genOutfitPlan(fakeGen(), 'p', figure, outfit, null, rows)
  assert.deepEqual(plan.todo.map(r => r.id), ['joy', 'sad', 'talk'])
  const byId = Object.fromEntries(plan.items.map(item => [item.target.emotionId, item]))
  assert.equal(byId.joy.target.kind, 'avatar')
  assert.equal(byId.sad.target.kind, 'sprite')
  assert.deepEqual(byId.sad.input.followUp.map(f => [f.kind, f.emotionId]), [['avatar', 'sad']])
  assert.equal(byId.talk.target.kind, 'avatar')
  assert.equal(plan.drawsSprite, true)
  assert.equal(plan.progress, null)
})

test('a 差分 with a request in flight or waiting is left alone; waiting pictures feed 全部采用; a batch counts only for its outfit', async () => {
  const {views} = await stageViews()
  const jobs = {'sprite/hero/daily/sad': {jobId: 'j1', status: 'running', createdAt: 1, target: {kind: 'sprite'}},
    'avatar/hero/daily/joy': {jobId: 'j2', status: 'candidate', createdAt: 2, target: {kind: 'avatar'}}}
  const key = t => [t.kind, t.figureId, t.outfitKey, t.emotionId].join('/')
  const gen = fakeGen({jobFor: t => jobs[key(t)] || null, progress: {done: 1, total: 3, keys: ['sprite/hero/daily/sad']}})
  const plan = views.genOutfitPlan(gen, 'p', figure, outfit, null, rows)
  assert.deepEqual(plan.todo.map(r => r.id), ['talk'])
  assert.deepEqual(plan.waiting.map(j => j.jobId), ['j2'])
  assert.deepEqual(plan.progress, gen.progress)
  const other = views.genOutfitPlan(gen, 'p', figure, {...outfit, key: 'swim'}, null, rows)
  assert.equal(other.progress, null)
})

test('the heading tool: without any 设定 a batch that draws a 立绘 says why instead of starting', async () => {
  const {views, IconButton} = await stageViews()
  const started = [], gates = []
  const gen = fakeGen({batch: items => { started.push(items); return Promise.resolve() }})
  const plan = views.genOutfitPlan(gen, 'p', figure, outfit, null, rows)
  const tool = (basis, extra = {}) => views.GenOutfitTool({gen, plan, basis, accepting: false, onAcceptAll() {}, onGate: text => gates.push(text), onStart: p => p, ...extra})
  const button = tool('').children.find(child => child.type === IconButton)
  assert.equal(button.props['data-gen-tool'], 'fill')
  assert.equal(button.props.label, '生成缺少的 3 个差分')
  button.props.onClick()
  assert.equal(started.length, 0)
  assert.match(gates.at(-1), /还没有设定/)
  tool('text').children.find(child => child.type === IconButton).props.onClick()
  assert.equal(started.length, 1)
  assert.equal(gates.at(-1), '')
  assert.equal(tool('text', {hideFill: true}), null)
})

test('a waiting picture is decided by the one ✕｜✓ pill; 不要 drops every waiting picture of the tile, ✓ adopts them', async () => {
  const {views} = await stageViews()
  const rejected = [], adopted = []
  const gen = fakeGen({reject: job => { rejected.push(job.jobId); return Promise.resolve() }})
  const cells = [{state: 'candidate', job: {jobId: 's'}}, {state: 'idle'}, {state: 'candidate', job: {jobId: 'a'}}]
  const pill = views.GenTileDecide({gen, cells, label: '「喜悦」新图', id: 'joy', run: fn => fn(), acceptAll: jobs => adopted.push(...jobs.map(j => j.jobId))})
  const decide = pill.type({...pill.props})
  const [no, yes] = decide.children
  no.props.onClick(); yes.props.onClick()
  assert.deepEqual(rejected, ['s', 'a'])
  assert.deepEqual(adopted, ['s', 'a'])
  assert.equal(views.GenTileDecide({gen, cells: [{state: 'running'}], label: '', id: 'joy', run() {}, acceptAll() {}}), null)
})

test('编辑 has no generation flow of its own: its heading tool and tile decision are 生图\'s', async () => {
  const figureUi = await read('src/client/asset-pack-figure-ui.js')
  assert.match(figureUi, /h\(GenOutfitTool,\{gen,plan:genOutfitPlan\(/)
  assert.match(figureUi, /h\(GenTileDecide,\{/)
  assert.doesNotMatch(figureUi, /gen\.batch\(|gen\.startSlot\(|GEN_SHEET_FACES/)
  const genUi = await read('packages/dsh-tavern-stage/src/client/asset-pack-gen-ui.js')
  const tab = genUi.slice(genUi.indexOf('function FigureGenTab('))
  assert.match(tab, /h\(GenOutfitTool,\{/)
  assert.doesNotMatch(tab.slice(0, tab.indexOf('function GenPromptSettings(')), /gen\.batch\(/)
})
