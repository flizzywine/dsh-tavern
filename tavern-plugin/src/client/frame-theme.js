// card iframes (status panels, message HTML) follow the dsh-tavern theme through
// CSS variables --dsh-theme-bg / -surface / -text / -muted / -accent / -border. The aliases are
// declared once in theme.css (fork UI standard tokens), so each frame reads the values of
// the context it sits in; this module only carries them across the sandbox and keeps them live.
const FRAME_THEME_NAMES = ["bg", "surface", "text", "muted", "accent", "border"];
const forkFrameTheme = (function () {
    const peers = new Map();
    let observer = null, queued = false;
    // Same environment test as the lifecycle's host-theme subscription (headless hosts have no styles).
    function styled(win) { return Boolean(win && win.document && win.document.body && typeof win.getComputedStyle === "function" && typeof win.MutationObserver === "function"); }
    function read(win, node) {
        const style = win.getComputedStyle(node);
        // Host CSS is trusted, but the value lands inside a srcdoc <style>: never let it close the tag.
        return FRAME_THEME_NAMES.map(function (name) {
            const value = style.getPropertyValue("--dsh-theme-" + name).trim().replace(/[<>{};]/g, "");
            return value ? "--dsh-theme-" + name + ":" + value : "";
        }).filter(Boolean).join(";");
    }
    function send(peer) {
        const css = read(peer.win, peer.node), colorScheme = currentTavernHostTheme(peer.win).colorScheme;
        if (css + colorScheme === peer.sent) return;
        peer.sent = css + colorScheme;
        peer.node.contentWindow?.postMessage({ type: "dsh-fork-frame-theme", token: peer.token, css: css, colorScheme: colorScheme }, "*");
    }
    function sync() {
        queued = false;
        if (observer) peers.forEach(send);
    }
    function watch(win) {
        // Theme switches rewrite host styles or <html>/<body> attributes; read once per frame.
        observer = new win.MutationObserver(function () {
            if (queued) return;
            queued = true;
            win.requestAnimationFrame(sync);
        });
        observer.observe(win.document.head, { subtree: true, childList: true, characterData: true });
        [win.document.documentElement, win.document.body].forEach(function (node) { observer.observe(node, { attributes: true, attributeFilter: ["style", "class", "data-ds-dark-theme"] }); });
    }
    function seed(win) { return styled(win) ? read(win, win.document.body) : ""; }
    function register(node, token, win) {
        if (!styled(win)) return function () {};
        const peer = { node: node, token: token, win: win, sent: "" };
        peers.set(token, peer);
        if (!observer) watch(win);
        return function () {
            if (peers.get(token) === peer) peers.delete(token);
            if (peers.size || !observer) return;
            observer.disconnect();
            observer = null;
        };
    }
    // The frame's listener exists only once its document has loaded.
    function ready(token) {
        const peer = peers.get(token);
        if (peer) { peer.sent = ""; send(peer); }
    }
    return { seed, register, ready };
})();

// Serialized into Tavern frames: the seed paints the first frame, the authenticated parent updates it.
function installFrameTheme(token) {
    const style = document.querySelector("style[data-dsh-fork-theme]");
    window.addEventListener("message", function (event) {
        const data = event.data;
        if (event.source !== parent || !data || data.token !== token || data.type !== "dsh-fork-frame-theme") return;
        style.textContent = ":root{" + String(data.css || "") + "}";
        if (data.colorScheme === "light" || data.colorScheme === "dark") document.documentElement.style.colorScheme = data.colorScheme;
    });
}

function frameThemeHead(token, seed) {
    return '<style data-dsh-fork-theme>:root{' + (seed || "") + '}</style><script data-dsh-fork-theme-runtime>(' + installFrameTheme.toString() + ')(' + token + ');<\/script>';
}
