// Owns header interaction state and releases its observers/listeners on unmount.
function createTavernHeaderFeature({ StatusAction, ExportAction, openPage, openWorldbooks }) {
        function tavernHeaderMenuButton(h, label, iconPath, disabled, onClick) {
            return h("button", { type: "button", role: "menuitem", disabled: disabled, onClick: onClick },
                h("svg", { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: iconPath })),
                label);
        }

        const TAVERN_HEADER_GEAR_PATH = "M12 15a3 3 0 1 0 0-6a3 3 0 1 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z";

        // Width the shortcuts may use, read from the whole title row so it does
        // not depend on how many buttons are folded right now: the row, minus the
        // host's own buttons, minus a minimum share kept for the session title.
        function tavernHeaderAvailableWidth(node) {
            const row = node.closest("[class*=\"_titleRow\"]");
            if (!row) return node.clientWidth;
            const px = value => parseFloat(value) || 0;
            const rowStyle = window.getComputedStyle(row);
            let free = row.clientWidth - px(rowStyle.paddingLeft) - px(rowStyle.paddingRight);
            const children = Array.from(row.children).filter(child => window.getComputedStyle(child).display !== "none");
            free -= px(rowStyle.columnGap) * Math.max(0, children.length - 1);
            for (const child of children) {
                const style = window.getComputedStyle(child);
                free -= px(style.marginLeft) + px(style.marginRight);
                if (child.contains(node)) { free -= Math.max(0, child.offsetWidth - node.offsetWidth); continue; }
                if (/_titleCluster/.test(String(child.className))) {
                    // Everything in the cluster except the crumbs stays; the crumbs keep a minimum.
                    const parts = Array.from(child.children).filter(part => window.getComputedStyle(part).display !== "none");
                    free -= px(style.columnGap) * Math.max(0, parts.length - 1);
                    for (const part of parts) if (!/_crumbs/.test(String(part.className))) free -= part.offsetWidth;
                    free -= Math.min(160, row.clientWidth * 0.3);
                    continue;
                }
                free -= child.offsetWidth;
            }
            return Math.max(0, free);
        }

        // The 顶栏设置 entry in the ⋯ and right-click menus: the settings page's own
        // editor in a dialog, so it works without a host route to the settings page.
        function TavernHeaderSettingsDialog(props) {
            const h = React.createElement;
            React.useEffect(function () {
                function key(event) { if (event.key === "Escape") props.onClose(); }
                document.addEventListener("keydown", key);
                return function () { document.removeEventListener("keydown", key); };
            }, [props.onClose]);
            return require("react-dom").createPortal(h("div", { className: "dsh-tavern-header-dialog-backdrop", onPointerDown: function (event) { if (event.target === event.currentTarget) props.onClose(); } },
                h("div", { className: "dsh-tavern-header-dialog dsh-tavern-global-settings", role: "dialog", "aria-modal": "true", "aria-label": "顶栏设置" },
                    h("div", { className: "dsh-tavern-header-dialog-head" },
                        h("strong", null, "顶栏设置"),
                        h("button", { type: "button", className: "dsh-tavern-header-op", "aria-label": "关闭", title: "关闭", onClick: props.onClose }, "×")),
                    h(HeaderItemsSettings, { collapsible: false }))), document.body);
        }

        // One slot for every top-bar shortcut. 酒馆状态 and 导出 keep their own
        // components (the export one owns a menu); pinned pages open their tab.
        function useHeaderInteraction(props) {
            const h = React.createElement;
            const catalog = useTavernHeaderCatalog();
            const header = useTavernHeaderItems();
            // 手机/触屏顶栏只有一行：强制纯图标，并把快捷入口限制在上限内。
            // 存回设置时用用户自己选的形态，别把手机上的强制图标写进配置。
            const mobile = useTavernMobileHeader();
            const configuredDisplay = header.display === "icon" ? "icon" : "icon-text";
            const display = mobile ? "icon" : configuredDisplay;
            const items = header.items;
            const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
            const [folded, setFolded] = React.useState([]);
            // 手机上最多保留几个快捷入口（按标题行宽实测，见下方 effect）。
            const [mobileLimit, setMobileLimit] = React.useState(TAVERN_HEADER_MOBILE_LIMIT);
            const [context, setContext] = React.useState(null);
            const [more, setMore] = React.useState(null);
            const [dialog, setDialog] = React.useState(false);
            const closeDialog = React.useCallback(function () { setDialog(false); }, []);
            const host = React.useRef(null);
            const widths = React.useRef(new Map());
            const measuredDisplay = React.useRef("");
            const entries = React.useMemo(function () {
                const map = new Map();
                map.set("header:export", { id: "header:export", label: "导出" });
                map.set("dsh-tavern:status", { id: "dsh-tavern:status", label: "酒馆状态" });
                catalog.forEach(entry => map.set(entry.id, entry));
                return map;
            }, [catalog]);
            const visible = items.filter(id => id === "dsh-tavern:status" || id === "header:export" || entries.has(id) || !catalog.length);
            const titleOf = id => (entries.get(id) || {}).label || id.replace(/^[^:]+:/, "");
            function saveHeader(next) {
                Promise.resolve(displayPreferences.save({ headerItems: next }))
                    .catch(error => tavernErrorHub.report("保存顶栏设置", error));
            }
            function move(id, delta) {
                const index = items.indexOf(id), target = index + delta;
                if (index < 0 || target < 0 || target >= items.length) return;
                const next = items.slice();
                [next[index], next[target]] = [next[target], next[index]];
                saveHeader({ display: configuredDisplay, items: next });
            }
            function remove(id) {
                saveHeader({ display: configuredDisplay, items: items.filter(value => value !== id) });
            }
            // Natural widths are cached: a folded button is display:none, so it
            // cannot be measured again until the display mode changes.
            React.useLayoutEffect(function () {
                // 手机上不量按钮宽度：容器会被 flex 压窄，量出来的「可用宽度」
                // 反而恒为够用，于是从不折叠。这里按固定上限折，其余全进 ⋮。
                if (mobile) {
                    const next = tavernHeaderMobileFold(visible, mobileLimit);
                    setFolded(current => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next);
                    return undefined;
                }
                setMobileLimit(TAVERN_HEADER_MOBILE_LIMIT);
                const node = host.current;
                if (!node) return undefined;
                let frame = 0;
                // Icon-only and labelled buttons have different widths; a cached
                // width from the other mode would fold the wrong pages.
                if (measuredDisplay.current !== display) { widths.current.clear(); measuredDisplay.current = display; }
                function measure() {
                    const buttons = Array.from(node.querySelectorAll("[data-header-item]"));
                    buttons.forEach(button => { button.style.display = "inline-flex"; });
                    for (const button of buttons) widths.current.set(button.dataset.headerItem, button.offsetWidth);
                    buttons.forEach(button => { button.style.display = ""; });
                    const sample = node.appendChild(document.createElement("button"));
                    sample.className = "dsh-tavern-btn dsh-tavern-header-more-button";
                    const style = window.getComputedStyle(node);
                    const gap = parseFloat(style.columnGap || style.gap) || 0;
                    const moreWidth = sample.offsetWidth + gap;
                    sample.remove();
                    // ⋯ appears only once something folds, so its width is reserved
                    // only then; the default bar looks exactly as it did before.
                    const available = tavernHeaderAvailableWidth(node);
                    const next = tavernHeaderFold(visible, id => widths.current.get(id) || 0, available, { gap: gap, fixed: TAVERN_HEADER_NOT_FOLDED, moreWidth: moreWidth });
                    setFolded(current => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next);
                }
                measure();
                if (typeof ResizeObserver !== "function") return undefined;
                const observer = new ResizeObserver(function () { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
                observer.observe(node);
                const row = node.closest("[class*=\"_titleRow\"]");
                if (row) observer.observe(row);
                return function () { observer.disconnect(); cancelAnimationFrame(frame); };
            }, [visible.join("|"), display, catalog, mobile, mobileLimit]);
            // 手机上按标题行宽算槽位：行宽减掉宿主自己的固定开销（见
            // tavernHeaderMobileChrome），剩下的按每格 42px 折算。行宽与当前保留
            // 数量无关，所以不会「收一个 → 标题变宽 → 又想放回」来回跳。
            React.useLayoutEffect(function () {
                if (!mobile) return undefined;
                let frame = window.requestAnimationFrame(function () {
                    const node = host.current;
                    if (!node) return;
                    const row = node.closest("[class*=\"_titleRow\"]");
                    const width = row ? row.clientWidth - tavernHeaderMobileChrome(row) : node.clientWidth;
                    const capacity = tavernHeaderMobileCapacity(visible.length, width, { limit: TAVERN_HEADER_MOBILE_LIMIT });
                    if (capacity !== mobileLimit) setMobileLimit(capacity);
                });
                return function () { window.cancelAnimationFrame(frame); };
            }, [mobile, mobileLimit, folded.join("|"), visible.join("|")]);
            React.useEffect(function () {
                if (!mobile) return undefined;
                let timer = 0;
                function onResize() {
                    window.clearTimeout(timer);
                    // 旋屏后回到上限重算，不该一直停在横屏时收窄的结果。
                    setMobileLimit(TAVERN_HEADER_MOBILE_LIMIT);
                    timer = window.setTimeout(function () { setMobileLimit(TAVERN_HEADER_MOBILE_LIMIT); }, 0);
                }
                window.addEventListener("resize", onResize);
                window.addEventListener("orientationchange", onResize);
                return function () {
                    window.clearTimeout(timer);
                    window.removeEventListener("resize", onResize);
                    window.removeEventListener("orientationchange", onResize);
                };
            }, [mobile]);
            React.useEffect(function () {
                if (!context && !more) return undefined;
                function close(event) {
                    const target = event && event.target;
                    if (target && target.closest && target.closest(".dsh-tavern-header-popup, [data-tavern-header-trigger]")) return;
                    setContext(null); setMore(null);
                }
                function key(event) { if (event.key === "Escape") close(); }
                document.addEventListener("pointerdown", close, true);
                document.addEventListener("keydown", key);
                window.addEventListener("scroll", close, true);
                return function () {
                    document.removeEventListener("pointerdown", close, true);
                    document.removeEventListener("keydown", key);
                    window.removeEventListener("scroll", close, true);
                };
            }, [context, more]);
            function activate(id, node) {
                setMore(null);
                if (id === "header:export") return;
                if (id === "dsh-tavern:status") { props.openStatus(owner); return; }
                // 世界书按钮弹出快捷面板（「完整」再进右侧栏世界书库）。
                if (id === "dsh-tavern:worldbooks" && node) { openWorldbooks(node, owner); return; }
                openPage(props.ctx, id, owner);
            }
            return { host, display, mobile, mobileLimit, items, visible, folded, entries, titleOf, context, more, dialog, closeDialog, setContext, setMore, setDialog, move, remove, activate };
        }

        function TavernHeaderItems(props) {
        const h = React.createElement;
        const { host, display, mobile, mobileLimit, items, visible, folded, entries, titleOf, context, more, dialog, closeDialog, setContext, setMore, setDialog, move, remove, activate } = useHeaderInteraction(props);
        function item(id) {
            const entry = entries.get(id) || { id: id, label: titleOf(id) };
            const label = entry.label || titleOf(id);
            const content = id === "dsh-tavern:status"
            ? h(StatusAction, { sessionId: props.sessionId, sessions: props.sessions, open: props.openStatus })
            : id === "header:export"
            ? h(ExportAction, { sessionId: props.sessionId, sessions: props.sessions, sidebar: props.ctx.betterSidebar, openStatus: props.openStatus, renderSlot: props.renderSlot })
            : h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-header-page", title: label, "aria-label": label, onClick: function (event) { activate(id, event.currentTarget); } },
                tavernStartIcon(id, entry, 18),
                h("span", { className: "dsh-tavern-header-action-label" }, label));
            return h("span", {
                    key: id,
                    className: "dsh-tavern-header-item" + (folded.includes(id) ? " is-folded" : ""),
                    "data-header-item": id,
                    onContextMenu: function (event) { event.preventDefault(); setMore(null); setContext({ id: id, x: event.clientX, y: event.clientY }); }
                }, content);
        }
        const foldedEntries = folded.map(id => ({ id: id, label: titleOf(id) })).filter(entry => entry.id !== "header:export");
        return h("div", {
                ref: host,
                className: "dsh-tavern-header-items" + (display === "icon" ? " is-icon" : ""),
                // 手机上实测的保留上限；夹具与线上排查都读它。
                "data-tavern-header-limit": mobile ? mobileLimit : ""
            },
            visible.map(item),
            foldedEntries.length ? h("div", { className: "dsh-tavern-more-actions dsh-tavern-header-more" },
                h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-header-more-button", "data-tavern-header-trigger": "more", "aria-label": "更多快捷入口", "aria-haspopup": "menu", "aria-expanded": Boolean(more), title: "更多快捷入口", onClick: function () { setContext(null); setMore(more ? null : { x: null, y: null }); } },
                    h("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", "aria-hidden": "true" }, h("path", { d: mobile ? "M12 5h.01M12 12h.01M12 19h.01" : "M5 12h.01M12 12h.01M19 12h.01" }))),
                more ? h("div", { className: "dsh-tavern-more-menu dsh-tavern-header-popup", role: "menu", "aria-label": "更多快捷入口" },
                    foldedEntries.map(entry => h("button", { key: entry.id, type: "button", role: "menuitem", onClick: function () { setMore(null); activate(entry.id, host.current); } }, tavernStartIcon(entry.id, entries.get(entry.id), 15), entry.label)),
                    h("div", { className: "dsh-tavern-header-menu-sep", role: "separator" }),
                    tavernHeaderMenuButton(h, "顶栏设置…", TAVERN_HEADER_GEAR_PATH, false, function () { setMore(null); setDialog(true); })) : null) : null,
            context ? h("div", { className: "dsh-tavern-more-menu dsh-tavern-header-popup dsh-tavern-header-context", role: "menu", style: { position: "fixed", left: Math.min(context.x, (window.innerWidth || 1024) - 190) + "px", top: Math.min(context.y, (window.innerHeight || 768) - 190) + "px", right: "auto", bottom: "auto" } },
                tavernHeaderMenuButton(h, "左移", "M15 6l-6 6 6 6", items.indexOf(context.id) <= 0, function () { setContext(null); move(context.id, -1); }),
                tavernHeaderMenuButton(h, "右移", "M9 6l6 6-6 6", items.indexOf(context.id) >= items.length - 1, function () { setContext(null); move(context.id, 1); }),
                tavernHeaderMenuButton(h, "移除", "M6 6l12 12M18 6L6 18", false, function () { setContext(null); remove(context.id); }),
                h("div", { className: "dsh-tavern-header-menu-sep", role: "separator" }),
                tavernHeaderMenuButton(h, "顶栏设置…", TAVERN_HEADER_GEAR_PATH, false, function () { setContext(null); setDialog(true); })) : null,
            dialog ? h(TavernHeaderSettingsDialog, { onClose: closeDialog }) : null);
    }

    return Object.freeze({ HeaderItems: TavernHeaderItems });
}
