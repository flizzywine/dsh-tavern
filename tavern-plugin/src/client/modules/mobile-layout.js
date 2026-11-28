// 与 dsh-web-mobile 的抽屉断点一致；触屏笔记本不应仅因 coarse pointer 变成手机布局。
// 宿主的插槽使用 display:contents 包装；它不占空间，但仍参与 CSS / DOM 选择器匹配。
const TAVERN_HEADER_SELECTOR = '[data-slot="conversation.header"] > header, [data-phase] > header';
const TAVERN_MOBILE_QUERY = "(max-width: 1023px)";
function narrowLayout() { return typeof window.matchMedia === "function" && window.matchMedia(TAVERN_MOBILE_QUERY).matches; }
// 布局视口与可视区之间差这么多就算键盘已经把页面顶上去；小于它只是取整或宿主安全区误差。
const TAVERN_KEYBOARD_INSET_MIN = 8;
// 焦点进出后自己刷这么多毫秒的帧：安卓输入法动画约 250ms，留出首尾事件的余量。
const TAVERN_KEYBOARD_SETTLE_MS = 450;
// 移动端输入框单行→多行切换的回滞余量（px）：展开变宽后，文字须明显短于单行窄列宽度才收起，避免临界字数来回抖动。
const TAVERN_MOBILE_COMPOSER_HYSTERESIS_PX = 20;
const TAVERN_MOBILE_COMPOSER_INPUT_SELECTOR = '[data-composer-input], [contenteditable="true"], textarea';
const TAVERN_MOBILE_COMPOSER_SCROLL_SELECTOR = '[data-input-scroll], [class*="_scroll"]';
const TAVERN_MOBILE_COMPOSER_BLOCK_TAGS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"]);

function inspectComposerDraft(input) {
    if (!input) return { isEmpty: true, explicitMulti: false, text: "", isTextarea: false };
    const tag = String(input.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") {
        const raw = String(input.value || "").replace(/\r\n?/g, "\n");
        const stripped = raw.replace(/[\u200B\uFEFF]/g, "");
        const explicitMulti = stripped.includes("\n");
        const isEmpty = !explicitMulti && stripped.trim().length === 0;
        return { isEmpty, explicitMulti, text: stripped, isTextarea: true };
    }
    const raw = String(input.textContent || "").replace(/\r\n?/g, "\n");
    const stripped = raw.replace(/[\u200B\uFEFF]/g, "");
    let blockCount = 0;
    const children = input.children;
    if (children) {
        for (let i = 0; i < children.length; i += 1) {
            if (TAVERN_MOBILE_COMPOSER_BLOCK_TAGS.has(String(children[i].tagName || "").toUpperCase())) blockCount += 1;
        }
    }
    let hasExplicitBreak = false;
    if (typeof input.querySelectorAll === "function") {
        const brs = input.querySelectorAll("br");
        if (brs.length >= 2) {
            hasExplicitBreak = true;
        } else if (brs.length === 1) {
            const br = brs[0];
            const isTrailingSentinel = br.classList && br.classList.contains("ProseMirror-trailingBreak");
            const hasNextSibling = Boolean(br.nextSibling && String(br.nextSibling.textContent || "").replace(/[\u200B\uFEFF]/g, "").length > 0);
            if (!isTrailingSentinel && hasNextSibling) hasExplicitBreak = true;
        }
    }
    const explicitMulti = blockCount >= 2 || hasExplicitBreak || stripped.replace(/\n+$/, "").includes("\n");
    const isEmpty = !explicitMulti && stripped.replace(/\u00A0/g, " ").trim().length === 0 && blockCount <= 1;
    return { isEmpty, explicitMulti, text: stripped, isTextarea: false };
}

