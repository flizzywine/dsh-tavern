// 履历 → video clips. The backlog selects a range of host
// paragraphs (turn / para as the host numbers them; the client never re-segments), the host plans, renders and encodes
// (estimateClipExport / startClipExport); the job runs in the background while the reader keeps playing.

// ---------- Range helpers (pure; tests/clip-export.test.mjs) ----------
// Host coordinates of a backlog row; rows that are not story paragraphs (turn separators, inputs, cards) have none.
function clipPos(entry) {
    if (!entry || entry.type !== "page") return null;
    const para = entry.para || entry.anchor?.para || entry.targetPara;
    return para ? { turn: entry.turn, para } : null;
}
function clipCmp(a, b) { return a.turn - b.turn || a.para - b.para; }
function clipSpan(a, b) { return clipCmp(a, b) <= 0 ? { from: a, to: b } : { from: b, to: a }; }
function clipHas(range, pos) { return Boolean(range && pos) && clipCmp(range.from, pos) <= 0 && clipCmp(pos, range.to) <= 0; }
// Per backlog row: inside the band, and whether it opens / closes it. Rows without coordinates are inside when the
// paragraphs on both sides are (a turn separator in the middle of the band, an unloaded turn's index row).
function clipBand(entries, range) {
    const out = entries.map(() => null);
    if (!range) return out;
    const pos = entries.map(clipPos);
    let before = false;
    const prevIn = pos.map(p => { const value = before; if (p) before = clipHas(range, p); return value; });
    let after = false;
    for (let i = entries.length - 1; i >= 0; i--) {
        const p = pos[i];
        const inside = p ? clipHas(range, p) : prevIn[i] && after;
        if (p) after = inside;
        if (inside) out[i] = { start: false, end: false };
    }
    for (let i = 0; i < out.length; i++) if (out[i]) { out[i].start = true; break; }
    for (let i = out.length - 1; i >= 0; i--) if (out[i]) { out[i].end = true; break; }
    return out;
}
// The host paragraphs the backlog shows: everything up to the reader's current page.
function clipVisible(paragraphs, limit) { return (paragraphs || []).filter(p => !limit || clipCmp(p, limit) <= 0); }
// Quick presets on the visible paragraphs: the anchor's whole turn, the last n, from the anchor to the end.
function clipPreset(kind, visible, anchor, n) {
    if (!visible.length) return null;
    const last = visible[visible.length - 1];
    if (kind === "turn") {
        const turn = (anchor || last).turn, rows = visible.filter(p => p.turn === turn);
        return rows.length ? { from: rows[0], to: rows[rows.length - 1] } : null;
    }
    if (kind === "recent") return { from: visible[Math.max(0, visible.length - n)], to: last };
    return anchor ? clipSpan(anchor, last) : null;
}
// 最近 N 段 grows on each press while it is the selection (10 → 20 → 50 → 100 → all).
const CLIP_RECENT = [10, 20, 50, 100];
function clipNextRecent(visible, range) {
    const count = range && visible.length && clipCmp(range.to, visible[visible.length - 1]) === 0 ? clipCount(visible, range) : 0;
    return CLIP_RECENT.find(n => n > count && n <= visible.length) || (count < visible.length ? visible.length : CLIP_RECENT[0]);
}
function clipCount(paragraphs, range) { return range ? (paragraphs || []).filter(p => clipHas(range, p)).length : 0; }
function clipStep(paragraphs, pos, delta) {
    const index = paragraphs.findIndex(p => clipCmp(p, pos) === 0);
    return index < 0 ? null : paragraphs[Math.max(0, Math.min(paragraphs.length - 1, index + delta))];
}
function clipDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
}
function clipResolution(files) {
    return [...new Set((files || []).map(file => file.resolution.height))].sort((a, b) => b - a).map(height => height + "p").join(" / ");
}
const CLIP_FORMATS = [
    { value: "quality", label: "最高画质", note: "原生画面，最高 1440p60，单文件" },
    { value: "1080p", label: "1080p", note: "1080p30，单文件，不限大小" },
    { value: "discord", label: "Discord", note: "自动压缩，必要时按段拆分，每份 ≤8 MB" },
    { value: "gif", label: "GIF", note: "无声动图，最多 15 秒，宽 720 像素" }
];
function clipSavedFormat() {
    try { const value = localStorage.getItem("dsh-tavern:clip-export-preset"); if (CLIP_FORMATS.some(row => row.value === value)) return value; } catch (_) {}
    return "1080p";
}
function clipBytes(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + " MiB"; }
const CLIP_PHASES = { prepare: "准备", render: "渲染", encode: "编码", verify: "校验" };
// progress = {phase, frame, totalFrames, file, totalFiles}; frame / file count from 0.
function clipProgress(progress) {
    const p = progress || {};
    const fraction = p.totalFrames ? Math.max(0, Math.min(1, p.frame / p.totalFrames)) : 0;
    return { phase: CLIP_PHASES[p.phase] || CLIP_PHASES.prepare, fraction,
        file: p.totalFiles > 1 ? Math.min(p.file + 1, p.totalFiles) + "/" + p.totalFiles : "" };
}

