import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * 把 Tavern 自带的那份「固定版本」剧情生图插件装进用户插件目录，已装旧版时就地升级。
 *
 * 设计约束（逐条对应需求）：
 *  - 固定版本：只读 `packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json`，全程不联网、不拉 latest。
 *  - 首装：目标目录不存在时，先复制并校验到同级临时目录，再将完整目录改名到目标位置。
 *  - 升级：目标是同一个插件（包名相同、普通目录、不是 Git 检出）且版本比内置的旧时，
 *    只替换内置副本里有的代码文件，用户数据（配置、人物库、世界书、任务记录、缓存）一律不碰；
 *    中途失败就把换下的旧文件放回去。更新的版本、版本不明、别的来源、符号链接一律不动。
 *  - 不重复加载：profile 里已经有同名包时跳过（Tavern 的 user-plugins 本来也会跳过
 *    plugins/ 下的副本以免同一包两个来源，这里提前让位，省得留一份永远不会被加载的副本）。
 *
 * 失败一律不阻断 Tavern 安装：返回 `action: 'unavailable'` 并附带原因，由调用方决定要不要提示。
 */

export const BUNDLED_SCENE_IMAGE_FOLDER = 'dsh-tavern-image'
export const BUNDLED_SCENE_IMAGE_DIR = ['tavern-plugin', 'packages', 'dsh-tavern-image-bundled']
/** profile 侧那个包名（插件真正的 npm 包名，与目录名不同） */
export const SCENE_IMAGE_PACKAGE_NAME = 'dsh-tavern-image'
/** 旧版 profile 包名：识别既有来源，避免新旧包并存。 */
export const LEGACY_SCENE_IMAGE_PACKAGE_NAME = 'dsh-tavern-comfy'

/** 插件自己的数据：不随安装源复制，升级时绝不覆盖。工作流仅发行 .gitkeep 占位。 */
const PRIVATE = /^(card-worldbook\.json|card-enabled\.json|workflows-card|skills\/image-prompt\/references|config(\.json)?|definitions(\.json)?|worldbook(-outfits)?(\.json)?|jobs(-store)?\.json|plans(-store)?\.json|cache|backups|reference-images|format-worldbooks|workflows|node_modules|\.git)(\/|$)/i

/** 内置副本必须齐备的文件；缺一个就当"这份发行版没内置插件"，不去猜。 */
const REQUIRED = ['package.json', 'lib/index.js', 'client.js', 'cordis.patch.yml']

/** 依赖入口判断（与 Tavern 加载器一致：exports["."] 优先，其次 main） */
function hostEntry(pkg) {
  return typeof pkg?.exports === 'string' ? pkg.exports
    : typeof pkg?.exports?.['.'] === 'string' ? pkg.exports['.']
      : typeof pkg?.exports?.['.']?.import === 'string' ? pkg.exports['.'].import
        : typeof pkg?.exports?.['.']?.default === 'string' ? pkg.exports['.'].default
          : typeof pkg?.main === 'string' ? pkg.main
            : ''
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

function existsNoFollow(file) {
  try { lstatSync(file); return true } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/**
 * 比较点分版本号。非数字段按 0 处理，缺失段也按 0 —— 这里的版本号来自我们自己发布的
 * package.json，不需要完整的 semver（预发布标签按出现顺序比较字符串即可）。
 * @returns {number} a>b 返回 1，a<b 返回 -1，相等返回 0
 */
export function comparePluginVersions(a, b) {
  const split = value => String(value ?? '').trim().split(/[.+-]/).map(part => (/^\d+$/.test(part) ? Number(part) : part))
  const left = split(a), right = split(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] ?? 0, y = right[i] ?? 0
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x > y ? 1 : -1
      continue
    }
    const sx = String(x), sy = String(y)
    if (sx !== sy) return sx > sy ? 1 : -1
  }
  return 0
}

