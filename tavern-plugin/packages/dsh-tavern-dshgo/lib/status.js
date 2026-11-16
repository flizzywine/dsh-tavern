import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 酒馆在 dsh-go 的 web profile 里是哪几个 bundle。
// 顺序与根 package.json 的 dsh.profile.bundles 一致：dsh-web-mobile 在 dsh-better-sidebar 之前。
// 舞台（mod 系统）与素材库在 dsh 0.2.2 上还起不来：stage 会调 installations.readReleases
// 抛 TypeError，被 dsh 判成 fatal load failure 后整台引擎停摆；asset-library 等
// assetPackWorkbench，摘掉 stage 之后它就一直 pending。两个都是可选的游玩增强，
// 默认装核心六个，酒馆本体（角色卡/对话/皮肤/远程/TTS）都在核心六个里。
export const OPTIONAL_BUNDLES = Object.freeze(['dsh-asset-library', 'dsh-tavern-stage'])

export const TAVERN_BUNDLES = Object.freeze([
  'dsh-web-mobile',
  'dsh-better-sidebar',
  'dsh-dream-skin',
  'dsh-tavern-plugin',
  'dsh-tavern-remote',
  'dsh-asset-library',
  'dsh-tavern-stage',
  'dsh-tavern-tts',
])

/**
 * dsh-go 的桥接只放行 scope 里的 sessionId / turnId / messageId / callId，
 * 宿主目录无处可取，只能从环境或家目录推。proot 内的 homedir() 就是 /root。
 */
export function resolveDshHome(env = process.env, home = homedir()) {
  const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return fromEnv === '' ? join(home, '.dsh') : fromEnv
}

export function profileDir(dshHome) {
  return join(dshHome, 'profiles', 'web')
}

function readJson(read, file) {
  try {
    return { value: JSON.parse(read(file, 'utf8')), error: null }
  } catch (error) {
    return { value: null, error }
  }
}

/**
 * 只读快照。任何一项读不到都退化成阶段而不是抛错：面板要能在半装状态下打开。
 * @param {{ home: string, read?: (file: string, encoding: string) => string }} options
 */
export function readStatus({ home, read = readFileSync }) {
  const dir = profileDir(home)
  const manifest = readJson(read, join(dir, 'package.json'))
  const bundles = Array.isArray(manifest.value?.dsh?.profile?.bundles)
    ? manifest.value.dsh.profile.bundles.filter(item => typeof item === 'string')
    : []
  const dependencies = manifest.value?.dependencies && typeof manifest.value.dependencies === 'object'
    ? manifest.value.dependencies
    : {}
  const installed = TAVERN_BUNDLES.filter(name => bundles.includes(name))
  const missing = TAVERN_BUNDLES.filter(name => !bundles.includes(name))
  const required = TAVERN_BUNDLES.filter(name => !OPTIONAL_BUNDLES.includes(name))
  const missingRequired = required.filter(name => !bundles.includes(name))
  const modules = TAVERN_BUNDLES.filter(name => readJson(read, join(dir, 'node_modules', name, 'package.json')).value !== null)
  const tavern = readJson(read, join(dir, 'node_modules', 'dsh-tavern-plugin', 'package.json'))
  const phase = manifest.error
    ? 'unreadable'
    : installed.length === TAVERN_BUNDLES.length
      ? 'ready'
      : installed.length === 0
        ? 'absent'
        : 'partial'
  return {
    profileDir: dir,
    phase,
    bundles,
    installed,
    missing,
    dependencies,
    declared: TAVERN_BUNDLES.filter(name => Object.hasOwn(dependencies, name)),
    modules,
    missingModules: TAVERN_BUNDLES.filter(name => !modules.includes(name)),
    tavernVersion: typeof tavern.value?.version === 'string' ? tavern.value.version : null,
    error: manifest.error === null ? null : String(manifest.error.message ?? manifest.error),
  }
}
