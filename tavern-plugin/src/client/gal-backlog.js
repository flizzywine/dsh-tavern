// the stage's backlog (履历).
// An overlay above the scene listing what the reader has already seen: every rendered earlier turn
// (read-only) and the current turn up to and including the current page. Rows of the current turn
// jump the stage back to their page. It reads the session-owned canonical text index and
// the Chat snapshot's user messages; it never writes story, variables or prompts.
// The kind registry (stage-performance-kinds.cjs) is included once, by core-item-presentation.cjs.

const BACKLOG_LIST = {layout:'list', close:'head', roles:{speech:{look:'row'}, player:{look:'row'}, narration:{look:'row'}, notice:{look:'row'}, divider:{look:'rule'}}, style:{}};

// ---------- Backlog view ----------
// Without the export module (isolated fixtures) the backlog has no export mode.
const GAL_NO_CLIP = { on: false, range: null, job: null, band: [], posOf: () => null };
function useGalPlayerInputs(sessionId, useChat) {
    const nodes = useChat ? useChat(snapshot => snapshot && snapshot.legacy && snapshot.legacy.nodes || null) : null;
    const live = useLiveTavernView(sessionId, "gal-backlog");
    const view = live && live.view;
    return React.useMemo(function () {
        const sources = view && view.inputSources;
        return stageViews.backlogRows.galPlayerInputs(nodes, dsh => tavernStoryTurnForDshTurn(view, dsh),
            dsh => sources && Object.prototype.hasOwnProperty.call(sources, String(dsh)) && sources[dsh] != null ? String(sources[dsh]) : null);
    }, [nodes, view]);
}
// props: { sessionId, config, textIndex, voiceOf(descriptor, anchor), turn, pages, page, useChat, colorOf(alias), avatarOf(alias, mood),
// nameOf(alias), quote (classic theme: spoken lines read 「…」), looks (stageSkinBacklog: layout, close, per-role looks, plate tokens),
// sideOf(alias) ('left' | 'right' where the stage's figure layout stands the speaker, else null), onJump(page), onClose() }.
// Mounted only while open.
function GalBacklog(props) {
    const h = React.createElement;
    const scroller = React.useRef(null);
    const openedAt = React.useRef(Date.now());
    const movedAt = React.useRef(0);
    const [, redraw] = React.useState(0);
    React.useEffect(() => voicePlayer.subscribe(() => redraw(n => n + 1)), []);
    const inputs = useGalPlayerInputs(props.sessionId, props.useChat);
    const modHistory = stageViews.backlogHistory.useHistory(props.sessionId);
    // Isolated text-only fixtures load the backlog without the kind registry (and so without performance rows).
    const registry = React.useMemo(() => typeof createStagePerformanceRegistry === 'function' ? stageViews.backlogRows.backlogPerformanceRegistry(modHistory?.kinds) : null, [modHistory?.kinds]);
    // each round's open checks, one line each (dice-roll.js); isolated fixtures run without it.
    const rolls = typeof useDiceBacklog === 'function' ? useDiceBacklog(props.useChat) : null;
    const [markDirections,setMarkDirections]=React.useState(()=>new Map());
    const lineKinds = React.useMemo(() => stageViews.backlogRows.backlogLineKinds(registry), [registry]);
    const looks = props.looks || BACKLOG_LIST;
    const lookOf = entry => looks.roles[stageViews.backlogRows.backlogRole(entry)]?.look || 'row';
    // A bubble's plate per side and outer-line colour (tint by speaker: the speaker's image colour, colorOf), drawn once each.
    const plates = React.useRef({looks:null, map:new Map()});
    if (plates.current.looks !== looks) plates.current = {looks, map:new Map()};
    function bubbleStyle(role, side, color) {
        const look = looks.roles[role];
        if (!look?.paint || !looks.bubble) return undefined;
        const ink = look.tint ? color || look.tint.fallback : look.paint.line, key = role + side + ink;
        if (!plates.current.map.has(key)) plates.current.map.set(key, {...stageSkinBacklogPlateStyle(stageSkinBacklogPlate(look, looks.bubble, side, ink)),
            ...(look.tint ? {"--bl-name": ink} : null)});
        return plates.current.map.get(key);
    }
    const entries = React.useMemo(() => {
        const directions=new Map(markDirections);directions.set(props.turn,props.direction);
        const text = stageViews.backlogRows.stageHistoryEntries(props.textIndex, props.turn, props.pages || [], props.page, inputs);
        const rows = stageViews.backlogRows.backlogLineKindEntries(registry ? stageViews.backlogRows.stageModHistoryEntries(text,modHistory?.turns,registry,directions) : text,directions,lineKinds);
        const roll = registry?.get('core.dice.roll');
        const all = rolls && roll ? diceBacklogEntries(rows, rolls, turn => props.textIndex?.get(turn)?.nativeTurn,
            (value, turn) => stageViews.backlogRows.backlogPerformanceEntry(roll, value, {turn, id:{roll:value.callId}})) : rows;
        // A role the skin draws as none leaves no row (the overlay's round separators).
        return looks.roles.divider?.look === 'none' ? all.filter(entry => entry.type !== 'turn') : all;
    }, [props.textIndex, props.turn, props.pages, props.page, props.direction, inputs,modHistory,registry,lineKinds,markDirections,rolls,looks]);
    // export mode — a band of host paragraphs up to the current page.
    const chatId = useLiveTavernView(props.sessionId, "gal-backlog")?.view?.chatId || "";
    const currentPage = (props.pages || [])[Math.min(props.page, (props.pages || []).length - 1)];
    // clip-export.js owns the mode (isolated backlog fixtures run without it).
    const clip = typeof useClipBacklog === "function" ? useClipBacklog(props.sessionId, chatId, props.turn ? { turn: props.turn, para: currentPage?.para || 1 } : null, entries) : GAL_NO_CLIP;
    const band = clip.band;
    // The last pointer on a row: a touch tap stretches the band, a long press starts it (and is not also a click).
    const press = React.useRef({ type: "", timer: 0, x: 0, y: 0, fired: false });
    const bandRef = React.useRef(null);
    const heights = React.useRef(new Map());
    const nodes = React.useRef(new Map());
    const pendingFocus = React.useRef(null);
    const pendingScroll = React.useRef(null);
    const anchorRow = React.useRef(null);
    const [viewport, setViewport] = React.useState({ top: Infinity, height: 800 });
    // 回到最新 at the sheet's bottom edge once the reader scrolls up (jump-latest.js).
    const [listBox, setListBox] = React.useState(null);
    const latest = useJumpLatest(listBox);
    const listRef = React.useCallback(node => { scroller.current = node; setListBox(node); }, []);
    const offsets = [0];
    entries.forEach(entry => offsets.push(offsets[offsets.length - 1] + (heights.current.get(entry.key) || (entry.type === "turn" ? 54 : 100))));
    const range = stageViews.backlogRows.galBacklogWindow(offsets, viewport.top, viewport.height, 20);
    // names in an image colour too dark/light for this panel get the nearest readable lightness.
    useFigureTextContrast(React, scroller, true, range.start, range.end, entries.length, props.page);
    const visibleTurns=JSON.stringify([...new Set(entries.slice(range.start,range.end).map(row=>row.turn))].filter(turn=>turn!==props.turn));
    const firstTurn = entries.length ? entries[0].turn : null;
    const atTop = viewport.top !== Infinity && range.start === 0;
    const {older,loadOlder}=stageViews.backlogPaging.usePaging({sessionId:props.sessionId,textIndex:props.textIndex,visibleTurns,firstTurn,atTop});
    React.useEffect(()=>{
        if(!props.readDirection)return;
        let active=true;
        for(const turn of JSON.parse(visibleTurns)) {
            if(markDirections.has(turn))continue;
            // Read once per visible earlier turn: its mods' line marks (the line kinds' badges) and its director titles (报幕 rows),
            // projected as the stage projects them (stage-director-source.cjs) so a title keeps its ledger ordinals.
            Promise.resolve(props.readDirection({turn,readOnly:true})).then(async value=>{
                const projected=value.token && typeof projectStageDirection==='function' ? await projectStageDirection(value,{sessionId:props.sessionId,turn}) : null;
                if(!active)return;
                const entries=(projected || value).entries || [];
                const direction={phase:value.phase,through:value.through,entries:entries.filter(entry=>entry.ops?.some(op=>op.op==='mod.command') || entry.events?.some(event=>event.kind==='title'))};
                setMarkDirections(old=>new Map(old).set(turn,direction));
            }).catch(()=>{});
        }
        return()=>{active=false;};
    },[props.sessionId,visibleTurns]);
    // a skin's drawn scroll indicator (art.backlog.scrollbar) reads the list's position;
    // it is decoration (the list scrolls by wheel, touch and keys as before) and stays hidden without the skin's art.
    const barRef = React.useRef(null);
    function readViewport() {
        const box = scroller.current;
        if (!box) return;
        const top = box.scrollTop, height = box.clientHeight;
        const bar = barRef.current, room = box.scrollHeight - height;
        if (bar) { bar.style.setProperty("--bl-thumb", String(Math.min(1, height / Math.max(1, box.scrollHeight)))); bar.style.setProperty("--bl-pos", String(room > 0 ? top / room : 1)); }
        // Layout corrections, scroll events and ResizeObserver can report the same viewport.
        setViewport(previous => previous.top === top && previous.height === height ? previous : { top, height });
    }
    // rows inserted above the first visible row (an earlier turn's text arriving) keep that row
    // where the reader sees it, instead of pushing the page down (anchorRow).
    React.useLayoutEffect(function () {
        const box = scroller.current, previous = anchorRow.current;
        if (!box) return;
        if (previous && previous.entries !== entries && viewport.top !== Infinity && pendingScroll.current == null) {
            const index = entries.findIndex(entry => entry.key === previous.key);
            const shift = index >= 0 ? offsets[index] - previous.offset : 0;
            if (Math.abs(shift) > 0.5) { box.scrollTop += shift; readViewport(); }
        }
        const first = stageViews.backlogRows.galBacklogWindow(offsets, box.scrollTop, box.clientHeight, 0).start;
        anchorRow.current = { entries, key: entries[first]?.key, offset: offsets[first] || 0 };
    });
    React.useLayoutEffect(function () {
        const box = scroller.current;
        if (!box) return;
        if (pendingScroll.current != null) {
            const target = pendingScroll.current;
            pendingScroll.current = null;
            box.scrollTop = target === Infinity ? box.scrollHeight : target;
            readViewport();
        }
        const atEnd = viewport.top === Infinity || box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
        const anchor = stageViews.backlogRows.galBacklogWindow(offsets, viewport.top, viewport.height, 0).start;
        let changed = false, shift = 0;
        for (let i = range.start; i < range.end; i++) {
            const node = nodes.current.get(i), next = nodes.current.get(i + 1);
            if (!node) continue;
            const style = getComputedStyle(node);
            // Layout units (a docked stage is only scaled, createModStageDock): the last row's box over its scaled width.
            const last = next ? null : node.getBoundingClientRect(), k = last && last.width > 0 && Math.abs(last.width - node.offsetWidth) >= 1 ? node.offsetWidth / last.width : 1;
            const height = next ? next.offsetTop - node.offsetTop : last.height * k + parseFloat(style.marginBottom);
            const previous = heights.current.get(entries[i].key) || (entries[i].type === "turn" ? 54 : 100);
            // offsetTop rounds each edge separately: a spacer shift can change their difference
            // by one pixel without resizing the row. Do not feed that jitter back into anchoring.
            if (height > 0 && Math.abs(height - previous) > 1) {
                heights.current.set(entries[i].key, height); changed = true;
                if (i < anchor) shift += height - previous;
            }
        }
        if (changed) {
            // Apply the anchor correction after React replaces the two spacer heights.
            pendingScroll.current = atEnd ? Infinity : box.scrollTop + shift;
            redraw(n => n + 1);
        } else if (pendingFocus.current != null) {
            const node = nodes.current.get(pendingFocus.current.index);
            if (node) {
                const focus = pendingFocus.current, buttons = node.querySelectorAll('button:not([disabled])');
                const target = focus.last ? buttons[buttons.length - 1] || node : focus.controlOnly ? buttons[0] || node : node;
                target.focus({ preventScroll: true }); pendingFocus.current = null;
            }
        }
    });
    // the band is one plate behind its rows, from the start row's top to the end row's bottom
    // (rows outside the rendered window use their measured / estimated offsets), so the turn gaps inside it stay filled.
    React.useLayoutEffect(function () {
        const plate = bandRef.current;
        if (!plate) return;
        const first = band.findIndex(Boolean), last = band.findLastIndex(Boolean);
        if (first < 0) { plate.hidden = true; return; }
        const pad = parseFloat(getComputedStyle(plate.parentNode).paddingTop) || 0;
        const start = nodes.current.get(first), end = nodes.current.get(last);
        const top = start ? start.offsetTop : pad + offsets[first];
        const bottom = end ? end.offsetTop + end.offsetHeight : pad + offsets[last + 1];
        plate.hidden = false;
        plate.style.top = top + "px";
        plate.style.height = Math.max(0, bottom - top) + "px";
    });
    React.useEffect(function () {
        const box = scroller.current;
        if (!box || typeof ResizeObserver !== "function") return;
        let width = box.clientWidth, frame = 0;
        const observer = new ResizeObserver(function () {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(function () {
                if (width !== box.clientWidth) { width = box.clientWidth; heights.current.clear(); }
                readViewport();
            });
        });
        observer.observe(box);
        nodes.current.forEach(node => observer.observe(node));
        return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    }, [range.start, range.end]);
    function onListKey(event) {
        if (event.key !== "Tab") return;
        const box = scroller.current, active = document.activeElement;
        const items = Array.from(box.querySelectorAll('[tabindex="0"], button:not([disabled])'));
        if (active !== (event.shiftKey ? items[0] : items[items.length - 1])) return;
        const step = event.shiftKey ? -1 : 1;
        let index = event.shiftKey ? range.start - 1 : range.end;
        while (index >= 0 && index < entries.length && !(entries[index].type === "page")) index += step;
        if (index < 0 || index >= entries.length) return;
        event.preventDefault(); event.stopPropagation();
        pendingFocus.current = { index, last: event.shiftKey, controlOnly: false };
        box.scrollTop = offsets[index];
        readViewport();
    }
    // Opens with the current page (the last row) at the bottom, keyboard scrolling ready.
    React.useLayoutEffect(function () {
        const box = scroller.current;
        if (!box) return;
        // The current page is the last row; pin to the end (the measuring pass keeps the end pinned).
        box.scrollTop = box.scrollHeight;
        box.focus({ preventScroll: true });
        readViewport();
    }, []);
    // Wheel down past the end closes (galgame convention); a gesture still scrolling does not.
    function onWheel(event) {
        event.stopPropagation();
        const box = scroller.current;
        // positive LINE/PAGE and small trackpad deltas count at the end too.
        if (!box || !Number.isFinite(event.deltaY) || event.deltaY <= 0) return;
        const now = Date.now();
        const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
        if (atEnd && now - movedAt.current > 220 && now - openedAt.current > 300) props.onClose();
    }
    const player = voicePlayer.get();
    // in export mode a row click picks instead of jumping — a mouse click is a new start,
    // Shift-click / a touch tap stretches the band to it; outside it Shift-click (or a long press) starts the mode.
    function pick(pos, event) {
        if (press.current.fired) { press.current.fired = false; return true; }
        if (!pos || !clip.on && !event.shiftKey) return false;
        const touch = press.current.type === "touch" || press.current.type === "pen";
        clip.pick(pos, clip.on && (event.shiftKey || touch));
        return true;
    }
    function pressDown(pos, event) {
        clearTimeout(press.current.timer);
        press.current = { type: event.pointerType, timer: 0, x: event.clientX, y: event.clientY, fired: false };
        if (!pos || event.pointerType === "mouse") return;
        press.current.timer = setTimeout(() => { press.current.fired = true; clip.pick(pos, false); }, 450);
    }
    function pressMove(event) {
        if (press.current.timer && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) { clearTimeout(press.current.timer); press.current.timer = 0; }
    }
    function pressEnd() { clearTimeout(press.current.timer); press.current.timer = 0; }
    function bandClass(index) {
        const mark = band[index];
        return mark ? " is-clip" + (mark.start ? " is-clip-start" : "") + (mark.end ? " is-clip-end" : "") : "";
    }
    function row(entry, index) {
        const ref = node => { if (node) nodes.current.set(index, node); else nodes.current.delete(index); };
        if (entry.type === "turn") return h("div", { key: entry.key, ref, style: index === 0 ? { marginTop: 4 } : undefined, className: "fork-gal-backlog-turn" + (entry.current ? " is-current" : "") + bandClass(index), role: "separator" },
            h("span", null, "第 " + entry.turn + " 轮" + (entry.current ? " · 本轮" : "")));
        // The player's own words; as a bubble they stand on the player's side, the right (no figure layout places the player).
        if (entry.type === "input") return lookOf(entry) === "bubble"
            ? h("div", { key: entry.key, ref, className: "fork-gal-backlog-input is-look-bubble" + bandClass(index), "data-bl-role": "player", "data-bl-side": "right" },
                h("div", { className: "fork-gal-backlog-bubble", style: bubbleStyle("player", "right", "") },
                    h("div", { className: "fork-gal-backlog-name" }, h("b", { "data-figure-ink": "4.5" }, "你")), h("p", { className: "fork-gal-backlog-text" }, entry.text)))
            : h("div", { key: entry.key, ref, className: "fork-gal-backlog-input" + bandClass(index), "data-bl-role": "player" },
                h("span", { className: "fork-gal-backlog-you" }, "你"), h("p", null, entry.text));
        // one muted line per performance at its place in the
        // round (文字演出 card, item, 报幕; a check 「魔力检定 · 20 · 成功」 ahead of the round's text). The 履历 is text only: it plays
        // nothing; jumping to that page on the stage plays its performances.
        // A plaque or band (overlay looks) holds the same tag and words, centred on its own plate.
        if (entry.type === "performance") {
            const look = lookOf(entry), wrap = looks.roles[entry.role]?.wrap;
            const lead = entry.roll ? h(Icon, { key: "lead", name: "die", size: 16 }) : h("span", { key: "lead", className: "fork-gal-backlog-card-tag" }, entry.tag);
            const words = entry.roll ? diceLine(h, entry.roll) : entry.parts ? entry.parts.flatMap((part, i) => i ? [h("span", { key: i, className: "fork-gal-backlog-card-sep", "aria-hidden": true }, " / "), part] : [part]) : entry.text;
            return h("div", { key: entry.key, ref, className: "fork-gal-backlog-card fork-gal-backlog-perf is-look-" + look + (entry.roll ? " fork-gal-backlog-roll" : "") + bandClass(index),
                "data-tier": entry.roll ? entry.roll.tier : undefined, "data-perf-kind": entry.kind, "data-bl-role": entry.role },
                ...(look === "row" ? [lead, h("p", { key: "p" }, words)] : [h("p", { key: "p", style: looks.roles[entry.role]?.plate }, lead, wrap ? [wrap[0], h(React.Fragment, { key: "w" }, words), wrap[1]] : words)]));
        }
        const line = entry.kind === "line", role = line ? "speech" : "narration", look = lookOf(entry);
        // use the stage/voice resolver before indexing canonical figure media.
        const speaker = line ? (bubbleCharacter(props.config, entry)?.alias || entry.alias) : "";
        // A bubble's tail points where the stage's figure layout stands its speaker; a speaker not on stage stands left.
        const side = look === "bubble" ? props.sideOf?.(speaker) || "left" : undefined;
        const color = line ? props.colorOf(speaker) : "";
        const avatar = line ? props.avatarOf(speaker, entry.mood) : "";
        const name = line ? entry.name || props.nameOf(speaker) || entry.alias : "";
        const jump = true;
        // A narration page's handle is the narrator's (null while it is silent on this card).
        const handle = line ? entry.voice || (entry.descriptor ? props.voiceOf?.(entry.descriptor) : null)
            : entry.voice?.narration ? entry.voice : stageViews.backlogVoice.narration((entry.descriptors || []).map(descriptor => props.voiceOf?.(descriptor)).filter(Boolean));
        // A skin whose original log has no replay control (art.voice.backlog false, stageSkinBacklog) shows none; R still replays.
        const voice = looks.voice !== false ? stageViews.backlogVoice.voice(handle, player) : null;
        const pos = clip.posOf(entry), mark = band[index];
        // A mod-declared line kind's badge (「手机」), drawn as the skin's backlog.badge says (look, place, paint; stageSkinBacklog):
        // the kind's icon (its label the accessible name) or its label. It only marks where the line was read (
        // 「只是图标变为"手机"，点击以后效果仍然是播放，而不是跳转到手机」): the row reads and plays as any line.
        const badgePlace = line && entry.lineKind && looks.badge?.show !== false ? looks.badge?.place || "name" : null;
        const kind = entry.lineKind;
        const badge = badgePlace ? h("span", { className: "fork-gal-backlog-badge is-badge-" + (looks.badge?.look || "pill") + (kind.icon ? " has-icon" + (looks.badge?.icon === "bold" ? " is-icon-bold" : "") : ""), "data-line-kind": kind.kind, style: looks.badge?.style,
                ...(kind.icon ? { role: "img", "aria-label": kind.label, title: kind.label } : null) },
            kind.icon ? h("svg", { viewBox: "0 0 24 24", "aria-hidden": true, focusable: "false" }, h("path", { d: kind.icon, fill: "currentColor", fillRule: "evenodd" })) : kind.label) : null;
        const classes = "fork-gal-backlog-row is-look-" + look + (line ? " is-line" : " is-narration") + (entry.thought ? " is-thought" : "") + (jump ? " is-jump" : " is-past") + (entry.here ? " is-here" : "") + bandClass(index) + (clip.on ? " is-picking" : "");
        const go = event => { if (!pick(pos, event)) props.onJump(entry.page, entry.turn, entry.targetPara); };
        // The voice control follows the speaker's name in every look;
        // narration has no name: its narrator voice (旁白配音) stands alone in the name's place.
        const nameRow = !line ? (voice ? h("div", { className: "fork-gal-backlog-name is-narrator" }, h(VoiceButton, { voice })) : null) : h("div", { className: "fork-gal-backlog-name" }, h("b", { "data-figure-ink": "4.5", "data-text": name },
                    props.nameParts ? props.nameParts(name, entry).map((text, index) => text ? h("i", { key: index, "data-np": ["lead", "rest", "given-lead", "given-rest"][index] }, text) : null) : name), voice ? h(VoiceButton, { voice }) : null, entry.thought ? h("span", { className: "fork-gal-backlog-tag" }, "心声") : null, badgePlace === "name" ? badge : null);
        const wrap = looks.roles[role]?.wrap;
        const text = h("p", { className: "fork-gal-backlog-text" }, badgePlace === "text" ? badge : null, look === "band" && wrap ? [wrap[0], entry.text, wrap[1]] : props.quote && line && look === "row" ? galQuoted(entry.text, entry.pending) : entry.text, entry.pending ? h("span", { className: "fork-gal-typing", "aria-label": "正在生成" }, h("i"), h("i"), h("i")) : null);
        const face = h("div", { className: "fork-gal-backlog-face" },
            line && avatar && look === "row" ? h(PackImage, { identity:avatar.identity, src: avatar.src, crop: avatar.crop, avatar:avatar.avatar, alt: "" }) : null);
        return h("div", { key: entry.key, ref, className: classes, style: color ? { "--row-color": color } : undefined, "data-bl-role": role, "data-bl-side": side,
            role: jump ? "button" : undefined, tabIndex: jump ? 0 : undefined, title: clip.on ? undefined : jump ? (entry.here ? "当前这一页（点击回到舞台）" : "回到这一页") : undefined,
            "aria-current": entry.here ? "true" : undefined, "aria-selected": clip.on ? Boolean(mark) : undefined, "data-fork-stage-turn": entry.turn, "data-fork-stage-para": entry.para, "data-clip-para": pos?.para, "data-line-kind": entry.lineKind?.kind,
            onClick: jump ? go : undefined,
            onPointerDown: event => pressDown(pos, event), onPointerMove: pressMove, onPointerUp: pressEnd, onPointerCancel: pressEnd,
            onKeyDown: jump ? event => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); press.current.type = "key"; go(event); } } : undefined },
            mark && mark.start ? clip.handle(h, clip, "from", scroller) : null,
            mark && mark.end ? clip.handle(h, clip, "to", scroller) : null,
            // bubble: the plate with its tail, the name and its voice at the head on the tail's side; band: the words
            // centred on the plate.
            look === "bubble" ? h("div", { className: "fork-gal-backlog-bubble", style: bubbleStyle(role, side, color) }, nameRow, face, text)
            : look === "band" ? h("div", { className: "fork-gal-backlog-band", style: looks.roles[role].plate }, text)
            // art.nameplate.initials: the name in the box plate's parts (galNameParts via props.nameParts).
            : [h(React.Fragment, { key: "face" }, face), h("div", { key: "body", className: "fork-gal-backlog-body" }, nameRow, text)]);
    }
    return h("div", { "data-leaving": props.leaving || undefined, inert: props.leaving || undefined, className: "fork-gal-backlog" + (props.quote ? " is-quoted" : "") + (clip.on ? " is-clipping" : "") + (clip.on || clip.job ? " has-clip-bar" : ""), role: "dialog", "aria-modal": "true", "aria-label": "履历",
        "data-bl-layout": looks.layout, "data-bl-anchor": looks.anchor || undefined, "data-bl-close": looks.close, "data-bl-metrics": looks.metrics || undefined, style: looks.style,
        onClick: event => event.stopPropagation(),
        // A touch long press is the export start, not a close; in export mode right click (and Esc, clip-export.js) leave the mode first.
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); if (press.current.type === "touch" || press.current.type === "pen") return; if (clip.on) clip.close(); else props.onClose(); },
        // In export mode the wheel only scrolls (a drag to the end must not close the sheet).
        onWheel: clip.on ? event => event.stopPropagation() : onWheel },
        // How to use it lives in a ? tip next to the title, not in a permanent hint line.
        h("div", { className: "fork-gal-backlog-head" },
            // The overlay layout has no title row: the name stays the dialog's label, the ? tip goes with the row.
            looks.layout === "overlay" ? null : h("div", { className: "fork-gal-backlog-title" }, h("i", { className: "fork-gal-backlog-gem", "aria-hidden": true }), h("b", null, "履历"), h("small", null, "BACKLOG"),
                h(HelpTip, { label: "履历操作说明" }, h("span", null, "点击本轮的句子回到那一页"), h("span", null, "滚轮向下到底、右键或 Esc 关闭"))),
            // Close: part of the sheet's title row, at the column's right end in the title's ink — the only
            // visible close; Esc / right click / wheel past the end close too.
            // the export mode's entry, beside the close.
            // The overlay draws only the original's ×: there the export mode starts from a row (Shift-click,
            // long press), as in every layout.
            clip.Bar && looks.layout !== "overlay" ? h("button", { type: "button", className: "fork-gal-backlog-clip" + (clip.on ? " is-on" : ""), title: "导出片段", "aria-label": "导出片段", "aria-pressed": clip.on,
                onClick: () => clip.on ? clip.close() : clip.open(props.turn) }, h(Icon, { name: "clip", size: 18 })) : null,
            h("button", { type: "button", className: "fork-gal-backlog-close", title: "关闭履历", "aria-label": "关闭履历", onClick: props.onClose },
                h("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", "aria-hidden": true, focusable: "false" }, h("path", { d: "M7 7l10 10M17 7L7 17" }))),
            // Paging state of the earlier turns, over the top edge of the list (it never shifts the rows).
            older === "loading" ? h("div", { className: "fork-gal-backlog-older" }, h(Spinner, { label: "正在读取更早的轮次" })) : null,
            older === "failed" ? h("div", { className: "fork-gal-backlog-older" },
                h("span", null, "⚠ 更早的轮次没有读取到"),
                h("button", { type: "button", className: "fork-gal-backlog-older-retry", onClick: event => { event.stopPropagation(); loadOlder(); } }, "重试")) : null),
        // The measuring pass owns anchoring; native anchoring can undo it as spacer margins change.
        h("div", { className: "fork-gal-backlog-list", ref: listRef, style: { overflowAnchor: "none" }, tabIndex: 0, "aria-label": "已读内容",
            onKeyDown: onListKey, onScroll: () => { movedAt.current = Date.now(); readViewport(); } },
            h("div", { className: "fork-gal-backlog-col" },
                h("div", { ref: bandRef, className: "fork-clip-band", "aria-hidden": true, hidden: true }),
                h("div", { "aria-hidden": true, style: { height: offsets[range.start] } }),
                entries.length ? entries.slice(range.start, range.end).map((entry, index) => row(entry, range.start + index)) : h("p", { className: "fork-gal-backlog-empty" }, "还没有可以回看的内容"),
                h("div", { "aria-hidden": true, style: { height: offsets[entries.length] - offsets[range.end] } }))),
        h("i", { ref: barRef, className: "fork-gal-backlog-bar", "aria-hidden": true }, h("b")),
        h("div", { className: "fork-gal-backlog-latest" },
            h(JumpLatest, { skin: "stage", away: latest.away, onJump: latest.jump, focusAfter: () => scroller.current && scroller.current.focus({ preventScroll: true }) })),
        clip.Bar ? h(clip.Bar, { clip, sessionId: props.sessionId }) : null);
}
