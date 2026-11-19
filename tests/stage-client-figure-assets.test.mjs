import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageFigureAssets}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-assets.cjs')
test('scene accepts only the newest picture request even when identity returns to A',async()=>{
 const source=readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs',import.meta.url),'utf8'),start=source.indexOf('    function showStatic('),end=source.indexOf('    // authored blink',start)
 const pending=[],attached=[],committed=[],state={clock:0},entry={figure:{identity:'A'},container:{addChildAt(sprite){attached.push(sprite)}},fading:[]}
 const show=vm.runInNewContext(source.slice(start,end)+';showStatic',{figureAssets:{picture:()=>new Promise(resolve=>pending.push(resolve))},state,console,commitFigureReplacement:e=>committed.push(e),layeredSpriteClearScene(){},clearBlink(){}})
 show(entry,'a');entry.figure={identity:'B'};show(entry,'b');entry.figure={identity:'A'};show(entry,'a')
 const asset=()=>({sprite:{texture:{}},dead:0,destroy(){this.dead++}}),first=asset(),second=asset(),latest=asset()
 pending[2](latest);await Promise.resolve();pending[0](first);pending[1](second);await Promise.resolve()
 assert.equal(entry.figureAsset,latest);assert.deepEqual(attached,[latest.sprite]);assert.equal(committed.length,1);assert.equal(first.dead,1);assert.equal(second.dead,1);assert.equal(latest.dead,0)
})

test('a pack Spine figure is sized through the same head rule as a picture, with its rig head',async()=>{
 const seen=[],texture={width:100,height:200}
 class Sprite{constructor(){this.anchor={set(...v){this.values=v}}}destroy(){this.destroyed=true}}
 const metrics={source:s=>s,anatomy:(input,canvas)=>{seen.push(['anatomy',input.head,canvas]);return {headTop:.1,chin:.2}},record:input=>{seen.push(['record',input.anatomy]);return {}},resolve:()=>({mode:'physical',supportX:50,feet:400}),bodyX:()=>null}
 const body=new Sprite(),figure={body,frame:[0,0,100,200],measured:{candidate:{auto:{}}},head:{top:.1,chin:.2,x:60},mood(){},destroy(){}}
 const owner=createStageFigureAssets({metrics,spineFigures:{prepare:async()=>figure}})
 const scope=owner.create({PIXI:{Sprite},renderer:{},screen:{width:800,height:600},textures:{},centred:(anatomy,canvas,centre)=>({...anatomy,supportX:centre(anatomy)/canvas[0]})})
 await scope.spine({url:'m',identity:'m',config:{},input:{pack:true,source:'m'}})
 assert.deepEqual(seen,[['anatomy',{top:.1,chin:.2},[100,200]],['record',{headTop:.1,chin:.2,supportX:.6}]])
 assert.deepEqual(body.figureInput.anatomy,{headTop:.1,chin:.2,supportX:.6});assert.deepEqual(body.anchor.values,[.5,2])
 owner.dispose()
})
