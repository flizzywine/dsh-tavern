import z from '@deepseek-ai/schemastery'
import { Settings, validateSettings } from './settings.js'
import { SETTINGS_IMPORT_MARKER, installSettingsMigration } from './shared/settings-migration.js'
// An array schema invents [] for an absent key, preventing one-time retirement.
const migrationSettings = z.object({ ...Settings.dict, pronunciationDictionary: z.any() })
const fields = { tts: z.transform(migrationSettings, value => {
  if (value.pronunciationDictionary === undefined) delete value.pronunciationDictionary
  return validateSettings(value)
}, true).volatile() }
export const Config = z.object({ ...fields, [SETTINGS_IMPORT_MARKER]: z.number().min(0).max(1).step(1).default(0).volatile() })
export const installTtsSettingsMigration = ctx => installSettingsMigration(ctx, fields)