function clipFailure(error, fallback = "暂时无法连接，请稍后重新打开导出面板") {
    const message = String(error?.message || error || "");
    // The export host marks deliberate player messages; transport failures stay in diagnostics.
    return message.startsWith("无法导出：") ? message : fallback;
}

// ---------- Background jobs (one per session; polled every 750ms until a terminal state) ----------
const clipJobs = (function () {
    const jobs = new Map(), listeners = new Set();
    const terminal = state => state === "completed" || state === "cancelled" || state === "failed";
    function set(sessionId, job) { if (job) jobs.set(sessionId, job); else jobs.delete(sessionId); listeners.forEach(fn => fn()); }
    function patch(sessionId, jobId, value) { const job = jobs.get(sessionId); if (job && job.jobId === jobId) set(sessionId, Object.assign({}, job, value)); }
    function poll(sessionId, jobId) {
        setTimeout(function () {
            if (jobs.get(sessionId)?.jobId !== jobId || terminal(jobs.get(sessionId)?.state)) return;
            rpc("getClipExportJob", { jobId }, sessionId).then(function (next) {
                if (terminal(jobs.get(sessionId)?.state)) return;
                patch(sessionId, jobId, next);
                if (!terminal(next.state)) poll(sessionId, jobId);
                // A finished job is saved from the export listing (names and URLs), like the older exports.
                if (next.state === "completed") rpc("listClipExports", {}, sessionId).then(
                    value => patch(sessionId, jobId, { saves: value.exports.find(row => row.jobId === jobId)?.files || [] }),
                    error => patch(sessionId, jobId, { saves: [], notice: clipFailure(error, "暂时无法读取导出的文件，请稍后在履历的「已导出」里保存") }));
            }, error => { if (!terminal(jobs.get(sessionId)?.state)) patch(sessionId, jobId, { state: "failed", error: clipFailure(error, "暂时无法查看导出进度，请稍后重新打开导出面板") }); });
        }, 750);
    }
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: sessionId => jobs.get(sessionId) || null,
        terminal,
        async start(sessionId, range, preset) {
            set(sessionId, { jobId: null, state: "starting", progress: null });
            try {
                const { jobId } = await rpc("startClipExport", { range, preset }, sessionId);
                set(sessionId, { jobId, state: "queued", progress: null });
                poll(sessionId, jobId);
            } catch (error) { set(sessionId, { jobId: null, state: "failed", error: clipFailure(error) }); }
        },
        async cancel(sessionId) {
            const job = jobs.get(sessionId);
            if (!job?.jobId) return;
            patch(sessionId, job.jobId, { cancelling: true });
            try { await rpc("cancelClipExport", { jobId: job.jobId }, sessionId); patch(sessionId, job.jobId, { state: "cancelled", cancelling: false, notice: "" }); }
            catch (error) { patch(sessionId, job.jobId, { cancelling: false, notice: clipFailure(error, "暂时无法取消，请稍后再点一次取消") }); }
        },
        dismiss(sessionId) { set(sessionId, null); }
    };
})();
function useClipJob(sessionId) {
    const get = React.useCallback(() => clipJobs.get(sessionId), [sessionId]);
    return React.useSyncExternalStore(clipJobs.subscribe, get, get);
}

