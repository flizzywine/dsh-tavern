import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One release-specific source for bootstrap installers, the launcher and documentation checks.
const compatibility = JSON.parse(readFileSync(new URL('../config/dsh-compatibility.json', import.meta.url), 'utf8'))
export const { adaptedDshVersion, recommendedDesktopVersion, desktopReleasesUrl, recommendedDshaVersion, dshaReleasesUrl } = compatibility
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(adaptedDshVersion)) throw new Error('DSH 适配版本配置无效')

export function extractDshVersion(output) {
  const match = String(output || '').match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)
  if (!match) throw new Error('无法识别当前 DSH 版本。')
  return match[1]
}

export function dshCompatibilityNotice(currentVersion = '', host = 'desktop') {
  if (host === 'cli') return `命令行版独立安装并使用 DSH ${adaptedDshVersion}，不复用或修改全局 DSH。`
  const notice = host === 'android'
    ? `适配版本：DSHA ${recommendedDshaVersion}（内置 DSH ${adaptedDshVersion}），要求内置 DSH 版本完全匹配；请下载安装适配版本：${dshaReleasesUrl}`
    : `适配版本：DSH Desktop ${recommendedDesktopVersion}（内置 DSH ${adaptedDshVersion}），要求内置 DSH 版本完全匹配；请下载安装适配版本：${desktopReleasesUrl}`
  return currentVersion && currentVersion !== adaptedDshVersion
    ? `${notice}\n当前 DSH ${currentVersion} 与要求版本 ${adaptedDshVersion} 不同；已停止安装，不会修改宿主版本。`
    : notice
}

export function assertCompatibleDshVersion(currentVersion, host = 'cli') {
  if (currentVersion === adaptedDshVersion) return
  const guidance = host === 'cli'
    ? '请重新安装独立运行时：设置 DSH_TAVERN_REINSTALL_RUNTIME=1 后重试安装或更新。'
    : dshCompatibilityNotice(currentVersion, host)
  throw new Error(`已停止安装：检测到非适配 DSH 版本，当前 ${currentVersion || '未知'}，必须使用 ${adaptedDshVersion}。${guidance}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--check') {
    assertCompatibleDshVersion(extractDshVersion(process.argv[4]), process.argv[3])
  } else {
    console.log(process.argv[2] === '--version' ? adaptedDshVersion : dshCompatibilityNotice('', process.argv[3] || 'desktop'))
  }
}
