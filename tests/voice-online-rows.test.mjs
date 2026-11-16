import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

// The voice's own source and the services of 语音后端 (tts.call('voiceServices')): whether a source is set up, and what is
// wrong with its service, in 语音后端's words (the 声音 tab's ⚠).
async function load() {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js', import.meta.url), 'utf8')
  const sandbox = {}
  vm.createContext(sandbox)
  const line = name => source.match(new RegExp('^const ' + name + '=.*$', 'm'))[0]
  const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))
  vm.runInContext([line('VOICE_PROVIDERS'), line('providerName'), line('VOICE_UNSET_TEXT'), line('voiceSourceUnset'), line('SERVICE_STATE_WORDS'),
    line('spacedName'), between('function voiceReadiness(', '// The catalog (`.services`'),
    'this.voiceSourceUnset=voiceSourceUnset;this.voiceReadiness=voiceReadiness;'].join('\n'), sandbox)
  return sandbox
}
const service = (id, kind, label, extra = {}) => ({id, kind, label, state:'configured', billing:'paid', sources:['preset'], voiceList:'preset', models:[], ...extra})

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
