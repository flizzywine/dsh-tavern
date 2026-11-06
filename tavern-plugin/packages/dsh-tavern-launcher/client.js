window.__ModuleLoader__.load({
  id: 'dsh-tavern-launcher',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ns = 'tavernLauncher'
    const pendingKey = 'dsh-tavern-launcher:profile-handoff'
    const zh = {
      title: '酒馆启动器',
      currentProfile: '当前 Profile',
      originalProfile: '原版 DSH',
      tavernProfile: 'DSH 酒馆',
      management: '酒馆安装管理',
      version: '已安装 DSH Tavern v',
      absent: '在独立的 tavern Profile 中安装最新版酒馆。',
      ready: 'tavern Profile 已准备好，可以安装酒馆。',
      installed: '酒馆已就绪。打开酒馆时，NEXT 会切换到 tavern Profile。',
      installedNow: '安装完成。现在可以打开酒馆。',
      updated: '更新完成。打开酒馆即可使用新版。',
      upToDate: '当前已是发布版。',
      unsupported: '请在支持插件管理的 DSH NEXT 中使用启动器。',
      conflict: '已有同名 Profile 或旧版酒馆。请先检查并迁移现有安装。',
      current: '更新或卸载时，NEXT 会先切回原版 DSH，再处理酒馆。',
      upgradeLauncher: '请先切回原版 DSH，把启动器升级到 1.3.0，再使用这里的更新和卸载。',
      back: '切回原版 DSH',
      returnHint: '请在 DSH NEXT 桌面窗口中切回原版 DSH。',
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
      currentProfile: 'Current Profile',
      originalProfile: 'Original DSH',
      tavernProfile: 'DSH Tavern',
      management: 'Tavern installation',
      version: 'Installed DSH Tavern v',
      absent: 'Install the latest DSH Tavern in a separate tavern Profile.',
      ready: 'The tavern Profile is ready for installation.',
      installed: 'Tavern is ready. Opening it switches NEXT to the tavern Profile.',
      installedNow: 'Installation complete. You can now open Tavern.',
      updated: 'Update complete. Open Tavern to use the new version.',
      upToDate: 'The current release is already installed.',
      unsupported: 'Open the launcher in DSH NEXT with plugin management available.',
      conflict: 'A conflicting Profile or a legacy installation exists. Review it before migrating.',
      current: 'NEXT switches back to the original DSH before updating or uninstalling Tavern.',
      upgradeLauncher: 'Return to the original DSH and upgrade the launcher to 1.3.0 to manage Tavern from here.',
      back: 'Return to original DSH',
      returnHint: 'Switch back to the original DSH from the DSH NEXT desktop window.',
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

    function Launcher({ call, t, handoffFailure }) {
      const [status, setStatus] = React.useState({ state: 'loading' })
      const [error, setError] = React.useState('')
      const [nativeBusy, setNativeBusy] = React.useState(false)
      const pending = React.useRef(false)
      const refresh = React.useCallback(async (endpoint = 'status') => {
        if (pending.current) return
        pending.current = true
        setError('')
        try {
          if (['open', 'back', 'delete', 'switch-update', 'switch-delete'].includes(endpoint)) {
            setNativeBusy(true)
            const latest = await call('status')
            const fromTavern = endpoint === 'back' || endpoint.startsWith('switch-')
            if (latest.state !== (fromTavern ? 'current' : 'installed')) {
              setStatus(latest)
              return
            }
            if (fromTavern && endpoint !== 'back') {
              if (!latest.canHandoff) {
                setStatus(latest)
                return
              }
              localStorage.setItem(pendingKey, JSON.stringify({ action: endpoint.slice(7), expiresAt: Date.now() + 120000 }))
            } else if (endpoint === 'back') {
              localStorage.removeItem(pendingKey)
            }
            // The same bridge used by NEXT's own Desktop settings handles
            // confirmation, the orderly restart and the recovery backup.
            try {
              await window.desktopNext.command({ type: endpoint === 'delete' ? 'delete' : 'switch', name: fromTavern ? 'desktop' : 'tavern' })
            } catch (error) {
              if (fromTavern) localStorage.removeItem(pendingKey)
              throw error
            }
            const after = await call('status')
            if (fromTavern && after.selectedProfile === 'tavern') localStorage.removeItem(pendingKey)
            setStatus(after)
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
      const current = status.state === 'current'
      const failure = error || status.error || handoffFailure()
      const button = (label, action) => h('button', { key: label, type: 'button', disabled: nativeBusy, onClick: () => void refresh(action) }, t(label))
      const actions = { display: 'flex', flexWrap: 'wrap', gap: 8 }
      return h('section', { style: { display: 'grid', gap: 12, justifyItems: 'start' } },
        h('h2', { style: { margin: 0 } }, t('title')),
        current || status.profile ? h('div', null, `${t('currentProfile')} · ${current ? t('tavernProfile') : status.profile === 'desktop' ? t('originalProfile') : status.profile}`) : null,
        h('div', { style: actions },
          canManage && hasNative ? button('open', 'open') : null,
          current && hasNative ? button('back', 'back') : null),
        h('h3', { style: { margin: 0 } }, t('management')),
        status.version ? h('strong', null, t('version') + status.version) : null,
        h('div', { role: failure ? 'alert' : 'status' }, failure || t(current && !status.canHandoff ? 'upgradeLauncher' : status.outcome || status.state)),
        h('div', { style: actions },
          canInstall && hasNative ? button('install', 'install') : null,
          canManage && hasNative ? button('update', 'update') : null,
          canManage && hasNative ? button('remove', 'delete') : null,
          current && hasNative && status.canHandoff ? button('update', 'switch-update') : null,
          current && hasNative && status.canHandoff ? button('remove', 'switch-delete') : null,
          error ? button('retry', 'status') : null),
        (canInstall || canManage) && !hasNative ? h('small', null, t('nativeHint')) : null,
        status.state === 'current' && !hasNative ? h('small', null, t('returnHint')) : null,
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
        let handoffFailure = ''
        ctx.effect(() => {
          if (typeof window.desktopNext?.command !== 'function') return
          void (async () => {
            const pending = JSON.parse(localStorage.getItem(pendingKey))
            if (!pending) return
            if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now() || !['update', 'delete'].includes(pending.action)) {
              localStorage.removeItem(pendingKey)
              return
            }
            const status = await call('status')
            if (status.profile !== 'desktop') return
            // NEXT relaunches both Profiles at the same desktop origin. Consume once on desktop.
            localStorage.removeItem(pendingKey)
            if (status.state !== 'installed') return
            if (pending.action === 'delete') await window.desktopNext.command({ type: 'delete', name: 'tavern' })
            else await call('update')
          })().catch(error => { handoffFailure = String(error?.message ?? error) })
        }, 'Continue Tavern management after Profile switch')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-tavern-launcher', order: 60,
          label: () => t('title'), inject: () => ({ call, t, handoffFailure: () => handoffFailure }),
        }, Launcher))
      },
    }
  },
})
