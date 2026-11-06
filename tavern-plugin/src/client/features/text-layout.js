// 外观 → 正文排版：行距、字距、自动分段与段首缩进，字号就是 DSH 通用设置里的字号。
// 行距、字距和自动分段只接管正文的呈现；字号联动 DSH 的「字号大小」。
// 只在调过时写变量；自动分段在渲染前把正文重新分段（features/prose-layout.js）。
// 思路来自 DrifterJD/ZITI。
const TAVERN_TEXT_LAYOUT_KEY = "dsh-tavern-text-layout";
const TAVERN_TEXT_LAYOUT_LIMITS = Object.freeze({ lineHeight: [1, 3], letterSpacing: [-0.1, 0.3] });

function normalizeTavernTextLayout(value) {
    const source = value && typeof value === "object" ? value : {};
    const clamp = function (raw, range) {
        const number = Number(raw);
        if (raw === null || raw === "" || !Number.isFinite(number)) return null;
        return Math.round(Math.min(range[1], Math.max(range[0], number)) * 1000) / 1000;
    };
    return Object.assign({
        lineHeight: clamp(source.lineHeight, TAVERN_TEXT_LAYOUT_LIMITS.lineHeight),
        letterSpacing: clamp(source.letterSpacing, TAVERN_TEXT_LAYOUT_LIMITS.letterSpacing)
    }, normalizeTavernProseLayout(source));
}

function readTavernTextLayout() {
    try { return normalizeTavernTextLayout(JSON.parse(window.localStorage.getItem(TAVERN_TEXT_LAYOUT_KEY) || "null")); }
    catch (_) { return normalizeTavernTextLayout(null); }
}

// 没调过的行距、字距不写变量；自动分段与段首缩进默认开着分段、关着缩进，
// 都记在本机，换一张卡也一样。
function applyTavernTextLayout(layout, root) {
    const element = root || document.documentElement;
    const custom = layout.lineHeight !== null || layout.letterSpacing !== null;
    element.toggleAttribute("data-dsh-text-layout", custom);
    element.toggleAttribute("data-dsh-tavern-prose-indent", layout.indent === true);
    if (layout.lineHeight === null) element.style.removeProperty("--dsh-tavern-line-height");
    else element.style.setProperty("--dsh-tavern-line-height", String(layout.lineHeight));
    if (layout.letterSpacing === null) element.style.removeProperty("--dsh-tavern-letter-spacing");
    else element.style.setProperty("--dsh-tavern-letter-spacing", layout.letterSpacing + "em");
    setTavernProseLayout(layout);
}

// 酒馆原来的行高是 24px + (字号 − 14px)，换算成倍数作为「默认」的显示值。
function defaultTavernLineHeight(fontSize) {
    return Math.round((24 + fontSize - 14) / fontSize * 100) / 100;
}

// DSH 0.2.0 的正文只有一个字号（`fontSize` / `setFontSize(px)`），0.2.1 才按角色
// 拆开（`fontSizes.text` / `setFontSize("text", px)`）。Android 内置的是 0.2.0，
// 用新签名会把 "text" 当字号传进去，报 “font size text is outside 10..22”。
function tavernThemeTextFontSize(snapshot) {
    const sizes = snapshot && snapshot.fontSizes;
    if (sizes && Number.isFinite(sizes.text)) return sizes.text;
    const fontSize = snapshot && snapshot.fontSize;
    return Number.isFinite(fontSize) ? fontSize : TAVERN_THEME_FONT_DEFAULT;
}

function setTavernThemeTextFontSize(theme, px) {
    const snapshot = theme.getTheme();
    if (snapshot && snapshot.fontSizes) return theme.setFontSize("text", px);
    return theme.setFontSize(px);
}

