import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createLineSpeech} from '../tavern-plugin/lib/domain/speech.js'
import {cardStageVoicing} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {createTts} from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'

for (const voice of [{browser:'Reader'}, {serviceId:'mm',voice:'reader'}]) test('read-aloud ignores stage voices: ' + JSON.stringify(voice), async t => {
  const calls = [], tts = createTts({profileId:'read-test',reading:() => ({readAloud:{voice,auto:false},dialogueVoice:{browser:'Different'},narrator:{enabled:false,voice:null}})})
  tts.audioUrl = ticket => 'audio:' + ticket
  tts.registerProvider('test',{id:'mm',kind:'minimax',revision:'one',capabilities:{},health:async () => ({state:'ready'}),catalog:async () => [],synthesize:async input => { calls.push(input); return pcmWav(Buffer.alloc(4800)) }})
  const speech = createLineSpeech({getTts:() => tts})
  t.after(() => { speech.dispose(); tts.dispose() })
  const result = await speech.read({text:'Hello reader.'})
  if (voice.browser) assert.deepEqual(result,{browser:true,voice:'Reader',text:'Hello reader.'})
  else { assert.match(result.url,/^audio:/); assert.equal(calls[0].params.voice,'reader') }
  assert.equal(speech.pendingCount(),0)
})

test('host state gates the effective card switch by runtime readiness', async () => {
  const source = readFileSync(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
  const body = source.slice(source.indexOf('  rpcHandlers.readAloudLine ='),source.indexOf('  rpcHandlers.getStageRuntimeStatus ='))
  let extension, ready = true, globalOn = false
  const handlers = new Function('speech','castCardOf','str','cardStageExtension','settingsSectionProvider','ctx','ENGINE_SECTION','stageRuntime','cardStageVoicing',
    'const rpcHandlers={};' + body + ';return rpcHandlers')(
    {read:async line => line},async () => ({path:'card'}),String,async () => extension,
    () => ({describe:() => [{ns:'engine',value:{stageToggles:{dialogue:true,voice:globalOn}}}]}),
    {get:() => ({reading:() => ({readAloud:{auto:true}})})},'engine',{status:() => ready ? 'ready' : 'disabled'},cardStageVoicing)
  for (const item of [
    {card:{stage:{enabled:true,switches:{voice:'on'}}},global:false,want:true},
    {card:{stage:{enabled:true}},global:true,want:true},
    {card:null,global:true,want:false},
    {card:{stage:{enabled:true,switches:{voice:'off'}}},global:true,want:false}
  ]) {
    extension=item.card; globalOn=item.global
    assert.deepEqual(await handlers.readAloudState({sessionId:'test'}),{stepAside:item.want,auto:true})
  }
  extension={stage:{enabled:true}}; ready=false
  assert.deepEqual(await handlers.readAloudState({sessionId:'test'}),{stepAside:false,auto:true})
  assert.deepEqual(await handlers.readAloudLine({sessionId:'test',text:'Hello'}),{text:'Hello'})
})