function measureContentEditableTextBounds(doc, input) {
    if (!doc || typeof doc.createTreeWalker !== "function" || typeof doc.createRange !== "function") return null;
    const showText = (doc.defaultView && doc.defaultView.NodeFilter ? doc.defaultView.NodeFilter.SHOW_TEXT : 4);
    const walker = doc.createTreeWalker(input, showText);
    let firstNode = null, lastNode = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (String(node.nodeValue || "").replace(/[\u200B\uFEFF]/g, "").length === 0) continue;
        if (!firstNode) firstNode = node;
        lastNode = node;
    }
    if (!firstNode || !lastNode) return null;
    const range = doc.createRange();
    range.setStart(firstNode, 0);
    range.setEnd(lastNode, lastNode.nodeValue.length);
    const rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
    if (rects && rects.length > 0) {
        let minTop = Infinity, maxBottom = -Infinity, minLeft = Infinity, maxRight = -Infinity, count = 0;
        for (let i = 0; i < rects.length; i += 1) {
            const r = rects[i];
            if (!(r.width > 0 || r.height > 0)) continue;
            if (r.top < minTop) minTop = r.top;
            if (r.bottom > maxBottom) maxBottom = r.bottom;
            if (r.left < minLeft) minLeft = r.left;
            if (r.right > maxRight) maxRight = r.right;
            count += 1;
        }
        if (count > 0) return { width: Math.max(0, maxRight - minLeft), height: Math.max(0, maxBottom - minTop) };
    }
    const rect = range.getBoundingClientRect();
    return rect && (rect.width > 0 || rect.height > 0) ? { width: rect.width, height: rect.height } : null;
}

function measurePlainTextWidth(doc, text, style, fontSize) {
    if (!text) return 0;
    try {
        const canvas = doc && typeof doc.createElement === "function" ? doc.createElement("canvas") : null;
        const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
        if (ctx) {
            ctx.font = (style && style.font) || `${(style && style.fontWeight) || "400"} ${fontSize}px ${(style && style.fontFamily) || "sans-serif"}`;
            return ctx.measureText(text).width;
        }
    } catch (_) {}
    return text.length * fontSize;
}

function estimateCompactTextWidth(card, padX) {
    if (!card || typeof card.getBoundingClientRect !== "function" || typeof card.querySelector !== "function") return 0;
    const cardRect = card.getBoundingClientRect();
    if (!(cardRect.width > 0)) return 0;
    const tools = card.querySelector('[class*="_tools"]');
    const trailing = card.querySelector('[class*="_trailing"]');
    const toolsW = tools && typeof tools.getBoundingClientRect === "function" ? tools.getBoundingClientRect().width : 0;
    const trailingW = trailing && typeof trailing.getBoundingClientRect === "function" ? trailing.getBoundingClientRect().width : 0;
    // 扣除左右工具列、卡片水平内边距（10px）、列间距（4px）及输入内边距。
    return Math.max(48, cardRect.width - toolsW - trailingW - 14 - padX);
}

