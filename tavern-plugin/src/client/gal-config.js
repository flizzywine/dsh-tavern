// the stage's CONFIG screen, visual-novel
// style - the one home of the stage's lasting preferences. The system menu's 设置 (and the top bar's 声音) open a full-screen
// overlay over the blurred stage with left tabs: 声音 (every audio layer, with previews), 文字 (reading pace, fonts, text size),
// 画面 (本卡皮肤, 顶栏按钮, effects) and 模组 (each enabled mod's stage preferences; no tab without one). The stage owns the open
// state (auto / skip pause while it is open, like the backlog). Styled only through the stage UI tokens (--gal-ui-*).

// The font picker (舞台字体 / 字幕字体 here, 正文字体 on the 外观 settings page — appearance.js, same closure).
// @include font-picker.js

// 本卡皮肤 - the player's own skin for this card (stage.skinChoice; null clears it, back to the
// card's / the global default). Serialized per session, same RPC and store as the settings tab (bubbleStore).
const galConfigSaves = new Map();
function galConfigSaveSkin(sessionId, choice) {
    const previous = galConfigSaves.get(sessionId) || Promise.resolve();
    const run = previous.catch(() => {}).then(async function () {
        const data = bubbleStore.get(sessionId);
        if (!data || !data.cardPath) throw new Error("没有可保存的人物卡设置");
        const current = await rpc('getCardAssetBindings', { path: data.cardPath }, sessionId);
        const { skinChoice: _was, ...stage } = current.extension.stage || {};
        await rpc('saveCardAssetBindings', { path: data.cardPath, expectedRevision: current.revision, patch: { stage: choice === null ? stage : { ...stage, skinChoice: choice } } }, sessionId);
        const result = await rpc('getDialogueBubbles', {}, sessionId);
        bubbleStore.set(sessionId, result);
        return result;
    });
    galConfigSaves.set(sessionId, run);
    return run;
}

// Application-owned slots; imported mods cannot register executable client code.
const STAGE_CONFIG_SECTIONS = {};
function GalConfigScreen(props) { return stageViews ? React.createElement(stageViews.configScreen.Screen, props) : null; }

function galConfigGroup(...args) { return stageViews.configFields.group(...args); }
function galConfigRow(...args) { return stageViews.configFields.row(...args); }
function galConfigSegmented(...args) { return stageViews.configFields.segmented(...args); }
function galConfigSlider(...args) { return stageViews.configFields.slider(...args); }
// 文字大小 - the stage text of the skin on screen (props.textSkin from the stage) as a percent of
// that skin's own size; each skin keeps its own value on this machine (stageReading textScale), 100% = as designed.
function stageTextScaleSet(...args) { return stageViews.configText.setScale(...args); }
// 音量: the mixer rows, larger, with ▶ previews where cheap (a built-in one-shot, the current voice line).
// an on / off switch drawn in the stage tokens (track + knob), the same geometry as the stage
// settings' switches; a button with role="switch", never a native checkbox. No state word beside it (UI standard §三.7,
// phase 2 batch 4).
function GalConfigSwitch(props) { return stageViews ? React.createElement(stageViews.configFields.Switch, props) : null; }

