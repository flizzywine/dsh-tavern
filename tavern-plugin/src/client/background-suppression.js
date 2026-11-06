// Share in-flight reads across effect restarts and duplicate mounts.
function createBackgroundSuppressionPoller(rpc, timers = window) {
  const inFlight = new Map();
  return function subscribe(sessionId, running, onResult, onError) {
    let disposed = false, timer;
    async function refresh() {
      let request = inFlight.get(sessionId);
      if (!request) {
        request = Promise.resolve().then(() => rpc("getBackgroundSuppressedTurns", {sessionId}));
        inFlight.set(sessionId, request);
        const clear = () => { if (inFlight.get(sessionId) === request) inFlight.delete(sessionId); };
        request.then(clear, clear);
      }
      try { const result = await request; if (!disposed) onResult(result); }
      catch (error) { if (!disposed) onError(error); }
      finally { if (!disposed && running) timer = timers.setTimeout(refresh, 15000); }
    }
    refresh();
    return () => { disposed = true; timers.clearTimeout(timer); };
  };
}
