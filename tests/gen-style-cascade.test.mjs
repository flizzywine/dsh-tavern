// 画风: one chain 素材包 → 角色卡 → 配图插件.
import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveGenStyle, readGenStyle, writeGenStyle, validateGenStyleValue, validateCarriedStyles} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/gen-style.js'
import {validatePackManifest} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
import {createAssetGenStyle} from '../tavern-plugin/lib/domain/asset-generation-style.js'
import {cardAssetRawOperations} from '../tavern-plugin/lib/domain/card-asset-bindings.js'
import {registerPromptPreset, withCardStyle, effectivePromptPreset, listPromptPresets} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import {createImageGenerator} from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'
import {syntheticPack} from './fixtures/asset-packs/pack.mjs'

const TRIANGLE = {id:'triangle-agency.style', name:'三角机构', independent:true, structure:{format:'auto', targets:[], blocks:[
  {kind:'scene', title:'画面描述', text:''},
  {kind:'style', title:'画风', text:'Triangle Agency house style'},
  {kind:'style', title:'画风 · 场景', usage:'scene', text:'framed like a comic panel'},
  {kind:'style', title:'画风 · 空背景', usage:'background', text:'an empty Agency office'}]}}

test('the chain: request, the pack (its use, then 全部), the card only for its 自动素材 pack, then the plugin\'s choice', () => {
  const r = input => { const {id, from, layer} = resolveGenStyle(input); return [id, from, layer] }
  assert.deepEqual(r({use:'figure', plugin:'galgame-anime'}), ['galgame-anime', 'plugin', null], 'nothing set: the plugin')
  assert.deepEqual(r({use:'figure', plugin:null}), ['no-style', 'plugin', null], 'a plugin template that adds none: no style')
  const card = {all:'triangle-agency.style', background:'galgame-clean'}
  assert.deepEqual(r({use:'figure', pack:{}, card, plugin:'galgame-anime'}), ['galgame-anime', 'plugin', null], 'an ordinary pack never reads a card')
  assert.deepEqual(r({use:'figure', pack:{automatic:true}, card, plugin:'galgame-anime'}), ['triangle-agency.style', 'card', 'all'], 'a 自动素材 pack follows its card')
  assert.deepEqual(r({use:'background', pack:{automatic:true}, card}), ['galgame-clean', 'card', 'background'])
  assert.deepEqual(r({use:'cg', card}), ['triangle-agency.style', 'card', 'all'], 'the card alone (its CG)')
  assert.deepEqual(r({use:'figure', pack:{automatic:true, genStyle:'anime'}, card}), ['galgame-anime', 'pack', 'all'], 'any pack value beats the card')
  assert.deepEqual(r({use:'figure', pack:{automatic:true, genStyle:'follow-plugin'}, card, plugin:'x.y'}), ['x.y', 'plugin', null], '跟随配图插件 skips the card')
  assert.deepEqual(r({use:'sheet', pack:{genStyle:{all:'galgame-clean', sheet:'no-style'}}}), ['no-style', 'pack', 'sheet'])
  assert.deepEqual(r({use:'background', pack:{genStyle:'galgame-clean', backgroundStyle:{prompt:'ink'}}}), ['pack-background', 'pack', 'background'], 'backgroundStyle is the pack\'s background value')
  assert.deepEqual(r({use:'background', pack:{genStyle:{background:'galgame-anime'}, backgroundStyle:{prompt:'ink'}}}), ['galgame-anime', 'pack', 'background'])
  assert.deepEqual(r({use:'figure', request:'polished', pack:{genStyle:'galgame-clean'}}), ['galgame-polished', 'request', null])
  assert.throws(() => resolveGenStyle({use:'scene'}))
})

test('values: a plain id is 全部; writing keeps the plain form while only 全部 is set; former ids read as presets', () => {
  assert.deepEqual(readGenStyle('clean'), {all:'galgame-clean'})
  assert.deepEqual(readGenStyle({all:'none', cg:'galgame-anime'}), {all:'no-style', cg:'galgame-anime'})
  assert.equal(writeGenStyle(undefined, 'all', 'galgame-clean'), 'galgame-clean')
  assert.deepEqual(writeGenStyle('galgame-clean', 'cg', 'triangle-agency.style'), {all:'galgame-clean', cg:'triangle-agency.style'})
  assert.equal(writeGenStyle({all:'galgame-clean', cg:'x.y'}, 'cg', undefined), 'galgame-clean')
  assert.equal(writeGenStyle('galgame-clean', 'all', undefined), undefined)
  for (const bad of [{}, {scene:'galgame-clean'}, {all:'Bad Id'}, 3]) assert.throws(() => validateGenStyleValue(bad))
  validateCarriedStyles([TRIANGLE])
  for (const bad of [[{...TRIANGLE, id:'no-namespace'}], [TRIANGLE, TRIANGLE], [{id:'a.b'}]]) assert.throws(() => validateCarriedStyles(bad))
})

test('a pack manifest stores genStyle per use and its own styles', async () => {
  const manifest = (await syntheticPack()).manifest
  validatePackManifest({...manifest, genStyle:{all:'galgame-clean', cg:'triangle-agency.style'}, styles:[TRIANGLE]})
  assert.throws(() => validatePackManifest({...manifest, genStyle:{everything:'galgame-clean'}}))
  assert.throws(() => validatePackManifest({...manifest, styles:[{id:'x', name:'X'}]}))
})