/** 读内置副本的版本与完整性；不完整时返回 { ok: false, reason }。 */
export function readBundledSceneImage(sourceRoot) {
  const directory = path.join(sourceRoot, ...BUNDLED_SCENE_IMAGE_DIR)
  let directoryStat
  try { directoryStat = lstatSync(directory) } catch {
    return { ok: false, directory, reason: '内置插件副本目录不存在' }
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return { ok: false, directory, reason: '内置插件副本目录不是普通目录' }
  }
  for (const file of REQUIRED) {
    try {
      if (!lstatSync(path.join(directory, file)).isFile()) throw new Error()
    } catch {
      return { ok: false, directory, reason: '内置插件副本不完整，缺少 ' + file }
    }
  }
  const marker = readJson(path.join(directory, 'BUNDLED-VERSION.json'))
  if (!marker) return { ok: false, directory, reason: '内置插件副本缺少有效的 BUNDLED-VERSION.json' }
  const pkg = readJson(path.join(directory, 'package.json'))
  const version = String(pkg?.version ?? '').trim()
  if (!version) return { ok: false, directory, reason: '内置插件副本的 package.json 没有版本号' }
  if (pkg?.name !== SCENE_IMAGE_PACKAGE_NAME || marker.name !== SCENE_IMAGE_PACKAGE_NAME || String(marker.version ?? '').trim() !== version) {
    return { ok: false, directory, reason: '内置版本标记与 package.json 的名称或版本不一致' }
  }
  if (!hostEntry(pkg)) return { ok: false, directory, reason: '内置插件副本的 package.json 没有宿主入口' }
  if (pkg?.dsh?.tavern?.sceneImages !== 'delegate') return { ok: false, directory, reason: '内置插件缺少 dsh.tavern.sceneImages=delegate 契约' }
  return { ok: true, directory, version, packageName: pkg.name, contract: pkg.dsh.tavern.sceneImages }
}

/** 将不含符号链接的内置副本复制到新建的临时目录。 */
function copyTree(from, to, copied, root = to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'BUNDLED-VERSION.json') continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    const relative = path.relative(root, target).split(path.sep).join('/')
    // Filter before traversal, not only at upgrade promotion: an accidentally
    // populated source tree must not leak reference images or authored books
    // into a fresh install. Private symlinks are never followed either.
    const workflowPlaceholder = relative === 'workflows/.gitkeep'
      || (relative === 'workflows' && entry.isDirectory() && !entry.isSymbolicLink())
    if (PRIVATE.test(relative) && !workflowPlaceholder) continue
    if (entry.isSymbolicLink()) throw new Error('内置插件副本包含不支持的符号链接：' + source)
    if (entry.isDirectory()) { mkdirSync(target); copyTree(source, target, copied, root); continue }
    if (!entry.isFile()) continue
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(source, target)
    copied.push(path.relative(root, target).split(path.sep).join('/'))
  }
}

/** Why an existing plugin directory must not be upgraded; '' when it may. */
function upgradeRefusal(target, bundledVersion) {
  const stat = lstatSync(target)
  if (stat.isSymbolicLink() || !stat.isDirectory()) return '目标插件目录不是普通目录，保留现有内容'
  if (existsNoFollow(path.join(target, '.git'))) return '目标插件是 Git 检出，保留现有内容'
  const pkg = readJson(path.join(target, 'package.json'))
  const version = String(pkg?.version ?? '').trim()
  if (pkg?.name !== SCENE_IMAGE_PACKAGE_NAME || !version) return '目标插件目录不是可识别的同名插件，保留现有内容'
  if (comparePluginVersions(bundledVersion, version) <= 0) return '已安装的插件不比内置版本旧，保留现有内容'
  return ''
}

/** Refuse paths that could make an upgrade write through a symlink/junction outside the plugin. */
function hasLinkedUpgradePath(target, relativeFile) {
  const parts = relativeFile.split('/')
  let current = target
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index])
    if (!existsNoFollow(current)) return false
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) return true
  }
  return false
}

