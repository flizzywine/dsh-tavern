import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  HOST_PACKAGES, LOCAL_PACKAGES, NPM_PACKAGES, PNPM_ARGS, REPO_ROOT,
  mergeProfileManifest, planInstall, workspaceYaml,
} from '../tavern-plugin/packages/dsh-tavern-dshgo/scripts/install-on-dshgo.mjs'
import { TAVERN_BUNDLES } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

test('mergeProfileManifest：六个本地包走 file:，两个 npm 包钉死版本', () => {
  const merged = mergeProfileManifest({ name: 'web', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } })
  for (const name of Object.keys(LOCAL_PACKAGES)) assert.equal(merged.dependencies[name], `file:./vendor/${name}`)
  for (const [name, version] of Object.entries(NPM_PACKAGES)) assert.equal(merged.dependencies[name], version)
  assert.ok(!('@deepseek-ai/dsh-tools' in merged.dependencies), '宿主包不进 dependencies')
})

test('mergeProfileManifest：五个宿主包写进 overrides 指回 App 里的那一份', () => {
  const merged = mergeProfileManifest({}, { appRoot: '/opt/dsh' })
  assert.deepEqual(Object.keys(merged.overrides).sort(), [...HOST_PACKAGES].sort())
  assert.equal(merged.overrides['@deepseek-ai/dsh-tools'], 'link:/opt/dsh/node_modules/@deepseek-ai/dsh-tools')
})

test('mergeProfileManifest：bundle 保序补齐，官方与用户自己的不动，重复合并不增项', () => {
  const base = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-user-thing', 'dsh-web-mobile'] } } }
  const once = mergeProfileManifest(base)
  assert.deepEqual(once.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'dsh-user-thing', 'dsh-web-mobile', ...TAVERN_BUNDLES.filter(name => name !== 'dsh-web-mobile')])
  assert.deepEqual(mergeProfileManifest(once).dsh.profile.bundles, once.dsh.profile.bundles)
  assert.deepEqual(base.dsh.profile.bundles.length, 3, '不改入参')
})

test('mergeProfileManifest：已存在的 overrides / dependencies 条目被保留', () => {
  const merged = mergeProfileManifest({
    dependencies: { 'some-user-pkg': '^1.0.0' },
    overrides: { 'left-pad': '1.3.0' },
  })
  assert.equal(merged.dependencies['some-user-pkg'], '^1.0.0')
  assert.equal(merged.overrides['left-pad'], '1.3.0')
})

test('workspaceYaml：两条补丁按文件名对齐版本，proot 里那几条 pnpm 设置都在', () => {
  const yaml = workspaceYaml(['dsh-better-sidebar@0.28.0.patch', 'dsh-web-mobile@3.1.0.patch'])
  assert.match(yaml, /patchedDependencies:\n {2}dsh-better-sidebar@0\.28\.0: patches\/dsh-better-sidebar@0\.28\.0\.patch/)
  assert.match(yaml, / {2}dsh-web-mobile@3\.1\.0: patches\/dsh-web-mobile@3\.1\.0\.patch/)
  for (const line of ['nodeLinker: hoisted', 'confirmModulesPurge: false', 'ignorePnpmfile: true', '  sharp: true']) {
    assert.ok(yaml.includes(line), line)
  }
})

test('planInstall：先复制源码再改清单，最后才 pnpm install 与校验', () => {
  const plan = planInstall({ dshHome: '/root/.dsh', appRoot: '/opt/dsh' })
  assert.equal(plan.profile, '/root/.dsh/profiles/web')
  assert.equal(plan.vendor, '/root/.dsh/profiles/web/vendor')
  assert.deepEqual(plan.steps.map(step => step.kind), [
    ...Array(Object.keys(LOCAL_PACKAGES).length).fill('copy'),
    'copy-file', 'copy-file', 'manifest', 'workspace', 'pnpm', 'verify',
  ])
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
