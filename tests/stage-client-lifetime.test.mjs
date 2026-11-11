import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const {startStageClientLifetime} = require('../tavern-plugin/packages/dsh-tavern-stage/lib/client/lifetime.cjs')

for (const phase of ['director','session']) test(`plugin session assembly rolls back failure during ${phase} startup`, () => {
  const calls = [], window = {};
  const views={performanceSurface:{prepare(){}},admission:{shown:{}},progress:{store:{}},sessionRuntime:require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-runtime.cjs').createStageSessionRuntime({
    createModNotifications:require('../tavern-plugin/packages/dsh-tavern-stage/src/client/mod-notifications.cjs').createStageModNotifications,
    createStoreModule:()=>({}),createSessionModule:()=>({createStageSessionOwner:()=>({start(){throw new Error('session failed')},dispose:()=>calls.push('session')})}),
    createResourceModule:()=>({createStageResourceRunner:()=>({dispose:()=>calls.push('runner')})}),
    createDirectorModule:()=>({createStageDirectorSource:()=>{if(phase==='director')throw new Error('director failed');return {dispose:()=>calls.push('director')}}})
  })};
  const sessions=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/sessions.cjs').createStageSessions({views,window,document:{},startLifetime:startStageClientLifetime,
    textIndex:require('../tavern-plugin/packages/dsh-tavern-stage/src/client/text-index.cjs').createStageTextIndexModule({})});
  const inputs={native:{sessions:{}},io:{},assets:{createOwner:()=>({dispose:()=>calls.push('assets')})},dialogue:{},text:{},performance:{},observation:{}};
  assert.throws(()=>sessions.start(inputs),new RegExp(phase+' failed'));
  assert.deepEqual(calls,phase==='director'?['runner','assets']:['session','director','runner','assets']);
  assert.equal(sessions.owner,null);assert.equal(sessions.resourceOwner,null);assert.equal(window.forkStageResourceDebug,undefined);
  sessions.dispose();
});
