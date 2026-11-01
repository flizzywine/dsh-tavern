import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const moduleUrl = new URL('../bin/system-proxy.mjs', import.meta.url).href
const proxyKey = /^(https?_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i

// Each case owns a fresh module/process. Registry output is synthetic, and the
// global-dispatcher setter is stubbed: no real settings or network are touched.
function scenario(original = {}, changes = {}, apply = true, customEnv = false) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (proxyKey.test(key)) delete env[key]
  Object.assign(env, original)
  const script = `
    import http from 'node:http';
    import { applySystemProxy, withoutAppliedSystemProxy } from ${JSON.stringify(moduleUrl)};
    const keys = ${proxyKey};
    const select = env => Object.fromEntries(Object.entries(env).filter(([key]) => keys.test(key)));
    http.setGlobalProxyFromEnv = () => {};
    const before = select(process.env);
    const target = ${customEnv} ? {} : process.env;
    if (${apply}) applySystemProxy(target, { platform: 'win32', exec() {
      return '    ProxyEnable    REG_DWORD    0x1\\r\\n    ProxyServer    REG_SZ    127.0.0.1:7890\\r\\n';
    } });
    Object.assign(process.env, ${JSON.stringify(changes)});
    const injected = select(process.env);
    const clean = withoutAppliedSystemProxy();
    const copied = withoutAppliedSystemProxy({ ...process.env, UNRELATED: 'retained' });
    if (copied.UNRELATED !== 'retained') throw new Error('lost unrelated setting');
    if (clean === process.env) throw new Error('not a copy');
    console.log(JSON.stringify({ before, injected, clean: select(clean), after: select(process.env), copied: select(copied) }));
  `
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' }))
}

test('child environment excludes synthesized system proxy without changing parent downloads', () => {
  const result = scenario()
  assert.deepEqual(result.clean, {})
  assert.deepEqual(result.copied, {})
  assert.equal(result.injected.HTTP_PROXY, 'http://127.0.0.1:7890')
  assert.equal(result.injected.HTTPS_PROXY, 'http://127.0.0.1:7890')
  assert.equal(result.injected.NODE_USE_ENV_PROXY, '1')
  assert.equal(result.injected.NO_PROXY, 'localhost,127.0.0.1,::1')
  assert.deepEqual(result.after, result.injected)
})

for (const original of [
  { HTTPS_PROXY: 'http://user.invalid:8080', NO_PROXY: '.internal' },
  { https_proxy: 'http://user.invalid:8080', no_proxy: '.internal', node_use_env_proxy: '0' },
  { ALL_PROXY: 'http://user.invalid:8080', NODE_USE_ENV_PROXY: '1' },
  { NODE_USE_ENV_PROXY: '0', NO_PROXY: '' },
  { NODE_USE_ENV_PROXY: '1', no_proxy: '.internal' },
  { HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '' },
]) {
  test(`child environment preserves original settings ${JSON.stringify(original)}`, () => {
    const result = scenario(original)
    assert.deepEqual(result.clean, result.before)
    assert.deepEqual(result.copied, result.before)
    assert.deepEqual(result.after, result.injected)
  })
}

test('explicit proxy changes after discovery are not removed', () => {
  const changes = { HTTP_PROXY: 'http://changed.invalid:8080', NODE_USE_ENV_PROXY: '0', NO_PROXY: '.changed' }
  assert.deepEqual(scenario({}, changes).clean, changes)
})

test('no application and applying to an isolated object do not claim process values', () => {
  const original = { HTTPS_PROXY: 'http://user.invalid:8080', NODE_USE_ENV_PROXY: '1' }
  assert.deepEqual(scenario(original, {}, false).clean, original)
  assert.deepEqual(scenario(original, {}, true, true).clean, original)
})
