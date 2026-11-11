import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { bodyGenerationFailure } from '../tavern-plugin/lib/domain/body-generation-failure.js'
const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-ui.js', import.meta.url), 'utf8')
const format = vm.runInNewContext(source.slice(0, source.indexOf('function createAssetPackUI')) + '\nplayerErrorText', {console:{warn(){}}})
test('bounded public failure drops private metadata, raw responses and credentials', () => {
  const failure = bodyGenerationFailure({code:'CUSTOM',stage:'response',message:'服务失败：Bearer very-secret-token\nresponse: {"story":"PRIVATE-STORY"}',details:{httpStatus:400,providerCode:'bad_request',finishReason:'stop',response:'PRIVATE',headers:{Authorization:'PRIVATE'}},cause:{prompt:'PRIVATE'}})
  assert.doesNotMatch(JSON.stringify(failure), /very-secret-token|PRIVATE|Authorization|headers|cause/)
  assert.deepEqual(failure.details, {httpStatus:400,providerCode:'bad_request',finishReason:'stop'})
  assert.ok(bodyGenerationFailure(new Error('中'.repeat(5000))).message.length <= 500)
  assert.equal(bodyGenerationFailure('旧版中文原因').message, '旧版中文原因')
})
