import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageCallViews}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/call-views.cjs')
function fixture(){
 const allocated=[],renders=[];let callback,stopped=0,failFigure=false,failTune=false
 class Resource{constructor(){allocated.push(this);this.dead=0;this.visible=true}destroy(){this.dead++;this.destroyed=true;this.parent?.removeChild(this)}}
 class Container extends Resource{constructor(){super();this.children=[]}addChild(...children){for(const c of children){c.parent?.removeChild(c);c.parent=this;this.children.push(c)}}removeChild(c){this.children=this.children.filter(x=>x!==c);c.parent=null}removeChildren(){for(const c of [...this.children])this.removeChild(c)}}
 class Sprite extends Container{constructor(texture){super();assert.ok(!texture.destroyed);this.texture=texture;for(const key of ['scale','position','anchor'])this[key]={set(...v){this.values=v}}}}
 class Graphics extends Container{clear(){return this}beginFill(){return this}drawRect(){return this}drawRoundedRect(){return this}endFill(){return this}}
 class Filter extends Resource{saturate(){}}
 class Matrix{copyTo(to){return to}invert(){return this}set(){return this}append(){return this}}
 const PIXI={Container,Sprite,Graphics,Matrix,Texture:{EMPTY:{}},filters:{BlurFilter:Filter,ColorMatrixFilter:Filter},RenderTexture:{create(size){return Object.assign(new Resource(),size)}}}
 const box={left:0,top:0,width:800,height:600},canvas={getBoundingClientRect:()=>box},screen={width:800,height:600}
 const subject={container:{visible:true,filters:[{}],transform:{localTransform:new Matrix(),updateLocalTransform(){},_parentID:1}},head:{x:10,top:20,chin:70}}
 const renderer={resolution:1,render(node,options){if(node===subject.container){assert.equal(node.filters,null);if(failFigure)throw Error('figure failed')}renders.push({node,options})},plugins:{extract:{canvas:()=>({toDataURL:()=> 'data:image/jpeg;base64,test'})}}}
 const owner=createStageCallViews({cover:()=>({scale:1}),canvasTexture(p,w,h,paint){assert.equal(w,4);assert.equal(h,256);paint({createImageData:()=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}},w,h);return new Resource()},subscribeFrames(fn){callback=fn;return ()=>stopped++}})
 const view=owner.create({PIXI,renderer,screen,canvas,tune(filter){if(failTune)throw Error('tune failed');return filter}})
 const spec={frame:{isConnected:true,getBoundingClientRect:()=>box},views:[{role:'remote',figure:{key:'a'},head:[.5,.1,.4],rect:{x:0,y:0,width:1,height:1},radius:0}],backdrop:'stage',glass:{blur:.02,saturate:1.2,rects:[{x:.1,y:.1,width:.3,height:.2,radius:.02,alpha:.8}]}}
 const background={width:100,height:100,baseTexture:{uid:1},frame:{width:100}}
 return {owner,view,allocated,renders,subject,input:{spec,dt:.2,W:800,H:600,background,subjects:new Map([['a',subject]])},capture:()=>callback(),get stopped(){return stopped},failFigure(){failFigure=true},failTune(value){failTune=value}}
}
test('call view composes and freezes remote output, captures it and releases owned resources',async()=>{
 const e=fixture(),filters=e.subject.container.filters;e.view.tick(e.input)
 assert.equal(e.view.covers,true);assert.deepEqual(e.view.snapshot().views,['remote']);assert.equal(e.view.snapshot().glass,1)
 assert.equal(e.subject.container.filters,filters);assert.equal(e.subject.container.transform._parentID,-1)
 assert.equal(await e.capture(),'data:image/jpeg;base64,test')
 const count=e.renders.length;e.view.tick({...e.input,spec:{...e.input.spec,frozen:true}});assert.equal(e.renders.length,count)
 e.view.tick({...e.input,spec:null,dt:.2});assert.equal(e.view.covers,false);assert.equal(e.view.container.visible,false);assert.deepEqual(e.view.snapshot().views,[])
 await assert.rejects(e.capture(),{code:'NO_FRAME'})
 e.owner.dispose();e.owner.dispose();e.view.dispose();assert.equal(e.stopped,1);assert.ok(e.allocated.every(r=>r.dead===1))
 assert.equal(e.subject.container.destroyed,undefined)
 e.view.tick(e.input);assert.equal(e.view.container.visible,false);await assert.rejects(e.capture(),{code:'NO_FRAME'})
})
test('failed call figure render restores borrowed filters and still releases all output resources',()=>{
 const e=fixture(),filters=e.subject.container.filters;e.failFigure()
 assert.throws(()=>e.view.tick(e.input),/figure failed/);assert.equal(e.subject.container.filters,filters);assert.equal(e.subject.container.transform._parentID,-1)
 e.owner.dispose();assert.ok(e.allocated.every(r=>r.dead===1));assert.equal(e.stopped,1)
})
test('failed filter setup rolls back partial call view and can retry',()=>{
 const e=fixture();e.failTune(true);assert.throws(()=>e.view.tick(e.input),/tune failed/)
 assert.deepEqual(e.view.snapshot().views,[])
 e.failTune(false);e.view.tick(e.input);assert.deepEqual(e.view.snapshot().views,['remote'])
 e.owner.dispose();assert.ok(e.allocated.every(r=>r.dead===1))
})

test('host call capture bridge permits an absent phone module',()=>{
 const source=readFileSync(new URL('../tavern-plugin/src/client/gal-stage.js',import.meta.url),'utf8')
 const expression=source.match(/callViews:\{cover:galCover,subscribeFrames:(.*)\},/)[1]
 const subscribe=vm.runInNewContext('('+expression+')',{})
 assert.equal(subscribe(()=>{}),null)
 let captured;const stop=()=>{},callback=()=>{}
 const connected=vm.runInNewContext('('+expression+')',{phoneModCall:{frames(fn){captured=fn;return stop}}})
 assert.equal(connected(callback),stop);assert.equal(captured,callback)
})
