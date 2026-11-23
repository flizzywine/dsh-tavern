import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PI_AI_GOOGLE_STOP_REASON_MARKER, patchPiAiGoogleStopReasonSource } from '../tavern-plugin/lib/domain/pi-ai-google-stop-reason.js'
import { patchPiAiGoogleStopReason } from '../bin/pi-ai-nonstream-patch.mjs'

// pi-ai 1.1.0's mapStopReason, trimmed to the cases the assertions touch.
const fixture = `export function mapStopReason(reason) {
    switch (reason) {
        case "STOP":
            return "stop";
        case "MALFORMED_FUNCTION_CALL":
            return "error";
        default: {
            const _exhaustive = reason;
            throw new Error(\`Unhandled stop reason: \${_exhaustive}\`);
        }
    }
}
`

/** Evaluate a source's `mapStopReason`. */
function mapper(source) {
  const start = source.indexOf('export function mapStopReason(reason) {')
  const end = source.indexOf('\n}\n', start)
  return new Function(source.slice(start + 'export '.length, end + 3) + '; return mapStopReason')()
}

test('Gemini 新增的结束原因按报错处理，不再抛 Unhandled stop reason；补丁幂等，源码漂移时不改', () => {
  assert.throws(() => mapper(fixture)('MALFORMED_RESPONSE'), /Unhandled stop reason/)
  const applied = patchPiAiGoogleStopReasonSource(fixture)
  assert.equal(applied.status, 'applied')
  assert.equal(mapper(applied.text)('MALFORMED_RESPONSE'), 'error')
  assert.equal(mapper(applied.text)('STOP'), 'stop')
  assert.deepEqual(patchPiAiGoogleStopReasonSource(applied.text), { status: 'patched', text: applied.text })
  assert.equal(patchPiAiGoogleStopReasonSource('unknown').status, 'unmatched')
})

test('安装补丁写入 pi-ai 一次，再跑不改；不是 pi-ai 时不写', t => {
  const sdk = mkdtempSync(path.join(tmpdir(), 'pi-ai-stop-')); t.after(() => rmSync(sdk, { recursive: true, force: true }))
  mkdirSync(path.join(sdk, 'dist', 'api'), { recursive: true })
  const file = path.join(sdk, 'dist', 'api', 'google-shared.js')
  writeFileSync(file, fixture)
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'other' }))
  assert.equal(patchPiAiGoogleStopReason({ sdkDirectory: sdk }), null)
  writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai' }))
  assert.equal(patchPiAiGoogleStopReason({ sdkDirectory: sdk }), true)
  assert.ok(readFileSync(file, 'utf8').includes(PI_AI_GOOGLE_STOP_REASON_MARKER))
  assert.equal(patchPiAiGoogleStopReason({ sdkDirectory: sdk }), false)
})

// The installation's own runtime: a pi-ai upgrade that reshapes the mapping fails here instead of crashing on new reasons again.
test('本机运行时的 pi-ai 仍能打上结束原因补丁', t => {
  const file = path.join(fileURLToPath(new URL('..', import.meta.url)), 'runtime-official', 'resources', 'app', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'api', 'google-shared.js')
  if (!existsSync(file)) return t.skip('no official runtime on this machine')
  const result = patchPiAiGoogleStopReasonSource(readFileSync(file, 'utf8'))
  assert.notEqual(result.status, 'unmatched', 'pi-ai google-shared mapStopReason changed shape; update tavern-plugin/lib/domain/pi-ai-google-stop-reason.js')
})
