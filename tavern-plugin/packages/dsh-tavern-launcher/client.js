window.__ModuleLoader__.load({
  id: 'dsh-tavern-launcher',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ns = 'tavernLauncher'
    const pendingKey = 'dsh-tavern-launcher:profile-handoff'
    const steps = ['findRelease', 'prepareProfile', 'installPackage', 'verifyInstall']
    const zh = {
      title: '酒馆启动器',
      currentProfile: '当前 Profile',
      originalProfile: '原版 DSH',
      tavernProfile: 'DSH 酒馆',
      management: '酒馆安装管理',
      explain: '在独立的 Profile 之间切换，或管理酒馆安装。',
      appDir: '酒馆程序目录',
      profileDir: '酒馆配置与依赖目录',
      dataDir: '酒馆专属数据目录',
      sharedHome: '原版 DSH / 共享目录',
      reviewRemove: '确认删除 DSH 酒馆',
      removeScope: 'NEXT 会将酒馆 Profile 移到恢复备份，保留角色卡、对话和共享数据。',
      continueRemove: '继续删除',
      cancel: '取消',
      installedBuild: '当前安装',
      latestBuild: '最新发布',
      unknownCommit: '此版本未记录源码提交',
      check: '检查更新',
      checking: '正在检查…',
      checkHint: '检查更新后显示最新发布的版本和提交号。',
      updateAvailable: '有新版本',
      noUpdate: '已是最新版本',
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
      remove: '删除 DSH 酒馆',
      nativeHint: '请在 DSH NEXT 桌面窗口中打开或卸载酒馆。',
      installing: '正在安装酒馆…',
      findRelease: '查询最新发布',
      prepareProfile: '准备独立 Profile',
      installPackage: '下载并安装酒馆',
      verifyInstall: '验证安装',
      elapsed: '已用时',
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
      explain: 'Switch between separate Profiles or manage the Tavern installation.',
      appDir: 'Tavern application directory',
      profileDir: 'Tavern profile and dependencies',
      dataDir: 'Tavern data directory',
      sharedHome: 'Original DSH / shared directory',
      reviewRemove: 'Confirm removal of DSH Tavern',
      removeScope: 'NEXT moves the Tavern Profile to a recovery backup and keeps cards, chats and shared data.',
      continueRemove: 'Continue to removal',
      cancel: 'Cancel',
      installedBuild: 'Installed build',
      latestBuild: 'Latest release',
      unknownCommit: 'Source commit unavailable for this build',
      check: 'Check for updates',
      checking: 'Checking…',
      checkHint: 'Check for updates to see the latest released version and commit.',
      updateAvailable: 'Update available',
      noUpdate: 'Up to date',
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
      remove: 'Remove DSH Tavern',
      nativeHint: 'Open or uninstall Tavern from the DSH NEXT desktop window.',
      installing: 'Installing Tavern…',
      findRelease: 'Find the latest release',
      prepareProfile: 'Prepare the separate Profile',
      installPackage: 'Download and install Tavern',
      verifyInstall: 'Verify the installation',
      elapsed: 'Elapsed',
      updating: 'Updating Tavern…',
      loading: 'Checking installation…',
      retry: 'Check again',
    }

    // Restore the Profile Bridge settings layout in the NEXT launcher.
    const CSS = `
.tl { display: grid; gap: 16px; font-size: 13px; line-height: 1.6; color: inherit; width: 100%; max-width: 640px; min-width: 0;
  --tl-accent: #4d6bfe; --tl-accent-soft: rgba(77,107,254,0.07); --tl-line: rgba(127,127,127,0.25); --tl-fill: rgba(127,127,127,0.06); }
.tl * { box-sizing: border-box; }
.tl-head { display: grid; gap: 2px; }
.tl-title { margin: 0; font-size: 16px; font-weight: 600; }
.tl-sub { margin: 0; opacity: 0.6; }
.tl-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 10px; background: var(--tl-accent-soft); }
.tl-bar-text { flex: 1; min-width: 0; }
.tl-btn { appearance: none; font: inherit; font-size: 13px; color: #fff; background: var(--tl-accent); border: 1px solid transparent; border-radius: 8px; padding: 6px 16px; cursor: pointer; }
.tl-btn:hover:not(:disabled) { background: #3d5bf0; }
.tl-btn:disabled { opacity: 0.5; cursor: default; }
.tl-btn-quiet { color: inherit; background: var(--tl-fill); border-color: var(--tl-line); }
.tl-btn-quiet:hover:not(:disabled) { background: var(--tl-accent-soft); }
.tl-error { margin: 0; padding: 10px 12px; border-radius: 10px; color: #e5484d; background: rgba(229,72,77,0.08); }
.tl-management { display: grid; gap: 10px; border: 1px solid var(--tl-line); border-radius: 10px; padding: 14px; min-width: 0; }
.tl-management h3, .tl-management p { margin: 0; }
.tl-builds { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.tl-builds dt { opacity: .65; }
.tl-builds dd { margin: 0; overflow-wrap: anywhere; }
.tl-builds a { color: inherit; }
.tl-release-badge { display: inline-block; margin-inline-start: 8px; padding: 1px 8px; border-radius: 999px; background: var(--tl-fill); font-weight: 600; }
.tl-release-badge-available { background: var(--tl-accent-soft); color: var(--tl-accent); }
.tl-paths { margin: 0; display: grid; gap: 4px; min-width: 0; }
.tl-paths dt { opacity: .65; }
.tl-paths dd { margin: 0 0 6px; overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
.tl-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.tl-progress { display: grid; gap: 8px; padding: 12px; border-radius: 8px; background: var(--tl-accent-soft); }
.tl-progress progress { width: 100%; height: 6px; accent-color: var(--tl-accent); }
.tl-steps { display: grid; gap: 4px; margin: 0; padding-inline-start: 24px; }
.tl-steps li:not([aria-current]) { opacity: .65; }
.tl-steps li[aria-current] { font-weight: 600; }
.tl-review { display: grid; gap: 10px; border-top: 1px solid var(--tl-line); padding-top: 12px; }
.tl-danger { color: #d93f44; }
`

    function Launcher({ call, t, handoffFailure }) {
      const [status, setStatus] = React.useState({ state: 'loading' })
      const [error, setError] = React.useState('')
      const [nativeBusy, setNativeBusy] = React.useState(false)
      const [reviewRemove, setReviewRemove] = React.useState(false)
      const [latest, setLatest] = React.useState(null)
      const [checking, setChecking] = React.useState(false)
      const pending = React.useRef(false)
      const refresh = React.useCallback(async (endpoint = 'status') => {
        if (pending.current) return
        pending.current = true
        setError('')
        try {
          if (endpoint === 'check') {
            setChecking(true)
            setLatest(null)
            setLatest(await call('check'))
          } else if (['open', 'back', 'delete', 'switch-update', 'switch-delete'].includes(endpoint)) {
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
          setChecking(false)
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
      const installedNow = canManage && status.outcome === 'installedNow'
      const progress = status.progress
      const currentStep = progress ? steps.indexOf(progress.step) : -1
      const hasNative = typeof window.desktopNext?.command === 'function'
      const current = status.state === 'current'
      const failure = error || status.error || handoffFailure()
      const canChange = hasNative && (canManage || (current && status.canHandoff))
      const canCheck = canInstall || canManage || current
      const hasUpdate = latest?.available && (status.version !== latest.version || status.commit !== latest.commit)
      const buildLabel = ({ version, commit }) => h(React.Fragment, null,
        `v${version} · `,
        commit ? h('a', { href: `https://github.com/flizzywine/dsh-tavern/commit/${commit}`, target: '_blank', rel: 'noreferrer', title: commit },
          h('code', null, commit.slice(0, 8))) : h('span', { className: 'tl-sub' }, t('unknownCommit')))
      const button = (label, onClick, style = '') => h('button', {
        type: 'button', className: `tl-btn ${style}`, disabled: nativeBusy || checking, onClick,
      }, t(label))
      return h('section', { className: 'tl' },
        h('style', null, CSS),
        h('header', { className: 'tl-head' },
          h('h2', { className: 'tl-title' }, t('title')),
          h('p', { className: 'tl-sub' }, t('explain'))),
        current || status.profile ? h('div', { className: 'tl-bar' },
          h('span', { className: 'tl-bar-text' }, `${t('currentProfile')} · ${current ? t('tavernProfile') : status.profile === 'desktop' ? t('originalProfile') : status.profile}`),
          canManage && !installedNow && hasNative ? button('open', () => void refresh('open')) : null,
          current && hasNative ? button('back', () => void refresh('back')) : null) : null,
        h('section', { className: 'tl-management', 'aria-label': t('management') },
          h('h3', null, t('management')),
          status.version || latest ? h('dl', { className: 'tl-builds' },
            status.version ? h(React.Fragment, null, h('dt', null, t('installedBuild')), h('dd', null, buildLabel(status))) : null,
            h('dt', null, t('latestBuild')), h('dd', null, latest ? buildLabel(latest) : t('checkHint'),
              latest && status.version && canCheck ? h('span', {
                className: `tl-release-badge${hasUpdate ? ' tl-release-badge-available' : ''}`, role: 'status',
              }, t(hasUpdate ? 'updateAvailable' : 'noUpdate')) : null)) : null,
          status.paths ? h('dl', { className: 'tl-paths' },
            ...Object.entries(status.paths).flatMap(([key, value]) => [
              h('dt', { key: `${key}-label` }, t(key)), h('dd', { key }, value),
            ])) : null,
          h('p', { className: failure ? 'tl-error' : 'tl-sub', role: failure ? 'alert' : 'status' },
            failure || t(current && !status.canHandoff ? 'upgradeLauncher' : status.outcome || status.state)),
          currentStep >= 0 ? h('div', { className: 'tl-progress' },
            h('strong', { role: 'status' }, t(progress.step) + (progress.version ? ` · v${progress.version}` : '') +
              (progress.step === 'installPackage' && progress.source ? ` · ${progress.source}` : '')),
            h('progress', { 'aria-label': t(progress.step) }),
            h('ol', { className: 'tl-steps' }, ...steps.map((step, index) =>
              h('li', { key: step, 'aria-current': index === currentStep ? 'step' : undefined },
                `${index < currentStep ? '✓ ' : ''}${t(step)}`))),
            h('p', { className: 'tl-sub' }, `${t('elapsed')} · ${Math.max(0, Math.floor((Date.now() - progress.startedAt) / 1000))} s`)) : null,
          (canInstall || canManage) && !hasNative ? h('p', { className: 'tl-sub' }, t('nativeHint')) : null,
          current && !hasNative ? h('p', { className: 'tl-sub' }, t('returnHint')) : null,
          h('div', { className: 'tl-actions' },
            canInstall && hasNative ? button('install', () => void refresh('install')) : null,
            installedNow && hasNative ? button('open', () => void refresh('open')) : null,
            canCheck && !reviewRemove ? button(checking ? 'checking' : 'check', () => void refresh('check'), 'tl-btn-quiet') : null,
            canChange && !reviewRemove ? button('update', () => void refresh(current ? 'switch-update' : 'update'), 'tl-btn-quiet') : null,
            canChange && !reviewRemove ? button('remove', () => setReviewRemove(true), 'tl-btn-quiet tl-danger') : null,
            failure ? button('retry', () => void refresh(), 'tl-btn-quiet') : null),
          canChange && reviewRemove ? h('div', { className: 'tl-review', role: 'group', 'aria-label': t('reviewRemove') },
            h('strong', null, t('reviewRemove')),
            h('p', null, t('removeScope')),
            h('div', { className: 'tl-actions' },
              button('continueRemove', () => { setReviewRemove(false); void refresh(current ? 'switch-delete' : 'delete') }, 'tl-btn-quiet tl-danger'),
              button('cancel', () => setReviewRemove(false), 'tl-btn-quiet'))) : null),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(ns)
        const call = async endpoint => {
          const response = await fetch('/dsh-tavern-launcher/' + endpoint, { method: endpoint === 'status' || endpoint === 'check' ? 'GET' : 'POST' })
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
