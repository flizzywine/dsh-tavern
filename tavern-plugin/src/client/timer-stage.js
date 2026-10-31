// @include-mod timer/clock.cjs
// @include timer-logic.cjs
// @include mod-options.js
// the dsh.timer countdown on the stage.
// Every request names the page on screen (turn/at/offset): a page behind the live frontier whose own countdown has since
// stopped shows it frozen at that page's floor (host tavern-plugin/mods/timer/stage-clock.js behind), not the live clock's later state.
// The host timestamps director events and stage-open/close boundaries. Display is arithmetic on that clock;
// playback, page responses and window visibility cannot pause it. History projects the first floor snapshot.
// Periodic durable samples recover an unclean host exit; they never establish display anchors.
// The look is the mod's resolved options (timerLook): the active skin's values, art and locks over the mod's preset.

// The mod's own built-in art (the pill's icon).
let timerBuiltinRead = null;
function timerBuiltin(sessionId) {
    return timerBuiltinRead ||= rpc('getStageTimerLooks', {}, sessionId).catch(error => { timerBuiltinRead = null; throw error; });
}
// Live events already handed to consumers / fallback offers already given to the input lock, by event id (this page only:
// a refresh never recovers an offer from the saved checkpoint).
const timerConsumedOffers = new Set();

function useStageTimer(...args) { return stageViews.timer.useTimer(...args); }
// The timeup's performance (asset onTimeup) through the ordinary performance admission and resource owner, drawn by the
// shared keyframe player on the stage root; nothing is played when the host says it is unavailable.
async function timerPlayReaction({root, sessionId, source, turn, at, token, event, safety}) {
    const answer = await rpc('getStageTimerReaction', {turn, at, expectedDirectionToken:token, eventId:event.id}, sessionId).catch(() => null);
    if (answer?.status !== 'ready' || !root?.isConnected) return;
    const owner = stageSessions.resourceOwner, value = answer.performance;
    const prepared = await owner.prepare(value, stageResourceAuthority(source), {usage:'timer-reaction'});
    const rects = createStageRects({root, schedule:fn => forkForeground.requestAnimationFrame(fn), cancel:id => forkForeground.cancelAnimationFrame(id)});
    const layer = createPerformanceKeyframeLayer({root, owner, foreground:forkForeground, rects, safety});
    const keyframes = prepared.value.dependencies.find(item => item.ref?.kind === 'performances')?.document?.keyframes;
    layer.apply({type:'layer', value:{...prepared.value, phase:'entry'}, token:{id:'timer:' + event.id}, descriptor:null, snap:false, handles:prepared.pins.map(pin => pin.handle)});
    forkForeground.setTimeout(() => { layer.dispose(); rects.dispose(); prepared.release(); }, (keyframes?.entry?.durationMs || 6000) + 600);
}

// Input and visibility guard the optional fallback action, not the clock.
function useStageTimerSlot({sessionId, rootRef, reading, source, token, turn, mode, visit, at, offset, waiting, sending, running, skinKey = ''}) {
    const [visible, setVisible] = React.useState(true);
    React.useEffect(() => forkForeground.subscribe(setVisible), []);
    const [inputStarted, setInputStarted] = React.useState(false);
    const fallbackRef = React.useRef(null), gate = React.useRef(null);
    const [notice, setNotice] = React.useState(null);
    gate.current = {consumed:timerConsumedOffers, live:mode === 'live', visible, waiting, inputStarted, sending, running, turn, source:token};
    const state = useStageTimer({sessionId, mode, visit, turn, at, offset, token,
        view:{waitingForInput:waiting, inputStarted},
        onEvent:event => {
            // The one stage event (skin / performance consumers): a DOM event on the stage, then the entry's own onTimeup.
            rootRef.current?.dispatchEvent(new CustomEvent('fork-stage-event', {detail:event}));
            if (event.onTimeup) timerPlayReaction({root:rootRef.current, sessionId, source, turn:event.turn, at:event.at, token:event.source, event,
                safety:() => performanceSafety(reading, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)}).catch(error => console.warn('Timer reaction unavailable', error));
        },
        onFallback:offer => {
            if (!timerFallbackAllowed(offer, gate.current)) return;
            timerConsumedOffers.add(offer.eventId);
            if (!fallbackRef.current?.(offer.action)) return;
            setNotice('时间到，已替你回应：' + offer.action);
            forkForeground.setTimeout(() => setNotice(null), 5000);
        }});
    const [builtin, setBuiltin] = React.useState(null);
    React.useEffect(() => { if (state.timer && !builtin) timerBuiltin(sessionId).then(setBuiltin, () => {}); }, [!!state.timer]);
    const look = timerLook(useModOptions(sessionId, 'dsh.timer', {enabled:!!state.timer, skinKey}), builtin);
    // shown: the timer is on the stage (StageTimer draws it) - the skin's hud.timer arrangement follows it.
    return {element:React.createElement(stageViews.timer.Component, {state, look, reducedMotion:reading.reducedMotion === true, notice}),
        shown:Boolean(state.timer && look), onInputActivity:setInputStarted, fallbackRef};
}
