/* ------------------------------------------------------------------ *
 * panel.js — the chip (a header tool; a row of the phone's ⋯ menu), its panel in the BGM panel's look, 回到朗读处, and the
 * 朗读全文 section of 语音后端. Controls are Tavern's own (tavernUi.components).
 * ------------------------------------------------------------------ */
const AB_ERRORS = { SERVICE_OFFLINE: '语音服务没有连上，请在语音后端里看看', 'voice-unbound': '这个声音没有可用的配音', 'voice-unavailable': '声音暂时无法使用',
  silent: '朗读声音设为不配音', VOICE_NOT_FOUND: '朗读声音不在了，请重新选择', SERVICE_REQUIRED: '朗读声音需要选择语音服务', TTS_UNAVAILABLE: '语音后端没有开启', STORY_UNAVAILABLE: '读不到正文' }
const abUse = store => React.useSyncExternalStore(store.subscribe, store.get)
const abVoiceKey = voice => !voice ? '' : voice.browser !== undefined ? 'browser:' + voice.browser : JSON.stringify([voice.figure.packId, voice.figure.figureId])

function AudiobookVoices({ ui, reader, back }) {
  const { SearchBox, Icon, Spinner, EmptyState } = ui.components
  const prefs = abUse(abPrefs)
  const [options, setOptions] = useState(null), [failed, setFailed] = useState(false), [query, setQuery] = useState('')
  useEffect(() => { let live = true; ui.readingVoices().then(list => { if (live) setOptions(list) }, () => { if (live) setFailed(true) }); return () => { live = false } }, [])
  const needle = query.trim().toLowerCase(), chosen = abVoiceKey(prefs.voice)
  const shown = (options || []).filter(option => !needle || (option.name + ' ' + option.group).toLowerCase().includes(needle))
  const pick = value => { abPrefs.set({ ...abPrefs.get(), voice: value }); reader.revoice(); back() }
  const row = (key, name, value) => h('li', { key }, h('button', { type: 'button', className: 'fork-bgm-track', 'aria-current': chosen === key ? 'true' : undefined, onClick: () => pick(value) }, h('span', null, name)))
  const rows = []
  if (!needle) rows.push(row('', '旁白声音', null))
  shown.forEach((option, i) => {
    if (i === 0 || shown[i - 1].group !== option.group) rows.push(h('li', { key: 'g:' + option.group + i, className: 'fork-audiobook-group', role: 'presentation' }, option.group))
    rows.push(row(option.key, option.name, option.value))
  })
  return h(Fragment, null,
    h('div', { className: 'fork-bgm-head fork-audiobook-back' },
      h('button', { type: 'button', className: 'fork-bgm-button', 'aria-label': '返回', title: '返回', onClick: back }, h(Icon, { name: 'chevron', size: 16 })),
      h('b', { className: 'fork-bgm-title' }, '朗读声音')),
    h(SearchBox, { className: 'fork-bgm-search', icon: h(Icon, { name: 'search', size: 15 }), value: query, placeholder: '搜索', label: '搜索声音', onChange: setQuery }),
    failed ? h('p', { className: 'fork-bgm-error', role: 'alert' }, '⚠ 声音列表载入失败')
      : !options ? h('p', { className: 'fork-bgm-empty' }, h(Spinner, null))
      : needle && !shown.length ? h(EmptyState, { compact: true, plain: true, query })
      : h('ul', { className: 'fork-bgm-list', 'aria-label': '朗读声音' }, rows))
}

