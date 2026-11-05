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
