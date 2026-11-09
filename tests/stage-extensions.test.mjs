import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createStageExtensions} from '../tavern-plugin/packages/dsh-tavern-stage/lib/stage-extensions.js'
import {createExtensionRequests} from '../tavern-plugin/lib/domain/extension-requests.js'
const require=createRequire(import.meta.url)
const {createStageFeatures}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/features.cjs')
const {createStageViewScope}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/view-scope.cjs')

test('stage extension dependencies and routes have one owner and preserve request authority',async()=>{
 const extensions=createStageExtensions(),requests=createExtensionRequests(),disposed=[]
 const remove=extensions.register('unused',()=>{throw Error('removed')});remove()
 extensions.register('timer',core=>({deps:{timer:core.clock},requests:{methods:['readClock'],call:(method,args,authority)=>({clock:core.clock,authority})},dispose:()=>disposed.push('timer')}))
 const deps=extensions.start({clock:42})
 assert.equal(deps.timer,42)
 assert.throws(()=>extensions.register('late',()=>({})),/already started/)
 extensions.bind(requests)
 const authority={origin:'https://game.test'}
 assert.deepEqual(await requests.call('readClock',{},authority),{clock:42,authority})
 extensions.dispose();extensions.dispose()
 assert.equal(requests.handles('readClock'),false)
 assert.deepEqual(disposed,['timer'])
})

test('client features own views and CSS in each scope, including failed mount rollback',()=>{
 const features=createStageFeatures(),styles=new Set(),disposed=[]
 const document={head:{appendChild:style=>styles.add(style)},createElement:()=>({dataset:{},remove(){styles.delete(this)}})}
 const remove=features.register('clock',{css:'.clock{}',views:({own,options})=>({timer:own({value:options.time,dispose:()=>disposed.push(options.time)})})})
 assert.throws(()=>features.register('clock',{}),/already registered/)
 const mount=time=>createStageViewScope(own=>{const views={};features.mount({own,views,options:{time},document});return views})
 const first=mount(1),second=mount(2)
 assert.equal(first.timer.value,1);assert.equal(second.timer.value,2);assert.equal(styles.size,2)
 first.dispose();assert.equal(styles.size,1)
 const off=features.register('broken',{views(){throw Error('broken')}})
 assert.throws(()=>mount(3),/broken/)
 assert.equal(styles.size,1);assert.deepEqual(disposed,[1,3])
 off();remove();second.dispose();assert.equal(styles.size,0)
 assert.equal(mount(4).timer,undefined)
})
