import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { parse } from 'yaml'
import { adaptedDshVersion } from '../bin/dsh-compatibility.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { runtimeFiles } = createRequire(import.meta.url)('../bin/download.cjs')

const execute = promisify(execFile)
const unix = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const windows = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const workspace = parse(await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
const patches = Object.values(workspace.patchedDependencies || {}).map(value => typeof value === 'string' ? value : value.path)

test('两平台安装脚本内嵌的下载模块与 bin/download.cjs 一致', async () => {
  await execute(process.execPath, [fileURLToPath(new URL('../bin/build-installer-scripts.mjs', import.meta.url)), '--check'])
})

test('旧版 Desktop 经最新安装脚本走 CDN 覆盖升级：运行文件落盘、用户数据不变、失败不误报成功', async t => {
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
    // Stub DSH boot; pnpm comes from the mock PATH. Download, hashing and overwrite are real.
    ['bin/dsh-tavern.mjs', Buffer.from("import fs from 'node:fs'; fs.writeFileSync(new URL('../installed.txt', import.meta.url), process.argv.slice(2).join(' '));\n")],
  ])
  for (const file of [...patches, 'bin/dsh-compatibility.mjs', 'tavern-plugin/lib/domain/host-compatibility.js', 'config/dsh-compatibility.json']) {
    files.set(file, await readFile(new URL('../' + file, import.meta.url)))
  }
  const revision = 'b'.repeat(40)
  const manifest = { schemaVersion: 2, revision, releaseSequence: 42, version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, files: [...files].map(([file, bytes]) => ({ path: file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) }
  manifest.files.push({ path: 'docs/do-not-download.txt', size: 0, sha256: 'a'.repeat(64) })
  manifest.files.push({ path: 'patches/../escape.txt', size: 0, sha256: 'a'.repeat(64) })
  const requests = []
  const integrityFile = 'config/dsh-compatibility.json'
  let corruptFile = false
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url)
    requests.push(url)
    if (url === '/manifest') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(manifest)); return }
    const file = url.startsWith(`/source@${revision}/`) ? url.slice(`/source@${revision}/`.length) : ''
    const bytes = files.get(file)
    if (bytes) { res.end(corruptFile && file === integrityFile ? 'corrupt runtime file' : bytes); return }
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
  await writeFile(verifyPatch, `const fs=require('node:fs'), path=require('node:path'); const app=process.argv[process.argv.indexOf('--dir')+1]; for(const file of ${JSON.stringify(patches)}) fs.readFileSync(path.join(app,file)); if(process.env.DSH_TEST_DEPENDENCY_EXIT) process.exit(Number(process.env.DSH_TEST_DEPENDENCY_EXIT));`)
  await writeFile(path.join(mocks, 'git' + (isWindows ? '.cmd' : '')), isWindows ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  // The installer requires an official Desktop and runs dsh/pnpm from its bundle (bin/official-desktop-runtime.cjs layout):
  // Node stands in for its Electron, a stub DSH reports the adapted version, and its pnpm checks the patches.
  const desktop = path.join(root, 'DeepSeek Harness')
  const executable = process.platform === 'darwin' ? path.join(desktop, 'Contents/MacOS/DeepSeek Harness') : path.join(desktop, isWindows ? 'DeepSeek Harness.exe' : 'deepseek-harness')
  const resources = process.platform === 'darwin' ? path.join(desktop, 'Contents/Resources') : path.join(desktop, 'resources')
  await mkdir(path.dirname(executable), { recursive: true })
  if (isWindows) await link(process.execPath, executable).catch(() => copyFile(process.execPath, executable))
  else await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 })
  for (const [file, body] of [
    ['app/package.json', '{"name":"@deepseek-ai/dsh-desktop"}'],
    ['app/dsh/package.json', '{}'],
    ['app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js', `console.log(${JSON.stringify(adaptedDshVersion)})\n`],
    ['runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs', `await import(${JSON.stringify(pathToFileURL(verifyPatch).href)})\n`],
  ]) {
    await mkdir(path.dirname(path.join(resources, file)), { recursive: true })
    await writeFile(path.join(resources, file), body)
  }
  const env = { ...process.env, DSH_HOME: root, DSH_TAVERN_HOST: 'desktop', DSH_TAVERN_APP_DIR: app, DSH_DESKTOP_APP_EXECUTABLE: executable,
    DSH_TAVERN_CDN_METADATA_URL: `${base}/manifest`, DSH_TAVERN_CDN_ROOT_URL: `${base}/source`,
    DSH_TAVERN_ARCHIVE_URL: `${base}/missing-archive`, DSH_TAVERN_TARGET_COMMIT: revision,
  }
  const searchPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  // CI starts Node from PowerShell 7; Windows PowerShell 5.1 must rebuild its
  // own builtin module search path instead of inheriting the incompatible one.
  if (isWindows) for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key]
  env[isWindows ? 'Path' : 'PATH'] = mocks + path.delimiter + searchPath
  const run = (extraEnv = {}) => execute(isWindows ? 'powershell.exe' : 'sh', isWindows
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bootstrap] : [bootstrap], { env: { ...env, ...extraEnv }, timeout: 45000, maxBuffer: 1024 * 1024 })
  try { await run() } catch (error) { throw new Error(error.stdout + '\n' + error.stderr) }
  assert.equal(await readFile(path.join(app, 'installed.txt'), 'utf8'), 'install --host desktop')
  assert.deepEqual(JSON.parse(await readFile(path.join(app, 'dsh-tavern-runtime.json'), 'utf8')), manifest)
  assert.equal(await readFile(path.join(app, installerName), 'utf8'), downloaded)
  for (const file of [...patches, integrityFile]) assert.deepEqual(await readFile(path.join(app, file)), files.get(file))
  for (const [file, content] of protectedFiles) assert.equal(await readFile(file, 'utf8'), content)
  // GitHub archive is tried before jsDelivr (5fa69fcd); a failed archive must fall through to the CDN.
  assert.ok(requests.indexOf('/missing-archive') !== -1 && requests.indexOf('/missing-archive') < requests.indexOf('/manifest'), 'a failed archive download must fall back to CDN')
  assert.ok(!requests.some(url => /escape|do-not-download/.test(url)))
  // EXIT cleanup must preserve a dependency failure, including on macOS sh.
  await assert.rejects(run({ DSH_TEST_DEPENDENCY_EXIT: '23' }), error => {
    assert.equal(error.code, isWindows ? 1 : 23)
    assert.doesNotMatch(error.stdout, /DSH Tavern Desktop 版安装完成/)
    return true
  })
  // Failed CDN verification must not overwrite installed resources or report success.
  // Advertise a new revision of this file so checksum-valid installed bytes cannot
  // satisfy the update through Windows' local reuse path.
  const updatedBytes = Buffer.concat([files.get(integrityFile), Buffer.from('\n')])
  Object.assign(manifest.files.find(file => file.path === integrityFile), {
    size: updatedBytes.length, sha256: createHash('sha256').update(updatedBytes).digest('hex')
  })
  corruptFile = true
  await assert.rejects(run())
  for (const file of [...patches, integrityFile]) assert.deepEqual(await readFile(path.join(app, file)), files.get(file))
  for (const [file, content] of protectedFiles) assert.equal(await readFile(file, 'utf8'), content)
})
