import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'

const input = { baseURL: 'https://example.org/v1', apiKey: 'fixture-private-key', model: 'image-test', prompt: 'A window' }
test('provider rejection retains actionable details but not echoed credentials or unrelated response data', async () => {
  await assert.rejects(generateSceneImage(input, { fetch: async () => Response.json({
    error: { message: 'Unsupported size; key=fixture-private-key Bearer other-private-token', param: 'size', code: 'invalid_parameter' },
    debug: 'private response data'
  }, { status: 400 }) }), error => {
    assert.match(error.message, /HTTP 400.*Unsupported size/s)
    assert.equal(error.imageFailure.param, 'size')
    assert.equal(error.imageFailure.code, 'invalid_parameter')
    assert.equal(error.imageOutcome, 'rejected')
    assert.doesNotMatch(JSON.stringify({message: error.message, failure: error.imageFailure}), /fixture-private-key|other-private-token|private response data/)
    return true
  })
})
test('malformed, HTML and oversized error bodies remain bounded, never mask the HTTP status', async () => {
  for (const body of ['<html>private debug</html>', '{', 'x'.repeat(20000)]) {
    await assert.rejects(generateSceneImage(input, { fetch: async () => new Response(body, {status: 401}) }), error => {
      assert.match(error.message, /HTTP 401/)
      assert.ok(error.message.length < 1000)
      assert.doesNotMatch(error.message, /private debug/)
      return true
    })
  }
})