// 文字: text speed and auto-mode pace, the stage / subtitle fonts (font-picker.js, applied at once), the current skin's
// text size, and a live preview that types and waits like the stage, in the stage font, with a subtitle line in the film font.
// 本卡皮肤 as a compact select instead of a grid of preview cards. The trigger shows a
// small preview of the chosen skin and its name; the list (portaled like the font picker's, in the stage tokens) shows
// every skin with its preview, the chosen one marked. Keys: ↓ / ↑ on the trigger open it; ↑ ↓ Home End move,
// Enter / Space choose, Esc / Tab close (Esc does not reach the CONFIG screen).
// Built-in ids compare by id; pack skins by all three identity fields (storage may reorder the keys).
function galSkinKey(value) { return typeof value === "string" ? value : value ? JSON.stringify([value.packId, value.kind, value.assetId]) : ""; }
// What a choice's thumbnail paints: a built-in renders its own theme scope; a pack skin uses the palette the host
// sent with the choice (choice.preview) or, when it is the card's current skin, that skin document; else unknown.
function galSkinPreview(choice, stage) {
    const value = choice && choice.value;
    if (typeof value === "string") return { theme: value };
    const current = stage && stage.skin && stage.skin.ref && stage.skin.document && galSkinKey(stage.skin.ref) === galSkinKey(value) ? stage.skin.document : null;
    const paint = choice && choice.preview || current && { ...current.textbox && current.textbox.paint, ...current.ui };
    if (!paint || !paint.bg) return { unknown: true };
    const radius = current && (current.ui && current.ui.radius != null ? current.ui.radius : current.textbox && current.textbox.shape && current.textbox.shape.radius);
    return { style: { "--gal-ui-surface-2": paint.bg, "--gal-ui-ink": paint.fg || paint.bg, "--gal-ui-accent": paint.accent || paint.fg, "--gal-ui-line": paint.border || paint.fgMuted || paint.fg,
        // A pack skin has no gem of its own: the neutral caret, not the current theme's shape.
        "--gal-ui-gem": "polygon(0 0, 100% 0, 50% 100%)", "--gal-ui-gem-width": "9px", "--gal-ui-gem-height": "7px",
        "--gal-ui-gem-fill": paint.accent || paint.fg, ...(radius != null ? { "--gal-ui-radius": radius + "px" } : {}) } };
}
function GalConfigSkinThumb(props) {
    const h = React.createElement;
    const look = galSkinPreview(props.choice, props.stage);
    const label = String(props.choice && props.choice.label || "");
    if (look.unknown) return h("span", { className: "fork-gal-config-theme-art is-unknown", "aria-hidden": true }, h("b", null, Array.from(label)[0] || "?"));
    return h("span", { className: "fork-gal-config-theme-art" + (look.theme ? " fork-gal-theme-scope" : ""), "data-theme": look.theme, style: look.style, "aria-hidden": true },
        h("i", { className: "art-name" }), h("i", { className: "art-line" }), h("i", { className: "art-line is-short" }), h("i", { className: "art-gem" }));
}
// props: { label, choices [{ value, label, preview?, resource? }], value, stage, theme, reducedMotion, busy, onChange(value),
// onWarm(choice) }. busy: the chosen skin is still being saved or read - the trigger already shows it, a spinner in place of
// the chevron, no words (R25). onWarm: the player points at an option (hover, focus, press) - its bundle can be read ahead.
function GalConfigSkinSelect(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const wrap = React.useRef(null), trigger = React.useRef(null), pop = React.useRef(null);
    const key = galSkinKey(props.value);
    const choices = props.choices || [];
    const current = choices.find(choice => galSkinKey(choice.value) === key) || null;
    const name = current ? current.label : "未选择";
    function close(refocus) {
        setOpen(false);
        if (refocus && trigger.current && typeof trigger.current.focus === "function") trigger.current.focus({ preventScroll: true });
    }
    function choose(choice) {
        forkUiSfx.play("toggle");
        close(true);
        if (galSkinKey(choice.value) !== key) props.onChange(choice.value);
    }
    // Open: focus the chosen option; Esc (capture, before the CONFIG screen) and a press outside close it.
    React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof document === "undefined") return undefined;
        const root = pop.current;
        const chosen = root && root.querySelector ? root.querySelector('[role="option"][aria-selected="true"]') || root.querySelector('[role="option"]') : null;
        if (chosen && typeof chosen.focus === "function") chosen.focus({ preventScroll: false });
        function outside(event) {
            const target = event.target;
            if (wrap.current && wrap.current.contains(target) || pop.current && pop.current.contains(target)) return;
            setOpen(false);
        }
        function escape(event) {
            if (event.key !== "Escape") return;
            event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation();
            close(true);
        }
        document.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", escape, true);
        return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape, true); };
    }, [open]);
    function onListKey(event) {
        event.stopPropagation();
        if (event.key === "Tab") { event.preventDefault(); close(true); return; }
        const items = pop.current && pop.current.querySelectorAll ? Array.from(pop.current.querySelectorAll('[role="option"]')) : [];
        if (!items.length) return;
        const at = items.indexOf(typeof document !== "undefined" ? document.activeElement : null);
        const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? (at < 0 ? items.length - 1 : at - 1) : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        items[(next + items.length) % items.length].focus();
    }
    // Presses on the list's padding keep focus on an option (Esc then still reaches the select).
    function keepFocus(event) { if (!(event.target && event.target.closest && event.target.closest('[role="option"]'))) event.preventDefault(); }
    // The list is portaled outside the stage: it re-derives the stage tokens (theme scope) and keeps the current skin's.
    const stageTokens = {};
    if (open && trigger.current && typeof getComputedStyle === "function") {
        const style = getComputedStyle(trigger.current);
        for (const prop of style) if (prop.startsWith("--gal-")) stageTokens[prop] = style.getPropertyValue(prop);
    }
    const list = h("div", { className: "fork-gal-skin-list", role: "listbox", "aria-label": props.label, onKeyDown: onListKey },
        choices.map(choice => {
            const selected = galSkinKey(choice.value) === key;
            const warm = selected || !props.onWarm ? undefined : () => props.onWarm(choice);
            return h("button", { key: galSkinKey(choice.value), type: "button", role: "option", "aria-selected": selected, className: "fork-gal-skin-option" + (selected ? " is-on" : ""),
                "data-value": typeof choice.value === "string" ? choice.value : choice.value.assetId, onPointerEnter: warm, onFocus: warm, onPointerDown: warm, onClick: () => choose(choice) },
                h(GalConfigSkinThumb, { choice, stage: props.stage }),
                h("b", { className: "fork-gal-skin-option-name" }, choice.label),
                selected ? h("span", { className: "fork-gal-skin-option-check", "aria-hidden": true }, h(Icon, { name: "check", size: 16 })) : null);
        }));
    // The portaled list carries the stage's skin font declaration so fonts.js resolves the same faces there.
    const skinFonts = open && trigger.current && trigger.current.closest && trigger.current.closest("[data-fk-fonts]");
    const popover = open ? h(FloatingPanel, { anchor: trigger, popRef: pop, className: "fork-gal-skin-pop fork-gal-theme-scope", style: stageTokens, "data-theme": props.theme || "", "data-fk-fonts": skinFonts ? skinFonts.getAttribute("data-fk-fonts") : undefined, "data-reduced-motion": props.reducedMotion || undefined,
        gap: 8, minWidth: trigger.current ? trigger.current.offsetWidth : 0, onMouseDown: keepFocus }, list) : null;
    return h("div", { ref: wrap, className: "fork-gal-skin-pick" + (open ? " is-open" : "") },
        h("button", { ref: trigger, type: "button", className: "fork-gal-skin-trigger", "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": props.label + "：" + name,
            "aria-busy": props.busy ? true : undefined,
            onClick: () => setOpen(value => !value),
            onKeyDown: event => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); } } },
            current ? h(GalConfigSkinThumb, { choice: current, stage: props.stage }) : null,
            h("span", { className: "fork-gal-skin-trigger-name" }, name),
            props.busy ? h(Spinner, { className: "fork-gal-skin-busy", delay: 0 }) : h(Icon, { name: "chevron", size: 16 })),
        popover);
}

