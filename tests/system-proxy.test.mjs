import test from 'node:test'
import assert from 'node:assert/strict'

import { proxyEnvironment } from '../bin/system-proxy.mjs'

// exec 的签名与 execFileSync 一致：exec(command, [args…])
const fakeExec = responses => (command, args = []) => {
  const key = `${command} ${args.join(' ')}`
  const value = responses[key]
  if (value === undefined) throw Object.assign(new Error('command not found'), { code: 'ENOENT' })
  return value
}

const WINDOWS_ON = fakeExec({
  'reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings':
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n'
    + '    ProxyEnable    REG_DWORD    0x1\r\n'
    + '    ProxyServer    REG_SZ    127.0.0.1:7890\r\n'
    + '    ProxyOverride  REG_SZ    <local>;*.corp.test\r\n',
})

test('Windows 的 WinINET 系统代理被翻译成 HTTP(S)_PROXY，带 NO_PROXY', () => {
  const result = proxyEnvironment({}, { platform: 'win32', exec: WINDOWS_ON })
  assert.equal(result.source, 'system')
  assert.equal(result.added.HTTP_PROXY, 'http://127.0.0.1:7890')
  assert.equal(result.added.HTTPS_PROXY, 'http://127.0.0.1:7890')
  assert.equal(result.added.NODE_USE_ENV_PROXY, '1')
  assert.match(result.added.NO_PROXY, /localhost/)
  assert.match(result.added.NO_PROXY, /\.corp\.test/)
  assert.equal(result.summary, '127.0.0.1:7890')
})

test('安卓：只有 host/port 时拼起来；代理关闭（:0）不当作代理', () => {
  const split = fakeExec({
    'settings get global http_proxy': ':0\n',
    'settings get global global_http_proxy_host': '127.0.0.1\n',
    'settings get global global_http_proxy_port': '7890\n',
  })
  assert.equal(proxyEnvironment({}, { platform: 'android', exec: split }).added.HTTPS_PROXY, 'http://127.0.0.1:7890')

  const off = fakeExec({ 'settings get global http_proxy': ':0\n' })
  assert.deepEqual(proxyEnvironment({}, { platform: 'android', exec: off }).added, {})
})

test('macOS 读取 scutil 的 HTTP/HTTPS 代理和域名例外', () => {
  const result = proxyEnvironment({}, { platform: 'darwin', exec: fakeExec({ 'scutil --proxy': `<dictionary> {
  ExceptionsList : <array> {
    0 : 192.168.0.0/16
    1 : localhost
    2 : *.local
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 8080
  HTTPSEnable : 1
  HTTPSProxy : secure.proxy.test
  HTTPSPort : 7890
}` }) })
  assert.equal(result.source, 'system')
  assert.equal(result.added.HTTP_PROXY, 'http://127.0.0.1:8080')
  assert.equal(result.added.HTTPS_PROXY, 'http://secure.proxy.test:7890')
  assert.equal(result.added.NO_PROXY, 'localhost,127.0.0.1,::1,.local')
})

test('macOS 忽略关闭的代理，PAC/SOCKS 返回可操作提示', () => {
  for (const [settings, source] of [
    ['HTTPEnable : 0\n  HTTPProxy : 127.0.0.1\n  HTTPPort : 8080', null],
    ['ProxyAutoConfigEnable : 1', 'pac'],
    ['ProxyAutoDiscoveryEnable : 1', 'pac'],
    ['SOCKSEnable : 1', 'unsupported'],
  ]) {
    const result = proxyEnvironment({}, { platform: 'darwin', exec: fakeExec({ 'scutil --proxy': `  ${settings}\n` }) })
    assert.equal(result.source, source)
    assert.deepEqual(result.added, {})
  }
})

test('显式环境代理优先于 macOS 系统设置', () => {
  const result = proxyEnvironment({ https_proxy: 'http://explicit.test:8080' }, { platform: 'darwin', exec() { throw new Error('不应读取系统设置') } })
  assert.equal(result.source, 'environment')
  assert.deepEqual(result.added, { NODE_USE_ENV_PROXY: '1' })
})