// ---------- Saving a finished export ----------
// The files stay in the app's export folder; saving copies them out. saves = [{name, bytes, type, url}] from the host
// (getClipExportJob / listClipExports), name being the host's suggested file name.
// PC (Desktop / desktop browsers): the native save-as dialog, or a native folder picker for several files, streamed to disk.
// Phone: the share sheet with the files (「存储视频」 / save to gallery). Otherwise an ordinary download.
function clipSaveMode() {
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    if (coarse && typeof navigator.share === "function" && navigator.canShare?.({ files: [new File([""], "clip.mp4", { type: "video/mp4" })] })) return "share";
    return typeof window.showSaveFilePicker === "function" ? "picker" : "download";
}
const CLIP_SAVE_LABEL = { share: "存到相册", picker: "保存到…", download: "下载" };
// Body → sink without holding the file in script memory; progress(bytes) as chunks pass.
async function clipFetch(save, progress) {
    const response = await fetch(save.url);
    if (!response.ok || !response.body) throw new Error("clip file " + response.status);
    let done = 0;
    return response.body.pipeThrough(new TransformStream({ transform(chunk, out) { done += chunk.byteLength; progress(done); out.enqueue(chunk); } }));
}
const clipSaves = (function () {
    const states = new Map(), listeners = new Set();
    const set = (key, value) => { states.set(key, value); listeners.forEach(fn => fn()); };
    const failed = "没能保存，请再试一次";
    // Progress over all files of the export, by bytes.
    function meter(key, saves) {
        const total = saves.reduce((sum, save) => sum + save.bytes, 0) || 1;
        let before = 0, last = 0;
        return {
            next(save) { before += last; last = 0; return bytes => { last = bytes; set(key, { state: "saving", fraction: Math.min(1, (before + bytes) / total) }); }; }
        };
    }
    async function toDisk(key, saves) {
        const types = save => [{ description: save.type === "image/gif" ? "GIF 动图" : "MP4 视频", accept: { [save.type]: [save.name.slice(save.name.lastIndexOf("."))] } }];
        // Both pickers need the click's activation, so they open before anything is fetched.
        const target = saves.length > 1
            ? await window.showDirectoryPicker({ id: "dsh-clip-export", mode: "readwrite" })
            : await window.showSaveFilePicker({ id: "dsh-clip-export", suggestedName: saves[0].name, types: types(saves[0]) });
        const progress = meter(key, saves);
        set(key, { state: "saving", fraction: 0 });
        for (const save of saves) {
            const handle = saves.length > 1 ? await target.getFileHandle(save.name, { create: true }) : target;
            const body = await clipFetch(save, progress.next(save));
            // pipeTo commits the file when the body ends and discards it on failure.
            await body.pipeTo(await handle.createWritable());
        }
        set(key, { state: "saved" });
    }
    // The share sheet takes File objects: each body goes straight into one Blob (the browser may keep it on disk) and
    // the File wraps that Blob without a copy. Sharing needs a fresh tap when the download outlived the first one.
    async function prepare(key, saves) {
        const progress = meter(key, saves), files = [];
        set(key, { state: "saving", fraction: 0 });
        for (const save of saves) {
            const blob = await new Response(await clipFetch(save, progress.next(save))).blob();
            files.push(new File([blob], save.name, { type: save.type }));
        }
        return files;
    }
    async function share(key, files) {
        try { await navigator.share({ files }); set(key, { state: "saved" }); }
        catch (error) { set(key, { state: "ready", files, notice: error?.name === "AbortError" || error?.name === "NotAllowedError" ? "" : failed }); }
    }
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: key => states.get(key) || null,
        async save(key, saves, mode) {
            const current = states.get(key);
            if (current?.state === "saving") return;
            if (current?.state === "ready") return share(key, current.files);
            try {
                if (mode === "share") return share(key, await prepare(key, saves));
                if (mode === "picker") return await toDisk(key, saves);
                for (const save of saves) {
                    const link = document.createElement("a");
                    link.href = save.url; link.download = save.name; link.rel = "noopener";
                    document.body.appendChild(link); link.click(); link.remove();
                }
                set(key, { state: "saved" });
            } catch (error) {
                // Closing the dialog is not a failure.
                set(key, error?.name === "AbortError" ? null : { state: "failed", notice: failed });
            }
        },
        forget(key) { if (states.delete(key)) listeners.forEach(fn => fn()); }
    };
})();
function useClipSave(key) {
    const get = React.useCallback(() => clipSaves.get(key), [key]);
    return React.useSyncExternalStore(clipSaves.subscribe, get, get);
}
// One export's save action: the button, its progress, then 「已保存」.
function ClipSave(props) {
    const h = React.createElement;
    const { saves, saveKey, wide } = props;
    const state = useClipSave(saveKey);
    const mode = React.useMemo(clipSaveMode, []);
    if (state?.state === "saving") return h("span", { className: "fork-clip-saving", role: "status", "aria-live": "polite" },
        h(ClipRing, { fraction: state.fraction }), h("span", null, mode === "share" ? "正在准备" : "正在保存"), h("b", null, Math.round(state.fraction * 100) + "%"));
    if (state?.state === "saved") return h("span", { className: "fork-clip-done", role: "status" }, h(Icon, { name: "check", size: 16 }), h("b", null, mode === "download" ? "已开始下载" : "已保存"));
    const text = CLIP_SAVE_LABEL[mode];
    return [
        state?.notice ? h("span", { key: "notice", className: "fork-clip-error", role: "alert" }, "⚠ ", h("span", null, state.notice)) : null,
        h(ClipIconButton, { key: "save", icon: "download", title: text, text: wide || mode === "share" ? text : "", primary: props.primary !== false,
            disabled: !saves?.length, onClick: () => { void clipSaves.save(saveKey, saves, mode); } })];
}
// Finished exports of this chat, newest first (the export mode's 「已导出」 list); reloaded when a job finishes.
function useClipExports(sessionId, on, job) {
    const [list, setList] = React.useState({ state: "idle", exports: [] });
    const done = job?.state === "completed" ? job.jobId : "";
    React.useEffect(function () {
        if (!on || !sessionId) return;
        let live = true;
        setList(old => old.state === "ready" ? old : { state: "loading", exports: [] });
        rpc("listClipExports", {}, sessionId).then(
            value => { if (live) setList({ state: "ready", exports: value.exports || [] }); },
            error => { if (live) setList({ state: "failed", exports: [], error: clipFailure(error) }); });
        return () => { live = false; };
    }, [on, sessionId, done]);
    return list;
}
function clipExportName(row) {
    const name = row.files[0].name;
    return name.slice(0, name.lastIndexOf("."));
}
// The list of finished exports, above the bar; each row saves all of its files.
function ClipShelf(props) {
    const h = React.createElement;
    const { list } = props;
    return h("div", { className: "fork-clip-shelf", role: "region", "aria-label": "已导出" },
        list.state === "failed" ? h("span", { className: "fork-clip-error", role: "alert" }, "⚠ ", h("span", null, list.error))
        : list.state !== "ready" ? h("div", { className: "fork-clip-loading is-compact", role: "status" }, h(Spinner), h("span", null, "正在读取…"))
        : !list.exports.length ? h(EmptyState, { compact: true, text: "还没有导出的片段" })
        : h("ul", { className: "fork-clip-shelf-list" }, list.exports.map(row => h("li", { key: row.jobId, className: "fork-clip-shelf-row" },
            h("span", { className: "fork-clip-shelf-name", title: clipExportName(row) }, clipExportName(row)),
            h("span", { className: "fork-clip-shelf-size" }, (row.files.length > 1 ? row.files.length + " 个文件 · " : "") + clipBytes(row.files.reduce((sum, file) => sum + file.bytes, 0))),
            h(ClipSave, { saves: row.files, saveKey: row.jobId, wide: true, primary: false })))));
}

