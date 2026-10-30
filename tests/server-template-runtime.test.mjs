import test from 'node:test'
import assert from 'node:assert/strict'
import { createServerTemplateRuntime } from '../tavern-plugin/lib/domain/server-template-runtime.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

function fixture(t, options = {}) {
  const snapshots = new Map(), calls = [], journals = new Map()
  function state(id) {
    if (!snapshots.has(id)) snapshots.set(id, {
      state: { sessionId: id, chatId: id, stateRevision: 0, lifecycleRevision: 0, chat: [], chat_metadata: { variables: {} } },
      environment: { name1: '你', name2: 'Test', this_chid: '0', characters: [{name:'Test',mes_example:'',description:'',personality:'',scenario:'',data:{name:'Test',extensions:{world:'book'}}}],
        extension_settings: { regex: [], variables: { global: {} }, EjsTemplate: { enabled: true } },
        world_names: ['book'], selected_world_info: [], worldbooks: { book: { entries: {} } }, dsh: { model: 'first', regexScripts: [] } }
    })
    return snapshots.get(id)
  }
  const runtime = createServerTemplateRuntime({ ...options, store: { readJson: async path => journals.get(path), writeJson: async (path, value) => journals.set(path, structuredClone(value)) }, rpc: async (method, args) => {
    calls.push({method,args:structuredClone(args)})
    await options.beforeRpc?.(method,args)
    const current = state(args.sessionId)
    if (method === 'getFullPromptTemplateState') return structuredClone(current)
    if (method === 'getPromptTemplateHistory' && options.readHistory) return options.readHistory(args)
    if (method === 'saveFullPromptTemplateSettings') { current.environment.extension_settings.EjsTemplate = structuredClone(args.settings); return {updated:true,settings:args.settings} }
    if (method === 'saveFullPromptTemplateGlobals') { current.environment.extension_settings.variables.global = structuredClone(args.variables); return {updated:true,variables:args.variables} }
    if (method === 'saveFullPromptTemplateState') { current.state=structuredClone(args.state); return {updated:true,state:args.state} }
    if (method === 'countFullTemplateTokens') return {tokens:args.text.length}
    throw Error(method)
  } })
  t.after(() => runtime.dispose())
  return { runtime, state, calls, journals, engine: runtime.forSession('s') }
}

test('cancellation rejects running and queued work without replay', async t => {
  const {engine,runtime} = fixture(t)
  await engine.render('warm')
  const pending=Promise.allSettled([engine.render('<% await new Promise(r => setTimeout(r,30000)) %>'),engine.render('<% window.mustNotRun=true %>')])
  setTimeout(()=>runtime.cancel('s'),50)
  assert.deepEqual((await pending).map(r=>r.status),['rejected','rejected'])
  assert.equal((await engine.render('<%= typeof window.mustNotRun %>')).text,'undefined')
})

test('no agent turn end cancels the shared template process another task is rendering in', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  let armed = false
  const {engine} = fixture(t,{beforeRpc:async method=>{
    if (armed && method === 'getFullPromptTemplateState') { entered.resolve(); await release.promise }
  }})
  await engine.render('warm')
  armed = true
  const pending = engine.render('settled')
  await entered.promise
  const hooks = new Map()
  registerTurnLifecycleHooks({ctx:{on:(name,fn)=>hooks.set(name,fn)},
    backgroundAgentRunner:{owns:id=>id==='director',requestContext:()=>({parentSessionId:'s',task:'stage-director'})},
    clearRuntimePresetRequestState:()=>{},userMessageForTurn:()=>null,contentText:()=>''})
  // The background director and the game's own foreground turn both end while settlement still renders.
  await hooks.get('agent/turn-stopping')({agent:{session:{id:'director'}},turn:1})
  await hooks.get('agent/turn-stopping')({agent:{session:{id:'s'}},turn:1})
  release.resolve()
  assert.equal((await pending).text,'settled')
  assert.equal((await engine.render('still-alive')).text,'still-alive')
})

test('child cannot inherit host secret env or write arbitrary files', async t => {
  const {engine} = fixture(t)
  process.env.TAVERN_TEST_SECRET='do-not-inherit'
  t.after(()=>delete process.env.TAVERN_TEST_SECRET)
  // Host functions are deliberately probed: jsdom is not a security sandbox.
  const result=await engine.render('<%= structuredClone.constructor("return process")().env.TAVERN_TEST_SECRET || "absent" %>')
  assert.equal(result.text,'absent')
  const denied=await engine.render('<% const p=structuredClone.constructor("return process")(); const fs=p.getBuiltinModule("fs"); fs.writeFileSync("/tmp/template-escape-test","bad") %>')
  assert.equal(denied.ok,false)
  assert.match(denied.error,/Access to this API has been restricted|access denied/i)
})

test('bounded process pool queues concurrent chats instead of failing the fifth chat', async t => {
  const {runtime}=fixture(t,{maxSessions:1})
  const results=await Promise.all(['a','b','c'].map(id=>runtime.forSession(id).render('<% await new Promise(r=>setTimeout(r,20)) %>'+id)))
  assert.deepEqual(results.map(r=>r.text),['a','b','c'])
})

test('display worker failures preserve bounded redacted stderr without replay or false OOM claims', async t => {
  const diagnostics = []
  const { engine, runtime, journals } = fixture(t, { onDiagnostic: value => diagnostics.push(value) })
  await assert.rejects(engine.renderProjection('<% const p=structuredClone.constructor("return process")();await new Promise(resolve=>p.stderr.write("x".repeat(20000)+"\\nfixture crash\\nAuthorization: Bearer fake-worker-secret\\n",resolve));p.exit(42) %>'), error => {
    assert.equal(error.code, 'FULL_TEMPLATE_WORKER_EXIT')
    return true
  })
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].outOfMemory, false)
  assert.equal(diagnostics[0].exitCode, 42)
  assert.match(diagnostics[0].stderr, /fixture crash/)
  assert.ok(diagnostics[0].stderr.length <= 8192, 'stderr remains bounded even when the worker floods it')
  assert.doesNotMatch(diagnostics[0].stderr, /fake-worker-secret/)
  assert.match(diagnostics[0].stderr, /REDACTED/)
  const journal = [...journals.values()].at(-1)
  assert.equal(journal.transient, true)
  assert.equal(journal.phase, 'interrupted')
  assert.equal((await runtime.inspect('s')).task.workerDiagnostic.exitCode, 42)
})
