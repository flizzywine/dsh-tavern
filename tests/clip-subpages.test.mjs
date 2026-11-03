import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createClipBrowser} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-browser.js'
import {planClipExport} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/clip-export.js'
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

// Regression: a line too long for the text box is several pages on the stage, but the exported clip held
// page 1 for the whole segment. The clip walks the stage's own pager cards, each timed as the stage's auto mode times it.
const quiet=Array.from({length:8},(_,i)=>'第'+(i+1)+'次，她把便当盒放在膝上，看着窗外慢慢飘过的云，说今天的风有一点凉，像是秋天提前来了。').join('')
const spoken=Array.from({length:7},(_,i)=>'第'+(i+1)+'遍，我本来以为这只是一场普通的梦，可是醒来以后，手里还握着那张写着日期的车票，上面的字一个都没有变。').join('')
const cue=(alias,name,text)=>`@bubble:${alias}|${name}|平静|[${text}]`

test('a segment whose line is three text box pages shows pages 1, 2 and 3 in order, a voiced one keeps one voice across them, and the estimate runs the same plan',{timeout:120000},async t=>{
  const pcm=Buffer.alloc(24000*2*9);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(9000*Math.sin(i/24000*523*Math.PI*2)),i*2)
  const wav=pcmWav(pcm),key='fixture-long-voice',voiceMs=9000
  const body=roundBody([{kind:'markdown',text:cue('mika','美香',quiet)+'\n\n'+cue('rin','凛',spoken)}],{chatId:'subpages',turn:1})
  const snapshot={sessionId:'subpages-session',chatId:'subpages',cardPath:'fixture.json',from:{turn:1,para:1},
    config:{characters:[{alias:'mika',name:'美香'},{alias:'rin',name:'凛',voice:'voice',voiceKey:'voice',voiceLanguage:'zh'}],voice:{enabled:true},stage:{textLanguage:'zh',director:false,face:'off',music:false,theme:'classic'}},
    turns:[{turn:1,body}],paragraphs:[{turn:1,para:1,durationMs:1000,text:quiet},
      {turn:1,para:2,durationMs:1000,text:spoken,voice:{key,durationMs:voiceMs,loudness:{version:1,gain:1,gainDb:0},alias:'rin',input:{text:spoken,mood:'平静'},selectionKey:JSON.stringify(['subpages-session',1,1]),language:'zh'}}]}
  const plan={from:{turn:1,para:1},to:{turn:1,para:2},frames:0,fps:30,captureFormat:'jpeg',resolution:{width:1280,height:720}}
  const renderer=await createClipBrowser({snapshot,plan,
    transport:async method=>{switch(method){case 'getRoundBody':return body;case 'getStageDirection':return {phase:'off',revision:0,generation:0,token:null};case 'getStageModHistory':return {turns:[]};case 'getModStageViews':return {views:[]};case 'getStageMusicTracks':return {tracks:[]};case 'listFonts':return {fonts:[]};case 'getDialogueBubbles':return {config:snapshot.config};default:throw new Error('Unexpected host RPC '+method)}},
    readAsset:async url=>{if(url.pathname==='/clip-voice/'+key)return {body:wav,mediaType:'audio/wav'};const client=await readTavernClientAsset(url.pathname);if(client)return client;const asset=await resolveTavernRuntimeAsset(url.pathname);if(asset)return {body:await readFile(asset.file),mediaType:asset.mediaType}}
  });t.after(()=>renderer.close())
  const [silent,voiced]=renderer.timeline.lines
  assert.equal(silent.cards[0].length,3,'the silent line fills three text box pages: '+JSON.stringify(renderer.timeline.lines))
  assert.equal(voiced.cards[0].length,3,'the voiced line fills three text box pages')
  // The stage's auto mode in the export (instant text, autoWait 700 ms, autoSpeed 1.3): a silent page holds
  // clamp(400 + 70 x letters, 800, 10000) ms / 1.3; a voiced page turns with its voice and the last waits autoWait after it.
  assert.ok(silent.cards[0].every(frames=>frames>=Math.round(800/1.3*30/1000)))
  assert.ok(Math.abs(voiced.frames-Math.round((voiceMs+700/1.3)*30/1000))<=1,'a voiced line lasts its voice plus the auto wait: '+voiced.frames)
  const estimate=renderer.timeline.lines.map(row=>row.frames)
  // The plan the panel shows (and the Discord budget and GIF limit read) is built from those frames.
  const rows=snapshot.paragraphs.map((row,index)=>({...row,frames:estimate[index],durationMs:estimate[index]*1000/30}))
  const range={chatId:snapshot.chatId,from:{turn:1,para:2},to:{turn:1,para:2}}
  assert.ok(Math.abs(planClipExport(rows,range,'1080p').durationMs-voiced.frames*1000/30)<=1000/30)
  assert.ok(Math.abs(planClipExport(rows,range,'discord').plannedFiles[0].sourceFrames-voiced.frames)<=1)
  plan.frames=silent.frames+voiced.frames
  const captions=[],seen=[]
  for(let frame=0;frame<plan.frames;frame++) {
    await renderer.capture(frame)
    const caption=(await renderer.inspect()).caption
    if(caption!==seen.at(-1)){seen.push(caption);captions.push({frame,caption})}
  }
  assert.equal(captions.length,6,JSON.stringify(captions))
  const text=value=>value.replace(/^「|」$/g,'')
  assert.equal(captions.slice(0,3).map(row=>text(row.caption)).join(''),quiet,'pages 1, 2 and 3 of the silent line, in order')
  assert.equal(captions.slice(3).map(row=>text(row.caption)).join(''),spoken,'pages 1, 2 and 3 of the voiced line, in order')
  let start=0
  for(const [index,frames] of [...silent.cards[0],...voiced.cards[0]].entries()){assert.equal(captions[index].frame,start,'page '+index+' shows on its planned frame');start+=frames}
  const voices=(await renderer.audioEvents()).filter(row=>row.layer==='voice'&&row.frame>=0)
  assert.deepEqual(voices.map(row=>row.kind),['play','stop'],'one voice plays on across the voiced line\'s pages: '+JSON.stringify(voices))
  assert.ok(Math.abs(voices[1].offset-voiceMs/1000)<0.05,'it stops only at its own end, never at a page turn')
  assert.ok(Math.abs(voices[0].frame-silent.frames)<=1)
  // Card turns of the voiced line follow the voice clock by the share of text each page holds.
  // The independent reference replay pages the same cards (it would throw on any other split) and is on page 3 too.
  const reference=await renderer.reference(captions[2].frame)
  assert.equal(reference.toString('hex',0,8),'89504e470d0a1a0a')
  const chars=[...voiced.cards[0].keys()].map(index=>Array.from(text(captions[3+index].caption)).length),total=chars.reduce((a,b)=>a+b,0)
  assert.ok(Math.abs(voiced.cards[0][0]-Math.round(voiceMs*chars[0]/total*30/1000))<=1)
})
