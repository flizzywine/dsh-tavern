// 展开大屏 / 放大面板: the card frame in a dialog sheet (the shared .ap-modal look) over a
// dimmed page. 关闭, Esc and a press on the dimmed page close it through the shared popup
// stack (inline-field.js overlayPush). The live iframe never moves: reparenting would reload
// card scripts. It is lifted into the top layer and laid exactly over the sheet's body.
// The sheet starts below the Windows title bar, whose native window buttons cover the top
// 40 px of the page.
let closeTavernFrameSheet = null;
function openTavernFrameSheet(frame, options) {
    closeTavernFrameSheet?.();
    const doc = frame.ownerDocument, win = doc.defaultView;
    const title = options?.title || "人物卡面板", wide = Boolean(options?.wide);
    const previousStyle = frame.getAttribute("style");
    const previousPopover = frame.getAttribute("popover");
    const previousFocus = doc.activeElement;
    const height = Math.round(frame.getBoundingClientRect().height);

    const layer = doc.createElement("div");
    layer.className = "ap-ui ap-layer";
    const scrim = doc.createElement("div");
    scrim.className = "ap-modal-scrim dsh-tavern-frame-sheet-scrim";
    const sheet = doc.createElement("section");
    sheet.className = "ap-modal dsh-tavern-frame-sheet" + (wide ? " is-wide" : "");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title);
    const head = doc.createElement("header");
    const heading = doc.createElement("h2");
    heading.textContent = title;
    const close = doc.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.setAttribute("aria-label", "关闭");
    head.append(heading, close);
    const body = doc.createElement("div");
    body.className = "dsh-tavern-frame-sheet-body";
    if (!wide && height > 0) body.style.setProperty("--dsh-frame-sheet-height", height + "px");
    sheet.append(head, body);
    scrim.append(sheet);
    layer.append(scrim);

    const place = () => {
        const box = body.getBoundingClientRect();
        frame.style.cssText = (previousStyle || "") + ";position:fixed!important;inset:auto!important;left:" + box.left + "px!important;top:" + box.top + "px!important;width:" + box.width + "px!important;height:" + box.height + "px!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;box-sizing:border-box!important;border:0!important;border-radius:8px!important;overflow:hidden!important;pointer-events:auto!important;";
    };
    let observer, resize, unstack, frameWindow = null;
    const onFrameKey = event => { if (event.key === "Escape") { event.preventDefault(); restore(); } };
    const restore = () => {
        if (closeTavernFrameSheet !== restore) return;
        closeTavernFrameSheet = null;
        unstack?.();
        observer?.disconnect();
        resize?.disconnect();
        win.removeEventListener("resize", place);
        try { frameWindow?.removeEventListener("keydown", onFrameKey); } catch (_) { /* the frame navigated away */ }
        frame.removeAttribute("data-dsh-tavern-expanded");
        if (typeof frame.hidePopover === "function" && frame.matches(":popover-open")) frame.hidePopover();
        if (previousPopover === null) frame.removeAttribute("popover");
        else frame.setAttribute("popover", previousPopover);
        if (previousStyle === null) frame.removeAttribute("style");
        else frame.setAttribute("style", previousStyle);
        if (typeof scrim.hidePopover === "function" && scrim.matches(":popover-open")) scrim.hidePopover();
        layer.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
    };
    closeTavernFrameSheet = restore;
    close.addEventListener("click", restore);
    try {
        frame.setAttribute("data-dsh-tavern-expanded", "");
        doc.body.append(layer);
        // Top layer, so the sheet also covers a page already in fullscreen or a modal stage.
        // The frame is shown after the scrim and therefore stacks above it.
        if (typeof scrim.showPopover === "function") { scrim.setAttribute("popover", "manual"); scrim.showPopover(); }
        place();
        if (typeof frame.showPopover === "function") { frame.setAttribute("popover", "manual"); frame.showPopover(); }
        unstack = overlayPush({ nodes: () => [sheet, frame], close: restore });
        // A same-origin (trusted) card keeps Esc working after a click inside it; a sandboxed
        // frame's keys never reach the page.
        try { frameWindow = frame.contentWindow; frameWindow?.addEventListener("keydown", onFrameKey); } catch (_) { frameWindow = null; }
        close.focus({ preventScroll: true });
        win.addEventListener("resize", place);
        if (typeof win.ResizeObserver === "function") { resize = new win.ResizeObserver(place); resize.observe(body); }
        observer = new win.MutationObserver(() => {
            if (!frame.isConnected || frame.getAttribute("aria-hidden") === "true") restore();
        });
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden"] });
    } catch (error) { restore(); throw error; }
    return restore;
}
