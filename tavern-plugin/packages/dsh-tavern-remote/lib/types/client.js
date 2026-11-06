import { RemoteSnapshotStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client';
import { TYPERT_REMOTE } from 'dsh-tavern-remote/remote';
export const inject = ['remote'];
export async function apply(ctx) {
    const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
    const tavernSignals = ctx.get('remote.tavernSignals');
    if (tavernSignals === undefined)
        throw new Error('dsh-tavern-remote: remote.tavernSignals is unavailable after mount');
    const listeners = new Set();
    const latest = new Map();
    let connected = false;
    let disposed = false;
    let retryAttempt = 0;
    let retryTimer;
    let control;
    const pendingDisposals = new Set();
    const sessionIds = () => Array.from(new Set(Array.from(listeners, item => item.sessionId))).sort();
    const key = (sessionId, kind) => `${sessionId}\u0000${kind}`;
    const isCurrent = (stream) => !disposed && control === stream;
    const report = (stream, error) => {
        for (const item of Array.from(listeners)) {
            if (!isCurrent(stream))
                return;
            if (listeners.has(item))
                item.onError?.(error);
        }
    };
    const clearSnapshot = () => { connected = false; latest.clear(); };
    const retireStream = (resetRetry = true) => {
        const previous = control;
        // Invalidate callbacks before disposal, which may finish after a successor starts.
        control = undefined;
        clearSnapshot();
        if (retryTimer !== undefined) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
        }
        if (resetRetry)
            retryAttempt = 0;
        if (previous === undefined)
            return;
        const pending = previous.dispose();
        pendingDisposals.add(pending);
        // Retired failures must not notify listeners belonging to a new stream.
        void pending.then(() => pendingDisposals.delete(pending), () => pendingDisposals.delete(pending));
    };
    const scheduleRecovery = (failed) => {
        if (!isCurrent(failed) || retryTimer !== undefined || listeners.size === 0)
            return;
        const delay = Math.min(5000, 250 * (2 ** retryAttempt++));
        retryTimer = setTimeout(() => {
            if (!isCurrent(failed))
                return;
            retryTimer = undefined;
            retireStream(false);
            startStream();
        }, delay);
    };
    const startStream = () => {
        if (disposed || control !== undefined || listeners.size === 0)
            return;
        // A subscription-set change gets a new owner, including new callback closures.
        const followedSessionIds = sessionIds();
        let failed = false;
        const active = () => isCurrent(next) && !failed;
        const stream = ctx.remote.$stream({
            name: 'Tavern session signal stream',
            open: (signal) => tavernSignals.follow(followedSessionIds, signal),
            ended: (accepted) => accepted
                ? new RemoteStreamCarrierError('Tavern session signal stream ended unexpectedly')
                : new Error('Tavern session signal stream ended before its snapshot'),
            carrierFailed: (error) => {
                if (!active())
                    return;
                clearSnapshot();
                report(next, error);
            },
        });
        const next = new RemoteSnapshotStream(stream, {
            name: 'Tavern session signal stream',
            isSnapshot: (frame) => frame.type === 'snapshot',
            replace: (frame) => {
                if (!active())
                    return;
                retryAttempt = 0;
                latest.clear();
                for (const signal of frame.signals)
                    latest.set(key(signal.sessionId, signal.kind), signal);
                connected = true;
                for (const item of Array.from(listeners)) {
                    if (!active())
                        return;
                    if (!listeners.has(item))
                        continue;
                    item.onConnect?.();
                    if (!active())
                        return;
                    const signal = latest.get(key(item.sessionId, item.kind));
                    if (listeners.has(item) && signal !== undefined)
                        item.listener(signal);
                }
            },
            update: (frame) => {
                if (!active())
                    return;
                const signal = frame.signal;
                latest.set(key(signal.sessionId, signal.kind), signal);
                for (const item of Array.from(listeners)) {
                    if (!active())
                        return;
                    if (listeners.has(item) && item.sessionId === signal.sessionId && item.kind === signal.kind)
                        item.listener(signal);
                }
            },
            failed: (error) => {
                if (!active())
                    return;
                failed = true;
                clearSnapshot();
                report(next, error);
                scheduleRecovery(next);
            },
        });
        control = next;
        next.start();
    };
    const service = Object.freeze({
        async control(method, args, signal) {
            if (disposed)
                throw new Error('Tavern runtime control has been disposed');
            // Returning closes the one-shot iterator; the generated transport owns cancellation.
            for await (const result of tavernSignals.control(method, args, signal))
                return JSON.parse(result);
            throw new Error('Tavern runtime control ended without a response');
        },
        subscribe(sessionId, kind, listener, onError, onConnect) {
            if (disposed)
                throw new Error('Tavern session signals have been disposed');
            const item = { sessionId: String(sessionId), kind: String(kind), listener, onError, onConnect };
            const before = JSON.stringify(sessionIds());
            listeners.add(item);
            if (before !== JSON.stringify(sessionIds()))
                retireStream();
            const current = control;
            if (connected)
                item.onConnect?.();
            const signal = latest.get(key(item.sessionId, item.kind));
            if (current === control && !disposed && signal !== undefined)
                item.listener(signal);
            startStream();
            let stopped = false;
            return () => {
                if (stopped)
                    return;
                stopped = true;
                const previous = JSON.stringify(sessionIds());
                listeners.delete(item);
                if (listeners.size === 0 || previous !== JSON.stringify(sessionIds())) {
                    retireStream();
                    startStream();
                }
            };
        },
    });
    ctx.provide('tavernSessionSignals', service);
    let disposal;
    return () => {
        if (disposal !== undefined)
            return disposal;
        disposed = true;
        listeners.clear();
        retireStream();
        disposal = (async () => {
            try {
                await Promise.all(Array.from(pendingDisposals));
            }
            finally {
                await unmount();
            }
        })();
        return disposal;
    };
}
//# sourceMappingURL=client.js.map