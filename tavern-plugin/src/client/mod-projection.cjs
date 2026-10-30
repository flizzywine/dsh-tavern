'use strict';

// Derived presentation only. The original director and event identities never change.
function projectModPerformances(store, {includeRemoved = false} = {}) {
    if (!store) return [];
    return store.performances.flatMap(original => {
        const correction = store.corrections[original.id];
        const value = correction ? {...original, revision:correction.revision,
            reconciliation:correction.action === 'remove' ? 'removed' : 'confirmed',
            ...(correction.action === 'replace' ? {payload:correction.payload} : {})} : original;
        return value.reconciliation === 'removed' && !includeRemoved ? [] : [value];
    });
}
function modPerformanceLedgerKey(source, id, generation = 0) {
    return JSON.stringify([source, 'mod-performance', generation, id]);
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {projectModPerformances, modPerformanceLedgerKey};
