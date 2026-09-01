import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import { resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import { ensureUserExtensions, userExtensionPaths } from '../tavern-plugin/lib/domain/user-extensions.js'
import { resourceWorkspaceContext } from '../tavern-plugin/lib/domain/workspace-resources.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-user-extensions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'profile-data/tavern/data')
  return { root, dataRoot, paths: userExtensionPaths(dataRoot) }
}

test('首次初始化创建用户工具目录和清单，重复更新不会覆盖代码、配置或 Skill', async (t) => {
  const { dataRoot, paths } = await fixture(t)
  await Promise.all([ensureUserExtensions(dataRoot), ensureUserExtensions(dataRoot)])
  assert.equal(await readFile(paths.config, 'utf8'), '[]\n')
  const code = path.join(paths.tools, 'my-tool.mjs')
  const skill = path.join(paths.skills, 'my-skill/SKILL.md')
  await mkdir(path.dirname(skill), { recursive: true })
  const config = '# 用户注释\n- id: my-tool\n  name: ./tools/my-tool.mjs\n  config:\n    label: 自创工具\n'
  await writeFile(paths.config, config)
  await writeFile(code, 'export function apply(ctx) { /* 用户代码 */ }\n')
  await writeFile(skill, '# 用户 Skill\n')
  for (let upgrade = 0; upgrade < 3; upgrade++) await ensureUserExtensions(dataRoot)
  assert.equal(await readFile(paths.config, 'utf8'), config)
  assert.equal(await readFile(code, 'utf8'), 'export function apply(ctx) { /* 用户代码 */ }\n')
  assert.equal(await readFile(skill, 'utf8'), '# 用户 Skill\n')
})

test('清单损坏时保留原文件，不自动重置用户配置', async (t) => {
  const { dataRoot, paths } = await fixture(t)
  await ensureUserExtensions(dataRoot)
  await writeFile(paths.config, 'invalid: [')
  await ensureUserExtensions(dataRoot)
  assert.equal(await readFile(paths.config, 'utf8'), 'invalid: [')
})

test('原生加载入口固定在用户目录，不随程序版本路径变化', async () => {
  const preset = await readFile(new URL('../presets/tavern/agent.cordis.yml', import.meta.url), 'utf8')
  const entry = preset.match(/- id: user-tools\n[\s\S]*?(?=\n- id:|$)/)?.[0]
  assert.match(entry || '', /name: \.\/user-tools-bridge\/index.js/)
  const bridge = await readFile(new URL('../presets/tavern/user-tools-bridge/index.js', import.meta.url), 'utf8')
  assert.match(bridge, /ensureUserExtensions\(resolveTavernDataRoot\(\)\)/)
  assert.match(bridge, /ctx\.plugin\(ctx\.loader\.builtins\.include/)
  const bridgePackage = JSON.parse(await readFile(new URL('../presets/tavern/user-tools-bridge/package.json', import.meta.url), 'utf8'))
  const tavernPackage = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))
  assert.equal(bridgePackage.name, 'dsh-tavern-user-tools-bridge')
  assert.notEqual(bridgePackage.name, tavernPackage.name)
  for (const dshHome of ['/tmp/home with spaces', 'relative-home']) {
    assert.equal(userExtensionPaths(resolveTavernDataRoot({ dshHome })).config,
      path.resolve(dshHome, 'profile-data/tavern/data/tools.cordis.yml'))
  }
})

test('持久扩展目录只在高级能力 Skill 中按需说明', async () => {
  const context = resourceWorkspaceContext('/workspace/data/resources')
  const advancedSkill = await readFile(new URL('../presets/tavern/skills/tavern-advanced-capabilities/SKILL.md', import.meta.url), 'utf8')
  assert.doesNotMatch(context, /\/workspace\/data\/tools/)
  assert.doesNotMatch(context, /\/workspace\/data\/skills/)
  assert.doesNotMatch(context, /\/workspace\/data\/tools\.cordis\.yml/)
  assert.match(advancedSkill, /同级 `tools\/`/)
  assert.match(advancedSkill, /同级 `skills\/`/)
  assert.match(advancedSkill, /同级 `tools\.cordis\.yml`/)
  assert.doesNotMatch(context, /不得访问资源根目录之外/)
})

test('实际 Unix 安装脚本更新程序两次，用户工具、清单和 Skill 保持原样', { skip: process.platform === 'win32' }, async (t) => {
  const { root, dataRoot, paths } = await fixture(t)
  const source = path.join(root, 'source')
  const mockBin = path.join(root, 'mock-bin')
  const app = path.join(root, 'apps/dsh-tavern')
  await mkdir(path.join(source, 'bin'), { recursive: true })
  await mkdir(mockBin)
  for (const command of ['pnpm', 'dsh']) {
    await writeFile(path.join(mockBin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  }
  // Mock external package installation and the launcher; run the actual release
  // download/extract/copy path against a local Git repository (no network).
  await writeFile(path.join(source, 'package.json'), '{"name":"user-extension-update-fixture"}')
  await writeFile(path.join(source, 'bin/dsh-tavern.mjs'), '')
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh', 'config/fixture', 'presets/fixture', 'tavern-plugin/fixture', 'patches/fixture.patch']) {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true })
    await writeFile(path.join(source, file), '')
  }
  for (const file of ['bin/dsh-compatibility.mjs', 'config/dsh-compatibility.json']) {
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
        ...process.env, PATH: mockBin + path.delimiter + process.env.PATH,
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
