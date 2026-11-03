import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createClipHost,clipLeaseAsset} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-host.js'
import {PACK_LEASE_PATH} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/service.js'
import {roundBody} from '../tavern-plugin/lib/domain/round-body.js'
import {paragraphSpeech} from '../tavern-plugin/lib/domain/paragraph-speech.js'
import {syntheticPack,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {resolveFigureSnapshot} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'

// A mono 16-bit WAV around raw PCM, as the TTS cache stores it.
function pcmWav(pcm, sampleRate = 24000) {
  const head = Buffer.alloc(44)
  head.write('RIFF'); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}

test('export lease adapter preserves multipart skin and deferred-font query semantics',async()=>{
  const tickets=new Set(['owned']),calls=[];
  const library={async respondLease(options){calls.push(options);const form=new FormData();form.set('skin.json',new Blob(['{}'],{type:'application/json'}),'skin.json');return options.bundle?new Response(form):new Response('{}',{headers:{'Content-Type':'application/json'}})}};
  const url=new URL('https://clip-export.invalid'+PACK_LEASE_PATH+'owned/skin.json?bundle=1&deferFonts=1');
  const asset=await clipLeaseAsset(library,url,tickets);
  const form=await new Response(asset.body,{headers:{'Content-Type':asset.mediaType}}).formData();
  assert.equal(await form.get('skin.json').text(),'{}');
  assert.equal(calls[0].bundle,true);assert.equal(calls[0].deferFonts,true);
  assert.equal(calls[0].request.headers.get('sec-fetch-site'),'same-origin');
  url.search='';await clipLeaseAsset(library,url,tickets);
  assert.equal(calls[1].bundle,false);assert.equal(calls[1].deferFonts,false);
  await assert.rejects(clipLeaseAsset(library,url,new Set()),/not owned/);
  assert.equal(calls.length,2);
});

test('six host RPCs export a read-only recorded paragraph through the real isolated client and encoder',{timeout:180000},async t=>{
  const root=await mkdtemp(join(process.env.DSH_CLIP_TEST_TEMP || tmpdir(),'clip-host-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const body=roundBody([{kind:'markdown',text:'Recorded.'}],{chatId:'fixture',turn:1}),opened=[]
  const config={characters:[],voice:{enabled:false},stage:{director:false,face:'off',music:false,theme:'classic'}}
  const service=createClipHost({paragraphSpeech,
    readChat:async sessionId=>({id:'fixture',sessionId,cardPath:'fixture.json'}),readDisplay:async()=>({projections:[{turn:1,body}]}),readConfig:async()=>config,
    readWorkspace:async()=>({raw:{data:{extensions:{}}}}),readDirection:async()=>({phase:'off',revision:0,generation:0,token:null}),
    library:()=>null,tts:()=>{throw new Error('No TTS provider may be requested')},settings:()=>({revision:1,values:{}}),globalPacks:()=>[],
    extras:async()=>({modViews:{views:[]},mods:{},fonts:{fonts:[]}}),readHostAsset:async()=>null,exportsRoot:join(root,'exports'),tempRoot:join(root,'temp'),
    openFolder:async path=>opened.push(path),checkDisk:async()=>{}
  })
  t.after(()=>service.dispose())
  const listing=await service.call('getClipExportParagraphs',{sessionId:'session',chatId:'fixture'})
  assert.deepEqual(listing,{chatId:'fixture',paragraphs:[{turn:1,para:1,text:'Recorded.'}],maxBytes:8388608,fps:30,presets:['quality','1080p','discord','gif'],gifMaxDurationMs:15000})
  await assert.rejects(service.call('getClipExportParagraphs',{sessionId:'session',chatId:'other'}),/不匹配/)
  const range={chatId:'fixture',from:{turn:1,para:1},to:{turn:1,para:1}},args={sessionId:'session',range}
  const estimate=await service.call('estimateClipExport',args)
  // The estimate is the render's timing plan (stage-auto-timing.cjs): 「Recorded.」 is one card, (400 + 70 x 8) / 1.3 ms.
  assert.equal(estimate.durationMs,Math.round((400+70*8)/1.3*30/1000)*1000/30);assert.equal(estimate.missingVoiceCount,0)
  assert.deepEqual(estimate.voiceCache,{chatId:'fixture',keys:[]})
  assert.equal(estimate.preset,'1080p');assert.equal(estimate.renderPlan.fps,30)
  const {jobId}=await service.call('startClipExport',{...args,presets:['quality','1080p','discord','gif']})
  let status
  for(let attempt=0;attempt<1500;attempt++){
    status=await service.call('getClipExportJob',{sessionId:'session',jobId})
    if(['completed','failed','cancelled'].includes(status.state))break
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  const diagnostic=status.state==='completed'?'':await readFile(join(root,'temp',`clip-${jobId}.error.log`),'utf8').catch(()=>JSON.stringify(status.progress))
  assert.equal(status.state,'completed',(status.error || '')+'\n'+diagnostic)
  const file=status.result.files[0]
  assert.ok((await stat(file.path)).size<=8388608);assert.equal(file.frames,2*Math.round((400+70*8)/1.3*30/1000),'the render re-plans on the stage auto time of 「Recorded.」');assert.equal(status.result.files[1].durationMs,estimate.durationMs,'one card: the estimate is the export');assert.equal(file.height,1080)
  assert.deepEqual(status.result.files.map(row=>row.preset),['quality','1080p','discord','gif'])
  assert.deepEqual(status.result.files.map(row=>row.fps),[60,30,30,15])
  assert.equal(status.result.files.at(-1).width,720)
  assert.ok(status.result.verification[0].samples.every(row=>row.ssim>=0.95))
  await service.call('openClipExportFolder',{sessionId:'session',jobId});assert.deepEqual(opened,[status.result.folder])
  const cancelled=await service.call('startClipExport',args)
  await service.call('cancelClipExport',{sessionId:'session',jobId:cancelled.jobId})
  await service.dispose()
})


test('a cold export binds the presentation before querying the first cached line, never silently losing it as stale',{timeout:60000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'clip-first-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const pack=await syntheticPack(),body=roundBody([{kind:'markdown',text:'@bubble:actor|Synthetic figure|calm|[First line.]|[First voice.]'}],{chatId:'first',turn:1})
  const config={characters:[{alias:'actor',name:'Synthetic figure',voice:'voice',voiceKey:'voice',voiceLanguage:'ja'}],voice:{enabled:true},stage:{textLanguage:'zh',director:false,face:'off',music:false,theme:'classic'}}
  const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(9000*Math.sin(i/24000*523*Math.PI*2)),i*2)
  let reads=0
  const tts={apiVersion:1,subscribe:()=>()=>{},resolveVoiceService:async()=>({effective:{serviceId:'fixture',capabilities:{}},issues:[]}),
    registerVoiceSource:()=>({dispose(){}}),grantConsumer:()=>({grant:{},dispose(){}}),
    async readCached(){reads++;return {key:'first-key',audio:pcmWav(pcm),durationMs:1000,loudness:{version:1,gain:1,gainDb:0}}}}
  const library={apiVersion:2,subscribe:()=>()=>{},getPackSnapshot:async()=>({...pack,revision:'r1'})}
  const service=createClipHost({paragraphSpeech,readChat:async sessionId=>({id:'first',sessionId,cardPath:'fixture.json'}),readDisplay:async()=>({projections:[{turn:1,body}]}),readConfig:async()=>config,
    readWorkspace:async()=>({raw:{extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID]}}}}}),readDirection:async()=>({phase:'off',revision:0,generation:0,token:null}),
    library:()=>library,tts:()=>tts,settings:()=>({revision:1,values:{stageToggles:{voice:true}}}),globalPacks:()=>[],extras:async()=>({mods:{},fonts:{fonts:[]}}),readHostAsset:async()=>null,
    exportsRoot:join(root,'exports'),tempRoot:join(root,'temp'),openFolder:async()=>{},checkDisk:async()=>{}})
  t.after(()=>service.dispose())
  const args={sessionId:'session',range:{chatId:'first',from:{turn:1,para:1},to:{turn:1,para:1}}}
  for(let n=0;n<2;n++) {
    const estimate=await service.call('estimateClipExport',args)
    assert.equal(estimate.missingVoiceCount,0)
    assert.deepEqual(estimate.voiceCache.keys,['first-key'])
    assert.equal(estimate.timeline.voices[0].startFrame,0)
    assert.equal(estimate.timeline.lines[0].frames,46)
  }
  assert.equal(reads,2,'each new snapshot reads its very first line exactly once, without a retry')
})

