import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseDocument } from 'yaml'

import {
  PROFILE_CONFIGURATION_VERSION,
  beginProfileConfigurationUpdate,
  loadProfileManifest,
  mergeProfileManifest,
  migrateLegacyProfilePatch,
  prepareProfilePatch,
} from '../bin/profile-configuration.mjs'

const legacyPatch = await readFile(new URL('../config/legacy-profile-patch-v0.6.yml', import.meta.url), 'utf8')

function sourceManifest() {
  return {
    dependencies: {
      'dsh-better-sidebar': '0.16.0',
      'dsh-tavern-plugin': 'link:./tavern-plugin',
    },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-better-sidebar', 'dsh-tavern-plugin'],
      },
    },
  }
}

test('Profile 更新替换项目管理项并保留用户额外插件', () => {
  const current = {
    name: 'dsh-profile-tavern',
    description: '用户备注',
    dependencies: {
      'dsh-better-sidebar': '0.14.0',
      'dsh-tavern-plugin': 'link:/old/tavern-plugin',
      'dsh-codex-connect': '1.0.0',
      'user-extra-plugin': '2.0.0',
    },
    dsh: {
      customFlag: true,
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-better-sidebar', 'dsh-codex-connect', 'user-extra-plugin'],
      },
    },
  }

  const next = mergeProfileManifest({
    source: sourceManifest(), current, pluginPath: '/app/tavern-plugin', dataRoot: '/data/tavern', host: 'cli', dshVersion: '0.1.2',
  })

  assert.equal(next.description, '用户备注')
  assert.equal(next.dependencies['user-extra-plugin'], '2.0.0')
  assert.equal(next.dependencies['dsh-better-sidebar'], '0.16.0')
  assert.equal(next.dependencies['dsh-tavern-plugin'], 'link:/app/tavern-plugin')
  assert.equal(next.dependencies['dsh-codex-connect'], undefined)
  assert.equal(next.dsh.customFlag, true)
  assert.deepEqual(next.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-better-sidebar', 'dsh-tavern-plugin', 'user-extra-plugin',
  ])
  assert.deepEqual(next.dshTavern.managedBundles, sourceManifest().dsh.profile.bundles)
  assert.deepEqual(next.dshTavern.managedDependencies, ['dsh-better-sidebar', 'dsh-tavern-plugin'])
  assert.equal(next.dshTavern.profileConfigurationVersion, PROFILE_CONFIGURATION_VERSION)
})

test('后续更新依据上次管理清单删除退役项目项，不误删用户项', () => {
  const current = {
    dependencies: { 'old-managed': '1.0.0', 'user-extra': '3.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'old-managed', 'user-extra'] } },
    dshTavern: {
      managedBundles: ['@deepseek-ai/dsh-base', 'old-managed'],
      managedDependencies: ['old-managed'],
      profileConfigurationVersion: PROFILE_CONFIGURATION_VERSION,
    },
  }
  const source = sourceManifest()
  source.dependencies['new-managed'] = '2.0.0'
  source.dsh.profile.bundles.push('new-managed')

  const next = mergeProfileManifest({
    source, current, pluginPath: '/app/tavern-plugin', dataRoot: '/data/tavern', host: 'desktop', dshVersion: '0.1.2',
  })

  assert.equal(next.dependencies['old-managed'], undefined)
  assert.equal(next.dependencies['user-extra'], '3.0.0')
  assert.equal(next.dependencies['new-managed'], '2.0.0')
  assert.equal(next.dsh.profile.bundles.includes('old-managed'), false)
  assert.equal(next.dsh.profile.bundles.includes('user-extra'), true)
  assert.equal(next.dsh.profile.bundles.includes('new-managed'), true)
})

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

test('旧项目模板没有用户修改时迁移为空用户覆盖层', () => {
  const migrated = migrateLegacyProfilePatch(legacyPatch, legacyPatch)
  const parsed = parseDocument(migrated)
  assert.equal(parsed.errors.length, 0)
  assert.deepEqual(parsed.toJS(), [])
})

test('YAML 迁移区分 js 标签与普通字符串，不误删用户覆盖', () => {
  const current = `- id: session-persistence-jsonl
  config:
    root: "dshHomePath('profile-data', 'tavern', 'sessions')"
`
  const migrated = migrateLegacyProfilePatch(current, legacyPatch)
  assert.equal(migrated, current)
})

test('损坏的用户 YAML 明确失败，不生成猜测结果', () => {
  assert.throws(() => migrateLegacyProfilePatch('- id: broken\n  config: [', legacyPatch), /无法读取现有 Tavern Profile 配置/)
})

test('旧 Profile 配置损坏时在失败前留下原文件备份', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-profile-broken-'))
  const patchPath = path.join(directory, 'cordis.patch.yml')
  const source = '- id: broken\n  config: ['
  await writeFile(patchPath, source)
  try {
    assert.throws(() => prepareProfilePatch({
      profileDir: directory,
      templateText: '[]\n',
      legacyManagedText: legacyPatch,
      profileConfigurationVersion: 0,
      timestamp: '20260824121000',
    }), /无法读取现有 Tavern Profile 配置/)
    assert.equal(await readFile(patchPath, 'utf8'), source)
    assert.equal(await readFile(`${patchPath}.backup.20260824121000`, 'utf8'), source)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('旧 Profile manifest 损坏时在失败前留下原文件备份', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-profile-manifest-broken-'))
  const manifestPath = path.join(directory, 'package.json')
  const source = '{"name":'
  await writeFile(manifestPath, source)
  try {
    assert.throws(() => loadProfileManifest({
      profileDir: directory,
      timestamp: '20260824121500',
    }), /无法读取现有 Tavern Profile package.json/)
    assert.equal(await readFile(manifestPath, 'utf8'), source)
    assert.equal(await readFile(`${manifestPath}.backup.20260824121500`, 'utf8'), source)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('完成所有权迁移后更新不再读写用户 patch', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-profile-user-layer-'))
  const patchPath = path.join(directory, 'cordis.patch.yml')
  const source = '# 用户原始排版\n-   id: user-extra\n'
  await writeFile(patchPath, source)
  try {
    const prepared = prepareProfilePatch({
      profileDir: directory,
      templateText: '[]\n',
      legacyManagedText: legacyPatch,
      profileConfigurationVersion: PROFILE_CONFIGURATION_VERSION,
      timestamp: '20260824122000',
    })
    assert.equal(prepared, undefined)
    assert.equal(await readFile(patchPath, 'utf8'), source)
    assert.equal(existsSync(`${patchPath}.backup.20260824122000`), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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