// ---------- Selection (the backlog's export mode) ----------
// limit: the backlog's last row {turn, para}; the band never reaches beyond what the reader has seen.
function useClipSelection(sessionId, chatId, limit) {
    const [on, setOn] = React.useState(false);
    const [format, setFormat] = React.useState(clipSavedFormat);
    const [anchor, setAnchor] = React.useState(null);
    const [range, setRange] = React.useState(null);
    const [list, setList] = React.useState({ state: "idle", paragraphs: [] });
    const [estimate, setEstimate] = React.useState({ state: "idle" });
    const limitKey = limit ? limit.turn + ":" + limit.para : "";
    React.useEffect(function () {
        if (!on || !chatId) return;
        let live = true;
        setList(old => old.state === "ready" ? old : { state: "loading", paragraphs: [] });
        rpc("getClipExportParagraphs", { chatId }, sessionId).then(
            value => { if (live) setList({ state: "ready", paragraphs: value.paragraphs || [] }); },
            error => { if (live) setList({ state: "failed", paragraphs: [], error: clipFailure(error) }); });
        return () => { live = false; };
    }, [on, sessionId, chatId]);
    const visible = React.useMemo(() => clipVisible(list.paragraphs, limit), [list.paragraphs, limitKey]);
    // A plan for the current band, a moment after it stops changing; only the latest request is shown.
    const rangeKey = range ? JSON.stringify(range) : "";
    React.useEffect(function () {
        if (!on || !range || !chatId) { setEstimate({ state: "idle" }); return; }
        let live = true;
        setEstimate({ state: "loading" });
        const timer = setTimeout(function () {
            rpc("estimateClipExport", { range: { chatId, from: range.from, to: range.to }, preset: format }, sessionId).then(
                value => { if (live) setEstimate({ state: "ready", value }); },
                error => { if (live) setEstimate({ state: "failed", error: clipFailure(error) }); });
        }, 280);
        return () => { live = false; clearTimeout(timer); };
    }, [on, rangeKey, sessionId, chatId, format]);
    // The band holds bare coordinates (host paragraph rows also carry their summary text).
    const at = p => ({ turn: p.turn, para: p.para });
    function select(next, nextAnchor) { setOn(true); setRange({ from: at(next.from), to: at(next.to) }); if (nextAnchor !== undefined) setAnchor(at(nextAnchor)); }
    function close() { setOn(false); setRange(null); setAnchor(null); }
    // Esc leaves the mode before it can close the sheet (the stage's Esc skips a handled key), wherever the focus is.
    React.useEffect(function () {
        if (!on) return;
        function key(event) { if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) { if (overlayEscape(event)) return; event.preventDefault(); close(); } }
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    }, [on]);
    return {
        on, range, anchor, list, visible, estimate, chatId, format,
        setFormat(value) {
            setFormat(value); setEstimate({ state: "loading" });
            try { localStorage.setItem("dsh-tavern:clip-export-preset", value); } catch (_) {}
        },
        count: clipCount(visible, range),
        // Enter export mode on the current turn (the 履历 head's clip button).
        open(turn) {
            setOn(true);
            const rows = visible.filter(p => p.turn === turn);
            if (rows.length) select({ from: rows[0], to: rows[rows.length - 1] }, rows[0]);
            else if (limit) select({ from: { turn, para: 1 }, to: limit }, { turn, para: 1 });
        },
        close,
        // A row: a new start (click, long-press) or the band stretched from the start to here (Shift-click, tap).
        pick(pos, extend) {
            if (extend && anchor) select(clipSpan(anchor, pos));
            else select({ from: pos, to: pos }, pos);
        },
        // A dragged handle: the other edge stays where it was.
        edge(fixed, pos) { select(clipSpan(fixed, pos), fixed); },
        preset(kind) {
            const n = kind === "recent" ? clipNextRecent(visible, range) : 0;
            const next = clipPreset(kind, visible, anchor || range?.from, n);
            if (next) select(next, next.from);
        },
        step(edge, delta) {
            if (!range) return;
            const moved = clipStep(visible, range[edge], delta);
            if (moved) select(clipSpan(edge === "from" ? range.to : range.from, moved), edge === "from" ? range.to : range.from);
        },
        recentNext: clipNextRecent(visible, range)
    };
}

