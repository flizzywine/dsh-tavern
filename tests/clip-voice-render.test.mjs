import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createClipBrowser} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-browser.js'
import {roundBody} from '../tavern-plugin/lib/domain/round-body.js'
import {readTavernClientAsset} from '../tavern-plugin/lib/domain/tavern-client-assets.js'
import {resolveTavernRuntimeAsset} from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'

// A mono 16-bit WAV around raw PCM, as the TTS cache stores it.
function pcmWav(pcm, sampleRate = 24000) {
  const head = Buffer.alloc(44)
  head.write('RIFF'); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}

for(const prefix of [false,true])test(`cached original voice plays through the real replay voice consumer (missing earlier voice: ${prefix})`,{timeout:60000},async t=>{
  const pcm=Buffer.alloc(24000*2);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(12000*Math.sin(i/24000*731*Math.PI*2)),i*2)
  const wav=pcmWav(pcm),key='fixture-voice'
  const body=roundBody([{kind:'markdown',text:(prefix?'Narration.\n\n@bubble:actor|Actor|calm|[Missing voice.]\n\nNarration.\n\n':'')+'@bubble:actor|Actor|calm|[Recorded words.]'}],{chatId:'fixture',turn:1})
  const para=prefix?4:1
  const snapshot={sessionId:'export-fixture',chatId:'fixture',cardPath:'fixture.json',from:{turn:1,para:1},
    config:{characters:[{alias:'actor',name:'Actor',voice:'voice',voiceKey:'voice',voiceLanguage:'zh'}],voice:{enabled:true},stage:{textLanguage:'zh',director:false,face:'off',music:false,theme:'classic'}},
    turns:[{turn:1,body}],paragraphs:[...(prefix?[1,2,3].map(para=>({turn:1,para,durationMs:1000})):[]),{turn:1,para,durationMs:1000,text:'Recorded words.',voice:{key,durationMs:1000,loudness:{version:1,gain:2,gainDb:6.020599913279624},alias:'actor',input:{text:'Recorded words.',mood:'calm'},selectionKey:JSON.stringify(['export-fixture',1,para-1]),language:'zh'}}]}
  const calls=[],renderer=await createClipBrowser({snapshot,plan:{from:{turn:1,para:1},to:{turn:1,para},frames:60*para,fps:60,resolution:{width:1280,height:720}},
    transport:async method=>{calls.push(method);switch(method){case 'getRoundBody':return body;case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null};case 'getStageModHistory':return {turns:[]};case 'getStageMusicTracks':return {tracks:[]};case 'listFonts':return {fonts:[]};case 'getDialogueBubbles':return {config:snapshot.config};default:throw new Error('Unexpected host RPC '+method)}},
    readAsset:async url=>{if(url.pathname==='/clip-voice/'+key)return {body:wav,mediaType:'audio/wav'};const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}
  });t.after(()=>renderer.close())
  // The voiced paragraph starts after the earlier ones' measured frames (30 fps timing, captured at 60 fps).
  const start=renderer.timeline.lines.slice(0,-1).reduce((sum,row)=>sum+row.frames*2,0)
  for(let frame=0;frame<start+13;frame++)await renderer.capture(frame)
  const events=await renderer.audioEvents(),voices=events.filter(row=>row.layer==='voice'&&row.kind==='play'&&row.frame>=0)
  assert.equal(voices.length,1,JSON.stringify({events,visible:await renderer.inspect()}));assert.equal(voices[0].voiceKey,key)
  assert.ok((await renderer.audioBlob(voices[0].url)).equals(wav))
  assert.ok(events.some(row=>row.id===voices[0].id && (row.gain ?? row.volume)>1),'Stored voice gain must remain in the captured production graph: '+JSON.stringify(events))
  const evidence=await renderer.evidence()
  assert.equal(evidence.voiceOnsets.length,1);assert.ok(Math.abs(evidence.voiceOnsets[0].audioFrame-evidence.voiceOnsets[0].revealFrame)<=1)
  assert.ok(!calls.some(method=>/synthes|generate|save|notify/.test(method)))
})

