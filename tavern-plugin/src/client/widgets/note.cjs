// Self-contained built-in definition; evaluated as an expression by the client assembler.
(function () {
    const type = "note";
    const STAGE_WIDGET_TONES = ['theme', 'pink', 'info', 'warning'];
    const STAGE_WIDGET_ICONS = ['none', 'alarm', 'message', 'letter', 'clock'];
    const stageWidgetObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const definition = {
        id: type, version: 1, title: "\u4fbf\u7b3a",
        // fidelity belongs to Widget rules; clue visibility is type-specific.
        note: "A readable note or letter; never hide required clues here.",
        propsSchema: {"type":"object","properties":{"tone":{"type":"string","enum":["theme","pink","info","warning"]},"icon":{"type":"string","enum":["none","alarm","message","letter","clock"]},"title":{"type":"string","maxLength":60},"body":{"type":"string","maxLength":1600,"minLength":1},"style":{"type":"string","enum":["note","letter","memo"]}},"required":["body"],"additionalProperties":false},
        optionsSchema: {"type":"object","properties":{"style":{"type":"string","enum":["note","letter","memo"],"default":"note"}},"required":[],"additionalProperties":false},
        caps: { bytes: 12288, active: 1 },
        slot: "center-card",
        samples: [{"title":"Letter","body":"Keep this safe.","style":"letter"}],
        normalize(raw) {
            if (!stageWidgetObject(raw)) return null;
            if (Object.keys(raw).some(key => !["tone","icon","title","body","style"].includes(key))) return null;
            const text = (value, cap, required) => typeof value === 'string' && [...value].length <= cap && (!required || value.trim().length > 0);
            const pick = (name, values, fallback) => raw[name] === undefined ? fallback : values.includes(raw[name]) ? raw[name] : null;
            const props = { tone: pick('tone', STAGE_WIDGET_TONES, 'theme'), icon: pick('icon', STAGE_WIDGET_ICONS, 'none') };
            if (!props.tone || !props.icon) return null;
            if (raw.title !== undefined && !text(raw.title, 60, false)) return null;
            props.title = raw.title || '';
            if (!text(raw.body, 1600, true)) return null;
            props.body = raw.body;
            props.style = pick('style', ['note', 'letter', 'memo'], 'note'); if (!props.style) return null;
            return props;
        },
        render({ React, widget, seconds, Icon }) {
            const h = React.createElement, p = widget.props;
            return h('p', { className: 'fork-widget-body' }, p.body);
        }
    };
    if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = definition;
    return definition;
})()
