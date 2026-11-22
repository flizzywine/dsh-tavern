// Resource Timing shows origin-bound first views queued behind startup catalogues.
// Keep the authenticated HTTP carrier and let Chromium prioritize its pending sockets.
function rpcFetchPriority(method) {
    if (['getAssetPackPresentation', 'getStagePhonePresentation', 'getRoundBody', 'getSession'].includes(method)) return 'high';
    if (['getStageMusicTracks', 'getStageBackgrounds', 'getUpdateStatus', 'getStorageMigration', 'recordPlayTelemetry', 'recordMvuRuntimeDiagnostic'].includes(method)) return 'low';
    return 'auto';
}
// Origin-bound projections stay on HTTP, but cannot occupy its entire socket pool.
function createPresentationQueue(limit = 2) {
    let active = 0;
    const pending = [];
    function drain() {
        while (active < limit && pending.length) {
            const job = pending.shift();
            job.signal?.removeEventListener('abort', job.abort);
            active++;
            Promise.resolve().then(() => {
                job.signal?.throwIfAborted();
                return job.task();
            }).then(job.resolve, job.reject).finally(() => { active--; drain(); });
        }
    }
    return (task, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const job = {task, signal, resolve, reject, abort:() => {
            pending.splice(pending.indexOf(job), 1);
            reject(signal.reason);
        }};
        pending.push(job);
        signal?.addEventListener('abort', job.abort, {once:true});
        drain();
    });
}

const TAVERN_WS_RPC_PATH = '/api/dsh-tavern/ws';
const MAX_TAVERN_WS_RPC_CHARS = 4 * 1024 * 1024;
const HTTP_ONLY_TAVERN_RPC_METHODS = new Set(['getAssetPackPresentation', 'getStagePhonePresentation']);

function isIdempotentTavernRpc(method) {
    if (!method || typeof method !== 'string') return false;
    if (/^(?:get|list|read|search|inspect|check|verify|preview|resolve|describe|collect|export|count|has)[A-Z]/.test(method)) return true;
    return method === 'syncSession' || method === 'pluginTurnState' || method === 'pluginState' || method === 'sceneImageStatus';
}

function makeRpcAbortError(signal) {
    if (signal && signal.reason instanceof Error) return signal.reason;
    const error = new Error('会话读取已取消');
    error.name = 'AbortError';
    return error;
}