test('isolated replay activates the production BGM owner and records nonzero original music',{timeout:60000},async t=>{
  const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(9000*Math.sin(i/24000*440*Math.PI*2)),i*2)
  const wav=pcmWav(pcm),body=roundBody([{kind:'markdown',text:'Music.'}],{chatId:'music',turn:1})
  const token={sourceKey:'recorded-music'},direction={phase:'done',revision:1,generation:1,token,target:{sessionId:'music',turn:1},binding:{},bindingKey:'music',prefixRevision:1,through:1,complete:true,entries:[],baseline:{}}
  const snapshot={sessionId:'music',chatId:'music',cardPath:'fixture.json',from:{turn:1,para:1},config:{characters:[],voice:{enabled:false},stage:{enabled:true,director:true,music:true,theme:'classic'}},turns:[{turn:1,body,direction}],paragraphs:[{turn:1,para:1,durationMs:1000}]}
  const renderer=await createClipBrowser({snapshot,plan:{from:snapshot.from,to:snapshot.from,frames:60,fps:60,resolution:{width:1280,height:720}},
    transport:async method=>{switch(method){
      case 'getRoundBody':return body
      case 'getStageDirection':return direction
      case 'getAssetPackPresentation':return {status:'ready',revision:1,directionToken:token,value:{state:{cast:[],actors:{},camera:{mode:'reset'},figureScale:{version:6,scene:1,hMax:150,rescales:0}},scene:{},characters:[],avatars:[],widgets:[],audio:{music:{ref:{packId:'fixture',kind:'music',assetId:'music'},identity:'original-music',name:'Original',url:'https://clip-export.invalid/music.wav'},soundscape:{version:1,layers:[]}}}}
      case 'getStageModHistory':return {turns:[]}
      case 'getStageMusicTracks':return {tracks:[]}
      case 'listFonts':return {fonts:[]}
      case 'getDialogueBubbles':return {config:snapshot.config}
      default:throw new Error(method)
    }},readAsset:async url=>{if(url.pathname==='/music.wav')return {body:wav,mediaType:'audio/wav'};const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}
  });t.after(()=>renderer.close())
  for(let frame=0;frame<renderer.timeline.lines[0].frames*2;frame++)await renderer.capture(frame)
  const events=await renderer.audioEvents(),music=events.find(row=>row.kind==='play'&&row.layer==='music')
  assert.ok(music,JSON.stringify(events));assert.ok((await renderer.audioBlob(music.url)).equals(wav))
  assert.ok((await renderer.evidence()).audioLayers.find(row=>row.layer==='music')?.peakGain>0)
})

for(const long of [false,true])test(`旁白配音: each narration page plays its cached narrator voice through the real stage narrator, starting with its page (long: ${long})`,{timeout:90000},async t=>{
  const pcm=Buffer.alloc(24000*2);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(12000*Math.sin(i/24000*523*Math.PI*2)),i*2)
  const wav=pcmWav(pcm),text=!long?'夜深了，街上没有人。':Array.from({length:24},(_,n)=>`第${n+1}盏街灯下没有人，只有风吹过空荡荡的站台。`).join('')
  const body=roundBody([{kind:'markdown',text}],{chatId:'narrated',turn:1})
  const snapshot={sessionId:'export-narrated',chatId:'narrated',cardPath:'fixture.json',from:{turn:1,para:1},
    config:{characters:[],voice:{enabled:true},narrator:{voiceKey:'narrator-key'},stage:{textLanguage:'zh',director:false,face:'off',music:false,theme:'classic'}},
    turns:[{turn:1,body}],paragraphs:[{turn:1,para:1,kind:'narration',text}]}
  const plan={from:{turn:1,para:1},to:{turn:1,para:1},frames:60,fps:60,resolution:{width:1280,height:720}}
  const options={plan,
    transport:async method=>{switch(method){case 'getRoundBody':return body;case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null};case 'getStageModHistory':return {turns:[]};case 'getStageMusicTracks':return {tracks:[]};case 'listFonts':return {fonts:[]};case 'getDialogueBubbles':return {config:snapshot.config};default:throw new Error('Unexpected host RPC '+method)}},
    readAsset:async url=>{if(url.pathname.startsWith('/clip-voice/narrator-'))return {body:wav,mediaType:'audio/wav'};const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}}
  // The host reads each page's narrator line after measuring the stage's own pages (clip-export-host.js narratorVoices).
  const measuring=await createClipBrowser({...options,snapshot,measureOnly:true})
  const texts=measuring.measured[0].narration;await measuring.close()
  assert.ok(long?texts.length>1:texts.length===1);assert.ok(texts.every(Boolean))
  snapshot.paragraphs[0].pageVoices=texts.map((page,n)=>({key:'narrator-'+n,durationMs:1000,loudness:{version:1,gain:1,gainDb:0},alias:'\u0000narrator',narration:true,input:{text:page,mood:'default'},language:'zh'}))
  const renderer=await createClipBrowser({...options,snapshot});t.after(()=>renderer.close())
  assert.deepEqual(renderer.timeline.voices.map(row=>[row.id,row.key]),texts.map((_,n)=>['1:1:'+n,'narrator-'+n]))
  const end=renderer.timeline.voices.at(-1).startFrame*2+13
  for(let frame=0;frame<end;frame++)await renderer.capture(frame)
  const voices=(await renderer.audioEvents()).filter(row=>row.layer==='voice'&&row.kind==='play'&&row.frame>=0)
  assert.deepEqual(voices.map(row=>row.voiceKey),texts.map((_,n)=>'narrator-'+n),JSON.stringify(await renderer.diagnostics()))
  const evidence=await renderer.evidence()
  assert.equal(evidence.voiceOnsets.length,texts.length)
  for(const onset of evidence.voiceOnsets)assert.ok(Math.abs(onset.audioFrame-onset.revealFrame)<=1,JSON.stringify(onset))
})