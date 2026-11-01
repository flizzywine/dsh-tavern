import { execFileSync } from 'node:child_process'
import http from 'node:http'

// Node 的 fetch / undici 只认 HTTP(S)_PROXY 环境变量（而且要 NODE_USE_ENV_PROXY=1
// 或 setGlobalProxyFromEnv 才会真的用），看不到各平台的「系统代理」设置。
// 酒馆的插件侧检查更新、插件市场检查同样走 fetch，所以这里把系统代理翻译成环境变量，
// 并在当前进程里直接切换全局代理 dispatcher。安装器的 bin/download.cjs 里有同一套
// 逻辑（那份必须是零依赖 CommonJS，会被嵌进 install.sh / install.ps1），两处保持一致。
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']
const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const LOCAL_BYPASS = ['localhost', '127.0.0.1', '::1']

const envValue = (env, name) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1]
const proxyUrl = value => (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`)
const unquote = value => String(value ?? '').trim().replace(/^'(.*)'$/s, '$1')

const defaultExec = (command, args) => execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 })

function readWindowsSettings(exec) {
  const output = exec('reg', ['query', INTERNET_SETTINGS])
  const values = {}
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_\w+\s+(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function windowsProxy(exec) {
  const settings = readWindowsSettings(exec)
  if (Number(settings.ProxyEnable) === 1 && settings.ProxyServer) {
    const entries = {}
    for (const part of String(settings.ProxyServer).split(';').map(item => item.trim()).filter(Boolean)) {
      const [scheme, address] = part.includes('=') ? part.split('=', 2) : ['*', part]
      entries[scheme.toLowerCase()] = address
    }
    const httpAddress = entries.http || entries['*']
    const httpsAddress = entries.https || httpAddress
    if (httpAddress || httpsAddress) {
      const bypass = String(settings.ProxyOverride || '').split(';').map(item => item.trim())
        .filter(item => item && item !== '<local>' && !item.slice(1).includes('*'))
        .map(item => item.replace(/^\*/, ''))
      return { http: httpAddress, https: httpsAddress, bypass, source: 'system' }
    }
    if (entries.socks) return { source: 'unsupported', summary: '系统代理只提供 SOCKS，Node 无法使用；请在代理软件里开启 HTTP 代理或 TUN 模式' }
  }
  if (settings.AutoConfigURL) return { source: 'pac', summary: '系统代理使用 PAC 脚本，程序无法读取；请开启 TUN 模式或设置 HTTPS_PROXY' }
  return null
}

const validHost = value => /^[A-Za-z0-9._-]+$/.test(value)
const validPort = value => /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) < 65536
const usableAddress = value => {
  if (!value || value === 'null') return ''
  const [host, port] = String(value).split(':')
  return validHost(host) && validPort(port) ? `${host}:${port}` : ''
}

function androidProxy(exec) {
  const read = key => {
    try { return unquote(exec('settings', ['get', key])) } catch { return '' }
  }
  // FlClash / Clash 的「系统代理」会写进全局 http_proxy；部分 ROM 只写 host/port。
  let address = usableAddress(read('global http_proxy')) || usableAddress(read('http_proxy'))
  if (!address) {
    const host = read('global global_http_proxy_host') || read('global_http_proxy_host')
    const port = read('global global_http_proxy_port') || read('global_http_proxy_port')
    if (validHost(host) && validPort(port)) address = `${host}:${port}`
  }
  if (!address) return null
  return { http: address, https: address, source: 'system' }
}

function gnomeProxy(exec) {
  const mode = unquote(exec('gsettings', ['get', 'org.gnome.system.proxy', 'mode']))
  if (mode !== 'manual') return null
  const host = unquote(exec('gsettings', ['get', 'org.gnome.system.proxy.https', 'host']))
  const port = unquote(exec('gsettings', ['get', 'org.gnome.system.proxy.https', 'port']))
  if (!validHost(host) || !validPort(port)) return null
  return { http: `${host}:${port}`, https: `${host}:${port}`, source: 'system' }
}

function systemProxy(platform, exec) {
  const readers = platform === 'win32' ? [windowsProxy] : platform === 'android' ? [androidProxy] : platform === 'linux' ? [gnomeProxy] : []
  for (const read of readers) {
    try {
      const result = read(exec)
      if (result) return result
    } catch { /* 该平台没有对应命令：当作没有系统代理 */ }
  }
  return null
}

// Returns the variables to add plus a display summary without credentials.
export function proxyEnvironment(env = process.env, { platform = process.platform, exec = defaultExec } = {}) {
  const added = {}
  const useEnvProxy = () => { if (envValue(env, 'NODE_USE_ENV_PROXY') === undefined) added.NODE_USE_ENV_PROXY = '1' }
  if (PROXY_KEYS.some(key => envValue(env, key))) {
    useEnvProxy()
    return { added, source: 'environment' }
  }
  const detected = systemProxy(platform, exec)
  if (!detected) return { added, source: null }
  if (detected.source === 'unsupported' || detected.source === 'pac') {
    return { added, source: detected.source, summary: detected.summary }
  }
  if (detected.http) added.HTTP_PROXY = proxyUrl(detected.http)
  if (detected.https) added.HTTPS_PROXY = proxyUrl(detected.https)
  if (envValue(env, 'NO_PROXY') === undefined) added.NO_PROXY = [...new Set([...LOCAL_BYPASS, ...(detected.bypass || [])])].join(',')
  useEnvProxy()
  const host = (() => { try { return new URL(added.HTTPS_PROXY || added.HTTP_PROXY).host } catch { return '' } })()
  return { added, source: 'system', summary: host }
}

let applied = null
const appliedEnvironment = new Map()

// A service/updater child must inherit the user's original proxy policy, not the
// settings synthesized for this process's downloads. Remove only values we really
// inserted, and preserve any later explicit changes. Never mutate the parent env.
export function withoutAppliedSystemProxy(env = process.env) {
  const environment = { ...env }
  for (const [key, value] of appliedEnvironment) {
    if (environment[key] === value) delete environment[key]
  }
  return environment
}

// Apply proxyEnvironment() to `env` and to this process's own fetch.
// Node >= 24 exposes setGlobalProxyFromEnv(); older runtimes only get the variables.
export function applySystemProxy(env = process.env, options = {}) {
  if (applied !== null && env === process.env) return applied
  let result
  try { result = proxyEnvironment(env, options) } catch { result = { added: {}, source: null } }
  for (const [key, value] of Object.entries(result.added)) {
    if (env[key] !== undefined) continue
    env[key] = value
    if (env === process.env) appliedEnvironment.set(key, value)
  }
  if (result.added.HTTPS_PROXY || result.added.HTTP_PROXY) {
    try { http.setGlobalProxyFromEnv?.(env) } catch { /* 老版本 Node 没有这个接口 */ }
  }
  if (env === process.env) applied = result
  return result
}

// 只给日志/诊断用：不含账号密码。
export function describeProxy(result) {
  if (!result || !result.source) return '未检测到系统代理'
  if (result.summary && result.source !== 'system') return result.summary
  return result.source === 'environment' ? '使用环境变量里的代理' : `使用系统代理 ${result.summary || ''}`.trim()
}
