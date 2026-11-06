// Serialized into message and opening frames. Script sandboxes retain their
// per-script ownership queue; these frames have one document-owned transport.
function installTavernHelperPromptApi({ window: w, request, copy }) {
    if (w.__dshTavernPromptApi) return w.__dshTavernPromptApi;
    if (typeof w.injectPrompts === "function" || typeof w.uninjectPrompts === "function") return null;
    const pending = new Set(), failures = [];
    let draining = null, flushing = null;
    function write(operation) {
        // Observe synchronous transport throws and async rejection immediately,
        // since the public API returns a removal handle rather than a Promise.
        const task = Promise.resolve().then(() => request("updateTavernHelperPrompts", { operation })).then(result => {
            if (result && result.stale) throw new Error("聊天已变化，提示词未保存");
        }).then(() => { pending.delete(task); }, error => {
            pending.delete(task);
            failures.push(error instanceof Error ? error : new Error(String(error && error.message || error)));
        });
        pending.add(task);
    }
    function injectPrompts(prompts, options) {
        if (!Array.isArray(prompts)) throw new TypeError("提示词必须是数组");
        if (prompts.some(prompt => prompt && prompt.filter !== undefined)) throw new Error("DSH 暂不支持提示词 filter 回调");
        const ids = prompts.map(prompt => prompt.id);
        write({ kind: "inject", prompts: copy(prompts), once: !!(options && options.once) });
        return { uninject: () => w.uninjectPrompts(ids) };
    }
    function uninjectPrompts(ids) {
        if (!Array.isArray(ids)) throw new TypeError("提示词编号必须是数组");
        write({ kind: "remove", ids: copy(ids) });
    }
    function drainPromptWrites() {
        if (draining) return draining;
        draining = Promise.resolve().then(async () => {
            while (pending.size) await Promise.all(Array.from(pending));
            const errors = failures.splice(0);
            if (errors.length) throw errors[0];
        }).finally(() => { draining = null; });
        return draining;
    }
    function flushBeforeGenerate() {
        if (flushing) return flushing;
        flushing = Promise.resolve().then(async () => {
            let eventError, failed = false;
            try {
                if (typeof w.eventEmit === "function") await w.eventEmit("GENERATION_AFTER_COMMANDS", "normal", {}, false);
            } catch (error) { eventError = error; failed = true; }
            // Even a failed listener may have started a write. Settle its receipt
            // before rejecting, so it cannot leak into an immediate retry.
            try { await drainPromptWrites(); }
            catch (error) { if (!failed) eventError = error; failed = true; }
            if (failed) throw eventError;
        }).finally(() => { flushing = null; });
        return flushing;
    }
    const api = { injectPrompts, uninjectPrompts, drainPromptWrites, flushBeforeGenerate };
    w.injectPrompts = injectPrompts;
    w.uninjectPrompts = uninjectPrompts;
    w.__dshFlushPromptWrites = drainPromptWrites;
    w.__dshFlushBeforeGenerate = flushBeforeGenerate;
    w.__dshTavernPromptApi = api;
    return api;
}
