// 正文走工具调用时，一整段正文在两个布局帧之间落地，而不是逐字流式出现。
// 宿主在回合进行中一直跟随底部，这次提交因此把读者留在整段正文的最后一行；
// 读者其实是在等这段正文，应该从第一行开始读。只有读者本来就在跟随底部时
// 才移动：读历史、或刷新后恢复已保存位置时都不打扰。

function tavernReplyRevealScroller(row, host) {
    const marked = row.closest("[data-conversation-scroll]");
    if (marked) return marked;
    for (let node = row.parentElement; node && node !== host.document.body; node = node.parentElement) {
        let style = null;
        try { style = host.getComputedStyle(node); } catch (_) { continue; }
        if (style && /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    }
    return host.document.scrollingElement || null;
}

// 宿主在跟随底部时给聊天根节点加标记；没有这个标记的旧宿主退回按位置判断。
function tavernReplyRevealFollowingTail(row, scroller) {
    if (row.closest("[data-chat-following-tail]")) return true;
    const floor = scroller.scrollHeight - scroller.clientHeight;
    return floor - scroller.scrollTop <= 48;
}

// 只有最后一轮的回复值得定位：更早的楼层下方一定还有新的玩家输入。
function tavernReplyRevealLatest(row, host) {
    const flow = row.closest("[data-chat-flow]") || row.parentElement;
    if (!flow) return true;
    for (const candidate of flow.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')) {
        if (candidate === row) continue;
        if (row.compareDocumentPosition(candidate) & host.Node.DOCUMENT_POSITION_FOLLOWING) return false;
    }
    return true;
}

function tavernReplyRevealVisible(row) {
    if (!row.isConnected || row.hasAttribute("hidden") || row.closest("[hidden]")) return false;
    if (row.getAttribute("data-turn-process-hidden") !== null) return false;
    return row.getBoundingClientRect().height > 0;
}

// 只把正文开头放到视口顶部，不改读者的语义阅读位置；宿主随后会自己解除跟随。
// 面板（尤其是卡片 HTML 的 iframe）测高期间可能再长高，这里短暂重复定位，
// 防止宿主的自动跟随把位置盖回底部。
function tavernReplyReveal(row, options) {
    const host = options && options.host || (typeof window !== "undefined" ? window : null);
    if (!host || typeof host.requestAnimationFrame !== "function" || !row) return function () {};
    const scroller = tavernReplyRevealScroller(row, host);
    if (!scroller) return function () {};
    const padding = options && Number.isFinite(options.padding) ? options.padding : 24;
    const holdMs = options && Number.isFinite(options.holdMs) ? options.holdMs : 1600;
    const deadline = Date.now() + Math.max(0, holdMs);
    const listeners = [];
    let frame = null, stopped = false;
    function stop() {
        if (stopped) return;
        stopped = true;
        if (frame !== null) host.cancelAnimationFrame(frame);
        frame = null;
        while (listeners.length > 0) {
            const entry = listeners.pop();
            host.removeEventListener(entry[0], entry[1], true);
        }
    }
    function place() {
        const floor = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        const target = Math.max(0, Math.min(floor, scroller.scrollTop + top - padding));
        if (Math.abs(scroller.scrollTop - target) > 0.5) scroller.scrollTop = target;
    }
    function tick() {
        frame = null;
        if (stopped) return;
        // 下方出现新输入或面板被折叠时立刻放手。
        if (!tavernReplyRevealVisible(row) || !tavernReplyRevealLatest(row, host)) return stop();
        place();
        if (Date.now() >= deadline) return stop();
        frame = host.requestAnimationFrame(tick);
    }
    // 读者真正的滚动或点击优先；不拦悬浮等被动事件。
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        const handler = function () { stop(); };
        listeners.push([name, handler]);
        host.addEventListener(name, handler, { capture: true, passive: true });
    }
    // 第一次写入推迟一帧：宿主先在同一轮布局里把跟随底部落到新位置，
    // 我们再判断读者原本是否在跟随，并覆盖到正文开头。
    frame = host.requestAnimationFrame(function () {
        frame = null;
        if (stopped) return;
        if (!tavernReplyRevealVisible(row) || !tavernReplyRevealLatest(row, host) || !tavernReplyRevealFollowingTail(row, scroller)) return stop();
        place();
        tick();
    });
    return stop;
}

// 正文可能在一个新节点上直接出现（工具调用步骤被整段替换后宿主重新挂载），
// 组件内看不到"空到有"的变化。用会话运行状态补一个窗口：只有页面亲眼看到
// 这一回合跑过（或刷新时正在跑），刚出现的整段正文才值得重新定位；打开存档
// 恢复的历史正文不算。
function tavernWatchReplyRuns(sessions) {
    const list = sessions && sessions.list;
    const read = list && typeof list.getSnapshot === "function" ? function () { return list.getSnapshot(); } : null;
    const subscribe = list && typeof list.subscribe === "function" ? function (listener) { return list.subscribe(listener); } : null;
    const runs = new Map();
    function sample() {
        if (!read) return;
        const snapshot = read();
        const byId = snapshot && snapshot.byId || {};
        const seen = new Set();
        for (const sessionId of Object.keys(byId)) {
            seen.add(sessionId);
            const running = byId[sessionId] && byId[sessionId].running === true;
            const run = runs.get(sessionId) || { running: false, finishedAt: 0, revealed: new Set() };
            if (running !== run.running) {
                run.running = running;
                // 重新生成同一楼层时，新的一次生成结束可以再定位一次。
                if (running) run.revealed.clear();
                else run.finishedAt = Date.now();
            }
            runs.set(sessionId, run);
        }
        for (const sessionId of runs.keys()) if (!seen.has(sessionId)) runs.delete(sessionId);
    }
    sample();
    const stop = subscribe ? subscribe(sample) : null;
    return Object.freeze({
        // 页面正在看着这一回合，或它刚在这几秒内结束。
        watching: function (sessionId) {
            const run = runs.get(String(sessionId));
            if (!run) return false;
            return run.running || run.finishedAt > 0 && Date.now() - run.finishedAt <= 30000;
        },
        seen: function (sessionId, key) {
            const run = runs.get(String(sessionId));
            return Boolean(run && run.revealed.has(String(key)));
        },
        mark: function (sessionId, key) {
            const run = runs.get(String(sessionId));
            if (run) run.revealed.add(String(key));
        },
        dispose: function () { if (typeof stop === "function") stop(); runs.clear(); }
    });
}

let tavernReplyRunWatch = null;
function installTavernReplyRuns(sessions) {
    if (!tavernReplyRunWatch) tavernReplyRunWatch = tavernWatchReplyRuns(sessions);
    return tavernReplyRunWatch;
}
function disposeTavernReplyRuns() {
    if (tavernReplyRunWatch) tavernReplyRunWatch.dispose();
    tavernReplyRunWatch = null;
}
