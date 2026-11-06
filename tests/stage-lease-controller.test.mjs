import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
import {persistentStageDefaults,actorPresentationDefaults} from '../tavern-plugin/lib/domain/stage-persistent-state.js'
const require=createRequire(import.meta.url)
// (loaded before a test page defines window: the resolver exports itself to Node only, and is required lazily)
require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')
const client=name=>require('../tavern-plugin/packages/dsh-tavern-stage/src/client/'+name+'.cjs')
const {createStageController}=client('controller')
const {leaseScene,leaseCursor}=client('lease-scene')
const {createStageSpeech}=client('speech')
const {bubbleCharacter}=require('../tavern-plugin/src/client/bubble-line.cjs')
const {matchBubbleMood}=require('../tavern-plugin/packages/dsh-asset-library/src/shared/emotion-identity.cjs')

// Fixture actor keys differ from names and aliases; two characters share 葛城 (ambiguous: no figure, no voice).
const character=(alias,name,latin,figureId)=>({alias,name,aliases:[latin],ref:{packId:'pk-'+figureId,figureId},voiceKey:'v-'+figureId})
const config={characters:[character('c-81q','辉夜','Kaguya','f-1'),character('c-2zx','包豪斯','Bauhaus','f-2'),character('c-k1','葛城','katsuragi-a','f-3'),character('c-k2','葛城','katsuragi-b','f-4')]}
const moods=[{id:'angry',label:'生气',words:'愤怒'},{id:'calm',label:'平静',words:''}]

// The host's in-memory stageLeases as the stage sees it (plugin-api: publish / release / get / subscribe).
function leaseRegistry(){
  const leases=new Map(),watchers=new Set()
  const notify=()=>watchers.forEach(fn=>fn())
  return {publish(sessionId,lease){leases.set(sessionId,Object.freeze(lease));notify()},release(sessionId,owner){if(leases.get(sessionId)?.owner===owner){leases.delete(sessionId);notify()}},
    get:sessionId=>leases.get(sessionId)||null,subscribe:(sessionId,fn)=>{watchers.add(fn);return()=>watchers.delete(fn)}}
}
const strictly=()=>{throw new Error('a lease must not reach the story runtime or the director')}

async function harness(run){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://example.test'}),{window}=dom
  const before={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true})
  const registry=leaseRegistry(),played=[]
  const player={prefetch:async()=>{},play:async(resource,request)=>{played.push(request.selectionKey)},get:()=>null,stopPlayback(){}}
  const speech=createStageSpeech({player,available:()=>true,speechInput:segment=>({text:segment.text,mood:segment.mood||null}),character:bubbleCharacter,language:()=>'zh',open:async()=>null})
  const views={speech,lease:{subscribe:registry.subscribe,get:registry.get,cursor:leaseCursor,
    scene:(scene,{rows,config})=>leaseScene(scene,{rows,normalizeEmotion:raw=>matchBubbleMood(raw,moods)?.id})},
    // the story runtime and its sessions: any use under a lease fails the check
    sessions:{get:strictly,get owner(){return {navigate:strictly}}}}
  const controller=createStageController({React,window,document:window.document,views,navigation:{},services:{dialogue:{},figures:{}},legacy:{},
    options:{speech:{player},speaker:{character:bubbleCharacter}}})
  const story={pages:[1,2,3,4].map(n=>({kind:'narration',text:'故事 '+n,para:n,anchor:{para:n,paragraphId:'p'+n}})),page:3,
    setPage:strictly,markRead:strictly}
  let view=null
  function Probe(){view=controller.useLease({sessionId:'s1',config,voiceAvailable:true,story});return null}
  const root=createRoot(window.document.getElementById('app'))
  try{
    await act(async()=>root.render(React.createElement(Probe)))
    await run({registry,story,played,view:()=>view,step:async fn=>{await act(async()=>fn(view))},
      remount:async()=>{await act(async()=>root.render(null));await act(async()=>root.render(React.createElement(Probe)))}})
  }finally{act(()=>root.unmount());controller.dispose();speech.dispose();window.close()
    Object.assign(globalThis,{window:before.window,document:before.document,IS_REACT_ACT_ENVIRONMENT:before.act})}
}
const lease=(owner,lines,actors=[])=>({owner,scene:{actors,lines},hud:null,props:{}})
const LINES=[{id:'L1',speaker:'辉夜',text:'我先说。',emotion:'生气'},{id:'L2',speaker:'葛城',text:'谁在说话？'},{id:'L3',text:'夜色渐深。'}]

