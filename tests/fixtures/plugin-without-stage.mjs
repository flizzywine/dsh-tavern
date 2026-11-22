import assert from 'node:assert/strict'
import {createPluginHost} from './plugin-host.mjs'
import {createChatJournalStore} from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import {resolveTavernDataRoot} from '../../tavern-plugin/lib/domain/tavern-data.js'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {syntheticPack, PACK_ID, FIGURE_ID} from './asset-packs/pack.mjs'
const clonePack = {...await syntheticPack(), revision:'clone'}
const pack = structuredClone({...clonePack, revision:'browser'})
const voiceId = pack.figures[FIGURE_ID].voice.voice
pack.manifest.voiceLibrary.voices[voiceId] = {name:'Fixture speech', language:'ja', defaultSource:'main',
  sources:{main:{kind:'preset', provider:'browser', voiceName:'Fixture speech'}}}
pack.figures[FIGURE_ID].voice = {voice:voiceId}
let currentPack = pack
const packListeners = new Set(), voiceSources = new Map()
const library = {apiVersion:2, listPacks:async () => [currentPack], getPackSnapshot:async ({packId}) => packId === PACK_ID ? currentPack : undefined,
  subscribe(listener) {packListeners.add(listener); return () => packListeners.delete(listener)},
  registerModPrivate:() => () => {},
  async readMedia({packId, expectedRevision, hash}) {
    assert.equal(packId, PACK_ID)
    assert.equal(expectedRevision, currentPack.revision)
    return {bytes:currentPack.files.get('media/' + hash + '.wav')}
  }}
const tts = {apiVersion:1, listServices:async () => [], subscribe:() => () => {}, registerUsageSource:() => () => {},
  reading:() => ({general:{figure:null}, narrator:{enabled:false, figure:null}}),
  resolveVoiceService:async () => ({effective:{serviceId:'fixture-service'}}),
  registerVoiceSource(source) {
    voiceSources.set(source.sourceId, source)
    return {dispose:() => voiceSources.delete(source.sourceId)}
  },
  grantConsumer:() => ({grant:{}, dispose() {}})}
