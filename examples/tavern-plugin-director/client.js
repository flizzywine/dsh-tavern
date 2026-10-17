// 导演插件示例（浏览器侧）：用 registerStageView 换掉舞台画面。
// 背景按宿主侧导演定下的时间、气氛着色，左上角写地点；人物立绘来自 Tavern 的角色素材，
// 没有立绘时用头像，再没有就用名字首字。翻页、自动播放、输入仍由 Tavern 负责，
// 只要把 footer 放进自己的文字框。render 返回 null 或出错时，Tavern 自动换回内置舞台。
window.__ModuleLoader__.load({
  id: 'tavern-plugin-director',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const SKY = { 清晨: ['#f6d6b8', '#a7c7e7'], 白天: ['#8ec5fc', '#e0f0ff'], 黄昏: ['#f4845f', '#6a4c93'], 夜晚: ['#0f2027', '#2c5364'] }
    const TINT = { 平静: 'rgba(0,0,0,0)', 温馨: 'rgba(255,170,120,.18)', 欢快: 'rgba(255,230,120,.18)', 紧张: 'rgba(160,0,0,.22)', 悲伤: 'rgba(40,60,120,.3)', 神秘: 'rgba(90,40,140,.3)' }

    // The director decides after Tavern's settlement, so read again whenever the game's state moves on.
    function useScene(ui, gameId, turn) {
      const [scene, setScene] = React.useState(null)
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => ui.watchTurnState(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => {
        let active = true
        if (turn) ui.callHost('tavern-plugin-director/scene', { gameId, turn }).then(value => { if (active) setScene(value) }, () => {})
        return () => { active = false }
      }, [gameId, turn, version])
      return scene
    }

    function Figure({ character, name, emotion, speaking }) {
      const url = character ? character.sprites[emotion] || character.sprites.neutral || Object.values(character.sprites)[0] || character.avatarUrl : ''
      return h('div', { style: { flex: '0 0 auto', height: '100%', display: 'flex', alignItems: 'flex-end', opacity: speaking ? 1 : 0.55, transform: speaking ? 'translateY(-4px)' : 'none', transition: 'all .3s' } },
        url ? h('img', { src: url, alt: name, style: { maxHeight: '100%', maxWidth: 240, objectFit: 'contain' } })
          : h('div', { style: { width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,.75)', color: '#333', display: 'grid', placeItems: 'center', fontSize: 32, marginBottom: 12 } }, Array.from(name)[0] || '?'))
    }

    function DirectorScene({ ui, gameId, stage, beats, index, beat, fullscreen, advance, footer }) {
      const scene = useScene(ui, gameId, beat && beat.turn)
      const find = name => stage.characters.find(item => item.name === name || item.aliases.includes(name)) || null
      const present = [], emotions = new Map()
      for (const item of beats.slice(0, index + 1)) {
        if (item.kind !== 'line' || item.speaker === stage.player) continue
        if (!present.includes(item.speaker)) present.push(item.speaker)
        emotions.set(item.speaker, item.emotion)
      }
      const [top, bottom] = SKY[scene && scene.time] || ['#3a3a4a', '#1e1e28']
      return h('div', { onClick: advance, style: { position: 'relative', height: fullscreen ? '100%' : 360, minHeight: 260, overflow: 'hidden', borderRadius: fullscreen ? 0 : 8, cursor: 'pointer', color: '#fff',
        background: 'linear-gradient(' + top + ',' + bottom + ')' } },
        h('div', { style: { position: 'absolute', inset: 0, background: TINT[scene && scene.mood] || 'transparent', transition: 'background .6s' } }),
        scene ? h('div', { style: { position: 'absolute', top: 10, left: 12, fontSize: 13, padding: '2px 10px', borderRadius: 12, background: 'rgba(0,0,0,.35)' } }, scene.place + ' · ' + scene.time) : null,
        h('div', { style: { position: 'absolute', left: 0, right: 0, top: 36, bottom: 110, display: 'flex', justifyContent: 'center', gap: 16 } },
          present.slice(-3).map(name => h(Figure, { key: name, name, character: find(name), emotion: emotions.get(name), speaking: beat && beat.speaker === name }))),
        h('div', { style: { position: 'absolute', left: 12, right: 12, bottom: 12, minHeight: 86, padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,.6)' } },
          beat && beat.kind === 'line' ? h('div', { style: { fontWeight: 600, marginBottom: 4 } }, beat.speaker) : null,
          h('div', { style: { fontStyle: beat && beat.kind === 'narration' ? 'italic' : 'normal', lineHeight: 1.6 } }, beat ? beat.text : '还没有可以演出的正文'),
          footer))
    }

    return {
      name: 'tavern-plugin-director',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi
        if (!(ui.apiVersion >= 2) || typeof ui.registerStageView !== 'function') return
        ui.registerStageView({ id: 'scene', label: '导演舞台', render: input => h(DirectorScene, { ui, ...input }) })
      },
    }
  },
})
