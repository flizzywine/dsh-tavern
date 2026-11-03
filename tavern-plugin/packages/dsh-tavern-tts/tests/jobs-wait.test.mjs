import test from 'node:test'
import assert from 'node:assert/strict'
import {createJobs} from '../src/jobs.js'
import {handleSynthesis} from '../src/routes.js'

const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
function fixture({ticket = async () => 'ticket'} = {}) {
  const pending = deferred(), grant = {}, failures = []
  let authorized = true
  const jobs = createJobs({synthesize:() => pending.promise,resolveGrant:() => grant,
    checkGrant:() => {if (!authorized) throw Object.assign(new Error(),{code:'FORBIDDEN'})},ticket,onError:code => failures.push(code)})
  const {requestId} = jobs.submit({text:'line'},{principal:'dsh-browser',scope:'test'})
  const request = (query = '&wait=1',options = {}) => new Request('http://localhost/synthesis/status?requestId='+requestId+query,{headers:{'sec-fetch-site':'same-origin'},...options})
  return {pending,jobs,requestId,request,failures,revoke:() => {authorized=false}}
}

test('waiting HTTP status returns ready on completion; legacy GET remains immediate',async () => {
  const f = fixture()
  try {
    assert.equal((await (await handleSynthesis(f.request(''),f.jobs)).json()).state,'running')
    let returned = false
    const waiting = handleSynthesis(f.request(),f.jobs).then(response => {returned=true;return response.json()})
    await Promise.resolve(); assert.equal(returned,false)
    f.pending.resolve({key:'key',cacheHit:true})
    const result = await waiting
    assert.equal(result.state,'ready'); assert.equal(result.result.ticket,'ticket'); assert.equal(result.result.cacheHit,true)
    assert.equal((await f.jobs.wait(f.requestId,'dsh-browser')).state,'ready')
  } finally {f.jobs.dispose()}
})

test('waiting status wakes on errors, cancellation and plugin disposal',async () => {
  for (const mode of ['error','cancel','dispose']) {
    const f = fixture(), waiting = handleSynthesis(f.request(),f.jobs)
    if (mode === 'error') f.pending.reject(Object.assign(new Error(),{code:'PROVIDER_FAILURE',status:429}))
    if (mode === 'cancel') f.jobs.cancel(f.requestId,'dsh-browser')
    if (mode === 'dispose') f.jobs.dispose()
    const response = await waiting, result = await response.json()
    if (mode === 'error') {assert.equal(result.state,'error');assert.equal(result.status,429);assert.deepEqual(f.failures,['PROVIDER_FAILURE'])}
    if (mode === 'cancel') assert.equal(result.state,'cancelled')
    if (mode === 'dispose') {assert.equal(response.status,410);assert.equal(result.error,'JOB_GONE')}
    f.pending.resolve({key:'late'}); await Promise.resolve(); f.jobs.dispose()
  }
})

test('wait is bounded for long synthesis without creating another synthesis',async () => {
  const f = fixture()
  try {assert.equal((await f.jobs.wait(f.requestId,'dsh-browser')).state,'running')}
  finally {f.jobs.dispose();f.pending.resolve({key:'late'})}
})

test('HTTP abort releases wait and does not cancel shared synthesis; authorization is rechecked',async () => {
  const f = fixture(), abort = new AbortController()
  try {
    const waiting = handleSynthesis(f.request('&wait=1',{signal:abort.signal}),f.jobs)
    abort.abort()
    assert.equal((await (await waiting).json()).error,'ABORTED')
    assert.equal(f.jobs.poll(f.requestId,'dsh-browser').state,'running')
    await assert.rejects(f.jobs.wait(f.requestId,'other'),{code:'JOB_GONE'})
    const revoked = handleSynthesis(f.request(),f.jobs)
    f.revoke();f.pending.resolve({key:'key'})
    assert.equal((await revoked).status,403)
    assert.equal((await handleSynthesis(new Request(f.request().url,{headers:{origin:'http://evil.test'}}),f.jobs)).status,403)
  } finally {f.jobs.dispose()}
})

test('cancellation during ticket creation never republishes ready audio',async () => {
  const ticket = deferred(), entered = deferred(), f = fixture({ticket:() => {entered.resolve();return ticket.promise}})
  try {
    f.pending.resolve({key:'key'})
    await entered.promise
    const waiting = f.jobs.wait(f.requestId,'dsh-browser')
    f.jobs.cancel(f.requestId,'dsh-browser')
    assert.equal((await waiting).state,'cancelled')
    ticket.resolve('late-ticket'); await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.jobs.poll(f.requestId,'dsh-browser').state,'cancelled')
    assert.equal(f.jobs.poll(f.requestId,'dsh-browser').result,undefined)
  } finally {f.jobs.dispose()}
})


test('HTTP submission carries call priority and cancellation to the existing synthesis grant', async () => {
  let seen
  const pending=deferred(), grant={}
  const jobs=createJobs({synthesize:(input,options) => {seen=options; return pending.promise},resolveGrant:() => grant,checkGrant:() => {},ticket:async () => 'ticket'})
  const request = priority => new Request('http://localhost/synthesis', {method:'POST',headers:{'sec-fetch-site':'same-origin','Content-Type':'application/json'},body:JSON.stringify({input:{text:'call'},scope:'card',priority})})
  const response=await handleSynthesis(request('call'),jobs), result=await response.json()
  assert.equal(response.status,202); assert.equal(seen.priority,'call'); assert.equal(seen.grant,grant)
  jobs.cancel(result.requestId,'dsh-browser'); assert.equal(seen.signal.aborted,true)
  const invalid=await handleSynthesis(request('urgent'),jobs); assert.equal(invalid.status,400)
  pending.resolve({key:'late'}); jobs.dispose()
})
