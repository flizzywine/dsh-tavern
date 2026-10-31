import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageText} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/text.cjs')
function fixture(fonts) {
  const effects = [], timers = new Map(), updates = []
  let id = 0
  const React = {
    useState:initial => [typeof initial === 'function' ? initial() : initial, value => updates.push(value)],
    useRef:current => ({current}),useMemo:fn => fn(),
    useEffect:fn => effects.push(fn),useLayoutEffect:fn => effects.push(fn),
    createElement:(type,props,...children) => ({type,props,children}),
  }
  const text = createStageText({
    React,document:{fonts},defaultTextSpeed:28,
    clock:{now:() => 0,setTimeout:fn => {timers.set(++id,fn);return id},clearTimeout:id => timers.delete(id)},
    stageGlyphs:value => Array.from(value),stageGlyphDelay:() => 28,STAGE_GLYPH_FADE_MS:100,
  })
  return {text,effects,timers,updates}
}
test('streaming typewriter keeps the unfinished Latin tail hidden and cleans timers', () => {
  const {text,effects,timers} = fixture()
  const result = text.Typewriter({text:'你好 hello',pending:true,instant:true})
  assert.equal(result.children[0].children[0],'你好 ')
  assert.equal(result.children[2].children[0],'hello')
  const cleanups = effects.map(fn => fn()).filter(Boolean)
  assert.equal(timers.size,1)
  cleanups.forEach(fn => fn())
  assert.equal(timers.size,0)
})
test('font readiness resolving after text unmount cannot update its state', async () => {
  let ready
  const {text,effects,timers,updates} = fixture({status:'loading',ready:new Promise(resolve => {ready=resolve})})
  text.Typewriter({text:'你好',speed:28})
  const cleanups = effects.map(fn => fn()).filter(Boolean)
  assert.equal(timers.size,2)
  cleanups.forEach(fn => fn())
  assert.equal(timers.size,0)
  ready()
  await Promise.resolve()
  assert.deepEqual(updates,[])
})
