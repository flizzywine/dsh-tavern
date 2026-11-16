/* ------------------------------------------------------------------ *
 * main.js — what the plugin registers: the header tool (chip / ⋯ row), the 朗读全文 section of 语音后端, and the hold
 * on Tavern's voice channel while 有声书 is on.
 * ------------------------------------------------------------------ */
function apply(ctx) {
  const ui = ctx && ctx.tavernUi
  if (!ui || !(ui.apiVersion >= 9)) return
  abEnsureStyle()
  const reader = createAudiobook(ui)
  window.forkAudiobookDiagnostics = reader.diagnostics
  // While 有声书 is on, the stage and the bubbles do not voice; turning it off ends the reading and gives the voicing back.
  let release = null
  const sync = () => {
    const on = abSwitch.get() === 'on'
    if (on && !release) release = ui.holdVoice()
    if (!on && release) { reader.stop(); release(); release = null }
  }
  sync()
  const off = abSwitch.subscribe(sync)
  ctx.effect(() => () => { off(); reader.dispose(); if (release) release(); release = null }, 'audiobook: voice channel')
  ui.registerHeaderTool({ id: 'audiobook', render: ({ gameId, menu } = {}) => h(AudiobookChat, { ui, reader, gameId, menu }) })
  if (typeof ctx.inject === 'function') ctx.inject(['ttsPanelSections'], child => child.effect(() => child.get('ttsPanelSections').register('audiobook', audiobookSettingsSection(ui))))
}

exports.name = 'dsh-tavern-audiobook'
exports.inject = ['tavernUi']
exports.apply = apply
exports.__test = { abStartIndex, abPlaceIndex, abPlace, abPause, abFlat, abFind, abSwitch, abPrefs, createAudiobook }