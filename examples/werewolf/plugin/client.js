window.__ModuleLoader__.load({ id: 'dsh-card-werewolf', factory: require => {
  const React = require('react'), h = React.createElement
  function apply(ctx) {
  function Game({ data, busy, advance }) {
    const [text, setText] = React.useState('')
    const labels = { 'wolf-talk': '狼队密谈', 'wolf-vote': '狼队行动', seer: '预言家行动', dawn: '天亮', speech: '白天发言', vote: '放逐投票', verdict: '投票结算', ended: '结束' }
    return h('div', { style: { padding: 16, borderRadius: 16, background: '#172236', color: '#f3e9d2', maxHeight: '70vh', overflow: 'auto' } },
      h('h2', null, '月下六席 · 狼人杀'),
      h('p', null, '第' + data.day + '天 · ' + (labels[data.phase] || data.phase) + ' · 你的身份：' + data.self.role),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 } }, data.players.map(p => h('div', { key: p.id, style: { padding: 10, border: '1px solid #65748a', borderRadius: 8, opacity: p.alive ? 1 : 0.45 } },
        p.id + '号 ' + p.name, h('div', null, p.alive ? '存活' : '出局'), data.revealed ? h('div', null, data.revealed.find(r => r.id === p.id).role) : null))),
      data.teammates.length ? h('p', null, '你的狼队：' + data.teammates.join('、') + '号') : null,
      data.winner ? h('h3', null, data.winner === '平局' ? '本局平局' : data.winner + '获胜') : null,
      h('div', { role: 'log', style: { maxHeight: 220, overflowY: 'auto', margin: '12px 0' } }, data.history.map((e, i) => h('p', { key: i }, (e.private ? '【私密】' : '') + '第' + e.day + '天 · ' + (e.actor === 'dm' ? '公告' : e.actor + '号') + '：' + e.text))),
      data.action?.kind === 'continue' ? h('button', { disabled: busy, onClick: () => advance(null) }, busy ? '角色正在思考…' : '继续下一步') : null,
      data.action?.kind === 'speak' ? h('div', null, h('textarea', { value: text, maxLength: 1200, disabled: busy, 'aria-label': '你的发言', onChange: e => setText(e.target.value), style: { width: '100%', minHeight: 70 } }),
        h('button', { disabled: busy || !text.trim(), onClick: async () => { await advance({ text }); setText('') } }, '提交发言')) : null,
      data.action?.targets ? h('div', null, h('p', null, { kill: '选择袭击目标', inspect: '选择查验目标', vote: '选择放逐目标' }[data.action.kind]),
        data.action.targets.map(id => h('button', { key: id, disabled: busy, onClick: () => advance({ target: id }) }, id + '号')),
        data.action.abstain ? h('button', { disabled: busy, onClick: () => advance({ target: 0 }) }, '弃票') : null) : null,
      h('details', null, h('summary', null, '本局规则'), h('p', null, data.rules)))
  }
  ctx.tavernUi.registerGameModeView({ name: 'six-player', render: Game })
  }
  return { name: 'dsh-card-werewolf', inject: ['tavernUi'], apply }
} })
