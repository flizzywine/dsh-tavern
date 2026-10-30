// Self-contained built-in definition; evaluated as an expression by the client assembler.
(function () {
    const type = "chat-thread";
    const STAGE_WIDGET_TONES = ['theme', 'pink', 'info', 'warning'];
    const STAGE_WIDGET_ICONS = ['none', 'alarm', 'message', 'letter', 'clock'];
    const stageWidgetObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const definition = {
        id: type, version: 1, title: "\u804a\u5929\u8bb0\u5f55",
        // source fidelity belongs to Widget rules; order is type-specific.
        note: "A message thread in its original order.",
        propsSchema: {"type":"object","properties":{"tone":{"type":"string","enum":["theme","pink","info","warning"]},"icon":{"type":"string","enum":["none","alarm","message","letter","clock"]},"title":{"type":"string","maxLength":60},"frame":{"type":"string","enum":["plain","phone"]},"messages":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"object","properties":{"from":{"type":"string","maxLength":40,"minLength":1},"text":{"type":"string","maxLength":240,"minLength":1},"side":{"type":"string","enum":["in","out"]}},"required":["from","text","side"],"additionalProperties":false}}},"required":["messages"],"additionalProperties":false},
        optionsSchema: {"type":"object","properties":{},"required":[],"additionalProperties":false},
        caps: { bytes: 12288, active: 1 },
        slot: "corner-right",
        samples: [{"title":"Chat","messages":[{"from":"Alice","text":"Here?","side":"in"},{"from":"Bob","text":"Yes.","side":"out"}],"frame":"phone"}],
        normalize(raw) {
            if (!stageWidgetObject(raw)) return null;
            if (Object.keys(raw).some(key => !["tone","icon","title","messages","frame"].includes(key))) return null;
            const text = (value, cap, required) => typeof value === 'string' && [...value].length <= cap && (!required || value.trim().length > 0);
            const pick = (name, values, fallback) => raw[name] === undefined ? fallback : values.includes(raw[name]) ? raw[name] : null;
            const props = { tone: pick('tone', STAGE_WIDGET_TONES, 'theme'), icon: pick('icon', STAGE_WIDGET_ICONS, 'none') };
            if (!props.tone || !props.icon) return null;
            if (raw.title !== undefined && !text(raw.title, 60, false)) return null;
            props.title = raw.title || '';
            if (!Array.isArray(raw.messages) || raw.messages.length < 1 || raw.messages.length > 8) return null;
            props.messages = [];
            for (const message of raw.messages) {
                if (!stageWidgetObject(message) || Object.keys(message).some(key => !['from', 'text', 'side'].includes(key)) || !text(message.from, 40, true) || !text(message.text, 240, true) || !['in', 'out'].includes(message.side)) return null;
                props.messages.push({ from: message.from, text: message.text, side: message.side });
            }
            props.frame = pick('frame', ['plain', 'phone'], 'plain'); if (!props.frame) return null;
            return props;
        },
        render({ React, widget, seconds, Icon }) {
            const h = React.createElement, p = widget.props;
            return h('div', { className: 'fork-widget-messages' }, p.messages.map((message, i) => h('div', { key: i, className: 'fork-widget-message', 'data-side': message.side }, h('b', null, message.from), h('p', null, message.text))));
        }
    };
    if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = definition;
    return definition;
})()
