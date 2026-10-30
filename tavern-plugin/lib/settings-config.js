import z from '@deepseek-ai/schemastery'
import { ENGINE_SECTION, defaultAssetEngineSettings, validateAssetEngineSettings } from './domain/asset-engine-settings.js'
import { DIRECTOR_PROBE_SECTION, validateDirectorProbeSettings } from './director-probe.js'
import { MOD_SETTINGS_SECTION, defaultModSettings, validateModSettings } from './mod-owners.js'
import { SETTINGS_IMPORT_MARKER as PLUGIN_SETTINGS_MARKER, importLegacySettings, installSettingsMigration } from './settings-migration.js'
export { PLUGIN_SETTINGS_MARKER }

import { MANAGED_MOD_SETTINGS_SECTION } from './mod-system-settings.js'
import { emptyGlobalMods, validateModSystem } from './domain/mod-system-contract.js'

const managed = emptyGlobalMods()
const engine = defaultAssetEngineSettings()
const fields = {
  [MANAGED_MOD_SETTINGS_SECTION]: z.transform(z.object(Object.fromEntries(Object.entries(managed).map(([key, value]) => [key, z.any().default(value)]))), value => { validateModSystem('global', value); return value }, true).default(managed).volatile(),
  [ENGINE_SECTION]: z.transform(z.object(Object.fromEntries(Object.entries(engine).map(([key, value]) => [key, z.any().default(value)]))), value => {
    const { catalogueCaps: retired, ...stored } = value
    return validateAssetEngineSettings({ ...stored, dimensions: { cg: engine.dimensions.cg, ...stored.dimensions } })
  }, true).default(engine).volatile(),
  [DIRECTOR_PROBE_SECTION]: z.transform(z.object({ models: z.any().default({}) }), validateDirectorProbeSettings, true).default({ models: {} }).volatile(),
  [MOD_SETTINGS_SECTION]: z.transform(z.object({ global: z.any().default(defaultModSettings().global), grants: z.any().default({}) }), validateModSettings, true).default(defaultModSettings()).volatile(),
}
export const Config = z.object({ ...fields, [PLUGIN_SETTINGS_MARKER]: z.number().min(0).max(1).step(1).default(0).volatile() })
export const importLegacyPluginSettings = (ctx, provider) => importLegacySettings(ctx, provider, fields)
export const installPluginSettingsMigration = ctx => installSettingsMigration(ctx, fields)
