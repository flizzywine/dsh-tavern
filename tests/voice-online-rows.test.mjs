import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

// 素材库人物声音页 › 配音来源: the rows come from the TTS voice services catalog (tts.call('voiceServices')).
async function load() {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js', import.meta.url), 'utf8')
  const sandbox = {}
  vm.createContext(sandbox)
  const line = name => source.match(new RegExp('^const ' + name + '=.*$', 'm'))[0]
  const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))
  vm.runInContext([line('VOICE_PROVIDERS'), line('providerName'), line('VOICE_UNSET_TEXT'), line('voiceSourceUnset'),
    between('const VOICE_WAYS=[', '// Does a row speak'),
    between('const BROWSER_ROW=', '// The name a saved online source reads as'),
    line('spacedName'), between('function voiceReadiness(', '// The catalog (`.services`'),
    'this.onlineProviders=onlineProviders;this.voiceWayRows=voiceWayRows;this.voiceSourceUnset=voiceSourceUnset;this.voiceReadiness=voiceReadiness;',
    'this.headerProvider=(way, entry)=>{'+source.match(/^  const provider=way=>.*$/m)[0]+'return provider(way);};'].join('\n'), sandbox)
  return sandbox
}
const plain = value => JSON.parse(JSON.stringify(value))
const browser = {id:'browser', kind:'browser', label:'浏览器朗读', state:'ready', billing:'free', sources:['preset'], voiceList:'browser'}
const service = (id, kind, label, extra = {}) => ({id, kind, label, state:'configured', billing:'paid', sources:kind === 'fish-audio' ? ['reference-list','voice-id'] : ['preset'], voiceList:kind === 'fish-audio' ? 'fish-recommended' : 'preset', ...extra})

test('nothing set up: generic 在线 TTS, 浏览器朗读 and 不配音; no provider rows', async () => {
  const {voiceWayRows, onlineProviders} = await load()
  const catalog = {services:[browser], kinds:{}}
  assert.deepEqual(plain(voiceWayRows(catalog, null)).map(w => w.id), ['online', 'browser', 'off'])
  assert.deepEqual(plain(onlineProviders(catalog, null)), [])
})

test('在线 TTS lists every configured online service (MiniMax included) by its name; Fish stays in its own ways', async () => {
  const {voiceWayRows, onlineProviders} = await load()
  const catalog = {services:[service('mm-1', 'minimax', '我的 MiniMax'), service('fish-1', 'fish-audio', 'Fish'), service('qwen-1', 'qwen', '千问'), browser]}
  assert.deepEqual(plain(voiceWayRows(catalog, null)).map(w => w.id), ['clone', 'library', 'online', 'browser', 'off'])
  const listed = plain(onlineProviders(catalog, null))
  assert.deepEqual(listed.map(r => [r.kind, r.name, r.serviceId, r.bind]), [['minimax', 'MiniMax', 'mm-1', false], ['qwen', '通义千问', 'qwen-1', false]])
  // several services of one kind are a row each, under their own names.
  const two = plain(onlineProviders({services:[...catalog.services, service('mm-2', 'minimax', '备用')]}, null)).filter(r => r.kind === 'minimax')
  assert.deepEqual(two.map(r => [r.name, r.serviceId, r.bind]), [['我的 MiniMax', 'mm-1', true], ['备用', 'mm-2', true]])
})

// 声音库 is a row only under a service whose provider reports voice IDs (catalog `sources`); with several Fish services the
// rows stay bound to their service, so a pick never writes a source that is ambiguous among them.
test('a Fish service whose provider reports no voice library has no 声音库 row', async () => {
  const {voiceWayRows} = await load()
  const cloud = service('fish', 'fish-audio', 'Fish Audio'), local = service('fish-local', 'fish-audio', 'Fish Audio（本地 Drama 3）', {sources:['reference-list'], voiceList:'provider'})
  const rows = plain(voiceWayRows({services:[cloud, local, browser]}, null))
  assert.deepEqual(rows.map(w => [w.id, w.title, w.serviceId, !!w.bind]), [
    ['clone:fish', 'Fish Audio · 声音克隆', 'fish', true], ['clone:fish-local', 'Fish Audio（本地 Drama 3）· 声音克隆', 'fish-local', true],
    ['library:fish', 'Fish Audio · 声音库', 'fish', true], ['online', '在线 TTS', undefined, false], ['browser', '浏览器朗读', undefined, false], ['off', '不配音', undefined, false]])
  assert.deepEqual(plain(voiceWayRows({services:[local, browser]}, null)).map(w => w.id), ['clone', 'online', 'browser', 'off'])
})

test('a source naming a service that is not set up keeps its way, with a row of its own marked missing', async () => {
  const {voiceWayRows, onlineProviders} = await load()
  const catalog = {services:[browser]}
  const qwen = {kind:'preset', provider:'qwen', voiceName:'Cherry'}
  assert.deepEqual(plain(voiceWayRows(catalog, qwen)).map(w => [w.id, !!w.unconfigured]), [['online', false], ['browser', false], ['off', false]])
  assert.deepEqual(plain(onlineProviders(catalog, qwen)).map(r => [r.kind, r.name, r.missing]), [['qwen', '通义千问', true]])
  const clone = {kind:'reference-list', provider:'fish-audio', references:[]}
  assert.deepEqual(plain(voiceWayRows(catalog, clone)).map(w => w.id), ['clone', 'online', 'browser', 'off'])
  // a browser voice is the 浏览器朗读 way, not 在线 TTS.
  assert.deepEqual(plain(voiceWayRows(catalog, {kind:'preset', provider:'browser', voiceName:'Kyoko'})).map(w => w.id), ['online', 'browser', 'off'])
})

// 浏览器朗读 without a voiceName is the system default voice: set up, never a voice still to pick.
test('a browser source without a voice name is set up; an online one without a voice name is not', async () => {
  const {voiceSourceUnset} = await load()
  assert.equal(voiceSourceUnset({kind:'preset', provider:'browser'}), '')
  assert.equal(voiceSourceUnset({kind:'preset', provider:'browser', voiceName:'Kyoko'}), '')
  assert.equal(voiceSourceUnset({kind:'preset', provider:'qwen'}), '还没选在线声音')
})

test('source-specific readiness follows MiniMax, not Qwen', async () => {
  const {headerProvider,voiceReadiness} = await load()
  const source = {kind:'preset',provider:'minimax',voiceName:'female-shaonv'}
  const provider = headerProvider({id:'online'},()=>['mm',source])
  assert.equal(provider,'minimax')
  assert.equal(voiceReadiness({services:[service('mm','minimax','MiniMax')]},provider),null)
  assert.match(voiceReadiness({services:[]},provider).text,/MiniMax/)
  assert.doesNotMatch(voiceReadiness({services:[]},provider).text,/通义千问/)
  assert.equal(headerProvider({id:'online'},()=>null),undefined)
})