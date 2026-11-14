// 与 dsh-web-mobile 的抽屉断点一致；触屏笔记本不应仅因 coarse pointer 变成手机布局。
// 宿主的插槽使用 display:contents 包装；它不占空间，但仍参与 CSS / DOM 选择器匹配。
const TAVERN_HEADER_SELECTOR = '[data-slot="conversation.header"] > header, [data-phase] > header';
const TAVERN_MOBILE_QUERY = "(max-width: 1023px)";
function narrowLayout() { return typeof window.matchMedia === "function" && window.matchMedia(TAVERN_MOBILE_QUERY).matches; }
// 布局视口与可视区之间差这么多就算键盘已经把页面顶上去；小于它只是取整或宿主安全区误差。
const TAVERN_KEYBOARD_INSET_MIN = 8;
// 焦点进出后自己刷这么多毫秒的帧：安卓输入法动画约 250ms，留出首尾事件的余量。
const TAVERN_KEYBOARD_SETTLE_MS = 450;

// 键盘和页面必须同一帧动。安卓上 visualViewport 的 resize 要等输入法动画收尾才来，
// 只按它锁像素就会出现「输入法先弹，页面过一会才上移」，事件漏一次还会彻底不动。
// 所以先看布局视口本身有没有变短：变短说明原生窗口或父级 iframe 已经跟着键盘缩了，
// 外壳直接 100% 跟随重排就是同帧的；只有键盘浮在页面之上（Chrome 的 resizes-visual）
// 才退回 visualViewport 像素锁高，否则输入条会被键盘盖住。
function tavernShellHeight(layoutHeight, visualHeight) {
    const layout = Number(layoutHeight) || 0;
    if (!(layout > 0)) return null;
    const visual = Math.min(Number(visualHeight) > 0 ? Number(visualHeight) : layout, layout);
    if (Math.round(layout - visual) < TAVERN_KEYBOARD_INSET_MIN) return "100%";
    return Math.round(visual) + "px";
}

// 输入法压住外壳底部的那一截（CSS px），直接给输入条垫底。
// 只有输入法自己的矩形知道它压到哪：布局视口和可视化视口都能缩到键盘上方，
// 却都量不到键盘还盖着页面多少 —— 那一段的输入框下半截就是这么丢的。
// boundingRect 在不同内核里的坐标系说法不一（有报告给过对不上任何已知原点的值），
// 只认「压在底部那一截」：上沿落在可视区下半段，垫高不超过输入法自身高度。
// 量级不对就是坐标系不认识，宁可垫 0 —— 垫多了会把输入条顶到屏幕中间。
function keyboardPadPx(keyboard, shellHeight) {
    const rect = keyboard && keyboard.boundingRect;
    if (!rect) return 0;
    const shell = Number(shellHeight) || 0;
    const top = Number(rect.top);
    const height = Number(rect.height);
    if (!(shell > 0) || !Number.isFinite(top) || !(height > 0)) return 0;
    if (top < shell * 0.5) return 0;
    return Math.round(Math.max(0, Math.min(shell - top, height)));
}

