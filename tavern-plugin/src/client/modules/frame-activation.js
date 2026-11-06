// Stagger first mounts only. Running card scripts retain their existing lifetime.
function createTavernFrameActivationQueue(host) {
    const pending = new Set();
    const request = typeof host.requestAnimationFrame === "function"
        ? run => host.requestAnimationFrame(run) : run => host.setTimeout(run, 16);
    const cancel = typeof host.requestAnimationFrame === "function"
        ? id => host.cancelAnimationFrame(id) : id => host.clearTimeout(id);
    let timer = null;
    function schedule() {
        if (timer !== null || pending.size === 0) return;
        timer = request(function () {
            timer = null;
            const entry = pending.values().next().value;
            pending.delete(entry);
            try { if (entry) entry.run(); }
            finally { schedule(); }
        });
    }
    return function enqueue(run) {
        const entry = { run };
        pending.add(entry);
        schedule();
        return function () {
            pending.delete(entry);
            if (pending.size === 0 && timer !== null) { cancel(timer); timer = null; }
        };
    };
}
