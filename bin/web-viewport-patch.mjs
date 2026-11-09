import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { patchViewportMetaSource } from '../tavern-plugin/lib/domain/web-viewport-meta.js'

export { patchViewportMetaSource }

function isAsarPath(file) {
  return /[\\/]app\.asar[\\/]/.test(file)
}

/** `dsh web` 下发的页面来自 @deepseek-ai/dsh-web-frontend/dist/index.html。 */
export function findWebFrontendPage(anchor) {
  try {
    const manifest = createRequire(anchor).resolve('@deepseek-ai/dsh-web-frontend/package.json')
    return path.join(path.dirname(manifest), 'dist', 'index.html')
  } catch {
    return null
  }
}

/**
 * 就地改一份网页外壳：true 表示已写入，false 表示本来就对，
 * null 表示这套 DSH 的页面形状不认识（留原样，不猜）。
 */
export function patchWebViewportFile(file) {
  if (!file || !existsSync(file) || isAsarPath(file)) return null
  let before
  try { before = readFileSync(file, 'utf8') } catch { return null }
  const result = patchViewportMetaSource(before)
  if (result.status === 'unmatched') return null
  if (result.status === 'already') return false
  writeFileSync(file, result.text)
  return true
}

export function patchWebViewportMeta(anchor) {
  return patchWebViewportFile(findWebFrontendPage(anchor))
}
