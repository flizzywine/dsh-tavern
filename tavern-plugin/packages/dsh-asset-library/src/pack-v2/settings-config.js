import z from '@deepseek-ai/schemastery'
import { PACK_SETTINGS_SECTION, validatePackSettings } from './native-settings.js'
import { CATALOGUE_SETTINGS_SECTION, catalogueSettingsModel } from '../pack-catalogue/settings.js'
import { SETTINGS_IMPORT_MARKER, importLegacySettings, installSettingsMigration } from '../shared/settings-migration.js'

const fields = {
  [PACK_SETTINGS_SECTION]: z.transform(z.object({ globalEnabledPackIds: z.any().default([]) }), validatePackSettings, true).default({ globalEnabledPackIds: [] }).volatile(),
  [CATALOGUE_SETTINGS_SECTION]: z.transform(z.object({ sources: z.any().default([]), preferredDownloadId: z.string().default(''), mirrorPrefix: z.string().default('') }), value => {
    const result = catalogueSettingsModel().validate(value)
    // Runtime exposure still requires the configured official URL; a stored flag is not provenance.
    result.sources = result.sources.map((source, index) => ({ ...source, ...(value.sources[index].builtin === true ? { builtin: true } : {}) }))
    return result
  }, true).volatile(),
}
export const Config = z.object({ ...fields, [SETTINGS_IMPORT_MARKER]: z.number().min(0).max(1).step(1).default(0).volatile() })
export const importLegacyAssetSettings = (ctx, provider) => importLegacySettings(ctx, provider, fields)
export const installAssetSettingsMigration = ctx => installSettingsMigration(ctx, fields)
