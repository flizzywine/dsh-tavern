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
  vm.runInContext([line('VOICE_PROVIDERS'), line('providerName'),
    between('const VOICE_WAYS=[', '// Does a row speak'),
    between('const BROWSER_ROW=', '// The name a saved online source reads as'),
    'this.onlineProviders=onlineProviders;this.voiceWayRows=voiceWayRows;'].join('\n'), sandbox)
  return sandbox
}
const plain = value => JSON.parse(JSON.stringify(value))
const browser = {id:'browser', kind:'browser', label:'浏览器朗读', state:'ready', billing:'free', sources:['preset'], voiceList:'browser'}
const service = (id, kind, label, extra = {}) => ({id, kind, label, state:'configured', billing:'paid', sources:kind === 'fish-audio' ? ['reference-list','voice-id'] : ['preset'], voiceList:kind === 'fish-audio' ? 'fish-recommended' : 'preset', ...extra})

test('nothing set up: only 浏览器朗读 and 不配音; no 通义千问 / Azure / 火山 / Fish rows', async () => {
  const {voiceWayRows, onlineProviders} = await load()
  const catalog = {services:[browser], kinds:{}}
  assert.deepEqual(plain(voiceWayRows(catalog, null)).map(w => w.id), ['browser', 'off'])
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

test('a source naming a service that is not set up keeps its way, with a row of its own marked missing', async () => {
  const {voiceWayRows, onlineProviders} = await load()
  const catalog = {services:[browser]}
  const qwen = {kind:'preset', provider:'qwen', voiceName:'Cherry'}
  assert.deepEqual(plain(voiceWayRows(catalog, qwen)).map(w => [w.id, !!w.unconfigured]), [['online', true], ['browser', false], ['off', false]])
  assert.deepEqual(plain(onlineProviders(catalog, qwen)).map(r => [r.kind, r.name, r.missing]), [['qwen', '通义千问', true]])
  const clone = {kind:'reference-list', provider:'fish-audio', references:[]}
  assert.deepEqual(plain(voiceWayRows(catalog, clone)).map(w => w.id), ['clone', 'browser', 'off'])
  // a browser voice is the 浏览器朗读 way, not 在线 TTS.
  assert.deepEqual(plain(voiceWayRows(catalog, {kind:'preset', provider:'browser', voiceName:'Kyoko'})).map(w => w.id), ['browser', 'off'])
})
