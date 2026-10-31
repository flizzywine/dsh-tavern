'use strict';

function createStageRuntimeStoreModule(stageRuntimeKernel) {
// Effects run after selector publication. Reentrant dispatch is queued, never reduced
// against a half-published snapshot. A runner may synchronously complete an intent.
function createStageRuntimeStore({initialState = stageRuntimeKernel.createStageRuntimeState(), runEffect = () => {}, observe = () => {}} = {}) {
    let state = initialState, flushing = false;
    const queue = [], selectors = new Set();
    const store = {
        getSnapshot: () => state,
        dispatch(event) {
            if (state.disposed && !['PROJECTION_READY', 'ONE_SHOT_READY'].includes(event.type)) return;
            queue.push(event);
            if (flushing) return;
            flushing = true;
            let firstError;
            const attempt = fn => { try { fn(); } catch (error) { firstError ||= error; } };
            try {
                while (queue.length) {
                    const event = queue.shift(), previous = state;
                    const result = stageRuntimeKernel.reduceStageRuntime(state, event);
                    state = result.state;
                    const changed = [];
                    for (const selector of selectors) {
                        if (selector.update(state)) changed.push(selector);
                    }
                    // Every selector sees the same commit, even from another listener.
                    for (const selector of changed) selector.notify(attempt);
                    for (const intent of result.effects) attempt(() => runEffect(intent, store.dispatch, store.getSnapshot));
                    attempt(() => observe(event, previous, state));
                }
            } finally {
                flushing = false;
            }
            if (firstError) throw firstError;
        },
        select(select, equal = Object.is) {
            let snapshot = select(state);
            const listeners = new Set();
            const selector = {
                getSnapshot: () => snapshot,
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                update(next) {
                    const value = select(next);
                    if (equal(snapshot, value)) return false;
                    snapshot = value;
                    return true;
                },
                notify(attempt) { for (const listener of [...listeners]) attempt(listener); },
                dispose() { listeners.clear(); selectors.delete(selector); }
            };
            selectors.add(selector);
            return selector;
        },
        dispose() {
            try { store.dispatch({type: 'DISPOSE'}); }
            finally { for (const selector of selectors) selector.dispose(); }
        }
    };
    return store;
}

function stageRuntimeShallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}

return {createStageRuntimeStore, stageRuntimeShallowEqual};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageRuntimeStoreModule};
