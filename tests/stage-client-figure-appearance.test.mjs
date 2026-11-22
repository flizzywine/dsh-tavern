import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageFigureAppearance}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-appearance.cjs')
const {createStageFigureLight}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-light.cjs')
const {createStageSceneGraphics}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-graphics.cjs')
function fixture(){
 const allocated=[]
 class Filter{constructor(options,fragment,uniforms){this.options=options;this.uniforms=uniforms;this.dead=0;allocated.push(this)}destroy(){this.dead++}}
 const PIXI={MSAA_QUALITY:{NONE:0},Filter,Texture:{WHITE:{}},filters:{GlowFilter:Filter,KawaseBlurFilter:Filter}}
 const graphics=createStageSceneGraphics({window:{PIXI}}),container={}
 const owner=createStageFigureAppearance({graphics,springValue:v=>({v,d:0}),spring:(state,value)=>state.v=value,light:createStageFigureLight({})})
 const create=tune=>owner.create({PIXI,container,tune:tune||(()=>{})})
 return {owner,create,allocated,container}
}
test('reduced-motion armed cue uses actor colour and snapshots do not expose state',()=>{
 const e=fixture(),view=e.create();view.tick({armedOn:1,reduced:true,color:'#000000',quality:'high',now:0,dt:0})
 assert.equal(view.filters.get('rim').color,0x7f7f7f);assert.equal(view.filters.get('rim').outerStrength,2)
 const snapshot=view.snapshot();snapshot.armed=0;assert.equal(view.snapshot().armed,1)
 e.owner.dispose()
})
