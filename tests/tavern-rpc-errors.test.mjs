import assert from 'node:assert/strict'
import test from 'node:test'
import { bodyGenerationError } from '../tavern-plugin/lib/domain/body-generation-failure.js'
import { registerTavernHttpRoutes } from '../tavern-plugin/lib/http/routes.js'

for (const typed of [false, true]) test('POST API 保留错误码及有界生成失败契约：' + typed, async () => {
  let handler
  const webServer = { register(route) { if (route.path === '/api/dsh-tavern') handler = route.handler; return () => {} } }
  const original = Object.assign(new Error('脚本写入不属于当前 MVU 结算事件'), {
    code: 'MVU_SETTLEMENT_EVENT_MISMATCH', privateState: 'PRIVATE-STORY'
  })
  const failure = typed ? bodyGenerationError(Object.assign(original, {stage:'response',details:{httpStatus:400,response:'PRIVATE-STORY'}})) : original
  registerTavernHttpRoutes({
    ctx: { get: name => name === 'webServer' ? webServer : { requestRejection: () => undefined }, effect(callback) { callback() } },
    dispatch: async () => { throw failure }, str: value => String(value ?? ''),
    performanceDiagnostics: { http() {} }, runtimeGeneration: 'test-generation',
    runtimeReadiness: Promise.resolve({ ok: true })
  })
  assert.equal(typeof handler, 'function')

  let status, body
  await handler({ url: '/api/dsh-tavern/updateTavernHelperVariables', method: 'POST', headers: { host: 'localhost:3081' },
    async *[Symbol.asyncIterator]() { yield Buffer.from('{}') }
  }, {
    writeHead(value) { status = value },
    end(value) { body = value }
  })

  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(body), { ok: false, error: failure.message, errorCode: failure.code, ...(typed ? {failure:failure.failure} : {}) })
  assert.doesNotMatch(body, /PRIVATE-STORY|stack/)
})