// Tavern's dedicated WebSocket RPC channel: carries JSON RPCs outside the 6-socket HTTP/1.1 pool
// with relaxed keepalive (25s ping / 15s pong), zero double-JSON escaping, and HTTP fallback.
function createTavernWsRpcClient(options = {}) {
    const openSocket = options.openSocket;
    const setTimer = options.setTimer || (typeof window !== 'undefined' && window.setTimeout ? window.setTimeout.bind(window) : setTimeout);
    const clearTimer = options.clearTimer || (typeof window !== 'undefined' && window.clearTimeout ? window.clearTimeout.bind(window) : clearTimeout);
    const now = options.now || Date.now;
    const explicitConnectWaitMs = options.connectWaitMs;
    const initialConnectWaitMs = options.initialConnectWaitMs ?? explicitConnectWaitMs ?? 1200;
    const reconnectWaitMs = explicitConnectWaitMs ?? 250;
    const pingIntervalMs = options.pingIntervalMs ?? 25000;
    const pongTimeoutMs = options.pongTimeoutMs ?? 15000;
    const backoffDelays = options.backoffDelays || [300, 800, 2000, 5000];
    const maxRequestChars = options.maxRequestChars ?? MAX_TAVERN_WS_RPC_CHARS;

    let disposed = false;
    let socket = null;
    let detachSocket = null;
    let everConnected = false;
    let nextReqId = 0;
    let nextSubId = 0;
    let backoffIndex = 0;
    let cooldownUntil = 0;
    let reconnectTimer = null;
    let pingTimer = null;
    let pongTimer = null;
    let lastReceivedAt = 0;
    const openWaiters = new Set();
    const inflight = new Map();
    const subscriptions = new Map();
    const stats = { sent: 0, completed: 0, fallbacks: 0, reconnects: 0 };

    function sendSubscription(ws, subId, sub) {
        if (disposed || !ws || ws.readyState !== 1) return;
        let rawArgs = '{}';
        try {
            const val = typeof sub.getArgs === 'function' ? sub.getArgs() : (sub.args !== undefined ? sub.args : {});
            rawArgs = JSON.stringify(val === undefined ? {} : val);
        } catch (_) {}
        try {
            ws.send('S\t' + subId + '\t' + sub.topic + '\n' + rawArgs);
        } catch (_) {}
    }

    function notifyInitialConnectFallback() {
        if (everConnected || backoffIndex < 2 || !subscriptions.size) return;
        for (const sub of subscriptions.values()) {
            if (!sub.fallbackNotified) {
                sub.fallbackNotified = true;
                try { if (typeof sub.onFallback === 'function') sub.onFallback(); } catch (_) {}
            }
        }
    }

    function clearHeartbeatTimers() {
        if (pingTimer !== null) { clearTimer(pingTimer); pingTimer = null; }
        if (pongTimer !== null) { clearTimer(pongTimer); pongTimer = null; }
    }

    function clearReconnectTimer() {
        if (reconnectTimer !== null) { clearTimer(reconnectTimer); reconnectTimer = null; }
    }

    function armPingTimer(ws) {
        clearHeartbeatTimers();
        if (disposed || pingIntervalMs <= 0) return;
        pingTimer = setTimer(function () {
            pingTimer = null;
            if (disposed || socket !== ws || ws.readyState !== 1) return;
            sendPing(ws);
        }, pingIntervalMs);
    }

    function sendPing(ws) {
        if (disposed || socket !== ws || ws.readyState !== 1) return;
        try {
            ws.send('P');
        } catch (_) {
            retireSocket(ws, true);
            return;
        }
        if (pongTimer === null && pongTimeoutMs > 0) {
            pongTimer = setTimer(function () {
                pongTimer = null;
                if (socket === ws) retireSocket(ws, true);
            }, pongTimeoutMs);
        }
    }

    function settleOpenWaiters(wsOrNull) {
        if (!openWaiters.size) return;
        const waiters = Array.from(openWaiters);
        openWaiters.clear();
        for (let i = 0; i < waiters.length; i++) waiters[i](wsOrNull);
    }

    function scheduleReconnect() {
        if (disposed || reconnectTimer !== null) return;
        const delay = backoffDelays[Math.min(backoffIndex, backoffDelays.length - 1)] || 1000;
        backoffIndex = Math.min(backoffIndex + 1, backoffDelays.length);
        cooldownUntil = now() + delay;
        notifyInitialConnectFallback();
        reconnectTimer = setTimer(function () {
            reconnectTimer = null;
            if (!disposed) ensureConnecting();
        }, delay);
    }

    function settleDisconnectedInflight() {
        if (!inflight.size) return;
        const entries = Array.from(inflight.values());
        inflight.clear();
        for (let i = 0; i < entries.length; i++) {
            entries[i].onDisconnect();
        }
    }

    function retireSocket(ws, shouldReconnect) {
        if (socket !== ws) return;
        socket = null;
        if (detachSocket) { detachSocket(); detachSocket = null; }
        clearHeartbeatTimers();
        try { if (ws.readyState === 0 || ws.readyState === 1) ws.close(1000, ''); } catch (_) {}
        settleOpenWaiters(null);
        settleDisconnectedInflight();
        if (shouldReconnect && !disposed) {
            stats.reconnects++;
            scheduleReconnect();
        }
    }

    function handleMessage(ws, event) {
        if (disposed || socket !== ws) return;
        lastReceivedAt = now();
        if (pongTimer !== null) { clearTimer(pongTimer); pongTimer = null; }
        armPingTimer(ws);

        const data = event && typeof event.data === 'string' ? event.data : '';
        if (!data || data === 'O') return;
        if (data === 'P') {
            try { if (ws.readyState === 1) ws.send('O'); } catch (_) {}
            return;
        }
        if (data.startsWith('E\t')) {
            const subNewline = data.indexOf('\n');
            if (subNewline <= 2) return;
            const subId = data.slice(2, subNewline);
            const sub = subscriptions.get(subId);
            if (!sub || typeof sub.onEvent !== 'function') return;
            let parsed;
            try { parsed = JSON.parse(data.slice(subNewline + 1)); } catch (_) { return; }
            try { sub.onEvent(parsed); } catch (_) {}
            return;
        }
        if (data.startsWith('X\t')) {
            const subId = data.slice(2).trim();
            const sub = subscriptions.get(subId);
            if (sub && typeof sub.onUnavailable === 'function') {
                try { sub.onUnavailable(); } catch (_) {}
            }
            return;
        }
        if (!data.startsWith('R\t')) return;
        const newlineAt = data.indexOf('\n');
        if (newlineAt <= 2) return;
        const reqId = data.slice(2, newlineAt);
        const rawJson = data.slice(newlineAt + 1);
        const entry = inflight.get(reqId);
        if (!entry) return;
        inflight.delete(reqId);
        entry.onReply(rawJson);
    }

    function ensureConnecting() {
        if (disposed || typeof openSocket !== 'function') return null;
        if (socket && (socket.readyState === 0 || socket.readyState === 1)) return socket;
        clearReconnectTimer();
        let ws;
        try {
            ws = openSocket();
        } catch (_) {
            scheduleReconnect();
            return null;
        }
        if (!ws) {
            scheduleReconnect();
            return null;
        }
        socket = ws;
        const onOpen = function () {
            if (disposed || socket !== ws) return;
            everConnected = true;
            backoffIndex = 0;
            cooldownUntil = 0;
            lastReceivedAt = now();
            armPingTimer(ws);
            for (const [subId, sub] of subscriptions) {
                if (sub.fallbackNotified) {
                    sub.fallbackNotified = false;
                    try { if (typeof sub.onReconnected === 'function') sub.onReconnected(); } catch (_) {}
                }
                sendSubscription(ws, subId, sub);
            }
            settleOpenWaiters(ws);
        };
        const onMessage = function (event) { handleMessage(ws, event); };
        const onCloseOrError = function () { retireSocket(ws, true); };

        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onCloseOrError);
        ws.addEventListener('error', onCloseOrError);
        detachSocket = function () {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('message', onMessage);
            ws.removeEventListener('close', onCloseOrError);
            ws.removeEventListener('error', onCloseOrError);
        };
        if (ws.readyState === 1) onOpen();
        return ws;
    }

    function acquireOpenSocket(signal) {
        if (disposed || typeof openSocket !== 'function') return Promise.resolve(null);
        if (socket && socket.readyState === 1) return Promise.resolve(socket);
        if (now() < cooldownUntil) return Promise.resolve(null);
        const ws = ensureConnecting();
        if (!ws) return Promise.resolve(null);
        if (ws.readyState === 1) return Promise.resolve(ws);
        const waitMs = everConnected ? reconnectWaitMs : initialConnectWaitMs;
        if (waitMs <= 0) return Promise.resolve(null);

        return new Promise(function (resolve) {
            let done = false;
            let waitTimer = null;
            const finish = function (result) {
                if (done) return;
                done = true;
                openWaiters.delete(waiter);
                if (waitTimer !== null) clearTimer(waitTimer);
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve(result);
            };
            const waiter = function (opened) { finish(opened); };
            const onAbort = function () { finish(null); };
            openWaiters.add(waiter);
            if (signal) {
                if (signal.aborted) { finish(null); return; }
                signal.addEventListener('abort', onAbort, { once: true });
            }
            waitTimer = setTimer(function () { finish(null); }, waitMs);
        });
    }

    return {
        start() {
            if (!disposed) ensureConnecting();
            return this;
        },
        poke() {
            if (disposed) return;
            if (!socket || (socket.readyState !== 0 && socket.readyState !== 1)) {
                cooldownUntil = 0;
                clearReconnectTimer();
                ensureConnecting();
                return;
            }
            if (socket.readyState === 1 && now() - lastReceivedAt > 5000) {
                sendPing(socket);
            }
        },
        canCarry(method, bodyChars, requestOptions) {
            if (disposed || typeof openSocket !== 'function') return false;
            if (requestOptions && requestOptions.keepalive === true) return false;
            if (HTTP_ONLY_TAVERN_RPC_METHODS.has(method)) return false;
            if (typeof bodyChars === 'number' && bodyChars > maxRequestChars) return false;
            return true;
        },
        call(method, requestBody, callOptions = {}) {
            const { signal, fallback, onBody, onParsed } = callOptions;
            if (signal?.aborted) return Promise.reject(makeRpcAbortError(signal));
            return acquireOpenSocket(signal).then(function (ws) {
                if (signal?.aborted) throw makeRpcAbortError(signal);
                if (!ws || ws.readyState !== 1) {
                    stats.fallbacks++;
                    return fallback();
                }
                const reqId = String(++nextReqId);
                try {
                    ws.send('Q\t' + reqId + '\t' + method + '\n' + requestBody);
                } catch (_) {
                    stats.fallbacks++;
                    retireSocket(ws, true);
                    return fallback();
                }
                stats.sent++;
                const idempotent = isIdempotentTavernRpc(method);
                return new Promise(function (resolve, reject) {
                    const cleanupAbort = function () {
                        if (signal) signal.removeEventListener('abort', onAbort);
                    };
                    const onAbort = function () {
                        if (!inflight.delete(reqId)) return;
                        cleanupAbort();
                        try {
                            if (socket === ws && ws.readyState === 1) ws.send('C\t' + reqId);
                        } catch (_) {}
                        reject(makeRpcAbortError(signal));
                    };
                    if (signal) {
                        if (signal.aborted) {
                            try { if (socket === ws && ws.readyState === 1) ws.send('C\t' + reqId); } catch (_) {}
                            reject(makeRpcAbortError(signal));
                            return;
                        }
                        signal.addEventListener('abort', onAbort, { once: true });
                    }
                    inflight.set(reqId, {
                        onReply(rawJson) {
                            cleanupAbort();
                            stats.completed++;
                            if (onBody) onBody(rawJson);
                            let parsed;
                            try {
                                parsed = JSON.parse(rawJson);
                            } catch (_) {
                                const err = new Error('服务返回非 JSON 或不完整的响应，请稍后重试');
                                err.retryable = true;
                                reject(err);
                                return;
                            }
                            if (onParsed) onParsed();
                            resolve(parsed);
                        },
                        onDisconnect() {
                            cleanupAbort();
                            if (signal?.aborted) {
                                reject(makeRpcAbortError(signal));
                                return;
                            }
                            if (idempotent && typeof fallback === 'function') {
                                stats.fallbacks++;
                                Promise.resolve().then(fallback).then(resolve, reject);
                                return;
                            }
                            const err = new Error('连接已中断，请稍后重试');
                            err.retryable = true;
                            reject(err);
                        }
                    });
                });
            });
        },
        subscribe(topic, subOptions = {}) {
            if (disposed || typeof topic !== 'string' || !topic) return function () {};
            const subId = String(++nextSubId);
            const entry = {
                topic,
                args: subOptions.args,
                getArgs: subOptions.getArgs,
                onEvent: subOptions.onEvent,
                onUnavailable: subOptions.onUnavailable,
                onFallback: subOptions.onFallback,
                onReconnected: subOptions.onReconnected,
                fallbackNotified: false
            };
            subscriptions.set(subId, entry);
            if (socket && socket.readyState === 1) {
                sendSubscription(socket, subId, entry);
            } else {
                if (reconnectTimer === null) ensureConnecting();
                if (!everConnected && backoffIndex >= 2 && !entry.fallbackNotified) {
                    entry.fallbackNotified = true;
                    try { if (typeof entry.onFallback === 'function') entry.onFallback(); } catch (_) {}
                }
            }
            let active = true;
            return function unsubscribe() {
                if (!active) return;
                active = false;
                if (!subscriptions.delete(subId)) return;
                if (socket && socket.readyState === 1) {
                    try { socket.send('U\t' + subId); } catch (_) {}
                }
            };
        },
        stats() {
            return Object.assign({}, stats, {
                connected: Boolean(socket && socket.readyState === 1),
                inflight: inflight.size,
                subscriptions: subscriptions.size
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            clearReconnectTimer();
            clearHeartbeatTimers();
            subscriptions.clear();
            const current = socket;
            socket = null;
            if (detachSocket) { detachSocket(); detachSocket = null; }
            try { if (current && (current.readyState === 0 || current.readyState === 1)) current.close(1000, ''); } catch (_) {}
            settleOpenWaiters(null);
            settleDisconnectedInflight();
        }
    };
}

if (typeof module !== 'undefined' && typeof window === 'undefined') {
    module.exports = {
        createPresentationQueue,
        rpcFetchPriority,
        createTavernWsRpcClient,
        isIdempotentTavernRpc,
        TAVERN_WS_RPC_PATH,
    };
}