// The backlog's export mode in one hook (gal-backlog.js): the selection, the session's job, the band per row.
function useClipBacklog(sessionId, chatId, limit, entries) {
    const clip = useClipSelection(sessionId, chatId, limit);
    const job = useClipJob(sessionId);
    const band = React.useMemo(() => clipBand(entries, clip.range), [entries, clip.range]);
    return Object.assign(clip, { job, band, posOf: clipPos, handle: clipHandle, Bar: ClipBar });
}

// The band edges' drag grips (rendered by the backlog on the start / end rows). Dragging moves that edge to the row
// under the pointer and scrolls the list near its top / bottom; ↑↓ on a focused grip moves it by one paragraph.
function clipHandle(h, clip, edge, listRef) {
    function down(event) {
        if (event.button !== 0 && event.pointerType === "mouse") return;
        event.preventDefault(); event.stopPropagation();
        const fixed = edge === "from" ? clip.range.to : clip.range.from, box = listRef.current;
        let y = event.clientY, frame = 0;
        function hit() {
            const rect = box.getBoundingClientRect();
            const node = document.elementFromPoint(rect.left + rect.width / 2, Math.max(rect.top + 2, Math.min(rect.bottom - 2, y)));
            const row = node && node.closest ? node.closest("[data-clip-para]") : null;
            if (row) clip.edge(fixed, { turn: Number(row.getAttribute("data-fork-stage-turn")), para: Number(row.getAttribute("data-clip-para")) });
        }
        function tick() {
            const rect = box.getBoundingClientRect(), zone = 56;
            const dy = y < rect.top + zone ? -(rect.top + zone - y) / 3 : y > rect.bottom - zone ? (y - rect.bottom + zone) / 3 : 0;
            if (dy) { box.scrollTop += dy; hit(); }
            frame = requestAnimationFrame(tick);
        }
        function move(next) { y = next.clientY; hit(); }
        function up() { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); }
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
        frame = requestAnimationFrame(tick);
    }
    return h("span", { key: "clip-" + edge, className: "fork-clip-handle is-" + edge, role: "slider", tabIndex: 0,
        "aria-label": edge === "from" ? "起点" : "终点", title: edge === "from" ? "拖动起点" : "拖动终点",
        "aria-valuetext": "第 " + clip.range[edge].turn + " 轮 第 " + clip.range[edge].para + " 段",
        onPointerDown: down, onClick: event => event.stopPropagation(),
        onKeyDown: event => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault(); event.stopPropagation();
            clip.step(edge, event.key === "ArrowUp" ? -1 : 1);
            // The grip now sits on another row: keep the keyboard on it.
            const list = listRef.current;
            requestAnimationFrame(() => list && list.querySelector(".fork-clip-handle.is-" + edge)?.focus({ preventScroll: false }));
        } }, h("i", { "aria-hidden": true }));
}

