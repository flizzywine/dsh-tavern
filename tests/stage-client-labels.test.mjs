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
// A figure with no voice picked yet (an author's pack with only a voice description) is no service
// failure: the plate names her and where to pick one, and its button opens her 声音 page instead of retrying.
test('name plate: a figure with no voice picked says who and where, and opens her voice page', () => {
  const labels = createStageLabels({
    React:{useRef:() => ({current:null}),useLayoutEffect:()=>{},createElement:(type,props,...children) => ({type,props,children})},
  })
  const calls = []
  const plate = (voiceError, onOpenVoice) => labels.NamePlate({name:'林夏',voiceState:'error',voiceError,onReplay:() => calls.push('replay'),onOpenVoice}).children.find(child => child?.props?.className === 'fork-gal-voice')
  const open = plate('VOICE_UNSET', () => calls.push('open'))
  assert.equal(open.props['aria-label'],'林夏还没选声音，去 素材包 › 林夏 › 声音 选一个（点击打开）')
  open.props.onClick({stopPropagation() {}})
  assert.deepEqual(calls,['open'])
  assert.equal(plate('VOICE_UNSET').props['aria-label'],'林夏还没选声音，去 素材包 › 林夏 › 声音 选一个。','no way to open it: the sentence alone')
  // her voice chosen but its service not set up keeps the 语音后端 sentence and retries
  const service = plate('SERVICE_REQUIRED', () => calls.push('open'))
  assert.match(service.props['aria-label'],/^配音失败：还没有可用的语音服务.*点击重试$/)
  service.props.onClick({stopPropagation() {}})
  assert.deepEqual(calls,['open','replay'])
})
