import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const {createStageCast}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/cast.cjs')
const source=readFileSync(new URL('../tavern-plugin/src/client/gal-scene.js',import.meta.url),'utf8')
function fixture(){
 const calls=[],warnings=[],state={figures:new Map(),lastPrune:5}
 let cast;
 const bridge={forget:e=>cast ? cast.forget(e) : (state.figures.get(e.key)===e&&state.figures.delete(e.key)),commit:e=>cast.commit(e)};
 const start=source.indexOf('    function commitFigureReplacement('),end=source.indexOf('    // the runtime loads',start)
 const api=vm.runInNewContext(source.slice(start,end)+';({destroyFigure,commitFigureReplacement})',{state,cast:bridge,AggregateError,console:{warn:(...args)=>warnings.push(args)},releaseTapStills:e=>calls.push(e.key+':tap'),layeredSpriteClearScene:e=>calls.push(e.key+':layers')})
 const entry=(key,fail=false)=>{
  const resource=name=>({destroy(){calls.push(key+':'+name);if(fail&&name==='warp')throw Error('GPU cleanup failed')}})
  return {key,warp:resource('warp'),blink:{dispose(){calls.push(key+':blink')}},appearance:{dispose(){calls.push(key+':appearance')}},figureAsset:resource('asset'),fading:[{asset:resource('fading')}],container:resource('container')}
 }
 return {calls,warnings,state,entry,...api,bindCast(){cast=createStageCast().create({build:f=>Object.assign(entry(f.key),{figure:f,kind:f.kind,identity:f.identity}),release:api.destroyFigure});state.figures=cast.entries;return cast;}}
}
test('figure cleanup continues after a GPU release failure and is idempotent',()=>{
 const e=fixture(),figure=e.entry('a',true);e.state.figures.set('a',figure)
 e.destroyFigure(figure);e.destroyFigure(figure)
 assert.deepEqual(e.calls,['a:tap','a:warp','a:blink','a:layers','a:appearance','a:asset','a:fading','a:container'])
 assert.equal(e.warnings.length,1);assert.equal(e.state.figures.size,0);assert.equal(e.state.lastPrune,0);assert.equal(figure.dead,true)
})
test('replacement survives old figure cleanup failure',()=>{
 const e=fixture(),cast=e.bindCast();cast.update([{key:'a',kind:'spine',identity:'old'}],0);const old=e.state.figures.get('a');old.warp.destroy=()=>{throw Error('GPU cleanup failed')};
 const [{entry:next}]=cast.update([{key:'a',kind:'spine',identity:'new'}],1);
 e.commitFigureReplacement(next)
 assert.equal(e.state.figures.get('a'),next);assert.equal(next.dead,undefined);assert.equal(old.dead,true);assert.equal(next.previous,null);assert.equal(old.replacement,null);assert.equal(e.state.figureLoads,1)
 e.destroyFigure(next);assert.equal(e.state.figures.size,0)
})
test('retiring a figure also retires its pending replacement without removing a newer entry',()=>{
 const e=fixture(),old=e.entry('a'),pending=e.entry('pending'),current=e.entry('a');old.replacement=pending;e.state.figures.set('a',current)
 e.destroyFigure(old)
 assert.equal(pending.dead,true);assert.equal(e.state.figures.get('a'),current);assert.equal(current.dead,undefined)
 assert.equal(e.calls.filter(call=>call.endsWith(':appearance')).length,2)
})
