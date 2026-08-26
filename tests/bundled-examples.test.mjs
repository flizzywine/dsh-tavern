import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createBundledExampleInstaller } from '../tavern-plugin/lib/domain/bundled-examples.js'
import { inspectPreset } from '../tavern-plugin/lib/domain/preset-reading.js'

const presetName = 'Kemini Dramatron 陨落的天才v1.26.json'
const planName = 'Kemini Dramatron 陨落的天才v1.26 · 破限方案'

function fixture(overrides = {}) {
  let marker = overrides.marker
  const presets = [...(overrides.presets || [])]
  const plans = [...(overrides.plans || [])]
  const calls = []
  const installer = createBundledExampleInstaller({
    readMarker: async function () { return marker },
    writeMarker: async function (value) { marker = value; calls.push(['marker', value]) },
    readBundledText: async function (relative) {
      calls.push(['read', relative])
      return relative.startsWith('presets/') ? '{"prompts":[]}' : JSON.stringify({ schema: 'dsh-tavern/bypass-plan', version: 1, plan: { name: planName, entries: [], regexScripts: [] } })
    },
    listPresetPaths: async function () { return presets },
    importPreset: async function (payload) { calls.push(['preset', payload]); presets.push('presets/' + payload.name) },
    listPlans: async function () { return plans },
    importPlanPackage: async function (document) { calls.push(['plan', document]); plans.push({ name: document.plan.name }) }
  })
  return { installer, calls, marker: function () { return marker } }
}

test('首次运行导入 Kemini 外部预设与对应破限方案，但不激活方案', async function () {
  const setup = fixture()
  const result = await setup.installer.install()
  assert.deepEqual(result, { installed: true, preset: true, plan: true })
  assert.equal(setup.calls.filter(function (call) { return call[0] === 'preset' }).length, 1)
  assert.equal(setup.calls.filter(function (call) { return call[0] === 'plan' }).length, 1)
  assert.deepEqual(setup.marker(), { version: 1 })
})

test('已有同名范例时不覆盖，只记录范例初始化完成', async function () {
  const setup = fixture({ presets: ['presets/' + presetName], plans: [{ name: planName }] })
  const result = await setup.installer.install()
  assert.deepEqual(result, { installed: true, preset: false, plan: false })
  assert.equal(setup.calls.some(function (call) { return call[0] === 'preset' || call[0] === 'plan' }), false)
  assert.deepEqual(setup.marker(), { version: 1 })
})

test('初始化标记存在后不再恢复被用户删除的范例', async function () {
  const setup = fixture({ marker: { version: 1 } })
  const result = await setup.installer.install()
  assert.deepEqual(result, { installed: false, preset: false, plan: false })
  assert.deepEqual(setup.calls, [])
})

test('仓库随附的 Kemini 预设与破限方案都是可读取的发布文件', async function () {
  const presetText = await readFile(new URL('../tavern-plugin/examples/presets/' + encodeURIComponent(presetName), import.meta.url), 'utf8')
  const preset = inspectPreset(presetText, presetName)
  assert.equal(preset.valid, true)
  assert.equal(preset.recognized, true)
  assert.equal(preset.promptCount, 47)

  const planText = await readFile(new URL('../tavern-plugin/examples/bypass-plans/' + encodeURIComponent(planName + '.json'), import.meta.url), 'utf8')
  const plan = JSON.parse(planText)
  assert.equal(plan.schema, 'dsh-tavern/bypass-plan')
  assert.equal(plan.version, 1)
  assert.equal(plan.plan.name, planName)
  assert.equal(plan.plan.entries.length, 12)
  assert.equal(plan.plan.regexScripts.length, 7)
})
