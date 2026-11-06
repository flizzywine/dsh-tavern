import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations'

export const inject = ['connection', 'profileContext', 'webServer']
const channel = '/dsh-tavern-launcher'
const bundle = 'dsh-tavern-bundle'
const tavernSource = 'github:flizzywine/dsh-tavern#plugin-market-next'
const gitSource = /^(?:github:flizzywine\/dsh-tavern|git\+https:\/\/github\.com\/flizzywine\/dsh-tavern\.git)#(?:plugin-market-next|[0-9a-f]{40})$/i

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function missingAllowed(operation) {
  try {
    return await operation()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function inspectProfile(dir) {
  const entry = await missingAllowed(() => lstat(dir))
  if (!entry) return { state: 'absent' }
  if (!entry.isDirectory() || entry.isSymbolicLink() || relative(dir, await realpath(dir))) return { state: 'conflict' }
  for (const name of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc', 'node_modules', '.plugin-manager']) {
    const file = await missingAllowed(() => lstat(join(dir, name)))
    if (file?.isSymbolicLink()) return { state: 'conflict' }
  }
  const manifest = await missingAllowed(() => readJson(join(dir, 'package.json')))
  const bundles = manifest?.dsh?.profile?.bundles
  const dependency = manifest?.dependencies?.[bundle]
  if (!Array.isArray(bundles) || !PROFILE_TEMPLATES.web.bundles.every(name => bundles.includes(name)) ||
      bundles.includes('dsh-tavern-plugin') || manifest?.dependencies?.['dsh-tavern-plugin'] ||
      (dependency !== undefined && !gitSource.test(dependency))) return { state: 'conflict' }
  if (dependency && bundles.includes(bundle)) {
    const installed = await missingAllowed(() => readJson(join(dir, 'node_modules', bundle, 'package.json')))
    if (installed?.name === bundle && installed.version) return { state: 'installed', version: installed.version }
  }
  return { state: 'ready' }
}

export function apply(ctx) {
  const profile = ctx.profileContext
  const desktop = ctx.get('desktopProfiles')?.current
  let active
  let lastError
  let outcome
  async function install(dir, action, signal) {
    try {
      const before = await inspectProfile(dir)
      if (action === 'update' ? before.state !== 'installed' : !['absent', 'ready'].includes(before.state)) return
      signal.throwIfAborted()
      if (before.state === 'absent') {
        // Exclusive creation prevents initProfile from touching a directory
        // that another caller created after the initial check.
        await mkdir(dir)
        initProfile(dir, PROFILE_TEMPLATES.web.bundles)
      }

      const result = await runPluginCommand({
        profile: 'tavern', dir, home: profile.home, installAnchor: profile.installAnchor, cwd: profile.dir,
      }, ['add', tavernSource, '--allow-build=sharp'], {
        ...profile.packageManager, execution: 'service', signal,
        outputBytes: 8192, idleTimeoutMs: 120000, lockWaitMs: 120000,
      })
      if (result.exitCode !== 0) throw new Error(`DSH installation failed (exit code ${result.exitCode ?? 'unknown'})`)
      const after = await inspectProfile(dir)
      if (after.state !== 'installed') throw new Error('DSH did not activate the Tavern bundle')
      outcome = action === 'install' ? 'installedNow' : before.version === after.version ? 'upToDate' : 'updated'
    } catch (error) {
      lastError = error.message
    } finally {
      active = undefined
    }
  }

  async function handle(endpoint) {
    if (!desktop || desktop.dir !== profile.dir || !profile.packageManager) return { state: 'unsupported' }
    if (profile.name === 'tavern') return { state: 'current' }
    const dir = join(await realpath(join(profile.home, 'profiles')), 'tavern')
    if (!relative(await realpath(profile.dir), dir)) return { state: 'current' }
    if (active) return { state: active.action === 'update' ? 'updating' : 'installing' }
    if (endpoint === 'status') {
      const status = await inspectProfile(dir)
      return { ...status, error: lastError, outcome: status.state === 'installed' ? outcome : undefined }
    }

    lastError = undefined
    outcome = undefined
    active = { action: endpoint, controller: new AbortController() }
    void install(dir, endpoint, active.controller.signal)
    return { state: endpoint === 'update' ? 'updating' : 'installing' }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: channel,
    async handler(request, response) {
      const rejection = ctx.connection.requestRejection(request)
      if (rejection !== undefined) {
        response.writeHead(rejection).end()
        return
      }
      const pathname = new URL(request.url, 'http://localhost').pathname
      const endpoint = pathname === channel + '/status' && request.method === 'GET' ? 'status'
        : request.method === 'POST' && [channel + '/install', channel + '/update'].includes(pathname)
          ? pathname.slice(channel.length + 1) : undefined
      if (!endpoint) {
        response.writeHead(404).end()
        return
      }
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      try {
        const result = await handle(endpoint)
        response.writeHead(200, headers).end(JSON.stringify(result))
      } catch (error) {
        response.writeHead(500, headers).end(JSON.stringify({ error: error.message }))
      }
    },
  }), 'Tavern launcher routes')
  ctx.effect(() => () => active?.controller.abort(), 'Tavern launcher package operations')
}