test('旁白配音: an export reads each measured narration page\'s cached narrator voice and plans it on that page', {timeout:60000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'clip-narrator-')); t.after(() => rm(root, {recursive:true, force:true}))
  const pack = await syntheticPack(), body = roundBody([{kind:'markdown', text:'雨下了一整夜。\n\n@bubble:actor|Synthetic figure|calm|[早上好。]|[おはよう。]'}], {chatId:'narrated', turn:1})
  const config = {characters:[{alias:'actor', name:'Synthetic figure', voice:'voice', voiceKey:'voice', voiceLanguage:'ja'}], voice:{enabled:true}, narrator:{voiceKey:'narrator-key'},
    stage:{textLanguage:'zh', director:false, face:'off', music:false, theme:'classic'}}
  const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(9000 * Math.sin(i / 24000 * 523 * Math.PI * 2)), i * 2)
  const reads = []
  const tts = {apiVersion:1, subscribe:() => () => {}, reading:() => ({dialogueVoice:null, narrator:{enabled:false, voice:null}}), resolveVoiceService:async () => ({effective:{serviceId:'fixture', capabilities:{}}, issues:[]}),
    registerVoiceSource:() => ({dispose() {}}), grantConsumer:() => ({grant:{}, dispose() {}}),
    async readCached(input) { reads.push([input.text, input.language]); return input.text === '雨下了一整夜。' ? {key:'narrator-page', audio:pcmWav(pcm), durationMs:1000, loudness:{version:1, gain:1, gainDb:0}} : null }}
  const library = {apiVersion:2, subscribe:() => () => {}, getPackSnapshot:async () => ({...pack, revision:'r1'}),
    resolveFigures:async ({refs}) => refs.map(ref => resolveFigureSnapshot({...pack, revision:'r1'}, ref))}
  const service = createClipHost({paragraphSpeech,readChat:async sessionId => ({id:'narrated', sessionId, cardPath:'fixture.json'}), readDisplay:async () => ({projections:[{turn:1, body}]}), readConfig:async () => config,
    readWorkspace:async () => ({raw:{extensions:{dsh_tavern:{schemaVersion:1, assetBindings:{boundPackIds:[PACK_ID]}, stage:{narrator:{enabled:true, voice:{packId:PACK_ID, figureId:FIGURE_ID}}}}}}}),
    readDirection:async () => ({phase:'off', revision:0, generation:0, token:null}),
    library:() => library, tts:() => tts, settings:() => ({revision:1, values:{stageToggles:{voice:true}}}), globalPacks:() => [], extras:async () => ({mods:{}, fonts:{fonts:[]}}), readHostAsset:async () => null,
    exportsRoot:join(root, 'exports'), tempRoot:join(root, 'temp'), openFolder:async () => {}, checkDisk:async () => {}})
  t.after(() => service.dispose())
  const estimate = await service.call('estimateClipExport', {sessionId:'session', range:{chatId:'narrated', from:{turn:1, para:1}, to:{turn:1, para:2}}})
  assert.deepEqual(reads.find(row => row[0] === '雨下了一整夜。'), ['雨下了一整夜。', 'zh'], 'the narrator reads the page text in Chinese')
  assert.deepEqual(estimate.timeline.voices.map(row => [row.id, row.key, row.startFrame]), [['1:1:0', 'narrator-page', 0]])
  assert.ok(estimate.timeline.lines[0].frames >= 30, 'the page holds for its narrator voice')
  assert.equal(estimate.missingVoiceCount, 1, 'the uncached line is counted')
  assert.deepEqual(estimate.voiceCache.keys, ['narrator-page'])
})