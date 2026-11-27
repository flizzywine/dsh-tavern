// Public client contracts. The shell never receives the live store or font disposal rights.
function installTavernPresentation(ctx) {
    // Stage palette and shared surface primitives survive disabling the outer UI.
    ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.tavernSurfaceDefaults = "";
        // Low-specificity defaults keep feature surfaces readable with the shell disabled.
        style.textContent = forkSurfaces.css().replace('[data-fk-context="chat-light"]', ':where(body),[data-fk-context="chat-light"]');
        document.head.appendChild(style);
        return () => style.remove();
    });
    ctx.provide("tavernFonts", Object.freeze({
        list: tavernFonts.list,
        get: tavernFonts.get,
        ensureLoaded: tavernFonts.ensure,
        subscribe: tavernFonts.subscribe
    }));
    ctx.provide("tavernView", Object.freeze({
        getSessionId: () => ctx.sessions.list.getSnapshot().current || "",
        getMode(sessionId) {
            const view = liveTavernView.getSnapshot(sessionId).view;
            return view ? (isPlayMode(view.mode) ? "play" : "card") : "";
        },
        subscribe: (sessionId, listener) => liveTavernView.subscribe(sessionId, listener, [["mode"]])
    }));
    // Host palette refreshes (page opens touch <head>) mostly repeat the current palette.
    let surfaceKey = null, surfaceResult = null;
    function computeSurfaceStyles(host) {
        const key = JSON.stringify(host);
        if (key === surfaceKey) return surfaceResult;
        let dark = host.dark;
        try { dark = forkSurfaces.contrast(forkSurfaces.color(host.bg), [255, 255, 255, 1]) > 4.5; } catch (_) {}
        const context = dark ? "chat-dark" : "chat-light";
        const table = forkSurfaces.build({ [context]: host });
        surfaceResult = Object.freeze({ context, css: forkSurfaces.css(Object.fromEntries(Object.entries(table).filter(([name]) => name.startsWith("chat-")))) });
        surfaceKey = key;
        return surfaceResult;
    }
    // 监听宿主皮肤与深浅色变化，实时同步 --fk-s-* 表面调色板与 body[data-fk-context]。
    ctx.effect(() => {
        if (typeof document === "undefined" || !document.body || typeof getComputedStyle !== "function") return;
        const hostStyle = document.createElement("style");
        hostStyle.dataset.tavernSurfaceHost = "";
        document.head.appendChild(hostStyle);
        const probe = document.createElement("span");
        probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden;pointer-events:none;";
        document.body.appendChild(probe);

        // 通过离屏探针将 var()/color-mix()/oklch() 等任意 CSS 颜色解析为 [r,g,b,a]。
        function parseCssColor(expr) {
            if (!expr) return null;
            probe.style.color = "";
            probe.style.color = expr;
            if (!probe.style.color) return null;
            const computed = getComputedStyle(probe).color;
            if (!computed) return null;
            try { return forkSurfaces.color(computed); } catch (_) { return null; }
        }
        function formatOpaque(rgba, fallbackRgb) {
            if (!rgba) return "";
            const flat = rgba[3] < 1 ? forkSurfaces.composite(rgba, fallbackRgb) : rgba;
            return "rgb(" + Math.round(flat[0]) + ", " + Math.round(flat[1]) + ", " + Math.round(flat[2]) + ")";
        }
        function readHostToken(bodyStyle, names, fallbackRgb) {
            for (const name of names) {
                if (!bodyStyle.getPropertyValue(name).trim()) continue;
                const parsed = parseCssColor("var(" + name + ")");
                if (parsed) return formatOpaque(parsed, fallbackRgb);
            }
            return "";
        }

        let lastCss = "", lastContext = "", rafId = 0, disposed = false;
        function syncHostSurfaces() {
            rafId = 0;
            if (disposed || !document.body) return;
            const dark = document.body.hasAttribute("data-ds-dark-theme");
            const fallbackBase = dark ? [24, 23, 21, 1] : [255, 255, 255, 1];
            const bodyStyle = getComputedStyle(document.body);
            // 优先使用不透明的 --dsw-alias-bg-base；若开启壁纸导致其变为半透明，则取 dsh-dream-skin 保留的不透明底色。
            let bg = "";
            if (bodyStyle.getPropertyValue("--dsw-alias-bg-base").trim()) {
                const parsedBg = parseCssColor("var(--dsw-alias-bg-base)");
                if (parsedBg && parsedBg[3] === 1) {
                    bg = formatOpaque(parsedBg, fallbackBase);
                } else {
                    bg = readHostToken(bodyStyle, ["--dsh-dream-skin-composer-base"], fallbackBase)
                        || formatOpaque(parsedBg, fallbackBase);
                }
            } else {
                bg = readHostToken(bodyStyle, ["--dsh-dream-skin-composer-base"], fallbackBase);
            }
            const fg = readHostToken(bodyStyle, ["--dsw-alias-label-primary"], fallbackBase);
            const fgMuted = readHostToken(bodyStyle, ["--dsw-alias-label-secondary"], fallbackBase);
            const accent = readHostToken(bodyStyle, ["--dsh-tavern-accent", "--dsw-alias-brand-primary"], fallbackBase);
            const menu = readHostToken(bodyStyle, ["--dsw-specific-menu", "--dsw-specific-sidebar-fill"], fallbackBase);
            const host = { dark };
            if (bg) host.bg = bg;
            if (fg) host.fg = fg;
            if (fgMuted) host.fgMuted = fgMuted;
            if (accent) host.accent = accent;
            if (menu) host.menu = menu;
            const result = computeSurfaceStyles(host);
            if (!result) return;
            if (result.css !== lastCss) {
                lastCss = result.css;
                hostStyle.textContent = result.css;
            }
            if (result.context !== lastContext || document.body.getAttribute("data-fk-context") !== result.context) {
                lastContext = result.context;
                document.body.setAttribute("data-fk-context", result.context);
            }
        }
        function schedule() {
            if (disposed || rafId) return;
            if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(syncHostSurfaces);
            else syncHostSurfaces();
        }

        syncHostSurfaces();
        const offTheme = typeof ctx.on === "function" ? ctx.on("theme/change", schedule) : null;
        let observer = null;
        if (typeof MutationObserver === "function") {
            observer = new MutationObserver(records => {
                for (const record of records) {
                    const target = record.target;
                    if (target === hostStyle || target === probe) continue;
                    if (target && target.dataset && (target.dataset.tavernSurfaceHost !== undefined || target.dataset.tavernSurfaceDefaults !== undefined)) continue;
                    schedule();
                    return;
                }
            });
            if (document.head) observer.observe(document.head, { subtree: true, childList: true, characterData: true });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-dsh-material"] });
            observer.observe(document.body, { attributes: true, attributeFilter: ["style", "class", "data-ds-dark-theme", "data-ds-theme-source"] });
        }
        return () => {
            disposed = true;
            if (rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
            if (observer) observer.disconnect();
            if (typeof offTheme === "function") offTheme();
            hostStyle.remove();
            probe.remove();
            if (document.body && document.body.getAttribute("data-fk-context") === lastContext) {
                document.body.removeAttribute("data-fk-context");
            }
        };
    });
    ctx.provide("tavernPresentation", Object.freeze({
        // The existing picker owns preference writes; the shell only mounts it.
        getFontPicker: () => FontPicker,
        getHelpTip: () => HelpTip,
        getSpinner: () => Spinner,
        // the one inline field, so the shell's 界面大小 row is the same menu as its neighbours.
        getInlineField: () => InlineField,
        getModelPricing: sessionId => rpc("getModelPricing", { sessionId }, sessionId),
        getSurfaceStyles: computeSurfaceStyles
    }));
}
