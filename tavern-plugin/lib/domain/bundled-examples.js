const BUNDLED_EXAMPLES_VERSION = 2
const PRESET_NAME = 'Kemini Dramatron 陨落的天才v1.26.json'
const PRESET_PATH = 'presets/' + PRESET_NAME
const PLAN_NAME = 'Kemini Dramatron 陨落的天才v1.26 · 破限方案'

function required(options, name) {
  if (typeof options[name] !== 'function') throw new TypeError('内置范例缺少适配器：' + name)
  return options[name]
}

export function createBundledExampleInstaller(options = {}) {
  const readMarker = required(options, 'readMarker')
  const writeMarker = required(options, 'writeMarker')
  const readBundledText = required(options, 'readBundledText')
  const listPresetPaths = required(options, 'listPresetPaths')
  const importPreset = required(options, 'importPreset')
  const listPlans = required(options, 'listPlans')
  const importPlanPackage = required(options, 'importPlanPackage')
  const setPlanCompatibleModels = required(options, 'setPlanCompatibleModels')

  async function install() {
    const marker = await readMarker()
    if (marker && Number(marker.version) >= BUNDLED_EXAMPLES_VERSION) {
      return { installed: false, preset: false, plan: false }
    }

    let preset = false
    let plan = false
    const presetPaths = await listPresetPaths()
    if (!presetPaths.includes(PRESET_PATH)) {
      await importPreset({ name: PRESET_NAME, text: await readBundledText('presets/' + PRESET_NAME) })
      preset = true
    }

    const plans = await listPlans()
    const existingPlan = plans.find(function (item) { return item && item.name === PLAN_NAME })
    if (!existingPlan) {
      const document = JSON.parse(await readBundledText('bypass-plans/' + PLAN_NAME + '.json'))
      await importPlanPackage(document)
      plan = true
    } else if (!Array.isArray(existingPlan.compatibleModels) || existingPlan.compatibleModels.length === 0) {
      await setPlanCompatibleModels(existingPlan.id, ['gemini-3.7-flash'])
    }

    await writeMarker({ version: BUNDLED_EXAMPLES_VERSION })
    return { installed: true, preset, plan }
  }

  return Object.freeze({ install })
}
