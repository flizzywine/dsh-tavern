import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

// 素材库人物声音页 › 在线 TTS: the rows come from the configured services (tts.call('services').configured).
async function rows() {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js', import.meta.url), 'utf8')
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(source.match(/^const VOICE_PROVIDERS=.*$/m)[0] + '\n' + source.match(/^const providerName=.*$/m)[0] + '\n' +
    source.slice(source.indexOf('const ONLINE_BUILTIN='), source.indexOf('// The name a saved online source reads as')) + ';this.onlineProviders=onlineProviders;', sandbox)
  return sandbox.onlineProviders
}
const plain = value => JSON.parse(JSON.stringify(value))

test('在线 TTS lists every configured online kind (MiniMax included) by its name; Fish stays in its own ways', async () => {
  const onlineProviders = await rows()
  const configured = [{id:'mm-1', kind:'minimax', label:'我的 MiniMax'}, {id:'fish-1', kind:'fish-audio', label:'Fish'}, {id:'qwen-1', kind:'qwen', label:'千问'}]
  const listed = plain(onlineProviders({configured}))
  assert.deepEqual(listed.map(r => r.kind), ['qwen', 'azure', 'volcengine', 'minimax', 'browser'])
  assert.deepEqual(listed.find(r => r.kind === 'minimax'), {key:'minimax', kind:'minimax', name:'MiniMax', serviceId:'mm-1'})
  // several services of one kind are a row each, under their own names.
  const two = plain(onlineProviders({configured:[...configured, {id:'mm-2', kind:'minimax', label:'备用'}]})).filter(r => r.kind === 'minimax')
  assert.deepEqual(two.map(r => [r.name, r.serviceId, r.bind]), [['我的 MiniMax', 'mm-1', true], ['备用', 'mm-2', true]])
  // nothing configured (or not read yet): the built-in rows as before, no MiniMax row.
  assert.deepEqual(plain(onlineProviders(null)).map(r => r.kind), ['qwen', 'azure', 'volcengine', 'browser'])
})
