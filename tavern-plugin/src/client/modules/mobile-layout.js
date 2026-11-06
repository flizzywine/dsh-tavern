// 与 dsh-web-mobile 的抽屉断点一致；触屏笔记本不应仅因 coarse pointer 变成手机布局。
// 宿主的插槽使用 display:contents 包装；它不占空间，但仍参与 CSS / DOM 选择器匹配。
const TAVERN_HEADER_SELECTOR = '[data-slot="conversation.header"] > header, [data-phase] > header';
const TAVERN_MOBILE_QUERY = "(max-width: 1023px)";
function narrowLayout() { return typeof window.matchMedia === "function" && window.matchMedia(TAVERN_MOBILE_QUERY).matches; }

function installVisualViewportPin(doc) {
    const view = doc && doc.defaultView;
    if (!view || !doc.documentElement) return function () {};
    const html = doc.documentElement;
    const vv = view.visualViewport;
    const narrow = view.matchMedia(TAVERN_MOBILE_QUERY);
    const touch = view.matchMedia("(pointer: coarse)");
    const properties = ["--dsh-vv-top", "--dsh-vv-height", "--dsh-composer-offset", "--dsh-sheet-max", "--dsh-header-bottom", "--dsh-composer-left", "--dsh-composer-width"];
    const previous = properties.map(name => [name, html.style.getPropertyValue(name), html.style.getPropertyPriority(name)]);
    let frame = 0, disposed = false, seat = null, header = null;
    // classList.add/remove rewrite the class attribute even when nothing changes; that no-op mutation
    // re-ran document-wide observers (surface styles, quote colours) on every focus change.
    function removeClasses(...names) { const present = names.filter(name => html.classList.contains(name)); if (present.length) html.classList.remove(...present); }
    const observer = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(schedule) : null;
    function setPx(name, value) {
        const next = Math.max(0, Math.round(value)) + "px";
        // 上游移动插件也观察 style，避免每次流式更新触发无意义的全树协调。
        if (html.style.getPropertyValue(name) !== next) html.style.setProperty(name, next);
    }
    function restore() {
        for (const [name, value, priority] of previous) {
            if (value) html.style.setProperty(name, value, priority);
            else html.style.removeProperty(name);
        }
    }
    function rebind() {
        const nextSeat = doc.querySelector("[data-composer-seat]");
        const nextHeader = doc.querySelector(TAVERN_HEADER_SELECTOR);
        if (seat === nextSeat && header === nextHeader) return;
        observer?.disconnect();
        seat = nextSeat; header = nextHeader;
        for (const element of [seat, header]) if (element) observer?.observe(element);
        // A capped seat keeps its own box size while content grows, so watch its children too.
        if (seat) for (const child of seat.children) observer?.observe(child);
    }
    function sync() {
        frame = 0;
        if (disposed) return;
        html.classList.toggle("dsh-tavern-coarse-play", narrow.matches);
        if (!narrow.matches && !touch.matches) {
            removeClasses("dsh-tavern-viewport-pinned", "dsh-tavern-short-viewport", "dsh-tavern-seat-scroll");
            restore();
            return;
        }
        // 双指缩放时保留原布局供用户平移查看；不能把缩放误判成软键盘。
        if (vv && Math.abs(vv.scale - 1) > 0.02) return;
        rebind();
        const height = vv ? vv.height : view.innerHeight;
        const top = vv ? vv.offsetTop : 0;
        if (!(height > 0)) return;
        setPx("--dsh-vv-top", top);
        setPx("--dsh-vv-height", height);
        html.classList.toggle("dsh-tavern-viewport-pinned", true);
        // 整个外壳使用可视区高度，输入条仍贴外壳底部，避免重复叠加键盘补偿。
        const headerBottom = header ? header.getBoundingClientRect().bottom - top : 44;
        setPx("--dsh-header-bottom", headerBottom);
        // 横屏键盘下优先保留编辑和发送；展开列表改为可关闭的覆盖层。
        html.classList.toggle("dsh-tavern-short-viewport", height - headerBottom < 280);
        const pin = seat || doc.querySelector("[data-composer-card]");
        if (pin) {
            const rectTop = pin.getBoundingClientRect().top;
            const card = doc.querySelector('[data-composer-card]') || pin;
            const bounds = card.getBoundingClientRect();
            // 平板多栏布局中浮层只覆盖当前聊天列，不跨过左右侧栏。
            setPx("--dsh-composer-left", bounds.left);
            setPx("--dsh-composer-width", bounds.width);
            setPx("--dsh-composer-offset", composerOffsetPx(view.innerHeight, top, rectTop));
            setPx("--dsh-sheet-max", sheetMaxPx(height, rectTop - top, headerBottom));
        } else {
            html.style.removeProperty("--dsh-composer-offset");
            html.style.removeProperty("--dsh-sheet-max");
            html.style.removeProperty("--dsh-composer-left");
            html.style.removeProperty("--dsh-composer-width");
        }
        // Only scroll the seat when its content really exceeds the cap: a scrolling seat clips
        // every menu that opens upward from the composer (更多, access mode, model picker).
        html.classList.toggle("dsh-tavern-seat-scroll", Boolean(seat && seat.scrollHeight > seat.clientHeight + 1));
    }

    function schedule() {
        if (!disposed && !frame) frame = view.requestAnimationFrame(sync);
    }
    // 会话切换会替换 seat；只在结构锚点变化时重新测量，不遍历流式正文。
    const mutations = typeof view.MutationObserver === "function" && doc.body ? new view.MutationObserver(records => {
        if (!narrow.matches && !touch.matches) return;
        if ((seat && !seat.isConnected) || (header && !header.isConnected) || records.some(record =>
            Array.from(record.addedNodes).some(node => node.nodeType === 1 &&
                (node.matches('[data-composer-seat], header') || node.querySelector('[data-composer-seat], ' + TAVERN_HEADER_SELECTOR))))) schedule();
    }) : null;
    mutations?.observe(doc.body, { childList: true, subtree: true });
    for (const name of ["resize", "orientationchange", "pageshow"]) view.addEventListener(name, schedule);
    for (const name of ["focusin", "focusout"]) doc.addEventListener(name, schedule);
    // 原生全屏切换可能只改变安全区样式，不触发窗口 resize；及时重算顶栏与浮层锚点。
    for (const name of ["fullscreenchange", "webkitfullscreenchange"]) doc.addEventListener(name, schedule);
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    narrow.addEventListener("change", schedule);
    touch.addEventListener("change", schedule);
    sync();
    return function () {
        disposed = true;
        if (frame) view.cancelAnimationFrame(frame);
        observer?.disconnect();
        mutations?.disconnect();
        for (const name of ["resize", "orientationchange", "pageshow"]) view.removeEventListener(name, schedule);
        for (const name of ["focusin", "focusout"]) doc.removeEventListener(name, schedule);
        for (const name of ["fullscreenchange", "webkitfullscreenchange"]) doc.removeEventListener(name, schedule);
        vv?.removeEventListener("resize", schedule);
        vv?.removeEventListener("scroll", schedule);
        narrow.removeEventListener("change", schedule);
        touch.removeEventListener("change", schedule);
        html.classList.remove("dsh-tavern-coarse-play", "dsh-tavern-viewport-pinned", "dsh-tavern-short-viewport", "dsh-tavern-seat-scroll");
        restore();
    };
}
