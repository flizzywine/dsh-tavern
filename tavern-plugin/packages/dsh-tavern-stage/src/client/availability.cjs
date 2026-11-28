// The chat host publishes readiness. The plugin owns only the mounted views.
function watchStageAvailability({source,activate,report=error=>console.error('[dsh-tavern-stage] availability failed',error)}) {
    let closed = false, mounting = false, release = null;
    function stop() {
        const dispose = release;
        release = null;
        try { dispose?.(); } catch (error) { report(error); }
    }
    function reconcile() {
        if (closed || !source.getSnapshot()) { stop(); return; }
        if (release || mounting) return;
        mounting = true;
        try {
            release = activate();
            if (closed || !source.getSnapshot()) stop();
        } catch (error) { report(error); }
        finally { mounting = false; }
    }
    const unsubscribe = source.subscribe(reconcile);
    reconcile();
    return () => {
        if (closed) return;
        closed = true;
        try { unsubscribe(); } finally { stop(); }
    };
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={watchStageAvailability};
