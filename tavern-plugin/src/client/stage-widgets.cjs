// Shared deterministic widget projection. No DOM, clock, storage or story writes.
const stageWidgetBuiltins = typeof window === 'undefined' && typeof require === 'function' ? require('./widget-definitions.cjs') : BUILTIN_STAGE_WIDGETS;
const stageWidgetContract = typeof window === 'undefined' && typeof require === 'function' ? require('./widget-contracts.cjs') : { stageWidgetSchemaValue, stageWidgetBytes, stageWidgetEffectiveOptions };
const STAGE_WIDGET_TYPES = Object.freeze(stageWidgetBuiltins.map(item => item.id));
const STAGE_WIDGET_SLOTS = Object.freeze(['top-center', 'corner-left', 'corner-right', 'center-card']);
const STAGE_WIDGET_TONES = Object.freeze(['theme', 'pink', 'info', 'warning']);
const STAGE_WIDGET_ICONS = Object.freeze(['none', 'alarm', 'message', 'letter', 'clock']);
const STAGE_WIDGET_NOTES = Object.freeze(Object.fromEntries(stageWidgetBuiltins.map(item => [item.id, item.note])));
function stageWidgetObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function stageWidgetProps(type, raw, definitions = stageWidgetBuiltins) {
    const definition = definitions.find(item => item.id === type);
    if (!definition || !stageWidgetObject(raw)) return null;
    try {
        const props = definition.thirdParty ? stageWidgetContract.stageWidgetSchemaValue(definition.propsSchema, raw) ? JSON.parse(JSON.stringify(raw)) : null : definition.normalize(raw);
        return props && stageWidgetContract.stageWidgetBytes(props) <= definition.caps.bytes ? props : null;
    } catch { return null; }
}
function stageWidgetPresentation(widget, definition) {
    const tune = definition.tuning || {}, options = stageWidgetContract.stageWidgetEffectiveOptions(definition, tune);
    const props = { ...widget.state };
    // Author options override presentation, not the director record or story clock.
    if (!definition.thirdParty) for (const [key, value] of Object.entries(options)) if (tune.options && Object.hasOwn(tune.options, key)) props[key] = value;
    if (tune.tone) props.tone = tune.tone;
    if (typeof tune.frame === 'boolean' && (definition.thirdParty || Object.hasOwn(props, 'frame'))) props.frame = tune.frame ? 'phone' : 'plain';
    let slot = widget.slotExplicit ? widget.slot : tune.slot || widget.slot;
    if (props.frame === 'phone' && !['corner-left', 'corner-right'].includes(slot)) slot = 'corner-right';
    return { ...widget, props, renderProps: definition.thirdParty ? widget.state : props, slot, options, scale: tune.scale || 1, definition };
}
function stageWidgetState(start, definitions = stageWidgetBuiltins) {
    // MVP is turn-local: a carried scene is useful, but never import previous widgets/time.
    return { definitions, time: 0, scene: start && start.scene || '', widgets: [], sequence: 0 };
}
function stageWidgetBoundary(state, at, scene, turnEnd) {
    const changed = Boolean(scene && scene !== state.scene);
    for (const widget of state.widgets) {
        if (widget.closed) continue;
        const life = widget.lifetime;
        if (turnEnd || life.until === 'paragraph' && at >= life.at || life.until === 'scene-change' && changed || life.durationSeconds !== undefined && state.time >= widget.bornStoryTime + life.durationSeconds) widget.closed = true;
    }
    if (scene) state.scene = scene;
}
function stageWidgetReduce(state, command, at, key) {
    const widget = state.widgets.find(item => item.widgetId === command.widgetId);
    if (command.op === 'widget.show') {
        const props = stageWidgetProps(command.type, command.props, state.definitions);
        if (widget || !props) return;
        state.widgets.push({ widgetId: command.widgetId, originKey: key, type: command.type, props, ...(command.slot ? { slotExplicit: true } : {}), slot: command.slot || (state.definitions.find(item => item.id === command.type)?.slot || 'corner-right'), lifetime: { until: 'turn-end', carryTurns: 0, ...command.lifetime }, bornAt: at, order: state.sequence++, bornStoryTime: state.time, deadline: Number.isSafeInteger(props.remainingSeconds) && props.remainingSeconds >= 0 ? state.time + props.remainingSeconds : null, clockRevision: 0, closed: false });
    } else if (command.op === 'widget.update' && widget && !widget.closed) {
        const props = stageWidgetProps(widget.type, command.props, state.definitions);
        if (!props) return;
        widget.props = props;
        if (Number.isSafeInteger(props.remainingSeconds) && props.remainingSeconds >= 0) { widget.deadline = state.time + props.remainingSeconds; widget.clockRevision++; } else widget.deadline = null;
    } else if (command.op === 'widget.hide' && widget) widget.closed = true;
}
// Version 2 is only the incremental director's already-validated persistent
// snapshot. Legacy version 1 remains strictly turn-local. Never import arbitrary
// start.widgets from old records or run wall clocks while reading history.
function stageWidgetPersistentState(snapshot, definitions = stageWidgetBuiltins) {
    if (!snapshot || snapshot.version !== 1 || !Number.isSafeInteger(snapshot.time) || snapshot.time < 0 || !Array.isArray(snapshot.widgets)) return null;
    const widgets = [], ids = new Set();
    for (const [order, raw] of snapshot.widgets.entries()) {
        if (!raw || typeof raw.widgetId !== 'string' || ids.has(raw.widgetId) || !raw.lifetime || !['explicit', 'scene-change', 'turn-end'].includes(raw.lifetime.until)) continue;
        const props = stageWidgetProps(raw.type, raw.props, definitions);
        if (!props || !STAGE_WIDGET_SLOTS.includes(raw.slot) || !Number.isSafeInteger(raw.bornStoryTime) || raw.bornStoryTime < 0 || raw.deadline !== null && !Number.isSafeInteger(raw.deadline)) continue;
        if (raw.lifetime.durationSeconds !== undefined && snapshot.time >= raw.bornStoryTime + raw.lifetime.durationSeconds) continue;
        ids.add(raw.widgetId);
        widgets.push({ ...raw, props, lifetime: { ...raw.lifetime }, originKey: raw.instanceId || raw.originKey || 'incremental:' + raw.widgetId + ':' + raw.bornStoryTime,
            bornAt: raw.bornAt || 0, order: raw.order ?? order, clockRevision: raw.clockRevision || 0, closed: false });
    }
    return { definitions, time: snapshot.time, scene: snapshot.scene || '', widgets, sequence: widgets.length };
}
function widgetsAt(turn, page, record, definitions = stageWidgetBuiltins) {
    if (!record || !turn || !turn.key || record.key !== turn.key || ![1, 2].includes(record.widgetsVersion) || !page || page.end || !Number.isInteger(page.para) || page.para < 1 || page.para > record.units) return [];
    if (record.widgetsVersion === 2) {
        if (record.protocol !== 'incremental-v1') return [];
        let snapshot = record.start && record.start.widgetState;
        for (const entry of record.entries || []) { if (entry.at > page.para) break; if (entry.widgetState) snapshot = entry.widgetState; }
        const state = stageWidgetPersistentState(snapshot, definitions);
        return state ? state.widgets.map(widget => ({ ...widget, ...(widget.deadline !== null ? { remainingSeconds: Math.max(0, widget.deadline - state.time) } : {}) })) : [];
    }
    const state = stageWidgetState(record.start, definitions);
    for (const entry of record.entries || []) {
        if (entry.at > page.para) break;
        if (Number.isSafeInteger(entry.widgetTime) && entry.widgetTime >= state.time) state.time = entry.widgetTime;
        stageWidgetBoundary(state, entry.at, entry.scene);
        for (const command of entry.commands || []) stageWidgetReduce(state, command, entry.at, record.key);
    }
    stageWidgetBoundary(state, page.para, null);
    return state.widgets.filter(widget => !widget.closed).map(widget => ({ ...widget, props: { ...widget.props }, lifetime: { ...widget.lifetime }, ...(widget.deadline !== null ? { remainingSeconds: Math.max(0, widget.deadline - state.time) } : {}) }));
}
function stageWidgetShownSeconds(widget, elapsedMs) {
    return Math.max(0, widget.remainingSeconds - (widget.props.tick === 'page-live' ? Math.floor(Math.max(0, elapsedMs) / 1000) : 0));
}
// Node (host/tests) only: inside the client bundle `module` is the plugin factory's own module object.
if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports = { stageWidgetBuiltins, stageWidgetPresentation, STAGE_WIDGET_TYPES, STAGE_WIDGET_SLOTS, STAGE_WIDGET_TONES, STAGE_WIDGET_ICONS, STAGE_WIDGET_NOTES, stageWidgetObject, stageWidgetProps, stageWidgetState, stageWidgetBoundary, stageWidgetReduce, stageWidgetPersistentState, widgetsAt, stageWidgetShownSeconds };
