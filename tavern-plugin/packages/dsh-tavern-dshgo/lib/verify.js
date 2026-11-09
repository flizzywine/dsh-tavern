import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { checkBundles } from './preflight.js'
import { inspectDataHome } from './data-home.js'
import { TAVERN_BUNDLES, profileDir, resolveDshHome } from './status.js'

const HOST_PACKAGES = ['dsh-agent', 'dsh-tools', 'dsh-subagent', 'dsh-skill-filesystem', 'dsh-typert-protocol']
const PATCHES = ['dsh-better-sidebar@0.28.0.patch', 'dsh-web-mobile@3.1.0.patch']

function readJson(read, file) {
  try {
    return JSON.parse(read(file, 'utf8'))
  } catch {
    return null
  }
}

function nodeOk(version) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number)
  return major > 24 || (major === 24 && minor >= 9)
}

/**
 * 九项体检，每项给出「过没过 + 一句话 + 没过该干什么」。
 * 不抛错：任一项读不到都算不过，让调用方把所有问题一次列全。
 */
export function runChecks({ home = resolveDshHome(), appRoot = '/opt/dsh', nodeVersion = process.version, read = readFileSync, check = checkBundles } = {}) {
  const dir = profileDir(home)
  const manifest = readJson(read, join(dir, 'package.json')) ?? {}
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const dependencies = manifest?.dependencies ?? {}
  const overrides = manifest?.overrides ?? {}
  const dataHome = inspectDataHome(home)
  const modules = TAVERN_BUNDLES.filter(name => existsSync(join(dir, 'node_modules', name, 'package.json')))
  const hostResolved = HOST_PACKAGES.filter(name => existsSync(join(dir, 'node_modules', '@deepseek-ai', name, 'package.json')))

  const checks = []
  // blocking=false：这是状态而不是毛病，没过也不算失败（比如还没启用）。
  const add = (title, pass, detail, fix, blocking = true) => checks.push({ title, pass, detail, fix, blocking })

  add('引擎装在这里', existsSync(join(appRoot, 'node_modules', '@deepseek-ai', 'dsh')),
    appRoot, `没找到 ${appRoot}，这台机器不是 dsh-go，或者加 --app-root 指对位置`)

  add('Node 版本够新', nodeOk(nodeVersion), String(nodeVersion),
    'Node 太旧，酒馆起不来；dsh-go 正常装的是 24.x')

  add('酒馆的 8 个包都在', modules.length === TAVERN_BUNDLES.length,
    `${modules.length}/8`,
    `酒馆的包没装齐（${modules.length}/${TAVERN_BUNDLES.length}），先跑 install-on-dshgo.mjs`)

  add('宿主那 5 个包能借用', hostResolved.length === HOST_PACKAGES.length,
    `${hostResolved.length}/5`,
    '装了第二份 @deepseek-ai/*，插件会拿不到服务；重跑 install-on-dshgo.mjs')

  add('酒馆已启用', TAVERN_BUNDLES.every(name => bundles.includes(name)),
    TAVERN_BUNDLES.every(name => bundles.includes(name)) ? '已启用' : '还没启用',
    '没启用不是错：打开 App 里的「酒馆」面板，点「启用酒馆」', false)

  add('存档放在安全的地方', dataHome.state === 'linked' || dataHome.state === 'absent',
    dataHome.state === 'linked' ? '在 dsh-go/tavern-data，重置引擎删不到' : dataHome.state === 'absent' ? '还没建，启用时自动建' : '是实体目录或指向别处',
    dataHome.state === 'directory' ? '存档现在是实体目录，重置引擎会删；把它挪到 dsh-go/tavern-data 再启用' : '存档目录指向别处，先看一眼那是什么')

  add('补丁文件就位', PATCHES.every(file => existsSync(join(dir, 'patches', file))),
    `${PATCHES.filter(file => existsSync(join(dir, 'patches', file))).length}/2`,
    '补丁没铺好，界面会有怪样子；重跑 install-on-dshgo.mjs')

  const hostOverrides = Object.keys(overrides).filter(name => name.startsWith('@deepseek-ai/'))
  add('依赖指向 App 自己那份', hostOverrides.length === HOST_PACKAGES.length
    && hostOverrides.every(name => String(overrides[name]).startsWith(`link:${appRoot}/node_modules/`)),
    `${hostOverrides.length}/5 条`,
    '重跑 install-on-dshgo.mjs')

  const preflight = TAVERN_BUNDLES.every(name => modules.includes(name))
    ? check({ home, appRoot, timeout: 4000 })
    : { state: 'unknown', fatal: [], ignored: [], error: '包没装齐，跳过加载检查' }
  add('宿主愿意加载酒馆', preflight.state === 'ok',
    preflight.state === 'ok' ? '会加载' : preflight.state === 'fatal' ? `会跳过 ${preflight.fatal.map(item => item.packageName).join('、')}` : `没验成：${preflight.error ?? '未知'}`,
    preflight.state === 'fatal' ? '照上面被跳过的包名，检查它的依赖' : '这条能忽略，只是没验成')

  const failed = checks.filter(check => check.blocking && !check.pass)
  return {
    checks,
    failed,
    veredict: failed.length === 0 ? 'pass' : 'fail',
    // 最该先做的一件事：把 enable 之前能做的都做完
    next: failed.length === 0
      ? (TAVERN_BUNDLES.every(name => bundles.includes(name)) ? '全过了。去 App「引擎」页重启，然后进网页版就是酒馆' : '全过了。打开 App 里的「酒馆」面板，点「启用酒馆」')
      : failed[0].fix,
  }
}

export function formatChecks(result) {
  const mark = check => (check.pass ? '✅' : check.blocking ? '❌' : '⬜')
  const lines = result.checks.map((check, index) => `${mark(check)} ${index + 1}/9 ${check.title}（${check.detail}）`)
  lines.push('')
  lines.push(result.veredict === 'pass' ? '总结：九项全过。' : `总结：有 ${result.failed.length} 项没过。`)
  lines.push(`下一步：${result.next}`)
  return lines.join('\n')
}
