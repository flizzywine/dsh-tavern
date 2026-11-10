// Owns update requests and page recovery; a stopped controller cannot publish late results.
function createUpdateStatusController({ call, confirm, errors, browser, initial = { phase: 'loading', host: 'cli' }, now = Date.now }) {
  let statusValue = initial, active = false, disposed = false, startedAt = 0;
  const action = { pending: false, generation: 0 };
  let received = false, pending = false, failures = 0;
  let recovery = { sawOffline: false, reloading: false };
  let pollTimer, probeTimer, probeKey = '', probeGeneration = 0;
  const listeners = new Set(), requests = new Set();
  function publishUpdateStatus(next) {
    if (!active) return;
    if (JSON.stringify(statusValue) !== JSON.stringify(next)) {
      statusValue = next;
      for (const listener of listeners) listener();
    }
    syncProbe();
  }
  function isUpdateBusy(status) {
    // Loading only means the initial read has not answered. It must not block
    // an explicit check, whose generation already supersedes that read.
    return ['checking', 'running', 'cancelling', 'blocked'].includes(status.phase);
  }
  function isMissingUpdateApiError(error) {
    return String(error && error.message || error || '').includes('未知方法: getUpdateStatus');
  }
  async function callUpdate(method) {
    const controller = new AbortController();
    // Metadata fallbacks can legitimately exceed 30s. Status and cancellation
    // stay fast; check/start use the longer bound and publish their own phases.
    const timeoutMs = method === "checkUpdate" || method === "startUpdate" ? 60000 : 30000;
    let timer, cancel;
    const interrupted = new Promise((_resolve, reject) => {
      cancel = () => { controller.abort(); reject(new Error('更新界面已关闭')); };
      timer = browser.setTimeout(() => {
        const error = new Error('更新服务请求超时，正在核实状态');
        error.retryable = true;
        controller.abort(); reject(error);
      }, timeoutMs);
    });
    requests.add(cancel);
    try { return await Promise.race([call(method, undefined, { signal: controller.signal }), interrupted]); }
    finally { browser.clearTimeout(timer); requests.delete(cancel); }
  }
  function syncProbe() {
    const awaitingDesktopRestart = statusValue.host === 'desktop' && statusValue.phase === 'completed' && statusValue.requiresRestart;
    // The native window belongs to the running Electron process. A page reload
    // cannot switch it to a newly installed build.
    const key = active && browser.location.protocol !== 'dsh-app:' && (statusValue.phase === 'running' || awaitingDesktopRestart) ? statusValue.host || 'cli' : '';
    if (key === probeKey) return;
    probeKey = key;
    const generation = ++probeGeneration;
    browser.clearInterval(probeTimer);
    if (!key) return;
    const currentRecovery = recovery;
    let probing = false;
    async function probe() {
      if (probing) return;
      probing = true;
      try {
        const response = await browser.fetch(browser.location.origin + '/?tavern-update-probe=' + now(), { cache: 'no-store' });
        if (active && generation === probeGeneration && response.ok && currentRecovery.sawOffline && !currentRecovery.reloading) {
          currentRecovery.reloading = true;
          browser.location.reload();
        }
      } catch {
        if (active && generation === probeGeneration) currentRecovery.sawOffline = true;
      } finally { probing = false; }
    }
    void probe();
    probeTimer = browser.setInterval(probe, 400);
  }
  // Poll fast while an update is in flight or the first read is unresolved;
  // at rest a slow read still notices updates started elsewhere without asking
  // the server every 2.5 seconds forever.
  let lastPollAt = 0;
  function pollUpdateStatus() {
    if (statusValue.phase !== 'loading' && !isUpdateBusy(statusValue) && now() - lastPollAt < 30000) return;
    return refreshUpdateStatus();
  }
  async function refreshUpdateStatus() {
    if (!active || pending || action.pending) return;
    lastPollAt = now();
    const generation = action.generation;
    pending = true;
    try {
      const result = await callUpdate("getUpdateStatus");
      if (active && generation === action.generation && !action.pending && result && result.status) {
        received = true;
        failures = 0;
        errors.resolve("更新状态");
        const status = result.status;
        const completedInThisPage = status.phase === "completed" && startedAt > 0 && Number(status.completedAt || 0) >= startedAt;
        const next = status.phase === "completed" && !completedInThisPage && !status.requiresRestart ? { ...status, phase: "idle", host: status.host || "cli" } : status;
        // Ignore reads begun before an update action, even if they finish afterward.
        publishUpdateStatus(next);
      }
    } catch (err) {
        if (!active || generation !== action.generation || action.pending) return;
        failures += 1;
        // Only this read-only poll gets a startup grace period. Never replay startUpdate.
        if ((err && err.retryable || err instanceof TypeError) && failures < 3) return;
        if ((err && err.retryable || err instanceof TypeError) && statusValue.host === 'desktop' && statusValue.phase === 'running') {
          publishUpdateStatus({ ...statusValue, connectionLost: true,
            error: '桌面连接已断开，安装结果尚未确认。请勿重复安装；安装完成后请手动重启 DeepSeek Harness。' });
        }
        if (isMissingUpdateApiError(err)) {
          if (!received) publishUpdateStatus({ phase: "restart-required", host: "desktop" });
        } else {
          if (!received && !["running", "cancelling", "blocked"].includes(statusValue.phase)) publishUpdateStatus({ phase: "failed", host: "cli", error: String(err && err.message || err) });
          errors.report("更新状态", err);
        }
      } finally { pending = false; }
  }
  async function checkUpdate() {
    const status = statusValue;
    if (!active) return;
    if (action.pending || isUpdateBusy(status) || status.requiresRestart || ["restart-required", "installed-restart-required"].includes(status.phase)) return;
    action.pending = true;
    action.generation += 1;
    publishUpdateStatus({ ...status, phase: "checking", host: status.host || "cli", checkedAt: now(), error: "" });
    try {
      const result = await callUpdate("checkUpdate");
      if (active && result && result.status) publishUpdateStatus(result.status);
    } catch (err) {
      if (!active) return;
      publishUpdateStatus({ ...status, phase: "check-failed", host: status.host || "cli", error: String(err && err.message || err) });
      errors.report("检查更新", err);
    } finally {
      action.pending = false;
      action.generation += 1;
    }
  }
  async function performUpdate() {
    const status = statusValue;
    if (!active) return;
    if (action.pending || !["update-available", "repair-required"].includes(status.phase)) return;
    // Lock before opening the confirmation so repeated clicks cannot launch two requests.
    action.pending = true;
    action.generation += 1;
    try {
      const repairing = status.phase === "repair-required";
      const restartHint = status.host === 'desktop' ? '\n桌面版安装完成后需要手动重启 DeepSeek Harness。' : '';
      const question = (repairing
        ? "将重新安装当前构建以修复上次未完成的更新，期间会短暂断开。人物卡、资料和对话数据会保留。\n确定修复安装吗？"
        : "更新期间会短暂断开，人物卡、资料和对话数据不会受到影响。\n确定更新到 GitHub 最新版吗？") + restartHint;
      if (!await confirm(question)) return;
      if (!active) return;
      startedAt = now();
      recovery = { sawOffline: false, reloading: false };
      publishUpdateStatus({ ...status, phase: "running", host: status.host || "cli", startedAt, cancellable: false, error: "" });
      const result = await callUpdate("startUpdate");
      if (active && result && result.status) publishUpdateStatus(result.status);
    } catch (err) {
      if (!active) return;
      // A lost response does not prove that the installer stopped. Let the read-only poll reconcile it.
      publishUpdateStatus({ ...statusValue, error: "更新请求结果尚未确认，正在核实状态：" + String(err && err.message || err) });
      errors.report("插件更新", err);
    } finally {
      action.pending = false;
      action.generation += 1;
    }
  }
  async function cancelUpdate() {
    const status = statusValue;
    if (!active) return;
    if (action.pending || status.phase !== "running" || status.cancellable !== true) return;
    action.pending = true;
    action.generation += 1;
    publishUpdateStatus({ ...status, phase: "cancelling", error: "" });
    try {
      const result = await callUpdate("cancelUpdate");
      if (active && result && result.status) publishUpdateStatus(result.status);
    } catch (err) {
      if (!active) return;
      publishUpdateStatus({ ...statusValue, error: "取消请求结果尚未确认，正在核实状态：" + String(err && err.message || err) });
      errors.report("取消更新", err);
    } finally {
      action.pending = false;
      action.generation += 1;
    }
  }

  return Object.freeze({
    getSnapshot: () => statusValue,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    isBusy: isUpdateBusy, check: checkUpdate, perform: performUpdate, cancel: cancelUpdate,
    start() {
      if (active || disposed) return;
      active = true;
      void refreshUpdateStatus();
      pollTimer = browser.setInterval(pollUpdateStatus, 2500);
      syncProbe();
    },
    stop() {
      disposed = true;
      active = false;
      action.generation += 1;
      browser.clearInterval(pollTimer);
      syncProbe();
      for (const cancel of requests) cancel();
    }
  });
}
export { createUpdateStatusController };
