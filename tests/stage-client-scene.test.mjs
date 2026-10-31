import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageScene}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs')
const math=require('../tavern-plugin/src/client/gal-scene-helpers.cjs')
function fixture(phase){
 const calls=[];let serial=0
 const PIXI={Application:class{constructor(){this.view={};this.renderer={on(){},gl:{}};this.ticker={update(){}}}destroy(){calls.push('app')}},Container:class{constructor(){this.id=++serial;if(this.id===3)throw Error('node allocation')}destroy(){this.destroyed=true;calls.push('node:'+this.id)}}}
 const sceneGraphics={textures(){
  if(phase==='textures')throw Error('texture allocation')
  return {a:{destroy(){calls.push('texture');if(phase==='cleanup')throw Error('texture cleanup')}}}
 }}
 const scope=createStageScene({window:{PIXI},document:{},math,reading:{get:()=>({})},services:{resolution:()=>1},modules:{sceneGraphics}})
 const host={appendChild(){if(phase==='append')throw Error('append')}}
 return {scope,host,calls}
}
for(const phase of ['append','textures','nodes','cleanup'])test(`scene startup rollback after ${phase} failure releases prior acquisitions`,()=>{
 const h=fixture(phase)
 assert.throws(()=>h.scope.create(h.host,{}),phase==='cleanup'?/initialization failed/:/append|allocation/)
 assert.deepEqual(h.calls,phase==='append'||phase==='textures'?['app']:['node:2','node:1','texture','app'])
 h.scope.dispose();assert.equal(h.calls.filter(v=>v==='app').length,1)
 assert.throws(()=>h.scope.create(h.host,{}),/disposed/)
})