test('lease lines are the pages; a resolved speaker gets a voice handle, an ambiguous one keeps its line with none',async()=>{
  await harness(async({registry,story,view,step})=>{
    assert.equal(view().leasing,false)
    assert.equal(view().pages,story.pages)
    assert.equal(view().page,3)
    await step(()=>registry.publish('s1',lease('werewolf',LINES,[{name:'辉夜'},{name:'包豪斯',focus:true}])))
    const shown=view()
    assert.equal(shown.leasing,true)
    assert.deepEqual(shown.pages.map(page=>page.text),['我先说。','谁在说话？','夜色渐深。'])
    assert.deepEqual(shown.pages.map(page=>page.kind),['line','line','narration'])
    assert.equal(shown.page,0,'a new lease starts at its first unread line')
    assert.deepEqual(shown.read,{lineId:null,unread:3})
    const [spoken,ambiguous,narration]=shown.pages
    assert.equal(spoken.alias,'c-81q');assert.equal(spoken.mood,'angry')
    assert.ok(spoken.voice,'a resolved speaker speaks through the stage speech handle')
    assert.equal(spoken.voice.selectionKey,JSON.stringify(['s1','L1']))
    assert.equal(spoken.voice.owner,'s1:stage')
    assert.equal(ambiguous.voice,null);assert.equal(ambiguous.alias,undefined);assert.equal(ambiguous.name,'葛城')
    assert.equal(narration.voice,null,'narration speaks only with a narrator voice on the card')
    assert.deepEqual(shown.scene.actors.map(actor=>[actor.alias,actor.focus,actor.dim]),[['c-81q',false,true],['c-2zx',true,false]])
  })
})

test('the cursor is kept per lease and appended lines are read on after the reader turned past the end',async()=>{
  await harness(async({registry,view,step})=>{
    await step(()=>registry.publish('s1',lease('werewolf',LINES.slice(0,2))))
    await step(view=>view.markRead())
    await step(view=>view.setPage(1))
    await step(view=>view.markRead())
    assert.deepEqual(view().read,{lineId:'L2',unread:0})
    assert.equal(view().waiting,false)
    await step(view=>view.pastEnd())
    assert.equal(view().waiting,true,'turned past the last line, the reader waits for the game')
    await step(()=>registry.publish('s1',lease('werewolf',LINES)))
    assert.equal(view().page,2,'the appended line is read on into')
    assert.equal(view().waiting,false)
    assert.deepEqual(view().read,{lineId:'L2',unread:1})
    // another lease has its own cursor; the first one's comes back with it
    await step(()=>registry.publish('s1',lease('dice',[{id:'D1',text:'掷骰'}])))
    assert.equal(view().page,0);assert.deepEqual(view().read,{lineId:null,unread:1})
    await step(()=>registry.publish('s1',lease('werewolf',LINES)))
    assert.equal(view().page,2);assert.deepEqual(view().read,{lineId:'L2',unread:1})
    // lines the game replaced (the cursor's line is gone) are read again from the first
    await step(()=>registry.publish('s1',lease('werewolf',[{id:'N1',text:'新的一局'}])))
    assert.equal(view().page,0);assert.deepEqual(view().read,{lineId:null,unread:1})
  })
})

test('two cards resume their own lease reading position after leaving and re-entering the stage',async()=>{
  await harness(async({registry,view,step,remount})=>{
    for (const [owner,lines,page] of [
      ['werewolf',LINES,2],
      ['detective',[{id:'clue-1',text:'First clue'},{id:'clue-2',text:'Second clue'}],1]
    ]) {
      await step(()=>registry.publish('s1',lease(owner,lines)))
      assert.equal(view().page,0,'a different card does not inherit the other bookmark')
      await step(view=>view.setPage(page))
      await step(view=>view.markRead())
      await step(view=>view.pastEnd())
      await step(()=>registry.release('s1',owner))
      await remount()
      await step(()=>registry.publish('s1',lease(owner,lines)))
      assert.equal(view().page,page)
      assert.equal(view().read.lineId,lines[page].id)
      assert.equal(view().waiting,true)
    }
    await remount()
    await step(()=>registry.publish('s1',lease('werewolf',[...LINES,{id:'L4',text:'The next day'}])))
    assert.equal(view().page,3,'new lines resume after the saved end, not at the opening')
    assert.equal(view().read.lineId,'L3')
    await step(()=>registry.publish('s1',lease('werewolf',[{id:'new-game-1',text:'A new game'}])))
    assert.equal(view().page,0,'a replaced game does not consume a stale reading position')
    assert.equal(view().read.lineId,null)
  })
})

