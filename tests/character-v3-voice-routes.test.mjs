// voice publication and grants require the authenticated same-origin carrier.
import test from 'node:test'
import assert from 'node:assert/strict'
import {registerTavernHttpRoutes} from '../tavern-plugin/lib/http/routes.js'

test('figure voice routes reject cross-origin and opaque requests before dispatch', async () => {
  let handler
  const calls = [], server = {register(spec) { if (spec.path === '/api/dsh-tavern') handler = spec.handler; return () => {} }}
  registerTavernHttpRoutes({ctx:{get:name => name === 'connection' ? {requestRejection:() => undefined} : server,effect:fn => fn()},str:String,
    performanceDiagnostics:{http() {}},fontLibrary:{serve:async () => false},runtimeReadiness:Promise.resolve({ok:true}),
    dispatch:async (method,args,authority) => { calls.push({method,authority}); return {} }})
  async function request(method,headers) {
    let status
    await handler({url:'/api/dsh-tavern/' + method,method:'POST',headers:{host:'localhost:43120',...headers},
      async *[Symbol.asyncIterator]() { yield Buffer.from('{}') }},
    {writeHead(value) { status = value },end() {}})
    return status
  }
  for (const method of ['listFigureVoiceChoices','assignFigureVoice','openFigureVoicePreview','closeFigureVoicePreview']) {
    for (const headers of [{origin:'http://localhost:43121'}, {origin:'http://127.0.0.1:43120'},
      {origin:'null'}, {origin:'https://untrusted.invalid'}, {'sec-fetch-site':'cross-site'}]) {
      assert.equal(await request(method,headers),403,method + ' ' + JSON.stringify(headers))
    }
  }
  assert.equal(calls.length,0)
  for (const method of ['listFigureVoiceChoices','assignFigureVoice','openFigureVoicePreview','closeFigureVoicePreview']) {
    assert.equal(await request(method,{origin:'http://localhost:43120','sec-fetch-site':'same-origin'}),200)
  }
  assert.equal(calls.length,4)
  assert.ok(calls.every(call => call.authority.origin === 'http://localhost:43120'))
})
