import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PI_AI_GOOGLE_TOOL_MODE_MARKER, patchPiAiGoogleToolModeSource } from '../tavern-plugin/lib/domain/pi-ai-google-tool-mode.js'
import { patchPiAiGoogleToolMode } from '../bin/pi-ai-nonstream-patch.mjs'

// pi-ai 1.1.0's resolveGoogleFunctionCallingMode with the helpers it calls, trimmed.
const fixture = `const FunctionCallingConfigMode = { AUTO: "AUTO", ANY: "ANY", NONE: "NONE", VALIDATED: "VALIDATED" };
const resolveJsonSchemaStrictSampling = (tool, supported) => supported && tool.strict === true ? true : undefined;
export function mapToolChoice(choice) {
    switch (choice) {
        case "auto":
            return FunctionCallingConfigMode.AUTO;
        case "none":
            return FunctionCallingConfigMode.NONE;
        case "any":
            return FunctionCallingConfigMode.ANY;
        default:
            return FunctionCallingConfigMode.AUTO;
    }
}
export function resolveGoogleFunctionCallingMode(tools, toolChoice, supportsStrictMode) {
    const useStrictMode = tools.some((tool) => resolveJsonSchemaStrictSampling(tool, supportsStrictMode) === true);
    if (toolChoice === "none" || toolChoice === "any") {
        return mapToolChoice(toolChoice);
    }
    if (useStrictMode) {
        return FunctionCallingConfigMode.VALIDATED;
    }
    return toolChoice ? mapToolChoice(toolChoice) : undefined;
}
`

const resolver = source => new Function(source.replaceAll('export function', 'function') + '; return resolveGoogleFunctionCallingMode')()

test('Gemini 3 以上没指定工具选择时默认约束生成；指定了的照旧，旧模型不变；补丁幂等，源码漂移时不改', () => {
  const tools = [{ name: 't' }]
  assert.equal(resolver(fixture)(tools, undefined, true), undefined)
  const applied = patchPiAiGoogleToolModeSource(fixture)
  assert.equal(applied.status, 'applied')
  const mode = resolver(applied.text)
  assert.equal(mode(tools, undefined, true), 'VALIDATED')
  assert.equal(mode(tools, undefined, false), undefined, 'Gemini 2 and older keep the provider default')
  assert.equal(mode(tools, 'any', true), 'ANY')
  assert.equal(mode(tools, 'none', true), 'NONE')
  assert.equal(mode(tools, 'auto', true), 'AUTO')
  assert.deepEqual(patchPiAiGoogleToolModeSource(applied.text), { status: 'patched', text: applied.text })
  assert.equal(patchPiAiGoogleToolModeSource('unknown').status, 'unmatched')
})

test('安装补丁写入 pi-ai 一次，再跑不改；不是 pi-ai 时不写', t => {
  const sdk = mkdtempSync(path.join(tmpdir(), 'pi-ai-mode-')); t.after(() => rmSync(sdk, { recursive: true, force: true }))
  mkdirSync(path.join(sdk, 'dist', 'api'), { recursive: true })
  const file = path.join(sdk, 'dist', 'api', 'google-shared.js')
  writeFileSync(file, fixture)
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'other' }))
  assert.equal(patchPiAiGoogleToolMode({ sdkDirectory: sdk }), null)
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai' }))
  assert.equal(patchPiAiGoogleToolMode({ sdkDirectory: sdk }), true)
  assert.ok(readFileSync(file, 'utf8').includes(PI_AI_GOOGLE_TOOL_MODE_MARKER))
  assert.equal(patchPiAiGoogleToolMode({ sdkDirectory: sdk }), false)
})

// The installation's own runtime: a pi-ai upgrade that reshapes the function fails here instead of silently dropping rounds again.
test('本机运行时的 pi-ai 仍能打上工具调用约束补丁', t => {
  const file = path.join(fileURLToPath(new URL('..', import.meta.url)), 'runtime-official', 'resources', 'app', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'api', 'google-shared.js')
  if (!existsSync(file)) return t.skip('no official runtime on this machine')
  const result = patchPiAiGoogleToolModeSource(readFileSync(file, 'utf8'))
  assert.notEqual(result.status, 'unmatched', 'pi-ai resolveGoogleFunctionCallingMode changed shape; update tavern-plugin/lib/domain/pi-ai-google-tool-mode.js')
})
