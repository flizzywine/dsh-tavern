import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageViews} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/views.cjs')

for (const disposal of ['react', 'plugin', 'plugin-with-error']) test(`stage host cleans portal and listeners via ${disposal}`, () => {
  let failUnlock = false
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
    galEscapeLock:on => { events.push(on ? 'lock' : 'unlock'); if (!on && failUnlock) throw new Error('unlock failed') },
    galCoverChat:() => events.push('cover'), galUncover:() => events.push('uncover'),
    galLeave:() => events.push('leave'),
  }
  const React = {
    Component:class {constructor(props){this.props=props}},
    useSyncExternalStore:(_,get) => get(),
    useState:() => [null,()=>{}],
    useLayoutEffect:fn => effects.push(fn), useEffect:fn => effects.push(fn),
    createElement:(type,props,...children)=>typeof type==='function' ? type.prototype?.render ? new type({...props,children}).render() : type(props) : null,
  }
  const views = createStageViews({React,ReactDOM:{flushSync:fn => fn()},window,document,navigation,
    useBubbles:() => ({cardPath:'card',config:{enabled:true}}),useGalEntryLoader:() => 'ready'})
  views.Host({sessionId:'s'})
  for (const effect of effects) cleanups.push(effect())
  assert.deepEqual(events,['mount','cover','lock'])
  const lateResize = windowListeners.get('resize'), lateFullscreen = documentListeners.get('fullscreenchange')
  lateResize()
  document.fullscreenElement = null
  documentListeners.get('fullscreenchange')()
  assert.equal(events.filter(value => value === 'menu').length,1)
  failUnlock = disposal === 'plugin-with-error'
  if (disposal === 'plugin-with-error') assert.throws(() => views.dispose(), /Stage host cleanup failed/)
  else if (disposal === 'plugin') views.dispose()
  for (const cleanup of cleanups) cleanup()
  const settled = [...events]
  views.dispose()
  lateResize()
  lateFullscreen()
  assert.deepEqual(events, settled)
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
  entered = null
  views.dispose()
  button.props.onClick()
  assert.equal(entered,null)
  assert.equal(views.Toggle({sessionId:'s'}),null)
})
