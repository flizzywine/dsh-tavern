import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseDocument } from 'yaml'

import { beginProfileConfigurationUpdate, mergeProfileManifest, migrateLegacyProfilePatch } from '../bin/profile-configuration.mjs'

const legacyPatch = await readFile(new URL('../config/legacy-profile-patch-v0.6.yml', import.meta.url), 'utf8')

function sourceManifest() {
  return {
    dependencies: {
      'dsh-web-mobile': '2.4.1',
      'dsh-better-sidebar': '0.16.0',
      'dsh-tavern-plugin': 'link:./tavern-plugin',
      'dsh-tavern-remote': 'link:./tavern-plugin/packages/dsh-tavern-remote',
    },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-web-mobile', 'dsh-better-sidebar', 'dsh-tavern-plugin', 'dsh-tavern-remote'],
      },
    },
  }
}

for (const recorded of [false, true]) {
  test(`移动端插件改名迁移不重复加载，并保留用户插件（管理记录：${recorded}）`, () => {
    const oldName = '@dsh-external/dsh-mobile-nav'
    const current = {
      dependencies: { [oldName]: 'github:mexiaosqwq/dsh-web-mobile#old', 'user-plugin': 'link:/user/plugin' },
      dsh: { profile: { bundles: [oldName, 'user-plugin'] } },
      ...(recorded ? { dshTavern: { managedBundles: [oldName], managedDependencies: [oldName] } } : {}),
    }
    const options = { source: sourceManifest(), current, pluginPath: '/app/tavern-plugin', dataRoot: '/data', host: 'android' }
    const next = mergeProfileManifest(options)
    assert.equal(next.dependencies[oldName], undefined)
    assert.equal(next.dsh.profile.bundles.includes(oldName), false)
    assert.equal(next.dependencies['dsh-web-mobile'], '2.4.1')
    assert.equal(next.dsh.profile.bundles.filter(name => name === 'dsh-web-mobile').length, 1)
    assert.equal(next.dependencies['user-plugin'], 'link:/user/plugin')
    assert.ok(next.dsh.profile.bundles.includes('user-plugin'))
    assert.deepEqual(mergeProfileManifest({ ...options, current: next }), next)
  })
}

for (const host of ['desktop', 'android', 'cli']) {
  for (const recorded of [false, true]) {
    test(`平台移动插件选择与重复升级：${host}，管理记录：${recorded}`, async () => {
      const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
      const names = ['dsh-web-mobile', '@dsh-external/dsh-mobile-nav', 'dsh-pocket']
      const current = {
        dependencies: { ...Object.fromEntries(names.map(name => [name, '1.0.0'])), 'user-extra': '3.0.0' },
        dsh: { profile: { bundles: [...names, 'user-extra'] } },
        ...(recorded ? { dshTavern: { managedBundles: ['dsh-web-mobile'], managedDependencies: ['dsh-web-mobile'] } } : {}),
      }
      const options = { source, pluginPath: '/app/tavern-plugin', dataRoot: '/data', host }
      const next = mergeProfileManifest({ ...options, current })
      assert.equal(next.dsh.bundle, undefined)
      const selected = host === 'android' ? 'dsh-web-mobile' : host === 'desktop' ? 'dsh-pocket' : null
      // CLI ships no layout: only what Tavern managed before goes; user-installed layouts stay.
      const kept = selected ? [selected] : recorded ? ['@dsh-external/dsh-mobile-nav', 'dsh-pocket'] : ['dsh-pocket']
      if (selected) {
        assert.equal(next.dependencies[selected], (source.dependencies[selected] ?? source.devDependencies[selected]))
        assert.ok(next.dshTavern.managedBundles.includes(selected))
        assert.ok(next.dshTavern.managedDependencies.includes(selected))
      }
      assert.equal(next.dependencies['user-extra'], '3.0.0')
      assert.ok(next.dsh.profile.bundles.includes('user-extra'))
      for (const name of names) {
        assert.equal(next.dsh.profile.bundles.filter(value => value === name).length, kept.includes(name) ? 1 : 0)
        if (!kept.includes(name)) assert.equal(next.dependencies[name], undefined)
        else if (!selected) assert.equal(next.dependencies[name], '1.0.0')
      }
      assert.deepEqual(mergeProfileManifest({ ...options, current: next }), next)
      const fresh = mergeProfileManifest(options)
      assert.deepEqual(fresh.dsh.profile.bundles.filter(name => names.includes(name)), selected ? [selected] : [])
      // Every bundle the repository links from tavern-plugin is installed with it (a bundle without its
      // dependency is skipped at startup, e.g. the asset library).
      const linked = Object.entries(source.devDependencies).filter(([name, spec]) => spec.startsWith('link:./tavern-plugin') && source.dsh.profile.bundles.includes(name))
      assert.ok(linked.some(([name]) => name === 'dsh-asset-library'))
      for (const [name, spec] of linked) assert.equal(fresh.dependencies[name], 'link:' + path.resolve('/app', spec.slice('link:'.length)).replaceAll(path.sep, '/'), name)
      for (const manifest of [next, fresh]) {
        assert.equal(manifest.dependencies['dsh-dream-skin'], 'link:/app/tavern-plugin/packages/dsh-dream-skin')
        assert.equal(manifest.dsh.profile.bundles.filter(name => name === 'dsh-dream-skin').length, 1)
        assert.ok(manifest.dshTavern.managedDependencies.includes('dsh-dream-skin'))
      }
      const manualSkin = mergeProfileManifest({ ...options, current: {
        ...current,
        dependencies: { ...current.dependencies, 'dsh-dream-skin': '^9.23.0' },
        dsh: { profile: { bundles: [...current.dsh.profile.bundles, 'dsh-dream-skin'] } },
      } })
      assert.equal(manualSkin.dependencies['dsh-dream-skin'], next.dependencies['dsh-dream-skin'])
      assert.equal(manualSkin.dsh.profile.bundles.filter(name => name === 'dsh-dream-skin').length, 1)
    })
  }
}