function AudiobookPanel({ ui, reader, panelRef, style }) {
  const { Slider, Segmented, Icon, Spinner } = ui.components
  const s = abUse(reader), prefs = abUse(abPrefs)
  const [voices, setVoices] = useState(false)
  const playing = s.status === 'playing' || s.status === 'loading', unit = s.unit
  const control = (icon, label, action, disabled, className) => h('button', { type: 'button', className: 'fork-bgm-button' + (className ? ' ' + className : ''), title: label, 'aria-label': label, disabled: Boolean(disabled), onClick: action },
    s.status === 'loading' && className ? h(Spinner, null) : h(Icon, { name: icon, size: 18 }))
  const stop = event => event.stopPropagation()
  const setPrefs = patch => abPrefs.set({ ...abPrefs.get(), ...patch })
  return h('div', { ref: panelRef, 'data-level': 'popover', className: 'fk-surface fork-bgm fork-bgm-panel fork-audiobook is-chat', style, role: 'dialog', 'aria-label': '有声书',
    onClick: stop, onWheel: stop, onContextMenu: stop, onKeyDown: stop },
    voices ? h(AudiobookVoices, { ui, reader, back: () => setVoices(false) }) : h(Fragment, null,
      h('div', { className: 'fork-bgm-head' },
        h('i', { className: 'fork-bgm-gem', 'aria-hidden': true }),
        h('b', { className: 'fork-bgm-title' }, '有声书'),
        unit ? h('span', { className: 'fork-audiobook-where' }, '第 ' + unit.floor + ' 楼') : null),
      unit ? h('p', { className: 'fork-audiobook-now' }, h('b', null, unit.speaker || '旁白'), unit.text) : null,
      // the default 旁白声音 may point at a figure without a voice (or 不配音): say so, not 「不在了」
      s.error ? h('p', { className: 'fork-bgm-error', role: 'alert' }, '⚠ ' + (!prefs.voice && (s.error === 'VOICE_NOT_FOUND' || s.error === 'silent') ? '旁白声音还没有配音，请在下面选一个朗读声音' : AB_ERRORS[s.error] || '朗读失败')) : null,
      h('div', { className: 'fork-bgm-controls' },
        control('prev', '上一句', () => reader.step(-1), !unit),
        control(playing ? 'pause' : 'play', playing ? '暂停' : '播放', () => playing ? reader.pause() : reader.play(), false, 'fork-bgm-play fk-on-accent'),
        control('next', '下一句', () => reader.step(1), !unit),
        unit ? h('button', { type: 'button', className: 'fork-audiobook-end', onClick: () => reader.stop() }, h('i', { 'aria-hidden': true }), '结束朗读') : null),
      h('div', { className: 'fork-audiobook-row' }, h('span', null, '音量'),
        h(Slider, { label: '音量', min: 0, max: 1, step: 0.05, value: prefs.volume, valueText: v => Math.round(v * 100) + '%', output: v => String(Math.round(v * 100)),
          onChange: v => { setPrefs({ volume: v }); reader.tune() } })),
      h('div', { className: 'fork-audiobook-row' }, h('span', null, '语速'),
        h(Slider, { label: '语速', min: 0.5, max: 2, step: 0.1, value: prefs.rate, reset: 1, valueText: v => v.toFixed(1) + ' 倍', output: v => v.toFixed(1) + '×',
          onChange: v => { setPrefs({ rate: v }); reader.tune() } })),
      h('div', { className: 'fork-audiobook-row' }, h('span', null, '朗读声音'),
        h('button', { type: 'button', className: 'fork-audiobook-pick', 'aria-label': '朗读声音：' + (prefs.voice ? prefs.voice.name : '旁白声音'), onClick: () => setVoices(true) },
          h('span', null, prefs.voice ? prefs.voice.name : '旁白声音'), h(Icon, { name: 'chevron', size: 14 }))),
      h('div', { className: 'fork-audiobook-row' }, h('span', null, '台词'),
        h(Segmented, { base: 'fork-audiobook-seg', label: '台词', value: prefs.lines, options: [['figure', '按角色'], ['reader', '全用朗读声音']],
          onChange: v => { setPrefs({ lines: v }); reader.revoice() } }))))
}

