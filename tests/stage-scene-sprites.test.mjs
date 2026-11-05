import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

test('scene sprites use the requested native layer and release their textures', () => {
  const source=readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs',import.meta.url),'utf8')
  const start=source.indexOf('    function tickSceneSprites('),end=source.indexOf('\n    function applyQuality(',start)
  const destroyed=[]
  class BaseTexture { constructor(source){this.source=source} update(){} }
  class Texture { constructor(baseTexture){this.baseTexture=baseTexture} destroy(){destroyed.push('texture')} }
  class Sprite { constructor(texture){this.texture=texture;this.position={set:(x,y)=>{this.x=x;this.y=y}}} destroy(){destroyed.push('sprite')} }
  class Rectangle { constructor(x,y,width,height){Object.assign(this,{x,y,width,height})} }
  const back={addChild(s){s.parent=this}},front={addChild(s){s.parent=this}},sceneSprites=new Map()
  const tick=vm.runInNewContext(source.slice(start,end)+'\ntickSceneSprites',{PIXI:{BaseTexture,Texture,Sprite,Rectangle},contributedBack:back,contributedFront:front,sceneSprites})
  const canvas={width:32,height:16}
  tick([{id:'spark',source:canvas,layer:'back',x:2,y:3,width:8,height:8,frame:{x:8,y:0,width:8,height:8}}])
  assert.equal(sceneSprites.get('spark').sprite.parent,back)
  assert.equal(sceneSprites.get('spark').texture.frame.x,8)
  tick([])
  assert.equal(sceneSprites.size,0)
  assert.deepEqual(destroyed,['sprite','texture'])
})

test('geometry exposes world bounds before camera projection',()=>{
  const source=readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs',import.meta.url),'utf8')
  const start=source.indexOf('    function figureRects()'),end=source.indexOf('\n    const stageHost =',start)
  const state={camera:{safe:{}},figures:new Map([['a',{figure:{alias:'candidate:a'},container:{visible:true},restBody:{x:10,y:20,width:30,height:40},restHead:{x:25,top:20,chin:30,width:10},headroom:5}]])}
  const rects=vm.runInNewContext(source.slice(start,end)+'\nfigureRects',{state,figuresBox:{visible:true},app:{screen:{width:200,height:100}},galFigureRects:()=>[{id:'candidate:a',body:{x:20},head:{x:40}}]})()
  assert.equal(rects[0].worldBody.y,25)
  assert.equal(rects[0].worldHead.x,20)
  assert.equal(rects[0].worldHead.y,25)
})

test('explicit contribution size scales around the feet for physical and legacy actors',()=>{
  const source=readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs',import.meta.url),'utf8')
  const start=source.indexOf('        state.figures.forEach(entry=>{',source.indexOf('tickFaceClamp(dt, W, H, visibleFrame);'))
  const end=source.indexOf('\n        tickSceneSprites(',start)
  for(const mode of ['physical','legacy']){
    const position={x:0,y:0,set(x,y){this.x=x;this.y=y}},scale={x:1,y:1}
    const entry={figure:{sceneSize:0.1},figureResolved:{mode},headroom:0,container:{position,scale,get x(){return position.x},get y(){return position.y}},restBody:{x:0,y:0,width:100,height:200},restHead:{x:50,top:0,chin:40,width:20}}
    vm.runInNewContext(source.slice(start,end),{state:{figures:new Map([['a',entry]])}})
    assert.equal(entry.restBody.height,20)
    assert.equal(entry.restBody.y+entry.restBody.height,200)
    assert.equal(scale.x,0.1)
  }
})

test('presentation exposes only visible references rather than resource URLs',()=>{
  const source=readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs',import.meta.url),'utf8')
  const start=source.indexOf('    function presentation()'),end=source.indexOf('\n    const stageHost =',start)
  const ref={packId:'p',kind:'backgrounds',assetId:'room'}, actorRef={packId:'p',figureId:'hero'}
  const backgrounds={pending:'',layers:[{url:'private-resource-url',scene:JSON.stringify(ref),sprite:{alpha:1}}]}
  const state={figures:new Map([['a',{kind:'static',sprite:{},loadedIdentity:'ok',container:{visible:true},figure:{alias:'candidate:a',identity:'ok',sourceRef:actorRef,sourceOutfitKey:'outfit',sourceStateId:'joy'}}]])}
  const result=vm.runInNewContext(source.slice(start,end)+'\npresentation',{backgrounds,state})()
  assert.equal(result.backgrounds[0].ref.assetId,'room')
  assert.equal(result.actors[0].stateId,'joy')
  assert.equal(JSON.stringify(result).includes('private-resource-url'),false)
})
