import http from 'node:http'
import { createRequire } from 'node:module'
import { fetchProxyEnvironment, proxyEnvironment } from '../tavern-plugin/packages/dsh-tavern/lib/proxy-environment.mjs'

export { describeProxy, proxyEnvironment } from '../tavern-plugin/packages/dsh-tavern/lib/proxy-environment.mjs'

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
// Prefer Node's native API when available. Node 22 / older Electron need undici.
export function applySystemProxy(env = process.env, options = {}) {
  if (applied !== null && env === process.env) return applied
  let result
  try { result = proxyEnvironment(env, options) } catch { result = { added: {}, source: null } }
  for (const [key, value] of Object.entries(result.added)) {
    if (env[key] !== undefined) continue
    env[key] = value
    if (env === process.env) appliedEnvironment.set(key, value)
  }
  if (result.source === 'system' || result.source === 'environment') {
    try {
      const { HTTP_PROXY: httpProxy, HTTPS_PROXY: httpsProxy, NO_PROXY: noProxy } = fetchProxyEnvironment(env)
      if (typeof http.setGlobalProxyFromEnv === 'function') {
        http.setGlobalProxyFromEnv({ HTTP_PROXY: httpProxy, HTTPS_PROXY: httpsProxy, NO_PROXY: noProxy })
      } else {
        // bin/ is outside the plugin's pnpm dependency links in CLI installations.
        const { EnvHttpProxyAgent, setGlobalDispatcher } = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))('undici')
        setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy }))
      }
    } catch (error) {
      result.activationFailed = true
      result.summary = `代理启用失败：${error?.code || error?.name || '未知错误'}`
    }
  }
  if (env === process.env) applied = result
  return result
}
