import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { bodyGenerationFailure } from '../tavern-plugin/lib/domain/body-generation-failure.js'
const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-ui.js', import.meta.url), 'utf8')
const format = vm.runInNewContext(source.slice(0, source.indexOf('function createAssetPackUI')) + '\nplayerErrorText', {console:{warn(){}}})
test('structured summary keeps mixed-language reason and HTTP diagnostics', () => {
  const failure = bodyGenerationFailure({code:'STCONTEXT_PROVIDER',stage:'response',message:'Gemini 回包缺少唯一候选',details:{httpStatus:400}})
  const text = format({failure}, {fallback:'重新生成没有完成'})
  assert.match(text, /Gemini 回包缺少唯一候选/)
  assert.match(text, /HTTP 400/)
  assert.match(text, /STCONTEXT_PROVIDER/)
  assert.match(format({failure:bodyGenerationFailure({code:'STCONTEXT_CONTENT_FILTER',message:'Provider content_filter'})}), /审核拦截/)
  assert.match(format({failure:bodyGenerationFailure(new Error('插件正文生成超时'))}), /插件正文生成超时/)
  assert.doesNotMatch(format({failure:bodyGenerationFailure(new Error('插件正文生成超时'))}), /保存超时/)
})
test('bounded public failure drops private metadata, raw responses and credentials', () => {
  const failure = bodyGenerationFailure({code:'CUSTOM',stage:'response',message:'服务失败：Bearer very-secret-token\nresponse: {"story":"PRIVATE-STORY"}',details:{httpStatus:400,providerCode:'bad_request',finishReason:'stop',response:'PRIVATE',headers:{Authorization:'PRIVATE'}},cause:{prompt:'PRIVATE'}})
  assert.doesNotMatch(JSON.stringify(failure), /very-secret-token|PRIVATE|Authorization|headers|cause/)
  assert.deepEqual(failure.details, {httpStatus:400,providerCode:'bad_request',finishReason:'stop'})
  assert.ok(bodyGenerationFailure(new Error('中'.repeat(5000))).message.length <= 500)
  assert.equal(bodyGenerationFailure('旧版中文原因').message, '旧版中文原因')
})

test('known plugin failures all retain an actionable Chinese reason in the player UI', () => {
  for (const [code, expected] of [['X_CONTENT_FILTER',/审核/],['X_CONTEXT_OVERFLOW',/上下文容量/],['X_OUTPUT_LIMIT',/输出长度限制/],['X_EMPTY',/没有返回正文/],['X_REASONING_ONLY',/只返回了思考/],['ECONNRESET',/网络/],['X_TIMEOUT',/插件正文生成超时/],['X_PRESET',/预设处理失败/]]) {
    const failure = bodyGenerationFailure({code, stage:'response',message:'Provider failure'});
    const text = format({failure}, {fallback:'重新生成没有完成'});
    assert.match(text, expected); assert.ok(text.includes(code));
  }
})
