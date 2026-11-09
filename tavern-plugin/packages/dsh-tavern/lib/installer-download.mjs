import { execFile } from 'node:child_process'
import http from 'node:http'
import { promisify } from 'node:util'
import { describeProxy, fetchProxyEnvironment, proxyEnvironment } from './proxy-environment.mjs'

const execute = promisify(execFile)
const TIMEOUT_MS = 20000
const REPOSITORY = 'flizzywine/dsh-tavern'

function describeFailure(error) {
  if (Number.isInteger(error.status)) return `HTTP ${error.status}`
  if (error.name === 'TimeoutError' || error.killed || error.code === 28) return '请求超时'
  const curlStatus = error.stderr?.match(/(?:returned error:|response) ([1-5]\d\d)\b/)?.[1]
  if (curlStatus) return `HTTP ${curlStatus}（curl ${error.code}）`
  if (Number.isInteger(error.code)) return `curl 退出码 ${error.code}`
  const causes = [error]
  const codes = new Set()
  for (let index = 0; index < Math.min(12, causes.length); index++) {
    const cause = causes[index]
    const proxyStatus = cause?.message?.match(/Proxy response \(([1-5]\d\d)\)/)?.[1]
    if (proxyStatus) codes.add(`代理 HTTP ${proxyStatus}`)
    if (typeof cause?.code === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(cause.code)) codes.add(cause.code)
    if (cause?.cause) causes.push(cause.cause)
    if (Array.isArray(cause?.errors)) causes.push(...cause.errors)
  }
  // Raw messages from proxies and curl can contain credentials or request data.
  return codes.size ? `请求失败（${[...codes].join('、')}）` : '网络请求失败'
}

async function fetchScript(source) {
  const response = await fetch(source, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw Object.assign(new Error('HTTP'), { status: response.status })
  }
  return response.text()
}

async function curlScript(source, proxy) {
  // Old Electron versions cannot configure fetch's proxy. Windows and macOS
  // ship curl, which also supports explicit SOCKS proxies from the environment.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)))
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl'
  const { stdout } = await execute(command, ['-q', '--fail', '--silent', '--show-error', '--location', '--proto', '=https',
    '--proto-redir', '=https', '--max-time', String(TIMEOUT_MS / 1000), source], {
    env: { ...env, ...proxy }, encoding: 'utf8', timeout: TIMEOUT_MS + 1000, windowsHide: true,
  })
  return stdout
}

export async function downloadInstaller(name, { log, preparingUpdate, next, replacesNext }) {
  const detected = proxyEnvironment()
  if (detected.source) log(describeProxy(detected))
  const proxy = fetchProxyEnvironment({ ...process.env, ...detected.added })
  let restore
  if (proxy.HTTPS_PROXY && !/^socks/i.test(proxy.HTTPS_PROXY)) {
    try { restore = http.setGlobalProxyFromEnv?.(proxy) } catch (error) {
      log(`Node 代理启用失败：${describeFailure(error)}`)
    }
  }
  const sources = [
    `https://cdn.jsdelivr.net/gh/${REPOSITORY}@runtime-archive-main/${name}`,
    `https://raw.githubusercontent.com/${REPOSITORY}/main/${name}?launcher=${Date.now()}`,
    ...['fastly', 'gcore'].map(node => `https://${node}.jsdelivr.net/gh/${REPOSITORY}@runtime-archive-main/${name}`),
  ]
  const requirements = [
    [preparingUpdate, '.ready', '安装脚本尚未支持准备更新'],
    [true, 'DSH_TAVERN_INSTALL_INACTIVE', '安装脚本尚未同步'],
    [next, 'DSH_TAVERN_UNIFIED_DESKTOP', '安装脚本尚未同步统一桌面安装支持'],
    [replacesNext, 'DSH_TAVERN_REQUIRE_NEXT_MIGRATION', '安装脚本尚未支持 NEXT 迁移'],
  ]
  try {
    for (const source of sources) {
      const host = new URL(source).hostname
      let content
      try {
        content = proxy.HTTPS_PROXY && !restore ? await curlScript(source, proxy) : await fetchScript(source)
      } catch (error) {
        log(`安装脚本下载失败 ${host}：${describeFailure(error)}`)
        continue
      }
      const missing = requirements.find(([required, marker]) => required && !content.includes(marker))
      if (missing) {
        log(`安装脚本不可用 ${host}：${missing[2]}`)
        continue
      }
      log(`已从 ${host} 下载酒馆安装脚本。`)
      return { content, proxyEnv: detected.added }
    }
    throw new Error('无法获取可用的酒馆安装脚本。请检查网络连接，或复制诊断日志。')
  } finally {
    restore?.()
  }
}
