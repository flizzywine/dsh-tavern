import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageDanmakuUi}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/danmaku-ui.cjs')
const {createStageDanmakuSettings}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/danmaku-settings.cjs')
test('danmaku UI owns registrations and ignores a read completing after disposal',async()=>{
 const listeners=new Set(),sections={},entries=new Map();let resolve,writes=0,events=0
 const window={addEventListener(_,fn){listeners.add(fn)},removeEventListener(_,fn){listeners.delete(fn)},dispatchEvent(){events++}}
 const effects=[]
 const React={useState:value=>[value,()=>writes++],useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>effects.push(fn()),useLayoutEffect:fn=>effects.push(fn()),createElement:()=>null}
 const settings=createStageDanmakuSettings({window})
 const view=createStageDanmakuUi({React,window,document:{},settings,sections,entries:{register(entry){entries.set(entry.id,entry);return()=>entries.delete(entry.id)}},confirm:()=>async()=>true})
 assert.equal(entries.size,1);assert.ok(sections['dsh.danmaku'])
 view.Toggle({rpc:()=>new Promise(done=>resolve=done)})
 assert.equal(listeners.size,1)
 view.dispose();resolve({scope:'global',authorized:true,settings:{values:{view:'overlay'}},manifest:{settingsSchema:{fields:[]}}});await Promise.resolve()
 assert.equal(writes,0);assert.equal(events,0);assert.equal(listeners.size,0);assert.equal(entries.size,0)
 assert.equal(sections['dsh.danmaku'],undefined)
 effects.forEach(off=>off?.());settings.dispose()
})
test('danmaku config disposal preserves a replacement registration',()=>{
 const sections={'dsh.danmaku':{old:true}},settings=createStageDanmakuSettings({})
 const view=createStageDanmakuUi({React:{},settings,sections})
 const replacement={replacement:true};sections['dsh.danmaku']=replacement
 view.dispose();assert.equal(sections['dsh.danmaku'],replacement);settings.dispose()
})