/** Give legacy profile installs a safe migration path without guessing where their data lives. */
function profileMigrationHint(packageName, profileVersion, bundledVersion) {
  return [
    `profile 仍登记着独立安装的 ${packageName}${profileVersion ? ' ' + profileVersion : ''}，因此本次没有更新/安装 Tavern 内置的 ${bundledVersion}。`,
    '请先按迁移指南确认旧插件数据的实际位置并备份整个真实数据目录，再移除旧 profile 包并重新运行 Tavern 更新：',
    'https://github.com/weixinlll/dsh-tavern-image/blob/master/MIGRATION.md',
  ].join('\n')
}

function needsProfileMigrationHint(packageName, profileVersion, bundledVersion) {
  return packageName === LEGACY_SCENE_IMAGE_PACKAGE_NAME
    || !profileVersion
    || comparePluginVersions(bundledVersion, profileVersion) > 0
}

/** Replace the bundled copy's code files in an older install; plugin data stays untouched. */
function upgradeInPlace(bundled, target, installedVersion) {
  const copied = []
  const staging = mkdtempSync(path.join(path.dirname(target), '.dsh-tavern-image-'))
  const backup = mkdtempSync(path.join(path.dirname(target), '.dsh-tavern-image-backup-'))
  const moved = []
  try {
    copyTree(bundled.directory, staging, copied)
    const copiedPkg = readJson(path.join(staging, 'package.json'))
    if (copiedPkg?.name !== SCENE_IMAGE_PACKAGE_NAME || String(copiedPkg?.version ?? '').trim() !== bundled.version || copiedPkg?.dsh?.tavern?.sceneImages !== 'delegate') {
      throw new Error('内置插件复制后的包名、版本或委派契约校验失败')
    }
    // package.json last: until it lands, the install still reports the old version.
    const files = copied.filter(file => !PRIVATE.test(file)).sort((a, b) => (a === 'package.json') - (b === 'package.json'))
    if (files.some(file => hasLinkedUpgradePath(target, file))) {
      rmSync(staging, { recursive: true, force: true })
      rmSync(backup, { recursive: true, force: true })
      return {
        action: 'skipped', reason: '升级路径包含符号链接或 junction，保留现有内容',
        version: bundled.version, installedVersion, target,
      }
    }
    for (const file of files) {
      const destination = path.join(target, file), saved = path.join(backup, file)
      if (hasLinkedUpgradePath(target, file)) {
        const error = new Error('升级路径在操作期间变成符号链接或 junction，已停止写入')
        error.code = 'ERR_UNSAFE_UPGRADE_PATH'
        throw error
      }
      mkdirSync(path.dirname(destination), { recursive: true })
      if (hasLinkedUpgradePath(target, file)) {
        const error = new Error('升级路径在创建目录期间变成符号链接或 junction，已停止写入')
        error.code = 'ERR_UNSAFE_UPGRADE_PATH'
        throw error
      }
      const existed = existsNoFollow(destination)
      if (existed) { mkdirSync(path.dirname(saved), { recursive: true }); renameSync(destination, saved) }
      moved.push({ destination, saved, existed })
      renameSync(path.join(staging, file), destination)
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      try { rmSync(item.destination, { force: true }); if (item.existed) renameSync(item.saved, item.destination) } catch {}
    }
    rmSync(staging, { recursive: true, force: true })
    rmSync(backup, { recursive: true, force: true })
    if (error?.code === 'ERR_UNSAFE_UPGRADE_PATH') return {
      action: 'skipped', reason: error.message,
      version: bundled.version, installedVersion, target,
    }
    throw error
  }
  rmSync(staging, { recursive: true, force: true })
  rmSync(backup, { recursive: true, force: true })
  return { action: 'upgraded', reason: '从 ' + installedVersion + ' 升级', version: bundled.version, installedVersion, target, files: moved.length }
}

/**
 * @param {object} options
 * @param {string} options.sourceRoot Tavern 安装源根目录（含 tavern-plugin/packages/...）
 * @param {string} options.dataRoot Tavern 数据根（插件装到 `<dataRoot>/plugins/dsh-tavern-image`）
 * @param {string} [options.profileDir] profile 目录；给了就检查里面是否已装同名包
 */
