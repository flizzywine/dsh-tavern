import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageText} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/text.cjs')
// the text of the typewriter's run span with this class (shown: revealed, rest: still hidden)
const run = (node, name) => node.children.find(child => child?.props?.className === 'fork-gal-type-' + name)?.children.join('')
function fixture(fonts) {
  const effects = [], timers = new Map(), updates = []
  let id = 0
  const React = {
    useState:initial => [typeof initial === 'function' ? initial() : initial, value => updates.push(value)],
    useRef:current => ({current}),useMemo:fn => fn(),
    useEffect:fn => effects.push(fn),useLayoutEffect:fn => effects.push(fn),
    // React renders a nested child array as its items (Typewriter returns its runs as one array)
    createElement:(type,props,...children) => ({type,props,children:children.flat(Infinity)}),
  }
  const text = createStageText({
    React,document:{fonts},defaultTextSpeed:28,
    clock:{now:() => 0,setTimeout:fn => {timers.set(++id,fn);return id},clearTimeout:id => timers.delete(id)},
  })
  return {text,effects,timers,updates}
}
test('streaming typewriter keeps the unfinished Latin tail hidden and cleans timers', () => {
  const {text,effects,timers} = fixture()
  const result = text.Typewriter({text:'你好 hello',pending:true,instant:true})
  assert.equal(run(result,'shown'),'你好 ')
  assert.equal(run(result,'rest'),'hello')
  const cleanups = effects.map(fn => fn()).filter(Boolean)
  assert.equal(timers.size,1)
  cleanups.forEach(fn => fn())
  assert.equal(timers.size,0)
})
test('skin stepped text obeys reduced motion and photosensitive settings', () => {
  const {text} = fixture()
  const skin = {textFx:{reveal:'hop',charsPerStep:1},photosensitive:true}
  assert.equal(text.Typewriter({text:'你好',skin,photosensitive:false}).props['data-skin-reveal'],'hop')
  assert.equal(text.Typewriter({text:'你好',skin,photosensitive:false,reducedMotion:true}).props['data-skin-reveal'],undefined)
  assert.equal(text.Typewriter({text:'你好',skin,photosensitive:true}).props['data-skin-reveal'],undefined)
})