// 字号上限由宿主决定：0.2.0 和没打上补丁的 0.2.1 是 22，Tavern 打过补丁的宿主是 32。
// 先按 32 给，宿主拒绝时收窄到它报出的上限并重试——手机滑到 23 以上也不会整段失灵。
const TAVERN_THEME_FONT_MIN = 10;
const TAVERN_THEME_FONT_DEFAULT = 14;
const TAVERN_THEME_FONT_MAX = 32;
function tavernHostFontRange(message) {
    const match = /outside\s+(\d+)\s*\.\.\s*(\d+)/.exec(String(message || ""));
    return match ? { min: Number(match[1]), max: Number(match[2]) } : null;
}

function createTavernTextLayoutFeature() {
    let layout = readTavernTextLayout();
    const listeners = new Set();
    function update(patch) {
        layout = normalizeTavernTextLayout(Object.assign({}, layout, patch));
        try { window.localStorage.setItem(TAVERN_TEXT_LAYOUT_KEY, JSON.stringify(layout)); } catch (_) {}
        applyTavernTextLayout(layout);
        listeners.forEach(function (listener) { listener(layout); });
        // 行距、字距是 CSS，改完立刻生效；自动分段要重画正文，通知已经挂着的消息重取文本。
        try {
            const EventCtor = window.CustomEvent || window.Event;
            window.dispatchEvent(new EventCtor("dsh-tavern-prose-layout"));
        } catch (_) {}
    }

    function TextLayoutRow(props) {
        const h = React.createElement;
        const theme = props.theme;
        const [current, setCurrent] = React.useState(layout);
        const [fontSize, setFontSize] = React.useState(function () { return tavernThemeTextFontSize(theme.getTheme()); });
        const [maxFontSize, setMaxFontSize] = React.useState(TAVERN_THEME_FONT_MAX);
        const maxFontSizeRef = React.useRef(TAVERN_THEME_FONT_MAX);
        const [error, setError] = React.useState("");
        React.useEffect(function () {
            listeners.add(setCurrent);
            return function () { listeners.delete(setCurrent); };
        }, []);
        React.useEffect(function () {
            // 通用设置里改了字号，这里跟着变。
            return props.onThemeChange(function (snapshot) { setFontSize(tavernThemeTextFontSize(snapshot)); });
        }, []);
        function changeFontSize(px) {
            setError("");
            const value = Math.min(maxFontSizeRef.current, Math.max(TAVERN_THEME_FONT_MIN, Math.round(px)));
            try { setTavernThemeTextFontSize(theme, value); }
            catch (err) {
                const message = String(err && err.message || err);
                const range = tavernHostFontRange(message);
                // 这个宿主的上限更低：把滑杆收窄到上限，改设上限值，不把宿主报错摆在设置页上。
                if (range && range.max < value) {
                    maxFontSizeRef.current = range.max;
                    setMaxFontSize(range.max);
                    try { setTavernThemeTextFontSize(theme, range.max); } catch (_) {}
                    return;
                }
                setError(message);
            }
        }
        const shownFontSize = Math.max(TAVERN_THEME_FONT_MIN, Math.min(maxFontSize, fontSize));
        const lineHeight = current.lineHeight === null ? defaultTavernLineHeight(shownFontSize) : current.lineHeight;
        const letterSpacing = current.letterSpacing === null ? 0 : current.letterSpacing;
        // the one shared slider, not a native range. Line and letter spacing follow the drag;
        // the font size goes to the host once, on release or per key step.
        function field(label, hint, value, min, max, step, unit, onChange, live) {
            return h("div", { className: "dsh-tavern-text-layout-field" },
                h("span", { className: "dsh-tavern-text-layout-label" }, label, h("small", null, hint)),
                h(Slider, { label: label, min: min, max: max, step: step, value: value, valueText: function (shown) { return shown + unit; },
                    onChange: live ? onChange : undefined, onCommit: onChange }),
                h("span", { className: "dsh-tavern-text-layout-value" }, value + unit));
        }
        function toggle(label, description, checked, onChange) {
            return h("div", { className: "dsh-tavern-text-layout-switch" },
                h("span", { className: "dsh-tavern-text-layout-switch-copy" },
                    h("b", null, label),
                    h("small", null, description)),
                h(Switch, { checked: checked === true, onChange: onChange, label: label }));
        }
        const preview = layoutTavernProseText("夜色从窗棂上滑下来，落在她的发梢。她抬起头，轻声说：「雨停了，我们走吧。」窗外的水声一层层退下去，像有人在很远的地方翻书。她没有等到回答，只是把伞往他那边斜了斜，自己半边肩膀湿在雨里。", current);
        return h("section", { className: "dsh-tavern-text-layout" },
            h("div", { className: "dsh-tavern-text-layout-head" },
                h("strong", null, "正文排版"),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: current.lineHeight === null && current.letterSpacing === null && shownFontSize === TAVERN_THEME_FONT_DEFAULT && current.paragraphs === TAVERN_PROSE_DEFAULTS.paragraphs && current.indent === false && current.sentences === TAVERN_PROSE_DEFAULTS.sentences,
                    onClick: function () { update({ lineHeight: null, letterSpacing: null, paragraphs: TAVERN_PROSE_DEFAULTS.paragraphs, indent: false, sentences: TAVERN_PROSE_DEFAULTS.sentences }); if (shownFontSize !== TAVERN_THEME_FONT_DEFAULT) changeFontSize(TAVERN_THEME_FONT_DEFAULT); } }, "恢复默认")),
            h("p", { className: "dsh-tavern-settings-desc" }, "作用于酒馆正文、你的对话气泡和舞台文本，卡片自带的界面不受影响。字号与「通用设置」里的字号大小是同一个设置。"),
            field("字号", "px", shownFontSize, TAVERN_THEME_FONT_MIN, maxFontSize, 1, "px", changeFontSize, false),
            field("行间距", "倍", lineHeight, 1, 3, 0.05, "×", function (value) { update({ lineHeight: value }); }, true),
            field("字间距", "em", letterSpacing, -0.1, 0.3, 0.01, "em", function (value) { update({ letterSpacing: value }); }, true),
            toggle("自动分段", "模型把整轮正文写成一整块时，按句子重新分段；代码块、列表和台词行原样保留。只改显示，不改存档。", current.paragraphs, function (value) { update({ paragraphs: value }); }),
            field("每段", "句", current.sentences, TAVERN_PROSE_SENTENCE_RANGE[0], TAVERN_PROSE_SENTENCE_RANGE[1], 1, "句", function (value) { update({ sentences: value }); }, false),
            toggle("段首缩进", "正文每一段缩进两个字，像纸书排版。", current.indent, function (value) { update({ indent: value }); }),
            h("p", { className: "dsh-tavern-text-layout-preview", style: { fontSize: shownFontSize + "px", lineHeight: lineHeight, letterSpacing: letterSpacing + "em", textIndent: current.indent ? "2em" : undefined } },
                preview),
            error ? h("p", { className: "dsh-tavern-settings-error", role: "alert" }, error) : null);
    }

    function register(ctx) {
        applyTavernTextLayout(layout);
        // 外观页由内置的 dsh-dream-skin 提供；没有它时这一行不出现，已保存的排版照样生效。
        return ctx.slots.inject("settings.dreamSkin.item", function () {
            return ctx.slots.register({
                name: "settings.dreamSkin.item",
                id: "dsh-tavern-text-layout",
                order: 15,
                inject: function () {
                    return { theme: ctx.theme, onThemeChange: function (listener) { return ctx.on("theme/change", listener); } };
                }
            }, TextLayoutRow);
        });
    }

    return Object.freeze({ register: register, update: update, normalize: normalizeTavernTextLayout, defaultLineHeight: defaultTavernLineHeight, apply: applyTavernTextLayout });
}

const tavernTextLayoutFeature = createTavernTextLayoutFeature();
