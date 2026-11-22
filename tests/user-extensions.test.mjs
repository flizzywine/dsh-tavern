import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

import { adaptedDshVersion } from '../bin/dsh-compatibility.mjs'
import { ensureUserExtensions, userExtensionPaths } from '../tavern-plugin/lib/domain/user-extensions.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-user-extensions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'profile-data/tavern/data')
  return { root, dataRoot, paths: userExtensionPaths(dataRoot) }
}

test('清单损坏时保留原文件，不自动重置用户配置', async (t) => {
  const { dataRoot, paths } = await fixture(t)
  await ensureUserExtensions(dataRoot)
  await writeFile(paths.config, 'invalid: [')
  await ensureUserExtensions(dataRoot)
  assert.equal(await readFile(paths.config, 'utf8'), 'invalid: [')
})

// Match the supported official app layout. Node stands in for Electron's
// ELECTRON_RUN_AS_NODE mode; DSH reports its version and pnpm is a no-op.
async function fakeDesktopApp(root) {
  const app = path.join(root, 'Fake DSH.app/Contents')
  const runtime = path.join(app, 'Resources/runtime/primary-runtime/dependencies')
  const host = path.join(app, 'Resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib')
  await mkdir(path.join(app, 'MacOS'), { recursive: true })
  await symlink(process.env.DSH_TEST_NODE_EXECUTABLE || process.execPath, path.join(app, 'MacOS/Fake DSH'))
  await mkdir(host, { recursive: true })
  await writeFile(path.join(app, 'Resources/app/package.json'), '{"name":"@deepseek-ai/dsh-desktop"}')
  await writeFile(path.join(host, 'cli.js'), 'console.log(' + JSON.stringify(adaptedDshVersion) + ')\n')
  await mkdir(path.join(runtime, 'pnpm/bin'), { recursive: true })
  await writeFile(path.join(runtime, 'pnpm/bin/pnpm.mjs'), '')
  return path.join(app, 'MacOS/Fake DSH')
}

test('实际 Unix 安装脚本更新程序两次，用户工具、清单和 Skill 保持原样', { skip: process.platform !== 'darwin' && '桌面版安装只支持 macOS 与 Windows' }, async (t) => {
  const { root, dataRoot, paths } = await fixture(t)
  const source = path.join(root, 'source')
  const app = path.join(root, 'apps/dsh-tavern')
  await mkdir(path.join(source, 'bin'), { recursive: true })
  const desktop = await fakeDesktopApp(root)
  // Mock external package installation and the launcher; run the actual release
  // download/extract/copy path against a local Git repository (no network).
  await writeFile(path.join(source, 'package.json'), '{"name":"user-extension-update-fixture","type":"module"}')
  await writeFile(path.join(source, 'bin/dsh-tavern.mjs'), '')
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh', 'config/fixture', 'presets/fixture', 'tavern-plugin/fixture', 'patches/fixture.patch']) {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true })
    await writeFile(path.join(source, file), '')
  }
  // The installer runs the downloaded release's version check, which reads the allowlist module.
  for (const file of ['bin/dsh-compatibility.mjs', 'config/dsh-compatibility.json', 'tavern-plugin/lib/domain/host-compatibility.js']) {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true })
    await writeFile(path.join(source, file), await readFile(new URL('../' + file, import.meta.url)))
  }
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  await ensureUserExtensions(dataRoot)
  const protectedFiles = new Map([
    [paths.config, '# 用户配置\n- id: custom\n  name: ./tools/custom.mjs\n'],
    [path.join(paths.tools, 'custom.mjs'), 'export function apply() {}\n'],
    [path.join(paths.skills, 'custom/SKILL.md'), '# 用户自创 Skill\n'],
  ])
  for (const [file, content] of protectedFiles) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  for (const version of ['v1', 'v2']) {
    await writeFile(path.join(source, 'bin/version.txt'), version)
    git('add', '.')
    git('commit', '-m', version)
    execFileSync('sh', [fileURLToPath(new URL('../install.sh', import.meta.url))], {
      encoding: 'utf8', timeout: 30000,
      env: {
        ...process.env, DSH_DESKTOP_APP_EXECUTABLE: desktop,
        DSH_HOME: root, DSH_TAVERN_HOST: 'desktop', DSH_TAVERN_APP_DIR: app,
        DSH_TAVERN_GIT_URL: source, DSH_TAVERN_TARGET_COMMIT: git('rev-parse', 'HEAD'),
        DSH_TAVERN_CDN_METADATA_URL: 'data:,invalid', DSH_TAVERN_ARCHIVE_URL: 'file:///nonexistent-tavern-test-archive',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await ensureUserExtensions(dataRoot)
    assert.equal(await readFile(path.join(app, 'bin/version.txt'), 'utf8'), version)
    for (const [file, content] of protectedFiles) assert.equal(await readFile(file, 'utf8'), content)
  }
})
