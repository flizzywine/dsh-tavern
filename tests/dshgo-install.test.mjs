import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  LOCAL_PACKAGES, NPM_PACKAGES, PNPM_ARGS, REPO_ROOT,
  installBundles, mergeProfileManifest, planInstall, workspaceYaml,
} from '../tavern-plugin/packages/dsh-tavern-dshgo/scripts/install-on-dshgo.mjs'
import { hostPackages } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/hosts.js'
import { TAVERN_BUNDLES } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

test('mergeProfileManifest：六个本地包 link 回源码目录，仓库结构才不被打平', () => {
  const merged = mergeProfileManifest({ name: 'web', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, { srcRoot: '/src/dsh-tavern-main', hosts: ['@deepseek-ai/dsh-tools'] })
  assert.equal(merged.dependencies['dsh-tavern-plugin'], 'link:/src/dsh-tavern-main/tavern-plugin')
  assert.equal(merged.dependencies['dsh-tavern-remote'], 'link:/src/dsh-tavern-main/tavern-plugin/packages/dsh-tavern-remote')
  for (const [name, version] of Object.entries(NPM_PACKAGES)) assert.equal(merged.dependencies[name], version)
  // overrides 不往 node_modules 放东西；宿主包必须作为直接依赖 link 进去。
  assert.equal(merged.dependencies['@deepseek-ai/dsh-tools'], 'link:/opt/dsh/node_modules/@deepseek-ai/dsh-tools')
  assert.equal(merged.overrides, undefined, '顶层 overrides 是 npm 字段，pnpm 不认')
})

test('workspaceYaml：宿主目录里有什么就 link 什么，不靠手写清单', () => {
  const hosts = ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-tools']
  const yaml = workspaceYaml(['dsh-web-mobile@3.1.0.patch'], '/opt/dsh', hosts)
  assert.match(yaml, /overrides:\n/)
  // YAML 的 plain scalar 不能以 @ 开头，键必须带引号，否则整份文件解析失败。
  assert.ok(!yaml.split('\n').some(line => /^\s+@/.test(line)))
  assert.ok(yaml.includes('"@deepseek-ai/dsh-agent"') || yaml.includes("'@deepseek-ai/dsh-agent'"))
  for (const name of hosts) assert.ok(yaml.includes(`link:/opt/dsh/node_modules/${name}`), name)
  assert.ok(!yaml.includes('@deepseek-ai/dsh-typert-protocol'), '只写传入的那几个')
})

test('hostPackages：扫目录，符号链接也算；目录不存在时有兜底清单', () => {
  const read = () => [
    { name: 'dsh-tools', isDirectory: () => true, isSymbolicLink: () => false },
    { name: 'dsh-settings', isDirectory: () => false, isSymbolicLink: () => true },
    { name: '.bin', isDirectory: () => false, isSymbolicLink: () => true },
  ]
  assert.deepEqual(hostPackages('/opt/dsh', read), ['@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-tools'])
  assert.ok(hostPackages('/nope').includes('@deepseek-ai/dsh-settings'))
})

test('mergeProfileManifest：bundle 保序补齐，官方与用户自己的不动，重复合并不增项', () => {
  const base = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-user-thing', 'dsh-web-mobile'] } } }
  const merged = mergeProfileManifest(base, { appRoot: '/opt/dsh', srcRoot: '/src/x', hosts: [] })
  // 官方两个与用户自己的顺序不动，酒馆的按 installBundles() 顺序补在后面，重复的不增项。
  assert.deepEqual(merged.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-user-thing', 'dsh-web-mobile', ...installBundles().filter(name => name !== 'dsh-web-mobile')])
  // 0.2.2 上会让引擎 fatal 的两个可选包默认不装。
  assert.ok(!merged.dsh.profile.bundles.includes('dsh-tavern-stage'))
  assert.ok(!merged.dsh.profile.bundles.includes('dsh-asset-library'))
  const again = mergeProfileManifest(merged, { appRoot: '/opt/dsh', srcRoot: '/src/x', hosts: [] })
  assert.deepEqual(again.dsh.profile.bundles, merged.dsh.profile.bundles)
})

test('mergeProfileManifest：用户自己装的依赖条目被保留', () => {
  const merged = mergeProfileManifest({ dependencies: { 'some-user-pkg': '^1.0.0' } })
  assert.equal(merged.dependencies['some-user-pkg'], '^1.0.0')
})

test('workspaceYaml：两条补丁按文件名对齐版本，proot 里那几条 pnpm 设置都在', () => {
  const yaml = workspaceYaml(['dsh-better-sidebar@0.28.0.patch', 'dsh-web-mobile@3.1.0.patch'])
  assert.match(yaml, /patchedDependencies:\n {2}dsh-better-sidebar@0\.28\.0: patches\/dsh-better-sidebar@0\.28\.0\.patch/)
  assert.match(yaml, / {2}dsh-web-mobile@3\.1\.0: patches\/dsh-web-mobile@3\.1\.0\.patch/)
  for (const line of ['nodeLinker: hoisted', 'confirmModulesPurge: false', 'ignorePnpmfile: true', '  sharp: true']) {
    assert.ok(yaml.includes(line), line)
  }
  // 按包名放行，不锁版本：sharp/undici 升级后会再拉新版本，锁版本等于下次再撞。
  assert.match(yaml, /minimumReleaseAgeExclude:\n(?: {2}- .*\n)* {2}- ws\n/)
  assert.match(yaml, / {2}- wasm-feature-detect\n/)
})

test('planInstall：先复制源码再改清单，最后才 pnpm install 与校验', () => {
  const plan = planInstall({ dshHome: '/root/.dsh', appRoot: '/opt/dsh' })
  assert.equal(plan.profile, '/root/.dsh/profiles/web')
  assert.deepEqual(plan.steps.map(step => step.kind), ['copy-file', 'copy-file', 'manifest', 'workspace', 'pnpm', 'verify'])
  assert.deepEqual(plan.missingSources, [], '在仓库根跑时源码应齐全')
  assert.deepEqual(PNPM_ARGS.slice(0, 1), ['install'])
})

test('planInstall：源码目录不对时把缺的文件一次列出来', (t) => {
  const empty = mkdtempSync(join(tmpdir(), 'tavern-dshgo-install-'))
  t.after(() => rmSync(empty, { recursive: true, force: true }))
  const plan = planInstall({ srcRoot: empty })
  assert.equal(plan.missingSources.length, Object.keys(LOCAL_PACKAGES).length + 2)
  assert.ok(plan.missingSources.every(file => file.startsWith(empty)))
})

test('REPO_ROOT：从包内 scripts 往上三级就是仓库根', () => {
  assert.ok(existsSync(join(REPO_ROOT, 'tavern-plugin', 'package.json')))
})

test('mergeProfileManifest：重跑会把早先多塞的宿主 link 清掉，清单不会越滚越大', () => {
  const stale = { '@deepseek-ai/p1': 'link:/opt/dsh/node_modules/@deepseek-ai/p1', '@deepseek-ai/dsh-tools': 'link:/opt/dsh/node_modules/@deepseek-ai/dsh-tools', 'dsh-tavern-plugin': 'link:/src/tavern-plugin' }
  const out = mergeProfileManifest({ dependencies: stale, dsh: { profile: { bundles: [] } } }, { srcRoot: '/src', appRoot: '/opt/dsh', hosts: ['@deepseek-ai/dsh-tools'] })
  assert.deepEqual(Object.keys(out.dependencies).filter(name => name.startsWith('@deepseek-ai/')), ['@deepseek-ai/dsh-tools'])
  assert.equal(out.dependencies['dsh-tavern-plugin'], 'link:/src/tavern-plugin', '本地包不动')
})
