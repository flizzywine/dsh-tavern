// The host keeps a work-step row on screen for every round it ever ran: finished
// rounds draw their group header, and an error round stays `alwaysOpen` so the failure
// stays reachable. A chat that retried a few times ends up with a column of 已调用工具 /
// 已完成分析 lines that carry no story. Hide every settled one — the round currently
// running keeps its live进度 — and leave one quiet control in the error row to bring
// them all back for a glance.
const stepFoldOwners = new WeakMap();
const STEP_FOLD_ROWS = '[data-chat-flow-kind="turn-process"], [data-step-process]';
function createStepFoldControls(root, options) {
    options = options || {};
    stepFoldOwners.get(root)?.dispose();
    let disposed = false;
    let shown = false;
    // Presentation only: the host owns these rows and their own folded state.
    const owned = new Map();
    const toggles = new Set();
    function hide(row) {
        if (!owned.has(row)) owned.set(row, { display: row.style.display });
        row.setAttribute('data-tavern-step-fold', '1');
        if (row.style.getPropertyValue('display') !== 'none' || row.style.getPropertyPriority('display') !== 'important') {
            row.style.setProperty('display', 'none', 'important');
        }
    }
    function release(row) {
        const entry = owned.get(row);
        if (!entry) return;
        owned.delete(row);
        row.removeAttribute('data-tavern-step-fold');
        row.style.removeProperty('display');
        if (entry.display) row.style.display = entry.display;
    }
    function label(toggle) {
        const text = shown ? '收起步骤' : '查看步骤';
        if (toggle.textContent !== text) toggle.textContent = text;
        const title = shown ? '收起所有工作步骤' : '展开所有被收起的工作步骤';
        if (toggle.title !== title) toggle.title = title;
    }
    function makeToggle() {
        const toggle = root.ownerDocument.createElement('button');
        toggle.type = 'button';
        toggle.className = 'dsh-tavern-step-fold-toggle';
        toggle.onclick = function () {
            if (disposed) return;
            shown = !shown;
            apply();
        };
        label(toggle);
        return toggle;
    }
    function apply() {
        if (disposed) return;
        const rows = Array.from(root.querySelectorAll(STEP_FOLD_ROWS));
        // While a round is streaming, its live work-step row stays: that is the only
        // one carrying progress. Settled rounds leave nothing to watch.
        const flow = Array.from(root.querySelectorAll('[data-chat-flow-kind="turn-process"]'));
        // Scroll-following remains enabled after completion; only session state means running.
        const live = options.running === true;
        const running = live ? flow[flow.length - 1] || null : null;
        const targets = new Set(rows.filter(row => !row.hidden && row !== running));
        for (const row of Array.from(owned.keys())) if (!targets.has(row)) release(row);
        if (shown) {
            for (const row of rows) release(row);
        } else {
            for (const row of targets) hide(row);
        }
        // One control per error row: the round's own actions already live there.
        const anchors = new Set();
        for (const panel of root.querySelectorAll('.dsh-tavern-error-controls')) {
            if (!panel.hidden && panel.isConnected) anchors.add(panel);
        }
        for (const toggle of Array.from(toggles)) if (!toggle.isConnected) toggles.delete(toggle);
        if (!anchors.size) {
            for (const toggle of Array.from(toggles)) { toggle.remove(); toggles.delete(toggle); }
            return;
        }
        let attached = 0;
        for (const panel of anchors) {
            const toggle = toggles.values().next().value || makeToggle();
            toggles.add(toggle);
            if (toggle.parentNode !== panel) panel.append(toggle);
            label(toggle);
            attached += 1;
            if (attached > 1) break;
        }
    }
    const controls = { apply, dispose() {
        if (disposed) return;
        disposed = true;
        for (const row of Array.from(owned.keys())) release(row);
        for (const toggle of Array.from(toggles)) toggle.remove();
        toggles.clear();
        if (stepFoldOwners.get(root) === controls) stepFoldOwners.delete(root);
    } };
    stepFoldOwners.set(root, controls);
    return controls;
}
