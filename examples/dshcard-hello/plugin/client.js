// 最小卡内插件（浏览器侧）：在「酒馆状态」里加一节「本幕氛围」，底色按宿主侧记下的氛围变。
window.__ModuleLoader__.load({
  id: 'dsh-card-hello-mood',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const COLORS = { warm: ['#5a3418', '#c9853f'], calm: ['#29404a', '#7fa3a8'], tense: ['#3a1414', '#a8442f'], night: ['#0f1530', '#3b4a86'] }

    function useMood(ui, gameId, turn) {
      const [mood, setMood] = React.useState('warm')
      const [version, setVersion] = React.useState(0)
      // 新一轮结算完、玩家改了本局设置，都重新问一次。
      React.useEffect(() => ui.watchTurnState(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => ui.watchGameSettings(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => {
        let active = true
        ui.callHost('dshcard-hello/mood', { gameId, turn: turn || 0 }).then(reply => { if (active) setMood(reply.mood) }, () => {})
        return () => { active = false }
      }, [gameId, turn, version])
      return mood
    }

    // 酒馆状态里的一节：这一幕的氛围，底色跟着氛围变。
    function MoodSection({ ui, gameId }) {
      const mood = useMood(ui, gameId, 0)
      const [dark, light] = COLORS[mood] || COLORS.warm
      return h('div', { style: { padding: '10px 14px', borderRadius: 8, color: '#fff', background: 'linear-gradient(160deg, ' + light + ', ' + dark + ')', transition: 'background .8s' } },
        '氛围：' + mood)
    }

    return {
      name: 'dsh-card-hello-mood',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi
        if (typeof ui.registerStatusSection !== 'function') return
        ui.registerStatusSection({ id: 'mood', title: '本幕氛围', render: ({ gameId }) => h(MoodSection, { ui, gameId }) })
      },
    }
  },
})
