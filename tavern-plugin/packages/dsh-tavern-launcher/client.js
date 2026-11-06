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
      installed: '酒馆已就绪。打开酒馆时，NEXT 会切换到 tavern Profile。',
      installedNow: '安装完成。现在可以打开酒馆。',
      updated: '更新完成。打开酒馆即可使用新版。',
      upToDate: '当前已是发布版。',
      unsupported: '请在支持插件管理的 DSH NEXT 中使用启动器。',
      conflict: '已有同名 Profile 或旧版酒馆。请先检查并迁移现有安装。',
      current: '你已在 tavern Profile 中。',
      install: '安装酒馆',
      open: '打开酒馆',
      update: '更新酒馆',
      remove: '卸载酒馆',
      nativeHint: '请在 DSH NEXT 桌面窗口中打开或卸载酒馆。',
      installing: '正在安装酒馆…',
      updating: '正在更新酒馆…',
      loading: '正在检查安装状态…',
      retry: '重新检查',
    }
    const en = {
      title: 'DSH Tavern Launcher',
      menu: 'Tavern Launcher',
      version: 'Installed DSH Tavern v',
      absent: 'Install the latest DSH Tavern in a separate tavern Profile.',
      ready: 'The tavern Profile is ready for installation.',
      installed: 'Tavern is ready. Opening it switches NEXT to the tavern Profile.',
      installedNow: 'Installation complete. You can now open Tavern.',
      updated: 'Update complete. Open Tavern to use the new version.',
      upToDate: 'The current release is already installed.',
      unsupported: 'Open the launcher in DSH NEXT with plugin management available.',
      conflict: 'A conflicting Profile or a legacy installation exists. Review it before migrating.',
      current: 'You are already in the tavern Profile.',
      install: 'Install Tavern',
      open: 'Open Tavern',
      update: 'Update Tavern',
      remove: 'Uninstall Tavern',
      nativeHint: 'Open or uninstall Tavern from the DSH NEXT desktop window.',
      installing: 'Installing Tavern…',
      updating: 'Updating Tavern…',
      loading: 'Checking installation…',
      retry: 'Check again',
    }

    function Launcher({ call, t }) {
      const [status, setStatus] = React.useState({ state: 'loading' })
      const [error, setError] = React.useState('')
      const [nativeBusy, setNativeBusy] = React.useState(false)
      const pending = React.useRef(false)
      const refresh = React.useCallback(async (endpoint = 'status') => {
        if (pending.current) return
        pending.current = true
        setError('')
        try {
          if (endpoint === 'switch' || endpoint === 'delete') {
            setNativeBusy(true)
            // The same bridge used by NEXT's own Desktop settings handles
            // confirmation, the orderly restart and the recovery backup.
            await window.desktopNext.command({ type: endpoint, name: 'tavern' })
            setStatus(await call('status'))
          } else {
            setStatus(await call(endpoint))
          }
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setNativeBusy(false)
          pending.current = false
        }
      }, [call])
      React.useEffect(() => { void refresh() }, [refresh])
      React.useEffect(() => {
        if (!['installing', 'updating'].includes(status.state)) return
        const timer = setInterval(() => { void refresh() }, 2500)
        return () => clearInterval(timer)
      }, [refresh, status.state])

      const canInstall = status.state === 'absent' || status.state === 'ready'
      const canManage = status.state === 'installed'
      const hasNative = typeof window.desktopNext?.command === 'function'
      const button = (label, action) => h('button', { key: label, type: 'button', disabled: nativeBusy, onClick: () => void refresh(action) }, t(label))
      return h('div', { style: { display: 'grid', gap: 12, justifyItems: 'start' } },
        h('h2', { style: { margin: 0 } }, t('title')),
        status.version ? h('strong', null, t('version') + status.version) : null,
        h('div', { role: error || status.error ? 'alert' : 'status' }, error || status.error || t(status.outcome || status.state)),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          canInstall ? button('install', 'install') : null,
          canManage && hasNative ? button('open', 'switch') : null,
          canManage ? button('update', 'update') : null,
          canManage && hasNative ? button('remove', 'delete') : null,
          error ? button('retry', 'status') : null),
        canManage && !hasNative ? h('small', null, t('nativeHint')) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(ns)
        const call = async endpoint => {
          const response = await fetch('/dsh-tavern-launcher/' + endpoint, { method: endpoint === 'status' ? 'GET' : 'POST' })
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
