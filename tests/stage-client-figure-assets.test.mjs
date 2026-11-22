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

// 三角机构 雷蒙德 (2026-11-22): the hammer head beside his head, at the same height and broader, pulled the head's centre - and so
// where he stands - onto the hammer. The pack's framed face span (an avatar crop of the outfit) bounds where the centre is looked for.
test('a picture\'s head centre is looked for inside the framed face span, so a weapon beside the head does not move the stand', async () => {
 const W = 100, H = 100, alpha = new Uint8ClampedArray(W * H * 4)
 const paint = (x0, x1, y0, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[(y * W + x) * 4 + 3] = 255 }
 paint(40, 60, 0, 20); paint(66, 100, 0, 20); paint(40, 60, 20, 100)
 const document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: (x, y, w, h) => ({ data: alpha.slice(y * W * 4, (y + h) * W * 4) }) }) }) }
 class Sprite { constructor(texture) { this.texture = texture; this.anchor = { set() {} } } destroy() { this.destroyed = true } }
 const texture = { width: W, height: H, baseTexture: { resource: { source: {} } } }
 const metrics = { headTop: () => 0, source: s => s, measure: () => null, anatomy: () => ({ headTop: 0, chin: 0.2 }), record: () => ({}), resolve: () => ({ mode: 'legacy' }), bodyX: () => null, bodyCentre: () => null }
 const stand = async face => {
  const owner = createStageFigureAssets({ metrics, spineFigures: {} })
  const scope = owner.create({ PIXI: { Sprite }, renderer: {}, screen: { width: 800, height: 600 }, textures: { load: async () => texture }, document,
   centred: (anatomy, canvas, centre) => ({ ...anatomy, supportX: centre(anatomy) / canvas[0] }) })
  const asset = await scope.picture({ src: 'p.png', input: { pack: true, source: 'p.png', face } })
  const x = asset.sprite.figureInput.anatomy.supportX; owner.dispose(); return x
 }
 assert.ok(await stand(null) > 0.6, 'the whole band: pulled toward the broader weapon')
 assert.ok(Math.abs(await stand([0.3, 0.64]) - 0.5) < 0.01, 'inside the face span: the head itself')
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
