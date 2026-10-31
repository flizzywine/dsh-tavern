// galgame stage view.
// A presentation of the same reply the chat view shows: it never writes story, variables
// or prompts. The session runtime owns text, observation and accepted presentation.
// The chat view can stay frozen or unmounted; backlog reads the same session index.

// @include-domain stage-narration.cjs
// @include widget-source.js
// @include phone-settings.js
// @include stage-offstage.cjs
// @include-protocol stage-pacing.cjs
// @include-protocol stage-soundscape.cjs
// @include gal-history.js
// @include mod-performance.js
// @include textcard-stage.js
// @include gal-entry.js
// @include stage-video.js
// @include stage-entrance.js
// @include timer-stage.js

// @include gal-stage-helpers.cjs
// @include gal-stage-active.cjs
function GalTypewriter(props) {
    return stageViews ? React.createElement(stageViews.Typewriter, props) : null;
}
function GalNarrationLines(props) {
    return stageViews ? React.createElement(stageViews.NarrationLines, props) : null;
}
function GalBoxFrame(props) { return stageViews ? React.createElement(stageViews.BoxFrame, props) : null; }
// Scene names are 「地点·细节·时间」. When the cued scene has no picture yet (待补图), stand in with the
// closest picture of the card's range: shared place words first, then the same time of day, and grade
// the picture towards the wanted time (a night filter over a daytime street) rather than show sunshine.
const GAL_TIMES = [["night", /夜|晚上|深夜|午夜/], ["dusk", /黄昏|傍晚|夕/], ["day", /清晨|早晨|早上|晨|白天|昼|中午|午后|下午|上午|晴/]];
function galTimeOf(name) { const hit = GAL_TIMES.find(([, pattern]) => pattern.test(String(name || ""))); return hit ? hit[0] : ""; }
function galStandIn(name, entries) {
    const parts = String(name || "").split(/[·・\s]+/).filter(part => part && !galTimeOf(part));
    const time = galTimeOf(name);
    let best = null, bestScore = 0;
    entries.forEach(function (entry) {
        const words = entry.name.split(/[·・\s]+/);
        let score = 0;
        parts.forEach(part => { if (words.includes(part)) score += 4; else if (words.some(word => word.includes(part) || part.includes(word))) score += 2; else { const shared = new Set([...part].filter(ch => entry.name.includes(ch))).size; if (shared >= 2) score += shared * 0.8; } });
        if (time && galTimeOf(entry.name) === time) score += 1.5;
        if (score > bestScore) { best = entry; bestScore = score; }
    });
    return bestScore >= 1.5 ? best : null;
}
function GalFace(props) { return stageViews ? React.createElement(stageViews.Face, props) : null; }
function GalSide(props) { return stageViews ? React.createElement(stageViews.Side, props) : null; }
function galPlaceholderFace(...args) { return stageViews.placeholderFace(...args); }
function GalTitle(props) { return stageViews ? React.createElement(stageViews.Title, props) : null; }
// Machine preference: film mode (letterbox + subtitles instead of the dialogue box), off by default.
const stageFilm = (function () {
    const KEY = "fork-stage-film";
    const listeners = new Set();
    function get() { try { return localStorage.getItem(KEY) === "on"; } catch (_) { return false; } }
    return {
        get,
        set(value) { try { localStorage.setItem(KEY, value ? "on" : "off"); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useStageFilm() { return React.useSyncExternalStore(stageFilm.subscribe, stageFilm.get); }
// Machine preference: reading pace (Config → 文字). textSpeed = milliseconds per typed character (0 = the whole
// line at once); autoWait = the auto mode's pause after a line's voice ends. A silent page waits its reading
// time (galAutoHold) shifted by the same amount. autoSpeed scales both waits;
// the 1.3x default shortens idle dwell without speeding up or cutting off speech.
// voiceRate: every dialogue voice clip plays this much faster, pitch preserved (Config → 声音).
// textScale: { skinId: percent } (CONFIG 文字大小): the stage text at that percent of the skin's own size;
// a skin without an entry is at 100%.
// hudReveal: CONFIG 顶栏按钮 (PROPOSAL §二) - 'auto' | 'always' over the skin's hud.reveal; null = the skin's choice.
// The auto waits and a silent page's reading time (galAutoHold) are stage-auto-timing.cjs, shared with clip exports.
// @include stage-auto-timing.cjs
const STAGE_READING_DEFAULTS = { textSpeed: 28, autoWait: STAGE_AUTO.wait, autoSpeed: STAGE_AUTO.speed, voiceRate: 1, frameCap: 60, reducedMotion:false, photosensitive:true, textScale:{}, hudReveal:null };
const STAGE_READING_LIMITS = { textSpeed: [0, 80, 2], autoWait: [0, 3000, 100], autoSpeed: [0.5, 3, 0.1], voiceRate: [0.8, 2, 0.1] }; // [min, max, step]
const STAGE_TEXT_SCALE = [70, 130, 5]; // [min, max, step] percent of the skin's own size
function stageTextScaleMap(map) {
    const [min, max, step] = STAGE_TEXT_SCALE, out = {};
    for (const [skin, value] of Object.entries(map)) {
        const percent = Math.max(min, Math.min(max, Math.round(Number(value) / step) * step));
        if (Number.isFinite(percent) && percent !== 100) out[skin] = percent;
    }
    return out;
}
// The current skin's percent (no entry = 100%); the stage root carries it as --fk-text-scale and the pager re-fits.
function stageTextScaleOf(reading, skin) { return reading.textScale[skin] || 100; }
function stageReadingPrefs(saved) {
    const out = { ...STAGE_READING_DEFAULTS };
    if (!saved || typeof saved !== "object") return out;
    if ([0, 30, 60, 120].includes(saved.frameCap)) out.frameCap = saved.frameCap;
    for (const key of ['reducedMotion','photosensitive']) if (typeof saved[key] === 'boolean') out[key]=saved[key];
    if (saved.hudReveal === 'auto' || saved.hudReveal === 'always') out.hudReveal = saved.hudReveal;
    if (saved.textScale && typeof saved.textScale === 'object') out.textScale = stageTextScaleMap(saved.textScale);
    for (const key of Object.keys(STAGE_READING_LIMITS)) {
        const [min, max, step] = STAGE_READING_LIMITS[key], value = Number(saved[key]);
        if (saved[key] !== null && saved[key] !== "" && Number.isFinite(value)) out[key] = Math.max(min, Math.min(max, Number((Math.round(value / step) * step).toFixed(3))));
    }
    return out;
}

// skip (SKIP control or held Ctrl) turns a page every 150 ms, each painted fully before the
// next: 9 frames at 60 Hz (5 at a 30 fps cap), long enough to see each page and its snapped staging as a distinct
// frame, short enough for a 40-page round in about 6 s. It never waits for a performance: only a
// paragraph whose director prefix has not arrived holds it (data, not a performance). What it still shows is
// stageSkipShows (stage-runtime.cjs).
const GAL_SKIP_PAGE_MS = 150;
// The reader's auto wait on a page (stage-auto-timing.cjs stageAutoDelay) from a saved or partial reading preference.
function galAutoDelay(reading, voiced, text) {
    const wait = reading && Number.isFinite(reading.autoWait) ? reading.autoWait : STAGE_READING_DEFAULTS.autoWait;
    return stageAutoDelay(wait, stageReadingPrefs(reading).autoSpeed, voiced, text);
}
const stageReading = (function () {
    const KEY = "fork-stage-reading";
    const listeners = new Set();
    let cached = null;
    function get() {
        if (!cached) { let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {} cached = stageReadingPrefs(saved); }
        return cached;
    }
    return {
        get,
        set(patch) {
            cached = stageReadingPrefs({ ...get(), ...patch });
            try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch (_) {}
            listeners.forEach(fn => fn());
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useStageReading() { return React.useSyncExternalStore(stageReading.subscribe, stageReading.get); }

function GalStage(props) {
    const h = React.createElement;
    const sessionId = props.sessionId;
    const runtime = useStageRuntime(sessionId);
    const partsMap = React.useMemo(() => new Map([...runtime.textIndex.values()].flatMap(row => (row.unloaded ? [{scope:'unloaded:' + row.turn,turn:row.turn,segments:[],unloaded:true}] : row.parts).map(part => [part.scope, part]))), [runtime.textIndex]);
    const config = props.data && props.data.config || { characters: [] };
    const [, redraw] = React.useState(0);
    React.useEffect(() => voicePlayer.subscribe(() => redraw(n => n + 1)), []);
    const grouped = React.useMemo(() => stageViews.position.turnIndex(partsMap ? Array.from(partsMap.values()) : []), [partsMap]);
    const turns = Array.from(runtime.textIndex.keys()).sort((a, b) => a - b);
    const latestTurn = runtime.latestSource?.turn || turns[turns.length - 1] || 0;
    if (latestTurn && !turns.includes(latestTurn)) turns.push(latestTurn);
    // The active session string does not change when an entry targets an already mounted stage.
    const entry = React.useSyncExternalStore(galActive.subscribe, () => {const entry = galCurrentEntry(); return entry?.sessionId === sessionId ? entry : null;});
    const initial = React.useMemo(() => ({ saved: stageViews.position.readBookmark(sessionId), entry }), [sessionId]);
    const turn = runtime.source?.turn || latestTurn;
    const target = entry;
    const viewed = runtime.source;
    const resumeReady = true;
    const parts = grouped.get(turn) || [];
    const voiceAvailable = stageVoiceAvailable();
    const pages = runtime.text.pages.map(page => ({...page, para:page.anchor.para,
        voice:stageVoiceHandle(sessionId,page.voice,config,page.anchor.paragraphId,voiceAvailable)}));
    const turnIndex = turns.indexOf(turn);
    const [restored, setRestored] = React.useState(null);
    const restoreLoading = React.useRef(null);
    const [page, setPage, savedPosition, markRead] = useStagePosition(sessionId,runtime,parts,pages,
        {restored:restored === sessionId, onSelect:() => setRestored(sessionId)});
    React.useLayoutEffect(() => {
        if (restored === sessionId) return;
        const saved = initial.saved;
        if (!initial.entry && saved && latestTurn < (saved.latestSeenTurn || saved.turn)) return;
        const selected = stageViews.position.resumeTurn(saved,turns,initial.entry), row = runtime.textIndex.get(selected);
        if (row?.unloaded) {
            const key = sessionId + ':' + selected;
            if (restoreLoading.current !== key) {
                restoreLoading.current = key;
                void stageSessions.owner.navigate(sessionId,selected,saved?.page || 0,selected === latestTurn && !initial.entry,initial.entry?.para,!initial.entry);
            }
            return;
        }
        if (!row) return;
        let textDigest = null;
        const digestOf = () => textDigest === null ? (textDigest = stageViews.position.digest(row.parts)) : textDigest;
        if (!stageViews.position.ready(initial.entry ? null : saved,selected,row.parts,row.text.pages,digestOf)) return;
        const index = initial.entry?.para ? row.text.pages.findIndex(page => page.anchor.para >= initial.entry.para) :
            stageViews.position.restore(saved,selected,row.text.pages.length,digestOf(),row.text.pages).page;
        // A restored position (reload) shows its history page still (it never auto-plays); an explicit entry is a jump.
        stageSessions.owner.navigate(sessionId,selected,Math.max(0,index || 0),selected === latestTurn && !initial.entry,initial.entry?.para,!initial.entry);
        setRestored(sessionId);
    },[sessionId,runtime.textIndex,latestTurn,restored]);
    const [transition, setTransition] = React.useState(null);
    const transitioning = transition === turn;
    const playerInputs = useGalPlayerInputs(sessionId, props.choiceProps && props.choiceProps.useChat);
    const film = useStageFilm();
    const textScales = useStageReading().textScale;
    const subtitles = stageViews.subtitles.useSubtitles(film, pages, page, sessionId + ":" + turn, config.stage && config.stage.theme, textScales, !transitioning);
    const card = subtitles.card;
    const lastCard = card >= subtitles.cards.length - 1;
    const [typed, setTyped] = React.useState(false);
    React.useLayoutEffect(function () { setTyped(false); }, [sessionId, turn, runtime.source?.generation]);
    const readingPage = transitioning ? { kind: "transition", para: pages[page]?.para || 1, text: playerInputs[turns[turnIndex + 1]] || "（这一轮没有可显示的玩家输入）" } : pages[page] || null;
    // the player's input page (「你 · 第 N 轮」) is paginated by the same pager into cards that fit the
    // box (kinsoku, balanced last card); paging forward and back walks its cards like any page's (go). The input shows
    // at most stageViews.subtitles.inputCards cards, the last one ending in 「……」 when the input needs more; the backlog keeps it whole.
    const inputSubtitles = stageViews.subtitles.useSubtitles(film, transitioning ? [readingPage] : [], 0, sessionId + ":" + turn + ":input", config.stage && config.stage.theme, textScales, transitioning, stageViews.subtitles.inputCards);
    const inputCard = transitioning ? inputSubtitles.card : 0, inputLast = inputCard >= inputSubtitles.cards.length - 1;
    const textRef = React.useCallback(node => { subtitles.textRef(node); inputSubtitles.textRef(node); }, [subtitles.textRef, inputSubtitles.textRef]);
    const streaming = parts.some(part => part.streaming);
    // only a clip export (clip-render.js) replays a round, from its starting state,
    // everything as if live (stage-runtime.cjs mode 'replay'); the player has no replay (removed 回放本轮)
    // and history reading never plays.
    const replaying = runtime.cursor.mode === 'replay', presenting = runtime.cursor.mode === 'history' ? 'history' : 'live';
    // The latest round's last line is on screen (complete). The end panel waits for the player to turn past it (atEnd below).
    const atLastLine = !replaying && turn === latestTurn && !transitioning && !streaming && lastCard && page >= pages.length - 1 && (!readingPage || !readingPage.pending);
    // the position the player turned past the last line at; any
    // other position (another page or card, a new generation, a reopened round) has not been turned past.
    const [endedAt, setEndedAt] = React.useState(null);
    const endKey = sessionId + ":" + turn + ":" + (runtime.source?.generation ?? "") + ":" + page + ":" + card;
    const stageConfig = config.stage || {};
    const offstage = stageOffstage(config);
    const [sceneVisit, setSceneVisit] = React.useState(0);
    const [forwardReading, setForwardReading] = React.useState(false);
    // After a choice is sent, the old turn stays on screen until the reply starts streaming;
    // show a "writing" state so the stage never looks stuck.
    const useSession = props.choiceProps && props.choiceProps.useSession;
    const running = useSession ? useSession(snapshot => snapshot.running === true) : false;
    // the system-menu action shares upstream settlement activity.
    const regenerationActivity = useTavernCoordination(sessionId, String(running) + ":" + latestTurn);
    // the worldbook prefilter yields to any other task and never blocks the player (as in
    // describeTavernActivity); counting it flipped 重新生成 on and off at every turn end.
    const regenerationBusy = regenerationActivity.view?.activity?.role !== "worldbook-filter" && (regenerationActivity.view?.activity?.busy || regenerationActivity.view?.activity?.phase === "pending");
    const awaitingText = galAwaitingText(regenerationActivity.view?.activity);
    const bodyFailure = useStageSelector(sessionId, state => state.interrupted && state.cursor.mode !== 'history');
    // The failed attempt is a native turn the host replays (the chat's 重新生成本轮); a rejected send has none.
    const bodyRetry = useStageSelector(sessionId, state => state.retryable) && typeof props.replayFailed === 'function' ? () => props.replayFailed(sessionId) : null;
    const [waiting, setWaiting] = React.useState(null); // { turn, text, seen }
    // a submit holds the wait until the reply has a page to
    // read - on the submitting turn and on the new turn before its first page - so no frame between them falls back to
    // the box's normal (empty) state.
    const sending = Boolean(waiting && (waiting.turn === turn || !readingPage)) || (running && atLastLine && !streaming);
    const receivedDirection = {...runtime.director, status:runtime.director.phase === 'partial' ? 'running' : runtime.director.phase};
    const regenerateBlocked = Boolean(!latestTurn || running || streaming || regenerationBusy || ["running", "partial"].includes(receivedDirection?.status));
    const entryKey = sessionId + ':' + sceneVisit;
    const accepted = runtime.accepted;
    const interopNotice = useCapabilityNotice(sessionId, runtime.cursor.mode === 'live', accepted.scene?.interopNotices);
    // with 「导演布景」 off the scene shows the manual picture; director state is untouched.
    const pack = {state:accepted.layout?.state || accepted.scene?.state, scene:useBgManualScene(sessionId, accepted.scene), characters:accepted.figures || [],
        avatars:accepted.avatars || [], widgets:accepted.widgets || [],
        audio:{music:accepted.music,soundscape:accepted.ambience,sfx:[]}, core:accepted.layout?.core || accepted.scene?.core || ''};
    const rootRef = React.useRef(null);
    // the load gate is the one readiness authority; a 入场演出 (stage-entrance.js) holds what the
    // player sees (entryGate) on loading until its cover, while the scene renderer starts as soon as the load is ready.
    // The configured skin's first bundle read holds the reveal (set below, read by the gate's poll).
    const skinLoadingRef = React.useRef(false);
    const loadGate = useGalEntry(runtime.store, rootRef, skinLoadingRef);
    const entrance = useStageEntrance(runtime.store, stageConfig.entrance, loadGate);
    const entryGate = entrance.gate;
    const entryLoader = useGalEntryLoader(entrance.active ? null : stageConfig.skin);
    // the current load's real progress (stage-load-progress.cjs).
    const loadProgress = useStageLoadProgress(sessionId);
    const sceneHolding = !entryGate.visible;
    // The session's performance kinds (core and the installed managed mods'), read into the runtime as the stage opens.
    const performanceKinds = useStagePerformanceKinds(sessionId, runtime.store);
    const firstRun = useGalFirstRunHints(entryGate.visible, rootRef, turn + ':' + page);
    // the page shown at the entry reveal; figures that finish loading while it is still the
    // page on screen fade in (the scene keeps snapping figures that were ready at the reveal).
    const entryPage = React.useRef(null);
    React.useEffect(function () {
        if (!waiting) return;
        if (waiting.turn !== turn && readingPage) { setWaiting(null); return; }
        if (running && !waiting.seen) { setWaiting({ ...waiting, seen: true }); return; }
        if (!running && waiting.seen) { setWaiting(null); return; }
        // submit acknowledgement bookkeeping is not a presentation timer.
        if (!waiting.seen) { const timer = setTimeout(() => setWaiting(null), 15000); return () => clearTimeout(timer); }
    }, [waiting, running, turn, Boolean(readingPage)]);
    // The completed previous page must not hide the submit acknowledgement.
    // Once the new source has text it always wins, even without any direction.
    const awaiting = sending && (!streaming || !readingPage) || !readingPage && runtime.indicators.writing;
    // while the body is written the text box rotates the wait lines shared with
    // the choice panel (wait-lines.js); each wait opens on its own line and keeps its cycle across re-renders.
    const writingWaitRef = React.useRef(null);
    if (!awaiting) writingWaitRef.current = null;
    else if (!writingWaitRef.current) writingWaitRef.current = stageWaitLinesEpisode(null, "writing");
    // the stage notice is one block with two layers - the page layer
    // 「正在生成演出…」 (indicators.awaitingDirection) and under it the round's phase 「正在生成正文…」 / 「正在生成后续演出…」
    // (indicators.roundPhase) on whatever page of the round is read. Before the first page the text box's wait owns the stop.
    const roundPhase = awaiting ? null : runtime.indicators.roundPhase;
    // 停止 while the round works - on the text box's wait, or on
    // the round line once a page shows (StageWaitStop, wait-lines.js). The host stops the run and withdraws the
    // uncommitted pick (round-history interrupt: the failed-tail clearing of 撤回这条输入), so the stage lands back on
    // the end of the previous round - its last page, typed, the same choices live again; typed or edited words wait in
    // 自由输入. A body that committed first is a Round and stays (nothing is withdrawn); the same stop cancels its staging
    // (lib/index.js interruptTurn: stageDirector.cancel), so later pages read with heuristic staging.
    const pickRef = React.useRef(null); // { text, offered } of the last pick sent from the stage
    const [stopping, setStopping] = React.useState(false);
    const [withdrawal, setWithdrawal] = React.useState(null); // { branch, text, landed, done }
    const interruptTurn = props.choiceProps && props.choiceProps.interruptTurn;
    const stopReply = typeof interruptTurn === "function" && (awaiting || roundPhase) ? async function () {
        if (stopping) return;
        forkUiSfx.play("cancel");
        setAuto(false); setSkipping(false);
        setStopping(true);
        const branch = runtime.source && runtime.source.branchId;
        const view = await interruptTurn(sessionId);
        setStopping(false);
        if (!view || !view.withdrawn) return;
        const pick = pickRef.current;
        pickRef.current = null;
        setWaiting(null);
        setWithdrawal({ branch, text: pick && pick.offered ? "" : String(view.clearedInput || pick && pick.text || ""), landed: false, done: false });
    } : null;
    // The withdrawal changes the stage branch (suppressed turns are part of its context); on the new branch the latest turn
    // is the previous round: go to its last page once, and count it as read there so its choices come straight back.
    React.useEffect(function () {
        if (!withdrawal || withdrawal.done || running || !runtime.source || runtime.source.branchId === withdrawal.branch || turn !== latestTurn) return;
        if (!withdrawal.landed) {
            setWithdrawal({ ...withdrawal, landed: true });
            if (pages.length > 1) stageSessions.owner.navigate(sessionId, turn, -1, true);
            return;
        }
        if (page >= pages.length - 1) { setTyped(true); setEndedAt(endKey); setWithdrawal({ ...withdrawal, done: true }); }
    }, [withdrawal, running, runtime.source, turn, latestTurn, page, pages.length]);
    const current = readingPage;
    const openingOnly = !current && atLastLine && !awaiting && Boolean(runtime.source);
    const figureRecord = receivedDirection;
    const direction = receivedDirection;
    const [hidden, setHidden] = React.useState(false);
    // the box's slot for the choices wait (gal-choices.js portals it here).
    const [choiceWaitSlot, setChoiceWaitSlot] = React.useState(null);
    const [auto, setAuto] = React.useState(false);
    // Skip is either latched (the SKIP control) or held (Ctrl down, like most galgames).
    const [skipLatch, setSkipping] = React.useState(false);
    const [skipHeld, setSkipHeld] = React.useState(false);
    const skipPossibleRef = React.useRef(false);
    const skipping = skipLatch || skipHeld;
    // the round is read to its end - the end panel (choices, their 生成选项 wait, 自由输入) is up,
    // and auto / skip have nothing left. One rule for every skin: the last line stays on screen with its voice until the player
    // turns past it like any other page (click / key / wheel: go below; auto after the voice and the usual auto wait). Skip
    // passes it at once, in the same frame (no frame of the last line without the panel; skip plays no voice). A round with
    // nothing to read (openingOnly) is at its end.
    const atEnd = atLastLine && (!readingPage || endedAt === endKey || skipping);
    // Backlog (gal-backlog.js): while open, auto and skip pause and the choices are hidden.
    const [backlog, setBacklog] = React.useState(false);
    const backlogClosedAt = React.useRef(0);
    // The remaining cues are speculative: they load after the entry, not in its six connections.
    React.useEffect(() => { if (entryGate.visible) forkUiSfx.preload(); }, [entryGate.visible]);
    // galgame UI cues (ui-sfx.js) on the user-facing open / close paths only.
    function openBacklog() { forkLipSync.wake(); forkUiSfx.play("open"); setHidden(false); setBacklog(true); }
    function closeBacklog() { forkUiSfx.play("close"); backlogClosedAt.current = Date.now(); setBacklog(false); }
    // Config screen (gal-config.js): pauses auto / skip like the backlog; closing returns focus to the opener.
    const [configOpen, setConfig] = React.useState(false);
    // gallery is a local modal, never a second stage cursor.
    const [galleryOpen,setGallery]=React.useState(false);
    ;
    // opened from the system menu's 回想 item (gal-menu.js), not from the control row.
    function openGallery() { setHidden(false); setGallery(true); }
    const [sceneError, setSceneError] = React.useState(""); // shown in the notice stack, not over the HUD
    const [sceneReload, setSceneReload] = React.useState(0); // the notice's 重新载入 presses (GalScene props.reload)
    const configOpener = React.useRef(null);
    function openConfig(opener) { forkLipSync.wake(); forkUiSfx.play("open"); configOpener.current = opener || (typeof document !== "undefined" ? document.activeElement : null); setHidden(false); setConfig(true); }
    function closeConfig() {
        forkUiSfx.play("close"); backlogClosedAt.current = Date.now(); setConfig(false);
        const opener = configOpener.current; configOpener.current = null;
        if (opener && opener.focus) forkForeground.setTimeout(() => { if (opener.isConnected) opener.focus({ preventScroll: true }); }, 0);
    }
    // System menu (gal-menu.js): Esc opens it; auto / skip pause like the backlog. Leaving system full screen
    // (the browser takes that Esc) opens it too, and closing it asks for full screen again.
    const [menuOpen, setMenu] = React.useState(false);
    // the turn-end menu's 「重新生成」 opens the menu straight into its 重新生成 dialog.
    const [menuRegenerate, setMenuRegenerate] = React.useState(false);
    const menuOpener = React.useRef(null);
    const menuFullscreen = React.useRef(false);
    function openRegenerate() { openMenu(false); setMenuRegenerate(true); }
    function openMenu(fullscreenLost) {
        forkLipSync.wake();
        setMenuRegenerate(false);
        menuOpener.current = typeof document !== "undefined" ? document.activeElement : null;
        menuFullscreen.current = Boolean(fullscreenLost);
        setHidden(false); setMenuLeaving(false); setMenu(true);
    }
    // a drawn menu with an exit motion stays mounted (inert) while its items leave.
    const [menuLeaving, setMenuLeaving] = React.useState(false);
    function closeMenu() {
        backlogClosedAt.current = Date.now(); setMenu(false);
        // (the items' leave and the device's own frameOut: the longer of the two)
        // (and the skin's menu transition, transitions.menu.leave, at every width)
        const motion = activeSkin?.art?.menu?.motion, leave = motion?.leave, frameOut = activeSkin?.art?.menu?.frame ? motion?.frameOut : null;
        const drawn = (leave || frameOut) && !narrow, tx = skinTxLeaveMs(activeSkin, "menu", reading.reducedMotion === true);
        if ((drawn || tx) && !reading.reducedMotion && menuOpen) {
            setMenuLeaving(true);
            forkForeground.setTimeout(() => setMenuLeaving(false), Math.max(drawn && leave ? leave.ms + (leave.stagger || 0) * 10 : 0, drawn ? frameOut?.ms || 0 : 0, tx));
        }
        if (!menuFullscreen.current) return;
        menuFullscreen.current = false;
        const root = typeof document !== "undefined" ? document.documentElement : null;
        if (root && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
    }
    // the request opens the menu inside the host's fullscreenchange task (flushSync there),
    // so it lands in the first windowed frame. A store read + passive effect took two re-renders of the resized stage
    // (~130 ms): the window shrank, then the menu dimmed it a few frames later - a visible double flash.
    const menuRequestOpen = React.useRef(null);
    menuRequestOpen.current = function () { if (!menuOpen && !backlog && !configOpen && !galleryOpen) openMenu(true); };
    React.useLayoutEffect(() => galMenuRequest.subscribe(() => menuRequestOpen.current()), []);
    const menuActions = {
        onClose: closeMenu,
        onBacklog() { closeMenu(); openBacklog(); },
        onGallery() { closeMenu(); openGallery(); },
        onConfig() { const opener = menuOpener.current; closeMenu(); openConfig(opener); },
        onLatest() { closeMenu(); jumpLatest(); },
        onKeys() { closeMenu(); firstRun.showKeys(); },
        onLeave() { menuFullscreen.current = false; setMenu(false); props.onExit(); },
        // 自动 / 跳过 rows where the screen shows no such control (stageViews.controls.actionHomes).
        onAuto() { closeMenu(); setSkipping(false); setAuto(value => !value); },
        onSkip() { closeMenu(); toggleSkip(); }
    };
    const reading = useStageReading();
    const narrow = useGalNarrow(); // the one stage breakpoint, 640px
    // on phones the top bar's icons are one group centred at the top of the stage.
    const [topbarNode, topbarRef] = React.useState(null);
    useGalTopbarGroup(topbarNode, narrow);
    const performanceLayer=usePerformanceLayer(rootRef,sessionId,reading);
    // while a keyframe phase that holds the dialogue
    // plays (e.g. 「开始」 / 「终了」 titles) the box is put away. The page's words, voice and AUTO wait for it through
    // the page's sequencing point (beatHold below); skip ends the hold (it goes on at once, as skip does everywhere).
    const performancePlayback = performanceLayer.playback;
    const heldPhase = performancePlayback && (performancePlayback.phase === 'entry' || performancePlayback.phase === 'exit') ? performancePlayback.document.keyframes?.[performancePlayback.phase] : null;
    const dialogueHeld = Boolean(heldPhase?.holdDialogue) && !skipping;
    // the page's one sequencing point (stage-runtime.cjs
    // stageBeatHold): the line - its typing, its voice (held in the runtime) and so AUTO - starts once the stage is revealed and the
    // page's blocking performances (a title card, a text card, the 「审问开始」 combination) have ended. 'loading' | 'performance' | null.
    const beatHold = runtime.indicators.beatHold, beatHeld = Boolean(beatHold);
    const beatHoldRef = React.useRef(null);
    beatHoldRef.current = beatHold;
    // the config's skin draws at once with its bundle (useStageConfigSkin), holding the skin on
    // screen and its default key until the new bundle is ready; a projection made for the current default wins as before.
    const configKey=JSON.stringify(stageConfig.defaultSkin), configSkin=useStageConfigSkin(sessionId,stageConfig.skin,configKey);
    skinLoadingRef.current = configSkin.loading === true;
    const projectedKey=pack.scene?.skinDefault ? JSON.stringify(pack.scene.skinDefault) : null;
    const defaultKey=projectedKey===configKey ? configKey : configSkin.defaultKey;
    const projectedSkin=projectedKey && projectedKey!==defaultKey ? configSkin.skin : pack.scene?.skin;
    const shownSkin = React.useRef(null);
    const drawnSkin = useStageSkin(rootRef, performanceLayer.skin || projectedSkin || configSkin.skin, sessionId + ':' + turn + ':' + page, film, stageConfig.theme || 'classic', {shown:shownSkin,defaultKey,fallback:configSkin.skin,controls:projectedSkin || configSkin.skin,deferFonts:!entryGate.visible,ready:Boolean(accepted.provenanceByChannel?.background),snap:runtime.cursor.mode === 'history' || skipping || !!(performanceLayer.skin && performanceLayer.snap)});
    // a display mode changes only chrome - film mode's letterbox,
    // subtitles and controls replace the skin's box, art and buttons (activeSkin) - while the skin's stage projection
    // (skinFigures) and the director's camera apply in every mode.
    const activeSkin = film ? null : drawnSkin, skinFigures = stageSkinFigures(drawnSkin);
    const waitLines = activeSkin?.waitLines || STAGE_WAIT_LINES; // the skin's wait lines (wait-lines.js), else the default ones
    const skinMotionKeyframes = React.useMemo(() => activeSkin ? stageSkinMotionKeyframes(activeSkin) : '', [activeSkin]);
    const backlogLooks = React.useMemo(() => activeSkin ? stageSkinBacklog(activeSkin) : null, [activeSkin]);
    // a closed backlog / CONFIG stays mounted (inert) while the skin's leave plays.
    const backlogLeaving = useSkinLeave(backlog, activeSkin, "backlog", reading.reducedMotion === true);
    const configLeaving = useSkinLeave(configOpen, activeSkin, "config", reading.reducedMotion === true);
    // The stage's own leave (transitions.stage.leave): 返回主页面 / ✕ / F12 wait for it (galLeave asks the mounted stage).
    const [stageLeaving, setStageLeaving] = React.useState(false);
    React.useEffect(() => {
        const hold = done => {
            const ms = skinTxLeaveMs(activeSkin, "stage", reading.reducedMotion === true);
            if (!ms) return false;
            setStageLeaving(true); setTimeout(done, ms);
            return true;
        };
        return galHoldLeave(hold);
    });
    // ADV skins (textbox.layout other than box) read like the official games: no
    // 【】「」, no face window; quickMenu capsule / orb folds the quick buttons into the system menu behind one top-right
    // control (R13: one place each).
    // slash (layered jagged plates) reads the same way; a ransom plate cuts the name into glyph blocks.
    // while the current performance declares a
    // skinMode the skin has, the root carries the mode (the statement layout in theme.css). Presentation only.
    const skinMode = React.useMemo(() => stageSkinMode(activeSkin, performanceLayer.skinMode), [activeSkin, performanceLayer.skinMode]);
    // Replaced in one step like the skin itself (useStageSkin): no commit sees the root between two modes.
    const appliedMode = React.useRef(null);
    React.useLayoutEffect(() => () => { appliedMode.current?.(); appliedMode.current = null; }, []);
    React.useLayoutEffect(() => {
        const root = rootRef.current;
        if (!appliedMode.current && !skinMode) return;
        appliedMode.current?.();
        appliedMode.current = root && skinMode ? applyStageSkinMode(root, skinMode) : null;
        root?.dispatchEvent(new Event('stage-layout'));
    }, [skinMode]);
    const textPercent = film ? 100 : stageTextScaleOf(reading, shownSkin.current.id);
    const skinLayout = activeSkin?.textbox?.layout, advLayout = Boolean(skinLayout) && skinLayout !== 'box';
    const ransom = activeSkin?.nameplate?.shape === 'ransom';
    // art.nameplate.initials sets the name by part (galNameParts).
    const nameInitials = Boolean(activeSkin?.art?.nameplate?.initials);
    // where each reading action lives on this stage (stageViews.controls.actionHomes) - the control row or the
    // folded menu control, the skin's drawn buttons, and the Esc menu rows for what has no home on screen.
    const homes = stageViews.controls.actionHomes(activeSkin, narrow), menuFold = homes.fold;
    // the entries' reports - a badge keeps its entry on screen while the top
    // bar hides; the first-run key list names D only while 弹幕 is usable.
    const entryStore = React.useMemo(createStageEntryStore, []);
    const entryStates = React.useSyncExternalStore(entryStore.subscribe, entryStore.get);
    // the top bar hides while reading and reveals on demand; the
    // player's CONFIG 顶栏按钮 overrides the skin's hud.reveal (default auto).
    const hud = useGalHudReveal(rootRef, { mode: reading.hudReveal || activeSkin?.hud?.reveal || "auto",
        labels: (pack.scene?.backgroundName || "") + "\n" + (accepted.music?.name || ""), live: runtime.cursor.mode !== "history" && !skipping && !film });
    useWidgetTheme(rootRef,pack.scene,activeSkin,{theme:stageConfig.theme || 'classic',snap:runtime.cursor.mode==='history' || skipping || performanceLayer.snap,reducedMotion:reading.reducedMotion});
    // the phone's own Settings app saves its settings to this card or globally.
    const phoneSettings = usePhoneSettings({ sessionId });
    // Source widgets read faces synchronously; initialize their map before invoking the hook.
    const portraits = stageViews.speaker.portraits(pack.avatars, sessionId);
    const sourceWidget = useWidgetStage({ sessionId, chatId:props.data?.chatId, config, actors:pack.state?.actors, placeKey:props.data && props.data.cardPath, source:runtime.source, turn, pages, page, card, record:receivedDirection, phoneSettings, phoneCall:typeof phoneModCall === 'object' && phoneModCall ? phoneModCall : null,
        widgets:[...(pack.widgets || []),...performanceLayer.widgets.map(widget=>({...widget,performance:true}))], assetRevision:accepted.presentationRevision,
        mode:presenting, skipping, rootRef, avatarOf, enabled:true, film, revealed:typed && lastCard && !current?.pending,
        // A settled history page's mod one-shots (HISTORY_DWELL): the phone sounds its line's incoming tone once more.
        replays:stageHistoryModPlays(runtime),
        historyVoice:line=>stageVoiceHandle(sessionId,line.voice,config,line.anchor?.paragraphId),
        // only covering overlays suspend mods. Waiting for the reply, the end-of-round choices
        // and free input are play time (core-mod-architecture §暂停): the top-right launcher and an open phone stay usable.
        reducedMotion:reading.reducedMotion, paused:hidden || backlog || configOpen || galleryOpen || menuOpen || transitioning || sceneHolding,
        onPause:()=>{setAuto(false);setSkipping(false);} });
    const wheelGesture = React.useRef(null);
    React.useEffect(function () {
        if (typed && lastCard && !subtitles.provisional && current && !current.pending && !transitioning && !hidden && !backlog && !configOpen && !galleryOpen && !menuOpen && !sceneHolding) markRead();
    }, [sessionId, turn, page, typed, lastCard, subtitles.provisional, current && current.text, current && current.pending, transitioning, hidden, backlog, configOpen, galleryOpen, menuOpen, sceneHolding]);
    // the end-of-round choices and an open mod take turns. A mod still open when the choices
    // arrive (a phone run ending the round) folds back to its launcher once; the player can reopen it from the top-right
    // icon, and while it is open the choices step aside (kept mounted, so a free-input draft survives).
    const choicesUp = Boolean(atEnd && (typed || openingOnly) && !hidden && props.Choices);
    // the veil was shown (so its leave uncovers the stage; a quick entry never showed it)
    // and the stage's reveal window (transitions.stage.enter plays on the box only then, not on every later box mount).
    const veilShown = React.useRef(false);
    if (entryGate.phase === "loading" || entryGate.phase === "slow") veilShown.current = true;
    const [stageEntering, setStageEntering] = React.useState(false);
    const revealed = entryGate.phase === "revealing" || entryGate.phase === "ready" || !entryGate.phase;
    React.useEffect(() => {
        const enter = activeSkin?.transitions?.stage?.enter;
        if (!revealed || !enter) return undefined;
        setStageEntering(true);
        const timer = setTimeout(() => setStageEntering(false), (enter.delay || 0) + enter.ms + 50);
        return () => clearTimeout(timer);
    }, [revealed, Boolean(activeSkin?.transitions?.stage?.enter)]);
    // (bauhaus v2) the second layer: each surface's own parts after (enter) or before (leave) it
    useSkinParts(rootRef, activeSkin, { loading: entryGate.phase === "loading" || entryGate.phase === "slow", stage: revealed && !stageLeaving, menu: menuOpen, config: configOpen, backlog },
        reading.reducedMotion === true);
    const choicesArrived = React.useRef(null);
    React.useEffect(function () {
        if (!choicesUp) { choicesArrived.current = null; return; }
        const key = sessionId + ':' + turn;
        if (choicesArrived.current === key) return;
        choicesArrived.current = key;
        if (sourceWidget.openKey) sourceWidget.action(sourceWidget.openKey, 'collapse');
    }, [choicesUp, sessionId, turn]);
    function selectTurn(nextTurn, nextPage, para, forward = false) {
        voicePlayer.stop(undefined, true);
        setTransition(null);
        setForwardReading(forward);
        if (!forward) setSceneVisit(n => n + 1);
        const row = runtime.textIndex.get(nextTurn);
        const index = para ? row?.text.pages.findIndex(page => page.anchor.para >= para) : nextPage < 0 ? (row?.text.pages.length || 1) - 1 : nextPage;
        stageSessions.owner.navigate(sessionId,nextTurn,nextPage < 0 && row?.unloaded ? -1 : Math.max(0,index || 0),forward,para);
        setTyped(false); setEndedAt(null);
    }
    const navigation = React.useRef(initial.entry && initial.entry.token || 0);
    const entryVisit = React.useRef(entry);
    React.useLayoutEffect(function () {
        if (entryVisit.current === entry) return;
        entryVisit.current = entry;
        if (!entry) return;
        setAuto(false); setSkipping(false); setHidden(false); setBacklog(false); setConfig(false); setMenu(false);
        selectTurn(entry.turn, 0, entry.para);
    }, [entry]);
    function jumpBack(target, targetTurn = turn, targetPara) {
        closeBacklog();
        if (awaiting && targetTurn === turn) return;
        setAuto(false); setSkipping(false);
        if (targetTurn !== turn || targetPara) { selectTurn(targetTurn, target, targetPara); return; }
        setTransition(null); setForwardReading(false); setSceneVisit(n => n + 1);
        const next = Math.max(0, Math.min(pages.length - 1, target));
        subtitles.select(next, 0); stageSessions.owner.navigate(sessionId,turn,next,false); setTyped(true); setEndedAt(null);
    }
    // The danmaku of the exported round flies again (danmaku-stage.cjs danmakuReplay).
    React.useEffect(() => {
        if (!replaying) return;
        danmakuReplay(sessionId, true, String(runtime.cursor.visitId));
        return () => danmakuReplay(sessionId, false);
    }, [replaying, replaying && runtime.cursor.visitId, sessionId]);
    // 「跳到最新一轮」: the latest available page (where skip also stops), through the same navigation as a backlog jump.
    function jumpLatest() {
        if (turn === latestTurn || !latestTurn) return;
        setAuto(false); setSkipping(false);
        selectTurn(latestTurn, -1);
    }
    function go(delta, fromSkip) {
        forkLipSync.wake();
        if (awaiting || sceneHolding) return false;
        if (!fromSkip && skipLatch) { setSkipping(false); return; }
        if (!fromSkip && delta > 0 && current && !typed) { setTyped(true); return; } // first click finishes the line (a streaming one up to its stable end)
        // turning past the round's last line opens the end panel. It is a page turn: like
        // PAGE (stage-runtime.cjs cancel-playback) it cuts the line's voice, or a voice still on its way.
        if (delta > 0 && atLastLine && !atEnd) { voicePlayer.stopPlayback(); setEndedAt(endKey); return true; }
        if (transitioning && (delta > 0 ? !inputLast : inputCard > 0)) { inputSubtitles.select(0, inputCard + delta); setTyped(false); return true; }
        if (transitioning || delta > 0 && lastCard && page >= pages.length - 1 || delta < 0 && card === 0 && page === 0) {
            const nextTurn = stageViews.position.turnStep(turns, turn, page, pages.length, delta, transitioning);
            if (!nextTurn) return false;
            if (nextTurn.transition) { inputSubtitles.select(0, 0); setTransition(turn); setTyped(false); }
            else if (nextTurn.turn !== turn) selectTurn(nextTurn.turn, nextTurn.page, undefined, delta > 0);
            else { setTransition(null); setTyped(false); }
            return true;
        }
        const next = stageViews.subtitles.step(page, card, delta, subtitles.counts);
        if (next.page === page && next.card === card) return false;
        showCard(next.page, next.card, delta > 0);
        return true;
    }
    // One page turn to a card of this round (go, and a clip export's replay driver below).
    function showCard(nextPage, nextCard, forward) {
        setForwardReading(forward);
        if (!forward) setSceneVisit(n => n + 1);
        subtitles.select(nextPage, nextCard); setPage(nextPage); setTyped(false); setEndedAt(null);
    }
    // a clip export (clip-render.js) reads the text box pager's cards of
    // the page on screen and turns its cards the way auto does, so the video walks the same cards as the stage.
    ;
    // Any manual input stops auto; any input while hidden only brings the box back.
    // the box comes back first and a playing 文字演出 card keeps
    // playing; the next input ends the card. The input that stopped a fast-forward does only that (skipStopped).
    function input(delta) {
        if (hidden) { setHidden(false); return; }
        if (skipStopped.current) { skipStopped.current = false; return; }
        if (textcard.skip()) return; // input during a 文字演出 card ends the card (textcard-stage.js)
        // while the line waits for this page's blocking performances, an input skips
        // them (a title ends, a combination's phase lands on its sustained state) and the line starts at once; it does not turn
        // the page. Nothing skips the loader here (the entrance takes its own clicks).
        if (beatHoldRef.current === 'performance') { endTitle(); runtime.store.dispatch({type:'BEAT_SKIP'}); return; }
        if (auto) setAuto(false);
        go(delta);
    }
    // skip turns pages at a fixed fast pace (GAL_SKIP_PAGE_MS) to the latest available
    // page, whether read before or not - every round is written live, so there is no read-only skip. A streaming round
    // is followed as its pages arrive; skip ends at the round's end. A held Ctrl ends there like the SKIP control.
    function stopSkip() { setSkipping(false); setSkipHeld(false); }
    // The one SKIP toggle every home calls (control row, a mode widget's row, a skin's drawn button, the Esc menu row): skip
    // on ends auto. Every home's control carries stageViews.controls.skipSelector, which the stop-on-any-press rule below leaves alone.
    function toggleSkip() { setAuto(false); setSkipping(value => !value); }
    // the SKIP control behaves like a held Ctrl — any key, click or
    // wheel stops it (the Ctrl hold effect below owns that for both), and that input is not also a page turn.
    const skippingRef = React.useRef(false);
    skippingRef.current = skipping;
    const skipStopped = React.useRef(false);
    skipPossibleRef.current = !atEnd;
    React.useEffect(() => () => voicePlayer.stop(),[sessionId]);
    // Warm a small spoken opening even when its first page is narration; keep the existing two workers.
    const voiceWindow = skipping || backlog || awaiting ? [] : stageVoiceWindowFromIndex(sessionId,runtime.textIndex,turn,pages,page,config,entryGate.visible ? Infinity : 1);
    React.useEffect(() => {
        for (const handle of voiceWindow) void handle.prefetch?.();
        voicePlayer.prioritize(voiceWindow);
    },[sessionId,JSON.stringify(voiceWindow.map(handle=>[handle.owner,handle.id]))]);
    // Cached playback starts before paint; the outgoing line has a short fading tail.
    const voice = !beatHeld && !sourceWidget.phoneBeat && current && current.voice;
    const player = voicePlayer.get();
    const playingHere = Boolean(voice && player && player.owner === voice.owner && player.id === voice.id);
    function replay() {
        forkLipSync.wake();
        if (!voice) return;
        ;
        const now = voicePlayer.get();
        if (playingHere && now && now.audio) { now.audio.currentTime = 0; now.audio.play().catch(() => {}); }
        else voice.click();
    }
    // A title card (报幕) is a blocking one-shot: its play lasts until it ends (done), so the line waits for it.
    const [title, setTitle] = React.useState(null);
    const endTitle = () => setTitle(old => { old?.done?.(); return null; });
    // The surface also takes a settled history page's plays (HISTORY_DWELL); the runtime decides what plays, and cancels it.
    const modPerformances=useModPerformances(sessionId,{live:true,overlay:backlog||configOpen||galleryOpen||menuOpen||hidden,sourceKey:receivedDirection.token?.sourceKey,generation:receivedDirection.token?.generation,assetRevision:receivedDirection.assetRevision});
    const textcard=useTextcardStage({sessionId,reducedMotion:reading.reducedMotion,blocked:backlog||configOpen||galleryOpen||menuOpen});
    // Auto and skip wait for each presentation's own clock; manual navigation still cancels immediately.
    const presentationBusy = textcard.busy || modPerformances.busy || !!title;
    // a history page the reader settles on plays its own
    // one-shots (the runtime's HISTORY_DWELL: projection only, no write, no consumption) - shortly after a jump or a single
    // page turn, and only 1 s after the last turn while paging continuously (the danmaku history rule, danmaku-streaming.md
    // 生命周期). A page left earlier plays nothing; what plays is cut with its page. Overlays (the text-only 履历 included),
    // skip and a restored page (still) never play.
    const replayableKinds = performanceKinds.replayable;
    const dwellPageKey = runtime.cursor.anchor ? JSON.stringify([runtime.cursor.visitId, runtime.cursor.anchor.paragraphId, runtime.cursor.anchor.offset]) : '';
    const pageTurned = React.useRef({key: '', at: 0, rapid: false});
    React.useLayoutEffect(() => {
        if (!dwellPageKey || pageTurned.current.key === dwellPageKey) return;
        const now = Date.now();
        pageTurned.current = {key: dwellPageKey, at: now, rapid: now - pageTurned.current.at < STAGE_HISTORY_SETTLE_MS};
    }, [dwellPageKey]);
    const dwellBlocked = runtime.cursor.mode !== 'history' || runtime.cursor.still || !!runtime.cursor.dwell || !replayableKinds ||
        skipping || backlog || configOpen || galleryOpen || menuOpen || hidden;
    React.useEffect(() => {
        if (dwellBlocked) return;
        // A landing waits a moment for the closing overlay and the page's projection; continuous paging waits the full dwell.
        const {visitId, anchor} = runtime.cursor, turned = pageTurned.current;
        const delay = Math.max(0, turned.at + (turned.rapid ? STAGE_HISTORY_SETTLE_MS : 250) - Date.now());
        const timer = forkForeground.setTimeout(() => runtime.store.dispatch({type: 'HISTORY_DWELL', visitId, anchor, kinds: replayableKinds}), delay);
        return () => forkForeground.clearTimeout(timer);
    }, [dwellPageKey, dwellBlocked]);
    // The round's checks are thrown again when its first page is the settled history page (core.dice.roll replays).
    const historyRolls = runtime.cursor.dwell?.kinds.includes('core.dice.roll') && runtime.text.pages[0] && runtime.cursor.anchor &&
        runtime.text.pages[0].anchor.paragraphId === runtime.cursor.anchor.paragraphId && runtime.cursor.anchor.offset === 0 ? 'history:' + dwellPageKey : null;
    // The timer owns a stage-open wall clock. UI playback and the selected history floor do not hold the live budget.
    // A reply timeout may offer a fallback only while the choices' input lock still permits it.
    // skinKey: the drawn skin - its mod options and locks are the timer's look (mod-options.js).
    const stageTimer = useStageTimerSlot({sessionId, rootRef, reading, source:runtime.source, token:receivedDirection.token, turn, skinKey:drawnSkin?.id || '',
        mode:replaying ? 'replay' : runtime.cursor.mode === 'history' || turn !== latestTurn ? 'history' : 'live', visit:runtime.cursor.visitId,
        at:Math.min(pages[page]?.para || 1, runtime.director.through || 0), offset:runtime.cursor.anchor?.offset || 0, sending:!!waiting, running,
        waiting:atEnd && (typed || openingOnly) && !hidden && !awaiting && !running && !sourceWidget.openKey && !!props.Choices});
    // auto and skip wait for this paragraph's director prefix and say so; manual paging stays immediate.
    const awaitingDirection = runtime.indicators.awaitingDirection;
    // Intermediate voiced cards follow the paragraph audio clock, not a new playback lease.
    const audioBusy = playingHere && (!player.audio || forkForeground.isPlaying(player.audio)) && !player.error;
    const autoDeadline=React.useRef(null);
    // auto waits while DSH Tavern is not in front - a voiced line is held by its paused
    // audio; a silent page keeps the rest of its wait for the return.
    const audible = React.useSyncExternalStore(forkForeground.subscribeAudio, forkForeground.isAudible);
    React.useEffect(function () {
        if (!auto || skipping || hidden || backlog || configOpen || galleryOpen || menuOpen || !typed || !current || current.pending) {autoDeadline.current=null;return;}
        if (atEnd || awaitingDirection) return;
        if (!audible) { if (autoDeadline.current && autoDeadline.current.left === undefined) autoDeadline.current.left = autoDeadline.current.at - Date.now(); return; }
        if (autoDeadline.current?.left !== undefined) { autoDeadline.current.at = Date.now() + autoDeadline.current.left; delete autoDeadline.current.left; }
        const holds=[...modPerformances.holds,{pending:textcard.busy || !!title || dialogueHeld}];
        if (!lastCard && voice && audioBusy) {
            if(stageAutoRemaining(0,holds)===Infinity)return;
            const timer = forkForeground.setInterval(function () {
                const now = voicePlayer.get();
                const audio = now && now.owner === voice.owner && now.id === voice.id && now.audio;
                const target = audio && stageViews.subtitles.voiceTime(subtitles.cards, card, audio.duration);
                if (audio && !audio.paused && target !== null && audio.currentTime >= target) go(1, true);
            }, 80);
            return () => forkForeground.clearInterval(timer);
        }
        if (audioBusy) {autoDeadline.current=null;return;}
        const key=JSON.stringify([sessionId,turn,page,card,inputCard,transitioning ? inputSubtitles.text : subtitles.text,Boolean(voice) && lastCard,reading.autoWait,reading.autoSpeed]);
        if(autoDeadline.current?.key!==key)autoDeadline.current={key,at:Date.now()+galHandoffAutoDelay(galAutoDelay(reading, Boolean(voice) && lastCard, !transitioning ? subtitles.text : inputSubtitles.text), handoff.heldMs)};
        const remaining=stageAutoRemaining(autoDeadline.current.at-Date.now(),holds);
        if(remaining===Infinity)return;
        const timer = forkForeground.setTimeout(() => go(1, true), remaining);
        return () => forkForeground.clearTimeout(timer);
    }, [auto, skipping, hidden, backlog, configOpen, galleryOpen, menuOpen, typed, turn, transitioning, page, card, inputCard, inputSubtitles.text, film, subtitles.text, lastCard, audioBusy, current && current.text, awaiting, reading.autoWait, reading.autoSpeed, atEnd, sceneHolding, presentationBusy, dialogueHeld, awaitingDirection, audible]);
    // skip turns a page every GAL_SKIP_PAGE_MS and never waits for a performance (a
    // text card, title or anything still sounding is cut by the next turn); staging snaps and nothing sounds. Only data
    // holds it: a streaming page's text and a paragraph's director prefix. Input, the round's end, its choices or
    // toggling skip off stop it.
    React.useEffect(function () {
        if (!skipping || awaiting || sceneHolding) return;
        if (atEnd) { setEndedAt(endKey); stopSkip(); return; }
        // like AUTO, skip does not turn pages while DSH Tavern is not in front; it resumes on return.
        if (!audible) return;
        if (backlog || configOpen || galleryOpen || menuOpen || (current && current.pending) || awaitingDirection) return;
        const timer = forkForeground.setTimeout(() => {
            go(1, true); setTyped(true);
        }, GAL_SKIP_PAGE_MS);
        return () => forkForeground.clearTimeout(timer);
    }, [skipping, turn, transitioning, page, card, inputCard, subtitles.text, pages.length, current && current.pending, backlog, configOpen, galleryOpen, menuOpen, awaiting, atEnd, sceneHolding, awaitingDirection, audible]);
    // a Space the stage took is not also a press of the focused control on keyup.
    const pressedSpace = React.useRef(false);
    React.useEffect(function () {
        function onKey(event) {
            // The Config screen and the system menu keep the keyboard (each closes itself on Esc).
            if (configOpen || galleryOpen || menuOpen) return;
            // no stage key while an input method is composing.
            if (event.isComposing || event.keyCode === 229) return;
            // A held Esc (auto-repeat) is not a new press: it would toggle the menu on every repeat while the browser
            // waits for the hold that leaves full screen.
            if (event.key === "Escape" && event.repeat) { event.preventDefault(); return; }
            // An inner overlay (the choice editor, a widget reader, a popover) already took this Esc.
            if (event.key === "Escape" && event.defaultPrevented) return;
            const target = event.target;
            // The chat composer can retain/retake focus behind this portal. Only stage editors
            // own editing keys; an invisible composer must not disable Back or Escape.
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) && rootRef.current && rootRef.current.contains(target)) return;
            const key = event.key, letter = key.length === 1 && /[a-z]/i.test(key) ? key.toLowerCase() : "";
            const advance = key === " " || key === "Enter" || key === "ArrowRight" || key === "PageDown", back = key === "ArrowLeft" || key === "PageUp" || key === "Backspace";
            // letter shortcuts leave Ctrl / Alt / Meta combinations to the browser
            // (Ctrl+A, Ctrl+R, Ctrl+L); a held key turns one page and toggles once (auto-repeat is ignored).
            if (letter && (event.ctrlKey || event.altKey || event.metaKey)) return;
            if (event.repeat && (advance || back || letter)) { if (advance || back) event.preventDefault(); return; }
            // A control the keyboard focused (Tab, galKeyboardFocus) keeps its own Enter / Space; after a pointer click
            // they belong to the stage again - it pages, and its preventDefault keeps the focused control from being pressed.
            if ((key === " " || key === "Enter") && target && target !== rootRef.current && typeof target.closest === "function" && target.closest("button, a[href], [role='button']") && rootRef.current && rootRef.current.contains(target) && galKeyboardFocus()) return;
            // The backlog keeps the keyboard (arrows / Page keys scroll it; Enter on a row jumps).
            if (backlog) {
                if (key === "Escape" || letter === "l") { event.preventDefault(); closeBacklog(); }
                return;
            }
            if (letter === "l") { event.preventDefault(); openBacklog(); return; }
            if (advance) { event.preventDefault(); if (key === " ") pressedSpace.current = true; input(1); }
            else if (back) { event.preventDefault(); input(-1); }
            else if (event.key === "Escape") {
                event.preventDefault();
                if (hidden) { setHidden(false); return; }
                if (sourceWidget.openKey) {sourceWidget.action(sourceWidget.openKey,'collapse');return;}
                // A modal dialog inside the stage (a widget's reader) closes itself first, even without focus.
                const root = rootRef.current;
                if (root && typeof root.querySelector === "function" && root.querySelector("[aria-modal='true']")) return;
                openMenu(false);
            }
            else if (letter === "h") setHidden(!hidden);
            else if (letter === "r") replay();
            // G presses the turn-end menu's 重新生成 (the badge on the 自由输入 row,
            // gal-choices.js) - only while it is shown and can act, so the key follows the control's own rule.
            else if (letter === "g") { if (stageViews.controls.pressRegenerate(rootRef.current)) event.preventDefault(); }
            // Like the AUTO control: turning auto on also ends a SKIP.
            else if (letter === "a") { if (!auto) setSkipping(false); setAuto(!auto); }
        }
        function onKeyUp(event) { if (event.key === " " && pressedSpace.current) { pressedSpace.current = false; event.preventDefault(); } }
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKeyUp, true);
        return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp, true); };
    });
    // Hold Ctrl to fast-forward (released = stop). A short arm delay and cancelling on any other
    // key, click or wheel keep Ctrl shortcuts (copy, Ctrl+wheel reading size) from skipping.
    const skipHoldBlocked = configOpen || galleryOpen || menuOpen || backlog || hidden;
    React.useEffect(function () {
        if (skipHoldBlocked) { setSkipHeld(false); return; }
        let timer = 0;
        function cancel() { forkForeground.clearTimeout(timer); timer = 0; setSkipHeld(false); }
        // any other key, click or wheel also stops a SKIP-control fast-forward, and
        // input() / wheel() drop that input instead of turning a page. The SKIP control's own press toggles it instead.
        function interrupt(event) {
            const own = event && event.type === "pointerdown" && event.target && typeof event.target.closest === "function" && event.target.closest(stageViews.controls.skipSelector);
            const running = skippingRef.current && !own;
            skipStopped.current = running;
            cancel();
            if (running) setSkipping(false);
        }
        function onDown(event) {
            if (event.key !== "Control") { interrupt(event); return; }
            if (event.repeat || timer || event.altKey || event.shiftKey || event.metaKey) return;
            const target = event.target;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
            timer = forkForeground.setTimeout(() => { timer = 0; if (!skipPossibleRef.current) return; setAuto(false); setSkipHeld(true); }, 160);
        }
        function onUp(event) { if (event.key === "Control") cancel(); }
        function onHidden() { if (document.hidden) cancel(); }
        window.addEventListener("keydown", onDown, true);
        window.addEventListener("keyup", onUp, true);
        window.addEventListener("wheel", interrupt, true);
        window.addEventListener("pointerdown", interrupt, true);
        window.addEventListener("blur", cancel);
        document.addEventListener("visibilitychange", onHidden);
        return () => {
            forkForeground.clearTimeout(timer); setSkipHeld(false); skipStopped.current = false;
            window.removeEventListener("keydown", onDown, true);
            window.removeEventListener("keyup", onUp, true);
            window.removeEventListener("wheel", interrupt, true);
            window.removeEventListener("pointerdown", interrupt, true);
            window.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", onHidden);
        };
    }, [skipHoldBlocked]);
    const para = current && current.para || 1;
    // A stage actor key (speaker, member ids) may be a carried key: its card character comes through the figure ref.
    function characterOf(alias) { return stageActorCharacter(config, pack.characters, alias); }
    function colorOf(alias) { const character = characterOf(alias); return character?.color || (alias ? bubbleColor(character) : ''); }
    // the accepted state as this device shows it (stage plugin device profile); a profile change re-renders.
    const device = stageViews.device.useProfile();
    const state = React.useMemo(() => stageViews.device.state(pack.state, device), [pack.state, device]);
    const [shot, setShot] = React.useState({key:'',n:0,acts:{},effects:[],emotes:[]});
    const [debugEmote, setDebugEmote] = React.useState(null);
    const cg = useCgStage(sessionId,runtime.store,{paused:backlog || configOpen || galleryOpen || menuOpen || sceneHolding,reducedMotion:reading.reducedMotion,photosensitive:reading.photosensitive,forward:forwardReading && !skipping});
    // The card's accent is its anchored line's speaker's 形象色, before or after that line.
    const textcardAccent = anchor => { const line = pages.find(row => row.anchor?.para === anchor?.para && row.kind === 'line'); const alias = line ? bubbleCharacter(config,line)?.alias : ''; return alias ? colorOf(alias) : ''; };
    const onPresented = useStageConsumers(sessionId,runtime.store,(effect,token) => {
        if (effect.kind === 'mod-performance' && textcard.accepts(effect.performance)) return textcard.play(effect,{accent:textcardAccent(token.anchor)});
        if (effect.kind === 'mod-performance') return modPerformances.play(effect,token);
        if (effect.kind === 'title') return new Promise(done => setTitle(old => { old?.done?.(); return {text:effect.value,nonce:token.id,done}; }));
        else if (['act', 'beat', 'emote'].includes(effect.kind)) setShot(old => ({key:turn + ':' + page,n:token.id,
            acts:effect.kind === 'act' ? {...old.acts,[effect.id]:effect.value} : old.acts,
            effects:effect.kind === 'beat' ? [{...effect,nonce:token.id}] : old.effects,
            emotes:effect.kind === 'emote' ? [{...effect,nonce:token.id}] : old.emotes}));
    // A page turn while skipping also ends the title it showed (stageSkipShows: nothing outlives its page).
    },performanceLayer.accept,cg.accept,{play:modPerformances.play,cancel:intent=>{modPerformances.cancel(intent);textcard.cancel();if(skippingRef.current)endTitle();}});
    // the loading veil and the 入场演出 always block - the stage is revealed to the
    // runtime's sequencing point once the gate shows the stage, the entrance has ended (its fade included) and the performance
    // kinds are read. Until then the first page's text and voice wait (voice prefetch does not).
    const stageRevealed = entryGate.visible && !entrance.active && performanceKinds.settled;
    React.useLayoutEffect(() => { runtime.store.dispatch({type:'STAGE_REVEAL', revealed:stageRevealed}); }, [stageRevealed, runtime.store]);
    // A scene presented under an entrance's cover (the renderer starts with the load) plays its one-shots once it is shown.
    const heldPresented = React.useRef(null);
    React.useEffect(() => {
        if (!entryGate.visible || heldPresented.current === null) return;
        const revision = heldPresented.current;
        heldPresented.current = null;
        onPresented(revision);
    }, [entryGate.visible]);
    // Skip is silent: the voice sounding when it starts stops with it (SKIP_START cuts the page's SE, the widget stage its SE).
    React.useLayoutEffect(() => {
        if (!skipping) return;
        voicePlayer.stopPlayback(); runtime.store.dispatch({type:'SKIP_START'});
        return () => runtime.store.dispatch({type:'SKIP_END'});
    },[skipping,runtime.store]);
    const moodList = bubbleMoodList(config, current ? bubbleCharacter(config, current)?.alias : undefined);
    // The DOM UI follows the scene (colour, flashes, vignette, grain, shake) through the stage root.
    React.useLayoutEffect(function () {
        const root = rootRef.current;
        if (!root || typeof document === "undefined") return;
        const opener = document.activeElement;
        root.focus({ preventScroll: true });
        // After the same commit uncovers the chat (GalStageHost): focusing inside the still-covered
        // transcript would force its whole skipped layout first.
        return () => { queueMicrotask(() => { if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true }); }); };
    }, [sessionId]);
    const applyUi = React.useMemo(() => galUiApplier(), []);
    const onUi = React.useCallback(frame => applyUi(rootRef.current, frame), [applyUi]);
    const track = accepted.music;
    // Every dialogue consumer resolves the same current figure ref; off-stage speakers keep their card identity.
    const speakerRows = React.useMemo(() => stageViews.speaker.rows(pack.characters), [pack.characters]);
    const stageSpeaker = React.useCallback(row => stageViews.speaker.key(config,speakerRows,row), [config,speakerRows]);
    const speaker = stageSpeaker(current);
    const skinSweep = useSkinSweep(activeSkin, { loading: entryGate.phase === "loading" || entryGate.phase === "slow", stage: revealed && !stageLeaving, menu: menuOpen, config: configOpen, backlog,
        // page: every page the reader turns to, a box card of a long page included (its text is replaced just as a page's);
        // the page's speaker lets transitions.page.enter.sameSpeaker keep a change of speaker quiet (§18 N14)
        choices: choicesUp, page: skipping || runtime.cursor.mode === "history" ? "" : turn + ":" + page + ":" + card }, reading.reducedMotion === true, speaker);
    // a change of speaker (to someone) plays its shapes once.
    const speakerSweep = useSkinSweep(activeSkin, { speaker: skipping || runtime.cursor.mode === "history" ? "" : speaker }, reading.reducedMotion === true);
    const audio = playingHere && player.audio ? player.audio : null;
    // while a phone contact speaks on the call, her figure on
    // stage moves its mouth to the call's voice (and nobody else's does).
    // The phone call module is optional to the stage, as music and sound are: without it the phone offers no call.
    const phoneCall = typeof phoneModCall === 'object' && phoneModCall ? phoneModCall : null;
    const phoneCallKey = React.useSyncExternalStore((phoneCall || GAL_NO_PHONE_CALL).subscribe, (phoneCall || GAL_NO_PHONE_CALL).stage);
    const phoneVoice = phoneCallKey ? phoneCall.speaking() : null, callAudio = phoneVoice?.audio || null;
    // the call view the phone page leaves clear - her stage
    // figure (the stage's own entry when she stands on stage, else a figure loaded off stage), the player's own while the camera
    // is on, the stage's background behind her. The scene draws it over everything, in the page's boxes.
    React.useSyncExternalStore(phoneCall?.videoSubscribe || GAL_NO_PHONE_CALL.subscribe, phoneCall?.videoKey || GAL_NO_PHONE_CALL.stage);
    const callVideo = phoneCall?.video ? phoneCall.video() : null;
    const callView = callVideo ? galCallView(callVideo, packFigureRenderInputs, {skipping, sessionId}) : null;
    const renderInputs = stageViews.speaker.voiceInputs(pack.characters, {audio,speaker,skipping,turn,page,sessionId,phoneVoice,callAudio,phoneCallKey});
    const shotHere = !awaiting && shot.key === turn + ':' + page;
    // reserve the full directed cast's slots while individual resources arrive.
    const members = state ? stageViews.speaker.members(state).filter(member => !!renderInputs.get(member.id)?.stage) : [];
    const xs = Object.fromEntries(members.map(member => [member.id,member.x]));
    const items = members.map(member => {
        const selected = pack.characters.find(figure => figure.alias === member.id), input = renderInputs.get(member.id).stage;
        return {...input,alias:member.id,x:member.x,speaking:member.id===speaker,light:member.light,color:colorOf(member.id),shade:stageViews.speaker.shade(member.id,speaker,members,state?.camera,skinFigures.dimListeners),
            // reopening/restoring is not a new entrance (same policy as the background cut).
            visible:true,enter:forwardReading&&!skipping?'soft':'none',exit:'soft',gaze:stageViews.speaker.gaze(member.gaze,member.x,xs),act:shotHere&&shot.acts[member.id]?{name:shot.acts[member.id],nonce:shot.n}:null,
            figureSizing:{pack:true,heightCm:selected.heightCm,version:1,source:selected.geometry.stage,sourceUrl:input.src,heightBasis:selected.heightBasis,outfitKey:selected.outfitKey,anatomy:selected.anatomy,head:selected.head,assetScale:selected.anatomy?.assetScale ?? 1,elevationCm:selected.elevationCm}};
    });
    const quality = useStageQuality();
    // core stage behaviour; tap reactions borrow the figure's own emotionMap entries.
    for (const item of items) item.reactions = packFigureReactions(pack.characters.find(figure => figure.alias === item.alias),bubbleMoodList(config,item.alias));
    // A tap on a figure is claimed (reaction, no page turn) only while a stage click would be a plain page turn: not while
    // the box is hidden (the click brings it back), a click just stopped SKIP, a text card plays, or a menu, the backlog,
    // CONFIG, the gallery or a widget reader is open. Read at click time (gal-scene.js onStageTap).
    const tapGateRef = React.useRef(() => false);
    tapGateRef.current = () => !hidden && !skipStopped.current && !textcard.up && !backlog && !configOpen && !galleryOpen && !menuOpen && !sourceWidget.openKey;
    const tapGate = React.useCallback(() => tapGateRef.current(), []);
    // A reaction still is acquired under this session's stage authority on the first tap only (gal-scene.js).
    const tapMedia = React.useCallback(descriptor => {
        const source = stageSessions.get(sessionId)?.getSnapshot().source, owner = stageSessions.resourceOwner;
        return source && owner ? owner.acquire(descriptor,JSON.stringify([source.sessionId,source.authorityEpoch])) : Promise.reject(new Error('RESOURCE_UNAVAILABLE'));
    }, [sessionId]);
    const onStage = alias => members.some(member => member.id === alias);
    const sceneEffects = shotHere ? shot.effects.concat(shot.emotes.filter(effect => onStage(effect.id))) : [];
    const faceEmoteCue = shotHere ? shot.emotes.find(effect => !onStage(effect.id)&&effect.id===speaker) : null;
    const faceEmote = faceEmoteCue ? {kind:faceEmoteCue.value,color:colorOf(speaker),nonce:faceEmoteCue.nonce} : debugEmote;
    // the viewport may show only part of the cast; this ranks who stays
    // (gal-scene.js galFigureLayout). The directed cast is never changed.
    const castIds = state ? state.cast : [];
    // a skin may draw no figures (mode none) - presentation only.
    const figuresShown = skinFigures.shown;
    const recentSpeakers = React.useMemo(() => stageViews.speaker.recent(runtime.text.pages, page,
        [turns[turnIndex - 1], turns[turnIndex - 2]].map(value => runtime.textIndex.get(value)?.text?.pages),
        stageSpeaker), [runtime.text.pages, runtime.textIndex, page, turnIndex, stageSpeaker]);
    const figurePriority = stageViews.speaker.priority(castIds, [speaker, state?.camera.mode === 'close' ? state.camera.actor : '', ...recentSpeakers]);
    const [figureLayout, setFigureLayout] = React.useState(null);
    // the holding performance's speaker shot. From its entry's end (or its
    // start, from: start) only the subject is drawn, framed by its rest head box on its side; through the exit the last shot
    // stays; after it the ordinary stage is back. Presentation only - the cast, positions and camera state are untouched.
    const shotSpec = performancePlayback?.document?.shot || null;
    const shotHolds = Boolean(shotSpec) && (performancePlayback.phase === 'rest' || performancePlayback.phase === 'exit' || performancePlayback.phase === 'entry' && shotSpec.from === 'start');
    const heldShot = React.useRef(null);
    let stageShot = null;
    if (shotHolds && performancePlayback.phase !== 'exit' && performancePlayback.value.phase !== 'exit') {
        const started = performancePlayback.value.startedAt, first = started?.turn === turn ? Math.max(0, started.page) : 0;
        const ids = pages.slice(first, page + 1).map(row => { const alias = stageSpeaker(row); return onStage(alias) ? alias : ''; });
        const subject = stageViews.speaker.shotSubject(ids, shotSpec.side, id => figureLayout?.x?.[id] ?? 0.5);
        stageShot = subject ? { ...subject, ...stageViews.speaker.shotSide(shotSpec, subject.side) } : null;
        heldShot.current = stageShot;
    } else if (shotHolds) stageShot = heldShot.current;
    else heldShot.current = null;
    const layers = React.useMemo(() => createPackSceneLayers(),[]);
    const layeredScene=React.useMemo(()=>packPerformanceScene(pack.scene,performanceLayer.look),[pack.scene,performanceLayer.look]);
    const packLayers = layeredScene ? layers(layeredScene) : null;
    if (entryGate.visible && entryPage.current === null) entryPage.current = turn + ':' + page;
    // the effects tables the one resolver merges over the engine's defaults
    // (card-local > skin > engine; card-local entries arrive with P3), and the one safety policy.
    const effectTables = React.useMemo(() => ({skin:activeSkin?.resolvedEffects?.effects || null,local:null,screen:activeSkin?.resolvedEffects?.screen || 576}),[activeSkin]);
    const effectSafety = stageSafety(reading,typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const sceneChange = stageEffectResolve('transition',effectTables.skin,effectTables.local);
    const changeKind = pack.scene?.transition || sceneChange.default;
    const scene = {presentationRevision:accepted.presentationRevision,figureScale:accepted.layout?.ruler || accepted.ruler,core:pack.core || '',quality,film,holding:false,visit:runtime.cursor.visitId,snap:!entryGate.visible || runtime.cursor.mode === 'history' || skipping,
        lateFade:entryGate.visible && !skipping && entryPage.current === turn + ':' + page,
        // a picture the player switched to (bg-manual.js) takes its own transition (fade, or cut under 「减少动态」).
        background:pack.scene?.backgroundUrl ? {identity:pack.scene.backgroundMedia.identity,url:pack.scene.backgroundUrl,scene:JSON.stringify(pack.scene.background),transition:pack.scene.userTransition || (forwardReading&&!skipping?changeKind:'cut'),timing:!pack.scene.userTransition ? sceneChange : null} : null,
        hideFigures:!!accepted.cg || cg.visible,figureMode:figuresShown ? 'stage' : 'none',figuresAway:sourceWidget.phoneShade,reducedMotion:reading.reducedMotion===true,figures:items,figureLayout:{cast:castIds,priority:figurePriority,slots:skinFigures.slots,max:skinFigures.max,framing:skinFigures.framing},packLayers,grade:packLayers?JSON.stringify([packLayers.time,packLayers.mood]):'',timeFadeMs:pack.scene?.timeTransitionMs || 0,
        tapGate,tapMedia,weather:state?.weather || 'none',screen:state?.screen || null,camera:{shot:state?.camera.mode || '',target:state?.camera.actor || ''},dof:state?.dof,effects:sceneEffects,effectTables,safety:effectSafety,skipping,preload:[],
        // The inner-monologue backdrop (the resolved `thinking` effect) while the line on screen is inner monologue.
        thinking:!awaiting && !transitioning && current?.thought ? stageEffectResolve('thinking',effectTables.skin,effectTables.local) : null,
        animatedUi:Boolean(speaker || stageConfig.widgets || !typed || title || faceEmote), callView};
    const displayScene = scene;
    function onSceneDebug(effect) {
        if (effect.op === "title") setTitle({ text: effect.value, nonce: "debug:" + Date.now() });
        else if (effect.op === "emote" && GAL_EMOTES.includes(effect.value)) setDebugEmote({ id: effect.id, kind: effect.value, color: effect.color || colorOf(effect.id), nonce: effect.nonce });
    }
    const place = pack.scene?.backgroundName || '';
    // accepted CG suppresses the face DOM through the complete exit handoff.
    // an ADV layout shows the face window only where its skin places a portrait.
    // an ADV layout without a face window of its own
    // (art.portrait) shows none on wide stages, where its figures stand; on a phone the face shows as a chip on the box's top edge
    // (theme.css「phone face chip」) - out of the text's flow, so no face column (facing) either. faceMode is set below,
    // once the box speaker and who stands on stage are known.
    // a phone line is read in the phone; the dialogue box stays up and keeps the last line read
    // outside the phone (no blank, no hide, no face handoff). The phone line still types through a hidden reader, which
    // drives the phone's reveal, AUTO and the next-page cue exactly as before.
    const phoneLine = Boolean(sourceWidget.phoneLine && current && !transitioning && !awaiting);
    const heldBox = React.useRef(null);
    let boxIndex = page;
    if (phoneLine) { boxIndex = -1; for (let i = page - 1; i >= 0; i--) if (!phoneModBeat(receivedDirection, pages[i]?.para)) { boxIndex = i; break; } }
    const boxLine = !phoneLine ? current : boxIndex >= 0 ? pages[boxIndex] : heldBox.current && heldBox.current.turn < turn ? heldBox.current.line : null;
    if (!phoneLine && current && !transitioning && !current.pending) heldBox.current = { turn, line: current };
    const boxSpeaker = phoneLine ? (boxLine?.kind === 'line' ? bubbleCharacter(config,boxLine)?.alias || '' : '') : speaker;
    const boxMoodList = phoneLine ? bubbleMoodList(config, boxLine ? bubbleCharacter(config, boxLine)?.alias : undefined) : moodList;
    const portraitFace = !film && speaker ? portraits.get(speaker) || null : null;
    const boxFace = phoneLine ? (!film && boxSpeaker ? portraits.get(boxSpeaker) || null : null) : portraitFace;
    // a cast figure is never dropped silently. A sprite outfit
    // without any image stands in as its avatar (its slot), and every display fallback is listed in the stage notice.
    const castMembers = state ? stageViews.speaker.members(state) : [];
    const standIns = castMembers.filter(member => !renderInputs.get(member.id)?.stage && portraits.get(member.id)?.src && stageViews.speaker.standIn(pack.characters.find(figure => figure.alias === member.id)))
        .flatMap(member => !figureLayout ? [member] : member.id in figureLayout.x ? [{...member, x:figureLayout.x[member.id]}] : []);
    const spriteFallbacks = useGalSpriteFallbacks(sessionId, stageViews.speaker.fallbacks(pack.characters, alias => castMembers.some(member => member.id === alias), alias => !!portraits.get(alias)?.src));
    // the host projected an on-stage Live2D figure down to its sprite (no Core).
    
    
    // Who the stage draws (a figure or its stand-in): the box anchors to them, and a skin's off-stage face rule reads it.
    const speakerDrawn = alias => figuresShown && (members.some(member => member.id === alias) || standIns.some(member => member.id === alias));
    // on a wide stage a box
    // speaker drawn on stage shows no face - the figure is the speaker - so the page is faceless (no column, as narration; the
    // face side stays mounted, so the last face clears as it does before narration); phones keep it.
    const faceOffStage = !narrow && activeSkin?.resolvedArt?.marks?.['data-fk-skin-portrait-when'] === 'off-stage' && Boolean(boxSpeaker) && speakerDrawn(boxSpeaker);
    const faceMode = film || accepted.cg || cg.visible ? 'off' : advLayout && !activeSkin?.resolvedArt?.marks['data-fk-skin-portrait'] ? (narrow ? 'chip' : 'off') : 'always';
    // the gutter is latched per page (useGalFaceColumn); every theme only shows a face in a page
    // that reserved its column (narration and faceless pages start at the
    // box padding in every theme, not only classic).
    const pageKey = turn + ":" + page + ":" + card + (transitioning ? ":transition" : "");
    // A phone line keeps the held line's page key, so the box's face and gutter do not change hands.
    const boxPageKey = !phoneLine ? pageKey : heldBox.current && boxLine === heldBox.current.line ? heldBox.current.key : turn + ":" + boxIndex + ":held";
    if (!phoneLine && heldBox.current && heldBox.current.line === current) heldBox.current.key = pageKey;
    const name = current && current.kind === "line" ? bubbleDisplayName(current, config) : "";
    const boxName = !phoneLine ? name : boxLine && boxLine.kind === "line" ? bubbleDisplayName(boxLine, config) : "";
    // a named line the avatar resolver (portraits) gives no face shows the skin's stand-in - its image, or the engine's disc
    // with the displayed name's first glyph - in the face window; narration shows none. Without the declaration such a page
    // stays faceless, as before.
    const placeholderSpec = activeSkin?.resolvedArt?.placeholder || null;
    const standIn = placeholderSpec && boxName && !boxFace?.src ? galPlaceholderFace(placeholderSpec, boxName) : null;
    const facing = useGalFaceColumn(sessionId, boxPageKey, boxSpeaker, portraits, config.characters, faceMode === "always" && !faceOffStage, Boolean(standIn));
    // the shown skin's sound palette replaces the engine's UI cues and voices the
    // stage's own moments - auto / skip switched on (a moment it has no sound for stays silent). A page turn and a speaker
    // change are always silent (mainstream galgame: they would step on the voice line's start).
    const skinSfx = activeSkin?.resolvedSfx || null;
    React.useEffect(() => galSkinSfx("", skinSfx), [skinSfx]);
    // The shown skin's `duck` amounts (upstream stage core 37) while it shows; the engine's once it goes.
    const skinDuck = JSON.stringify(activeSkin?.duck || null);
    React.useEffect(() => {
        if (typeof forkStageAudio !== "object" || !forkStageAudio?.duckBy) return undefined;
        forkStageAudio.duckBy(JSON.parse(skinDuck));
        return () => forkStageAudio.duckBy(null);
    }, [skinDuck]);
    React.useEffect(() => { if (auto) galSkinSfx("auto"); }, [auto]);
    React.useEffect(() => { if (skipLatch) galSkinSfx("skip"); }, [skipLatch]);
    const face = !faceOffStage && (facing || faceMode === "chip") ? standIn || boxFace : null; // a chip takes no column: it shows whenever the speaker has a face
    // a bust portrait is the box speaker's own stage figure, drawn by the
    // scene; the face window keeps the avatar only for a speaker without a figure on stage.
    const bustAlias = activeSkin?.resolvedArt?.bust && faceMode !== 'off' && !faceOffStage && boxSpeaker && members.some(member => member.id === boxSpeaker) ? boxSpeaker : '';
    scene.bust = bustAlias && !stageShot ? {...activeSkin.resolvedArt.bust,alias:bustAlias} : null;
    scene.shot = stageShot ? { alias: stageShot.alias, head: stageShot.head, roll: stageShot.roll } : null;
    // face → no-face pages clear the face before writing (useGalFaceHandoff). Every theme's text
    // column follows the gutter. Skip and backward reading show the final state at once.
    const faceSnap = skipping || !forwardReading;
    const calmMotion = reading.reducedMotion === true || typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const handoff = useGalFaceHandoff(sessionId + ":" + boxPageKey, { facing, shown: Boolean(face && (face.src || face.glyph)), moves: faceMode !== "off", snap: faceSnap || !!accepted.cg || cg.visible, calm: calmMotion, typed });
    // Portraits retain historical stage actor keys; the card speaker identifies the same figure by ref.
    function avatarOf(entry) { return stageViews.speaker.avatarOf(config, pack.avatars, portraits, entry); }
    function nameOf(alias) { const character = bubbleCharacter(config,alias); return character && character.name || ""; }
    // Generic skin hook: the box carries --speaker-x / --stage-w (stage px) only while the line's speaker stands on stage.
    // Under a shot the subject's side is known exactly (no body sampling lag): the statement stands opposite at once.
    // Narration under a shot takes the subject's side too, so it never lies across the figure.
    const shotWide = stageShot && figureLayout?.width > 640;
    const speakerAnchor = stageShot ? ((boxLine?.kind === 'line' && boxSpeaker === stageShot.alias || boxLine?.kind === 'narration') && figureLayout?.width > 0 && !film && !accepted.cg && !cg.visible
        ? { x: Math.round((shotWide ? stageShot.head[0] : 0.5) * figureLayout.width), width: Math.round(figureLayout.width), u: shotWide ? stageShot.head[0] : 0.5, side: stageShot.side } : null)
        : stageViews.speaker.anchor({ line: boxLine, speaker: boxSpeaker, layout: figureLayout, covered: film || !!accepted.cg || cg.visible || sourceWidget.phoneOpen,
        drawn: speakerDrawn });
    const color = speaker ? colorOf(speaker) : "";
    const boxColor = boxSpeaker ? colorOf(boxSpeaker) : "";
    // Generic skin hook (「代表色」): the speaking figure's own colour (character.color = imageColor ??
    // autoColor), none for narration or a speaker without a figure; a skin's art.textbox.tint recolours its trim and cue with it.
    const speakerTint = boxSpeaker && /^#[\da-f]{6}$/i.test(characterOf(boxSpeaker)?.color || "") ? characterOf(boxSpeaker).color : "";
    // art.nameplate.tint (skin-interface.md §2.5): the name's glyphs in the speaker's hue at the plate ink's luminance.
    // art.textbox.height fit lines (skin-interface.md §2.3): the shown card's lines and block set the box's height.
    const boxFit = (transitioning ? inputSubtitles : subtitles).fit;
    const nameTint = speakerTint && activeSkin?.resolvedArt?.marks?.["data-fk-skin-art-name-tint"] !== undefined ? stageSkinTint(activeSkin.nameplate.paint.fg, speakerTint) : "";
    const cueCursor = React.useMemo(() => activeSkin?.cursor && activeSkin.resolvedArt?.tintCue && speakerTint
        ? { ...activeSkin.cursor, ...Object.fromEntries(["color", "accent"].filter(key => activeSkin.cursor[key]).map(key => [key, stageSkinTint(activeSkin.cursor[key], speakerTint)])) } : activeSkin?.cursor, [activeSkin, speakerTint]);
    // the speaker's colour on the stage root too, for what lives outside the
    // box - a button's tint mask (the SKIP frame) and, where the skin opts in (art.textbox.tint.menu), the stage menu's accent:
    // the skin's accent in the speaker's hue, kept readable on its panel. Narration and a speaker without a colour: none.
    const menuTint = React.useMemo(() => speakerTint && activeSkin?.resolvedArt?.marks?.["data-fk-skin-art-tint-menu"] !== undefined ? stageSkinMenuTint(activeSkin, speakerTint) : null, [activeSkin, speakerTint]);
    // the box speaker's own art from the skin (art.cast,
    // keyed by the figure id): its box / plate images and name inks ride on the box as tokens.
    const boxCast = boxSpeaker && boxLine?.kind === "line" && activeSkin?.resolvedArt?.cast ? activeSkin.resolvedArt.cast[characterOf(boxSpeaker)?.ref?.figureId] || null : null;
    const voiceError = (playingHere ? player.error : null) || voicePlayer.getError(voice);
    const voiceState = voiceError ? "error" : playingHere ? (player.audio ? (player.audio.paused ? "paused" : "playing") : "loading") : voice ? "ready" : "";
    // Classic theme (the default): the name is the box's first line (【名字】), spoken lines read 「…」, the side
    // image rises out of the box's left end. Every theme puts the replay button right after the name.
    const theme = stageConfig.theme || "classic";
    const classic = theme === "classic" && !advLayout;
    useFigureTextContrast(React,rootRef,true,theme,film,boxColor,boxName,boxLine?.mood);
    const shownText = current ? (transitioning ? inputSubtitles.text : !film && classic && current.kind === "line" ? galQuoted(subtitles.text, current.pending) : subtitles.text) : "";
    // the unfinished sentence that may still move to the next page stays
    // hidden on the last card of a streaming narration page, so the page never takes back text it showed. Only the last
    // card is the live tail: an earlier card of a streaming page is complete and types to its end (the typewriter's
    // `pending` hold of the last two glyphs is for the tail only).
    const movable = current && current.pending && current.kind === "narration" && !transitioning && lastCard ? stagePageHeldTail(current.text) : "";
    const heldText = boxLine ? (classic && boxLine.kind === "line" ? galQuoted(boxLine.text, false) : boxLine.text) : "";
    // The stage's wheel gestures: up opens the log, down turns a page. an open overlay that
    // owns scroll (the backlog, Config, gallery, system menu, or an open phone / widget sheet: sourceWidget.scrollOwner)
    // keeps every wheel — over the overlay or over the dimmed stage around it, at the top of its content too. A wheel that
    // landed on the stage scrolls that overlay's view; one the overlay's own view forwarded (fromView) is simply dropped.
    function wheel(event) {
        if (sourceWidget.scrollOwner) { if (!event.fromView) sourceWidget.scroll(event); return; }
        if (backlog || configOpen || galleryOpen || menuOpen || Date.now() - backlogClosedAt.current < 450) return;
        if (skipStopped.current) { skipStopped.current = false; return; } // this notch only stopped a fast-forward
        if (event.deltaY > 0 && !hidden && textcard.skip()) return; // hidden → the box comes back first
        const decision = stageViews.controls.wheel(wheelGesture.current, { now: Date.now(), deltaY: event.deltaY, deltaMode: event.deltaMode, typed, hidden });
        wheelGesture.current = decision.state;
        if (decision.action === 'backlog') openBacklog();
        else if (decision.action !== 'none') input(1);
    }
    // Mixer and Config: cheap previews (a short built-in one-shot, the current voice line).
    const testSfx = pack.audio?.sfx[0]?.url;
    const mixTests = { voice: voice ? replay : null, sfx: testSfx ? () => stageSfx.play(testSfx) : null };
    // Boxless narration (centre dim / image band) is opt-in: only a skin that declares art.narration gets a layout; every
    // other skin keeps its own narration box (a figure under classic must not read as another skin).
    const narrationPresentation=React.useRef(null);
    if(!entryGate.visible)narrationPresentation.current=null;
    const narrationLine=sessionId+':'+turn+':'+(boxLine?.para ?? page)+':'+runtime.cursor.visitId;
    narrationPresentation.current=stageNarrationPresentation(narrationPresentation.current,narrationLine,
        {cg:accepted.cg || cg.visible,items:modPerformances.visibleRows,performance:performanceLayer.performance,device:sourceWidget.phoneHeld,regions:modPerformances.regions,scheduled:Object.values(runtime.ledger).map(entry=>({...entry,regions:STAGE_PERFORMANCE_CORE.find(definition=>definition.kind===stagePerformanceKindOf(entry.descriptor))?.regions}))});
    const narrationLayout = activeSkin?.art?.narration ? narrationPresentation.current.layout : undefined;
    const narrationLines = !film && boxLine?.kind === 'narration' && activeSkin?.art?.narration?.lines;
    // while a gained item's frame shows, a skin with
    // art.item.gain.hideText hides the box's words (the original's acquisition has no text up).
    const skinItem = film ? null : activeSkin?.resolvedArt?.item || null;
    const itemHidesText = Boolean(skinItem?.hideText && modPerformances.visibleRows.some(row => row.performance?.payload?.action === 'gain'));
    // A mode's hud.hide puts drawn buttons away while it is on (the debate has no menu gear; Esc still opens the menu); the skin's
    // hud.timer.hide while a timer shows, in every mode, so the clock stands in one place across dialogue and debate.
    const timerHide = stageTimer.shown ? activeSkin?.resolvedArt?.timerHide || [] : [];
    const skinButtons = [...(activeSkin?.resolvedArt?.buttons || []).filter(button => !skinMode?.hide.includes(button.action) && !timerHide.includes(button.action)), ...(skinMode && !dialogueHeld && !narrow ? activeSkin?.resolvedArt?.modeButtons?.[skinMode.id] || [] : [])];
    const backDisabled = turnIndex <= 0 && page === 0 && card === 0 && !transitioning;
    // data-reduced-motion mirrors CONFIG 「减少动态」 for CSS-only theme motion (the crt power-on/blink).
    const menuProps = leaving => Object.assign({ leaving, sessionId, useChat: props.choiceProps.useChat, Regenerate: props.Regenerate, waitLines, regenerate: menuRegenerate, historical: turn !== latestTurn, latestTurn,
        busy: regenerateBlocked, controls: homes.menu, auto, skipping: skipLatch, atEnd }, menuActions);
    return h("div", { ref: rootRef, tabIndex: -1, className: "fork-gal-stage" + (film ? " is-film" : "") + (backlog ? " is-backlog" : "") + (configOpen ? " is-config" : "") + (menuOpen ? " is-menu" : "") + (hidden ? " is-ui-hidden" : "") + (textcard.up ? " is-textcard" : ""), "data-theme": theme, "data-entry": entryGate.phase, "data-entrance": entrance.stageAttr, "data-skin-buttons": homes.declared.join(" ") || undefined, "data-reduced-motion": reading.reducedMotion === true || undefined, "data-cg-visible": !!accepted.cg || cg.visible || undefined, "data-narration-layout": narrationLayout, "data-phone-open": sourceWidget.phoneOpen || undefined, "data-fk-context": "stage-" + theme, "data-hud": hud.state || undefined, "data-speaking": speaker ? "true" : "false", "data-fk-portrait-bust": bustAlias ? "" : undefined, "data-fork-stage-turn": turn, "data-fork-stage-para": para,
        "data-fk-tx-leaving": stageLeaving || undefined, "data-fk-tx-entering": stageEntering || undefined, "data-fk-veil": veilShown.current || undefined,
        // the current skin's text percent; theme.css multiplies the skin's own sizes by it
        // and keeps the text block where the skin puts it (data-fk-text-scale: only set off 100%, so 100% is untouched).
        style: { ...(textPercent === 100 ? null : { "--fk-text-scale": textPercent / 100 }), ...(speakerTint ? { "--speaker-tint": speakerTint } : null), ...menuTint }, "data-fk-text-scale": textPercent === 100 ? undefined : textPercent,
        "data-speaker-tint": speakerTint ? "" : undefined, "data-fk-item-gain": itemHidesText || undefined, "data-fk-dialogue-held": dialogueHeld || undefined, "data-fk-shot": stageShot ? stageShot.side : undefined,
        onClick: event => { if (galleryOpen || menuOpen || event.target.closest("button, a, input, textarea, select")) return; input(1); },
        onPointerMove: hud.onPointerMove, onPointerLeave: hud.onPointerLeave,
        // conventional galgame wheel: up opens the log, down advances.
        // A gesture that just closed the backlog does not also turn pages.
        onWheel: wheel,
        onContextMenu: event => { event.preventDefault(); if(galleryOpen)return; if (hidden) setHidden(false); else setHidden(true); } },
        h(GalScene, { start:loadGate.visible, onPresented:revision => { loadGate.onPresented(revision); if (entryGate.visible) onPresented(revision); else if (entrance.active) heldPresented.current = revision; }, onBackdrop:loadGate.onBackdrop, scene: displayScene, onDebug: onSceneDebug, onUi, onError: setSceneError, reload: sceneReload, onLayout: setFigureLayout }),
        !accepted.cg && !cg.visible && figuresShown && !stageShot && standIns.length ? h(GalStandIns, { members: standIns, portraits, colorOf }) : null,
        cg.node,
        // the item glow takes the speaker's 形象色.
        // art.item (stage-skin-adv.md): the skin draws the card as the original's frame.
        modPerformances.node && React.cloneElement(modPerformances.node,{accent:color || undefined,skinItem:skinItem || undefined}),
        h(ModStageLayers,{sessionId,config,sourceKey:receivedDirection.token?.sourceKey,stage:{title:props.data?.cardName,turn,latestTurn,scene:place,bgm:track?.name}}),
        textcard.node,
        h("div", {className:"fork-gal-scene-hold" + (entryGate.visible ? " is-resolved" : ""), "aria-hidden":true}),
        h(GalWidgets,{owner:sourceWidget,onBacklog:openBacklog,onAdvance:()=>input(1),onWheel:wheel}),
        sourceWidget.claim ? h('div', { className: 'fork-widget-source-controls', role: 'toolbar', 'aria-label': '模组演出控制', onClick: event => event.stopPropagation() },
            control('auto', auto ? '停止自动（A）' : '自动翻页（A）', () => { setSkipping(false); setAuto(!auto); }, auto),
            control('skip', skipLatch ? '停止跳过' : '跳过（按住 Ctrl 快进）', toggleSkip, skipping, atEnd),
            control('backlog', '履历（L）', openBacklog), menuButton(), h('button', { type: 'button', className: 'fork-gal-control', onClick: () => input(1) }, '继续')) : null,
        // the skin's box and plate motion as numeric keyframes (stageSkinMotionKeyframes).
        skinMotionKeyframes ? h("style", null, skinMotionKeyframes) : null,
        // §9.1: the skin's flat transition shapes sweeping over the stage while a surface comes or goes.
        h(SkinSweep, { sweep: skinSweep }),
        h(SkinSweep, { sweep: speakerSweep }),
        // the skin's swappable images kept decoded (--art-warm, stageSkinArt)
        h("i", { className: "fork-skin-art-warm", "data-fk-layer": "", "aria-hidden": true }),
        // A skin's name and UI faces shaped once while the stage opens (theme.css «skin font warm»): a large CJK face first
        // used at a speaker's entrance otherwise builds its glyph tables in that frame (~70-130 ms at 4k).
        activeSkin ? h("span", { className: "fork-skin-font-warm", "aria-hidden": true }, h("i", null, "永あA"), h("b", null, "永あA")) : null,
        h("svg", { className: "fork-gal-look-defs", "aria-hidden": true, width: 0, height: 0, focusable: "false" },
            h("filter", { id: "fork-gal-look-ui", colorInterpolationFilters: "sRGB", filterUnits: "userSpaceOnUse", x: "-640", y: "-640", width: "5200", height: "3400" }, h("feColorMatrix", { type: "matrix", values: "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" }))),
        h("div", { className: "fork-gal-letterbox", "aria-hidden": true }, h("i"), h("i")),
        h(stageEntryContextType().Provider, { value: entryStore }, h("div", { ref: topbarRef, className: "fork-gal-topbar", onClick: event => event.stopPropagation(), onFocus: hud.onFocus, onBlur: hud.onBlur },
            h("div", { className: "fork-gal-topleft" },
                turn !== latestTurn && receivedDirection && !["done", "error"].includes(receivedDirection.status) ? h("div", { className: "fork-gal-history-direction", "data-state": receivedDirection.status, "aria-live": "polite" },
                    receivedDirection.status === "running" ? h("span", { className: "fork-gal-history-direction-progress", role: "status" }, "演出生成中…") :
                        h("button", { type: "button", className: "fork-gal-generate-turn", onClick: () => rpc('retryStageDirection',{turn},sessionId).then(() => runtime.store.dispatch({type:'DIRECTOR_WAKE'})) }, "为这一轮生成演出")) : null,
                entryDock("scene")), // background (bg-manual.js), BGM (bgm-player.js), 声音 (gal-mixer.js)
            h("div", { className: "fork-gal-topright" },
                entryDock("feature"), // mods (gal-widgets.js), danmaku (danmaku-ui.js), 电影模式
                menuFold ? menuFoldButton() : null,
                // the stage's own ✕, last in the top bar, revealed with it in every skin.
                h("button", { type: "button", className: "fork-gal-quit", title: "返回主页面", "aria-label": "返回主页面", onClick: props.onExit }, h(Icon, { name: "close", size: 16 }))),
            // the runtime notice is laid out from the top bar's own box
            // (theme.css ".fork-gal-topbar > .fork-gal-notices"), so it sits under whatever the skin puts top-right.
            (interopNotice || awaitingDirection || roundPhase || firstRun.keys || firstRun.sound || runtime.indicators.error || accepted.scene?.diagnostics?.length || sceneError || cg.notice || spriteFallbacks.length) ?
            h(GalRuntimeStatus, { interopNotice, page: awaitingDirection, round: roundPhase, onStop: roundPhase ? stopReply : null, stopping, hints: firstRun, danmaku: typeof DANMAKU_MOD === 'string' && entryStates['mod:' + DANMAKU_MOD]?.available === true, bodyFailure, onRetry: bodyRetry, error: runtime.indicators.error, diagnostics: accepted.scene?.diagnostics, sceneError, onReloadScene: () => setSceneReload(n => n + 1), cgNotice:cg.notice, spriteFallbacks, nameOf,
                scope: sessionId }) : null)),
        // the skin's own LOG / AUTO / SKIP on the stage;
        // with them the top bar's chips wait behind Esc and the folded menu control (theme.css「stage skin: art」).
        // A skin mode's own buttons (modes.<id>.buttons: the debate's fast-forward) while the mode is on and no title holds the box.
        skinButtons.length || activeSkin?.resolvedArt?.decor?.length ? h(stageViews.SkinButtons, { buttons: skinButtons, decor: activeSkin.resolvedArt.decor || [], keyCaps: stageViews.controls.keyCaps, auto, skipping: skipLatch, atEnd, menuOpen,
            onBacklog: openBacklog, onAuto: () => { setSkipping(false); setAuto(!auto); }, onSkip: toggleSkip, onMenu: () => openMenu(false) }) : null,

        awaiting ? h("div", { className: "fork-gal-box is-awaiting", role: "status", "aria-label": awaitingText },
            activeSkin ? h(StageSkinFrame,{skin:activeSkin,page:'awaiting'}) : h(GalBoxFrame),
            // the box does not echo the submitted text (it reads in the backlog); only the wait.
            // the wait is UI, not story text - the shared wait look (UI type, accent dots and
            // rules, theme.css "stage wait"), and it is the 停止 control while the reply can be stopped.
            h("div", { className: "fork-gal-text fork-gal-writing" }, (function () {
                const wait = awaitingText === GAL_AWAITING_WRITING && writingWaitRef.current
                    ? h(StageWaitLines, { first: writingWaitRef.current.first, start: writingWaitRef.current.start, lines: waitLines }) : h(StageWaitLines, { text: awaitingText });
                return stopReply ? h(StageWaitStop, { label: awaitingText, busy: stopping, onStop: stopReply }, wait) : h("span", { className: "stage-wait" }, h("span", { className: "stage-wait-body" }, wait));
            })()),
            h("div", { className: "fork-gal-progress", "aria-hidden": true })) :
        // is-speaking = the page's line is still being delivered -
        // its words typing, or its voice playing (a skin's art.portrait.frame.speaking frame shows then).
        h("div", { className: "fork-gal-box" + (sourceWidget.claim ? " is-source-widget-line" : "") + (transitioning ? " fork-gal-transition" : "") + (boxLine && boxLine.kind === "narration" ? " is-narration" : "") + (hidden ? " is-hidden" : "") + (skipping ? " is-skipping" : "") + (menuFold && auto ? " is-auto" : "") + (boxLine && boxLine.thought ? " is-thought" : "") + (phoneLine ? " is-phone-held" : "") + (faceMode !== "off" ? " has-face" : "") + (facing ? " is-facing" : "") + (current && !current.pending && !phoneLine && (!typed || voiceState === "playing") ? " is-speaking" : ""), style: { "--bubble-color": boxColor || "var(--fork-accent)", "--speaker-tint": speakerTint || undefined, "--art-np-tint": nameTint || undefined, "--art-fit-block": boxFit ? boxFit.block + "px" : undefined, ...boxCast?.style, ...(speakerAnchor ? { "--speaker-x": speakerAnchor.x + "px", "--stage-w": speakerAnchor.width + "px", "--speaker-u": String(speakerAnchor.u) } : null) }, 'data-speaker-side': speakerAnchor ? speakerAnchor.side : undefined, 'data-speaker-tint': speakerTint ? "" : undefined, 'data-fit-lines': boxFit ? boxFit.lines : undefined, 'data-art-cast': boxCast ? (boxCast.fill ? 'fill' : '') : undefined, 'data-figure-skip-color':boxColor, role: "region", "aria-label": "舞台文本", "aria-hidden": sourceWidget.claim || undefined },
            // textbox.motion (§18 E4): the frame remounts on each page, so its motion plays once per page.
            activeSkin ? h(StageSkinFrame,{key:activeSkin.textbox.motion ? 'frame:' + boxPageKey : 'frame',skin:activeSkin,page:boxPageKey,narration:boxLine?.kind === 'narration'}) : h(GalBoxFrame),
            // every theme shares the bottom-aligned sprite face window.
            faceMode !== "off" ? h(GalSide, { face, emote: faceEmote, snap: faceSnap || handoff.cut, calm: calmMotion, clearMs: galFaceClearMs(calmMotion),
                name: boxName, nameArc: activeSkin?.resolvedArt?.faceName || null, tint: activeSkin?.resolvedArt?.marks['data-fk-skin-portrait-tint'] === '',
                moodOf: activeSkin?.resolvedArt?.marks['data-fk-skin-portrait-mood'] === '' ? stateId => bubbleMoodBadge(stateId, boxMoodList, config, boxSpeaker)?.label : null }) : null,
            phoneLine ? (boxName ? h(GalNamePlate, { key: boxName, name: boxName, mood: bubbleMoodBadge(boxLine.mood, boxMoodList, config, boxSpeaker)?.label, classic, film, ransom, voiceState: "", voiceError: null, onReplay: replay }) : null) :
            name ? h(GalNamePlate, { key: name, name, parts: nameInitials && !film ? galNameParts(name, bubbleCharacter(config, current)) : null, mood: bubbleMoodBadge(current.mood, moodList, config, speaker)?.label, classic, film, ransom, voiceState, voiceError, onReplay: replay }) : null,
            transitioning ? h("div", { className: "fork-gal-transition-label" }, "你 · 第 " + turns[turnIndex + 1] + " 轮") : null,
            h("div", { ref: textRef, className: "fork-gal-text", "aria-live": phoneLine ? "off" : "polite" },
                phoneLine && boxLine ? h(GalTypewriter, { key: "held:" + boxPageKey, text: heldText, speed: reading.textSpeed, skin: activeSkin, instant: true, reducedMotion:reading.reducedMotion,photosensitive:reading.photosensitive }) : null,
                current ? h(phoneLine ? "span" : React.Fragment, phoneLine ? { className: "fork-gal-phone-reader", "aria-hidden": true } : null, h(narrationLines ? GalNarrationLines : GalTypewriter, { key: sessionId + ":" + turn + ":" + page + ":" + card + (transitioning ? ":transition:" + inputCard : ""), text: shownText, lines: narrationLines, speed: reading.textSpeed, skin: activeSkin, instant: typed || skipping, hold: handoff.holding || beatHeld, pending: current.pending && lastCard, movable,reducedMotion:reading.reducedMotion,photosensitive:reading.photosensitive,
                    visibleKey:sourceWidget.readingKey,onVisible:value=>sourceWidget.onVisible(Array.from(current.text).slice(0,subtitles.cards[card]?.start || 0).join('') + value.slice(Math.max(0,shownText.indexOf(subtitles.text)),Math.max(0,shownText.indexOf(subtitles.text))+subtitles.text.length)),
                    onReveal:ordinal=>performanceLayer.cue({cueId:'type',ordinal:[page,card,ordinal]}), onDone: () => setTyped(true) }))
                    : h("span", { className: "stage-waiting" }, streaming ? "……" : "还没有正文"),
                current && current.pending && !phoneLine ? h("span", { className: "fork-gal-typing", "aria-label": "正在生成" }, h("i"), h("i"), h("i")) : null,
                // the next-page cue is laid out with the page from its first frame and only shown when
                // typed, so its arrival cannot re-wrap the last line (theme.css "stage typewriter").
                current && !current.pending ? h("span", { className: "fork-gal-next" + (activeSkin?.cursor ? " fork-skin-next" : "") + (typed && !atEnd ? "" : " is-waiting"), "aria-hidden": true }, activeSkin?.cursor ? h(StageSkinCursor,{cursor:cueCursor,active:typed&&!atEnd,snap:runtime.cursor.mode==='history'||skipping}) : null) : null),
            // while this reply's choices generate their wait sits here, under the page, in
            // the reply wait's look (StageWaitStop + StageWaitLines, portalled by gal-choices.js); empty, it takes no room.
            h("div", { ref: setChoiceWaitSlot, className: "fork-gal-box-wait" }),
            // a live tavern_roll's strip sits on the box's top edge, out of its flow, on the page it lands on and
            // fades out on the next (one-shot; its record is the round's 履历 line) (dice-roll.js).
            props.choiceProps && props.choiceProps.useChat ? h(DiceRolls, { useChat: props.choiceProps.useChat, nativeTurn: runtime.textIndex.get(turn)?.nativeTurn || 0, pageKey }) : null,
            // film mode shows the page count briefly on each page turn
            // (the keyed node restarts its CSS fade); hover still shows it in full.
            h("div", { key: film ? "flash:" + pageKey : "meta", className: "fork-gal-meta" + (film ? " is-flash" : "") },
                h("span", null, pages.length ? (page + 1) + " / " + pages.length + (streaming ? "+" : "") : "")),
            // phones show only stageViews.controls.ids(true); the rest is in the menu.
            menuFold ? null : h("div", { className: "fork-gal-controls", role: "toolbar", "aria-label": "舞台控制", "data-compact": narrow || undefined },
                stageViews.controls.ids(narrow).filter(id => stageViews.controls.drawn(id, activeSkin)).map(id =>
                    id === "auto" ? control("auto", auto ? "停止自动（A）" : "自动翻页（A）", () => { setSkipping(false); setAuto(!auto); }, auto) :
                    id === "skip" ? control("skip", skipLatch ? "停止跳过" : "跳过（按住 Ctrl 快进）", toggleSkip, skipping, atEnd) :
                    id === "eye-off" ? control("eye-off", "隐藏文本框（H / 右键）", () => setHidden(true)) :
                    id === "chevron-left" ? control("chevron-left", "上一页（左箭头 / PageUp）", () => input(-1), undefined, backDisabled) :
                    id === "backlog" ? control("backlog", "履历（L）", openBacklog) :
                    // ≡ opens the system menu for touch and mouse too; Esc still opens it.
                    menuButton()))),
        // the countdown plate (timer-stage.js); its own pause button is the only control on it.
        // After the text box: a skin's box art may span the whole stage (e.g. a frame that carries the top-right flourish), and the
        // digits stay above it; the top bar, drawn buttons and panels stay above the plate (theme.css).
        stageTimer.element,
        // The entry veil: it covers the whole stage until the gate is ready (gal-entry.js), never a notice over the scene.
        h(GalEntryOverlay, {phase:entryGate.phase, progress:loadProgress, nameOf, loader:entryLoader, entrance:entrance.overlay}),
        entrance.element,
        // a roll arriving live is thrown as two d10s in the band above the box, then
        // becomes its static card; never on history, reload, an open overlay or while skipping (silent, no WebGL at skip pace:
        // stageSkipShows; starting a skip ends a throw at its card) (dice-throw.js). Only the CONFIG
        // 减少动态 setting ends it at once — the throw does not follow the OS reduced-motion setting (ui-design R20). Like the
        // other one-shots it waits under the first-entry veil and plays once the scene shows (veiled).
        props.choiceProps && props.choiceProps.useChat ? h(DiceThrow, { sessionId, useChat: props.choiceProps.useChat, running, following: presenting === 'live', device, rootRef, calm: reading.reducedMotion === true, safety: effectSafety,
            veiled: !entryGate.visible,
            replay: replaying && runtime.replay?.phase === 'play' ? runtime.cursor.visitId : historyRolls, nativeTurn: runtime.textIndex.get(turn)?.nativeTurn || 0,
            live: (presenting === 'live' || !!historyRolls) && !skipping && !film && !hidden && !backlog && !configOpen && !galleryOpen && !menuOpen }) : null,
        // Reading done: the next move sits in the middle of the screen.
        // a latest turn with nothing to read (an HTML introduction / opening chooser) is done too: the
        // panel offers 生成选项 and 自由输入 (no 重新生成); leaving is the existing 返回主页面 (R13).
        atEnd && (typed || openingOnly) && !hidden && props.Choices ? h(props.Choices, Object.assign({}, props.choiceProps, { key: sessionId + ":" + turn, sessionId, atEnd, hidden: awaiting || Boolean(sourceWidget.openKey), waitSlot: choiceWaitSlot, waitLines,
            // 重新生成 — the same busy rule as the system menu's 重新生成 item.
            onRegenerate: props.Regenerate && !openingOnly ? openRegenerate : undefined, regenerateDisabled: regenerateBlocked,
            withdrawnText: withdrawal && withdrawal.landed ? withdrawal.text : "",
            onSending: (text, how) => { setAuto(false); setWithdrawal(null); pickRef.current = { text: String(text || ""), offered: Boolean(how && how.offered) }; setWaiting({ turn, text: String(text || ""), seen: false }); },
            onSendFailed: () => setWaiting(null), onInputActivity: stageTimer.onInputActivity, fallbackRef: stageTimer.fallbackRef })) : null,
        galleryOpen ? h(CgGallery,{key:sessionId,sessionId,store:runtime.store,onClose:()=>{setGallery(false);backlogClosedAt.current=Date.now();}}) : null,
        configOpen || configLeaving ? h(GalConfigScreen, { sessionId, data: props.data, tests: mixTests, textSkin: shownSkin.current, skinHud: activeSkin?.hud?.reveal || "auto", skinPending: configSkin.pending === true, onClose: closeConfig, leaving: configLeaving }) : null,
        // §18 E3: after closing, a drawn menu with an exit motion stays mounted (inert) while its items leave.
        menuOpen ? h(stageViews.menu.Menu, menuProps(false)) : menuLeaving ? h(stageViews.menu.Menu, menuProps(true)) : null,
        // a running / finished clip export, while the reader keeps playing.
        null,
        backlog || backlogLeaving ? h(GalBacklog, { leaving: backlogLeaving, sessionId, config, direction:receivedDirection, readDirection:args=>rpc('getStageDirection',args,sessionId), textIndex:runtime.textIndex, voiceOf:descriptor => stageVoiceHandle(sessionId,descriptor,config,descriptor.paragraphId), turn, pages, page, useChat: props.choiceProps && props.choiceProps.useChat, colorOf, avatarOf, nameOf, quote: classic && !film, onJump: jumpBack, onClose: closeBacklog,
            // the skin's per-role looks; a bubble's side is the speaker's slot in the
            // stage's figure layout (galFigureLayout x, the side rule galShotSubject reads), null when not standing.
            looks: backlogLooks, sideOf: alias => figureLayout?.x && alias in figureLayout.x ? (figureLayout.x[alias] > 0.5 ? "right" : "left") : null,
            nameParts: nameInitials && !film ? (name, entry) => galNameParts(name, bubbleCharacter(config, entry)) : null }) : null,
        title ? h(GalTitle, { key: title.nonce, title, timing: stageEffectResolve("title", effectTables.skin, effectTables.local), reducedMotion: reading.reducedMotion === true, onDone: endTitle }) : null);
    // the registered entries of one top-bar side, in priority order. Each sits in a
    // .fork-stage-entry (display: contents); one with a badge carries data-attention and stays on screen while the bar hides.
    function entryDock(group) {
        const ctx = { sessionId, rpc, place, live: runtime.cursor.mode !== 'history' && !skipping, widgets: sourceWidget, film,
            openConfig: (tab, opener) => { stageViews.configScreen.select(tab); openConfig(opener); } };
        const list = stageEntries.list(group), node = entry => h("span", { key: entry.id, className: "fork-stage-entry", "data-stage-entry": entry.id,
            "data-attention": entryStates[entry.id]?.badge ? "" : undefined }, entry.render(ctx));
        // HUD-line entries (the place / background and track / BGM labels) share one line: phones truncate it as a unit.
        const hud = list.filter(entry => entry.hud);
        return [hud.length ? h("span", { key: "hud-line", className: "fork-gal-hud-line" }, hud.map(node)) : null, ...list.filter(entry => !entry.hud).map(node)];
    }
    // the folded quick menu's one top-right control - 「菜单」 capsule or ≡ orb.
    function menuFoldButton() {
        return h("button", { key: "menu-fold", type: "button", className: "fork-gal-menu-fold", "data-kind": menuFold, "data-action": "menu", title: "菜单（Esc）", "aria-label": "菜单", "aria-haspopup": "menu", "aria-expanded": menuOpen,
            onClick: event => { event.stopPropagation(); openMenu(false); } },
            menuFold === "orb" ? h(Icon, { name: "menu", size: 20 }) : [h("i", { key: "arrow", className: "fork-gal-menu-fold-arrow", "aria-hidden": true }), h("span", { key: "label" }, "菜单")]);
    }
    // ≡ opens the system menu; its own Enter / Space (keyboard focus) never also turns the page -
    // the stage's key guard leaves them to the button (galKeyboardFocus).
    function menuButton() {
        return h("button", { key: "menu", type: "button", className: "fork-gal-control fork-gal-menu-toggle", "data-action": "menu", title: "菜单", "aria-label": "菜单", "aria-haspopup": "menu", "aria-expanded": menuOpen,
            onClick: event => { event.stopPropagation(); openMenu(false); } }, controlIcon("menu", menuOpen));
    }
    function control(icon, label, action, active, disabled) {
        return h("button", { key: icon, type: "button", className: "fork-gal-control" + (active ? " is-active" : ""), "data-action": stageViews.controls.actionFor(icon), title: label, "aria-label": label, "aria-pressed": active === undefined ? undefined : Boolean(active), disabled: Boolean(disabled),
            onClick: event => { event.stopPropagation(); action(); refocusStage(event, icon === "eye-off"); } }, controlIcon(icon, active, disabled));
    }
    function controlIcon(icon, active, disabled) {
        const art = activeSkin?.resolvedControlIcons?.[stageViews.controls.actionFor(icon)];
        if (!art) return h(Icon, { name: icon, size: 17 });
        const glyph = h("img", { key: "icon", className: "fork-gal-control-icon", src: active && art.on || art.image, alt: "", "aria-hidden": true, draggable: false });
        // the icon on the skin's drawn body - its
        // normal / on / disabled image by state, the hover image over it under the pointer and keyboard focus (theme.css
        // 「box controls」).
        const body = art.button;
        if (!body) return glyph;
        // narrow (§18 N14): the phone's own bodies beside the wide ones; the stylesheet shows one set per width.
        const drawn = (set, narrow) => {
            const [x, y, w, hh] = set.glyph;
            return h("span", { key: narrow ? "narrow" : "wide", className: "fork-gal-control-art" + (narrow ? " is-narrow" : ""), "aria-hidden": true, "data-hover": set.hover ? "" : undefined, "data-disabled": set.disabled ? "" : undefined,
                style: { "--qm-aspect": set.aspect, "--qm-gx": x, "--qm-gy": y, "--qm-gw": w, "--qm-gh": hh } },
                h("img", { key: "body", className: "fork-gal-control-body", src: disabled && set.disabled || active && set.on || set.normal, alt: "", draggable: false }),
                set.hover && !disabled ? h("img", { key: "hover", className: "fork-gal-control-body is-hover", src: active && set.on || set.hover, alt: "", draggable: false }) : null,
                narrow ? h("img", { key: "icon", className: "fork-gal-control-icon", src: active && art.on || art.image, alt: "", "aria-hidden": true, draggable: false }) : glyph);
        };
        return body.narrow ? [drawn(body, false), drawn(body.narrow, true)] : drawn(body, false);
    }
    // a pointer click leaves focus on the button, where the next Space
    // or Enter would press it again (the hide button re-hid the box). Pointer clicks hand focus back to the stage root;
    // keyboard presses keep it, except hiding, whose button is no longer on screen.
    function refocusStage(event, always) {
        const root = rootRef.current;
        if ((always || event && event.detail > 0) && root && typeof root.focus === "function") root.focus({ preventScroll: true });
    }
}

function useGalFaceColumn(...args) { return stageViews.useFaceColumn(...args); }
function useGalFaceHandoff(...args) { return stageViews.useFaceHandoff(...args); }
function galFaceClearMs(...args) { return stageViews.faceClearMs(...args); }
function galHandoffAutoDelay(...args) { return stageViews.handoffAutoDelay(...args); }
function useGalSpriteFallbacks(...args) { return stageViews.notices.useSpriteFallbacks(...args); }
function GalStandIns(props) { return stageViews ? React.createElement(stageViews.StandIns, props) : null; }
// an on-stage Live2D figure is showing its static sprite (or nothing) because
// this machine has no Cubism Core (the user imports it: official page, then the file). One ⚠ notice 「Live2D 未安装 · 安装」; 安装 unfolds the shared licence + install entry
// (CubismCoreEntry, as in 设置 › DSH Tavern › 运行库) in place. Installing re-reads the stage (stage-session-binding.js),
// so the figures switch to Live2D without a reload; the notice goes as soon as the Core is in.

// first-run hints, shown in the stage's notice stack (not a modal) once the entry
// is revealed. keys: the stage's real shortcuts (GAL_SHORTCUTS), once per profile — 「已看过」 is kept in the persisted
// host-only frame storage (forkFrameStorage.seen / markSeen, frame-storage.json), which survives restarts and port changes;
// nothing shows before that store has loaded, nor without it. sound: 「点任意处开启声音」 while the browser's autoplay policy
// holds the BGM back (stageMusic.blocked()), at most once per page load. Any key or click dismisses both; the same
// gesture resumes the audio (the BGM kick and the mixer resume listen to it). A click on the bare stage only dismisses
// (it does not also turn the page); keys pass through (A still starts auto). the first page turn
// (auto, skip or a click) also retires the key list, and the system menu's 「快捷键」 shows it again (showKeys).
const GAL_NO_PHONE_CALL = Object.freeze({ subscribe: () => () => {}, stage: () => '' });
function useGalFirstRunHints(...args) { return stageViews.hints.useHints(...args); }
// The text box's wait names it (its aria-label); the default one shows the rotating wait lines (wait-lines.js).
const GAL_AWAITING_WRITING = '正在书写下一幕';
function galAwaitingText(activity) {
    if (activity?.role === 'settlement' && (activity.busy || ['pending', 'running'].includes(activity.phase))) {
        return '正在等待上一轮后台结算，完成后开始正文';
    }
    return GAL_AWAITING_WRITING;
}
function useCapabilityNotice(...args) { return stageViews.notices.useCapabilityNotice(...args); }
function GalRuntimeStatus(props) { return stageViews ? React.createElement(stageViews.notices.Status, props) : null; }
// a stage moment's skin cue, or (cue "") the shown skin's palette (returns its
// cleanup). Pages without the UI sound module (tests, previews) stay silent.
function galSkinSfx(cue, palette) {
    const sfx = typeof forkUiSfx === "object" && forkUiSfx ? forkUiSfx : null;
    if (cue) return void sfx?.play?.(cue);
    sfx?.useSkin?.(palette || null);
    return () => sfx?.useSkin?.(null);
}
function useGalNarrow() { return stageViews.useNarrow(); }
function useGalTopbarGroup(...args) { return stageViews.useTopbarGroup(...args); }
function useGalHudReveal(...args) { return stageViews.useHudReveal(...args); }

function GalHudLabels(props) {
    return stageViews ? React.createElement(stageViews.HudLabels, props) : null;
}
function GalNamePlate(props) {
    return stageViews ? React.createElement(stageViews.NamePlate, props) : null;
}
function galNameParts(...args) { return stageViews.nameParts(...args); }

// Stable slots render only the optional plugin's current view implementation.
let stageViews = null;
function GalStageHost(props) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    return enabled && stageViews ? React.createElement(stageViews.Host, props) : null;
}
function GalStageToggle(props) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    return enabled && stageViews ? React.createElement(stageViews.Toggle, props) : null;
}
function bindStageViews(createViews) {
    if (stageViews) throw new Error('Stage views already mounted');
    const views = createViews({React, ReactDOM, window, document, navigation:stageNavigation,
        useBubbles, GalStage, Icon,
        admission:{performance, setTimeout, clearTimeout, Spinner},
        widgets:{sandbox:WidgetSandbox, sounds:forkUiSfx, report:useStageEntryState, entries:stageEntries, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame},
        phoneAdjust:{navigator, pad:STAGE_WIDGET_PLACE_PAD, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame},
        skinDecoration:{clock:forkForeground, MutationObserver:globalThis.MutationObserver, ResizeObserver:globalThis.ResizeObserver},
        skinCursor:{matchMedia, clock:forkForeground},
        textcard:{clock:forkForeground},
        textcardFonts:{FontFace:globalThis.FontFace,fonts:tavernFonts},
        textcardPlayer:{performance,requestAnimationFrame,cancelAnimationFrame,setInterval,clearInterval,setTimeout,clearTimeout},
        textcardLayout:{getComputedStyle,figureTextColor,figurePlateColor},
        choices:{ReactDOM,sounds:forkUiSfx,useSounds:useForkUiSfxControls,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,TextArea,Icon,StageWaitStop,StageWaitLines,getComputedStyle,ResizeObserver:globalThis.ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
        choiceLayout:{getComputedStyle},
        regenerate:{report:(...args)=>tavernErrorHub.report(...args),sounds:forkUiSfx,useSounds:useForkUiSfxControls,episode:stageWaitLinesEpisode,waitLines:STAGE_WAIT_LINES,HelpTip,Segmented,TextArea,StageWaitStop,StageWaitLines},
        backlogView:{voicePlayer,useDiceBacklog,diceBacklogEntries,diceLine,useClipBacklog:typeof useClipBacklog==='function'?useClipBacklog:undefined,useJumpLatest,JumpLatest,useFigureTextContrast,stageSkinBacklogPlateStyle,stageSkinBacklogPlate,bubbleCharacter,galQuoted,VoiceButton,PackImage,Icon,HelpTip,Spinner,getComputedStyle,ResizeObserver:globalThis.ResizeObserver,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame},
        backlogPaging:{hydrateText:(sessionId,turn)=>stageSessions.owner?.hydrateText?.(sessionId,turn), hasOlder:sessionId=>stageSessions.owner?.hasOlder?.(sessionId), loadOlder:sessionId=>stageSessions.owner?.loadOlder?.(sessionId)},
        backlogHistory:{read:sessionId=>rpc('getStageModHistory',{},sessionId), subscribe:(sessionId,refresh)=>tavernSessionSignals.subscribe(sessionId,'stage-direction',refresh,refresh,refresh)},
        backlogVoice:{player:voicePlayer, wake:()=>forkLipSync?.wake?.()},
        backlogRows:{voiceDescriptor:stageVoiceDescriptor, registry:createStagePerformanceRegistry, core:STAGE_PERFORMANCE_CORE, pointer:stagePerformancePointer},
        configAppearance:{getComputedStyle, rpc, cards:bubbleStore, reading:stageReading, quality:stageQuality, prefetch:stageSkinPrefetch, sounds:forkUiSfx, FloatingPanel, Icon, Spinner, ResetButton},
        configText:{reading:stageReading, limits:STAGE_READING_LIMITS, defaults:STAGE_READING_DEFAULTS, scale:STAGE_TEXT_SCALE, scaleOf:stageTextScaleOf, fonts:tavernFonts, FontPicker, clock:forkForeground, autoDelay:galAutoDelay},
        configScreen:{matchMedia, rpc, sections:STAGE_CONFIG_SECTIONS, useSounds:useForkUiSfxControls, sounds:forkUiSfx, Icon, },
        configFields:{HelpTip, Segmented, Slider, ResetButton, FontPicker, InlineField, sounds:forkUiSfx, classify:type=>type===GalConfigSwitch?"toggle":null},
        phoneLayout:{storage:(() => {try {return localStorage;} catch (_) {return null;}})(), width:()=>innerWidth, ResetButton, sections:STAGE_CONFIG_SECTIONS},
        cg:{ResizeObserver, clock:forkForeground, consumer:createCgConsumer, paint:cgPaintFrame, policy:cgMotionPolicy, rpc},
        gallery:{ResizeObserver, IntersectionObserver, AbortController, clock:forkForeground, owner:() => stageSessions.resourceOwner, consumer:createCgConsumer, paint:cgPaintFrame, revision:usePackRevision, rpc, Spinner},
        device:{matchMedia},
        mixer:{reading:stageReading, voiceRateLimits:STAGE_READING_LIMITS.voiceRate, Icon, Slider, audio:forkStageAudio, sounds:forkUiSfx, entries:stageEntries, report:useStageEntryState, icons:ICON_PATHS},
        sfx:{Audio, audio:forkStageAudio, foreground:forkForeground, matches:stageResourceMatches},
        music:{audio:forkStageAudio,foreground:forkForeground,fetch,AbortController},
        bgm:{session:id => stageSessions.get(id),owner:() => stageSessions.resourceOwner,
            read:id => rpc("getStageMusicTracks",{},id), storage:(() => {try {return localStorage;} catch (_) {return null;}})(), authority:source => stageResourceAuthority(source)},
        ambience:{session:id => stageSessions.get(id), owner:() => stageSessions.resourceOwner, authority:source => stageResourceAuthority(source)},
        soundscape:{Audio, mixer:forkStageAudio},
        timer:{rpc, crypto, performance, setInterval, clearInterval, Icon, foreground:forkForeground, ResizeObserver, MutationObserver,
            getResourceOwner:() => stageSessions.resourceOwner, resourceAuthority:stageResourceAuthority, createRects:createStageRects, createKeyframeLayer:createPerformanceKeyframeLayer, useModOptions, performanceSafety},
        video:{getService:() => packTransport.service, fetch, URL, stageVideo, audio:forkStageAudio, foreground:forkForeground, setTimeout, clearTimeout},
        loader:{getService:() => packTransport.service, fetch, URL, AbortController, decodeImage:stageDecodeImage, spinnerArt:stageSkinSpinner},
        transitions:{getComputedStyle, DOMMatrixReadOnly, ease:stageSkinTxEase, setTimeout, clearTimeout},
        speaker:{character:bubbleCharacter,resolve:(...args) => figureResolution.resolveFigureName(...args),render:packFigureRenderInputs},
        chatEntry:{MutationObserver,markdown:TavernColoredMarkdown,enter:galEnter,plain:galPlain,blocks:galBlocks,paragraphs:galParagraphs,parse:parseBubbles,schedule:setTimeout,cancel:clearTimeout},
        menu:{sounds:forkUiSfx,getSession:id => stageSessions.get(id)},
        position:{storage:(() => {try {return localStorage;} catch (_) {return null;}})(), setTimeout, clearTimeout, sameAnchor, navigate:(...args) => stageSessions.owner.navigate(...args)},
        subtitles:{foreground:forkForeground, fonts:tavernFonts, getComputedStyle, ResizeObserver, heldTail:stagePageHeldTail, quote:galQuoted},
        notices:{foreground:forkForeground, displayPreferences, getSelection, StageWaitStop, Spinner, Icon, providerRefusal:tavernProviderRefusalNotice, errorText:stageRuntimeErrorText, diagnosticText:stageDiagnosticText},
        hints:{storage:forkFrameStorage,setTimeout,clearTimeout},
        presentation:{foreground:forkForeground, titleTiming:STAGE_EFFECTS.title, matchMedia, getComputedStyle, ResizeObserver, MutationObserver},
        portraits:{foreground:forkForeground, SpriteImage, PackImage, emoteDataUrl:galEmoteDataUrl, cssColor:galCssColor, MutationObserver, getComputedStyle, matchMedia},
        labels:{getComputedStyle, ResizeObserver, requestAnimationFrame, cancelAnimationFrame},
        text:{performance, ResizeObserver, getComputedStyle, clock:forkForeground,
            fonts:tavernFonts, sounds:forkUiSfx, defaultTextSpeed:STAGE_READING_DEFAULTS.textSpeed}});
    stageViews = views;
    let stopBgm = null, disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (stageViews === views) stageViews = null;
        const errors = [];
        for (const cleanup of [() => stopBgm?.(), bgmChanged, () => views.dispose()]) {
            try { cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Stage views cleanup failed');
    };
    try {
        stopBgm = views.bgm.subscribe(bgmChanged);
        bgmChanged();
        return dispose;
    } catch (error) {
        try { dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Stage view binding failed'); }
        throw error;
    }
}
