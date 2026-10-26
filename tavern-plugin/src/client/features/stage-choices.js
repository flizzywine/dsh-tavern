// 回合末选项 (docs/design/cast-presentation.md 34/N; modules/stage-choices.js; tavern.css 「stage choices」): on the round's
// last card the stage offers what next - the latest reply's candidates as ribbons (a skin's art.choices draws them as its own
// bars), then 自由输入. It reuses the chat's candidate pipeline (`flow`: the candidate panel store, readyCandidatePanel and
// submitCandidateTask from play-controls.js), so the stage and the chat show one panel and one task. A click on a ribbon
// sends it; its ✎ (and 自由输入) turns the ribbon into a field in place: Enter sends, Esc reverts, a click away closes it and
// keeps the words. The waits (the choices generating, the next reply being written) take the text box's place.
// Entrance once per reply; a remount of the same reply's menu shows at once. The pick plays the skin's leave (or the art
// bars' squeeze) for --stage-choice-pick-ms before it is sent; 0 (ribbons, reduced motion) sends at once.
let tavernStageChoicesShown = "", tavernStageWait = { key: "", first: 0, start: 0 };
const TAVERN_STAGE_FREE = "\u0000free";
// The menu's two glyphs, in the row's ink: ✎ (edit, 自由输入) and the field's send arrow.
function tavernStageChoiceIcon(path) {
	return React.createElement("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" },
		React.createElement("path", { d: path }));
}
const TAVERN_STAGE_PENCIL = "M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10v4zM13.5 7.5l3 3", TAVERN_STAGE_SEND = "M12 19V5.5M6 11.5l6-6 6 6";

function TavernStageWaitLines(props) {
	const h = React.createElement, lines = props.lines, first = props.first, start = props.start;
	// The cycle offset is read once per mount, so re-renders never shift the running fades.
	const clock = React.useRef(null);
	if (clock.current === null) clock.current = (Date.now() - start) % (STAGE_WAIT_LINE_MS * STAGE_WAIT_SLOTS);
	const [, setTick] = React.useState(0);
	React.useEffect(() => { const timer = setInterval(() => setTick(tick => tick + 1), STAGE_WAIT_LINE_MS); return () => clearInterval(timer); }, []);
	const elapsed = Date.now() - start, dots = h("span", { className: "dsh-tavern-stage-wait-dots", "aria-hidden": true }, [0, 1, 2, 3, 4, 5].map(i => h("i", { key: i })));
	// Four stacked slots, then every line hidden in the same cell, so the slot is as wide as the widest line and never resizes.
	// Only the first slot is read out; without motion it is the one shown, steady.
	return h("span", { className: "dsh-tavern-stage-wait-lines" },
		[0, 1, 2, 3].map(i => h("span", { key: i, className: "dsh-tavern-stage-wait-line", "aria-hidden": i ? true : undefined,
			style: { animationDelay: (i * STAGE_WAIT_LINE_MS - clock.current) + "ms" } }, stageWaitLineAt(lines, first, i, elapsed), dots)),
		lines.map((line, i) => h("span", { key: "size:" + i, className: "dsh-tavern-stage-wait-sizer", "aria-hidden": true }, line, h("span", { className: "dsh-tavern-stage-wait-dots-space" }))));
}

