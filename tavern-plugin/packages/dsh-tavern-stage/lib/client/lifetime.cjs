'use strict';

// Register each resource immediately, so a later startup failure can unwind it.
function startStageClientLifetime(start) {
    const cleanups = [];
    let active = true;
    const dispose = () => {
        if (!active) return;
        active = false;
        const errors = [];
        for (const cleanup of cleanups.splice(0).reverse()) {
            try { cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Stage client cleanup failed');
    };
    const own = cleanup => {
        if (typeof cleanup !== 'function') throw new TypeError('Stage cleanup must be a function');
        if (active) cleanups.push(cleanup);
        else cleanup();
        return cleanup;
    };
    try { start({own, active: () => active}); }
    catch (error) {
        try { dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Stage client startup failed'); }
        throw error;
    }
    return dispose;
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {startStageClientLifetime};
