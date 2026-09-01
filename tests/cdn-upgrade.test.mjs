import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { parse } from 'yaml'

const execute = promisify(execFile)
const unix = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const windows = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const workspace = parse(await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
const patches = Object.values(workspace.patchedDependencies).map(value => typeof value === 'string' ? value : value.path)

test('两平台 CDN 下载过滤器允许依赖补丁', () => {
  const unixPattern = new RegExp(unix.match(/^const allowed = \/(.+)\/$/m)[1])
  const windowsPattern = new RegExp(windows.match(/\$RuntimePattern = '([^']+)'/)[1])
  for (const pattern of [unixPattern, windowsPattern]) {
    for (const file of patches) assert.ok(pattern.test(file), `下载器过滤了 ${file}`)
    assert.equal(pattern.test('docs/private.md'), false)
  }
})

test('旧版 Desktop 经最新安装脚本走 CDN 覆盖升级：补丁落盘、用户数据不变、失败不误报成功', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-cdn-upgrade-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const isWindows = process.platform === 'win32'
  const app = path.join(root, 'old app')
  const mocks = path.join(root, 'mock-bin')
  await mkdir(mocks)
  await mkdir(app)
  const files = new Map([
    ['package.json', Buffer.from('{"name":"cdn-upgrade-fixture"}')],
    ['pnpm-workspace.yaml', Buffer.from('packages:\n  - .\n')],
    ['pnpm-lock.yaml', Buffer.from('lockfileVersion: 9\n')],
    ['cordis.patch.yml', Buffer.from('[]\n')],
    ['install.sh', Buffer.from(unix)],
    ['install.ps1', Buffer.from(windows)],
    // Stub only dependency execution and DSH boot; download, hashing and overwrite are real.
    ['bin/dsh-tavern.mjs', Buffer.from("import fs from 'node:fs'; fs.writeFileSync(new URL('../installed.txt', import.meta.url), process.argv.slice(2).join(' '));\n")],
  ])
  for (const file of [...patches, 'bin/dsh-compatibility.mjs', 'config/dsh-compatibility.json']) {
    files.set(file, await readFile(new URL('../' + file, import.meta.url)))
  }
  const revision = 'b'.repeat(40)
  const manifest = { schemaVersion: 2, revision, releaseSequence: 42, version: '1.1.1', files: [...files].map(([file, bytes]) => ({ path: file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) }
  manifest.files.push({ path: 'docs/do-not-download.txt', size: 0, sha256: 'a'.repeat(64) })
  manifest.files.push({ path: 'patches/../escape.txt', size: 0, sha256: 'a'.repeat(64) })
  const requests = []
  let corruptPatch = false
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url)
    requests.push(url)
    if (url === '/manifest') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(manifest)); return }
    const file = url.startsWith(`/source@${revision}/`) ? url.slice(`/source@${revision}/`.length) : ''
    const bytes = files.get(file)
    if (bytes) { res.end(corruptPatch && patches.includes(file) ? 'corrupt patch' : bytes); return }
    res.writeHead(404); res.end('unexpected download')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const protectedFiles = new Map([
    [path.join(app, 'data/cards/original.json'), '{"card":"original"}'],
    [path.join(root, 'profile-data/tavern/data/chats/history.json'), '{"history":true}'],
    [path.join(root, 'profile-data/tavern/data/tools.cordis.yml'), '# user config\n[]\n'],
    [path.join(root, 'profile-data/tavern/data/tools/custom.mjs'), '// user tool\n'],
    [path.join(root, 'profile-data/tavern/data/skills/custom/SKILL.md'), '# User skill\n'],
    [path.join(root, 'settings.yaml'), 'user-setting: keep\n'],
  ])
  for (const [file, content] of protectedFiles) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  const installerName = isWindows ? 'install.ps1' : 'install.sh'
  await writeFile(path.join(app, installerName), isWindows ? "throw 'old updater must not run'" : 'exit 99\n')
  // A fetched current bootstrap bypasses the broken local updater, as documented.
  const bootstrap = path.join(root, installerName)
  const downloaded = await (await fetch(`${base}/source@${revision}/${installerName}`)).text()
  await writeFile(bootstrap, (isWindows ? '\uFEFF' : '') + downloaded)
  const verifyPatch = path.join(mocks, 'verify-patches.cjs')
  await writeFile(verifyPatch, `const fs=require('node:fs'), path=require('node:path'); const app=process.argv[process.argv.indexOf('--dir')+1]; for(const file of ${JSON.stringify(patches)}) fs.readFileSync(path.join(app,file));`)
  for (const [name, body] of [
    ['git', isWindows ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n'],
    ['dsh', isWindows ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n'],
    ['pnpm', isWindows ? `@"${process.execPath}" "${verifyPatch}" %*\r\n@exit /b %errorlevel%\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${verifyPatch}" "$@"\n`],
  ]) await writeFile(path.join(mocks, name + (isWindows ? '.cmd' : '')), body, { mode: 0o755 })
  const env = { ...process.env, DSH_HOME: root, DSH_TAVERN_HOST: 'desktop', DSH_TAVERN_APP_DIR: app,
    DSH_TAVERN_CDN_METADATA_URL: `${base}/manifest`, DSH_TAVERN_CDN_ROOT_URL: `${base}/source`,
    DSH_TAVERN_ARCHIVE_URL: `${base}/forbidden-archive`, DSH_TAVERN_TARGET_COMMIT: revision,
  }
  const searchPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  // CI starts Node from PowerShell 7; Windows PowerShell 5.1 must rebuild its
  // own builtin module search path instead of inheriting the incompatible one.
  if (isWindows) for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key]
  env[isWindows ? 'Path' : 'PATH'] = mocks + path.delimiter + searchPath
  const run = () => execute(isWindows ? 'powershell.exe' : 'sh', isWindows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bootstrap] : [bootstrap], { env, timeout: 45000, maxBuffer: 1024 * 1024 })
  try { await run() } catch (error) { throw new Error(error.stdout + '\n' + error.stderr) }
  assert.equal(await readFile(path.join(app, 'installed.txt'), 'utf8'), 'install --host desktop')
  assert.deepEqual(JSON.parse(await readFile(path.join(app, 'dsh-tavern-runtime.json'), 'utf8')), manifest)
  assert.equal(await readFile(path.join(app, installerName), 'utf8'), downloaded)
  for (const file of patches) assert.deepEqual(await readFile(path.join(app, file)), files.get(file))
  for (const [file, content] of protectedFiles) assert.equal(await readFile(file, 'utf8'), content)
  assert.ok(!requests.includes('/forbidden-archive'), 'CDN success must not fall back to archive')
  assert.ok(!requests.some(url => /escape|do-not-download/.test(url)))
  // Failed CDN verification must not overwrite installed resources or report success.
  corruptPatch = true
  await assert.rejects(run())
  for (const file of patches) assert.deepEqual(await readFile(path.join(app, file)), files.get(file))
  for (const [file, content] of protectedFiles) assert.equal(await readFile(file, 'utf8'), content)
})
