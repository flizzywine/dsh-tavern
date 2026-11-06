import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { nativeSettingsEntryId } from './native-settings.js'

export const SETTINGS_IMPORT_MARKER = 'forkSettingsImported'
export async function importLegacySettings(ctx, provider, fields, active = () => true) {
  const ns = nativeSettingsEntryId(ctx), current = provider.describe().find(row => row.ns === ns)
  if (!current) throw new Error('Native settings form is unavailable')
  if (current.value[SETTINGS_IMPORT_MARKER] === 1) return false
  if (provider.writable === false) throw new Error('Native settings are read-only')
  const home = ctx.get('profileContext').home
  let legacy = {}
  for (const name of ['settings.yaml', 'settings.yaml.imported']) {
    try { legacy = parse(await readFile(path.join(home, name), 'utf8')) ?? {}; break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const patch = { [SETTINGS_IMPORT_MARKER]: 1 }
  for (const section of Object.keys(fields)) {
    if (!Object.hasOwn(current.user, section) && Object.hasOwn(legacy, section)) patch[section] = fields[section](legacy[section]).get()
  }
  if (!active()) return false
  await provider.update(ns, patch, current.revision)
  return true
}

export function installSettingsMigration(ctx, fields) {
  let finish, active = true
  const ready = new Promise(resolve => { finish = resolve })
  ctx.effect(() => () => { active = false; finish(false) })
  ctx.inject(['settings'], child => {
    const provider = child.get('settings')
    if (typeof provider.installSection === 'function') { finish(true); return }
    child.inject(['configEditor', 'profileContext'], owner => {
      owner.effect(() => provider.configure({ auto: false }, ctx.fiber))
      ctx.root.loader.await().then(() => importLegacySettings(ctx, provider, fields, () => active)).then(() => finish(active), error => {
        ctx.logger.error('Settings migration refused; legacy document retained (%s)', error.code || error.name)
        finish(false)
      })
    })
  })
  return ready
}
