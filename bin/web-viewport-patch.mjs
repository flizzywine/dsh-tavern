import { patchViewportMetaSource } from '../tavern-plugin/lib/domain/web-viewport-meta.js'
import { findHostViewportPage, patchHostViewportFile } from '../tavern-plugin/lib/domain/host-viewport-patch.js'

export { patchViewportMetaSource, findHostViewportPage, patchHostViewportFile }

/** 安装/更新时就地补齐宿主网页外壳；anchor 是宿主包里的一个模块路径。 */
export function patchWebViewportMeta(anchor) {
  return patchHostViewportFile(findHostViewportPage(anchor))
}

export function patchWebViewportFile(file) {
  return patchHostViewportFile(file)
}