// ---------- The floating bar ----------
function ClipIconButton(props) {
    const h = React.createElement;
    return h("button", { type: "button", className: "fork-clip-btn" + (props.primary ? " is-primary" : "") + (props.className ? " " + props.className : ""),
        title: props.title, "aria-label": props.label || props.title, disabled: Boolean(props.disabled),
        onClick: event => { event.stopPropagation(); props.onClick(); } },
        h(Icon, { name: props.icon, size: 16 }), props.text ? h("span", null, props.text) : null);
}
function ClipRing(props) {
    const h = React.createElement;
    return h("svg", { className: "fork-clip-ring", viewBox: "0 0 20 20", width: 18, height: 18, "aria-hidden": true },
        h("circle", { cx: 10, cy: 10, r: 8, className: "fork-clip-ring-track" }),
        h("circle", { cx: 10, cy: 10, r: 8, className: "fork-clip-ring-fill", pathLength: 100, strokeDasharray: (props.fraction * 100).toFixed(1) + " 100" }));
}
// The job, wherever it shows (backlog bar or the stage chip): progress + cancel, done + save, failed + dismiss.
function ClipJobLine(props) {
    const h = React.createElement;
    const { job, sessionId } = props;
    if (job.state === "completed") {
        const result = job.result || {}, files = result.files || [];
        const missing = result.preset === "gif" ? 0 : result.missingVoiceCount || 0, warnings = result.warnings || [];
        return [
            h("span", { key: "done", className: "fork-clip-done", role: "status" }, h(Icon, { name: "check", size: 16 }), h("b", null, "已导出 " + files.length + " 个文件")),
            missing || warnings.length ? h("span", { key: "warn", className: "fork-clip-warn" }, "⚠ " + [missing ? missing + " 句没有配音" : "", ...warnings].filter(Boolean).join("；")) : null,
            job.notice ? h("span", { key: "notice", className: "fork-clip-error", role: "alert" }, "⚠ ", h("span", null, job.notice)) : null,
            h(ClipSave, { key: "save", saves: job.saves, saveKey: job.jobId, wide: true }),
            h(ClipIconButton, { key: "x", icon: "close", title: "关闭", onClick: () => clipJobs.dismiss(sessionId) })];
    }
    if (job.state === "failed") return [
        h("span", { key: "error", className: "fork-clip-error", role: "alert", title: job.error }, "⚠ ", h("span", null, job.error || "导出未完成，请重新选择片段后再试")),
        h(ClipIconButton, { key: "x", icon: "close", title: "关闭", onClick: () => clipJobs.dismiss(sessionId) })];
    if (job.state === "cancelled") return [
        h("span", { key: "cancelled", className: "fork-clip-phase", role: "status" }, "已取消导出"),
        h(ClipIconButton, { key: "x", icon: "close", title: "关闭", onClick: () => clipJobs.dismiss(sessionId) })];
    const progress = clipProgress(job.progress);
    const waiting = job.state === "starting" || job.state === "queued";
    return [
        waiting ? h(Spinner, { key: "spin" }) : h(ClipRing, { key: "ring", fraction: progress.fraction }),
        h("span", { key: "phase", className: "fork-clip-phase", role: "status", "aria-live": "polite" },
            job.cancelling ? "正在取消…" : waiting ? "排队" : progress.phase, waiting || job.cancelling ? null : h("b", null, Math.round(progress.fraction * 100) + "%"),
            progress.file ? h("small", null, progress.file) : null),
        job.notice ? h("span", { key: "notice", className: "fork-clip-error", role: "alert" }, "⚠ ", h("span", null, job.notice)) : null,
        h(ClipIconButton, { key: "cancel", icon: "close", title: "取消导出", disabled: !job.jobId || job.cancelling, onClick: () => clipJobs.cancel(sessionId) })];
}
// Inside the backlog: presets, the band's estimate and 导出 while selecting; otherwise the running / finished job.
function ClipBar(props) {
    const h = React.createElement;
    const { clip, sessionId } = props;
    const job = useClipJob(sessionId);
    const [shelf, setShelf] = React.useState(false), shelfRef = React.useRef(null), shelfButton = React.useRef(null);
    const exports = useClipExports(sessionId, clip.on, job);
    useOverlay(clip.on && shelf, () => [shelfRef.current, shelfButton.current], reason => { setShelf(false); if (reason === "escape") shelfButton.current?.focus(); });
    if (!clip.on) return job ? h("div", { className: "fork-clip-bar is-job", onClick: event => event.stopPropagation() }, h(ClipJobLine, { job, sessionId, wide: true })) : null;
    const estimate = clip.estimate, value = estimate.value, files = value?.plannedFiles || [];
    const presetsReady = clip.list.state === "ready" && clip.visible.length > 0;
    const busy = Boolean(job && !clipJobs.terminal(job.state));
    const summary = clip.list.state === "failed" ? h("span", { className: "fork-clip-error", role: "alert", title: clip.list.error }, "⚠ ", h("span", null, clip.list.error))
        : estimate.state === "failed" ? h("span", { className: "fork-clip-error", role: "alert", title: estimate.error }, "⚠ ", h("span", null, estimate.error))
        : estimate.state === "ready" ? h("span", { className: "fork-clip-estimate", role: "status" },
            clip.count ? h("span", { title: "段落" }, h(Icon, { name: "backlog", size: 14 }), clip.count) : null,
            h("span", { title: "时长" }, h(Icon, { name: "clock", size: 14 }), clipDuration(value.durationMs)),

            h("span", { className: "fork-clip-size", title: "预计总大小" }, "约 " + clipBytes(files.reduce((sum, file) => sum + file.estBytes, 0))),
            h("span", { className: "fork-clip-res", title: "分辨率与文件数" }, clipResolution(files) + " · " + files.length + " 个文件"),
            clip.format === "discord" ? h("span", { className: "fork-clip-step" }, ({1:"原码率",2:"适配码率",3:"适配 720p",4:"按段拆分"})[value.step]) : null,
            value.missingVoiceCount && clip.format !== "gif" ? h("span", { className: "fork-clip-warn" }, "⚠ " + value.missingVoiceCount + " 句没有配音") : null)
        : clip.list.state === "ready" && !clip.visible.length ? h(EmptyState, { compact: true, text: "还没有可导出的段落" })
        : estimate.state === "loading" || clip.list.state === "loading" ? h("div", { className: "fork-clip-loading", role: "status", "aria-live": "polite" },
            h(Spinner), h("span", null, clip.list.state === "loading" ? "正在读取段落…" : "正在估算时长和大小…"))
        : h("span", { className: "fork-clip-estimate", role: "status" }, "选择要导出的段落");
    function chip(kind, icon, text, title) {
        return h("button", { key: kind, type: "button", className: "fork-clip-chip", title, "aria-label": title, disabled: !presetsReady,
            onClick: event => { event.stopPropagation(); clip.preset(kind); } }, h(Icon, { name: icon, size: 14 }), h("span", null, text));
    }
    return h("div", { className: "fork-clip-bar", role: "toolbar", "aria-label": "导出片段", onClick: event => event.stopPropagation() },
        shelf ? h("div", { ref: shelfRef, className: "fork-clip-shelf-wrap" }, h(ClipShelf, { list: exports })) : null,
        h("div", { className: "fork-clip-presets" },
            chip("turn", "turn", "本轮", "这一轮"),
            chip("recent", "recent", "近 " + clip.recentNext, "最近 " + clip.recentNext + " 段"),
            chip("end", "to-end", "到结尾", "从这里到结尾")),
        h("div", { className: "fork-clip-format" },
            h(InlineField, { kind: "menu", label: "导出预设", hideLabel: true, value: clip.format, options: CLIP_FORMATS, disabled: busy, onCommit: clip.setFormat }),
            clip.format === "gif" ? h("span", { className: "fork-clip-limit" }, "≤15 秒 · 无声") : null),
        h("div", { className: "fork-clip-summary", "aria-busy": estimate.state === "loading" || clip.list.state === "loading" }, summary),
        h("div", { className: "fork-clip-actions" },
            exports.state === "ready" && !exports.exports.length ? null : h("button", { ref: shelfButton, type: "button", className: "fork-clip-btn fork-clip-shelf-toggle" + (shelf ? " is-on" : ""),
                "aria-expanded": shelf, title: "已导出的片段", onClick: event => { event.stopPropagation(); setShelf(!shelf); } },
                h(Icon, { name: "folder", size: 16 }), h("span", null, "已导出")),
            h(ClipIconButton, { icon: "clip", text: "导出", primary: true, title: busy ? "正在导出" : "导出视频", label: "导出视频",
                disabled: busy || estimate.state !== "ready" || !files.length,
                onClick: () => { void clipJobs.start(sessionId, { chatId: clip.chatId, from: clip.range.from, to: clip.range.to }, clip.format); clip.close(); } }),
            h(ClipIconButton, { icon: "close", title: "退出选择（Esc）", label: "退出选择", onClick: clip.close })));
}
// Measure the rendered skin docks/entries, including responsive and scaled stages; use the shared overlay solver.
function useClipPlacement(ref, visible) {
    React.useLayoutEffect(() => {
        const node = ref.current, root = node?.closest('.fork-gal-stage');
        if (!visible || !root) return;
        const selector = '.fork-stage-skin-button, .fork-stage-entry:not(.is-overflow), .fork-gal-topbar > *, .fork-gal-topbar button, .fork-gal-controls, .fork-gal-box:not(.is-hidden), .fork-gal-notices';
        const observed = new Set();
        const measure = () => {
            const frame = root.getBoundingClientRect();
            if (!frame.width || !frame.height) return;
            const kx = root.offsetWidth / frame.width, ky = root.offsetHeight / frame.height;
            const blocked = [];
            for (const item of root.querySelectorAll(selector)) {
                if (!observed.has(item)) { observed.add(item); resize.observe(item); }
                if (!item.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
                const box = item.getBoundingClientRect();
                blocked.push({ x: (box.left - frame.left) * kx, y: (box.top - frame.top) * ky, width: box.width * kx, height: box.height * ky });
            }
            for (const item of observed) if (!root.contains(item)) { resize.unobserve(item); observed.delete(item); }
            const placed = stageWidgetSourcePlace({ width: root.offsetWidth, height: root.offsetHeight,
                size: { width: node.offsetWidth, height: node.offsetHeight }, blocked, anchor: 'top-center' });
            // If a tiny viewport has no safe space, keep the job in the backlog rather than cover a control.
            node.toggleAttribute('data-placed', Boolean(placed));
            if (placed) for (const [name, value] of [['left', placed.x], ['top', placed.y]]) {
                const next = value + 'px';
                if (node.style.getPropertyValue('--clip-' + name) !== next) node.style.setProperty('--clip-' + name, next);
            }
        };
        const resize = new ResizeObserver(measure);
        resize.observe(root); resize.observe(node);
        const mutations = new MutationObserver(records => {
            if (records.some(record => record.target !== node && !node.contains(record.target))) measure();
        });
        mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        measure();
        return () => { resize.disconnect(); mutations.disconnect(); };
    }, [visible, ref]);
}
// On the stage while the backlog is closed: a small chip with the job, out of the way of the reading.
function ClipStatus(props) {
    const h = React.createElement, ref = React.useRef(null);
    const job = useClipJob(props.sessionId);
    useClipPlacement(ref, Boolean(job) && !props.hidden);
    if (!job || props.hidden) return null;
    return h("div", { ref, className: "fork-clip-chipbar", "data-state": job.state, onClick: event => event.stopPropagation(), onPointerDown: event => event.stopPropagation() },
        h(ClipJobLine, { job, sessionId: props.sessionId, wide: false }));
}
