import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { parseDocument } from 'yaml'
import { SETTINGS_FILE, TAVERN_SIDEBAR_DEFAULTS, SIDEBAR_DEFAULTS_VERSION } from './launcher-environment.mjs'

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function applySidebarDefaults(settings = {}) {
  const document = record(settings)
  const current = record(document['dsh-better-sidebar'])
  const tavernSettings = record(document['dsh-tavern'])
  const currentDefaultsVersion = Number(tavernSettings.sidebarDefaultsVersion)
  const migrateResourcesTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 3
  const migrateCardLibraryTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 4
  const migrateNativeFiles = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 5
  const migratePresetsTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 7
  const removeBoundaryPromptsTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 8
  const tabsEnabled = {
    ...TAVERN_SIDEBAR_DEFAULTS.tabsEnabled,
    ...record(current.tabsEnabled),
  }
  if (migrateResourcesTab) {
    tabsEnabled['dsh-tavern:resources'] = true
  }
  if (migrateCardLibraryTab) {
    tabsEnabled['dsh-tavern:cards'] = true
  }
  if (migratePresetsTab) {
    tabsEnabled['dsh-tavern:presets'] = true
  }
  if (removeBoundaryPromptsTab) delete tabsEnabled['dsh-tavern:boundary-prompts']
  const viewersEnabled = {
    ...TAVERN_SIDEBAR_DEFAULTS.viewersEnabled,
    ...record(current.viewersEnabled),
  }
  if (migrateNativeFiles) {
    tabsEnabled.editor = true
    viewersEnabled.markdown = true
    viewersEnabled.code = true
  }
  return {
    ...document,
    'dsh-tavern': {
      ...tavernSettings,
      sidebarDefaultsVersion: SIDEBAR_DEFAULTS_VERSION,
    },
    'dsh-better-sidebar': {
      ...TAVERN_SIDEBAR_DEFAULTS,
      ...current,
      tabsEnabled,
      viewersEnabled,
    },
  }
}

export function ensureSidebarDefaults(settingsPath = SETTINGS_FILE) {
  const source = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : ''
  const yaml = parseDocument(source)
  if (yaml.errors.length > 0) {
    throw new Error(`无法读取 DSH 设置：${yaml.errors[0].message}`)
  }
  const current = record(yaml.toJS())
  const next = applySidebarDefaults(current)
  if (JSON.stringify(next) === JSON.stringify(current)) return false

  yaml.set('dsh-tavern', next['dsh-tavern'])
  yaml.set('dsh-better-sidebar', next['dsh-better-sidebar'])
  mkdirSync(path.dirname(settingsPath), { recursive: true })
  const temporary = `${settingsPath}.tmp-${process.pid}`
  writeFileSync(temporary, yaml.toString(), 'utf8')
  renameSync(temporary, settingsPath)
  return true
}