export function installBundledSceneImagePlugin({ sourceRoot, dataRoot, profileDir, logger = console } = {}) {
  const bundled = readBundledSceneImage(sourceRoot)
  if (!bundled.ok) {
    logger.warn?.('[Tavern 插件] 跳过内置生图插件：' + bundled.reason)
    return { action: 'unavailable', reason: bundled.reason, version: null, target: null, installedVersion: null }
  }

  const target = path.join(dataRoot, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const installedVersion = readJson(path.join(target, 'package.json'))?.version ?? null

  // profile 侧已装同名包：让它做唯一来源，别再放一份永不加载的副本
  const profilePackageName = profileDir && [SCENE_IMAGE_PACKAGE_NAME, LEGACY_SCENE_IMAGE_PACKAGE_NAME]
    .find(name => existsSync(path.join(profileDir, 'node_modules', name, 'package.json')))
  const profilePackageVersion = profilePackageName
    ? String(readJson(path.join(profileDir, 'node_modules', profilePackageName, 'package.json'))?.version ?? '').trim() || null
    : null
  const migrationHint = profilePackageName && needsProfileMigrationHint(profilePackageName, profilePackageVersion, bundled.version)
    ? profileMigrationHint(profilePackageName, profilePackageVersion, bundled.version)
    : null

  // An existing entry is user-owned unless it is an older copy of this same plugin.
  if (existsNoFollow(target)) {
    const refusal = profilePackageName ? 'profile 已安装同名插件包，保持单一来源' : upgradeRefusal(target, bundled.version)
    if (refusal) return {
      action: 'skipped', reason: refusal, version: bundled.version, installedVersion, target,
      ...(profilePackageName ? {
        profilePackage: { name: profilePackageName, version: profilePackageVersion },
        ...(migrationHint ? { hint: migrationHint } : {}),
      } : {}),
    }
    return upgradeInPlace(bundled, target, installedVersion)
  }

  if (profilePackageName) {
    return {
      action: 'skipped', reason: 'profile 已安装同名插件包，保持单一来源',
      version: bundled.version, installedVersion, target,
      profilePackage: { name: profilePackageName, version: profilePackageVersion },
      ...(migrationHint ? { hint: migrationHint } : {}),
    }
  }

  const copied = []
  const pluginsDir = path.dirname(target)
  mkdirSync(pluginsDir, { recursive: true })
  const staging = mkdtempSync(path.join(pluginsDir, '.dsh-tavern-image-'))
  try {
    copyTree(bundled.directory, staging, copied)
    const copiedPkg = readJson(path.join(staging, 'package.json'))
    if (copiedPkg?.name !== SCENE_IMAGE_PACKAGE_NAME || String(copiedPkg?.version ?? '').trim() !== bundled.version || copiedPkg?.dsh?.tavern?.sceneImages !== 'delegate') {
      throw new Error('内置插件复制后的包名、版本或委派契约校验失败')
    }
    for (const file of REQUIRED) {
      if (!existsSync(path.join(staging, file))) throw new Error('内置插件复制后缺少 ' + file)
    }
    if (existsNoFollow(target)) {
      rmSync(staging, { recursive: true, force: true })
      return {
        action: 'skipped', reason: '目标插件目录已存在，保留现有内容',
        version: bundled.version, installedVersion: readJson(path.join(target, 'package.json'))?.version ?? null, target,
      }
    }
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    // Another first-install process may have promoted its complete staging tree
    // after our initial absence check. Treat the winner as the existing install.
    if (existsNoFollow(target)) return {
      action: 'skipped', reason: '目标插件目录已存在，保留现有内容',
      version: bundled.version, installedVersion: readJson(path.join(target, 'package.json'))?.version ?? null, target,
    }
    throw error
  }

  return {
    action: 'installed',
    reason: '首次安装',
    version: bundled.version,
    installedVersion,
    target,
    files: copied.length,
  }
}
