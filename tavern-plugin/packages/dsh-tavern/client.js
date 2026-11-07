/**
 * Tavern launcher — browser half.
 *
 * Adds one settings page that shows which profile this Harness is running, which
 * other profiles exist, and switches the app's profile directory to the one you
 * pick (or reverts that switch). All file work happens in the Host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tavern',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Shared RPC channel owned by this plugin's Host half. */
    const CHANNEL = '/profile-bridge'
    /** Locale namespace of this page. */
    const NS = 'profileBridge'

    const zh = {
      management: "DSH 酒馆安装管理",
      appDir: "酒馆程序目录",
      profileDir: "酒馆配置与依赖目录",
      dataDir: "酒馆专属数据目录",
      sharedHome: "原版 DSH / 共享目录（不移动）",
      relocate: "切换安装目录",
      uninstall: "删除 DSH 酒馆",
      destination: "新的安装目录（绝对路径）",
      destinationHint: "选择一个不存在或为空的独立目录，例如 D:\\DSH-Tavern；不能是当前目录的上级或子目录。",
      relocationScope: "迁移酒馆程序、酒馆配置与依赖，以及全部酒馆专属数据（包括会话和存储）。原版 DSH、共享设置、凭据、缓存和已有备份不会移动。旧位置保留兼容链接。",
      backupSpace: "为便于失败恢复，旧磁盘上的回滚备份会保留，不会自动删除；本操作不保证立即释放旧磁盘空间。",
      uninstallScope: "将恢复原版 DSH，并停用酒馆注册、把酒馆程序和配置移入可恢复的隔离备份。保留全部用户数据和备份，不卸载原版 DSH、不删除共享凭据。",
      reviewRelocate: "确认迁移 DSH 酒馆",
      reviewUninstall: "确认删除 DSH 酒馆（保留数据）",
      restartWarning: "请先保存工作。确认后桌面将正常退出，操作完成后重新打开；若取消退出，操作会超时且不修改安装。",
      confirmRelocate: "确认迁移并重启",
      confirmUninstall: "确认删除并重启",
      cancel: "取消",
      unavailable: "当前安装不支持此操作；请检查安装状态和日志。",
      desktopOnly: "请在官方桌面中管理安装。",
      operationPending: "操作已排队，等待桌面退出；请勿重复提交。",
      lastOperationFailure: "上次操作失败",
      operationDone: "上次操作已完成。",
      updates: '酒馆版本与更新',
      installedBuild: '当前安装',
      latestBuild: '最新发布',
      unknownBuild: '构建未知',
      unchecked: '尚未检查',
      checkUpdate: '检查更新',
      checkingUpdate: '正在检查更新…',
      updateAvailable: '发现新版本',
      upToDate: '已是最新版本',
      updateTavern: '更新酒馆',
      repairTavern: '修复安装',
      switchToUpdate: '请先切换到 DSH 酒馆，再在启动器中更新。',
      updating: '正在更新酒馆…',
      cancelUpdate: '取消更新',
      cancellingUpdate: '正在取消更新…',
      updateBlocked: '正在等待安装进程安全停止。',
      updateFailed: '更新失败，请重试。',
      updateComplete: '酒馆已更新。',
      updateRestart: '更新已安装。请退出并重新打开 DeepSeek Harness 以应用更新。',
      updateRestartWindow: '更新已安装。请重启酒馆服务后重新打开酒馆。',
      section: '酒馆启动器',
      install: '安装酒馆',
      confirmInstall: '确认安装',
      replacesNext: '检测到旧版 NEXT 酒馆。安装会备份它的 Profile，并为官方版生成新的配置。酒馆专属数据将继续使用。',
      installHint: '酒馆会安装到独立的 tavern 配置。安装期间可以继续使用桌面，装好后可重启并切换到 DSH 酒馆。',
      installing: '正在准备安装酒馆…',
      copyLogs: '复制诊断日志',
      logsCopied: '日志已复制',
      copyLogsFailed: '复制失败，可以在「说明与日志」中选中日志并手动复制。',
      installDone: '酒馆安装完成。',
      explain: '切换当前使用的配置并重启，不改变下次启动的默认设置。',
      startupTitle: '默认启动配置',
      startupOriginal: '下次从官方入口启动时打开原版 DSH。',
      startupTavern: '下次从官方入口启动时打开 DSH 酒馆。',
      startupHint: '设置或取消默认只影响下次启动，不切换或重启当前窗口。',
      setDefault: '默认打开酒馆',
      clearDefault: '取消默认打开酒馆',
      current: '当前配置',
      profileDesktop: '原版 DSH',
      profileTavern: 'DSH 酒馆',
      profileReader: 'DSH 阅读器',
      toOriginal: '重启并切换到原版 DSH',
      toTavern: '重启并切换到 DSH 酒馆',
      noTavern: '还没有装好 DSH 酒馆，装好后这里就能切过去。',
      noOriginal: '找不到原版 DSH 的备份，暂时切不回去。请看下面的「说明与日志」。',
      standalone: '这是 DSH 酒馆的独立窗口，原版 DSH 就是 DeepSeek Harness 本身，不用切换、不用重启。',
      openOriginal: '打开原版 DSH',
      restarting: '正在重启…',
      quitHint: '请从托盘退出桌面版，切换完成后会自动重新打开（两分钟内有效）。',
      loading: '读取中…',
      cliHint: '当前不是桌面版。命令行用户直接用 dsh --profile <名称> 选择即可。',
      failure: '操作失败',
      lastFailure: '上次切换失败',
      recoveryRequired: '切换结果需要人工确认，请勿再次切换；请检查日志中的入口和备份路径，必要时恢复原入口。',
      logLocation: '日志：',
      more: '说明与日志',
      shortcut: '添加桌面快捷方式',
      shortcutHint: '可以手动添加「DSH 酒馆」桌面快捷方式，方便直接打开酒馆。',
      shortcutDone: '已添加到桌面：',
      shortcutExists: '桌面上已经有了：',
      logEmpty: '（还没有日志）',
      why: '桌面版固定读取 profiles/desktop。切换到 DSH 酒馆时，会把当前入口链接到 profiles/tavern（Windows 用 junction，macOS/Linux 用符号链接）；原版配置先备份为 desktop.fresh-*，切回原版时恢复。切换需要桌面版先退出：重启走正常退出流程，有任务时会先请你确认。Windows 目录仍被占用时，只会在桌面退出后清理已核实属于本次桌面的残留子进程，不会按路径批量结束其他会话。',
    }
    const en = {
      management: "DSH Tavern installation",
      appDir: "Tavern application directory",
      profileDir: "Tavern profile and dependencies",
      dataDir: "Tavern-owned data directory",
      sharedHome: "Original DSH / shared directory (not moved)",
      relocate: "Change installation directory",
      uninstall: "Remove DSH Tavern",
      destination: "New installation directory (absolute path)",
      destinationHint: "Choose an absent or empty separate directory, such as D:\\DSH-Tavern; it must not contain or be inside the current directory.",
      relocationScope: "Moves Tavern application files, profile and dependencies, and all Tavern-owned data (including sessions and storage). Original DSH, shared settings, credentials, caches, and existing backups stay in place. Compatibility links remain at the old paths.",
      backupSpace: "Rollback backups remain on the old disk and are not deleted automatically. This operation does not guarantee immediate disk-space savings.",
      uninstallScope: "Restores original DSH, disables Tavern registration, and quarantines Tavern application and profile files in recoverable backups. All user data and backups are kept. Original DSH and shared credentials are not deleted.",
      reviewRelocate: "Review DSH Tavern relocation",
      reviewUninstall: "Review DSH Tavern removal (keep data)",
      restartWarning: "Save your work first. Confirmation requests a normal Desktop quit, then reopens it after the operation. Cancelling quit causes a timeout without changing the installation.",
      confirmRelocate: "Confirm migration and restart",
      confirmUninstall: "Confirm removal and restart",
      cancel: "Cancel",
      unavailable: "This installation cannot be managed here. Check installation status and logs.",
      desktopOnly: "Manage this installation in the official Desktop app.",
      operationPending: "Operation queued; waiting for Desktop to exit. Do not submit again.",
      lastOperationFailure: "The last operation failed",
      operationDone: "The last operation completed.",
      updates: 'Tavern version and updates',
      installedBuild: 'Installed build',
      latestBuild: 'Latest release',
      unknownBuild: 'Unknown build',
      unchecked: 'Not checked yet',
      checkUpdate: 'Check for updates',
      checkingUpdate: 'Checking for updates…',
      updateAvailable: 'Update available',
      upToDate: 'Already up to date',
      updateTavern: 'Update Tavern',
      repairTavern: 'Repair installation',
      switchToUpdate: 'Switch to DSH Tavern, then update from the launcher.',
      updating: 'Updating Tavern…',
      cancelUpdate: 'Cancel update',
      cancellingUpdate: 'Cancelling update…',
      updateBlocked: 'Waiting for the installer to stop safely.',
      updateFailed: 'Update failed. Please try again.',
      updateComplete: 'Tavern was updated.',
      updateRestart: 'The update is installed. Quit and reopen DeepSeek Harness to apply it.',
      updateRestartWindow: 'The update is installed. Restart the Tavern service and reopen this window.',
      section: 'Tavern Launcher',
      install: 'Install Tavern',
      confirmInstall: 'Confirm installation',
      replacesNext: 'The installer will back up the existing NEXT Tavern profile, create a profile for official Desktop, and reuse Tavern data.',
      installHint: 'Tavern gets its own profile. You can keep using Desktop during installation. When it finishes, you can restart and switch to DSH Tavern.',
      installing: 'Preparing Tavern installation…',
      copyLogs: 'Copy diagnostic log',
      logsCopied: 'Log copied',
      copyLogsFailed: 'Could not copy automatically. Select the log under Help and logs to copy it.',
      installDone: 'Tavern installation complete.',
      explain: 'Switch the current profile and restart without changing the next-launch default.',
      startupTitle: 'Default startup profile',
      startupOriginal: 'The next fresh launch opens original DSH.',
      startupTavern: 'The next fresh launch opens DSH Tavern.',
      startupHint: 'Changing this setting affects the next launch, without switching or restarting this window.',
      setDefault: 'Open Tavern by default',
      clearDefault: 'Cancel Tavern default',
      current: 'Current profile',
      profileDesktop: 'Original DSH',
      profileTavern: 'DSH Tavern',
      profileReader: 'DSH Reader',
      toOriginal: 'Restart and switch to original DSH',
      toTavern: 'Restart and switch to DSH Tavern',
      noTavern: 'DSH Tavern is not installed yet; once it is, you can switch from here.',
      noOriginal: 'The original DSH backup is missing, so switching back is not possible right now. See "Details and log" below.',
      standalone: 'This is the standalone DSH Tavern window. The original DSH is DeepSeek Harness itself; no switch or restart needed.',
      openOriginal: 'Open original DSH',
      restarting: 'Restarting…',
      quitHint: 'Quit Desktop from the tray; it reopens by itself after the switch (valid for two minutes).',
      loading: 'Loading…',
      cliHint: 'This is not the Desktop app. Command-line users can pick one with dsh --profile <name>.',
      failure: 'Failed',
      lastFailure: 'The last switch failed',
      recoveryRequired: 'This switch needs manual inspection. Do not switch again; check the entry and backup paths in the log, and restore the original entry if needed.',
      logLocation: 'Log: ',
      more: 'Details and log',
      shortcut: 'Add desktop shortcut',
      shortcutHint: 'Add a desktop shortcut if you want to open DSH Tavern directly from your desktop.',
      shortcutDone: 'Added to the desktop: ',
      shortcutExists: 'Already on the desktop: ',
      logEmpty: '(no log yet)',
      why: 'Desktop always reads profiles/desktop. Switching the current profile to DSH Tavern links it to profiles/tavern (a junction on Windows, a symlink elsewhere); the original is first backed up as desktop.fresh-* and restored when you switch back. Desktop has to exit first: restarting is a normal quit that asks for confirmation when tasks are running. If a Windows directory remains busy after Desktop exits, only verified leftover descendants of this Desktop session may be stopped; other sessions are not killed by path matching.',
    }

    /** Scoped stylesheet; class names are prefixed so they never leak into the host. */
    const CSS = `
.pb { display: grid; gap: 16px; font-size: 13px; line-height: 1.6; color: inherit; width: 100%; max-width: 640px; min-width: 0;
  --pb-accent: #4d6bfe; --pb-accent-soft: rgba(77,107,254,0.07); --pb-line: rgba(127,127,127,0.25); --pb-fill: rgba(127,127,127,0.06); }
.pb * { box-sizing: border-box; }
.pb-head { display: grid; gap: 2px; }
.pb-title { margin: 0; font-size: 16px; font-weight: 600; }
.pb-sub { margin: 0; opacity: 0.6; }
.pb-bar { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 10px; background: var(--pb-accent-soft); }
.pb-bar-text { flex: 1; min-width: 0; }
.pb-btn { appearance: none; font: inherit; font-size: 13px; flex: none; color: #fff; background: var(--pb-accent); border: 0; border-radius: 8px; padding: 6px 16px; cursor: pointer; }
.pb-btn:hover:not(:disabled) { background: #3d5bf0; }
.pb-btn:disabled { opacity: 0.5; cursor: default; }
.pb-shortcut { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 10px; border: 1px solid var(--pb-line); }
.pb-shortcut .pb-sub { margin: 0; }
.pb-done { margin: 4px 0 0; font-size: 12px; word-break: break-all; }
.pb-btn-quiet { color: inherit; background: var(--pb-fill); border: 1px solid var(--pb-line); }
.pb-btn-quiet:hover:not(:disabled) { background: var(--pb-accent-soft); }
.pb-error { margin: 0; padding: 10px 12px; border-radius: 10px; color: #e5484d; background: rgba(229,72,77,0.08); }
.pb-management { display: grid; gap: 10px; border: 1px solid var(--pb-line); border-radius: 10px; padding: 14px; min-width: 0; }
.pb-management h3, .pb-management p { margin: 0; }
.pb-builds { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.pb-builds dt { opacity: .65; }
.pb-builds dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.pb-builds a { color: inherit; text-decoration: underline; }
.pb-update-badge { justify-self: start; border-radius: 999px; background: var(--pb-fill); padding: 2px 10px; }
.pb-update-badge-available { background: var(--pb-accent-soft); }
.pb-management progress { width: 100%; }
.pb-paths { margin: 0; display: grid; gap: 4px; min-width: 0; }
.pb-paths dt { opacity: .65; }
.pb-paths dd { margin: 0 0 6px; overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
.pb-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pb-input { width: 100%; min-width: 0; font: inherit; padding: 8px; color: inherit; background: var(--pb-fill); border: 1px solid var(--pb-line); border-radius: 6px; }
.pb-review { display: grid; gap: 10px; border-top: 1px solid var(--pb-line); padding-top: 12px; }
.pb-danger { color: #d93f44; }
.pb-fold summary { list-style: none; cursor: pointer; opacity: 0.55; font-size: 12px; user-select: none; }
.pb-fold summary::-webkit-details-marker { display: none; }
.pb-fold summary::before { content: '›'; display: inline-block; width: 12px; transition: transform .15s; }
.pb-fold[open] summary::before { transform: rotate(90deg); }
.pb-fold summary:hover { opacity: 1; }
.pb-fold p { margin: 6px 0; opacity: 0.6; font-size: 12px; }
.pb-pre { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--pb-fill); max-height: 200px; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
`

    /** Describe one RPC failure for display. */
    function describeFailure(error) {
      if (error === undefined || error === null) return 'unknown error'
      return typeof error.message === 'string' ? error.message : String(error)
    }

    /** The menu names this page by side at once: the Tavern client marks a page that loaded it. */
    const inTavern = () => window.__dshTavernLoaded === true

    const updateInProgress = phase => ['running', 'cancelling', 'blocked'].includes(phase)

    function renderBuild(t, version, commit) {
      return h(React.Fragment, null,
        version && version !== 'unknown' ? `v${version} · ` : null,
        /^[0-9a-f]{40}$/i.test(commit || '')
          ? h('a', { href: `https://github.com/flizzywine/dsh-tavern/commit/${commit}`, target: '_blank', rel: 'noreferrer', title: commit }, h('code', null, commit.slice(0, 8)))
          : t('unknownBuild'))
    }

    /** @param {{ t: Function, rpcCall: Function }} props */
    function ProfileBridgeSettings(props) {
      const t = props.t
      const call = props.rpcCall
      const [status, setStatus] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [applied, setApplied] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const actionInFlight = React.useRef(false)
      const [managementAction, setManagementAction] = React.useState(null)
      const [destination, setDestination] = React.useState('')
      const [logCopy, setLogCopy] = React.useState('')
      const [update, setUpdate] = React.useState(null)
      const [updateAction, setUpdateAction] = React.useState('')
      const [updateFailure, setUpdateFailure] = React.useState('')
      const diagnosticLog = [status?.logTail?.trim(), status?.transcriptTail?.trim()].filter(Boolean).join('\n\n')
      async function copyLogs() {
        try {
          await window.navigator.clipboard.writeText(diagnosticLog)
          setLogCopy('logsCopied')
        } catch {
          setLogCopy('copyLogsFailed')
        }
      }

      React.useEffect(() => {
        let alive = true
        call('status', {}).then((result) => {
          if (!alive) return
          if (result?.ok === true) setStatus(result.value)
          else setFailure(describeFailure(result?.error))
        }, (error) => { if (alive) setFailure(describeFailure({ message: error?.message ?? String(error) })) })
        return () => { alive = false }
      }, [call])

      // A quit can be cancelled or time out without closing this page. Keep the
      // durable result visible in that case, as well as after the app reopens.
      const pending = status?.lastResult?.status === 'pending'
      React.useEffect(() => {
        if (!pending) return
        let alive = true
        let timer
        const refresh = async () => {
          try {
            const result = await call('status', {})
            if (!alive) return
            if (result?.ok === true) {
              setStatus(result.value)
              if (['failed', 'succeeded'].includes(result.value?.lastResult?.status)) {
                setApplied(null)
                return
              }
            }
          } catch { /* Desktop may be between stopping and restarting. */ }
          if (alive) timer = setTimeout(refresh, 1500)
        }
        timer = setTimeout(refresh, 1500)
        return () => { alive = false; clearTimeout(timer) }
      }, [call, pending])
      const lastFailure = status?.lastResult?.status === 'failed' ? status.lastResult : null
      const installDone = status?.lastResult?.status === 'succeeded' && status.lastResult.mode === 'install'

      const current = status?.linkTargetName ?? (inTavern() ? 'tavern' : 'desktop')
      const standalone = status?.desktopApp === false
      const ready = (name) => (status?.profiles ?? []).some((profile) => {
        const bundles = profile.bundles ?? []
        return profile.name === name && profile.hasNodeModules && !bundles.includes('dsh-tavern-bundle')
          && (profile.hasBridge ?? (bundles.includes('dsh-tavern-launcher') || bundles.includes('dsh-profile-bridge')))
      })
      const destinations = [
        { name: 'desktop', label: 'profileDesktop', action: 'toOriginal', ready: (status?.backups ?? []).length > 0 },
        { name: 'tavern', label: 'profileTavern', action: 'toTavern', ready: ready('tavern') },
      ]
      const currentLabel = current === 'reader' ? 'profileReader' : destinations.find(({ name }) => name === current)?.label
      const options = destinations.filter(({ name, ready }) => name !== current && ready)
      const blocked = options.length === 0 && !status?.installAvailable ? t(current === 'desktop' ? 'noTavern' : 'noOriginal') : null

      const [shortcut, setShortcut] = React.useState(null)
      async function addShortcut() {
        setBusy(true)
        setFailure(null)
        try {
          const result = await call('shortcut', {})
          if (result?.ok === true) setShortcut(result.value)
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ message: error?.message ?? String(error) }))
        } finally {
          setBusy(false)
        }
      }

      async function openOriginal() {
        setFailure(null)
        try {
          const result = await call('openOriginal', {})
          if (result?.ok !== true) setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ message: error?.message ?? String(error) }))
        }
      }

      async function changeDefault(profile) {
        if (actionInFlight.current || busy || pending || updateInProgress(update?.phase)) return
        actionInFlight.current = true
        setBusy(true)
        setFailure(null)
        try {
          const result = await call('set-default', { profile })
          if (result?.ok === true) setStatus(previous => ({ ...previous, defaultProfile: result.value.defaultProfile }))
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure(error))
        } finally {
          actionInFlight.current = false
          setBusy(false)
        }
      }

      async function apply(target) {
        if (actionInFlight.current || busy || pending || updateInProgress(update?.phase) || lastFailure?.recoveryRequired) return
        actionInFlight.current = true
        setBusy(true)
        setFailure(null)
        try {
          const result = target === 'desktop' ? await call('unlink', {}) : await call('link', { target })
          if (result?.ok === true) {
            setApplied(result.value ?? {})
            setStatus(previous => ({ ...previous, lastResult: { status: 'pending', stamp: result.value?.stamp } }))
          }
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ message: error?.message ?? String(error) }))
        } finally {
          actionInFlight.current = false
          setBusy(false)
        }
      }

      const title = t('section')
      const isDesktop = status?.appKind === 'desktop' || status?.desktopTavernWindow === true
      const installation = status?.installation
      const showUpdates = isDesktop && (status?.desktopApp === true || status?.desktopTavernWindow === true) && installation?.available && !status?.installAvailable
      const updating = updateInProgress(update?.phase)
      const managementBlocked = !isDesktop || status?.desktopApp !== true || !installation?.available || busy || pending || !!updateAction || updating || Boolean(lastFailure?.recoveryRequired)
      React.useEffect(() => {
        if (!showUpdates || updateAction) return
        let alive = true, timer
        const refresh = async () => {
          try {
            const result = await call('update-status', {})
            if (!alive) return
            if (result?.ok !== true) throw new Error(describeFailure(result?.error))
            setUpdate(result.value)
            if (updating && !updateInProgress(result.value.phase)) setUpdateFailure('')
          } catch (error) {
            // An update may briefly make its installation files unavailable.
            // Keep polling its durable result, and never repeat the write request.
            if (alive && !updating) setUpdateFailure(describeFailure(error))
          }
          if (alive && updating) timer = setTimeout(refresh, 1500)
        }
        if (updating) timer = setTimeout(refresh, 1500)
        else void refresh()
        return () => { alive = false; clearTimeout(timer) }
      }, [call, showUpdates, updating, updateAction])
      async function applyUpdate(endpoint) {
        if (actionInFlight.current || busy || pending || managementAction || lastFailure?.recoveryRequired) return
        actionInFlight.current = true
        setUpdateAction(endpoint)
        setUpdateFailure('')
        try {
          const result = await call(endpoint, {})
          if (result?.ok !== true) throw new Error(describeFailure(result?.error))
          setUpdate(result.value)
        } catch (error) {
          setUpdateFailure(describeFailure(error))
        } finally {
          actionInFlight.current = false
          setUpdateAction('')
        }
      }
      const updateAvailable = update?.phase === 'update-available'
      const repairRequired = update?.phase === 'repair-required'
      const checking = updateAction === 'check-update'
      const updateRestart = update?.phase === 'completed' && update.requiresRestart
      const updateButtonsBlocked = busy || pending || !!managementAction || !!updateAction || Boolean(lastFailure?.recoveryRequired)
      const updateError = !checking && (updateFailure || update?.error || (['failed', 'check-failed'].includes(update?.phase) ? t('updateFailed') : ''))
      const progressLabel = updateAction === 'cancel-update' || update?.phase === 'cancelling' ? t('cancellingUpdate')
        : update?.phase === 'blocked' ? t('updateBlocked') : update?.stage || t('updating')
      const installBlocked = !status?.installAvailable || busy || pending || Boolean(lastFailure?.recoveryRequired)
      const absoluteDestination = status?.platform === 'win32'
        ? /^[A-Za-z]:[\\/]/.test(destination.trim())
        : destination.trim().startsWith('/')
      function reviewManagement(action) {
        if ((action === 'install' ? installBlocked : managementBlocked) || actionInFlight.current) return
        setFailure(null)
        setManagementAction(action)
      }
      async function confirmManagement() {
        if ((managementAction === 'install' ? installBlocked : managementBlocked) || actionInFlight.current || !managementAction || (managementAction === 'relocate' && !absoluteDestination)) return
        actionInFlight.current = true
        setBusy(true)
        setFailure(null)
        try {
          const result = await call(managementAction, { confirmed: true, ...(managementAction === 'relocate' ? { destination: destination.trim() } : {}) })
          if (result?.ok === true) {
            setApplied(result.value ?? {})
            setStatus(previous => ({ ...previous, lastResult: { status: 'pending', mode: managementAction, stamp: result.value?.stamp } }))
            setManagementAction(null)
          } else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure(error))
        } finally {
          actionInFlight.current = false
          setBusy(false)
        }
      }
      return h('section', { className: 'pb' },
        h('style', null, CSS),
        h('header', { className: 'pb-head' },
          h('h2', { className: 'pb-title' }, title),
          h('p', { className: 'pb-sub' }, status === null ? t('loading') : !isDesktop ? t('cliHint') : standalone ? t('standalone') : t('explain')),
        ),
        !isDesktop ? null : standalone ? h('div', { className: 'pb-bar' },
          h('span', { className: 'pb-bar-text' }),
          h('button', { type: 'button', className: 'pb-btn', disabled: busy, onClick: () => void openOriginal() }, t('openOriginal')),
        ) : blocked ? h('p', { className: 'pb-error' }, blocked) : h('div', { className: 'pb-bar' },
          h('span', { className: 'pb-bar-text' },
            status?.lastResult?.mode === 'install' ? `${t('current')} · ${currentLabel ? t(currentLabel) : current}` : applied === null ? (pending ? t('restarting') : `${t('current')} · ${currentLabel ? t(currentLabel) : current}`) : applied.closesApp ? t('restarting') : t('quitHint'),
            ...(applied?.warnings ?? []).map((warning) => h('span', { key: warning, style: { display: 'block', opacity: 0.75 } }, `• ${warning}`)),
          ),
          applied !== null ? null : h('div', { className: 'pb-actions' }, ...options.map(({ name, action }) =>
            h('button', { key: name, type: 'button', className: 'pb-btn', disabled: busy || pending || !!updateAction || updating || lastFailure?.recoveryRequired, onClick: () => void apply(name) }, t(action)))),
        ),
        lastFailure ? h('div', { className: 'pb-error', role: 'alert' },
          h('strong', null, t(['install', 'relocate', 'uninstall'].includes(lastFailure.mode) ? 'lastOperationFailure' : 'lastFailure')),
          h('div', null, lastFailure.message),
          lastFailure.recoveryRequired ? h('div', null, t('recoveryRequired')) : null,
          h('div', null, t('logLocation') + (lastFailure.logPath || status.logPath || '')),
          diagnosticLog ? h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', onClick: copyLogs }, t('copyLogs')) : null,
          logCopy ? h('div', { role: 'status' }, t(logCopy)) : null,
        ) : null,
        failure !== null ? h('p', { className: 'pb-error' }, `${t('failure')}: ${failure}`) : null,
        installDone
          ? h('p', { className: 'pb-done', role: 'status' }, t('installDone')) : null,
        (status?.installAvailable || (pending && status?.lastResult?.mode === 'install')) ? h('section', { className: 'pb-management', 'aria-label': t('management') },
          h('h3', null, t('management')),
          h('p', null, t('installHint')),
          status.replacesNext ? h('p', null, t('replacesNext')) : null,
          pending ? h('p', { role: 'status' }, status.installProgress || t('installing')) : null,
          !installBlocked ? h('div', { className: 'pb-actions' },
            h('button', { type: 'button', className: 'pb-btn',
              onClick: () => void (managementAction === 'install' ? confirmManagement() : reviewManagement('install')) },
            t(managementAction === 'install' ? 'confirmInstall' : 'install')),
            managementAction === 'install' ? h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: busy,
              onClick: () => setManagementAction(null) }, t('cancel')) : null) : null,
        ) : null,
        !isDesktop || standalone || status === null ? null : h('section', { className: 'pb-shortcut pb-default', 'aria-label': t('startupTitle') },
          h('div', { className: 'pb-bar-text' },
            h('strong', null, t('startupTitle')),
            h('p', { className: 'pb-sub' }, t(status.defaultProfile === 'tavern' ? 'startupTavern' : 'startupOriginal')),
            h('p', { className: 'pb-sub' }, t('startupHint'))),
          h('button', { type: 'button', className: 'pb-btn pb-btn-quiet',
            disabled: busy || pending || updating || !!updateAction || lastFailure?.recoveryRequired || (status.defaultProfile !== 'tavern' && !ready('tavern')),
            onClick: () => void changeDefault(status.defaultProfile === 'tavern' ? null : 'tavern') },
            t(status.defaultProfile === 'tavern' ? 'clearDefault' : 'setDefault')),
        ),
        !isDesktop || standalone || !ready('tavern') || status?.installAvailable ? null : h('div', { className: 'pb-shortcut' },
          h('div', { className: 'pb-bar-text' },
            h('p', { className: 'pb-sub' }, t('shortcutHint')),
            shortcut ? h('p', { className: 'pb-done' }, (shortcut.existed ? t('shortcutExists') : t('shortcutDone')) + shortcut.path) : null),
          h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: busy || pending || lastFailure?.recoveryRequired, onClick: () => void addShortcut() }, t('shortcut')),
        ),
        showUpdates ? h('section', { className: 'pb-management', 'aria-label': t('updates') },
          h('h3', null, t('updates')),
          h('dl', { className: 'pb-builds' },
            h('dt', null, t('installedBuild')), h('dd', null, update ? renderBuild(t, update.currentVersion, update.currentCommit) : '—'),
            h('dt', null, t('latestBuild')), h('dd', null, update?.latestVersion || update?.latestCommit ? renderBuild(t, update.latestVersion, update.latestCommit) : t('unchecked'))),
          !checking && !updateAction && (updateAvailable || update?.phase === 'up-to-date') ? h('p', {
            className: 'pb-update-badge' + (updateAvailable ? ' pb-update-badge-available' : ''), role: 'status',
          }, t(updateAvailable ? 'updateAvailable' : 'upToDate')) : null,
          !checking && (updateAvailable || repairRequired) && update?.canUpdate === false ? h('p', { className: 'pb-sub' }, t('switchToUpdate')) : null,
          !checking && update?.checkWarning ? h('p', { className: 'pb-sub' }, update.checkWarning) : null,
          checking ? h('p', { role: 'status' }, t('checkingUpdate')) : null,
          updating || updateAction === 'start-update' ? h(React.Fragment, null,
            h('p', { role: 'status' }, progressLabel),
            update?.phase !== 'blocked' ? h('progress', { 'aria-label': progressLabel }) : null) : null,
          updateError ? h('p', { className: 'pb-error', role: 'alert' }, updateError) : null,
          update?.phase === 'completed' ? h('p', { className: 'pb-done', role: 'status' }, t(updateRestart ? (standalone ? 'updateRestartWindow' : 'updateRestart') : 'updateComplete')) : null,
          h('div', { className: 'pb-actions' },
            !updating && !updateRestart ? h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: updateButtonsBlocked, onClick: () => void applyUpdate('check-update') }, t('checkUpdate')) : null,
            (updateAvailable || repairRequired) && update.canUpdate && !updateAction ? h('button', { type: 'button', className: 'pb-btn', disabled: updateButtonsBlocked, onClick: () => void applyUpdate('start-update') }, t(repairRequired ? 'repairTavern' : 'updateTavern')) : null,
            update?.phase === 'running' && update.canUpdate && update.cancellable ? h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: updateButtonsBlocked, onClick: () => void applyUpdate('cancel-update') }, t('cancelUpdate')) : null)) : null,
        installation && !status?.installAvailable ? h('section', { className: 'pb-management', 'aria-label': t('management') },
          h('h3', null, t('management')),
          h('dl', { className: 'pb-paths' },
            ...['appDir', 'profileDir', 'dataDir', 'sharedHome'].flatMap(key => [
              h('dt', { key: key + '-label' }, t(key)),
              h('dd', { key }, installation[key] || '—'),
            ])),
          h('p', { className: 'pb-sub' }, t('relocationScope')),
          h('p', null, t('backupSpace')),
          !installation.available ? h('p', { className: 'pb-error' }, installation.reason || t('unavailable')) : null,
          !isDesktop || status?.desktopApp !== true ? h('p', null, t('desktopOnly')) : null,
          pending ? h('p', { role: 'status' }, t('operationPending')) : null,
          status?.lastResult?.status === 'succeeded' && ['relocate', 'uninstall'].includes(status.lastResult.mode)
            ? h('p', { role: 'status' }, t('operationDone')) : null,
          h('div', { className: 'pb-actions' },
            h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: managementBlocked || managementAction !== null, onClick: () => reviewManagement('relocate') }, t('relocate')),
            h('button', { type: 'button', className: 'pb-btn pb-btn-quiet pb-danger', disabled: managementBlocked || managementAction !== null, onClick: () => reviewManagement('uninstall') }, t('uninstall'))),
          managementAction ? h('div', { className: 'pb-review', role: 'group', 'aria-label': t(managementAction === 'relocate' ? 'reviewRelocate' : 'reviewUninstall') },
            h('strong', null, t(managementAction === 'relocate' ? 'reviewRelocate' : 'reviewUninstall')),
            managementAction === 'relocate' ? h(React.Fragment, null,
              h('label', { htmlFor: 'pb-destination' }, t('destination')),
              h('input', { id: 'pb-destination', className: 'pb-input', type: 'text', value: destination, disabled: busy || pending, autoComplete: 'off', spellCheck: false, 'aria-describedby': 'pb-destination-hint', onChange: event => setDestination(event.target.value) }),
              h('p', { id: 'pb-destination-hint', className: 'pb-sub' }, t('destinationHint')),
            ) : h('p', null, t('uninstallScope')),
            h('p', null, t('restartWarning')),
            h('div', { className: 'pb-actions' },
              h('button', { type: 'button', className: 'pb-btn', disabled: managementBlocked || (managementAction === 'relocate' && !absoluteDestination), onClick: () => void confirmManagement() }, t(managementAction === 'relocate' ? 'confirmRelocate' : 'confirmUninstall')),
              h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: busy || pending, onClick: () => { setManagementAction(null); setDestination(''); setFailure(null) } }, t('cancel'))),
          ) : null,
        ) : null,
        h('details', { className: 'pb-fold' },
          h('summary', null, t('more')),
          h('p', null, t('why')),
          status?.transcriptPath ? h('p', { className: 'pb-sub' }, t('logLocation') + status.transcriptPath) : null,
          diagnosticLog ? h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', onClick: copyLogs }, t('copyLogs')) : null,
          logCopy ? h('p', { role: 'status' }, t(logCopy)) : null,
          h('pre', { className: 'pb-pre' }, diagnosticLog || t('logEmpty')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        if (typeof window.desktopNext?.state === 'function') {
          // dshmarket draws its own mark, but only hides a direct-child SVG.
          // NEXT wraps the fallback gear in an aria-hidden span.
          ctx.effect(() => {
            const style = window.document.createElement('style')
            style.textContent = '[data-dsh-market-nav-icon] > span[aria-hidden="true"] { display: none; }'
            window.document.head.appendChild(style)
            return () => style.remove()
          }, 'NEXT: hide the duplicate market settings icon')
          return // NEXT has its own Profile selector in Desktop Settings.
        }
        const t = ctx.locale.bind(NS)
        const rpcCall = (endpoint, payload) => ctx.connection.rpc.call(CHANNEL, endpoint, payload)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'profile-bridge: locale dictionaries')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'profile-bridge',
          order: 60,
          label: () => t('section'),
          inject: () => ({ rpcCall, t }),
        }, ProfileBridgeSettings))
      },
    }
  },
})
