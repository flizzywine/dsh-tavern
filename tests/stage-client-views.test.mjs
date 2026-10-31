import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageViews} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/views.cjs')

test('stage host owns fullscreen listeners, portal mount and transcript cleanup', () => {
  const effects = [], cleanups = [], events = [], documentListeners = new Map(), windowListeners = new Map()
  const document = {
    fullscreenElement:{},
    createElement:() => ({remove:() => events.push('remove')}),
    body:{appendChild:() => events.push('mount')},
    addEventListener:(name,fn) => documentListeners.set(name,fn),
    removeEventListener:(name,fn) => {assert.equal(documentListeners.get(name),fn); documentListeners.delete(name)},
  }
  const window = {
    screen:{width:100,height:100}, outerWidth:80, outerHeight:100,
    addEventListener:(name,fn) => windowListeners.set(name,fn),
    removeEventListener:(name,fn) => {assert.equal(windowListeners.get(name),fn); windowListeners.delete(name)},
  }
  const navigation = {
    galStageAvailable:{get:() => true}, galActive:{get:() => 's'}, galMenuRequest:{request:() => events.push('menu')},
    galEscapeLock:on => events.push(on ? 'lock' : 'unlock'),
    galCoverChat:() => events.push('cover'), galUncover:() => events.push('uncover'),
    galLeave:() => events.push('leave'),
  }
  const React = {
    useSyncExternalStore:(_,get) => get(),
    useState:() => [null,()=>{}],
    useLayoutEffect:fn => effects.push(fn), useEffect:fn => effects.push(fn),
    createElement:()=>{},
  }
  const views = createStageViews({React,ReactDOM:{flushSync:fn => fn()},window,document,navigation,
    useBubbles:() => ({cardPath:'card',config:{enabled:true}}),useGalEntryLoader:() => 'ready'})
  views.Host({sessionId:'s'})
  for (const effect of effects) cleanups.push(effect())
  assert.deepEqual(events,['mount','cover','lock'])
  windowListeners.get('resize')()
  document.fullscreenElement = null
  documentListeners.get('fullscreenchange')()
  assert.equal(events.filter(value => value === 'menu').length,1)
  for (const cleanup of cleanups) cleanup()
  assert.equal(documentListeners.size,0)
  assert.equal(windowListeners.size,0)
  assert.deepEqual(events.slice(-4),['unlock','remove','uncover','leave'])
})

test('stage toggle is absent for ordinary cards and enters the selected session', () => {
  let available = false, entered
  const views = createStageViews({
    React:{useSyncExternalStore:(_,get) => get(),createElement:(type,props,...children) => ({type,props,children})},
    navigation:{galStageAvailable:{get:() => true},galActive:{get:() => ''},galEnter:id => {entered=id}},
    useBubbles:() => ({cardPath:'card',config:{enabled:available}}),
  })
  assert.equal(views.Toggle({sessionId:'s'}),null)
  available = true
  const button = views.Toggle({sessionId:'s'})
  assert.equal(button.type,'button')
  button.props.onClick()
  assert.equal(entered,'s')
})
