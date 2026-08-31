import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One release-specific source for bootstrap installers, the launcher and documentation checks.
export const adaptedDshVersion = JSON.parse(readFileSync(new URL('../config/dsh-compatibility.json', import.meta.url), 'utf8')).adaptedDshVersion
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(adaptedDshVersion)) throw new Error('DSH 适配版本配置无效')

export function dshCompatibilityNotice(currentVersion = '') {
  const notice = `本版适配 DSH ${adaptedDshVersion}。允许使用其他版本，但 DSH 更新较激进，可能导致本插件异常，请自行斟酌。`
  return currentVersion && currentVersion !== adaptedDshVersion
    ? `${notice}\n当前 DSH ${currentVersion} 与适配版本不同；保留当前版本，继续安装。`
    : notice
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(process.argv[2] === '--version' ? adaptedDshVersion : dshCompatibilityNotice())
}
