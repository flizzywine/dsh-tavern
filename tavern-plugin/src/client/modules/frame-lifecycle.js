// Shared lifetime rules for frame scripts and every opening input adapter.
// Self-contained because the same module runs in serialized card documents.
function createTavernFrameLifecycle(win, doc = win.document) {
    let disposed = false;
    const releases = new Set();
    function sender({ submit, valid = () => true, once = false, busy = () => {}, stale = '卡片已关闭，请重新打开' }) {
        let active = true, pending = null, completed = null;
        function dispose() { active = false; releases.delete(dispose); }
        releases.add(dispose);
        return {
            send(value) {
                if (disposed || !active || !valid()) return Promise.reject(new Error(stale));
                if (pending || completed) return pending || completed;
                const text = String(value || '').trim();
                if (!text) return Promise.resolve();
                busy(true);
                pending = Promise.resolve().then(() => {
                    // Closing or switching a frame can happen in the same task as a click.
                    if (disposed || !active || !valid()) throw new Error(stale);
                    return submit(text);
                }).then(result => {
                    if (once) completed = Promise.resolve(result);
                    return result;
                }).finally(() => { pending = null; busy(Boolean(completed)); });
                return pending;
            },
            dispose
        };
    }
    function mount(mountBody, fail, timeoutMs = 30000) {
        let timer, cancelled = false;
        const deadline = Date.now() + timeoutMs;
        function cancel() {
            cancelled = true;
            if (timer !== undefined) win.clearTimeout(timer);
            releases.delete(cancel);
        }
        function attempt() {
            if (cancelled || disposed) return;
            if (!doc.body) {
                if (Date.now() >= deadline) { cancel(); fail(new Error('开局文档尚未生成 body，无法启动')); }
                else timer = win.setTimeout(attempt, 10);
                return;
            }
            cancel();
            try { mountBody(doc.body); } catch (error) { fail(error); }
        }
        releases.add(cancel);
        attempt();
        return cancel;
    }
    function maintain(mountBody, fail) {
        let cancel = () => {};
        function refresh() { cancel(); cancel = mount(mountBody, fail); }
        const observer = win.MutationObserver ? new win.MutationObserver(refresh) : null;
        observer?.observe(doc, { childList: true, subtree: true });
        function release() { cancel(); observer?.disconnect(); releases.delete(release); }
        releases.add(release);
        refresh();
        return { refresh, dispose: release };
    }
    return {
        sender, mount, maintain,
        dispose() { disposed = true; for (const release of [...releases]) release(); }
    };
}
