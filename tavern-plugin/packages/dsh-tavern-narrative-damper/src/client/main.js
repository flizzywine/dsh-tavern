/* ------------------------------------------------------------------ *
 * main.js —— 挂载点：侧栏「插件」里的叙事阻尼器面板。
 *
 * 宿主设置里不再有这一页；面板随插件启停，读写走本插件的宿主半（lib/index.js）。
 * ------------------------------------------------------------------ */

function tndRegisterSafely(ctx, label, factory) {
  try {
    return factory()
  } catch (error) {
    try { console.warn('[dsh-tavern-narrative-damper] 挂载点注册失败：' + label, error && error.message) } catch {}
    return null
  }
}

function apply(ctx) {
  const ui = ctx && ctx.tavernUi
  if (!ui || typeof ui.registerPanel !== 'function') return
  tndEnsureStyle()
  tndRegisterSafely(ctx, 'narrative-damper: panel', () => ui.registerPanel({
    id: 'narrative-damper',
    title: '叙事阻尼器',
    render: () => h(TndPanel, { ui })
  }))
}

exports.name = 'dsh-tavern-narrative-damper'
exports.inject = ['tavernUi']
exports.apply = apply
exports.TndPanel = TndPanel
exports.TndField = TndField
exports.__test = {
  TND_PROVIDERS,
  tndProviderMeta,
  tndProviderPatch,
  tndKeyError,
  tndThreshold,
  tndTimeout,
  tndCredentialText
}
