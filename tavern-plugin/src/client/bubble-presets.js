// the settings save queue and the 高级 → 「对白提示词」 editor.
// The output-format presets are gone: everyone uses the builtin emotions (plus the card's custom ones) and
// voiced lines are automatic (the host adds the voice rules when voices are on and a character has one).

// One in-flight save per settings view, with latest-pending coalescing. A retired
// card generation never publishes old responses into the current view.
function bubbleSaveQueue(send, publish, failed) {
    let generation = 0, pending = null, running = false;
    async function drain() {
        if (running) return;
        running = true;
        while (pending) {
            const job = pending; pending = null;
            try { const result = await send(job.value); if (job.generation === generation && !pending) publish(result, job.value); }
            catch (error) { if (job.generation === generation && !pending) failed(error, job.value); }
        }
        running = false;
    }
    return {
        push(value) { pending = { value, generation }; drain(); },
        retire() { generation++; pending = null; }
    };
}
// The card's dialogue template (config.injection.template); "" = the host's default template.
const BUBBLE_TEMPLATE_TOKENS = ["bubble_format", "bubble_emotions", "bubble_characters"];
function bubbleTemplateOf(config) {
    const injection = config && config.injection;
    return injection && typeof injection.template === "string" ? injection.template : "";
}
// Empty, or the same as the default the host reports (data.defaultTemplate, when it does), counts as default.
function bubbleTemplateIsDefault(template, fallback) {
    const text = String(template || "").trim();
    return !text || Boolean(fallback) && text === String(fallback).trim();
}
function bubbleTemplateMissing(template) {
    const text = String(template || "");
    return text.trim() ? BUBBLE_TEMPLATE_TOKENS.filter(token => !text.includes("{{" + token + "}}")) : [];
}
// Only compatibility mode honours these two anchors; other ST anchors are stored but not implemented.
const BUBBLE_POSITIONS = [[0, "角色设定之前"], [1, "角色设定之后"]];
// One section of the 「对白提示词」 modal, in a flat list (no card frame): a single heading row — disclosure +
// label, the 「?」 right after the label, tags, then right-aligned actions — and its content below.
// Foldable sections start folded; the whole row toggles (except its buttons / tips), the label is the
// keyboard toggle. Folded content stays mounted but hidden, so textareas keep their state.
// props: title, foldable, htmlFor (plain label for an input), help, helpLabel, tags, actions, block, section, label.
function PromptPart(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(Boolean(props.defaultOpen));
    const bodyId = React.useId();
    const foldable = Boolean(props.foldable), shown = !foldable || open;
    const title = foldable
        ? h("button", { type: "button", className: "fork-prompt-toggle", "aria-expanded": open, "aria-controls": bodyId, onClick: () => setOpen(!open) }, h("b", null, props.title))
        : props.htmlFor ? h("label", { className: "fork-prompt-title", htmlFor: props.htmlFor }, props.title) : h("b", { className: "fork-prompt-title" }, props.title);
    const onRow = event => { if (event.target && event.target.closest && event.target.closest("button, input, select, textarea, a, label, .fork-help-tip, [role='tooltip']")) return; setOpen(!open); };
    return h("section", { className: "fork-prompt-part" + (foldable ? " is-foldable" : "") + (shown ? " is-open" : "") + (props.className ? " " + props.className : ""), "data-block": props.block, "data-section": props.section, "aria-label": props.label },
        h("div", { className: "fork-prompt-head", onClick: foldable ? onRow : undefined },
            title,
            props.help ? h(HelpTip, { label: props.helpLabel || props.title + "说明" }, props.help) : null,
            props.tags || null,
            props.actions ? h("span", { className: "fork-prompt-head-actions" }, props.actions) : null),
        props.children ? h("div", { id: bodyId, className: "fork-prompt-body", hidden: !shown }, props.children) : null);
}
function BubblePlacementCard(props) {
    const h = React.createElement;
    const data = props.data || {}, current = data.current || {}, changed = props.changed;
    const get = (key, fallback) => Object.hasOwn(changed, key) ? changed[key] : current[key] === undefined ? fallback : current[key];
    const position = get("position", "");
    return h(PromptPart, { className: "fork-prompt-placement", section: "placement", label: "插入位置", title: "插入位置",
        help: h("span", null, h("span", null, "世界书里的实际位置；只修改你调整过的字段。兼容模式支持角色设定之前 / 之后（受预设世界书槽位控制）；普通游玩把常驻条目放在固定前缀，不按角色、深度或消息角色插入。作者注释、示例消息及 @深度锚点尚未实现，因此不提供这些选项。"), h("span", null, "顺序值越大越优先入选；普通游玩同位置内按小到大排列，兼容模式按大到小排列。正在进行的游戏需应用卡片更新后生效。手动修改的字段若曾在这里设置，下次保存将重新应用设置值。")),
        tags: data.manual ? h("strong", { className: "fork-prompt-tag fork-prompt-manual", role: "status" }, "已在世界书中手动修改") : null,
        // Same link style as the block links below (「角色 ↗」), right-aligned on the heading row.
        actions: props.onOpen && current.book ? h("button", { type: "button", className: "fork-bubble-link", title: "在世界书中查看", onClick: () => props.onOpen((data.books || []).find(book => book.key === current.book)?.source) }, "世界书", " ↗") : null },
        // 「label value」 rows (InlineField), no boxed selects / number box.
        // A position the runtime does not offer (none yet, or @深度) shows as the menu's placeholder until another is picked.
        h(InlineGrid, { label: "插入位置", className: "fork-prompt-placement-fields" },
            h(InlineField, { kind: "menu", label: "目标世界书", value: get("book", data.books && data.books[0] && data.books[0].key || ""), placeholder: "没有世界书",
                options: (data.books || []).map(book => ({ value: book.key, label: book.name })), onCommit: value => props.onChange("book", value) }),
            h(InlineField, { kind: "menu", label: "位置", controlLabel: "插入位置", value: position,
                placeholder: position === "" ? "尚未创建（世界书默认）" : "保留现有位置 " + position + "（运行时不支持）",
                options: BUBBLE_POSITIONS.map(([id, label]) => ({ value: id, label })), onCommit: value => props.onChange("position", Number(value)) }),
            h(InlineField, { kind: "number", label: "顺序", controlLabel: "插入顺序", value: get("order", 100), integer: true, min: -1000000, max: 1000000, step: 1,
                onCommit: value => props.onChange("order", value) }),
            position === 4 ? h(InlineRow, { label: "现有位置", className: "fork-prompt-existing-depth", help: h(HelpTip, { label: "深度说明" }, "仅展示世界书原值；当前运行时不按深度和角色插入") },
                "@深度 " + get("depth", 4) + " · " + (["系统", "用户", "助手"][get("role", 0)] || get("role", 0))) : null));
}
function BubblePromptEditor(props) {
    const h = React.createElement;
    const c = props.ctx;
    const fallback = typeof c.data.defaultTemplate === "string" ? c.data.defaultTemplate : "";
    const [text, setText] = React.useState(() => bubbleTemplateOf(c.draft) || fallback);
    const [extra, setExtra] = React.useState(() => c.draft.injection && c.draft.injection.extra || "");
    const [placement, setPlacement] = React.useState({});
    const [livePlacement, setLivePlacement] = React.useState(c.data.placement);
    const [full, setFull] = React.useState(false);
    const [preview, setPreview] = React.useState({ loading: true, text: c.data.instruction || "", sections: c.data.sections || [], segments: c.data.segments || [], error: "" });
    const missing = bubbleTemplateMissing(text);
    const value = bubbleTemplateIsDefault(text, fallback) ? "" : text;
    const base = bubbleOutgoing(c.draft);
    const injection = { template: value, extra, ...((base.injection.placement || Object.keys(placement).length) ? { placement: { ...base.injection.placement, ...placement } } : {}) };
    React.useEffect(function () {
        let live = true;
        setPreview(current => ({ ...current, loading: true, error: "" }));
        const timer = setTimeout(() => {
            rpc("previewDialogueBubbleInstruction", { config: { ...base, enabled: true, injection: { ...injection, template: missing.length ? "" : value } } }, c.sessionId).then(
                result => { if (live) setPreview({ loading: false, text: String(result && result.instruction || ""), sections: result.sections || [], segments: result.segments || [], error: "" }); },
                error => { if (live) setPreview({ loading: false, text: "", sections: [], segments: [], error: String(error && error.message || error) }); });
        }, 250);
        return () => { live = false; clearTimeout(timer); };
    }, [value, extra, missing.length, JSON.stringify(base.characters), JSON.stringify(base.voice), JSON.stringify(base.emotions || [])]);
    React.useEffect(function () {
        let live = true;
        rpc("getDialogueBubbles", {}, c.sessionId).then(result => { if (live && result.placement) setLivePlacement(result.placement); }, () => {});
        return () => { live = false; };
    }, [c.sessionId]);
    function save() {
        if (missing.length) return;
        c.save({ ...c.draft, injection }, true);
        props.onClose();
    }
    function jump(kind) {
        if (missing.length) return;
        save();
        if (kind === "characters") c.openModal("packs", "card");
        else setTimeout(() => { const row = document.querySelector('[data-row="emotions"]'); if (row) { row.scrollIntoView({ block: "center" }); const button = row.querySelector("button"); if (button) button.focus(); } }, 0);
    }
    const voiceInactive = base.voice?.enabled && (base.characters || []).some(item => item.voice) ? "未启用（无需跨语言翻译）" : "未启用（没有绑定配音的角色）";
    const blocks = [
        { key: "format", title: "格式规则", source: "固定" },
        { key: "voice", title: "配音规则", source: "自动 · 来自角色的声音 / 配音语言", link: "角色", target: "characters" },
        { key: "emotions", title: "差分", source: "自动 · " + BUBBLE_MOODS.length + " 种内置 + " + (base.emotions || []).length + " 种自定义", link: "差分", target: "emotions" },
        { key: "characters", title: "角色表", source: "自动 · " + (base.characters || []).length + " 个角色，来自角色列表", link: "角色", target: "characters" }
    ];
    return h(LargeModal, { open: true, className: "fork-format-modal fork-prompt-modal", icon: "pencil", title: "对白提示词", subtitle: value ? "自定义" : "分块模式", onClose: props.onClose,
        help: h("span", null, "按注入顺序查看各块；补充要求放在最后。跳转配置会先保存当前修改。") },
        h("div", { className: "fork-prompt-editor" },
            value ? h("div", { className: "fork-prompt-custom-notice", role: "status" }, h("b", null, "正在使用自定义模板"),
                h(HelpTip, { label: "自定义模式说明" }, "下面各块仍按占位符展示生成内容；最终排列由自定义模板决定。{{bubble_format}} 包含格式和配音规则。"),
                h("button", { type: "button", className: "fork-bubble-link", onClick: () => setText(fallback) }, "恢复为分块模式")) : null,
            h(BubblePlacementCard, { data: livePlacement, changed: placement, onOpen: c.openWorldBook, onChange: (key, value) => setPlacement(current => ({ ...current, [key]: value })) }),
            blocks.map(block => {
                const section = preview.sections.find(item => item.key === block.key);
                const generated = section && section.text || "";
                return h(PromptPart, { key: block.key, block: block.key, foldable: true, title: block.title,
                    tags: [h("span", { key: "source", className: "fork-prompt-tag fork-prompt-source", title: block.source }, block.source),
                        block.key === "voice" && !generated && !preview.loading ? h("span", { key: "inactive", className: "fork-prompt-tag fork-prompt-inactive" }, voiceInactive) : null],
                    actions: block.link ? h("button", { type: "button", className: "fork-bubble-link", disabled: Boolean(missing.length), title: "保存并打开" + block.link, onClick: () => jump(block.target) }, block.link, " ↗") : null },
                    h("pre", { className: "fork-prompt-block-text" }, generated || (preview.loading ? "…" : block.key === "voice" ? voiceInactive : "未启用")));
            }),
            h(PromptPart, { className: "fork-prompt-extra", section: "extra", title: "补充要求", htmlFor: "fork-bubble-extra", help: "最多 2000 字，原样追加到最终提示词末尾；留空不追加" },
                h(TextArea, { id: "fork-bubble-extra", className: "fork-prompt-extra-input fork-edit", "aria-label": "补充要求", value: extra, rows: 3, maxLength: 2000, onChange: setExtra })),
            h(PromptPart, { className: "fork-prompt-custom", section: "custom", foldable: true, title: "完全自定义模板（高级）", helpLabel: "模板说明",
                help: h("span", null, "须保留 {{bubble_format}}、{{bubble_emotions}}、{{bubble_characters}}；旧版的玩家占位符展开为空；{{user}} 在预览和游戏中都替换为本局玩家名称。留空恢复分块模式。"),
                actions: h("button", { type: "button", className: "fork-bubble-link", onClick: () => setText(fallback) }, "恢复默认") },
                h(TextArea, { className: "fork-prompt-template fork-edit", "aria-label": "对白提示词模板", value: text, rows: 10, maxLength: 12000, spellCheck: false, onChange: setText })),
            missing.length ? h("p", { className: "fork-bubble-note is-error", role: "alert" }, "缺少 " + missing.map(token => "{{" + token + "}}").join("、")) : null,
            preview.error ? h("p", { className: "fork-bubble-note is-error", role: "alert" }, "预览失败：" + preview.error) : null,
            h("button", { type: "button", className: "fork-bubble-link fork-prompt-full-toggle", "aria-expanded": full, onClick: () => setFull(current => !current) }, "查看完整注入文本"),
            full ? h("pre", { className: "fork-prompt-preview", "aria-label": "实际注入预览", "aria-busy": preview.loading }, preview.segments.length ? preview.segments.map((segment, index) => h("span", { key: index, className: "fork-prompt-segment", "data-block": segment.key, title: segment.title }, segment.text + (index < preview.segments.length - 1 ? "\n" : ""))) : preview.text || (preview.loading ? "…" : "")) : null),
        h("div", { className: "fork-bubble-tools" },
            h("button", { type: "button", className: "dsh-tavern-btn fork-bubble-primary", disabled: Boolean(missing.length), onClick: save }, "保存"),
            h("button", { type: "button", className: "dsh-tavern-btn", onClick: props.onClose }, "取消")));
}