function installVisualViewportPin(doc) {
    const view = doc && doc.defaultView;
    if (!view || !doc.documentElement) return function () {};
    const html = doc.documentElement;
    const vv = view.visualViewport;
    const keyboard = view.navigator && view.navigator.virtualKeyboard;
    const narrow = view.matchMedia(TAVERN_MOBILE_QUERY);
    const touch = view.matchMedia("(pointer: coarse)");
    const properties = ["--dsh-vv-top", "--dsh-vv-height", "--dsh-shell-height", "--dsh-keyboard-inset", "--dsh-composer-offset", "--dsh-sheet-max", "--dsh-header-bottom", "--dsh-composer-left", "--dsh-composer-width"];
    const previous = properties.map(name => [name, html.style.getPropertyValue(name), html.style.getPropertyPriority(name)]);
    let frame = 0, chaseFrame = 0, chaseUntil = 0, disposed = false, seat = null, card = null, header = null, boxDirty = true;
    let lastInnerH = -1, lastInnerW = -1, lastVvH = -1, lastVvTop = -1, lastKbTop = -1, lastKbH = -1;
    // Anything wider than the screen lets a phone browser zoom the page out to fit it: the layout viewport grows past
    // 100vw, so every overlay sized to the screen (stage CONFIG art, the phone, sheets) leaves a strip on the right.
    // A phone layout never wants that zoom-out; pinch zoom in stays.
    const viewportMeta = doc.querySelector('meta[name="viewport"]');
    const viewportContent = viewportMeta ? viewportMeta.getAttribute("content") || "" : "";
    const heldContent = /minimum-scale/.test(viewportContent) ? viewportContent : (viewportContent ? viewportContent + ", " : "") + "minimum-scale=1";
    function holdScale(on) {
        const next = on ? heldContent : viewportContent;
        if (viewportMeta && viewportMeta.getAttribute("content") !== next) viewportMeta.setAttribute("content", next);
    }
    // classList.add/remove rewrite the class attribute even when nothing changes; that no-op mutation
    // re-ran document-wide observers (surface styles, quote colours) on every focus change.
    function removeClasses(...names) { const present = names.filter(name => html.classList.contains(name)); if (present.length) html.classList.remove(...present); }
    function toggleClass(name, on) { const next = Boolean(on); if (html.classList.contains(name) !== next) html.classList.toggle(name, next); }
    const observer = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(function () { boxDirty = true; schedule(); }) : null;
    function setPx(name, value) {
        const next = Math.max(0, Math.round(value)) + "px";
        // 上游移动插件也观察 style，避免每次流式更新触发无意义的全树协调。
        if (html.style.getPropertyValue(name) !== next) html.style.setProperty(name, next);
    }
    function setValue(name, value) {
        if (html.style.getPropertyValue(name) !== value) html.style.setProperty(name, value);
    }
    function restore() {
        for (const [name, value, priority] of previous) {
            if (value) html.style.setProperty(name, value, priority);
            else html.style.removeProperty(name);
        }
    }
    function rebind() {
        const nextSeat = doc.querySelector("[data-composer-seat]");
        const nextCard = doc.querySelector("[data-composer-card]");
        const nextHeader = doc.querySelector(TAVERN_HEADER_SELECTOR);
        if (seat === nextSeat && card === nextCard && header === nextHeader) return;
        boxDirty = true;
        observer?.disconnect();
        seat = nextSeat; card = nextCard; header = nextHeader;
        for (const element of [seat, header]) if (element) observer?.observe(element);
        // A capped seat keeps its own box size while content grows, so watch its children too.
        if (seat && seat.children) for (const child of seat.children) observer?.observe(child);
    }
    function snapshotChanged() {
        const innerH = Number(view.innerHeight) || 0;
        const innerW = Number(view.innerWidth) || 0;
        const vvH = vv ? Number(vv.height) || 0 : innerH;
        const vvTop = vv ? Number(vv.offsetTop) || 0 : 0;
        const rect = keyboard && keyboard.boundingRect;
        const kbTop = rect && Number.isFinite(Number(rect.top)) ? Number(rect.top) : -1;
        const kbH = rect && Number.isFinite(Number(rect.height)) ? Number(rect.height) : 0;
        return boxDirty || innerH !== lastInnerH || innerW !== lastInnerW || vvH !== lastVvH || vvTop !== lastVvTop || kbTop !== lastKbTop || kbH !== lastKbH;
    }
    function recordSnapshot() {
        const innerH = Number(view.innerHeight) || 0;
        lastInnerH = innerH;
        lastInnerW = Number(view.innerWidth) || 0;
        lastVvH = vv ? Number(vv.height) || 0 : innerH;
        lastVvTop = vv ? Number(vv.offsetTop) || 0 : 0;
        const rect = keyboard && keyboard.boundingRect;
        lastKbTop = rect && Number.isFinite(Number(rect.top)) ? Number(rect.top) : -1;
        lastKbH = rect && Number.isFinite(Number(rect.height)) ? Number(rect.height) : 0;
        boxDirty = false;
    }
    function sync() {
        frame = 0;
        if (disposed) return;
        toggleClass("dsh-tavern-coarse-play", narrow.matches);
        if (!narrow.matches && !touch.matches) {
            removeClasses("dsh-tavern-viewport-pinned", "dsh-tavern-short-viewport", "dsh-tavern-seat-scroll");
            restore();
            holdScale(false);
            recordSnapshot();
            return;
        }
        holdScale(true);
        // 双指缩放时保留原布局供用户平移查看；不能把缩放误判成软键盘。
        if (vv && Math.abs(vv.scale - 1) > 0.02) return;
        rebind();
        const height = vv ? vv.height : view.innerHeight;
        const top = vv ? vv.offsetTop : 0;
        if (!(height > 0)) return;
        toggleClass("dsh-tavern-viewport-pinned", true);
        // 外壳高度：布局视口已被顶上去就 100%，键盘浮在页面上才用可视区像素。
        const shell = tavernShellHeight(view.innerHeight, height);
        setValue("--dsh-shell-height", shell || "100%");
        // 外壳真占多高：100% 时由布局视口决定，否则就是脚本算出来的那一段。
        const shellHeight = shell && shell !== "100%" ? parseFloat(shell) : view.innerHeight || height;
        // 剩下的差额交给输入条自己垫：键盘压住多少就抬多少，外壳不用再动。
        const keyboardInset = keyboardPadPx(keyboard, shellHeight);
        setPx("--dsh-keyboard-inset", keyboardInset);
        const visible = Math.max(0, shellHeight - keyboardInset);
        // 外壳高度已经按布局视口算的时候，可视区偏移由页面自己负责，不能再叠一次。
        setPx("--dsh-vv-top", shell === "100%" ? 0 : top);
        setPx("--dsh-vv-height", visible);
        // 先一次性批量读完所有几何属性，再统一写 CSS 变量与类名，避免读-写-读交替导致单帧 3 次强制同步布局。
        const headerBottom = header ? header.getBoundingClientRect().bottom - top : 44;
        const pin = seat || card;
        const pinRect = pin ? pin.getBoundingClientRect() : null;
        const rectTop = pinRect ? pinRect.top : 0;
        const activeCard = card || pin;
        const bounds = activeCard ? (activeCard === pin ? pinRect : activeCard.getBoundingClientRect()) : null;
        const seatScroll = Boolean(seat && seat.scrollHeight > seat.clientHeight + 1);
        // 整个外壳使用可视区高度，输入条仍贴外壳底部，避免重复叠加键盘补偿。
        setPx("--dsh-header-bottom", headerBottom);
        // 横屏键盘下优先保留编辑和发送；展开列表改为可关闭的覆盖层。
        toggleClass("dsh-tavern-short-viewport", visible - headerBottom < 280);
        if (pin && bounds) {
            // 平板多栏布局中浮层只覆盖当前聊天列，不跨过左右侧栏。
            setPx("--dsh-composer-left", bounds.left);
            setPx("--dsh-composer-width", bounds.width);
            setPx("--dsh-composer-offset", composerOffsetPx(visible, top, rectTop));
            setPx("--dsh-sheet-max", sheetMaxPx(visible, rectTop - top, headerBottom));
        } else {
            html.style.removeProperty("--dsh-composer-offset");
            html.style.removeProperty("--dsh-sheet-max");
            html.style.removeProperty("--dsh-composer-left");
            html.style.removeProperty("--dsh-composer-width");
        }
        // Only scroll the seat when its content really exceeds the cap: a scrolling seat clips
        // every menu that opens upward from the composer (更多, access mode, model picker).
        toggleClass("dsh-tavern-seat-scroll", seatScroll);
        recordSnapshot();
    }

    function schedule() {
        if (!disposed && !frame) frame = view.requestAnimationFrame(sync);
    }
    // 输入法动画期间系统可能只在首尾各给一次事件：焦点进出后自己刷几帧，
    // 事件到了立刻跟上，事件漏了也能在下一帧把页面拉回正确高度。
    // 空转帧若视口/键盘几何与观测盒均未变化则跳过 DOM 测量，避免动画期间逐帧强制布局。
    function chase() {
        chaseFrame = 0;
        if (disposed) return;
        if (snapshotChanged()) sync();
        if (Date.now() < chaseUntil) chaseFrame = view.requestAnimationFrame(chase);
    }
    function chaseFor(ms) {
        if (disposed) return;
        chaseUntil = Math.max(chaseUntil, Date.now() + ms);
        if (!chaseFrame) chaseFrame = view.requestAnimationFrame(chase);
    }
    function immediate() {
        boxDirty = true;
        sync();
        chaseFor(TAVERN_KEYBOARD_SETTLE_MS);
    }
    // 只有可编辑输入控件进出焦点才会唤起或收起软键盘；普通按钮（如展开/收起侧栏、切换标签）
    // 触发的 focusin/focusout 不应启动 450ms 的逐帧同步布局轮询。
    function isKeyboardTarget(target) {
        if (!target) return true;
        if (target.nodeType !== 1) return false;
        if (target.isContentEditable) return true;
        const tag = String(target.tagName || "").toUpperCase();
        if (tag === "TEXTAREA" || tag === "SELECT") return true;
        if (tag === "INPUT") {
            const type = String(target.type || "text").toLowerCase();
            return !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/.test(type);
        }
        const ce = typeof target.getAttribute === "function" ? target.getAttribute("contenteditable") : null;
        return ce === "" || ce === "true" || ce === "plaintext-only";
    }
    function onFocusChange(event) {
        if (isKeyboardTarget(event && event.target)) immediate();
    }
    function onViewportScroll() {
        if (snapshotChanged()) sync();
        const layout = Number(view.innerHeight) || 0;
        const visual = vv && vv.height > 0 ? Number(vv.height) : layout;
        if (Math.round(layout - visual) >= TAVERN_KEYBOARD_INSET_MIN) chaseFor(TAVERN_KEYBOARD_SETTLE_MS);
    }
    function markDirtyAndSchedule() {
        boxDirty = true;
        schedule();
    }
    // 会话切换会替换 seat；只在结构锚点变化时重新测量，不遍历流式正文。
    const mutations = typeof view.MutationObserver === "function" && doc.body ? new view.MutationObserver(records => {
        if (!narrow.matches && !touch.matches) return;
        if ((seat && !seat.isConnected) || (card && !card.isConnected) || (header && !header.isConnected) || records.some(record =>
            Array.from(record.addedNodes).some(node => node.nodeType === 1 &&
                (node.matches('[data-composer-seat], [data-composer-card], header') || node.querySelector('[data-composer-seat], [data-composer-card], ' + TAVERN_HEADER_SELECTOR))))) markDirtyAndSchedule();
    }) : null;
    mutations?.observe(doc.body, { childList: true, subtree: true });
    for (const name of ["resize", "orientationchange", "pageshow"]) view.addEventListener(name, immediate);
    for (const name of ["focusin", "focusout"]) doc.addEventListener(name, onFocusChange);
    // 原生全屏切换可能只改变安全区样式，不触发窗口 resize；及时重算顶栏与浮层锚点。
    for (const name of ["fullscreenchange", "webkitfullscreenchange"]) doc.addEventListener(name, markDirtyAndSchedule);
    // 键盘事件只有 resize/scroll 两个来源，必须在处理函数里当场改样式，再延后一帧就是肉眼可见的错位。
    vv?.addEventListener("resize", immediate);
    vv?.addEventListener("scroll", onViewportScroll);
    // 输入法自己的几何事件：键盘动画期间每帧都会来，比等可视化视口可靠。
    if (keyboard && typeof keyboard.addEventListener === "function") keyboard.addEventListener("geometrychange", immediate);
    narrow.addEventListener("change", markDirtyAndSchedule);
    touch.addEventListener("change", markDirtyAndSchedule);
    sync();
    return function () {
        disposed = true;
        if (frame) view.cancelAnimationFrame(frame);
        if (chaseFrame) view.cancelAnimationFrame(chaseFrame);
        observer?.disconnect();
        mutations?.disconnect();
        for (const name of ["resize", "orientationchange", "pageshow"]) view.removeEventListener(name, immediate);
        for (const name of ["focusin", "focusout"]) doc.removeEventListener(name, onFocusChange);
        for (const name of ["fullscreenchange", "webkitfullscreenchange"]) doc.removeEventListener(name, markDirtyAndSchedule);
        vv?.removeEventListener("resize", immediate);
        vv?.removeEventListener("scroll", onViewportScroll);
        if (keyboard && typeof keyboard.removeEventListener === "function") keyboard.removeEventListener("geometrychange", immediate);
        narrow.removeEventListener("change", markDirtyAndSchedule);
        touch.removeEventListener("change", markDirtyAndSchedule);
        html.classList.remove("dsh-tavern-coarse-play", "dsh-tavern-viewport-pinned", "dsh-tavern-short-viewport", "dsh-tavern-seat-scroll");
        restore();
        holdScale(false);
    };
}
