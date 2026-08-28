let runtimeSnapshot = {
    bootStatus: 'idle',
    processing: false,
    pendingReason: '',
    queuedReason: '',
    lastReason: '',
    lastMode: '',
    lastUpdatedAt: 0,
    lastMessage: '',
    lastError: '',
    worldbookName: '',
    settings: {
        enabled: true,
        auto_apply: true,
        debug: true,
        show_toasts: true,
        context_window: 2,
        debounce_delay: 500,
        map_sticky_cycles: 3,
        character_sticky_cycles: 2,
        forced_enable_entries: [],
        forced_disable_entries: [],
    },
    context: null,
    summary: {
        enabledCount: 0,
        disabledCount: 0,
        totalProcessed: 0,
        activeEntries: [],
        changedEntries: [],
        decisionTraces: [],
        topScoredEntries: [],
    },
    diagnostics: null,
    preview: null,
};
let runtimeActions = {};
const listeners = new Set();
function notifyRuntimeSnapshot() {
    const snapshot = klona(runtimeSnapshot);
    listeners.forEach(listener => listener(snapshot));
}
export function getRuntimeSnapshot() {
    return klona(runtimeSnapshot);
}
export function updateRuntimeSnapshot(patch) {
    runtimeSnapshot = {
        ...runtimeSnapshot,
        ...klona(patch),
    };
    notifyRuntimeSnapshot();
    return getRuntimeSnapshot();
}
export function replaceRuntimeSnapshot(nextSnapshot) {
    runtimeSnapshot = klona(nextSnapshot);
    notifyRuntimeSnapshot();
    return getRuntimeSnapshot();
}
export function onRuntimeSnapshotChange(listener) {
    listeners.add(listener);
    listener(getRuntimeSnapshot());
    return () => listeners.delete(listener);
}
export function registerRuntimeActions(actions) {
    runtimeActions = actions;
}
export async function runManualRefresh(mode = 'enable') {
    if (!runtimeActions.manualRefresh) {
        return getRuntimeSnapshot();
    }
    return runtimeActions.manualRefresh(mode);
}
export async function refreshRuntimeSnapshot() {
    if (!runtimeActions.refreshSnapshot) {
        return getRuntimeSnapshot();
    }
    return runtimeActions.refreshSnapshot();
}
export async function runRuntimeDiagnostics() {
    if (!runtimeActions.runDiagnostics) {
        return getRuntimeSnapshot();
    }
    return runtimeActions.runDiagnostics();
}
export async function runPreviewSimulation(input) {
    if (!runtimeActions.runPreview) {
        return getRuntimeSnapshot();
    }
    return runtimeActions.runPreview(input);
}
