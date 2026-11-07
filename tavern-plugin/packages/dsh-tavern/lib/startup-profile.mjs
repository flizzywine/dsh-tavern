import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { trustedHome } from './trusted-home.mjs'

// A bridge-controlled restart continues the selected session. A fresh launch
// from the official app entry has no marker and applies the saved preference.
export const SESSION_SWITCH_ENV = 'DSH_TAVERN_CONTINUE_PROFILE'

function preferenceFile(home) {
  const file = join(home, 'profile-bridge', 'startup-profile.json')
  trustedHome(home).ordinary(file)
  return file
}

export function readDefaultProfile(home) {
  const file = preferenceFile(home)
  if (!existsSync(file)) return null
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (value?.schemaVersion !== 1 || ![null, 'tavern'].includes(value.defaultProfile)) {
    throw new Error('默认启动配置损坏，请检查 profile-bridge/startup-profile.json')
  }
  return value.defaultProfile
}

export function setDefaultProfile(home, profile) {
  if (![null, 'tavern'].includes(profile)) throw new Error('默认配置只能设为酒馆或取消设置')
  const file = preferenceFile(home)
  mkdirSync(join(home, 'profile-bridge'), { recursive: true })
  const temporary = file + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, defaultProfile: profile }) + '\n', { flag: 'wx', mode: 0o600 })
  renameSync(temporary, file)
  return { defaultProfile: profile }
}

export function initializeDefaultProfile(home, currentProfile) {
  // Preserve the explicitly selected default from older launcher releases once.
  // Thereafter switching never writes this setting.
  if (!existsSync(preferenceFile(home))) setDefaultProfile(home, currentProfile === 'tavern' ? 'tavern' : null)
  return readDefaultProfile(home)
}

export function startupSwitchMode(currentProfile, defaultProfile, env = process.env) {
  if (env[SESSION_SWITCH_ENV] === '1' || !['desktop', 'tavern'].includes(currentProfile)) return undefined
  const desired = defaultProfile || 'desktop'
  if (desired === currentProfile) return undefined
  return desired === 'tavern' ? 'link' : 'unlink'
}

export function relaunchEnvironment(env, continueProfile = false) {
  const result = { ...env }
  delete result.ELECTRON_RUN_AS_NODE
  delete result[SESSION_SWITCH_ENV]
  if (continueProfile) result[SESSION_SWITCH_ENV] = '1'
  return result
}
