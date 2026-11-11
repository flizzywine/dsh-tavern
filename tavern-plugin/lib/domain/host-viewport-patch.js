// 安卓 Chrome（108+）默认 `interactive-widget=resizes-visual`：输入法动画期间布局视口不动，
// 页面只能等 visualViewport 的 resize，而那要等动画收尾才来 —— 就是「输入法先弹、页面过一会
// 才上移」，事件漏一次还会彻底不动。`interactive-widget` 只在页面加载时读一次，脚本改 meta
// 无效，只能改宿主动态下发的 HTML；所以每次启动都补齐一次，装完/升级完立即生效。
import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { hostRequireCandidates } from './host-package-resolution.js'
import { patchViewportMetaSource } from './web-viewport-meta.js'

const FRONTEND_MANIFEST = '@deepseek-ai/dsh-web-frontend/package.json'

function isAsarPath(file) {
  return /[\\/]app\.asar[\\/]/.test(file)
}

/** `dsh web` 下发的页面来自 @deepseek-ai/dsh-web-frontend/dist/index.html。 */
export function findHostViewportPage(anchor) {
  try {
    const manifest = createRequire(anchor).resolve(FRONTEND_MANIFEST)
    return path.join(path.dirname(manifest), 'dist', 'index.html')
  } catch {}
  // 发布版运行时是 npm 全局布局：bin/dsh 是指向 lib/node_modules/... 的符号链接，
  // 该目录不在 node 的逐级 node_modules 查找路径上，只能顺着祖先目录自己拼。
  let dir
  try { dir = path.dirname(realpathSync(anchor)) } catch { return null }
  for (let depth = 0; depth < 8; depth++) {
    const file = path.join(dir, 'lib', 'node_modules', ...FRONTEND_MANIFEST.split('/'), '..', 'dist', 'index.html')
    if (existsSync(file)) return path.normalize(file)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * 就地改一份网页外壳：true 表示已写入，false 表示本来就对，
 * null 表示这套 DSH 的页面形状不认识（留原样，不猜）。
 */
export function patchHostViewportFile(file) {
  if (!file || !existsSync(file) || isAsarPath(file)) return null
  let before
  try { before = readFileSync(file, 'utf8') } catch { return null }
  const result = patchViewportMetaSource(before)
  if (result.status === 'unmatched') return null
  if (result.status === 'already') return false
  // 写新文件再改名换上去：pnpm 的包文件是与全局 store 共享 inode 的硬链接，
  // 就地改会连 store 一起改掉，改名只换本安装的这一个目录项。
  const staging = `${file}.tavern-viewport`
  try {
    writeFileSync(staging, result.text)
    renameSync(staging, file)
  } catch {
    try { unlinkSync(staging) } catch {}
    return null
  }
  return true
}

const VIEWPORT_NEIGHBORS = [
  '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-app-boot',
]

/** 启动时补齐；返回 true（刚写入）、false（本来就对）或 null（这套 DSH 认不出页面）。 */
export function installHostViewportPatch(log, options) {
  const { candidates } = hostRequireCandidates({
    ...options, names: [], neighbors: VIEWPORT_NEIGHBORS,
  })
  for (const { anchor } of candidates) {
    const file = findHostViewportPage(anchor)
    if (!file) continue
    const result = patchHostViewportFile(file)
    if (result === null) continue
    if (result && typeof log === 'function') log('已让安卓浏览器把软键盘算进窗口高度：键盘弹出时页面与键盘同帧重排。')
    return result
  }
  return null
}
