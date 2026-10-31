function backgroundWaitMessage(progress, now) {
    if (!progress || now - progress.startedAt < 60000) return "";
    const plugin = progress.plugin ? "插件「" + progress.plugin + "」正在结算。" : "";
    return plugin + backgroundPhaseMessage(progress, now);
}
function backgroundPhaseMessage(progress, now) {
    if (progress.phase === "model") {
        return now - progress.lastProgressAt < 15000
            ? "模型仍在输出思考、正文或工具参数，后台任务尚未完成。可以继续等待或停止后台；已生成的正文会保留。"
            : "正在等待模型 API 的有效输出。连续 5 分钟没有有效输出会停止并报错；也可以现在停止后台，保留已生成的正文。";
    }
    return progress.phase === "tool"
        ? "正在执行后台工具或等待人物卡变量处理。若长时间没有完成，可以停止后台；已生成的正文会保留。"
        : "正在准备后台请求。若长时间没有完成，可以停止后台；已生成的正文会保留。";
}
function TavernBackgroundWait(props) {
    const [progress, setProgress] = React.useState(null);
    const [now, setNow] = React.useState(Date.now);
    const active = props.activity?.busy || props.activity?.phase === "pending";
    React.useEffect(function () {
        let disposed = false, loading = false;
        setProgress(null);
        if (!active) return;
        async function refresh() {
            setNow(Date.now());
            if (loading) return;
            loading = true;
            try {
                const result = await rpc("getBackgroundProgress", {}, props.sessionId);
                if (!disposed) setProgress(result.progress);
            } catch (_) { /* Existing task status and stop controls remain usable. */ }
            finally { loading = false; }
        }
        void refresh();
        const timer = window.setInterval(refresh, 5000);
        return function () { disposed = true; window.clearInterval(timer); };
    }, [active, props.sessionId, props.activity?.operationId]);
    const message = backgroundWaitMessage(progress || {phase:"preparing",startedAt:props.activity?.updatedAt || now}, now);
    if (!active || !message) return null;
    return React.createElement("div", {className:"dsh-tavern-status-section", role:"status"},
        React.createElement("p", null, message),
        React.createElement(TavernStopBackgroundAction, {sessionId:props.sessionId}));
}
const BACKGROUND_RUN_STATUS = { queued: "排队中", running: "运行中", completed: "完成", discarded: "已作废", failed: "失败", cancelled: "已取消", skipped: "跳过（功能没开）" };
function backgroundRunName(run) {
    return run.task === "plugin" ? "插件「" + (run.plugin || "未知") + "」" : run.name || run.task;
}
function backgroundRunSeconds(run, now) {
    const from = run.startedAt || run.queuedAt, to = run.endedAt || now;
    return Math.max(0, Math.round((to - from) / 1000)) + " 秒";
}
function backgroundRunsSummary(runs) {
    const count = status => runs.filter(run => run.status === status).length;
    return [["running", "运行"], ["queued", "排队"], ["failed", "失败"]].filter(([status]) => count(status)).map(([status, label]) => label + " " + count(status)).join(" · ");
}
// Every background run of this game since the server started, polled while shown.
function useTavernBackgroundRuns(sessionId) {
    const [runs, setRuns] = React.useState(null);
    const [now, setNow] = React.useState(Date.now);
    const [turns, setTurns] = React.useState([]);
    const [moments, setMoments] = React.useState([]);
    const [catalog, setCatalog] = React.useState([]);
    const [locks, setLocks] = React.useState([]);
    const [members, setMembers] = React.useState([]);
    React.useEffect(function () {
        let disposed = false, loading = false;
        setRuns(null);
        async function refresh() {
            setNow(Date.now());
            if (loading) return;
            loading = true;
            try {
                const result = await rpc("getBackgroundRuns", {}, sessionId);
                if (disposed) return;
                setRuns(Array.isArray(result.runs) ? result.runs : []);
                setTurns(Array.isArray(result.turns) ? result.turns : []);
                setMoments(Array.isArray(result.moments) ? result.moments : []);
                setCatalog(Array.isArray(result.catalog) ? result.catalog : []);
                setLocks(Array.isArray(result.locks) ? result.locks : []);
                setMembers(Array.isArray(result.members) ? result.members : []);
            } catch (_) { /* Diagnostic only; the next poll retries. */ }
            finally { loading = false; }
        }
        void refresh();
        const timer = window.setInterval(refresh, 2000);
        return function () { disposed = true; window.clearInterval(timer); };
    }, [sessionId]);
    return { runs, now, turns, moments, catalog, locks, members };
}
// A plugin's member is shown with its plugin: 插件「npc」·露娜.
function backgroundMemberLabel(member) {
    return member ? (member.plugin ? "插件「" + member.plugin + "」·" : "") + member.name : "";
}
// One turn's timeline: one row per member (书记, 润色师, plugin members; fresh Agents share
// a row, overlapping runs stacked), time left to right across the panel's width, the
// turn's moments as vertical lines. A member runs one task at a time, so its row is its lock;
// a task turned away by the lock is a ✕ on the row.
function TavernTurnTimeline(props) {
    const h = React.createElement, turn = props.turn, now = props.now;
    const flat = list => list.flatMap(node => [node, ...flat(node.then)]);
    const blocks = flat(turn.moments.flatMap(moment => moment.tasks).concat(turn.others))
        .flatMap(node => node.agents.map(run => ({ ...run, name: node.name, key: node.key + ":" + run.id })));
    const from = turn.at, to = Math.max(from + 1000, ...blocks.map(run => run.endedAt || now), ...turn.moments.map(moment => moment.at), props.until || 0);
    const pct = time => Math.max(0, Math.min(100, (time - from) / (to - from) * 100)) + "%";
    const width = (a, b) => Math.max(0.8, (b - a) / (to - from) * 100) + "%";
    const memberIds = (props.members || []).map(member => member.id);
    const rows = (props.members || []).map(member => ({ key: member.id, label: backgroundMemberLabel(member), runs: blocks.filter(run => run.member === member.id) }));
    // Fresh Agents: each takes the first sub-row free at its start.
    const fresh = [];
    for (const run of blocks.filter(run => !memberIds.includes(run.member)).sort((a, b) => a.queuedAt - b.queuedAt)) {
        const row = fresh.find(item => item.end <= run.queuedAt) || (fresh.push({ end: 0, runs: [] }), fresh[fresh.length - 1]);
        row.runs.push(run); row.end = run.endedAt || now;
    }
    fresh.forEach((row, index) => rows.push({ key: "fresh:" + index, label: index ? "" : "临时 Agent", runs: row.runs }));
    if (!fresh.length) rows.push({ key: "fresh", label: "临时 Agent", runs: [] });
    const refused = (props.locks || []).filter(item => item.kind === "refused" && item.at >= from && item.at <= to);
    const seconds = Math.round((to - from) / 1000);
    const bar = run => {
        const start = run.startedAt || now, end = run.endedAt || now;
        const title = run.name + " · " + (BACKGROUND_RUN_STATUS[run.status] || run.status) + (run.model ? " · " + run.model : "") +
            "\n" + backgroundClock(run.queuedAt) + " 起，排队 " + Math.round((start - run.queuedAt) / 1000) + " 秒，运行 " + Math.round((end - start) / 1000) + " 秒" + (run.error ? "\n" + run.error : "");
        return [
            start - run.queuedAt >= 500 ? h("div", { key: run.key + ":wait", className: "dsh-tavern-tl-wait", style: { left: pct(run.queuedAt), width: width(run.queuedAt, start) }, title }) : null,
            run.startedAt ? h("div", { key: run.key, className: "dsh-tavern-tl-bar " + run.status, style: { left: pct(start), width: width(start, end) }, title }, run.name) : null];
    };
    const marks = turn.moments.filter(moment => moment.event !== "turn-started");
    return h("div", { className: "dsh-tavern-tl" },
        h("div", { className: "dsh-tavern-tl-row dsh-tavern-tl-head" },
            h("div", { className: "dsh-tavern-tl-label" }, backgroundClock(from)),
            h("div", { className: "dsh-tavern-tl-track" }, marks.map((moment, index) =>
                h("span", { key: index, className: "dsh-tavern-tl-mark-label" + (index % 2 ? " low" : ""), style: { left: pct(moment.at) }, title: moment.name + " " + backgroundClock(moment.at) }, moment.name)),
                h("span", { className: "dsh-tavern-tl-end" }, "+" + seconds + " 秒"))),
        rows.map(row => h("div", { key: row.key, className: "dsh-tavern-tl-row" },
            h("div", { className: "dsh-tavern-tl-label", title: row.label }, row.label),
            h("div", { className: "dsh-tavern-tl-track" },
                marks.map((moment, index) => h("i", { key: "m" + index, className: "dsh-tavern-tl-line", style: { left: pct(moment.at) } })),
                row.runs.flatMap(bar),
                refused.filter(item => (item.slot || "background") === row.key).map((item, index) => h("i", { key: "x" + index, className: "dsh-tavern-tl-refused", style: { left: pct(item.at) },
                    title: "被锁挡回：" + item.role + "（" + item.holder + " 正在跑）" }, "✕"))))),
        h("p", { className: "dsh-tavern-settings-desc" }, "一行一个成员，同一成员一次只跑一个任务；竖线是剧情时刻，斜纹是排队，✕ 是被锁挡回。鼠标停在块上看详情。"));
}
const BACKGROUND_STATUS_MARK = { queued: "…", running: "●", completed: "✓", discarded: "⊘", failed: "✕", cancelled: "⊘", skipped: "–" };
function backgroundClock(time) {
    return new Date(time).toTimeString().slice(0, 8);
}
function backgroundSpan(from, to, now) {
    const seconds = Math.max(0, Math.round(((to || now) - from) / 1000));
    return seconds < 1 ? "" : seconds + " 秒";
}
// One task of a turn: what it is, how it went, the Agent runs it made; click for what it does.
// Under it, the tasks that ran because it finished (任务完成, needs).
function TavernBackgroundTaskNode(props) {
    const h = React.createElement, node = props.node, now = props.now;
    const [open, setOpen] = React.useState(false);
    const memberName = id => backgroundMemberLabel((props.members || []).find(member => member.id === id));
    const info = (props.catalog || []).find(item => item.task === node.task);
    const agent = node.agents[0];
    const facts = node.status === "skipped" ? ["跳过：" + (node.condition ? "只在" + node.condition + "运行" : "功能没开")] : [backgroundSpan((agent && (agent.startedAt || agent.queuedAt)) || node.at, (agent && agent.endedAt) || node.endedAt, now),
        node.agents.map(run => memberName(run.member) || (run.lane === "resident" ? "常驻 Agent" : "临时 Agent")).join("、"),
        agent && agent.model, agent && agent.startedAt && agent.startedAt - agent.queuedAt >= 1000 ? "排队 " + Math.round((agent.startedAt - agent.queuedAt) / 1000) + " 秒" : ""].filter(Boolean);
    return h("li", { className: "dsh-tavern-run-node " + node.status },
        h("button", { type: "button", className: "dsh-tavern-run-node-head", onClick: () => setOpen(!open), "aria-expanded": open,
            title: BACKGROUND_RUN_STATUS[node.status] || node.status },
            h("span", { className: "dsh-tavern-run-mark" }, BACKGROUND_STATUS_MARK[node.status] || "·"),
            h("span", { className: "dsh-tavern-run-name" }, node.name),
            h("span", { className: "dsh-tavern-run-facts" }, facts.join(" · "))),
        node.error ? h("div", { className: "dsh-tavern-run-error" }, node.error) : null,
        node.status === "discarded" ? h("div", { className: "dsh-tavern-run-note" }, "跑完时剧情已变化（回退、重写或编辑），结果没有保存。") : null,
        open ? h("div", { className: "dsh-tavern-run-detail" },
            info ? [["做什么", info.does], ["何时启动", info.trigger], ["读", info.reads], ["写", info.writes], ["等待", info.waits]].filter(([, text]) => text)
                .map(([label, text]) => h("div", { key: label }, h("b", null, label + "："), text)) : h("div", null, "这一项没有登记在任务目录里（它不调用后台 Agent）。"),
            node.agents.map(run => h("div", { key: run.id }, h("b", null, "Agent 运行："),
                (BACKGROUND_RUN_STATUS[run.status] || run.status) + " · " + backgroundClock(run.queuedAt) + (run.error ? " · " + run.error : "")))) : null,
        node.then.length ? h("ul", { className: "dsh-tavern-run-then" }, node.then.map(child => h(TavernBackgroundTaskNode, { ...props, key: child.key, node: child }))) : null);
}
// One turn, like one run of a GitHub Actions workflow: its story moments in order, each with
// the tasks it started.
function TavernBackgroundTurn(props) {
    const h = React.createElement, turn = props.turn;
    const count = list => list.reduce((sum, node) => sum + 1 + count(node.then), 0);
    const flat = list => list.flatMap(node => [node, ...flat(node.then)]);
    const nodes = flat(turn.moments.flatMap(moment => moment.tasks).concat(turn.others));
    const busy = nodes.filter(node => node.status === "running" || node.status === "queued").length;
    const failed = nodes.filter(node => node.status === "failed").length;
    const skipped = nodes.filter(node => node.status === "skipped").length;
    const summary = [count(nodes.filter(node => !nodes.some(other => other.then.includes(node)))) - skipped + " 项任务", skipped ? skipped + " 项跳过" : "", busy ? busy + " 项进行中" : "", failed ? failed + " 项失败" : ""].filter(Boolean).join(" · ");
    const list = tasks => h("ul", { className: "dsh-tavern-run-tasks" }, tasks.map(node => h(TavernBackgroundTaskNode, { key: node.key, node, now: props.now, catalog: props.catalog, members: props.members })));
    const [timeline, setTimeline] = React.useState(false);
    return h("details", { className: "dsh-tavern-run-turn", open: props.open },
        h("summary", null, h("b", null, turn.turn ? "第 " + turn.turn + " 轮" : "更早"), " · " + backgroundClock(turn.at) + " · " + summary),
        h("button", { type: "button", className: "dsh-tavern-run-tl-toggle", onClick: () => setTimeline(!timeline), "aria-expanded": timeline }, timeline ? "收起时序 ▴" : "时序 ▾"),
        timeline ? h(TavernTurnTimeline, { turn, now: props.now, members: props.members, locks: props.locks }) : null,
        h("ol", { className: "dsh-tavern-run-moments" },
            turn.moments.map((moment, index) => h("li", { key: moment.event + index },
                h("div", { className: "dsh-tavern-run-moment" }, h("span", null, moment.name), h("time", null, backgroundClock(moment.at))),
                moment.tasks.length ? list(moment.tasks) : null)),
            turn.others.length ? h("li", null,
                h("div", { className: "dsh-tavern-run-moment" }, h("span", null, "手动或插件启动")),
                list(turn.others)) : null));
}
// One task's definition, like a GitHub Actions job: member, what starts it (on, if), its
// other starts, needs, what needs it, what the next turn and cancelling make of it, what it does.
function TavernBackgroundTaskSpec(props) {
    const h = React.createElement, item = props.item, spec = item.spec || {};
    const member = backgroundMemberLabel((props.members || []).find(entry => entry.id === item.member));
    const none = "—";
    const rows = [
        ["成员", (member || (item.lane === "resident" ? "常驻 Agent" : "临时 Agent")) + (item.lane === "resident" ? "（常驻，保留历史）" : "（每次新开）") + (spec.lock ? "，占锁：同成员的任务一次只跑一个" : "")],
        ["启动", (spec.on || []).length ? h("ul", null, spec.on.map((start, index) => h("li", { key: index },
            [start.moments.join("、"), start.needs.length ? start.needs.join("、") + " 完成后" : ""].filter(Boolean).join("，"),
            start.condition ? h("span", { className: "dsh-tavern-task-spec-if" }, "if " + start.condition) : null,
            start.flow ? h("span", { className: "dsh-tavern-task-spec-if" }, "流程直接启动") : null))) : none],
        ["其他入口", (spec.manual || item.manual || []).length ? h("ul", null, (spec.manual || item.manual).map(text => h("li", { key: text }, text))) : none],
        ["需要", (spec.needs || []).length ? spec.needs.join("、") + " 完成" : none],
        ["被需要", (spec.neededBy || []).length ? spec.neededBy.join("、") + " 等它" : none],
        ["下一轮", spec.blocksNextTurn ? "开始前要等它做完" : "不等它"],
        ["前台", spec.idleForeground ? "不在生成正文时才开始" : none],
        ["取消", (spec.cancelOn || []).length ? spec.cancelOn.join("、") + " 时" : none],
        ["做什么", item.does],
        ["读", item.reads || none],
        ["写", item.writes || none],
        spec.note ? ["备注", spec.note] : null,
        item.waits && !item.spec ? ["等待", item.waits] : null
    ].filter(Boolean);
    return h("div", { className: "dsh-tavern-task-spec", id: "dsh-tavern-task-spec-" + item.task },
        h("div", { className: "dsh-tavern-task-spec-name" }, (item.plugin ? "插件「" + item.plugin + "」" : "") + item.name, h("code", null, item.task)),
        h("dl", null, rows.flatMap(([label, value]) => [h("dt", { key: label + ":k" }, label), h("dd", { key: label + ":v" }, value)])));
}
// Who does what: each resident member with its tasks and what it does now; fresh Agents
// (one new session per run, may run side by side) last.
function TavernBackgroundMembers(props) {
    const h = React.createElement, catalog = props.catalog || [], runs = props.runs || [];
    const ids = (props.members || []).map(member => member.id);
    const groups = (props.members || []).map(member => ({ key: member.id, name: backgroundMemberLabel(member),
        kind: "常驻，保留历史" + (member.timeline ? "，随剧情回退" : ""), tasks: catalog.filter(item => item.member === member.id), runs: runs.filter(run => run.member === member.id) }))
        .concat([{ key: "fresh", name: "临时 Agent", kind: "每次新开，可同时运行", tasks: catalog.filter(item => !ids.includes(item.member)), runs: runs.filter(run => !ids.includes(run.member)) }]);
    const now = group => {
        const running = group.runs.filter(run => run.status === "running"), queued = group.runs.filter(run => run.status === "queued");
        return [running.length ? "正在跑：" + running.map(run => run.name || run.task).join("、") : "", queued.length ? queued.length + " 个排队" : ""].filter(Boolean).join("，") || "空闲";
    };
    return h("div", { className: "dsh-tavern-members" }, groups.map(group => h("div", { key: group.key, className: "dsh-tavern-member" },
        h("div", { className: "dsh-tavern-member-head" }, h("b", null, group.name), h("span", null, group.kind), h("span", { className: "dsh-tavern-member-now" }, now(group))),
        group.tasks.length ? h("div", { className: "dsh-tavern-member-tasks" }, group.tasks.map(item => h("button", { key: item.task, type: "button", onClick: () => props.openSpec(item.task), title: item.does },
            (item.plugin && !group.name.includes(item.plugin) ? "插件「" + item.plugin + "」" : "") + item.name))) : h("div", { className: "dsh-tavern-member-tasks" }, "还没有登记任务"))));
}
// The 后台任务 sidebar page, for development: per turn, which moment started which task and
// what ran after what; the timeline and the full task list are folded below.
function TavernBackgroundTasksTab(props) {
    const h = React.createElement;
    const { runs, now, turns, moments, catalog, locks, members } = useTavernBackgroundRuns(props.sessionId);
    const active = (runs || []).filter(run => run.status === "queued" || run.status === "running");
    // A task named elsewhere on the page opens its definition under 全部任务.
    const specs = React.useRef(null);
    const openSpec = task => {
        if (specs.current) specs.current.open = true;
        window.requestAnimationFrame(() => document.getElementById("dsh-tavern-task-spec-" + task)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };
    return h("aside", { className: "dsh-tavern-status dsh-tavern-status-dashboard dsh-tavern-background-tasks" },
        h("div", { className: "dsh-tavern-status-head" },
            h("div", { className: "dsh-tavern-status-title" }, "后台任务"),
            h("div", { className: "dsh-tavern-status-settle" }, runs === null ? "正在读取…" : backgroundRunsSummary(runs) || "空闲")),
        h("div", { className: "dsh-tavern-status-body" },
            active.length ? h(TavernStopBackgroundAction, { sessionId: props.sessionId }) : null,
            h("section", { className: "dsh-tavern-status-section" },
                h("div", { className: "dsh-tavern-status-label" }, "每轮流程"),
                runs === null ? null : turns.length
                    ? turns.map((turn, index) => h(TavernBackgroundTurn, { key: turn.at, turn, open: index === 0, now, catalog, members, locks }))
                    : h("div", { className: "dsh-tavern-status-empty" }, "服务启动以来这局还没有玩过。"),
                h("p", { className: "dsh-tavern-settings-desc" }, "✓ 完成　● 运行中　… 排队　✕ 失败　⊘ 取消或作废　– 跳过（功能没开）。缩进的任务在上一项做完后才开始；点任务名看它做什么、等什么。只保留重启服务以来的最近几轮。")),
            h("section", { className: "dsh-tavern-status-section" },
                h("div", { className: "dsh-tavern-status-label" }, "成员"),
                h(TavernBackgroundMembers, { members, catalog, runs: runs || [], openSpec })),
            catalog.length ? h("details", { className: "dsh-tavern-status-section dsh-tavern-run-fold", ref: specs },
                h("summary", null, "全部任务（" + catalog.length + "）"),
                catalog.map(item => h(TavernBackgroundTaskSpec, { key: item.task, item, members })),
                h("p", { className: "dsh-tavern-settings-desc" }, "成员：书记、润色师等是每局常驻的后台 Agent，保留历史；临时 Agent 每次新开，可同时运行。")) : null));
}
