import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function rpcFor(fetch) {
  const start = source.includes('\t\tasync function readTavernJsonResponse(') ? source.indexOf('\t\tasync function readTavernJsonResponse(') : source.indexOf('\t\tfunction rpc(method,')
  const end = source.indexOf('\n\t\tfunction rpcWithTimeout', start)
  return new Function('fetch', 'tavernRuntimeGenerationMonitor', source.slice(start, end) + ';return rpc')(fetch, { observe() {} })
}
const ok = () => Response.json({ ok: true, status: { phase: 'update-available' } })
const tick = () => new Promise(resolve => setImmediate(resolve))

test('空响应与非 JSON 返回明确错误，认证错误不作为暂时故障重试', async () => {
  for (const [status, body, pattern, retryable] of [[404, '', /404/, true], [200, '', /空响应/, true], [200, '<html>bad</html>', /非 JSON/, true], [401, '', /认证/, false], [403, '', /权限/, false]]) {
    await assert.rejects(rpcFor(async () => new Response(body, { status }))('getUpdateStatus'), error => {
      assert.match(error.message, pattern)
      assert.equal(error.retryable, retryable)
      return true
    })
  }
})

test('执行更新遇到空响应不能自动再次提交，业务失败保留原消息', async () => {
  let count = 0
  const rpc = rpcFor(async () => { count++; return new Response('', { status: 503 }) })
  await assert.rejects(rpc('startUpdate'))
  assert.equal(count, 1)
  await assert.rejects(rpcFor(async () => Response.json({ ok: false, error: '安装失败' }))('startUpdate'), /安装失败/)
})

function pollHarness(fetch) {
  const marker = source.indexOf('async function refreshUpdateStatus()')
  const start = source.lastIndexOf('React.useEffect(function () {', marker)
  const end = source.indexOf('\n\t\t\tReact.useEffect(', marker)
  const reports = [], cleared = [], states = []
  let poll, cleanup
  const rpc = rpcFor(fetch)
  new Function('React', 'window', 'call', 'setUpdateStatus', 'tavernErrorHub', 'updateStartedAtRef', 'isMissingUpdateApiError', source.slice(start, end))(
    { useEffect(fn) { cleanup = fn() } },
    { setInterval(fn) { poll = fn; return 1 }, clearInterval() {} },
    rpc, state => states.push(state), { report: (label, error) => reports.push({ label, error }), resolve: label => cleared.push(label) },
    { current: 0 }, () => false)
  return { reports, cleared, states, poll: () => poll(), stop: () => cleanup() }
}

test('启动期间两次空响应自动等待，恢复后清除状态查询错误', async () => {
  let calls = 0
  const h = pollHarness(async () => ++calls < 3 ? new Response('', { status: 404 }) : ok())
  await tick(); await h.poll(); await h.poll()
  assert.equal(h.reports.length, 0)
  assert.equal(h.states.at(-1).phase, 'update-available')
  assert.ok(h.cleared.includes('更新状态'))
  assert.ok(!h.cleared.includes('插件更新'), '不能清除实际执行更新的失败')
  h.stop()
})

test('持续故障达到阈值才提示，随后恢复仍清除提示', async () => {
  let calls = 0
  const h = pollHarness(async () => ++calls < 4 ? new Response('', { status: 503 }) : ok())
  await tick(); await h.poll(); await h.poll()
  assert.equal(h.reports.length, 1)
  assert.equal(h.reports[0].label, '更新状态')
  await h.poll()
  assert.ok(h.cleared.includes('更新状态'))
  h.stop()
})

test('慢查询不重叠，卸载后不再更新界面或清除其他错误', async () => {
  let finish, calls = 0
  const h = pollHarness(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  await h.poll()
  assert.equal(calls, 1)
  h.stop(); finish(ok()); await tick()
  assert.equal(h.states.length, 0)
  assert.equal(h.cleared.length, 0)
})

test('网络中断可恢复，认证和业务错误立即提示', async () => {
  let calls = 0
  const network = pollHarness(async () => { if (++calls === 1) throw new TypeError('Failed to fetch'); return ok() })
  await tick()
  assert.equal(network.reports.length, 0)
  await network.poll()
  assert.equal(network.states.at(-1).phase, 'update-available')
  network.stop()
  for (const response of [() => new Response('', { status: 401 }), () => Response.json({ ok: false, error: '状态文件损坏' })]) {
    const h = pollHarness(async () => response())
    await tick()
    assert.equal(h.reports.length, 1)
    h.stop()
  }
})