// The panel stands under its chip (under ⋯ for a menu row), closes on Escape and on a click outside.
function useAbPopover(open, close, chip, panel, menu) {
  const [place, setPlace] = useState(null)
  useEffect(() => {
    if (!open || !chip.current) { setPlace(null); return }
    const anchor = menu && chip.current.closest('.dsh-tavern-more-actions')?.querySelector('[data-fork-more]') || chip.current
    const rect = anchor.getBoundingClientRect(), width = Math.min(340, window.innerWidth - 16)
    setPlace({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: rect.bottom + 6, width,
      maxHeight: Math.min(Math.round(window.innerHeight * 0.7), window.innerHeight - rect.bottom - 18) })
    const outside = event => { if (!panel.current?.contains(event.target) && !chip.current?.contains(event.target)) close() }
    const key = event => { if (event.key === 'Escape') { close(); chip.current?.focus() } }
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key) }
  }, [open])
  return place
}

// 回到朗读处: while reading, after the reader scrolled away (the story stopped following), centred above the story's end.
function AudiobookReturn({ reader, gameId }) {
  const s = abUse(reader)
  const away = s.gameId === gameId && s.status !== 'idle' && !s.following
  const box = away ? abScroller() : null, rect = box && box.getBoundingClientRect()
  const style = rect ? { left: Math.round(rect.left + rect.width / 2) + 'px', top: Math.round(rect.bottom - 52) + 'px' } : undefined
  return ReactDOM.createPortal(h('button', { type: 'button', className: 'fork-audiobook-return', 'data-shown': away && rect ? 'true' : undefined, 'aria-hidden': away ? undefined : 'true', tabIndex: away ? undefined : -1, style,
    onClick: event => { event.stopPropagation(); reader.refollow() } }, h('i', { 'aria-hidden': true }), '回到朗读处'), document.body)
}

function AudiobookChat({ ui, reader, gameId, menu }) {
  const { Icon } = ui.components
  const on = abUse(abSwitch) === 'on', s = abUse(reader)
  const [open, setOpen] = useState(false)
  const chip = React.useRef(null), panel = React.useRef(null)
  useEffect(() => { if (on) reader.bind(gameId) }, [on, gameId])
  useEffect(() => { if (open) void reader.prepare() }, [open])
  const place = useAbPopover(open, () => setOpen(false), chip, panel, menu)
  if (!on) return null
  const reading = s.gameId === gameId && (s.status === 'playing' || s.status === 'loading')
  const portal = open && place ? ReactDOM.createPortal(h(AudiobookPanel, { ui, reader, panelRef: panel, style: place }), document.body) : null
  if (menu) return h(Fragment, null,
    h('button', { ref: chip, type: 'button', role: 'menuitem', className: 'fork-bgm-menu-row' + (reading ? '' : ' is-paused'), 'data-fork-phone-item': 'audiobook', 'data-keep-open': '',
      'aria-label': '有声书', 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => setOpen(!open) },
      h(Icon, { name: 'speaker', size: 18 }), '有声书', reading ? h('span', { className: 'fork-bgm-menu-track' }, '朗读中') : null),
    portal)
  return h(Fragment, null,
    h('button', { ref: chip, type: 'button', className: 'dsh-tavern-btn fork-bgm fork-bgm-chip is-chat fork-audiobook-chip' + (reading ? ' is-reading' : ' is-paused'),
      title: '有声书', 'aria-label': reading ? '有声书：朗读中' : '有声书', 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => setOpen(!open) },
      h(Icon, { name: 'speaker', size: 15 })),
    h(AudiobookReturn, { reader, gameId }),
    portal)
}

// 语音后端 › 朗读全文: the one 有声书 switch. While on, the stage and the reply bubbles do not voice (tavernUi.holdVoice).
function audiobookSettingsSection(ui) {
  return function AudiobookSettingsSection({ Section, Field }) {
    const { Switch } = ui.components
    const on = abUse(abSwitch) === 'on'
    return h(Section, { title: '朗读全文' },
      h(Field, { label: '有声书', help: '打开后正文顶栏出现小喇叭，可以像听有声书一样连续朗读正文。有声书开着时，舞台和正文气泡的配音都关掉；关掉有声书就恢复。' },
        h(Switch, { label: '有声书', checked: on, onChange: value => abSwitch.set(value ? 'on' : 'off') })))
  }
}
