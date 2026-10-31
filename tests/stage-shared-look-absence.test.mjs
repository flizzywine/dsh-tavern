import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const read=path=>readFileSync(new URL('../tavern-plugin/'+path,import.meta.url),'utf8')
test('host look initialization and preview grading run with no stage plugin or stageViews',()=>{
 const context={window:{},stageLookLayer:item=>item.layer||'mood'}
 const result=vm.runInNewContext([
  read('shared/color-math.cjs'),read('src/client/gal-scene-helpers.cjs'),
  read('packages/dsh-presentation-protocol/src/stage-light.cjs'),read('shared/stage-look-math.cjs'),read('src/client/gal-looks.js'),
  '({neutral:stageLookMath.galLookMatrix(stageLookMath.galLookNormalize({})),identity:galMatrix.identity(),clamp:galClamp01(2)})'
 ].join('\n'),context)
 assert.equal(result.clamp,1);assert.equal(result.identity.length,20)
 assert.equal(result.neutral.length,20);assert.deepEqual([...result.neutral],[...result.identity])
})