// The host side: the card a 自动素材 pack belongs to, the plugin's choice and the carried styles registered once (随卡 / 随包).
function harness({cardStyle, pack, plugin = 'galgame-anime'}) {
  const registered = new Map(), presets = () => [{id:'galgame-anime', name:'动画截图', addsStyle:true, active:plugin === 'galgame-anime'}, {id:'galgame-clean', name:'干净低细节', addsStyle:true},
    ...[...registered.values()].map(row => ({id:row.id, name:row.name, addsStyle:true, origin:'registered', source:row.source}))]
  const provider = {presets, registerPreset:definition => { registered.set(definition.id, definition); return () => registered.delete(definition.id) }}
  const reads = []
  const style = createAssetGenStyle({imageProvider:() => provider,
    getLibrary:() => ({cardAutomaticPack:async ({path}) => path === 'cards/t.json' && pack ? {packId:pack.manifest.id} : null, getPackSnapshot:async () => pack}),
    readCardStyle:async query => { reads.push(query); return query.cardPath === 'cards/t.json' || query.cardId === 'card-t' ? {path:'cards/t.json', name:'三角机构', ...cardStyle} : null }})
  return {style, registered, reads}
}

test('a card\'s 自动素材 pack follows the card; its carried style is registered as 随卡 and named in the menu', async () => {
  const pack = {automatic:true, automaticCardId:'card-t', manifest:{id:'p1', genStyle:undefined}}
  const h = harness({cardStyle:{genStyle:'triangle-agency.style', styles:[TRIANGLE]}, pack})
  const chain = await h.style.links({pack})
  assert.deepEqual(h.reads, [{cardId:'card-t'}])
  assert.equal(h.registered.get('triangle-agency.style').source, '随卡')
  assert.deepEqual(h.style.resolve(chain, 'figure'), {id:'triangle-agency.style', from:'card', layer:'all', name:'三角机构'})
  const menu = h.style.menu(chain)
  assert.deepEqual(menu.card.styles, [{id:'triangle-agency.style', name:'三角机构', origin:'card'}])
  assert.ok(!menu.options.some(row => row.id === 'triangle-agency.style'), 'a carried style is listed once, under the card')
  assert.deepEqual(menu.plugin, {id:'galgame-anime', name:'动画截图'})
  // the card's CG style for the image plugin (getCardContext imageStyle)
  assert.deepEqual(await h.style.cardImageStyle('cards/t.json'), {id:'triangle-agency.style', name:'三角机构', from:'card'})
  // the same definition is not registered again; a changed one replaces it
  const first = h.registered.get('triangle-agency.style')
  await h.style.links({pack}); assert.equal(h.registered.get('triangle-agency.style'), first)
})

test('the card\'s CG style is null when the chain ends at the plugin (its own choice then applies)', async () => {
  const h = harness({cardStyle:{}, pack:null})
  assert.equal(await h.style.cardImageStyle('cards/t.json'), null)
  const set = harness({cardStyle:{genStyle:{cg:'galgame-clean'}}, pack:null})
  assert.deepEqual(await set.style.cardImageStyle('cards/t.json'), {id:'galgame-clean', name:'干净低细节', from:'card'})
})

test('the card extension stores genStyle and styles; null removes them', () => {
  const raw = {spec:'chara_card_v2', data:{name:'T', extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:[]}}}}}
  const [set] = cardAssetRawOperations(raw, {genStyle:{all:'triangle-agency.style'}, styles:[TRIANGLE]})
  assert.deepEqual(set.value.genStyle, {all:'triangle-agency.style'})
  assert.throws(() => cardAssetRawOperations(raw, {genStyle:'Bad Id'}))
  const stored = {...raw, data:{...raw.data, extensions:{dsh_tavern:set.value}}}
  const [cleared] = cardAssetRawOperations(stored, {genStyle:null})
  assert.equal(cleared.value.genStyle, undefined); assert.equal(cleared.value.styles.length, 1)
})

test('the image plugin: the selected preset is `active`; a card style replaces only the template\'s style blocks', () => {
  const undo = registerPromptPreset({...TRIANGLE, source:'随卡'})
  try {
    const config = {promptSystem:'workbench', imageBackend:'openai', activePromptPreset:'galgame-anime', promptPresets:[]}
    const provider = createImageGenerator(() => config, async () => ({}))
    assert.equal(provider.presets().find(row => row.active)?.id, 'galgame-anime')
    assert.equal(typeof provider.registerPreset, 'function')
    assert.equal(listPromptPresets(config).find(row => row.id === TRIANGLE.id).source, '随卡')
    const styled = withCardStyle(config, TRIANGLE.id)
    const template = effectivePromptPreset(styled)
    assert.equal(template.id, 'galgame-anime', 'the selected template stays')
    assert.deepEqual(template.structure.blocks.filter(b => b.kind === 'style').map(b => b.text), TRIANGLE.structure.blocks.filter(b => b.kind === 'style').map(b => b.text))
    assert.ok(template.structure.blocks.some(b => b.kind === 'library'), 'its library block is kept')
    assert.throws(() => withCardStyle(config, 'gone.style'), /找不到/)
  } finally { undo() }
})
