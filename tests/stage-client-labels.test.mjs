import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageLabels} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/labels.cjs')
test('name plate fitting cancels pending frames and ignores late font readiness', async () => {
  const effects = [], frames = new Map()
  let ready, observe, disconnected = false, reads = 0
  const node = {parentElement:{},style:{},offsetWidth:100,getBoundingClientRect:() => {reads++;return {width:50}}}
  const labels = createStageLabels({
    React:{useRef:() => ({current:node}),useLayoutEffect:fn => effects.push(fn),createElement:()=>{}},
    document:{fonts:{ready:new Promise(resolve => {ready=resolve})}},
    getComputedStyle:() => ({writingMode:'horizontal-tb'}),
    ResizeObserver:class {constructor(fn) {observe=fn} observe() {} disconnect() {disconnected=true}},
    requestAnimationFrame:fn => {frames.set(1,fn);return 1},
    cancelAnimationFrame:id => frames.delete(id),
  })
  labels.NamePlate({name:'名字'})
  const stop = effects[0]()
  observe()
  assert.equal(frames.size,1)
  stop()
  assert.equal(frames.size,0)
  assert.equal(disconnected,true)
  const before = reads
  ready(); await Promise.resolve()
  assert.equal(reads,before)
})
test('name plate preserves alias splitting and voice retry action', () => {
  const labels = createStageLabels({
    React:{useRef:() => ({current:null}),useLayoutEffect:()=>{},createElement:(type,props,...children) => ({type,props,children})},
  })
  assert.deepEqual(labels.nameParts('司徒明月',{aliases:['月','明月']}),['司','徒','明','月'])
  let replayed = 0, stopped = 0
  const result = labels.NamePlate({name:'司徒明月',classic:true,voiceState:'error',voiceError:'TIMEOUT',onReplay:() => replayed++})
  const button = result.children[1]
  assert.match(button.props['aria-label'],/配音请求超时/)
  button.props.onClick({stopPropagation:() => stopped++})
  assert.equal(replayed,1)
  assert.equal(stopped,1)
})
