// cardPath is the card identity from frameStorageScope, without sessionId.
const forkFrameZoom = (function () {
    const peers = new Map(), pending = new Map();
    function value(card) {
        const zoom = forkFrameStorage.readZoom(card);
        return Number.isFinite(zoom) ? Math.max(0.6, Math.min(2, zoom)) : 1;
    }
    function seed(card) { return card ? { value: value(card), ready: forkFrameStorage.zoomLoaded() } : null; }
    function send(peer) {
        peer.node.contentWindow?.postMessage({ type: "dsh-fork-frame-zoom", token: peer.token, zoom: value(peer.card) }, "*");
    }
    function register(node, token, card) {
        if (!card) return function () {};
        const peer = { node, token, card };
        peers.set(token, peer);
        return function () { if (peers.get(token) === peer) peers.delete(token); };
    }
    function ready(token) {
        const peer = peers.get(token);
        if (!peer) return;
        Promise.resolve(forkFrameStorage.load()).then(function () {
            if (peers.get(token) === peer) send(peer);
        });
    }
    function adjust(card, data, host) {
        if (!card || (data.reset !== true && data.step !== 1 && data.step !== -1)) return;
        let batch = pending.get(card);
        if (!batch) {
            batch = { value: value(card) };
            pending.set(card, batch);
            host.requestAnimationFrame(function () {
                pending.delete(card);
                forkFrameStorage.writeZoom(card, batch.value);
                for (const peer of peers.values()) if (peer.card === card) send(peer);
            });
        }
        batch.value = data.reset === true ? 1 : Math.max(0.6, Math.min(2, Math.round((batch.value + data.step * 0.1) * 10) / 10));
    }
    return { seed, register, ready, adjust };
})();

// CSS zoom affects rects but scrollHeight remains in unzoomed CSS pixels.
function zoomFrameReporter(reporter) {
    return reporter.replace("body.scrollHeight||0", '(body.scrollHeight||0)*(parseFloat(getComputedStyle(document.documentElement).zoom)||1)');
}
