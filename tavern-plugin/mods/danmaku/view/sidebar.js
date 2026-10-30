// dsh.danmaku uiLayers entry view/sidebar.js — 直播风格 (streamer perspective: live console chat dock).
// The host never loads release JS (core-mod-architecture §6 / P4): the renderer is statically registered in the client as
// FORK_DANMAKU_RENDERERS['dsh.danmaku/view/sidebar.js'] (tavern-plugin/src/client/danmaku-stage.cjs). This file only names it.
export default Object.freeze({ renderer: 'dsh.danmaku/view/sidebar.js', layer: 'sidebar' })