// A sample line typed at the chosen speed, then held for the auto wait (as a silent page would be), then again.
// 画面 (PROPOSAL §五): 外观 - 本卡皮肤 (the player's choice for this card, ↺ back to the card's / global default) and 顶栏按钮 (the
// player's choice over the skin's hud.reveal, ↺ back to the skin's); 效果 - quality, frame cap, motion, flashes.
function GalConfigScreenTab(props) {
    const h = React.createElement;
    const quality = useStageQuality();
    const reading = useStageReading();
    const stage = props.data && props.data.config && props.data.config.stage || {};
    const choices = stage.skinChoices || STAGE_THEMES.map(([value, label]) => ({ value, label }));
    const [skinError, setSkinError] = React.useState("");
    // The choice being saved (the trigger shows it at once, busy); after the save the stage reports its bundle read (skinPending).
    const [savingSkin, setSavingSkin] = React.useState(null), saveTicket = React.useRef(0);
    const saveSkin = choice => {
        const ticket = ++saveTicket.current;
        setSkinError(""); setSavingSkin({ value: choice });
        galConfigSaveSkin(props.sessionId, choice).catch(error => setSkinError(String(error && error.message || error)))
            .then(() => { if (saveTicket.current === ticket) setSavingSkin(null); });
    };
    const warmSkin = choice => { if (choice.resource && typeof stageSkinPrefetch === "function") stageSkinPrefetch(props.sessionId, choice.resource); };
    const nameOf = value => (choices.find(choice => galSkinKey(choice.value) === galSkinKey(value)) || {}).label || "";
    const hudNames = { auto: "自动隐藏", always: "一直显示" };
    const skinRow = h("div", { className: "fork-gal-config-value-reset is-select", "data-fk-control": "select" },
        h(GalConfigSkinSelect, { label: "本卡皮肤", choices, value: savingSkin ? savingSkin.value === null ? stage.skinFallback : savingSkin.value : stage.defaultSkin || stage.theme || "classic", stage, theme: stage.theme || "classic",
            reducedMotion: reading.reducedMotion === true, busy: Boolean(savingSkin) || props.skinPending === true, onChange: saveSkin, onWarm: warmSkin }),
        stage.skinChoice ? h(ResetButton, { label: "恢复为" + (nameOf(stage.skinFallback) ? "「" + nameOf(stage.skinFallback) + "」" : "默认皮肤"), onClick: () => saveSkin(null) }) : null);
    const hudRow = h("div", { className: "fork-gal-config-value-reset is-select", "data-fk-control": "segmented" },
        galConfigSegmented({ label: "顶栏按钮", value: reading.hudReveal || props.skinHud, options: [["auto", hudNames.auto], ["always", hudNames.always]], onChange: value => stageReading.set({ hudReveal: value }) }),
        reading.hudReveal ? h(ResetButton, { label: "恢复为皮肤默认（" + hudNames[props.skinHud] + "）", onClick: () => stageReading.set({ hudReveal: null }) }) : null);
    return h(React.Fragment, null,
        galConfigGroup(skinError ? ["外观", h("span", { key: "error", className: "fork-gal-config-caption-alert", role: "alert" }, "⚠ " + skinError)] : "外观", null,
            galConfigRow("本卡皮肤", skinRow, h(React.Fragment, null, h("span", null, "只换这张卡的皮肤，其他卡不受影响。"),
                h("span", null, "↺ 回到卡自带的皮肤；卡没有指定时回到 舞台设置 › 基础设置 的默认皮肤。导演临时换的皮肤（如场景光效）结束后也回到这里。"))),
            galConfigRow("顶栏按钮", hudRow, h(React.Fragment, null, h("span", null, "背景、BGM、声音、手机、弹幕、电影模式这一排按钮。"),
                h("span", null, "自动隐藏：鼠标移到画面上方、打开菜单或用 Tab 时出现，地点或曲子变化时标签也会出现几秒。默认跟随皮肤。")))),
        galConfigGroup("效果", null,
            galConfigRow("特效质量", galConfigSegmented({ label: "特效质量", value: quality, options: [["high", "高"], ["low", "低"]], onChange: value => stageQuality.set(value) }),
                "低：分辨率和帧率降低，粒子减少，去掉颗粒、泛光、景深等重滤镜，更省电。"),
            galConfigRow("帧率上限", galConfigSegmented({ label: "帧率上限", value: String(reading.frameCap), options: [["30", "30"], ["60", "60"], ["120", "120"], ["0", "跟随屏幕"]], onChange: value => stageReading.set({ frameCap: Number(value) }) }),
                "上限越高越流畅，但会增加 GPU 负载和耗电。跟随屏幕不额外限帧；静止场景自动降至 30 帧。低特效质量仍限制为 30 帧。"),
            galConfigRow("减少动态", h(GalConfigSwitch, { label: "减少动态", checked: reading.reducedMotion === true, onChange: on => stageReading.set({ reducedMotion: on }) }), "演出装饰保持静态并关闭震动；系统的减少动态设置同样生效。"),
            galConfigRow("光敏保护", h(GalConfigSwitch, { label: "光敏保护", checked: reading.photosensitive === true, onChange: on => stageReading.set({ photosensitive: on }) }), "默认开启：闪光保留颜色但减弱强度，红闪改为暗红。整个舞台每秒最多三次闪光。")));
}

// the one generic CONFIG row renderer, for the settings a mod (or the engine)
// hands over as plain data instead of building rows. An item: { key, type, label, help?, value, onChange(value), onCommit?(value),
// disabled?, choices [{ value, label }], min, max, step, unit?, maxLength?, placeholder?, palette?, auto? (colour: the automatic
// colour, the value null = automatic), display? (picker / other: the value in words), onOpen? (picker: open its chooser) }.
// Types are the mod settings' (settingsSchema): text, toggle, slider, segmented, colour, asset-picker / sound-picker (= picker),
// plus select; any other type is `other` - its label and its value in words, read-only, never a broken control. Each row
// carries data-fk-control, so the skin's surface draws it (its controls.<type>, else controls.other).
function GalConfigItems(props) { return stageViews ? React.createElement(stageViews.configFields.Items, props) : null; }
function galConfigFieldSections(...args) { return stageViews.configFields.sections(...args); }