const host=await createPluginHost({withTools:true,config:{stage:false},provide:{tts, assetLibrary:library}})
try {
  assert.equal(host.services.has('tavernManagedModules'),false)
  assert.equal(host.services.has('tavernAssetCards'),false)
  assert.equal(host.services.has('tavernAssetDependencies'),false)
  const settings=await host.rpc('getTavernSettings',{})
  assert.equal(settings.modModelSlots.some(row=>row.modId==='dsh.stage'),false)
  assert.deepEqual(settings.scoringCatalog,[])
  const imported=await host.rpc('importCard',{payload:{name:'ordinary.json',text:JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Ordinary',first_mes:'Hello',extensions:{}}})}})
  assert.ok(imported.card.path)
  assert.ok(await host.rpc('listCards',{}))
  assert.equal(host.services.get('tavern').modHostApi,null)
  const background=await host.rpc('getBackgroundRuns',{sessionId:'ordinary'})
  assert.equal(background.catalog.some(row=>row.task==='stage-director'),false)
  await assert.rejects(host.rpc('getStageDirection',{sessionId:'ordinary'}),/未知方法/)
  const clientAssets=host.services.get('tavernClientAssets')
  const overlay='/api/dsh-tavern/client-assets/skin-overlay.mjs'
  const card = {name:'Dialogue', first_mes:'@bubble:actor|Fixture|calm|[Hello]', extensions:{dsh_tavern:{
    schemaVersion:1, assetBindings:{boundPackIds:[PACK_ID]}, stage:{dialogue:true, stage:false}
  }}}
  const dialogue = await host.rpc('importCard', {payload:{name:'dialogue.json', text:JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:card})}})
  const dataRoot = resolveTavernDataRoot()
  const args = {sessionId:'dialogue-session'}
  await writeFile(join(dataRoot, 'sessions.json'), JSON.stringify({[args.sessionId]:'dialogue-chat'}))
  await createChatJournalStore({dataRoot}).update('dialogue-chat', () => ({
    id:'dialogue-chat', _storageRevision:1, ...args, mode:'story', cardPath:dialogue.card.path, cardDefinitionSnapshot:card,
    backgroundConfigVersion:1, conversationFeaturesVersion:1,
    messages:[{role:'assistant', turn:1, text:card.first_mes, sourceText:card.first_mes}]
  }))
  host.services.get('sessions').set(args.sessionId, {id:args.sessionId, events:[]})
  assert.deepEqual((await host.rpc('getSession', args)).view.stage, {dialogue:true, stage:false, isStageCard:false})
  const bubbles = await host.rpc('getDialogueBubbles', args)
  assert.equal(bubbles.config.enabled, true)
  assert.equal(bubbles.config.stage.enabled, false)
  assert.equal(bubbles.config.voice.enabled, true)
  assert.ok(bubbles.injection.some(part => part.text.includes('@bubble:')))
  const voice = await host.rpc('openAssetPackVoice', {...args, general:true}, {origin:'http://localhost:3081'})
  assert.equal(voice.available, true)
  assert.deepEqual(voice.browser, {voice:''})
  const character = bubbles.config.characters.find(row => row.ref.figureId === FIGURE_ID)
  assert.ok(character.avatarMedia.default?.hash)
  const figureVoice = await host.rpc('openAssetPackVoice', {...args, alias:character.alias}, {origin:'http://localhost:3081'})
  assert.equal(figureVoice.available, true)
  assert.equal(figureVoice.language, 'ja')
  assert.deepEqual(figureVoice.browser, {voice:'Fixture speech'})
  currentPack = clonePack
  for (const listener of packListeners) listener({packId:PACK_ID, revision:clonePack.revision})
  const clonedVoice = await host.rpc('openAssetPackVoice', {...args, alias:character.alias}, {origin:'http://localhost:3081'})
  assert.equal(clonedVoice.available, true)
  assert.equal(clonedVoice.scope, 'dsh-browser')
  const spec = clonePack.manifest.voiceLibrary.voices[voiceId]
  const reference = spec.sources[spec.defaultSource].references[0].media
  assert.deepEqual(await voiceSources.get(clonedVoice.voice.source).readReference(reference),
    clonePack.files.get('media/' + reference + '.wav'))
  assert.equal((await host.rpc('getStageRuntimeStatus')).status, 'disabled')
  assert.equal(host.services.has('tavernManagedModules'), false)
  assert.equal(await clientAssets.read('/api/dsh-tavern/client-assets/stage-client.mjs'), undefined)
  assert.equal(await clientAssets.read(overlay),undefined)
  const control=host.services.get('tavernStageControl')
  for(let cycle=0;cycle<(process.env.DSH_TEST_STAGE_UNAVAILABLE ? 0 : 2);cycle++) {
    await control.enable(() => import('../../tavern-plugin/packages/dsh-tavern-stage/lib/runtime.js'))
    assert.equal(control.status(),'ready')
    assert.ok((await clientAssets.read(overlay)).body.length)
    assert.ok(host.services.get('tavernAssetCards'))
    assert.ok(host.services.get('tavernManagedModules'))
    assert.equal((await host.rpc('getTavernSettings',{})).modModelSlots.some(row=>row.modId==='dsh.stage'),true)
    assert.ok((await host.rpc('managedModsList',{}, {origin:'http://localhost:3081'})).mods.length)
    await control.disable()
    assert.equal(control.status(),'disabled')
    assert.equal(await clientAssets.read(overlay),undefined)
    assert.equal(host.services.has('tavernAssetCards'),false)
    assert.equal(host.services.has('tavernManagedModules'),false)
    assert.equal((await host.rpc('getTavernSettings',{})).modModelSlots.some(row=>row.modId==='dsh.stage'),false)
    await assert.rejects(host.rpc('getStageDirection',{sessionId:'ordinary'}),/未知方法/)
    assert.ok(await host.rpc('listCards',{}))
  }
  console.log('core without stage completed')
} finally {await host.dispose()}
