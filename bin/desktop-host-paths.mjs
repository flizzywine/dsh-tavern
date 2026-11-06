import { existsSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// 0.2.0-rc.2 适配：桌面把宿主 @deepseek-ai/* 全部打进了 app.asar
// （app.asar/dsh/node_modules，289 个包），app.asar.unpacked 下只剩 4 个原生/受保护包。
// 纯 Node 的 existsSync/require.resolve 对 asar 内路径恒失败，所以：
//   • 能用纯 Node 解析的布局（0.1.5 的 resources/app、混合布局、CLI）继续原路走；
//   • asar 布局必须借道 Electron Node 模式（同一个可执行文件 + ELECTRON_RUN_AS_NODE=1）。
export function desktopResourcesRoot(executable, platform = process.platform) {
  const directory = path.dirname(executable)
  return platform === 'darwin' ? path.resolve(directory, '../Resources') : path.join(directory, 'resources')
}

// 桌面 0.2.0 的 dsh 是「Electron 可执行文件 + app.asar 内 CLI」的 shim，例如
//   "%~dp0..\..\..\..\DeepSeek Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\..."
// 脱离态（更新/安装由系统 Node 拉起、又没有 DSH_DESKTOP_* 环境变量）时，execPath 是 node.exe，
// 只有 shim 还能指认「当前跑的是哪个 Desktop 安装」，所以把它当作最后一个可执行文件来源。
export function desktopShimExecutable(commandFile, platform = process.platform) {
  if (typeof commandFile !== 'string' || !commandFile) return null
  try {
    if (!existsSync(commandFile) || statSync(commandFile).size > 64 * 1024) return null
    const directory = path.dirname(commandFile)
    const text = readFileSync(commandFile, 'utf8')
      .replace(/%~dp0%?/gi, directory + path.sep)
      .replace(/%dp0%/gi, directory + path.sep)
      .replace(/\$basedir/gi, directory + path.sep)
    for (const [, quoted] of text.matchAll(/"([^"\r\n]+)"/g)) {
      if (platform === 'darwin' ? !/\.app[\\/]Contents[\\/]MacOS[\\/]/i.test(quoted) : !/\.exe$/i.test(quoted)) continue
      if (/[\\/](?:node|nodejs)(?:\.exe)?$/i.test(quoted)) continue
      const resolved = path.resolve(directory, quoted)
      if (existsSync(resolved)) return resolved
    }
    return null
  } catch { return null }
}

// 0.1.5 用 DSH_DESKTOP_APP_EXECUTABLE；0.2.0 的新契约是 DSH_DESKTOP_NODE_EXECUTABLE
// （lib/main.js 的 desktopNodeEnvironment 注入，值就是 Electron 可执行文件本身）。
// 安装器既可能从 DSH Terminal（execPath 即 Electron exe）启动，也可能在脱离态由系统 Node 跑。
export function desktopElectronExecutable({ env = process.env, execPath = process.execPath, platform = process.platform, commandFile = null } = {}) {
  for (const candidate of [env.DSH_DESKTOP_NODE_EXECUTABLE, env.DSH_DESKTOP_APP_EXECUTABLE, execPath, desktopShimExecutable(commandFile, platform)]) {
    if (!candidate) continue
    if (/[\\/](?:node|nodejs)(?:\.exe)?$/i.test(candidate)) continue
    if (existsSync(candidate)) return candidate
  }
  return null
}

// asar 内路径在纯 Node 下不可读写；这类"目录"只能交给 Electron Node 或 asar 感知的读取器。
export function isAsarPath(value) {
  return typeof value === 'string' && /\.asar[\\/]/i.test(value)
}

// Desktop packaging can move dependencies between app and app.asar.unpacked.
// A stale junction still identifies the selected installation; inspect its
// target without requiring the missing package to resolve first.
export function desktopHostAnchors(anchor) {
  const anchors = new Set([anchor])
  const require = createRequire(anchor)
  try { anchors.add(realpathSync(require.resolve('@deepseek-ai/dsh-agent'))) } catch {}
  for (const directory of require.resolve.paths('@deepseek-ai/dsh-agent') || []) {
    const link = path.join(directory, '@deepseek-ai', 'dsh-agent')
    try {
      const target = path.resolve(path.dirname(link), readlinkSync(link))
      anchors.add(path.join(target, 'package.json'))
    } catch {}
  }
  for (const candidate of [...anchors]) {
    const match = /^(.*[\\/]resources[\\/])(?:app|app\.asar|app\.asar\.unpacked)(?:[\\/]|$)/.exec(candidate)
    if (!match) continue
    anchors.add(path.join(match[1], 'app', 'package.json'))
    anchors.add(path.join(match[1], 'app.asar.unpacked', 'package.json'))
    // 0.2.0 布局：宿主包在 <resources>\app.asar\dsh\node_modules 内（Electron 模式），
    // 受保护/原生包在 <resources>\app.asar.unpacked\dsh\node_modules 内（纯 Node 可读）。
    anchors.add(path.join(match[1], 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent', 'package.json'))
    anchors.add(path.join(match[1], 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent', 'package.json'))
  }
  return [...anchors]
}
