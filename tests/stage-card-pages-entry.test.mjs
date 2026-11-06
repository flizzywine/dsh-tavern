import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
const require=createRequire(import.meta.url)
const {createStageControls}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controls.cjs')
const {stageEnterPage}=createStageControls()

const title={id:'title',label:'标题',html:'<p>t</p>',showOn:{event:'stage-enter'},initial:true}
const intro={id:'intro',label:'导览',html:'<p>i</p>',showOn:{event:'stage-enter'}}
const map={id:'map',label:'地图',html:'<p>m</p>',shortcut:'m',menu:true,showOn:{event:'stage-enter'}}
const status={id:'status',label:'状态',html:'<p>s</p>',shortcut:'s',menu:true}

test('a showOn page opens on a later stage entry when the chat already has a player message',()=>{
 assert.equal(stageEnterPage({pages:[intro,status],fresh:false,skip:false}),'intro')
})

test('a fresh chat opens its initial page; the initial page never opens once the chat has a message',()=>{
 assert.equal(stageEnterPage({pages:[title,map],fresh:true,skip:false}),'title')
 assert.equal(stageEnterPage({pages:[title,map],fresh:false,skip:false}),'map')
 assert.equal(stageEnterPage({pages:[title],fresh:false,skip:false}),null)
})

test('跳过标题页 skips showOn pages on a non-fresh entry but keeps the initial page of a fresh chat',()=>{
 assert.equal(stageEnterPage({pages:[intro,map],fresh:false,skip:true}),null)
 assert.equal(stageEnterPage({pages:[title,intro],fresh:true,skip:true}),'title')
})

test('the controller handles each navigation visit once and skipping resumes the latest round', async()=>{
 const source=await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/controller.cjs',import.meta.url),'utf8')
 const effect=source.slice(source.indexOf('        if (!cardPages || !stageVisit'),source.indexOf('    }, [cardPages, stageVisit'))
 const {createStageNavigation}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/navigation.cjs')
 const document={documentElement:{setAttribute(){},removeAttribute(){}},querySelectorAll:()=>[],fullscreenElement:null}
 const navigation=createStageNavigation({window:{},document,navigator:{},playCue(){},getSessionId:()=> 's',getSettings:()=>null})
 const stop=navigation.galStageLifetime(), opened=[], entries=[]
 let latest=0,ended=0
 const context={cardPages:{pages:[intro],fresh:false},sessionId:'s',cardPageVisits:new Map(),galActive:navigation.galActive,
  stageViews:{controls:{stageEnterPage}},reading:{skipTitlePage:false},setHidden(){},setOpenPage:id=>opened.push(id),setEntryCardPage:id=>entries.push(id),entrance:{end:()=>ended++},jumpLatest:()=>latest++}
 const run=()=>{context.stageVisit=navigation.visit();vm.runInNewContext('(function(){'+effect+'})()',context)}
 navigation.galOpen('s');run()
 run();context.reading.skipTitlePage=true;run();context.cardPages={...context.cardPages};run()
 assert.deepEqual(opened,['intro'],'remount, settings and round refresh do not reopen')
 assert.equal(latest,0,'a settings change is not an entry')
 context.reading.skipTitlePage=false
 navigation.galLeave();navigation.galOpen('s');run()
 assert.deepEqual(opened,['intro','intro']);assert.equal(ended,2)
 context.reading.skipTitlePage=true
 navigation.galLeave();navigation.galOpen('s');run()
 assert.equal(latest,1);assert.equal(opened.length,2)
 context.cardPages={pages:[title,intro],fresh:true}
 navigation.galLeave();navigation.galOpen('s');run()
 assert.deepEqual(opened,['intro','intro','title']);assert.equal(latest,1)
 assert.deepEqual(entries,opened,'each page an entry opens is the entry page')
 stop()
})

test('pages without showOn never open on entry',()=>{
 assert.equal(stageEnterPage({pages:[status],fresh:true,skip:false}),null)
 assert.equal(stageEnterPage({pages:[],fresh:true,skip:false}),null)
 assert.equal(stageEnterPage({pages:undefined,fresh:false,skip:false}),null)
})

test('closing an entry page leaves the stage; continueGame enters it; only an entry page holds the line', async()=>{
 const source=await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/controller.cjs',import.meta.url),'utf8')
 const fn=name=>source.slice(source.indexOf('    function '+name+'('),source.indexOf('\n',source.indexOf('    function '+name+'(')))
 const calls=[]
 const context={props:{onExit:()=>calls.push('exit')},forkUiSfx:{play:cue=>calls.push('sfx:'+cue)},backlogClosedAt:{current:0},setOpenPage:id=>calls.push('open:'+id)}
 vm.runInNewContext(fn('leaveEntryPage')+';'+fn('closeCardPage')+';leaveEntryPage();closeCardPage();',context)
 assert.deepEqual(calls,['sfx:close','exit','sfx:close','open:null'])
 // the Overlay's close (×, Esc, the backdrop, the page's close()) on an entry page is leaveEntryPage, CONFIG / 回想 over it first
 assert.match(source,/onClose: configOpen \? closeConfig : galleryOpen \? closeGallery : entryOpen \? leaveEntryPage : closeCardPage/)
 assert.match(source,/if \(kind === 'continue'\) \{ closeCardPage\(\); return; \}/)
 const reveal=source.slice(source.indexOf('    const stageRevealed ='),source.indexOf('\n',source.indexOf('    const stageRevealed =')))
 assert.match(reveal,/&& !entryOpen;$/,'the reveal holds for the entry page only, not any open page')
})