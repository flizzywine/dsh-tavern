import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { removeTreeSync } from './portable-fs.mjs'

const [candidate, host] = process.argv.slice(2)
const anchor = process.env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR
if (!candidate || !anchor || !['desktop', 'next'].includes(host)) throw Error('缺少桌面启动验证的 Profile 或宿主')

const source = path.resolve(candidate)
const home = await mkdtemp(path.join(path.dirname(source), '.tavern-startup-'))
const profileName = host === 'desktop' ? 'desktop' : 'tavern'
const profileDir = path.join(home, 'profiles', profileName)
const modules = path.join(profileDir, 'node_modules')
let running
try {
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
  // Exercise the installed managed bundles with a fresh data directory. The
  // user's own modules, profile patches and credentials are not needed here.
  // Pocket owns a separate proxy and tunnel. The probe only listens on the Web app's random port.
  const bundles = manifest.dshTavern.managedBundles.filter(name => name !== 'dsh-pocket')
  await mkdir(modules, { recursive: true })
  await writeFile(path.join(profileDir, 'package.json'), JSON.stringify({ name: manifest.name, private: true, dsh: { profile: { bundles } } }))
  await writeFile(path.join(profileDir, 'cordis.patch.yml'), '[]\n')
  for (const name of bundles) {
    let target
    try { target = await realpath(path.join(source, 'node_modules', name)) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      continue // DSH also resolves bundles from its own installation.
    }
    const link = path.join(modules, name)
    await mkdir(path.dirname(link), { recursive: true })
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  }
  process.env.DSH_HOME = home
  process.env.DSH_CWD = home
  process.env.DSH_TAVERN_RUNTIME_HOST = host
  process.env.DSH_TELEMETRY_DISABLED = '1'
  process.chdir(home)

  const require = createRequire(anchor)
  const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const { runProfile, INSTALL_ANCHOR } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh/profile-boot')).href)
  const profile = boot.loadProfileDirectory('dsh-tavern', profileDir, INSTALL_ANCHOR)
  running = await runProfile({
    environment: boot.loadLayeredEnv('dsh-tavern'),
    profile: profileName,
    resolvedProfile: { profile, installAnchor: INSTALL_ANCHOR },
    patchFiles: [],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
  })
  if (!running.ctx.get('tavern')?.apiVersion) throw Error('DSH 已启动，但酒馆插件未激活，请查看上方启动日志。')
  const address = running.ctx.get('webServer')?.server?.address()
  if (!address?.port) throw Error('酒馆的 Web 服务未启动。')
  const version = await new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port: address.port, path: '/version', agent: false,
      signal: AbortSignal.timeout(5000) }, async response => {
      try {
        let body = ''
        for await (const chunk of response.setEncoding('utf8')) body += chunk
        resolve(response.statusCode === 200 && JSON.parse(body).pkgVersion)
      } catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
  if (!version) throw Error('酒馆 HTTP 路由未响应。')
  console.log('桌面酒馆启动验证通过：插件已激活，HTTP 路由可用。')
} finally {
  try { await running?.ctx.fiber.dispose() }
  finally {
    process.chdir(path.dirname(source))
    removeTreeSync(home)
  }
}
