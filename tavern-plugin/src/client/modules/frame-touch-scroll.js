// Shared by the isolated frame and its host. Return only unconsumed distance.
function scrollTavernTouchChain(start, distance, view) {
    let rest = distance;
    for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        const root = node === view.document.scrollingElement;
        if (!root && !/^(auto|scroll)$/.test(style.overflowY)) continue;
        const max = Math.max(0, node.scrollHeight - node.clientHeight);
        if (max > 0) {
            const before = node.scrollTop;
            // Explicit instant behavior avoids the card/host's scroll-behavior:smooth.
            node.scrollTo({ top: Math.max(0, Math.min(max, before + rest)), behavior: 'instant' });
            rest -= node.scrollTop - before;
            if (Math.abs(rest) < 0.01) return 0;
        }
        if (/^(contain|none)$/.test(style.overscrollBehaviorY)) return 0;
    }
    return rest;
}

// Serialized into the message document; keep dependencies explicit.
function installTavernFrameTouch(token, scrollChain) {
    const view = { document, getComputedStyle: node => getComputedStyle(node) };
    let gesture = null, animation = 0, sequence = 0;
    // A detached frame loses window.parent; a relay from then on has no reader.
    const send = (type, extra) => {
        const host = window.parent;
        if (host && typeof host.postMessage === 'function') host.postMessage(Object.assign({ type, token, sequence }, extra), '*');
    };
    function stop() {
        gesture = null;
        if (animation) cancelAnimationFrame(animation);
        animation = 0;
    }
    function selected() { return Boolean(String(window.getSelection() || '')); }
    // Measured on a phone (Android WebView 155, message frame sized to its content):
    // one stroke fired touchmove 59 times, nothing was preventDefault'ed, and neither the
    // frame nor the conversation moved. The only blocking style in the chain was
    // `body { touch-action: none }`, from a card stylesheet.
    //
    // touch-action intersects up to the root, so that single declaration makes the browser
    // treat the stroke as "not a scroll": the frame has no scroll range of its own (it is
    // sized to its content) and the stroke is never chained to the conversation either.
    // Nothing pans, and no JS relays it because the gesture looks native.
    //
    // A message document never needs to block panning at its root — a card that wants a
    // custom gesture declares it on its own container, which nativeVertical() already
    // handles — so normalise the two root elements back to `auto`. Any value that already
    // allows vertical panning is left untouched.
    // Same rule as nativeVertical(): none, or pan-* without a vertical component, blocks.
    const blocksVerticalPan = action => action === 'none' || (/pan-|pinch-zoom/.test(action) && !/pan-y|pan-up|pan-down/.test(action));
    function unblockRootPanning() {
        for (const node of [document.documentElement, document.body]) {
            if (node && blocksVerticalPan(String(getComputedStyle(node).touchAction || 'auto'))) node.style.setProperty('touch-action', 'auto', 'important');
        }
    }
    function nativeVertical(start) {
        // touch-action is intersected up to the first scroll container.
        for (let node = start; node && node.nodeType === 1; node = node.parentElement) {
            const style = getComputedStyle(node);
            const action = String(style.touchAction || 'auto');
            if (blocksVerticalPan(action)) return false;
            if (node === document.scrollingElement || /^(auto|scroll)$/.test(style.overflowY)) break;
        }
        return true;
    }
    function move(target, dy) {
        const rest = scrollChain(target, dy, view);
        if (rest) send('dsh-tavern-frame-scroll', { dy: rest });
    }
    addEventListener('touchstart', event => {
        // A card script may set it later. The browser fixes a stroke's touch-action at
        // touch-down, so this repairs the next stroke, not the current one.
        unblockRootPanning();
        stop();
        sequence++;
        send('dsh-tavern-frame-touch-start');
        if (event.touches.length !== 1 || event.defaultPrevented || selected()) return;
        const target = event.target;
        // Controls and authored drag surfaces keep their own gesture semantics.
        if (!target || target.nodeType !== 1 || target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),canvas,[draggable="true"],[role="slider"]')) return;
        const touch = event.touches[0], now = performance.now();
        gesture = { target, id: touch.identifier, x: touch.screenX, y: touch.screenY,
            lastY: touch.screenY, started: now, lastTime: now, active: false,
            native: nativeVertical(target), samples: [[now, touch.screenY]] };
    }, { passive: true });
    addEventListener('touchmove', event => {
        const g = gesture;
        if (!g) return;
        if (event.touches.length !== 1 || event.touches[0].identifier !== g.id || event.defaultPrevented || selected()) { stop(); return; }
        if (g.native) return;
        const touch = event.touches[0], now = performance.now();
        const totalY = g.y - touch.screenY, totalX = g.x - touch.screenX;
        if (!g.active) {
            if (now - g.started > 350) { stop(); return; }
            if (Math.max(Math.abs(totalX), Math.abs(totalY)) < 8) return;
            if (Math.abs(totalX) >= Math.abs(totalY)) { stop(); return; }
            g.active = true;
        }
        move(g.target, g.lastY - touch.screenY);
        g.lastY = touch.screenY; g.lastTime = now;
        g.samples.push([now, touch.screenY]);
        while (g.samples.length > 2 && now - g.samples[0][0] > 100) g.samples.shift();
    }, { passive: true });
    addEventListener('touchend', () => {
        const g = gesture;
        stop();
        const now = performance.now();
        if (!g || !g.active || g.native || selected() || now - g.lastTime > 80) return;
        const first = g.samples[0], last = g.samples[g.samples.length - 1];
        if (last[0] <= first[0]) return;
        let speed = Math.max(-3, Math.min(3, (first[1] - last[1]) / (last[0] - first[0])));
        if (Math.abs(speed) < 0.12) return;
        let previous = now;
        const step = time => {
            animation = 0;
            if (!g.target.isConnected || document.hidden || selected() || time - now > 1200) return;
            const dt = Math.min(32, time - previous); previous = time;
            move(g.target, speed * dt);
            speed *= Math.pow(0.92, dt / 16);
            if (Math.abs(speed) > 0.02) animation = requestAnimationFrame(step);
        };
        animation = requestAnimationFrame(step);
    }, { passive: true });
    addEventListener('touchcancel', stop, { passive: true });
    addEventListener('pagehide', stop);
    addEventListener('message', event => {
        if (event.source === parent && event.data && event.data.token === token && event.data.type === 'dsh-tavern-frame-touch-stop' && event.data.sequence === sequence) stop();
    });
    // Stylesheets are normally parsed by now; the per-gesture check catches late ones.
    unblockRootPanning();
    addEventListener('load', unblockRootPanning);
}