test('首次迁移按 YAML 结构移除旧项目配置并保留用户覆盖', () => {
  const current = `# 用户排版可以不同
- config:
    root: !!js dshHomePath('profile-data', 'tavern', 'sessions')
  id: session-persistence-jsonl
- id: bash-sandbox
  config:
    timeoutMs: 1234
    maxTimeoutMs: 5678
- id: user-extra
  config:
    enabled: true
- insert:
    - name: dsh-tavern-plugin
      inject: [fs, llm, webServer, tools, agentDefaultModel, sandboxPolicy, shell, agentPresets]
      id: dsh-tavern
    - id: user-insert
      name: user-extra-plugin
`

  const migrated = migrateLegacyProfilePatch(current, legacyPatch)
  const parsed = parseDocument(migrated)
  assert.equal(parsed.errors.length, 0)
  assert.deepEqual(parsed.toJS(), [
    { id: 'bash-sandbox', config: { timeoutMs: 1234, maxTimeoutMs: 5678 } },
    { id: 'user-extra', config: { enabled: true } },
    { insert: [{ id: 'user-insert', name: 'user-extra-plugin' }] },
  ])
})

test('配置事务先备份并原子写入，验证失败时可以恢复原文件', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-profile-config-'))
  const manifestPath = path.join(directory, 'package.json')
  const patchPath = path.join(directory, 'cordis.patch.yml')
  const originalManifest = '{"name":"before"}\n'
  const originalPatch = '- id: user-before\n'
  await writeFile(manifestPath, originalManifest)
  await writeFile(patchPath, originalPatch)

  try {
    const transaction = await beginProfileConfigurationUpdate({
      profileDir: directory,
      manifest: { name: 'after' },
      patchText: '- id: user-after\n',
      timestamp: '20260824120000',
    })
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).name, 'after')
    assert.equal(await readFile(patchPath, 'utf8'), '- id: user-after\n')
    assert.equal(existsSync(`${manifestPath}.backup.20260824120000`), true)
    assert.equal(existsSync(`${patchPath}.backup.20260824120000`), true)

    await transaction.rollback()
    assert.equal(await readFile(manifestPath, 'utf8'), originalManifest)
    assert.equal(await readFile(patchPath, 'utf8'), originalPatch)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
