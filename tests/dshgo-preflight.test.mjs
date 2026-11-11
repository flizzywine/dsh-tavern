import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { checkBundles, preflightHint } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/preflight.js'
import { TAVERN_BUNDLES } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

function fakeSpawn(payload, options = {}) {
  const calls = []
  const spawn = (command, args, spawnOptions) => {
    calls.push({ command, args, spawnOptions })
    return { status: 0, stdout: typeof payload === 'string' ? payload : `${JSON.stringify(payload)}\n`, stderr: options.stderr ?? '', error: options.error }
  }
  return { spawn, calls }
}

test('checkBundles：全部能加载 → ok，stderr 里的杂音不影响', () => {
  const { spawn, calls } = fakeSpawn({ ok: true, skipped: [] }, { stderr: 'warning: something\n' })
  const result = checkBundles({ dshHome: '/root/.dsh', spawn })
  assert.deepEqual(result, { state: 'ok', fatal: [], ignored: [], error: null })
  assert.equal(calls[0].args[1], '/opt/dsh')
  assert.equal(calls[0].args[2], join('/root/.dsh', 'profiles', 'web'))
})

test('checkBundles：酒馆的包被跳过 → fatal，带原因', () => {
  const { spawn } = fakeSpawn({ ok: true, skipped: [{ packageName: 'dsh-tavern-plugin', reason: 'cannot resolve' }] })
  const result = checkBundles({ dshHome: '/root/.dsh', spawn })
  assert.equal(result.state, 'fatal')
  assert.deepEqual(result.fatal, [{ packageName: 'dsh-tavern-plugin', reason: 'cannot resolve' }])
})

test('checkBundles：跳过的是用户自己的插件 → 只记进 ignored，不拦启用', () => {
  const { spawn } = fakeSpawn({ ok: true, skipped: [{ packageName: 'dsh-user-thing', reason: 'missing' }] })
  const result = checkBundles({ dshHome: '/root/.dsh', spawn })
  assert.equal(result.state, 'ok')
  assert.deepEqual(result.ignored, ['dsh-user-thing'])
})

test('checkBundles：输出不是 JSON / 进程出错 / loader 报错 → unknown，不冒充 ok', () => {
  assert.equal(checkBundles({ dshHome: '/root/.dsh', spawn: fakeSpawn('not json').spawn }).state, 'unknown')
  const errored = checkBundles({ dshHome: '/root/.dsh', spawn: fakeSpawn('', { error: new Error('ETIMEDOUT') }).spawn })
  assert.equal(errored.state, 'unknown')
  assert.match(errored.error, /ETIMEDOUT/)
  const refused = checkBundles({ dshHome: '/root/.dsh', spawn: fakeSpawn({ ok: false, error: '没有 loadProfileDirectory' }).spawn })
  assert.equal(refused.state, 'unknown')
  assert.match(refused.error, /loadProfileDirectory/)
})

test('checkBundles：只取最后一行 JSON，前面允许有 loader 的日志', () => {
  const { spawn } = fakeSpawn('boot log\n{"ok":true,"skipped":[]}\n')
  assert.equal(checkBundles({ dshHome: '/root/.dsh', spawn }).state, 'ok')
})

test('preflightHint：三种状态都可读，unknown 说清是没验成', () => {
  assert.match(preflightHint({ state: 'ok', fatal: [], ignored: [], error: null }, true), /8 个 bundle/)
  assert.match(preflightHint({ state: 'fatal', fatal: [{ packageName: 'dsh-tavern-tts', reason: 'x' }], ignored: [], error: null }, true), /dsh-tavern-tts/)
  assert.match(preflightHint({ state: 'unknown', fatal: [], ignored: [], error: '超时' }, true), /超时/)
})

test('preflight-worker.mjs 就在包里，能被 checkBundles 定位到', () => {
  const worker = join(import.meta.dirname, '..', 'tavern-plugin', 'packages', 'dsh-tavern-dshgo', 'lib', 'preflight-worker.mjs')
  assert.ok(existsSync(worker))
})

/** 真跑一次宿主 loader（本机装了 DSH 时才有意义），证明调用签名没写错。 */
test('真实 loader：仓库根这个 profile 的八个 bundle 都能加载', { skip: process.env.DSH_TAVERN_SKIP_REAL_LOADER === '1' }, (t) => {
  const runtime = process.env.DSH_TAVERN_TEST_RUNTIME
  if (runtime === undefined || !existsSync(join(runtime, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'))) {
    t.skip('没有设置 DSH_TAVERN_TEST_RUNTIME')
    return
  }
  const child = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'tavern-plugin', 'packages', 'dsh-tavern-dshgo', 'lib', 'preflight-worker.mjs'), runtime, join(import.meta.dirname, '..')], { encoding: 'utf8', timeout: 60000 })
  const parsed = JSON.parse(String(child.stdout).trim().split('\n').at(-1))
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.skipped.filter(item => TAVERN_BUNDLES.includes(item.packageName)), [])
})
