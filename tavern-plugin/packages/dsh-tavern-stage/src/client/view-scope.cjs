'use strict';
// Own partial construction as well as the mounted view. The host only disposes
// this scope; it does not need to know the stage's internal resource inventory.
function createStageViewScope(build) {
    const owners = [];
    let disposed = false;
    function dispose() {
        if (disposed) return;
        disposed = true;
        const errors = [];
        for (const owner of owners.splice(0).reverse()) {
            try { owner.dispose(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Stage view cleanup failed');
    }
    try {
        const view = build(owner => { owners.push(owner); return owner; });
        return {...view, dispose};
    } catch (error) {
        try { dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Stage view construction failed'); }
        throw error;
    }
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageViewScope};