// props: sessionId, flow, messageId, running, atEnd, submit(text) (the stage's send), lines (the skin's wait lines).
function TavernStageChoices(props) {
	const h = React.createElement, id = props.sessionId, messageId = props.messageId, flow = props.flow;
	const stored = React.useSyncExternalStore(flow.store.subscribe, flow.store.getSnapshot, flow.store.getSnapshot);
	const panel = stored && stored.sessionId === id && stored.messageId === messageId ? stored : null;
	const coordination = useTavernCoordination(id, "stage-choices:" + String(props.running) + ":" + String(messageId || ""));
	const own = coordination.view && coordination.view.task;
	const task = own && own.kind === "candidate" && own.input && String(own.input.messageId || "") === String(messageId || "") ? own : null;
	const state = stageChoiceState({ panel, task, atEnd: props.atEnd, running: props.running });
	const [editingAt, setEditingAt] = React.useState(null), [drafts, setDrafts] = React.useState({});
	const [sending, setSending] = React.useState(false), [picked, setPicked] = React.useState(null), [error, setError] = React.useState("");
	const rootRef = React.useRef(null), editorRef = React.useRef(null), refocusRef = React.useRef(null), requestRef = React.useRef(false);
	const key = String(id) + ":" + String(messageId || "");
	if (state === "generating" || props.running) tavernStageWait = stageWaitEpisode(tavernStageWait, key + ":" + (props.running ? "reply" : "choices"), props.lines.length);
	const settled = React.useRef(null);
	if (state !== "hidden" && settled.current === null) settled.current = tavernStageChoicesShown === key;
	React.useEffect(() => { if (state !== "hidden") tavernStageChoicesShown = key; }, [state !== "hidden", key]);
	// The task drives the shared panel, as the chat's candidate action does (the chat may not be mounted under the stage).
	React.useEffect(() => {
		if (!task) return;
		if (task.busy) flow.store.set({ sessionId: id, messageId, phase: "loading", choices: [], error: "" });
		else if (task.status === "succeeded" && task.result && task.result.candidates) flow.store.set(flow.ready(id, messageId, task.result.candidates));
		else if (task.status === "cancelled") flow.store.set(null);
		else if (task.terminal) flow.store.set({ sessionId: id, messageId, phase: "error", choices: [], error: String(task.error || "选项生成未完成") });
	}, [id, messageId, task && task.taskId, task && task.version, task && task.status]);
	// A click outside the open field closes it and keeps what was typed (capture phase, before the click acts).
	React.useEffect(() => {
		if (editingAt === null || sending) return undefined;
		const down = event => { if (!(editorRef.current && editorRef.current.contains(event.target))) closeField(false); };
		document.addEventListener("pointerdown", down, true);
		return () => document.removeEventListener("pointerdown", down, true);
	}, [editingAt, drafts, sending]);
	// The field opens with the caret after its words; Esc hands the keyboard back to the ribbon it reverted.
	React.useLayoutEffect(() => {
		const input = rootRef.current && rootRef.current.querySelector(".dsh-tavern-stage-choice-input");
		if (input && input === document.activeElement) input.setSelectionRange(input.value.length, input.value.length);
		const selector = refocusRef.current;
		if (editingAt === null && selector && rootRef.current) { refocusRef.current = null; rootRef.current.querySelector(selector)?.focus(); }
	}, [editingAt]);
	// A short stage: the list stands on its bottom line and scrolls above it.
	const items = state === "ready" && panel ? stageChoiceItems(panel.choices) : [];
	React.useLayoutEffect(() => { const el = rootRef.current; if (el && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight; }, [state, items.length]);
	function closeField(revert) {
		const at = editingAt;
		if (at === null) return;
		setDrafts(previous => {
			const next = { ...previous };
			if (revert || String(next[at] || "").trim() === (at === TAVERN_STAGE_FREE ? "" : at.trim())) delete next[at];
			return next;
		});
		setEditingAt(null);
	}
	async function send(text) {
		const value = String(text || "").trim();
		if (!value || sending) return;
		setSending(true); setError("");
		try {
			await props.submit(value);
			flow.store.set(null); setEditingAt(null); setDrafts({});
		} catch (err) { setError("发送失败：" + String(err && err.message || err)); }
		finally { setSending(false); setPicked(null); }
	}
	function pick(at, text) {
		if (sending || picked !== null) return;
		const ms = parseFloat(getComputedStyle(rootRef.current).getPropertyValue("--stage-choice-pick-ms")) || 0;
		if (!ms || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { send(text); return; }
		setPicked(at);
		setTimeout(() => send(text), ms);
	}
	async function generate() {
		if (!messageId || requestRef.current || state === "generating") return;
		requestRef.current = true;
		flow.store.set({ sessionId: id, messageId, phase: "loading", choices: [], error: "" });
		try { await flow.submit(id, messageId, ""); }
		catch (err) { tavernErrorHub.report("选项生成", err); flow.store.set({ sessionId: id, messageId, phase: "error", choices: [], error: String(err && err.message || err) }); }
		finally { requestRef.current = false; liveTavernView.invalidate(id); tavernCoordination.invalidate(id); }
	}
	const wait = state === "generating" || props.running && props.atEnd ? h("div", { key: "wait", className: "dsh-tavern-stage-wait", role: "status", "aria-live": "polite", "aria-label": props.running ? "正在生成下一轮" : "正在生成选项" },
		h(TavernStageWaitLines, { key: tavernStageWait.key, lines: props.lines, first: tavernStageWait.first, start: tavernStageWait.start })) : null;
	if (state === "hidden") return wait;
	const draftOf = at => drafts[at] != null ? drafts[at] : at === TAVERN_STAGE_FREE ? "" : at;
	const freeDraft = String(drafts[TAVERN_STAGE_FREE] || "").trim() ? drafts[TAVERN_STAGE_FREE] : "";
	// The field: the same row, so opening it moves nothing; one line is the ribbon's height, more grow the list upward.
	const field = (at, refocus) => {
		const text = draftOf(at);
		return [h("textarea", { key: "input", className: "dsh-tavern-stage-choice-input", "aria-label": at === TAVERN_STAGE_FREE ? "自由输入下一步" : "修改选项", autoFocus: true, rows: 1, value: text,
			placeholder: at === TAVERN_STAGE_FREE ? "你想怎么做？" : "改完按 Enter 发送", disabled: sending,
			onChange: event => { const value = event.target.value; setDrafts(previous => ({ ...previous, [at]: value })); },
			onKeyDown: event => {
				event.stopPropagation();
				if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(text); }
				else if (event.key === "Escape") { event.preventDefault(); refocusRef.current = refocus; closeField(true); }
			} }),
		h("button", { key: "send", type: "button", role: "menuitem", className: "dsh-tavern-stage-choice-send", title: "发送（Enter）", "aria-label": "发送", disabled: sending || !text.trim(),
			onClick: () => send(text) }, tavernStageChoiceIcon(TAVERN_STAGE_SEND))];
	};
	const edit = (at, label) => h("button", { type: "button", className: "dsh-tavern-stage-choice-edit", "aria-label": label, title: label, disabled: sending, onClick: () => setEditingAt(at) }, tavernStageChoiceIcon(TAVERN_STAGE_PENCIL));
	const status = state === "off" ? h("div", { key: "status", className: "dsh-tavern-stage-choice is-status" },
			h("button", { type: "button", role: "menuitem", "data-action": "generate", className: "dsh-tavern-stage-choice-main", disabled: !messageId || sending, onClick: generate }, "生成选项"))
		: state === "failed" ? h("div", { key: "status", className: "dsh-tavern-stage-choice is-error" }, h("span", null, "选项生成失败"),
			h("button", { type: "button", role: "menuitem", "data-action": "retry", className: "dsh-tavern-stage-choice-retry", disabled: !messageId || sending, onClick: generate,
				title: String(panel && panel.error || task && task.error || "选项生成未完成") }, "重试"))
		: null;
	// 自由输入 is the last ribbon (hidden while the choices generate; an open field stays).
	const free = state === "generating" && editingAt !== TAVERN_STAGE_FREE ? null
		: editingAt === TAVERN_STAGE_FREE ? h("div", { key: "free", ref: editorRef, className: "dsh-tavern-stage-choice is-free is-editing" }, field(TAVERN_STAGE_FREE, '[data-action="free"]'))
		: h("div", { key: "free", className: "dsh-tavern-stage-choice is-free", "data-edited": freeDraft ? "" : undefined },
			h("button", { type: "button", role: "menuitem", "data-action": "free", className: "dsh-tavern-stage-choice-main", disabled: sending, onClick: () => setEditingAt(TAVERN_STAGE_FREE) },
				tavernStageChoiceIcon(TAVERN_STAGE_PENCIL), h("span", { className: "dsh-tavern-stage-choice-text" }, freeDraft || "自由输入")));
	const rows = items.length + (status ? 1 : 0) + (free ? 1 : 0);
	const menu = h("div", { key: "menu", ref: rootRef, className: "dsh-tavern-stage-choices", role: "menu", "aria-label": "接下来", "data-state": state, "data-settled": settled.current ? "" : undefined,
		"data-picked": picked !== null ? "" : undefined, style: { "--rows": rows }, onClick: event => event.stopPropagation(), onWheel: event => event.stopPropagation() },
		items.map((item, index) => {
			const at = item.send, draft = drafts[at];
			if (editingAt === at) return h("div", { key: index, ref: editorRef, className: "dsh-tavern-stage-choice is-editing", "data-index": index }, field(at, '[data-index="' + index + '"] > .dsh-tavern-stage-choice-main'));
			// A suggestion edited and left reads as its draft and sends what it shows.
			return h("div", { key: index, className: "dsh-tavern-stage-choice" + (picked === at ? " is-picked" : ""), "data-index": index, "data-edited": draft != null ? "" : undefined },
				h("button", { type: "button", role: "menuitem", className: "dsh-tavern-stage-choice-main", disabled: sending, onClick: () => pick(at, draft != null ? draft : at) },
					h("span", { className: "dsh-tavern-stage-choice-text" }, draft != null ? draft : item.text)),
				edit(at, "改一改再发送"));
		}),
		status, free,
		error ? h("p", { key: "error", className: "dsh-tavern-stage-choice-error", role: "alert" }, error) : null);
	return h(React.Fragment, null, wait, menu);
}