function createComposerMultilineController(doc, view, options) {
    const onLayoutChange = options && typeof options.onLayoutChange === "function" ? options.onLayoutChange : function () {};
    let active = false, card = null, input = null, scrollEl = null, disposed = false, evalFrame = 0;
    let multiline = false, scrollable = false;
    let compactTextWidth = 0, compactCardWidth = 0;

    function setAttr(el, name, on) {
        if (!el || typeof el.setAttribute !== "function" || typeof el.removeAttribute !== "function") return false;
        const had = typeof el.getAttribute === "function" ? el.getAttribute(name) === "true" : false;
        const next = Boolean(on);
        if (had === next) return false;
        if (next) el.setAttribute(name, "true");
        else el.removeAttribute(name);
        return true;
    }

    function clearCardState(targetCard) {
        const changedA = setAttr(targetCard, "data-mobile-multiline", false);
        const changedB = setAttr(targetCard, "data-mobile-input-scrollable", false);
        multiline = false;
        scrollable = false;
        return changedA || changedB;
    }

    function findInput(targetCard) {
        if (!targetCard || typeof targetCard.querySelector !== "function") return null;
        return targetCard.querySelector(TAVERN_MOBILE_COMPOSER_INPUT_SELECTOR);
    }

    function findScroll(targetCard) {
        if (!targetCard || typeof targetCard.querySelector !== "function") return null;
        return targetCard.querySelector(TAVERN_MOBILE_COMPOSER_SCROLL_SELECTOR);
    }

    const inputMutations = typeof view.MutationObserver === "function" ? new view.MutationObserver(function () {
        scheduleEval();
    }) : null;
    const inputResize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(function () {
        scheduleEval();
    }) : null;

    function onInputEvent() {
        scheduleEval();
    }

    function detach() {
        inputMutations?.disconnect();
        inputResize?.disconnect();
        if (card && typeof card.removeEventListener === "function") {
            card.removeEventListener("input", onInputEvent, true);
            card.removeEventListener("compositionend", onInputEvent, true);
        }
        input = null;
        scrollEl = null;
    }

    function attach(nextCard) {
        detach();
        card = nextCard && typeof nextCard.querySelector === "function" ? nextCard : null;
        compactTextWidth = 0;
        compactCardWidth = 0;
        multiline = Boolean(card && typeof card.getAttribute === "function" && card.getAttribute("data-mobile-multiline") === "true");
        scrollable = Boolean(card && typeof card.getAttribute === "function" && card.getAttribute("data-mobile-input-scrollable") === "true");
        if (!card) return;
        input = findInput(card);
        scrollEl = findScroll(card);
        if (typeof card.addEventListener === "function") {
            card.addEventListener("input", onInputEvent, true);
            card.addEventListener("compositionend", onInputEvent, true);
        }
        if (input) {
            inputMutations?.observe(input, { childList: true, subtree: true, characterData: true });
            inputResize?.observe(input);
        }
        if (scrollEl && scrollEl !== input) inputResize?.observe(scrollEl);
        if (active) scheduleEval();
    }

    function evaluate() {
        evalFrame = 0;
        if (disposed || !card) return;
        if (!active) {
            if (clearCardState(card)) onLayoutChange();
            return;
        }
        // 宿主重建内部编辑器节点时重新挂载监听。
        if (!input || !input.isConnected) {
            const nextInput = findInput(card);
            const nextScroll = findScroll(card);
            if (nextInput !== input || nextScroll !== scrollEl) {
                inputMutations?.disconnect();
                inputResize?.disconnect();
                input = nextInput;
                scrollEl = nextScroll;
                if (input) {
                    inputMutations?.observe(input, { childList: true, subtree: true, characterData: true });
                    inputResize?.observe(input);
                }
                if (scrollEl && scrollEl !== input) inputResize?.observe(scrollEl);
            }
        }
        if (!input) {
            if (clearCardState(card)) onLayoutChange();
            return;
        }
        const draft = inspectComposerDraft(input);
        if (draft.isEmpty) {
            if (!multiline && typeof input.clientWidth === "number" && input.clientWidth > 0) {
                const st = typeof view.getComputedStyle === "function" ? view.getComputedStyle(input) : null;
                const padX = (parseFloat(st && st.paddingLeft) || 0) + (parseFloat(st && st.paddingRight) || 0);
                compactTextWidth = Math.max(48, input.clientWidth - padX);
                compactCardWidth = typeof card.getBoundingClientRect === "function" ? card.getBoundingClientRect().width : 0;
            }
            if (clearCardState(card)) onLayoutChange();
            return;
        }

        const style = typeof view.getComputedStyle === "function" ? view.getComputedStyle(input) : null;
        const fontSize = parseFloat(style && style.fontSize) || 16;
        const parsedLine = parseFloat(style && style.lineHeight);
        const lineHeight = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : fontSize * 1.5;
        const padTop = parseFloat(style && style.paddingTop) || 0;
        const padBottom = parseFloat(style && style.paddingBottom) || 0;
        const padLeft = parseFloat(style && style.paddingLeft) || 0;
        const padRight = parseFloat(style && style.paddingRight) || 0;
        const padX = padLeft + padRight;
        const singleLineBoxH = lineHeight + padTop + padBottom;
        const wrapHeightLimit = singleLineBoxH + lineHeight * 0.45;
        const textBounds = draft.isTextarea ? null : measureContentEditableTextBounds(doc, input);
        const scrollHeight = Number(input.scrollHeight) || 0;
        const clientHeight = Number(input.clientHeight) || 0;
        const scrollWidth = Number(input.scrollWidth) || 0;
        const clientWidth = Number(input.clientWidth) || 0;
        const wrappedByBounds = Boolean(textBounds && textBounds.height > lineHeight * 1.45);
        const wrappedByScroll = scrollHeight > wrapHeightLimit || (draft.isTextarea && clientHeight > 0 && scrollHeight > clientHeight + 2);
        const overflowedHorizontal = clientWidth > 0 && scrollWidth > clientWidth + 2;

        let nextMultiline = multiline;
        if (!multiline) {
            if (clientWidth > 0) {
                compactTextWidth = Math.max(48, clientWidth - padX);
                compactCardWidth = typeof card.getBoundingClientRect === "function" ? card.getBoundingClientRect().width : 0;
            }
            if (draft.explicitMulti || wrappedByBounds || wrappedByScroll || overflowedHorizontal) {
                nextMultiline = true;
            }
        } else {
            if (draft.explicitMulti || wrappedByBounds || wrappedByScroll) {
                nextMultiline = true;
            } else {
                const currentCardW = typeof card.getBoundingClientRect === "function" ? card.getBoundingClientRect().width : 0;
                let refCompactW = compactTextWidth;
                if (!(refCompactW > 0) || (currentCardW > 0 && compactCardWidth > 0 && Math.abs(currentCardW - compactCardWidth) > 12)) {
                    refCompactW = estimateCompactTextWidth(card, padX);
                }
                const singleLineTextW = textBounds ? textBounds.width : measurePlainTextWidth(doc, draft.text.trim(), style, fontSize);
                const collapseLimit = Math.max(32, refCompactW - TAVERN_MOBILE_COMPOSER_HYSTERESIS_PX);
                if (refCompactW > 0 && singleLineTextW > 0 && singleLineTextW <= collapseLimit) {
                    nextMultiline = false;
                }
            }
        }

        const multilineChanged = setAttr(card, "data-mobile-multiline", nextMultiline);
        multiline = nextMultiline;

        // 仅在已处于展开态且本帧未刚切态时直接测滚动溢出；刚切态时排下一帧，避免写后立即强同步布局。
        if (!multiline) {
            const scrollChanged = setAttr(card, "data-mobile-input-scrollable", false);
            scrollable = false;
            if (multilineChanged || scrollChanged) onLayoutChange();
        } else if (multilineChanged) {
            onLayoutChange();
            scheduleEval();
        } else {
            const scrollTarget = scrollEl || input;
            const nextScrollable = Boolean(
                (scrollTarget && scrollTarget.scrollHeight > scrollTarget.clientHeight + 2) ||
                (draft.isTextarea && input.scrollHeight > input.clientHeight + 2)
            );
            const scrollChanged = setAttr(card, "data-mobile-input-scrollable", nextScrollable);
            scrollable = nextScrollable;
            if (scrollChanged) onLayoutChange();
        }
    }

    function scheduleEval() {
        if (disposed || evalFrame) return;
        evalFrame = view.requestAnimationFrame(evaluate);
    }

    return {
        bind(nextCard) {
            const resolved = nextCard && typeof nextCard.querySelector === "function" ? nextCard : null;
            if (resolved === card) return;
            if (card) clearCardState(card);
            attach(resolved);
        },
        setActive(nextActive) {
            const on = Boolean(nextActive);
            if (active === on) return;
            active = on;
            if (!active) {
                if (card && clearCardState(card)) onLayoutChange();
            } else if (card) {
                scheduleEval();
            }
        },
        dispose() {
            disposed = true;
            if (evalFrame) view.cancelAnimationFrame(evalFrame);
            if (card) clearCardState(card);
            detach();
            card = null;
        }
    };
}

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
    const properties = ["--dsh-vv-top", "--dsh-vv-height", "--dsh-shell-height", "--dsh-keyboard-inset", "--dsh-composer-offset", "--dsh-sheet-max", "--dsh-header-bottom", "--dsh-composer-left", "--dsh-composer-width", "--dsh-sheet-left", "--dsh-sheet-right"];
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
    const composerMultiline = createComposerMultilineController(doc, view, {
        onLayoutChange: function () {
            boxDirty = true;
            schedule();
        }
    });
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
        for (const element of [seat, card, header]) if (element) observer?.observe(element);
        // A capped seat keeps its own box size while content grows, so watch its children too.
        if (seat && seat.children) for (const child of seat.children) observer?.observe(child);
        composerMultiline.bind(card);
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
            composerMultiline.setActive(false);
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
        composerMultiline.setActive(narrow.matches);
        const height = vv ? vv.height : view.innerHeight;
        const top = vv ? vv.offsetTop : 0;
        if (!(height > 0)) return;
        // 先一次性批量读完所有几何属性，再统一写 CSS 变量与类名：
        // 若先写 <html> 自定义属性再读 getBoundingClientRect()，会触发整棵 DOM 树的强制同步布局。
        const headerBottom = header ? header.getBoundingClientRect().bottom - top : 44;
        const pin = seat || card;
        const pinRect = pin ? pin.getBoundingClientRect() : null;
        const rectTop = pinRect ? pinRect.top : 0;
        const activeCard = card || pin;
        const bounds = activeCard ? (activeCard === pin ? pinRect : activeCard.getBoundingClientRect()) : null;
        const seatScroll = Boolean(seat && seat.scrollHeight > seat.clientHeight + 1);
        const viewportWidth = Number(doc.documentElement.clientWidth) || Number(view.innerWidth) || 0;
        // 外壳高度：布局视口已被顶上去就 100%，键盘浮在页面上才用可视区像素。
        const shell = tavernShellHeight(view.innerHeight, height);
        // 外壳真占多高：100% 时由布局视口决定，否则就是脚本算出来的那一段。
        const shellHeight = shell && shell !== "100%" ? parseFloat(shell) : view.innerHeight || height;
        // 剩下的差额交给输入条自己垫：键盘压住多少就抬多少，外壳不用再动。
        const keyboardInset = keyboardPadPx(keyboard, shellHeight);
        const visible = Math.max(0, shellHeight - keyboardInset);
        toggleClass("dsh-tavern-viewport-pinned", true);
        setValue("--dsh-shell-height", shell || "100%");
        setPx("--dsh-keyboard-inset", keyboardInset);
        // 外壳高度已经按布局视口算的时候，可视区偏移由页面自己负责，不能再叠一次。
        setPx("--dsh-vv-top", shell === "100%" ? 0 : top);
        setPx("--dsh-vv-height", visible);
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
            // 窄/中栏贴聊天列（留 8px 边距，不跨左右侧栏且不被大内边距皮肤压窄）；
            // 宽单栏（输入卡因 max-width 居中留白超过 96px）对齐输入卡宽度，避免抽屉横铺整屏。
            const anchor = pinRect && bounds.width > 0 && pinRect.width - bounds.width > 96 ? bounds : (pinRect || bounds);
            const anchorRight = Number.isFinite(anchor.right) ? anchor.right : anchor.left + anchor.width;
            const sheetLeft = Math.max(8, Math.round(anchor.left) + 8);
            const sheetRight = viewportWidth > 0 ? Math.max(8, Math.round(viewportWidth - anchorRight) + 8) : -1;
            if (viewportWidth > 0 && anchor.width > 32 && sheetLeft + sheetRight < viewportWidth - 64) {
                setPx("--dsh-sheet-left", sheetLeft);
                setPx("--dsh-sheet-right", sheetRight);
            } else {
                html.style.removeProperty("--dsh-sheet-left");
                html.style.removeProperty("--dsh-sheet-right");
            }
        } else {
            html.style.removeProperty("--dsh-composer-offset");
            html.style.removeProperty("--dsh-sheet-max");
            html.style.removeProperty("--dsh-composer-left");
            html.style.removeProperty("--dsh-composer-width");
            html.style.removeProperty("--dsh-sheet-left");
            html.style.removeProperty("--dsh-sheet-right");
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
    // window.resize 与 visualViewport.resize 常在同一帧连续到达：几何已同步过时不再重复
    // 执行全量 sync()，仅续期跟随窗口，避免单帧双倍测量与样式写入。
    function onViewportChange() {
        if (snapshotChanged()) sync();
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
    // 流式生成每帧都会往气泡里塞文本和行内节点：先按最便宜的条件出局，再只对
    // 「含元素子树的新增节点」做锚点扫描，锚点已经失效时直接交给 rebind() 的实时查询。
    const TAVERN_SHELL_ANCHORS = '[data-composer-seat], [data-composer-card], header';
    function anchorsIntroduced(records) {
        for (let index = 0; index < records.length; index += 1) {
            const added = records[index].addedNodes;
            for (let node = 0; node < added.length; node += 1) {
                const item = added[node];
                // 文本/注释节点不可能是锚点，流式正文的绝大多数新增都属于这一类。
                if (!item || item.nodeType !== 1) continue;
                if (item.matches('[data-composer-seat], [data-composer-card], header')) return true;
                // 行内排版节点没有元素子树，querySelector 必然落空。
                if (!item.childElementCount) continue;
                if (item.querySelector(TAVERN_SHELL_ANCHORS)) return true;
            }
        }
        return false;
    }
    const mutations = typeof view.MutationObserver === "function" && doc.body ? new view.MutationObserver(records => {
        if (!narrow.matches && !touch.matches) return;
        // 已经排了一帧测量：rebind() 读的是实时 DOM，不需要再扫这批变更。
        if (frame) return;
        if ((seat && !seat.isConnected) || (card && !card.isConnected) || (header && !header.isConnected) || anchorsIntroduced(records)) markDirtyAndSchedule();
    }) : null;
    mutations?.observe(doc.body, { childList: true, subtree: true });
    view.addEventListener("resize", onViewportChange);
    for (const name of ["orientationchange", "pageshow"]) view.addEventListener(name, immediate);
    for (const name of ["focusin", "focusout"]) doc.addEventListener(name, onFocusChange);
    // 原生全屏切换可能只改变安全区样式，不触发窗口 resize；及时重算顶栏与浮层锚点。
    for (const name of ["fullscreenchange", "webkitfullscreenchange"]) doc.addEventListener(name, markDirtyAndSchedule);
    // 键盘事件只有 resize/scroll 两个来源，必须在处理函数里当场改样式，再延后一帧就是肉眼可见的错位。
    vv?.addEventListener("resize", onViewportChange);
    vv?.addEventListener("scroll", onViewportScroll);
    // 输入法自己的几何事件：键盘动画期间每帧都会来，比等可视化视口可靠。
    if (keyboard && typeof keyboard.addEventListener === "function") keyboard.addEventListener("geometrychange", onViewportChange);
    narrow.addEventListener("change", markDirtyAndSchedule);
    touch.addEventListener("change", markDirtyAndSchedule);
    sync();
    return function () {
        disposed = true;
        if (frame) view.cancelAnimationFrame(frame);
        if (chaseFrame) view.cancelAnimationFrame(chaseFrame);
        composerMultiline.dispose();
        observer?.disconnect();
        mutations?.disconnect();
        view.removeEventListener("resize", onViewportChange);
        for (const name of ["orientationchange", "pageshow"]) view.removeEventListener(name, immediate);
        for (const name of ["focusin", "focusout"]) doc.removeEventListener(name, onFocusChange);
        for (const name of ["fullscreenchange", "webkitfullscreenchange"]) doc.removeEventListener(name, markDirtyAndSchedule);
        vv?.removeEventListener("resize", onViewportChange);
        vv?.removeEventListener("scroll", onViewportScroll);
        if (keyboard && typeof keyboard.removeEventListener === "function") keyboard.removeEventListener("geometrychange", onViewportChange);
        narrow.removeEventListener("change", markDirtyAndSchedule);
        touch.removeEventListener("change", markDirtyAndSchedule);
        html.classList.remove("dsh-tavern-coarse-play", "dsh-tavern-viewport-pinned", "dsh-tavern-short-viewport", "dsh-tavern-seat-scroll");
        restore();
        holdScale(false);
    };
}
