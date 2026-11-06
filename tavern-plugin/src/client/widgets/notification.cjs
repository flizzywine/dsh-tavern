// Self-contained built-in definition; evaluated as an expression by the client assembler.
(function () {
    const type = "notification";
    const STAGE_WIDGET_TONES = ['theme', 'pink', 'info', 'warning'];
    const STAGE_WIDGET_ICONS = ['none', 'alarm', 'message', 'letter', 'clock'];
    const stageWidgetObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const definition = {
        id: type, version: 1, title: "\u901a\u77e5",
        // fidelity and no-invention rules belong to Widget rules.
        note: "A brief notification with sender and message.",
        propsSchema: {"type":"object","properties":{"tone":{"type":"string","enum":["theme","pink","info","warning"]},"icon":{"type":"string","enum":["none","alarm","message","letter","clock"]},"app":{"type":"string","maxLength":40},"title":{"type":"string","maxLength":60},"body":{"type":"string","maxLength":240,"minLength":1},"frame":{"type":"string","enum":["plain","phone"]}},"required":["body"],"additionalProperties":false},
        optionsSchema: {"type":"object","properties":{},"required":[],"additionalProperties":false},
        caps: { bytes: 12288, active: 1 },
        slot: "corner-right",
        samples: [{"app":"Inbox","title":"Message","body":"Meet me outside.","frame":"phone"}],
        normalize(raw) {
            if (!stageWidgetObject(raw)) return null;
            if (Object.keys(raw).some(key => !["tone","icon","app","title","body","frame"].includes(key))) return null;
            const text = (value, cap, required) => typeof value === 'string' && [...value].length <= cap && (!required || value.trim().length > 0);
            const pick = (name, values, fallback) => raw[name] === undefined ? fallback : values.includes(raw[name]) ? raw[name] : null;
            const props = { tone: pick('tone', STAGE_WIDGET_TONES, 'theme'), icon: pick('icon', STAGE_WIDGET_ICONS, 'none') };
            if (!props.tone || !props.icon) return null;
            if (raw.title !== undefined && !text(raw.title, 60, false)) return null;
            props.title = raw.title || '';
            if (!text(raw.body, 240, true)) return null;
            props.body = raw.body;
            props.frame = pick('frame', ['plain', 'phone'], 'plain'); if (!props.frame) return null;
            if (raw.app !== undefined && !text(raw.app, 40, false)) return null;
            props.app = raw.app || '';
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
