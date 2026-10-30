// dsh.danmaku uiLayers entry view/overlay.js — 飘屏 (viewer perspective: scrolling / top / bottom comments over the stage).
// The host never loads release JS (core-mod-architecture §6 / P4): the renderer is statically registered in the client as
// FORK_DANMAKU_RENDERERS['dsh.danmaku/view/overlay.js'] (tavern-plugin/src/client/danmaku-stage.cjs). This file only names it.
export default Object.freeze({ renderer: 'dsh.danmaku/view/overlay.js', layer: 'overlay' })
