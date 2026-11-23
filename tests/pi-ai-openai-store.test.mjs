import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PI_AI_OPENAI_STORE_MARKER, patchPiAiOpenAIStoreSource } from '../tavern-plugin/lib/domain/pi-ai-openai-store.js'
import { patchPiAiOpenAIStore } from '../bin/pi-ai-nonstream-patch.mjs'

// pi-ai 1.1.0's detection, trimmed to the lines the patch and the assertions touch.
const fixture = `function detectCompat(model) {
    const provider = model.provider;
    const baseUrl = model.baseUrl;
    const isNonStandard = provider === "cerebras" || baseUrl.includes("cerebras.ai");
    return {
        supportsStore: !isNonStandard,
        supportsDeveloperRole: !isNonStandard,
    };
}
`

/** Evaluate a source's `detectCompat` for one model. */
function detect(source, model) {
  const start = source.indexOf('function detectCompat(model) {')
  const end = source.indexOf('\n}\n', start)
  return new Function(source.slice(start, end + 3) + '; return detectCompat')()(model)
}

const gemini = { provider: 'googleofficial', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', id: 'models/gemini-4-neon' }

test('OpenAI 兼容渠道默认不发 store；补丁幂等，源码漂移时不改', () => {
  assert.equal(detect(fixture, gemini).supportsStore, true)
  const applied = patchPiAiOpenAIStoreSource(fixture)
  assert.equal(applied.status, 'applied')
  assert.equal(detect(applied.text, gemini).supportsStore, false)
  assert.equal(detect(applied.text, gemini).supportsDeveloperRole, true, 'only store changes')
  assert.deepEqual(patchPiAiOpenAIStoreSource(applied.text), { status: 'patched', text: applied.text })
  assert.equal(patchPiAiOpenAIStoreSource(fixture.replace('!isNonStandard,\n        supportsDeveloperRole', 'true,\n        supportsDeveloperRole')).status, 'unmatched')
})

test('安装补丁写入 pi-ai 一次，再跑不改；不是 pi-ai 时不写', t => {
  const sdk = mkdtempSync(path.join(tmpdir(), 'pi-ai-store-')); t.after(() => rmSync(sdk, { recursive: true, force: true }))
  mkdirSync(path.join(sdk, 'dist', 'api'), { recursive: true })
  const api = path.join(sdk, 'dist', 'api', 'openai-completions.js')
  writeFileSync(api, fixture)
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'other' }))
  assert.equal(patchPiAiOpenAIStore({ sdkDirectory: sdk }), null)
  assert.equal(readFileSync(api, 'utf8'), fixture)
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai' }))
  assert.equal(patchPiAiOpenAIStore({ sdkDirectory: sdk }), true)
  assert.ok(readFileSync(api, 'utf8').includes(PI_AI_OPENAI_STORE_MARKER))
  assert.equal(patchPiAiOpenAIStore({ sdkDirectory: sdk }), false)
})

// The installation's own runtime: a pi-ai upgrade that reshapes detection fails here instead of quietly sending store again.
test('本机运行时的 pi-ai 仍能打上 store 补丁', t => {
  const file = path.join(fileURLToPath(new URL('..', import.meta.url)), 'runtime-official', 'resources', 'app', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'api', 'openai-completions.js')
  if (!existsSync(file)) return t.skip('no official runtime on this machine')
  const result = patchPiAiOpenAIStoreSource(readFileSync(file, 'utf8'))
  assert.notEqual(result.status, 'unmatched', 'pi-ai openai-completions detectCompat changed shape; update tavern-plugin/lib/domain/pi-ai-openai-store.js')
  assert.equal(detect(result.text, gemini).supportsStore, false)
})
