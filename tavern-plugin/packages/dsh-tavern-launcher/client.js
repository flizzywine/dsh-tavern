window.__ModuleLoader__.load({
  id: 'dsh-tavern-launcher',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ns = 'tavernLauncher'
    const zh = {
      title: 'dsh-tavern 启动器',
      menu: '酒馆启动器',
      version: '已安装 DSH Tavern v',
      absent: '在独立的 tavern Profile 中安装最新版酒馆。',
      ready: 'tavern Profile 已准备好，可以安装酒馆。',
      installed: '请从 NEXT 托盘的 Profile 菜单切换到 tavern。',
      unsupported: '请在支持插件管理的 DSH NEXT 中使用启动器。',
      conflict: '已有同名 Profile 或旧版酒馆。请先检查并迁移现有安装。',
      current: '你已在 tavern Profile 中。',
      install: '安装酒馆',
      installing: '正在安装酒馆…',
      loading: '正在检查安装状态…',
      retry: '重新检查',
    }
    const en = {
      title: 'DSH Tavern Launcher',
      menu: 'Tavern Launcher',
      version: 'Installed DSH Tavern v',
      absent: 'Install the latest DSH Tavern in a separate tavern Profile.',
      ready: 'The tavern Profile is ready for installation.',
      installed: 'Switch to tavern from the NEXT tray Profile menu.',
      unsupported: 'Open the launcher in DSH NEXT with plugin management available.',
      conflict: 'A conflicting Profile or a legacy installation exists. Review it before migrating.',
      current: 'You are already in the tavern Profile.',
      install: 'Install Tavern',
      installing: 'Installing Tavern…',
      loading: 'Checking installation…',
      retry: 'Check again',
    }

    function Launcher({ call, t }) {
      const [status, setStatus] = React.useState({ state: 'loading' })
      const [error, setError] = React.useState('')
      const pending = React.useRef(false)
      const refresh = React.useCallback(async (endpoint = 'status') => {
        if (pending.current) return
        pending.current = true
        setError('')
        if (endpoint === 'install') setStatus({ state: 'installing' })
        try {
          setStatus(await call(endpoint))
        } catch (cause) {
          setStatus({ state: 'error' })
          setError(String(cause?.message ?? cause))
        } finally {
          pending.current = false
        }
      }, [call])
      React.useEffect(() => { void refresh() }, [refresh])
      React.useEffect(() => {
        if (status.state !== 'installing') return
        const timer = setInterval(() => { void refresh() }, 2500)
        return () => clearInterval(timer)
      }, [refresh, status.state])

      const canInstall = status.state === 'absent' || status.state === 'ready'
      return h('div', { style: { display: 'grid', gap: 12, justifyItems: 'start' } },
        h('h2', { style: { margin: 0 } }, t('title')),
        status.version ? h('strong', null, t('version') + status.version) : null,
        h('div', { role: error || status.error ? 'alert' : 'status' }, error || status.error || t(status.state)),
        canInstall ? h('button', { type: 'button', onClick: () => void refresh('install') }, t('install')) : null,
        error ? h('button', { type: 'button', onClick: () => void refresh() }, t('retry')) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(ns)
        const call = async endpoint => {
          const response = await fetch('/dsh-tavern-launcher/' + endpoint, { method: endpoint === 'install' ? 'POST' : 'GET' })
          if (!response.ok && !response.headers.get('content-type')?.startsWith('application/json')) {
            throw new Error('HTTP ' + response.status)
          }
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status)
          return result
        }
        ctx.effect(() => ctx.locale.register(ns, { zh, en }), 'Tavern launcher locale')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-tavern-launcher', order: 60,
          label: () => t('menu'), inject: () => ({ call, t }),
        }, Launcher))
      },
    }
  },
})
