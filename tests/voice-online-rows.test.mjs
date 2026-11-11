import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

// 素材库人物声音页 › 配音来源: one flat list from the TTS voice services catalog (tts.call('voiceServices')) — a row per
// service set up in 语音后端, then 浏览器朗读 and 不配音 (owner 11-08: no 在线 TTS group).
async function load() {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js', import.meta.url), 'utf8')
  const sandbox = {}
  vm.createContext(sandbox)
  const line = name => source.match(new RegExp('^const ' + name + '=.*$', 'm'))[0]
  const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))
  vm.runInContext([line('VOICE_PROVIDERS'), line('FIGURE_VOICE_LANGUAGES'), line('providerName'), line('VOICE_UNSET_TEXT'), line('voiceSourceUnset'), line('primaryLanguage'), line('voiceLanguageName'),
    between('const FISH_WAYS=[', '// ---------- data + preview plumbing'),
    line('spacedName'), between('function voiceReadiness(', '// The catalog (`.services`'),
    'this.voiceSourceRows=voiceSourceRows;this.rowHolds=rowHolds;this.voiceRowState=voiceRowState;this.voiceSourceUnset=voiceSourceUnset;this.voiceReadiness=voiceReadiness;'].join('\n'), sandbox)
  return sandbox
}
const plain = value => JSON.parse(JSON.stringify(value))
const browser = {id:'browser', kind:'browser', label:'浏览器朗读', state:'ready', billing:'free', sources:['preset'], voiceList:'browser'}
const service = (id, kind, label, extra = {}) => ({id, kind, label, state:'configured', billing:'paid', sources:kind === 'fish-audio' ? ['reference-list','voice-id'] : ['preset'], voiceList:kind === 'fish-audio' ? 'fish-recommended' : 'preset', models:[], ...extra})

test('nothing set up: 浏览器朗读 and 不配音 only', async () => {
  const {voiceSourceRows} = await load()
  assert.deepEqual(plain(voiceSourceRows({services:[browser]}, null)).map(w => w.id), ['browser', 'off'])
})

test('every configured service is a row of its own, by its own name, in 语音后端 order', async () => {
  const {voiceSourceRows} = await load()
  const catalog = {services:[service('mm-1', 'minimax', '我的 MiniMax'), service('fish-1', 'fish-audio', 'Fish'), service('qwen-1', 'qwen', '千问'), browser]}
  const rows = plain(voiceSourceRows(catalog, null))
  assert.deepEqual(rows.map(r => [r.id, r.title, r.serviceId ?? null, !!r.bind]), [['service:mm-1', '我的 MiniMax', 'mm-1', false], ['service:fish-1', 'Fish', 'fish-1', false], ['service:qwen-1', '千问', 'qwen-1', false], ['browser', '浏览器朗读', null, false], ['off', '不配音', null, false]])
  assert.deepEqual(rows[1].ways.map(w => w.id), ['clone', 'library'])
  // several services of one kind: each row names its service in what it writes.
  const two = plain(voiceSourceRows({services:[...catalog.services, service('mm-2', 'minimax', '备用')]}, null)).filter(r => r.kind === 'minimax')
  assert.deepEqual(two.map(r => [r.title, r.serviceId, r.bind]), [['我的 MiniMax', 'mm-1', true], ['备用', 'mm-2', true]])
})

// 生成方式 lists only what the service's provider reports (catalog `sources`): a server without a voice library has none.
test('a Fish service without a voice library offers only 参考音频克隆; several Fish services hold their own sources', async () => {
  const {voiceSourceRows, rowHolds} = await load()
  const cloud = service('fish', 'fish-audio', 'Fish Audio'), local = service('fish-local', 'fish-audio', 'Fish Audio（本地 Drama 3）', {sources:['reference-list'], voiceList:'provider'})
  const rows = voiceSourceRows({services:[cloud, local, browser]}, null)
  assert.deepEqual(plain(rows.slice(0, 2)).map(r => [r.title, r.ways.map(w => w.id), r.bind]), [['Fish Audio', ['clone', 'library'], true], ['Fish Audio（本地 Drama 3）', ['clone'], true]])
  const source = {kind:'reference-list', provider:'fish-audio', serviceId:'fish-local', references:[]}
  assert.deepEqual(plain(rows.filter(r => rowHolds(r, source)).map(r => r.id)), ['service:fish-local'])
  assert.deepEqual(plain(rows.filter(r => rowHolds(r, {...source, serviceId:undefined})).map(r => r.id)), [], 'ambiguous among several: no row holds it')
})

test('a source naming a kind that is not set up gets a row of its own marked missing', async () => {
  const {voiceSourceRows, voiceRowState} = await load()
  const qwen = {kind:'preset', provider:'qwen', voiceName:'Cherry'}
  const rows = plain(voiceSourceRows({services:[browser]}, qwen))
  assert.deepEqual(rows.map(r => [r.id, !!r.missing]), [['missing:qwen', true], ['browser', false], ['off', false]])
  assert.equal(voiceRowState(rows[0], 'ja', null).text, '未设置')
  // a browser voice is the 浏览器朗读 row.
  assert.deepEqual(plain(voiceSourceRows({services:[browser]}, {kind:'preset', provider:'browser', voiceName:'Kyoko'})).map(r => r.id), ['browser', 'off'])
})

// One set of state words with 语音后端: 可用, or ⚠ and why; a service not checked yet is 可用.
test('row states use the 语音后端 words', async () => {
  const {voiceSourceRows, voiceRowState} = await load()
  const words = ['configured', 'ready', 'needs-key', 'invalid-key', 'offline', 'stopped', 'rejected'].map(state => voiceRowState(voiceSourceRows({services:[service('q', 'qwen', '千问', {state})]}, null)[0], 'ja', null))
  assert.deepEqual(plain(words).map(w => [w.text, !!w.warn]), [['可用', false], ['可用', false], ['缺少 API Key', true], ['API Key 无效', true], ['连不上', true], ['未启动', true], ['访问被拒绝', true]])
})

// 浏览器朗读 without a voiceName is the system default voice: set up, never a voice still to pick.
test('a browser source without a voice name is set up; an online one without a voice name is not', async () => {
  const {voiceSourceUnset} = await load()
  assert.equal(voiceSourceUnset({kind:'preset', provider:'browser'}), '')
  assert.equal(voiceSourceUnset({kind:'preset', provider:'browser', voiceName:'Kyoko'}), '')
  assert.equal(voiceSourceUnset({kind:'preset', provider:'qwen'}), '还没选在线声音')
})

test('source-specific readiness follows MiniMax, not Qwen', async () => {
  const {voiceReadiness} = await load()
  assert.equal(voiceReadiness({services:[service('mm','minimax','MiniMax')]},'minimax'),null)
  assert.match(voiceReadiness({services:[]},'minimax').text,/MiniMax/)
  assert.doesNotMatch(voiceReadiness({services:[]},'minimax').text,/通义千问/)
  assert.equal(voiceReadiness({services:[service('mm','minimax','我的 MiniMax',{state:'invalid-key'})]},'minimax').text,'我的 MiniMax API Key 无效')
})
