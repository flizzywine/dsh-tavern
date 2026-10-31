import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageFigureAppearance}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-appearance.cjs')
const {createStageSceneGraphics}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-graphics.cjs')
function fixture(){
 const allocated=[]
 class Filter{constructor(options){this.options=options;this.dead=0;allocated.push(this)}destroy(){this.dead++}}
 const PIXI={MSAA_QUALITY:{NONE:0},filters:{ColorMatrixFilter:Filter,GlowFilter:Filter,KawaseBlurFilter:Filter}}
 const graphics=createStageSceneGraphics({window:{PIXI}}),container={}
 const owner=createStageFigureAppearance({graphics,springValue:v=>({v,d:0}),spring:(state,value)=>state.v=value})
 const create=tune=>owner.create({PIXI,container,tune:tune||(()=>{})})
 return {owner,create,allocated,container}
}
test('figure appearance preserves filter order, quality changes and idle expiry',()=>{
 const e=fixture(),view=e.create(),input={mode:'glow',defocused:true,quality:'high',now:0,dt:.1}
 view.tick(input);assert.equal(view.filters.all().length,3);assert.equal(view.filters.get('rim').options.distance,14);assert.equal(view.filters.get('dof').blur,2)
 const matrix=[1,2,3];view.setShade(matrix);assert.equal(view.filters.get('shade').matrix,matrix)
 const previous=view.filters.get('rim');view.tick({...input,quality:'low',now:10});assert.equal(previous.dead,1);assert.equal(view.filters.get('rim').options.distance,8)
 view.tick({...input,mode:'',defocused:false,now:20});view.tick({...input,mode:'',defocused:false,now:4000});assert.equal(view.filters.all().length,1)
 e.owner.dispose();view.dispose();assert.equal(e.container.filters,null);assert.ok(e.allocated.every(filter=>filter.dead===1))
 const count=e.allocated.length;view.tick(input);view.setShade([]);assert.equal(e.allocated.length,count)
})
test('reduced-motion armed cue uses actor colour and snapshots do not expose state',()=>{
 const e=fixture(),view=e.create();view.tick({armedOn:1,reduced:true,color:'#000000',quality:'high',now:0,dt:0})
 assert.equal(view.filters.get('rim').color,0x7f7f7f);assert.equal(view.filters.get('rim').outerStrength,2)
 const snapshot=view.snapshot();snapshot.armed=0;assert.equal(view.snapshot().armed,1)
 e.owner.dispose()
})
test('failed shade tuning releases allocation and allows a fresh instance',()=>{
 const e=fixture();assert.throws(()=>e.create(()=>{throw Error('tune failed')}),/tune failed/)
 assert.equal(e.allocated[0].dead,1);assert.equal(e.container.filters,null)
 e.create();e.owner.dispose();assert.ok(e.allocated.every(filter=>filter.dead===1))
})