test('releasing the lease returns the story pages at their index, with no write to the persistent stage state',async()=>{
  const persistent={...persistentStageDefaults(),actors:{'c-81q':{...actorPresentationDefaults(),outfit:'school'}}}
  const before=structuredClone(persistent)
  await harness(async({registry,story,view,step})=>{
    await step(()=>registry.publish('s1',lease('werewolf',LINES,[{name:'辉夜'}])))
    await step(view=>view.markRead())
    await step(view=>view.setPage(2))
    await step(view=>view.pastEnd())
    assert.equal(view().page,2)
    await step(()=>registry.release('s1','werewolf'))
    assert.equal(view().leasing,false)
    assert.equal(view().pages,story.pages)
    assert.equal(view().page,3,'the story page it left, not reset')
    assert.equal(view().read,null)
  })
  assert.deepEqual(persistent,before)
})

test('the backlog lists the lease lines read so far, without the story rounds around them',async()=>{
  for(const name of ['backlog-rows','backlog-history','backlog-paging','backlog-voice','backlog-view'])client(name)
  await harness(async({registry,view,step})=>{
    await step(()=>registry.publish('s1',lease('werewolf',LINES)))
    await step(view=>view.setPage(1))
    const document=globalThis.document,player={get:()=>null,subscribe:()=>()=>{}}
    const backlogRows=client('backlog-rows').createStageBacklogRows({registry:()=>({get:()=>null,list:()=>[]}),core:[]})
    const backlogHistory=client('backlog-history').createStageBacklogHistory({React,read:async()=>({turns:[],kinds:[]}),subscribe:()=>()=>{}})
    const backlogPaging=client('backlog-paging').createStageBacklogPaging({React,hasOlder:()=>false})
    const backlogVoice=client('backlog-voice').createStageBacklogVoice({player})
    const backlog=client('backlog-view').createStageBacklogView({React,window:globalThis.window,document,stageViews:{backlogRows,backlogHistory,backlogPaging,backlogVoice},voicePlayer:player,useJumpLatest:()=>({away:false,jump(){}}),JumpLatest:()=>null,useFigureTextContrast(){},bubbleCharacter,galQuoted:text=>text,VoiceButton:()=>null,PackImage:()=>null,Icon:()=>null,HelpTip:()=>null,Spinner:()=>null,getComputedStyle:globalThis.window.getComputedStyle.bind(globalThis.window),setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout})
    const host=document.createElement('div');document.body.appendChild(host)
    const root=createRoot(host),jumps=[]
    try{
      await act(async()=>root.render(React.createElement(backlog.Backlog,{lease:true,sessionId:'s1',turn:7,textIndex:new Map(),pages:view().pages,page:view().page,inputs:{7:'玩家输入'},config,
        colorOf:()=>'',avatarOf:()=>null,nameOf:alias=>bubbleCharacter(config,alias)?.name||'',onJump:(...args)=>jumps.push(args),onClose(){}})))
      const text=host.textContent
      assert.match(text,/我先说。/);assert.match(text,/谁在说话？/)
      assert.doesNotMatch(text,/夜色渐深/,'lines not reached yet are not in the log')
      assert.doesNotMatch(text,/玩家输入/)
      assert.equal(host.querySelector('.fork-gal-backlog-turn'),null)
      await act(async()=>host.querySelector('.fork-gal-backlog-row').click())
      assert.equal(jumps[0][0],0)
    }finally{act(()=>root.unmount());[backlog,backlogVoice,backlogPaging,backlogHistory].forEach(module=>module.dispose())}
  })
})
