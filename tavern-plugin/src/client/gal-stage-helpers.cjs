// Stage helpers: the galgame stage's top-level pure functions and hooks (gal-stage.js includes this source inside its
// module factory; Node tests require it or evaluate it beside their stubs). Runtime neighbours (typewriter pages, bubble
// characters, React) are read only when called.
// galIsSuperseded(...) reads the host projection; never changes its visibility or history.
function galIsSuperseded(view, nativeTurn, storyTurn) {
    const mappings = view && view.regeneratedDshTurns || {};
    const replacement = Number(mappings[storyTurn]);
    if (replacement > 0) return Number(nativeTurn) !== replacement;
    // Replacement native turns are also suppressed by the host, but remain our authoritative source.
    if (Object.values(mappings).some(turn => Number(turn) === Number(nativeTurn))) return false;
    return (view && view.suppressedDshTurns || []).some(turn => Number(turn) === Number(nativeTurn));
}

// Plain reading text for the text box: markdown decorations off, line breaks kept.
function galPlain(text) { return stagePagePlain(text); }
// Narration: one page per paragraph; a long paragraph splits at sentence ends.
// Paragraph blocks, counted exactly like the host director (lib/domain/stage-director.js
// stageParagraphs): blank lines split; HTML blocks, rules and empty blocks do not count.
function galBlocks(text) {
    return String(text || "").split(/\n\s*\n/).filter(block => block.trim() && !/^\s*</.test(block) && !/^\s*[-*_]{3,}\s*$/.test(block));
}
function galNarrationPages(text) {
    const pages = [];
    galBlocks(text).forEach(function (block) { galBlockPages(block).forEach(page => pages.push(page)); });
    return pages;
}
function galBlockPages(block) { return stageBlockPages(block); }
// One source index for chat entries, stage pages and history rows. Pagination never adds paragraphs.
function galParagraphs(parts, base = 0) {
    const units = [];
    let para = base;
    parts.forEach(function (part, partIndex) {
        if (part.units) {units.push(...part.units);return;}
        (part.segments || []).forEach(function (segment, index) {
            const lastSegment = partIndex === parts.length - 1 && index === part.segments.length - 1;
            if (segment.kind === "markdown") {
                const blocks = galBlocks(segment.text);
                blocks.forEach((block, b) => units.push({ kind: "narration", block, text: galPlain(block), para: ++para, index,
                    pending: Boolean(lastSegment && part.streaming && b === blocks.length - 1) }));
            } else {
                units.push({ kind: "line", para: ++para, index, alias: segment.alias, name: segment.name, mood: segment.mood,
                    text: segment.thought ? "（" + segment.text + (segment.streaming ? "" : "）") : segment.text,
                    thought: segment.thought, pending: Boolean(segment.streaming), voice: part.voices && part.voices[index] || null });
            }
        });
    });
    return units;
}
// Each page carries its source paragraph number (para, from 1) for the director's cues.
function galPages(parts) {
    return galParagraphs(parts).flatMap(function (unit) {
        const { block, index, ...page } = unit;
        if (unit.kind !== "narration") return [page];
        const texts = stagePageCards(unit).map(card => card.text);
        return texts.map((text, n) => ({ ...page, text, pending: page.pending && n === texts.length - 1 }));
    });
}
// Display only (classic text box): a spoken line reads 「…」. Text that already opens with a bracket
// (a thought's （…）, a quote the model wrote itself) is left alone; the closing bracket waits until
// the line has finished streaming.
function galQuoted(text, pending) {
    const value = String(text || "").replace(/^\s+/, "");
    if (!value || /^[「『（(【〈《“"‘'［\[]/.test(value)) return value;
    return "「" + value + (pending || /」$/.test(value) ? "" : "」");
}
// Speakers up to the page, most recent last; the stage keeps at most three.
function galCast(pages, at, offstage = new Set()) {
    const order = [];
    for (let i = 0; i <= at && i < pages.length; i++) {
        const page = pages[i];
        if (page.kind !== "line" || offstage.has(page.alias)) continue;
        const found = order.findIndex(item => item.alias === page.alias);
        if (found >= 0) order[found] = { alias: page.alias, name: page.name, mood: page.mood, last: i };
        else order.push({ alias: page.alias, name: page.name, mood: page.mood, last: i });
    }
    const kept = order.slice().sort((a, b) => b.last - a.last).slice(0, 3);
    // Stable left-to-right order: first appearance.
    return order.filter(item => kept.includes(item));
}

// Director cues (host: lib/domain/stage-director.js) for the page's paragraph: the latest
// scene with a picture and the latest cast at or before it.
// running responses may carry an in-memory validated prefix.
function galHasDirection(direction) {
    return Boolean(direction && (direction.status === "done" || direction.status === "running" && (direction.protocol === "incremental-v1" ? direction.through >= 1 : direction.entries && direction.entries.length)));
}
function galDirectionCovers(direction, para) {
    return galHasDirection(direction) && (direction.status === "done" || para <= (direction.protocol === "incremental-v1" ? direction.through : direction.entries[direction.entries.length - 1].at));
}
function galCarriedDirection(direction, carried, pages, at, offstage = new Set(), looks) {
    const start = { ...(direction && direction.start || carried || {}), moods: direction && direction.start && direction.start.moods || carried && carried.moods || {} };
    if (start.protocol === "incremental-v1" && !direction?.protocol) direction = { ...direction, protocol: start.protocol };
    if (direction && direction.entries && direction.protocol !== "incremental-v1") direction = { ...direction, entries: stagePacing(start, direction.entries, looks, direction.units).entries };
    const para = pages[at] && pages[at].para || 1;
    const entries = galHasDirection(direction) ? (direction.entries || []).filter(entry => entry.at <= para) : [];
    if (galDirectionCovers(direction, para)) return { ...direction, start };
    let cast = (start.cast || []).filter(id => !offstage.has(id));
    entries.forEach(entry => { if (entry.cast) cast = entry.cast.filter(id => !offstage.has(id)); });
    const since = entries.length ? entries[entries.length - 1].at : 0;
    const recent = cast.slice(), order = cast.slice();
    pages.slice(0, at + 1).forEach(function (page) {
        if (page.para <= since || page.kind !== "line" || offstage.has(page.alias)) return;
        const index = recent.indexOf(page.alias);
        if (index >= 0) recent.splice(index, 1);
        recent.push(page.alias);
        if (!order.includes(page.alias)) order.push(page.alias);
    });
    const kept = recent.slice(-3), next = order.filter(id => kept.includes(id));
    if (next.join("\n") !== cast.join("\n")) entries.push({ at: para, cast: next });
    return { ...direction, status: "done", start, entries };
}
function galEndState(direction, carried, pages, offstage, looks, figureCatalog, config) {
    const at = pages.length - 1, para = pages[at] && pages[at].para || 1;
    const effective = galCarriedDirection(direction, carried, pages, at, offstage, looks);
    const cue = galCue(effective, para, offstage), staging = galStaging(effective, para, offstage, undefined, looks);
    const cast = staging.order, focus = {}, look = {}, moods = {};
    staging.members.forEach(function (member) {
        if (!member.visible) return;
        if (member.focus !== "normal" && member.focus !== "close") focus[member.id] = member.focus;
        if (member.look) look[member.id] = member.look;
        moods[member.id] = galMoodOf(pages, at, member.id, config) || effective.start.moods[member.id] || "";
    });
    if (direction?.protocol === "incremental-v1" && direction.end) return { ...direction.end, moods,
        ...(figureCatalog && (Object.keys(figureCatalog).length || effective.start.figureScale) ? { figureScale: figureCarry(figureDirection(effective.start, direction.entries, figureCatalog, para)) } : {}) };
    return { scene: cue.scenes[cue.scenes.length - 1] || "", cast, order: cast.slice(), outfits: cue.outfits, music: cue.music,
        focus, look, moods, light: staging.light, lighting: staging.lighting, weather: staging.weather, camera: staging.camera,
        dof: staging.dof, figureLight: staging.figureLight,
        pacing: stagePacing(effective.start, effective.entries, looks, para).pacing,
        // deterministic across turn boundaries, including player-input pages.
        ...(figureCatalog && (Object.keys(figureCatalog).length || effective.start.figureScale) ? { figureScale: figureCarry(figureDirection(effective.start, direction?.figureToken ? direction.entries : effective.entries, figureCatalog, para)) } : {}) };
}
function galTurnState(previous, sessionId, turn) {
    if (previous && previous.sessionId === sessionId && previous.turn === turn) return previous;
    return { sessionId, turn, start: previous && previous.sessionId === sessionId && turn === previous.turn + 1 ? previous.end : null, end: null };
}
// Hash text only: voice readiness and other render metadata must not invalidate a bookmark.
function galTextDigest(parts) {
    const text = parts.map(part => typeof part.text === "string" ? part.text : (part.segments || []).map(segment => segment.text || "").join("\n")).join("\n");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}
// Offsets ignore pagination whitespace (page splitting trims its edges).
function galPositionAnchors(pages) {
    const offsets = new Map();
    return pages.map(function (page) {
        if (page.anchor) return { para: page.anchor.para, offset: page.anchor.offset, length: String(page.text || "").length };
        const offset = offsets.get(page.para) || 0;
        const length = String(page.text || "").replace(/\s/g, "").length;
        offsets.set(page.para, offset + length);
        return { para: page.para, offset, length };
    });
}
function galRestorePosition(saved, turn, pageCount, textDigest, pages = []) {
    const valid = saved && saved.turn === turn && saved.textDigest === textDigest && Number.isInteger(saved.page);
    let page = valid ? Math.max(0, Math.min(saved.page, Math.max(0, pageCount - 1))) : 0;
    const anchors = galPositionAnchors(pages), anchor = valid && saved.anchor;
    const anchored = anchor && Number.isInteger(anchor.para) && Number.isInteger(anchor.offset) && anchor.offset >= 0
        ? anchors.findIndex(item => item.para === anchor.para && item.offset <= anchor.offset && anchor.offset < item.offset + item.length) : -1;
    if (anchored >= 0) page = anchored;
    const target = anchored >= 0 ? anchor : anchors[page];
    return { turn, page, pageCount, textDigest, ...(Number.isInteger(saved && saved.latestSeenTurn) ? { latestSeenTurn: saved.latestSeenTurn } : {}), ...(target ? { anchor: { para: target.para, offset: target.offset } } : {}) };
}
// a cold runtime can publish an empty/unloaded row or a temporary
// text prefix. None of those is permission to consume a durable reading bookmark.
// callers that also restore pass `digestOf` so the turn text is hashed at most once.
function galPositionReady(saved, turn, parts, pages, digestOf = () => galTextDigest(parts)) {
    if (!turn || !parts.length || !pages.length || parts.some(part => part.streaming || part.unloaded) || pages.some(page => page.pending)) return false;
    if (!saved || saved.turn !== turn) return true;
    if (saved.textDigest !== digestOf()) return false;
    if (saved.anchor) return galPositionAnchors(pages).some(item => item.para === saved.anchor.para && item.offset <= saved.anchor.offset && saved.anchor.offset < item.offset + item.length);
    return pages.length >= (saved.pageCount || saved.page + 1);
}
// Consume wheel notches, never queue a burst for later. A gesture is quiet for 300ms; its first downward
// action (finish the line, else the next page) locks the rest of that gesture, even if typing completes.
function galWheelDecision(previous, event) {
    const now = event.now, dy = Number(event.deltaY);
    if (!Number.isFinite(dy) || !dy) return { state: previous, action: 'none' };
    const direction = Math.sign(dy);
    const fresh = !previous || previous.direction !== direction || now - previous.lastEvent >= 300 || now < previous.lastEvent;
    const state = fresh ? { direction, lastEvent: now, delta: 0, used: false } : { ...previous, lastEvent: now };
    const pixels = Math.abs(dy) * (event.deltaMode === 1 ? 100 / 3 : event.deltaMode === 2 ? 100 : 1);
    state.delta += pixels;
    if (state.delta < 100) return { state, action: 'none' };
    state.delta %= 100;
    // upward wheel opens the log; keys and the Back control still page back.
    if (direction < 0) return { state, action: 'backlog' };
    if (state.used) return { state, action: 'none' };
    state.used = true;
    return { state, action: event.typed && !event.hidden ? 'advance' : 'finish' };
}
function galPositionWriter(sessionId, storage, schedule, cancel) {
    const key = "fork-stage-position:" + sessionId;
    let saved = null, pending = null, timer = null;
    try { saved = JSON.parse(storage && storage.getItem(key) || "null"); } catch (_) {}
    function flush() {
        if (timer !== null) cancel(timer);
        timer = null;
        if (!pending) return;
        try { if (storage && sessionId) storage.setItem(key, JSON.stringify(pending)); } catch (_) {}
        pending = null;
    }
    function discard() { if (timer !== null) cancel(timer); timer = null; pending = null; }
    return { saved, flush, discard,
        write(value) { pending = value; if (timer === null) timer = schedule(flush, 250); } };
}
function galNewEffects(memory, key, effects) {
    if (memory.key !== key) { memory.key = key; memory.played = new Set(); }
    const counts = new Map();
    return effects.filter(function (effect) {
        const value = JSON.stringify(effect), index = counts.get(value) || 0;
        counts.set(value, index + 1);
        const id = value + ":" + index;
        if (memory.played.has(id)) return false;
        memory.played.add(id);
        return true;
    });
}
// Missing appearance media is a display fallback only. Keep the requested outfit
// in the canonical cue so restoring the asset restores the same appearance.
function galPortraitOf(alias, characters, models, outfits, protocol) {
    const character = characters.find(item => item.alias === alias) || null;
    const outfit = character && outfits[alias] ? (character.outfits || []).find(item => item.label === outfits[alias]) : null;
    const modelId = outfit ? outfit.model : character && character.portrait;
    let model = modelId ? models.find(item => item.id === modelId && !item.retired) || null : null;
    if (!model && protocol === "incremental-v1" && character && outfit) model = models.find(item => item.id === character.portrait && !item.retired) || null;
    return { character, model };
}
function galCue(direction, para, offstage = new Set()) {
    const cue = { scenes: [], cast: null, outfits: {}, music: "" };
    if (!galHasDirection(direction)) return cue;
    if (direction.protocol === "incremental-v1") cue.sceneCleared = Boolean(direction.start && direction.start.sceneCleared);
    if (direction.start && direction.start.scene) cue.scenes.push(direction.start.scene);
    if (direction.start && direction.start.cast) cue.cast = direction.start.cast;
    Object.assign(cue.outfits, direction.start && direction.start.outfits || {});
    if (direction.start && direction.start.music) cue.music = direction.start.music;
    if (direction.start && direction.start.assetRefs) { cue.sceneRef = direction.start.assetRefs.scene; cue.musicRef = direction.start.assetRefs.music; }
    (direction.entries || []).forEach(function (entry) {
        if (entry.at > para) return;
        if (direction.protocol === "incremental-v1" && Object.prototype.hasOwnProperty.call(entry, "scene")) { cue.scenes = entry.scene ? [entry.scene] : []; cue.sceneCleared = !entry.scene; cue.sceneRef = entry.assetRefs && entry.assetRefs.scene; }
        else if (entry.scene) { cue.scenes.push(entry.scene); cue.sceneRef = entry.assetRefs && entry.assetRefs.scene; }
        if (entry.cast) cue.cast = entry.cast;
        Object.assign(cue.outfits, entry.outfits || {});
        if (Object.prototype.hasOwnProperty.call(entry, "music")) { cue.music = entry.music === "none" ? "" : entry.music; cue.musicRef = entry.assetRefs && entry.assetRefs.music; }
    });
    if (cue.cast) cue.cast = cue.cast.filter(id => !offstage.has(id));
    Object.keys(cue.outfits).forEach(function (id) { if (offstage.has(id)) delete cue.outfits[id]; });
    if (!galDirectionCovers(direction, para)) cue.cast = null;
    return cue;
}
// Staging DSL (host: stage-director.js parseDirection / stagingState). State-like commands (focus,
// look, zoom, cast) are recomputed from the turn's start up to the paragraph, so paging back
// restores them; one-shot commands (act, shake, flash, fade) and entrances/exits belong to the
// paragraph itself. Layout keeps a stable left-to-right order (galOrder): nobody changes sides
// while on stage; arrivals join on the side they come from. Close-ups last for their paragraph and
// the next two. Offstage actors are never staged. stageable(id), when given, says who has a
// figure to stand on stage (avatar-only characters only show in the face window): slots are laid out
// among them and the rest get x: undefined. Members: { id, x, focus, look, visible, enter, exit };
// exiting members come last with visible: false.
const GAL_FOCUS = { close: 1.45, normal: 1 };
// Must match the host (stage-director.js stageOrder).
function galOrder(order, cast, sides) {
    const kept = (order || []).filter(alias => cast.includes(alias));
    const pending = new Set();
    function insert(alias) {
        if (kept.includes(alias)) return;
        // resolve newly declared after targets before their dependents.
        if (pending.has(alias)) { kept.push(alias); return; }
        pending.add(alias);
        const side = sides && sides[alias] || "";
        const after = side.startsWith("after:") ? side.slice(6) : "";
        if (after && after !== alias && cast.includes(after) && !kept.includes(after)) insert(after);
        if (!kept.includes(alias)) {
            if (side === "left") kept.unshift(alias);
            else if (side === "center") kept.splice(Math.ceil(kept.length / 2), 0, alias);
            else if (after && kept.includes(after)) kept.splice(kept.indexOf(after) + 1, 0, alias);
            else kept.push(alias);
        }
        pending.delete(alias);
    }
    cast.forEach(insert);
    return kept;
}
// one equal slot per figure; historical absolute positions are ignored.
function galSlotMap(order, stageable) {
    const placed = stageable ? order.filter(stageable) : order, map = {};
    const slots = placed.length > 3 ? placed.map((_, i) => 0.1 + 0.8 * i / (placed.length - 1)) : live2dSlots(placed.length);
    placed.forEach((id, i) => { map[id] = slots[i]; });
    return map;
}
// Cinematic vocabulary. Persistent: light, weather, cam, dof, glow /
// shadow / lit (figure light), and trans (the transition of the scene change on its line). One-shots: beat,
// emote, title, act. Legacy commands map onto them: shake N / flash / fade black|in → beat, zoom in →
// cam push, zoom out → cam reset. Sound: sfx is a one-shot; environment loops use record snapshots.
// light names any stage look id; ids the loaded looks do not know fall back to
// auto when the scene resolves them.
const GAL_STAGE_LIGHT = /^[a-z][a-z0-9-]{0,31}$/;
const GAL_STAGE_WEATHERS = ["rain", "storm", "snow", "sakura", "leaves", "sparkle"];
const GAL_STAGE_SHOTS = ["push", "close", "pan-left", "pan-right", "dutch"];
// blink (skin-interface.md §18 E7): eyelids close over the stage, the picture changes behind them, they open;
// slash: four slanted bars sweep across instead. Both only as a skin's default (the director's words stay six).
const GAL_STAGE_TRANSITIONS = ["cut", "fade", "black", "white", "wipe", "iris", "blink", "slash"];
const GAL_STAGE_ACTS = ["nod", "shake", "jump", "tremble", "turn", "bow", "lean", "step-back"];
function galCommand(command) {
    if (!command || !command.op) return null;
    const op = command.op, value = command.value;
    if (op === "zoom") return { op: "cam", value: value === "in" ? "push" : "reset" };
    // Canonical effect ids only: a deleted or misspelt name plays nothing.
    if (op === "beat") return STAGE_EFFECT_BEATS.includes(value) ? { op, value } : null;
    if (op === "emote") return GAL_EMOTES.includes(value) && command.id ? { op, id: command.id, value } : null;
    if (op === "act") return GAL_STAGE_ACTS.includes(value) && command.id ? command : null;
    if (op === "title") { const text = String(value == null ? "" : value).trim(); return text ? { op, value: Array.from(text).slice(0, 24).join("") } : null; }
    return command;
}
// paragraphs a close-up holds after the one that cues it.
const GAL_CLOSE_PARAS = 4;
// A carried camera (direction.start.camera): { value, id } or a plain shot name; the legacy zoom flag.
function galStartCamera(start) {
    const camera = start.camera;
    const value = typeof camera === "string" ? camera : camera && camera.value || "";
    if (GAL_STAGE_SHOTS.includes(value)) return value === "close" ? (camera.id ? { value, id: camera.id } : { value: "" }) : { value };
    return { value: !camera && start.zoom === "in" ? "push" : "" };
}
function galStaging(direction, para, offstage = new Set(), stageable, looks) {
    const out = { members: [], effects: [], order: [], light: "auto", lighting: { time: "auto", mood: "none" }, timeFadeMs: 800, weather: "", camera: { value: "" }, dof: "", figureLight: {}, transition: "" };
    if (!galHasDirection(direction)) return out;
    // Accept the old single-alias argument for existing callers.
    if (typeof offstage === "string") offstage = new Set(offstage ? [offstage] : []);
    const keep = alias => alias && !offstage.has(alias);
    const start = direction.start || {}, incremental = direction.protocol === "incremental-v1";
    const transientFocus = {};
    const positionedSlots = order => galSlotMap(order, stageable);
    let cast = (start.cast || []).filter(keep);
    let order = galOrder((start.order || []).filter(keep), cast, {});
    const focus = Object.assign({}, start.focus), look = Object.assign({}, start.look), focusAt = {};
    let light = GAL_STAGE_LIGHT.test(start.light || "") ? start.light : "auto";
    let weather = GAL_STAGE_WEATHERS.includes(start.weather) ? start.weather : "";
    let camera = galStartCamera(start), cameraAt = 0;
    let dof = typeof start.dof === "string" && start.dof !== "off" ? start.dof : "";
    const figureLight = {};
    Object.keys(start.figureLight || {}).forEach(function (id) { if (keep(id) && (start.figureLight[id] === "glow" || start.figureLight[id] === "shadow")) figureLight[id] = start.figureLight[id]; });
    if (!incremental) {
        if (camera.id && !cast.includes(camera.id)) camera = { value: "" };
        if (dof && !cast.includes(dof)) dof = "";
        Object.keys(figureLight).forEach(function (id) { if (!cast.includes(id)) delete figureLight[id]; });
    }
    Object.keys(look).forEach(function (id) { if (!keep(id) || offstage.has(look[id])) delete look[id]; });
    let transition = "";
    const entering = {}, exiting = [];
    (direction.entries || []).forEach(function (entry) {
        if (entry.at > para) return;
        const here = entry.at === para;
        const before = order.slice(), xBefore = positionedSlots(before), focusBefore = Object.assign({}, focus);
        const sides = {};
        if (entry.scene) transition = "";
        // a close-up never survives a scene change (a new place is a new shot).
        if (entry.scene && camera.value === "close") camera = { value: "" };
        (entry.commands || []).forEach(function (raw) {
            if (raw && (offstage.has(raw.id) || raw.op === "look" && (offstage.has(raw.value) || offstage.has(raw.at)))) return;
            const command = galCommand(raw);
            if (!command) return;
            const id = command.id;
            if (id !== undefined && !keep(id)) return;
            const op = command.op, value = command.value;
            if (op === "pos") sides[id] = value;
            else if (op === "enter") { if (!sides[id] && value !== "fade") sides[id] = value; if (here) entering[id] = value; }
            else if (op === "exit") { if (incremental) delete transientFocus[id]; if (here && before.includes(id)) exiting.push({ id, x: xBefore[id], focus: focus[id] || "normal", to: value }); delete entering[id]; }
            else if (op === "focus") {
                if (incremental && command.transient) transientFocus[id] = { value, at: entry.at };
                else { delete transientFocus[id]; if (value !== "close") delete focus[id]; else { focus[id] = value; focusAt[id] = entry.at; } }
            }
            else if (incremental && op === "reset-transients") Object.keys(transientFocus).forEach(id => delete transientFocus[id]);
            else if (op === "look") { if (value === "viewer") delete look[id]; else look[id] = value; }
            else if (op === "light") { if (typeof value === "string" && GAL_STAGE_LIGHT.test(value)) light = value; }
            else if (op === "weather") { if (value === "none") weather = ""; else if (GAL_STAGE_WEATHERS.includes(value)) weather = value; }
            else if (op === "cam") {
                if (value === "wide" || value === "reset") camera = { value: "" };
                else if (value === "close") { if (id) { camera = { value, id }; cameraAt = entry.at; } }
                else if (GAL_STAGE_SHOTS.includes(value)) camera = { value };
            }
            else if (op === "dof") { if (value === "off" || (!id && !value)) dof = ""; else if (id) dof = id; }
            else if (op === "glow" || op === "shadow") { if (id) figureLight[id] = op; }
            else if (op === "lit") { if (id) delete figureLight[id]; }
            else if (op === "trans") { if ((entry.scene || incremental) && GAL_STAGE_TRANSITIONS.includes(value)) transition = value; }
            else if (op === "beat" || op === "emote" || op === "title" || op === "act" || op === "sfx") { if (here) out.effects.push(command); }
        });
        if (entry.cast) { cast = entry.cast.filter(keep); order = galOrder(order, cast, sides); }
        // Arrivals and departures written only as a new [list] still fade at their slots.
        if (here) {
            order.forEach(function (id) { if (!before.includes(id) && !(id in entering)) entering[id] = "soft"; });
            before.forEach(function (id) { if (!order.includes(id) && !exiting.some(item => item.id === id)) exiting.push({ id, x: xBefore[id], focus: focusBefore[id] || "normal", to: "soft" }); });
        }
        if (incremental) for (const id of Object.keys(transientFocus)) if (!cast.includes(id)) delete transientFocus[id];
        // Legacy per-person state ends on exit; incremental persistent state is retained.
        if (!incremental) {
            [focus, look, figureLight].forEach(map => Object.keys(map).forEach(function (id) { if (!cast.includes(id)) delete map[id]; }));
            Object.keys(look).forEach(function (id) { if (look[id] !== "away" && !cast.includes(look[id])) delete look[id]; });
            if (camera.id && !cast.includes(camera.id)) camera = { value: "" };
            if (dof && !cast.includes(dof)) dof = "";
        }
    });
    const slots = positionedSlots(order);
    order.forEach(function (id) {
        let level = incremental && transientFocus[id] && para - transientFocus[id].at <= 2 ? transientFocus[id].value : focus[id] || "normal";
        if (!incremental && level === "close" && !(para - (focusAt[id] == null ? -99 : focusAt[id]) <= 2)) level = "normal";
        if (level !== "close") level = "normal";
        out.members.push({ id, x: slots[id], focus: level, look: look[id] || "", light: figureLight[id] || "", visible: true, enter: entering[id] || "", exit: "" });
    });
    exiting.forEach(function (item) {
        if (order.includes(item.id)) return;
        out.members.push({ id: item.id, x: item.x, focus: "normal", look: "", light: "", visible: false, enter: "", exit: item.to });
    });
    // a close-up is a short emphasis, not a held framing: this paragraph plus GAL_CLOSE_PARAS.
    if (camera.value === "close" && para - cameraAt > GAL_CLOSE_PARAS) camera = { value: "" };
    const layers = stageLightingReplay(start, (direction.entries || []).filter(entry => entry.at <= para), looks);
    Object.assign(out, { order, light, lighting: layers.lighting, timeFadeMs: layers.timeFadeMs, weather, camera: camera.id && !cast.includes(camera.id) ? { value: "" } : camera, dof: dof && !cast.includes(dof) ? "" : dof, figureLight, transition });
    return out;
}
// Keeps figures that just left the stage for a moment (visible: false) so every departure can
// fade out instead of vanishing. Items: [{ key, ... }].
function useGalPresence(items, ms) {
    const memory = React.useRef(new Map());
    const [, tick] = React.useState(0);
    const now = forkForeground.now(), keys = new Set(items.map(item => item.key)), leaving = [];
    items.forEach(item => memory.current.set(item.key, { item, until: 0 }));
    memory.current.forEach(function (record, key) {
        if (keys.has(key)) return;
        if (!record.until) record.until = now + ms;
        if (record.until <= now) { memory.current.delete(key); return; }
        leaving.push(Object.assign({}, record.item, { visible: false, speaking: false, talking: false, audio: null, act: null, enter: "", exit: record.item.visible === false ? record.item.exit : "soft" }));
    });
    React.useEffect(function () {
        if (!leaving.length) return;
        const timer = forkForeground.setTimeout(() => tick(n => n + 1), ms + 40);
        return () => forkForeground.clearTimeout(timer);
    });
    return items.concat(leaving);
}
// Gaze direction on screen for a member: -1 left, 0 viewer, 1 right; null when not directed.
function galGaze(look, x, others) {
    if (!look) return null;
    if (look === "away") return x > 0.5 ? 1 : -1;
    const target = others[look];
    if (target == null || Math.abs(target - x) < 0.01) return 0;
    return target > x ? 1 : -1;
}
// where the current line's speaker stands, for skins that point at
// them (a bubble tail). The speaker is the alias the single resolver gave the line (bubbleCharacter); its place is
// where the scene reports the figure's body is drawn (layout.body: the picture's body centre through the figure's own
// transform and the settled camera, sampled once the figure stands still), else - a DOM stand-in, or before the first
// settled sample - the reported layout slot (galFigureLayout x) moved by the settled camera; times the reported stage
// width, so nothing is measured here. Spoken lines and inner monologue (both kind "line") anchor; narration, a speaker
// that is not drawn on stage (parked, no sprite or stand-in), a CG or the open phone does not -> null.
function galSpeakerAnchor({ line, speaker, layout, drawn, covered }) {
    if (covered || !line || line.kind !== "line" || !speaker || !layout || !(layout.width > 0) || !layout.x || !(speaker in layout.x) || !drawn(speaker)) return null;
    // Under a close-up (or any framed shot) the camera's settled goal moves the figure on screen: (x - fx) * zoom + ax.
    const c = layout.camera, slot = Number(layout.x[speaker]), body = layout.body?.[speaker];
    const x = Number.isFinite(body) ? body : c && c.zoom > 0 ? (slot - c.fx) * c.zoom + c.ax : slot;
    // A speaker framed out (or left as a sliver at the edge) has no anchor.
    if (!Number.isFinite(x) || x < 0.04 || x > 0.96) return null;
    // Three sides, like the original's three balloons (textLeft / textCenter / textRight): the middle fifth is the centre.
    return { x: Math.round(x * layout.width), width: Math.round(layout.width), u: Math.round(x * 1000) / 1000, side: x < 0.4 ? "left" : x > 0.6 ? "right" : "center" };
}
// who stays visible when the viewport or the skin's maxFigures cannot show the whole
// cast (gal-scene.js galFigureLayout). Deterministic for a page: the speaker, the close-up actor, the most recent
// other speakers, then stage order. Display only. Nothing persistent outranks recency: with two speakers
// alternating, each page shows the same pair (a gaze target ranked here swapped in on every other page).
function galFigurePriority(cast, first) {
    const out = [];
    for (const id of first.concat(cast)) if (id && cast.includes(id) && !out.includes(id)) out.push(id);
    return out;
}
// the skin's stage projection - where figures
// stand, how many are drawn, the framing, whether listeners dim, whether figures draw at all. The one reader for every
// display mode (skin, film, classic, phone): a display mode changes chrome, never who stands where. A skin that leaves
// maxFigures out draws at most 3, and so does a built-in theme with no pack
// skin document (classic and the other built-ins too).
function stageSkinFigures(skin) {
    return { slots: skin?.figureSlots, max: skin?.maxFigures ?? 3, framing: skin?.figures, dimListeners: skin?.dimListeners !== false, shown: skin?.figures?.mode !== "none" };
}
// Speakers before the page, most recent first: this turn's earlier pages, then the earlier turns' pages (newest first).
function galRecentSpeakers(pages, page, earlier, aliasOf, limit = 6) {
    const out = [];
    const scan = (list, from) => {
        for (let i = from; list && i >= 0 && out.length < limit; i--) {
            const alias = list[i]?.kind === "line" ? aliasOf(list[i]) : "";
            if (alias && !out.includes(alias)) out.push(alias);
        }
    };
    scan(pages, page - 1);
    for (const list of earlier) scan(list, list ? list.length - 1 : -1);
    return out;
}
// whom a performance's speaker shot frames on
// this page and on which side. speakers: the on-stage speaker of every page from the shot's first page in this round to
// this one ('' for narration or a speaker not on stage, which keeps the shot). alternate: the first subject stands left, a
// new subject takes the other side, the same one keeps it; anchor: the side of the subject's ordinary stage slot (slotOf).
// Only the names in page order decide, so history, skip and refresh frame the same page the same way. Nobody yet: null.
function galShotSubject(speakers, rule, slotOf) {
    let alias = "", side = "";
    for (const id of speakers) {
        if (!id || id === alias) continue;
        side = rule === "anchor" ? (slotOf(id) > 0.5 ? "right" : "left") : !alias ? "left" : side === "left" ? "right" : "left";
        alias = id;
    }
    return alias ? { alias, side } : null;
}
// The shot's framing for a side: the declared side, else the other side mirrored (x, roll); roll omitted = 0.
function galShotSide(shot, side) {
    const other = side === "left" ? "right" : "left", own = shot.head[side], mirror = shot.head[other];
    const roll = shot.roll?.[side] ?? (shot.roll?.[other] !== undefined ? -shot.roll[other] : 0);
    return { head: own || [1 - mirror[0], mirror[1], mirror[2]], roll };
}
// Latest mood of a character up to the page (for their portrait expression).
function galMoodOf(pages, at, alias, config) {
    for (let i = Math.min(at, pages.length - 1); i >= 0; i--) if (pages[i].kind === "line" && bubbleCharacter(config, pages[i])?.alias === alias) return pages[i].mood || "";
    return "";
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { galIsSuperseded, galPlain, galBlocks, galNarrationPages, galBlockPages, galParagraphs, galPages, galQuoted, galCast, galHasDirection, galDirectionCovers, galCarriedDirection, galEndState, galTurnState, galTextDigest, galPositionAnchors, galRestorePosition, galPositionReady, galWheelDecision, galPositionWriter, galNewEffects, galPortraitOf, galCue, GAL_FOCUS, galOrder, galSlotMap, GAL_STAGE_LIGHT, GAL_STAGE_WEATHERS, GAL_STAGE_SHOTS, GAL_STAGE_TRANSITIONS, GAL_STAGE_ACTS, galCommand, GAL_CLOSE_PARAS, galStartCamera, galStaging, useGalPresence, galGaze, galSpeakerAnchor, galFigurePriority, stageSkinFigures, galRecentSpeakers, galShotSubject, galShotSide, galMoodOf };
