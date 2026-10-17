// 0.2.0-rc.2 适配：宿主 DSH 包解析根的选择。
//
// 0.2.0 桌面把宿主 @deepseek-ai/* 全部打进 <resources>\app.asar\dsh\node_modules（289 个包），
// 而 tavern-plugin 自己的 node_modules 里只有按 package.json 声明装进来的 npm 副本
// （dsh-agent / dsh-tools / dsh-skill-filesystem / dsh-subagent / dsh-typert-protocol）。
// 会话补丁要用的 dsh-session-persistence / -jsonl / -query / -format-catalog 与
// dsh-subprocess-local 都不在那份闭包里，于是从插件闭包出发的 require.resolve 必然
// 抛 `Cannot find module '@deepseek-ai/dsh-session-persistence'`（真机日志取证）。
//
// 关键约束是「同一份 dsh-session」：宿主进程自己的模块加载器是从 Electron 入口文件
// （<resources>\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js）出发解析的。
// 实测（tmp/probe-t11-identity.mjs）以 <resources>\app.asar\dsh\package.json 为锚点时：
//   • require.resolve 的结果与「从 Electron 入口文件出发」逐字相同；
//   • `import()` 拿到的是同一个模块命名空间（ESM 用解析后的真实文件路径做缓存键），
//     两个方向的导出引用全等（differingClassExports 为空）。
// 所以这里只把 asar 宿主根排到解析候选的第一位，插件闭包退回最后一位 —— 不引入第二份
// dsh-session，也不产生双份会话状态。
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_ARCHIVE = 'app.asar'
const HOST_RUNTIME_DIRECTORY = 'dsh'

// 运行期只依赖文件名与顶层入口的约定，不依赖 -e 片段的进程身份：宿主把这两个变量注入
// Electron Node 子进程（lib/main.js 的 desktopNodeEnvironment），而脱离态由系统 Node 跑时
// 退回 process.argv[1]。
export function desktopLauncherEntry({ env = process.env, argv = process.argv } = {}) {
  for (const candidate of [env.DSH_DESKTOP_DSH_BOOTSTRAP, env.DSH_DESKTOP_NODE_EXECUTABLE, argv[1]]) {
    if (typeof candidate !== 'string') continue
    // CLI 的 runtime/bin/dsh 是无扩展名链接；从其真实入口解析才会命中宿主闭包。
    // 保留归档宿主原路径，避免改变 Electron 的 asar 锚点优先级。
    if (/\.(?:c|m)?js$/i.test(candidate)) return candidate
    try {
      const entry = realpathSync(candidate)
      if (/\.(?:c|m)?js$/i.test(entry)) return entry
    } catch {}
  }
  return ''
}

// 桌面包布局在两种形态间移动过依赖：0.1.5 的 <resources>\app 是真目录，0.2.0 把宿主包
// 放进归档后 app 目录只保留 package.json。0.2.0 的宿主根是 <resources>\app.asar\dsh。
// 只有入口落在 <resources>\app.asar[.unpacked]\ 下时才认得这批锚点；CLI 安装（入口在真实
// 目录里）返回 null，调用方自然只会考虑插件闭包。asar 旁解包形态也归一到同一个宿主根。
function archiveResourcesRoot(launcherEntry) {
  return /^(.*[\\/]resources[\\/])app\.asar(?:\.unpacked)?[\\/]/i.exec(launcherEntry)?.[1] || null
}

function resolveAnchorRequire(anchor) {
  try {
    return createRequire(anchor)
  } catch {
    // 归档内路径在纯 Node 的 stat 下恒为不存在，但 createRequire 只要求可读的绝对路径，
    // Electron Node（ELECTRON_RUN_AS_NODE=1，dsh 的宿主进程就是）下照常工作。
    try {
      return createRequire(pathToFileURL(path.resolve(anchor)).href)
    } catch {
      return null
    }
  }
}

function resolvesAll(require, names) {
  if (!require) return false
  for (const name of names) {
    try { require.resolve(name) } catch { return false }
  }
  return true
}

// 顺序即优先级。候选根之间不做混装：调用方拿到第一个能解析全部 name 的 require。
export function hostRequireCandidates({ names, pluginAnchor, env = process.env, argv = process.argv } = {}) {
  const wanted = [...names]
  const anchors = []
  const push = (label, anchor) => { if (anchor) anchors.push({ label, anchor }) }
  const launcher = desktopLauncherEntry({ env, argv })
  const resources = archiveResourcesRoot(launcher)
  // 归档内宿主根排在第一位：与宿主进程自己的解析结果逐字相同（见文件头实测）。
  if (resources) push('desktop-archive-host', path.join(resources, APP_ARCHIVE, HOST_RUNTIME_DIRECTORY, 'package.json'))
  push('launcher-entry', launcher)
  // 0.1.5 的 <resources>\app 真目录布局，以及归档旁解包出的宿主根。
  if (resources) push('resources-app', path.join(resources, 'app', 'package.json'))
  if (resources) push('resources-app-unpacked', path.join(resources, 'app.asar.unpacked', 'package.json'))
  push('plugin-package', pluginAnchor || fileURLToPath(new URL('../../package.json', import.meta.url)))
  const candidates = anchors.map(entry => ({ ...entry, require: resolveAnchorRequire(entry.anchor) }))
  const resolvable = candidates.filter(candidate => resolvesAll(candidate.require, wanted))
  return { resolvable, candidates }
}
