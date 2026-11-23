import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// 手机右侧栏（宿主的 fullscreen 右栏 / Files 面板）在 DSH 0.2.x 上**一直挂着**：
// 关闭时它仍是 `pointer-events:none` 的整屏元素，盒子的 left 就在 0（酒馆的
// visualViewport 规则也把它钉在 left:0、width:100%）。dsh-web-mobile 3.1.0 判断
// 右栏是否打开用的是 0.1.5 的几何启发式（`rect.left < innerWidth`），于是永远认为
// 右栏开着；`classifyFilesSwipe` 对「面板已开」的左划一律返回 none —— 手机上从右缘
// 左划永远打不开右侧栏（#296）。修法：先读宿主自己写的状态标记
// `data-sidebar-right-open`，没有标记时读宿主关闭态真正隐藏的 dock 内容
// （`visibility: hidden`），几何启发式只留作老宿主的兜底。
const patchUrl = new URL('../patches/dsh-web-mobile@3.1.0.patch', import.meta.url)
const installedUrl = new URL('../node_modules/dsh-web-mobile/lib/client.js', import.meta.url)

const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `找不到 ${name}()`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, `${name}() 没有闭合`)
  return source.slice(start, end + 3)
}

const loadFunction = (source, name, globals) =>
  new Function(...Object.keys(globals), functionSource(source, name) + `\nreturn ${name}`)(...Object.values(globals))

// A minimal host: `panel` is the persistent `[data-sidebar-right-panel]`; the dock
// child is what the host hides while closed. `docked: false` models a 0.1.5 host
// that only has the panel box and needs the legacy geometry fallback.
function host({ marker = false, docked = true, dockVisibility = 'visible', panelVisibility = 'visible', left = 0, viewport = 390 } = {}) {
  const styles = new Map()
  const dock = docked ? { name: 'dock' } : null
  if (dock) styles.set(dock, { visibility: dockVisibility, display: 'flex' })
  const panel = {
    name: 'panel',
    hasAttribute: name => marker && name === 'data-sidebar-right-open',
    querySelector: selector => (dock !== null && selector.includes('[data-dockkit-host]')) ? dock : null,
    getBoundingClientRect: () => ({ left, width: viewport })
  }
  styles.set(panel, { visibility: panelVisibility, display: 'flex' })
  return {
    document: { querySelector: selector => selector === '[data-sidebar-right-panel]' ? panel : null },
    getComputedStyle: element => styles.get(element) || { visibility: 'visible', display: 'block' },
    window: { innerWidth: viewport }
  }
}

test('右缘左划的判定：面板关闭时是 files（打开右侧栏），打开时才是 none', { skip: !existsSync(installedUrl) }, async () => {
  const classifyFilesSwipe = loadFunction(await readFile(installedUrl, 'utf8'), 'classifyFilesSwipe', {})
  const thresholds = { distanceRatio: 0.16, velocity: 0.45, lockPx: 8, viewportWidthPx: 390, drawerCloseDistanceRatio: 0.13 }
  // 390px 视口上从右缘划到 x=120：dx=-266、横向占优。
  assert.equal(classifyFilesSwipe({ ...thresholds, panelOpen: false, drawerOpen: false }, { dx: -266, dy: 4, velX: -0.6 }, false), 'files', '两侧栏都关着时左划打开右栏')
  assert.equal(classifyFilesSwipe({ ...thresholds, panelOpen: true, drawerOpen: false }, { dx: -266, dy: 4, velX: -0.6 }, false), 'none', '面板已开时左划不重复提交')
  assert.equal(classifyFilesSwipe({ ...thresholds, panelOpen: true, drawerOpen: false }, { dx: 266, dy: 4, velX: 0.6 }, false), 'files', '面板开着时右划关闭')
})