// At most one manually scrolling frame per host; no persistent global listeners.
const tavernTouchOwners = new WeakMap();
function createTavernTouchRelay(host) {
    let active = null;
    function stop() {
        if (active) active.contentWindow.postMessage({ type: 'dsh-tavern-frame-touch-stop', token: active.token, sequence: active.sequence }, '*');
        active = null;
        if (tavernTouchOwners.get(host) === stop) tavernTouchOwners.delete(host);
        host.removeEventListener('touchstart', stop, true);
        host.removeEventListener('wheel', stop, true);
    }
    return {
        stop,
        receive(frame, token, data) {
            if (data.type === 'dsh-tavern-frame-touch-start') {
                const previous = tavernTouchOwners.get(host);
                if (previous) previous();
                active = { frame, token, sequence: data.sequence, contentWindow: frame.contentWindow };
                tavernTouchOwners.set(host, stop);
                host.addEventListener('touchstart', stop, { passive: true, capture: true });
                host.addEventListener('wheel', stop, { passive: true, capture: true });
            } else if (active && active.frame === frame && active.token === token && active.sequence === data.sequence && Number.isFinite(data.dy)) {
                if (!frame.isConnected) { stop(); return; }
                scrollTavernTouchChain(frame.parentElement, Math.max(-1000, Math.min(1000, data.dy)), host);
            }
        }
    };
}
