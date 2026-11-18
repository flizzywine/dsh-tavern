// 命运之骰内置插件：打包同步、清单登记、安装产物与宿主半 RPC 接线。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { apply as applyFateDicePlugin, DEFAULT_GLOBAL_SETTINGS, PLUGIN_VERSION } from '../tavern-plugin/packages/dsh-tavern-fate-dice/lib/index.js'
import { buildFateDiceClient } from '../tavern-plugin/packages/dsh-tavern-fate-dice/build.mjs'
import {
  BUNDLED_TAVERN_PLUGINS,
  SOURCE_FILE,
  installBundledTavernPlugins,
  readBundledTavernPlugin,
} from '../bin/bundled-tavern-plugins.mjs'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGE_ROOT = new URL('../tavern-plugin/packages/dsh-tavern-fate-dice/', import.meta.url)
const PLUGIN_NAME = 'dsh-tavern-fate-dice'
const quiet = { warn() {}, log() {} }

function createPluginFiber(pluginName, parentService) {
  const cleanups = []
  const ctx = {
    fiber: { name: pluginName },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
  }
  const boundService = Object.create(parentService, {
    ctx: { value: ctx, enumerable: false },
  })
  return {
    ctx: {
      tavern: boundService,
      inject(_deps, cb) {
        if (typeof cb === 'function') cb({ llm: null })
      },
      effect: fn => {
        const dispose = fn()
        if (typeof dispose === 'function') cleanups.push(dispose)
        return dispose
      },
    },
    settle(result) {
      if (typeof result === 'function') cleanups.push(result)
    },
    dispose() {
      for (const fn of cleanups.splice(0)) fn()
    },
  }
}

test('内置命运之骰插件包 client.js 与源码保持同步', async () => {
  const res = await buildFateDiceClient({ check: true, packageRoot: PACKAGE_ROOT })
  assert.equal(res.changed, false)
})

test('命运之骰插件包清单与 cordis.patch.yml 符合内置插件契约', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8'))
  assert.equal(pkg.name, PLUGIN_NAME)
  assert.equal(pkg.version, PLUGIN_VERSION)
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [])
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.ok(pkg.dsh?.client?.inject?.includes('dsh-tavern-plugin'))
  assert.equal(pkg.dsh?.compatibility?.tavernApiVersion, 8)
  const patchText = await readFile(new URL('cordis.patch.yml', PACKAGE_ROOT), 'utf8')
  assert.match(patchText, /id:\s*dsh-tavern-fate-dice/)
})

test('命运之骰已登记到 BUNDLED_TAVERN_PLUGINS，且可安装到 plugins/ 并排除构建输入', () => {
  const entry = BUNDLED_TAVERN_PLUGINS.find(item => item.folder === PLUGIN_NAME)
  assert.ok(entry, 'BUNDLED_TAVERN_PLUGINS 缺少 dsh-tavern-fate-dice')
  const readRes = readBundledTavernPlugin(REPO_ROOT, entry)
  assert.equal(readRes.ok, true, readRes.reason)

  const dataRoot = mkdtempSync(path.join(tmpdir(), 'tavern-fate-dice-data-'))
  try {
    const results = installBundledTavernPlugins({ sourceRoot: REPO_ROOT, dataRoot, logger: quiet })
    const res = results.find(item => item.packageName === PLUGIN_NAME)
    assert.ok(res)
    assert.equal(res.action, 'installed')
    const target = path.join(dataRoot, 'plugins', PLUGIN_NAME)
    for (const file of ['package.json', 'lib/index.js', 'client.js', 'cordis.patch.yml', SOURCE_FILE]) {
      assert.ok(existsSync(path.join(target, file)), '缺少 ' + file)
    }
    for (const file of ['build.mjs', 'src']) {
      assert.equal(existsSync(path.join(target, file)), false, file + ' 不该进插件目录')
    }
    const sourceRecord = JSON.parse(readFileSync(path.join(target, SOURCE_FILE), 'utf8'))
    assert.equal(sourceRecord.kind, 'builtin')
    assert.equal(sourceRecord.bundled, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('宿主半能挂上 createTavernPluginApi 并注册 fate-dice:* RPC，停用后清理', async () => {
  const api = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
  })
  const fiber = createPluginFiber(PLUGIN_NAME, api.service)
  const dispose = applyFateDicePlugin(fiber.ctx)
  fiber.settle(dispose)

  const freeRoll = await api.callHandler('fate-dice:free-roll', { expression: '1d20' })
  assert.equal(freeRoll.ok, true)
  assert.ok(freeRoll.result.total >= 1 && freeRoll.result.total <= 20)

  const workbench = await api.callHandler('fate-dice:workbench', {})
  assert.ok(workbench && typeof workbench === 'object')
  assert.equal(DEFAULT_GLOBAL_SETTINGS.enabled, false)
  assert.equal(workbench.settings?.enabled, false)

  const enabledRes = await api.callHandler('fate-dice:save-global-settings', { settings: { enabled: true } })
  assert.equal(enabledRes.ok, true)
  assert.equal(enabledRes.settings?.enabled, true)

  const workbenchAfterEnable = await api.callHandler('fate-dice:workbench', {})
  assert.equal(workbenchAfterEnable.settings?.enabled, true)

  const disabledRes = await api.callHandler('fate-dice:save-global-settings', { settings: { enabled: false } })
  assert.equal(disabledRes.ok, true)
  assert.equal(disabledRes.settings?.enabled, false)

  const clientText = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  assert.match(clientText, /启用命运之骰/)

  fiber.dispose()
  await assert.rejects(api.callHandler('fate-dice:free-roll', { expression: '1d20' }), /没有名为 fate-dice:free-roll 的插件处理函数/)
})
