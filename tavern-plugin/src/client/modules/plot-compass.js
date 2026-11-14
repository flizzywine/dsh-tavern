const PLOT_COMPASS_PRESET_ARCHETYPES = Object.freeze([
    "情感拉扯", "修罗场", "权谋博弈", "悬疑调查",
    "奇幻冒险", "副本闯关", "经营养成", "群像势力",
    "高自由沙盒", "日常治愈", "禁忌共犯", "同人IF破局"
]);

const PLOT_COMPASS_HORIZON_META = Object.freeze([
    {
        key: "shortTerm",
        label: "今期",
        span: "2–5 轮",
        subtitle: "当前幕破局方向与小高潮节拍（联动下一步候选项角标）"
    },
    {
        key: "midTerm",
        label: "中期",
        span: "5–20 轮",
        subtitle: "篇章弧转折、隐藏支线与阶段里程碑"
    },
    {
        key: "longTerm",
        label: "长期",
        span: "终局蓝图",
        subtitle: "多结局命运假想（点亮仅注入无剧透暗流基调，不抢跑结局）"
    }
]);

function activeCompassSummaryOf(compass) {
    if (!compass || typeof compass !== "object") return { shortTerm: null, midTerm: null, longTerm: null, any: null, count: 0 };
    const pinned = compass.pinned || {};
    const find = function (key) {
        const id = pinned[key];
        if (!id || !Array.isArray(compass[key])) return null;
        return compass[key].find(function (item) { return item && item.id === id; }) || null;
    };
    const shortTerm = find("shortTerm");
    const midTerm = find("midTerm");
    const longTerm = find("longTerm");
    const count = (shortTerm ? 1 : 0) + (midTerm ? 1 : 0) + (longTerm ? 1 : 0);
    return { shortTerm, midTerm, longTerm, any: shortTerm || midTerm || longTerm, count };
}

function PlotCompassDockButton(props) {
    const h = React.createElement;
    const sessionId = props.sessionId;
    const view = props.view;
    if (!sessionId || !view || !isPlayMode(view.mode)) return null;
    const compass = view.plotCompass;
    const task = view.plotCompassTask || {};
    const isRunning = task.status === "running";
    const active = activeCompassSummaryOf(compass);
    const totalRoutes = ((compass && compass.shortTerm && compass.shortTerm.length) || 0) +
        ((compass && compass.midTerm && compass.midTerm.length) || 0) +
        ((compass && compass.longTerm && compass.longTerm.length) || 0);

    const titleParts = [];
    if (active.shortTerm) titleParts.push("今期：" + active.shortTerm.title);
    if (active.midTerm) titleParts.push("中期：" + active.midTerm.title);
    if (active.longTerm) titleParts.push("长期：" + active.longTerm.title);
    const title = isRunning
        ? "正在推演今期/中期/长期多路线剧情规划…"
        : titleParts.length > 0
            ? "当前锚定路线 — " + titleParts.join(" ｜ ") + "（点击打开剧情罗盘）"
            : "打开剧情罗盘：查看或推演今期、中期、长期多路线剧情灵感";

    const label = isRunning
        ? "罗盘推演中…"
        : active.any
            ? "罗盘 · " + (active.any.tag || active.any.title)
            : totalRoutes > 0
                ? "剧情罗盘 (" + totalRoutes + ")"
                : "剧情罗盘";

    return h("button", {
        type: "button",
        className: "dsh-tavern-btn dsh-tavern-compass-dock-btn" + (active.any ? " is-pinned" : "") + (isRunning ? " is-running" : ""),
        title: title,
        "aria-label": title,
        onClick: function () {
            if (typeof props.onOpen === "function") props.onOpen(sessionId);
        }
    },
        isRunning ? h(Spinner, { className: "dsh-tavern-compass-dock-spinner" }) : h("span", { "aria-hidden": true, className: "dsh-tavern-compass-dock-glyph" }, "🧭"),
        h("span", null, label)
    );
}

function TavernPlotCompassTab(props) {
    const h = React.createElement;
    const sessions = props.sessions;
    const fallbackSessionId = React.useSyncExternalStore(
        function (fn) { return sessions && sessions.list ? sessions.list.subscribe(fn) : function () {}; },
        function () { return String(tavernMainSessionId(sessions) || ""); },
        function () { return String(tavernMainSessionId(sessions) || ""); }
    );
    const sessionId = String(props.sessionId || fallbackSessionId || "");
    const live = useLiveTavernView(sessionId);
    const view = live && live.view;
    const play = view && isPlayMode(view.mode);

    const [activeHorizon, setActiveHorizon] = React.useState("shortTerm");
    const [guidance, setGuidance] = React.useState("");
    const [editingArchetypes, setEditingArchetypes] = React.useState(false);
    const [archetypeDraft, setArchetypeDraft] = React.useState("");
    const [selectedArchetypes, setSelectedArchetypes] = React.useState([]);
    const [busyAction, setBusyAction] = React.useState("");
    const [localError, setLocalError] = React.useState("");
    const [localNotice, setLocalNotice] = React.useState("");

    const compass = (view && view.plotCompass) || {
        playArchetypes: [], customArchetypes: [], situationDigest: "",
        shortTerm: [], midTerm: [], longTerm: [],
        pinned: { shortTerm: null, midTerm: null, longTerm: null }, archived: [], basedOnTurn: 0
    };
    const task = (view && view.plotCompassTask) || { status: "idle", scope: "all", error: "" };
    const isRunning = task.status === "running";
    const active = activeCompassSummaryOf(compass);
    const hasAnyRoutes = compass.shortTerm.length > 0 || compass.midTerm.length > 0 || compass.longTerm.length > 0;

    React.useEffect(function () {
        setLocalError("");
        setLocalNotice("");
        setEditingArchetypes(false);
    }, [sessionId]);

    async function runGenerate(scope, customGuidance) {
        if (!sessionId || isRunning || busyAction) return;
        setBusyAction("generate:" + scope);
        setLocalError("");
        setLocalNotice("");
        try {
            const text = customGuidance !== undefined ? customGuidance : guidance;
            await rpc("generatePlotCompass", { scope: scope || "all", guidance: String(text || "").trim() }, sessionId);
            liveTavernView.invalidate(sessionId);
        } catch (err) {
            setLocalError(String(err && err.message || err));
        } finally {
            setBusyAction("");
        }
    }

    async function cancelGenerate() {
        if (!sessionId) return;
        setBusyAction("cancel");
        setLocalError("");
        try {
            await rpc("cancelPlotCompass", {}, sessionId);
            liveTavernView.invalidate(sessionId);
        } catch (err) {
            setLocalError(String(err && err.message || err));
        } finally {
            setBusyAction("");
        }
    }

    async function togglePin(horizon, route) {
        if (!sessionId || busyAction) return;
        setBusyAction("pin:" + route.id);
        setLocalError("");
        setLocalNotice("");
        try {
            const wasPinned = compass.pinned && compass.pinned[horizon] === route.id;
            await rpc("pinPlotCompassRoute", { horizon: horizon, routeId: route.id }, sessionId);
            liveTavernView.invalidate(sessionId);
            setLocalNotice(wasPinned ? "已取消锚定「" + route.title + "」" : "已点亮「" + route.title + "」，将在后续候选与正文中软引导铺垫。");
        } catch (err) {
            setLocalError(String(err && err.message || err));
        } finally {
            setBusyAction("");
        }
    }

    async function toggleStep(horizon, routeId, stepIndex) {
        if (!sessionId || busyAction) return;
        setBusyAction("step:" + routeId + ":" + stepIndex);
        setLocalError("");
        try {
            await rpc("togglePlotCompassStep", { horizon: horizon, routeId: routeId, stepIndex: stepIndex }, sessionId);
            liveTavernView.invalidate(sessionId);
        } catch (err) {
            setLocalError(String(err && err.message || err));
        } finally {
            setBusyAction("");
        }
    }

    async function forkWithRoute(horizon, route) {
        if (!sessionId || busyAction) return;
        setBusyAction("fork:" + route.id);
        setLocalError("");
        setLocalNotice("");
        try {
            const turn = Number(view && view.latestAssistantTurn) || 0;
            await tavernConversationForkRequests.request({
                sessionId: sessionId,
                turn: turn,
                plotCompassPin: { horizon: horizon, routeId: route.id, exact: true },
                titleSuffix: " · " + (route.tag || route.title)
            });
        } catch (err) {
            setLocalError(String(err && err.message || err));
        } finally {
            setBusyAction("");
        }
    }

    async function drillDownRoute(fromHorizon, route) {
        const targetScope = fromHorizon === "longTerm" ? "midTerm" : "shortTerm";
        const targetName = targetScope === "midTerm" ? "中期篇章" : "今期节拍";
        const promptText = "围绕已选定的方向「" + route.title + "」（" + (route.vision || route.summary || "") + "），拆解出 3–4 条不同切入角度的" + targetName + "路线。";
        setActiveHorizon(targetScope);
        await runGenerate(targetScope, promptText);
    }

    async function refreshCandidatesFromCompass() {
        if (!sessionId || busyAction) return;
        setBusyAction("candidates");
        setLocalError("");
        setLocalNotice("");
        try {
            const msgId = String(view && view.latestAssistantMessageId || "");
            await submitCandidateTask(sessionId, msgId, "");
            liveTavernView.invalidate(sessionId);
            tavernCoordination.invalidate(sessionId);
            setLocalNotice("已提交候选项生成，新候选项将携带当前罗盘路线角标。");
        } catch (err) {
            setLocalError(String(err && err.message || err));
        } finally {
            setBusyAction("");
        }
    }

    function openArchetypeEditor() {
        const initial = (compass.customArchetypes && compass.customArchetypes.length)
            ? compass.customArchetypes
            : (compass.playArchetypes || []);
        setSelectedArchetypes(initial.slice(0, 5));
        setArchetypeDraft("");
        setEditingArchetypes(true);
    }

    function togglePresetArchetype(tag) {
        setSelectedArchetypes(function (prev) {
            if (prev.includes(tag)) return prev.filter(function (item) { return item !== tag; });
            if (prev.length >= 5) return prev;
            return prev.concat(tag);
        });
    }

    function addCustomArchetypeChip() {
        const text = String(archetypeDraft || "").trim().slice(0, 16);
        if (!text) return;
        setSelectedArchetypes(function (prev) {
            if (prev.includes(text) || prev.length >= 5) return prev;
            return prev.concat(text);
        });
        setArchetypeDraft("");
    }

    async function saveArchetypes(andRegenerate) {
        if (!sessionId || busyAction) return;
        setBusyAction("archetypes");
        setLocalError("");
        try {
            const pendingText = String(archetypeDraft || "").trim().slice(0, 16);
            const finalTags = pendingText && !selectedArchetypes.includes(pendingText) && selectedArchetypes.length < 5
                ? selectedArchetypes.concat(pendingText)
                : selectedArchetypes;
            await rpc("setPlotCompassArchetypes", { archetypes: finalTags }, sessionId);
            setEditingArchetypes(false);
            setArchetypeDraft("");
            liveTavernView.invalidate(sessionId);
            if (andRegenerate) {
                setBusyAction("");
                await runGenerate("all");
                return;
            }
            setLocalNotice(finalTags.length ? "已锁定游玩类型标签：" + finalTags.join("、") : "已恢复自动识别游玩类型");
        } catch (err) {
            setLocalError(String(err && err.message || err));
        } finally {
            setBusyAction("");
        }
    }

    if (!sessionId || !view) {
        return h("aside", { className: "dsh-tavern-status dsh-tavern-compass-panel" },
            h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "剧情罗盘")),
            h("div", { className: "dsh-tavern-status-body" }, h("div", { className: "dsh-tavern-status-empty" }, "正在读取当前对局…"))
        );
    }

    if (!play) {
        return h("aside", { className: "dsh-tavern-status dsh-tavern-compass-panel" },
            h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "剧情罗盘")),
            h("div", { className: "dsh-tavern-status-body" }, h("div", { className: "dsh-tavern-status-empty" }, "请先打开一局游玩对话，即可推演今期、中期、长期的多路线剧情发展灵感。"))
        );
    }

    const activeMeta = PLOT_COMPASS_HORIZON_META.find(function (m) { return m.key === activeHorizon; }) || PLOT_COMPASS_HORIZON_META[0];
    const currentRoutes = Array.isArray(compass[activeHorizon]) ? compass[activeHorizon] : [];
    const currentPinnedId = compass.pinned ? compass.pinned[activeHorizon] : null;
    const displayArchetypes = (compass.customArchetypes && compass.customArchetypes.length) ? compass.customArchetypes : (compass.playArchetypes || []);

    function onHorizonKeyDown(event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const at = PLOT_COMPASS_HORIZON_META.findIndex(function (m) { return m.key === activeHorizon; });
        const nextAt = (at + (event.key === "ArrowRight" ? 1 : PLOT_COMPASS_HORIZON_META.length - 1)) % PLOT_COMPASS_HORIZON_META.length;
        setActiveHorizon(PLOT_COMPASS_HORIZON_META[nextAt].key);
    }

    function renderRouteCard(horizon, route) {
        const isPinned = currentPinnedId === route.id;
        const steps = horizon === "shortTerm" ? (route.beats || []) : horizon === "midTerm" ? (route.milestones || []) : [];
        const doneCount = steps.filter(function (s) { return s && s.done; }).length;

        return h("article", {
            key: route.id,
            className: "dsh-tavern-compass-card" + (isPinned ? " is-pinned" : ""),
            "data-horizon": horizon
        },
            h("header", { className: "dsh-tavern-compass-card-head" },
                h("div", { className: "dsh-tavern-compass-card-titles" },
                    h("span", { className: "dsh-tavern-compass-route-tag" }, "〔" + route.tag + "〕"),
                    h("h4", { className: "dsh-tavern-compass-card-title" }, route.title)
                ),
                h("div", { className: "dsh-tavern-compass-card-badges" },
                    route.direction || route.tone ? h("span", { className: "dsh-tavern-compass-pill is-direction" }, route.direction || route.tone) : null,
                    route.sourceHook ? h("span", { className: "dsh-tavern-compass-pill is-hook", title: "灵感来源" }, route.sourceHook) : null,
                    isPinned ? h("span", { className: "dsh-tavern-compass-pill is-active" }, "★ 已锚定") : null
                )
            ),
            h("p", { className: "dsh-tavern-compass-card-summary" }, horizon === "longTerm" ? route.vision : route.summary),
            horizon === "midTerm" && route.entryHook ? h("div", { className: "dsh-tavern-compass-callout" },
                h("strong", null, "入线契机："),
                h("span", null, route.entryHook)
            ) : null,
            steps.length > 0 ? h("div", { className: "dsh-tavern-compass-steps" },
                h("div", { className: "dsh-tavern-compass-steps-head" },
                    h("span", null, horizon === "shortTerm" ? "推进节拍" : "篇章里程碑"),
                    h("span", null, doneCount + "/" + steps.length)
                ),
                h("ul", { className: "dsh-tavern-compass-step-list" }, steps.map(function (step, idx) {
                    const checked = Boolean(step && step.done);
                    return h("li", { key: idx, className: checked ? "is-done" : "" },
                        h("button", {
                            type: "button",
                            className: "dsh-tavern-compass-step-btn",
                            disabled: Boolean(busyAction),
                            "aria-pressed": checked ? "true" : "false",
                            title: checked ? "标记为未完成" : "标记为已达成",
                            onClick: function () { toggleStep(horizon, route.id, idx); }
                        },
                            h("span", { className: "dsh-tavern-compass-check", "aria-hidden": true }, checked ? "✓" : "○"),
                            h("span", { className: "dsh-tavern-compass-step-text" }, step.text)
                        )
                    );
                }))
            ) : null,
            horizon === "midTerm" && route.stakes ? h("p", { className: "dsh-tavern-compass-meta-line" },
                h("strong", null, "收益与风险："), route.stakes
            ) : null,
            horizon === "longTerm" && Array.isArray(route.prerequisites) && route.prerequisites.length > 0 ? h("div", { className: "dsh-tavern-compass-steps" },
                h("div", { className: "dsh-tavern-compass-steps-head" }, h("span", null, "达成前置拐点")),
                h("ul", { className: "dsh-tavern-compass-prereq-list" }, route.prerequisites.map(function (req, idx) {
                    return h("li", { key: idx }, req);
                }))
            ) : null,
            horizon === "longTerm" && route.toneGuidance ? h("p", { className: "dsh-tavern-compass-meta-line is-subtle", title: "点亮此终局后，前台正文只会收到这句暗流基调，不会剧透或抢跑结局" },
                h("strong", null, "防剧透暗流指引："), route.toneGuidance
            ) : null,
            h("footer", { className: "dsh-tavern-compass-card-actions" },
                h("button", {
                    type: "button",
                    className: "dsh-tavern-btn" + (isPinned ? " primary" : ""),
                    disabled: Boolean(busyAction),
                    onClick: function () { togglePin(horizon, route); }
                }, isPinned ? "✓ 已点亮（取消）" : "点亮此路线"),
                horizon !== "shortTerm" ? h("button", {
                    type: "button",
                    className: "dsh-tavern-btn",
                    disabled: isRunning || Boolean(busyAction),
                    title: horizon === "longTerm" ? "围绕此终局推演配套的中期篇章路线" : "围绕此篇章推演眼前的今期节拍路线",
                    onClick: function () { drillDownRoute(horizon, route); }
                }, horizon === "longTerm" ? "拆解中期 ↘" : "拆解今期 ↘") : null,
                h("button", {
                    type: "button",
                    className: "dsh-tavern-btn",
                    disabled: Boolean(busyAction),
                    title: "从当前回合克隆出一个独立平行存档，并自动点亮此路线",
                    onClick: function () { forkWithRoute(horizon, route); }
                }, "分叉试玩 ⑂")
            )
        );
    }

    return h("aside", { className: "dsh-tavern-status dsh-tavern-compass-panel" },
        h("div", { className: "dsh-tavern-status-head" },
            h("div", { className: "dsh-tavern-status-title" }, "剧情罗盘"),
            h("div", { className: "dsh-tavern-compass-head-actions" },
                compass.basedOnTurn > 0 ? h("span", { className: "dsh-tavern-compass-turn-badge" }, "第 " + compass.basedOnTurn + " 轮") : null,
                isRunning
                    ? h("button", { type: "button", className: "dsh-tavern-btn danger", disabled: busyAction === "cancel", onClick: cancelGenerate }, "取消推演")
                    : h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: Boolean(busyAction), onClick: function () { runGenerate("all"); } }, hasAnyRoutes ? "全局演进刷新" : "✦ 推演多路线")
            )
        ),
        h("div", { className: "dsh-tavern-status-body dsh-tavern-compass-body" },
            h("section", { className: "dsh-tavern-compass-top" },
                h("div", { className: "dsh-tavern-compass-archetypes-row" },
                    h("span", { className: "dsh-tavern-compass-label" }, "游玩类型："),
                    displayArchetypes.length > 0
                        ? displayArchetypes.map(function (tag) {
                            return h("span", { key: tag, className: "dsh-tavern-compass-archetype-chip" }, tag);
                        })
                        : h("span", { className: "dsh-tavern-compass-muted" }, "推演时自动识别，或手动指定"),
                    h("button", {
                        type: "button",
                        className: "dsh-tavern-compass-link-btn",
                        disabled: Boolean(busyAction),
                        onClick: function () { editingArchetypes ? setEditingArchetypes(false) : openArchetypeEditor(); }
                    }, editingArchetypes ? "收起" : "定制标签")
                ),
                editingArchetypes ? h("div", { className: "dsh-tavern-compass-archetype-editor" },
                    h("p", { className: "dsh-tavern-settings-desc" }, "选择或输入 1–5 个游玩题材/流派标签，AI 将按对应戏剧维度发散不同路线："),
                    h("div", { className: "dsh-tavern-compass-preset-tags" }, PLOT_COMPASS_PRESET_ARCHETYPES.map(function (tag) {
                        const on = selectedArchetypes.includes(tag);
                        return h("button", {
                            key: tag,
                            type: "button",
                            className: "dsh-tavern-compass-preset-tag" + (on ? " is-selected" : ""),
                            onClick: function () { togglePresetArchetype(tag); }
                        }, (on ? "✓ " : "+ ") + tag);
                    })),
                    selectedArchetypes.length > 0 ? h("div", { className: "dsh-tavern-compass-selected-tags" },
                        selectedArchetypes.map(function (tag) {
                            return h("span", { key: tag, className: "dsh-tavern-compass-archetype-chip is-removable" },
                                tag,
                                h("button", { type: "button", "aria-label": "移除 " + tag, onClick: function () { setSelectedArchetypes(selectedArchetypes.filter(function (t) { return t !== tag; })); } }, "×")
                            );
                        })
                    ) : null,
                    h("div", { className: "dsh-tavern-compass-custom-row" },
                        h("input", {
                            type: "text",
                            className: "dsh-tavern-compass-input",
                            maxLength: 16,
                            placeholder: "自定义流派（如：克苏鲁调查、赛博跑团）",
                            value: archetypeDraft,
                            onChange: function (e) { setArchetypeDraft(e.target.value); },
                            onKeyDown: function (e) { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addCustomArchetypeChip(); } }
                        }),
                        h("button", { type: "button", className: "dsh-tavern-btn", disabled: !archetypeDraft.trim() || selectedArchetypes.length >= 5, onClick: addCustomArchetypeChip }, "添加")
                    ),
                    h("div", { className: "dsh-tavern-compass-editor-actions" },
                        h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: Boolean(busyAction), onClick: function () { saveArchetypes(true); } }, "保存并立即重推路线"),
                        h("button", { type: "button", className: "dsh-tavern-btn", disabled: Boolean(busyAction), onClick: function () { saveArchetypes(false); } }, "仅保存"),
                        selectedArchetypes.length > 0 ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: Boolean(busyAction), onClick: function () { setSelectedArchetypes([]); } }, "清空") : null
                    )
                ) : null,
                compass.situationDigest ? h("p", { className: "dsh-tavern-compass-digest" }, compass.situationDigest) : null,
                h("div", { className: "dsh-tavern-compass-guidance-box" },
                    h("input", {
                        type: "text",
                        className: "dsh-tavern-compass-input",
                        maxLength: 400,
                        disabled: isRunning,
                        placeholder: "脑暴灵感方向（可选，如：给几条和宿敌暗中联手搞事的路线）",
                        value: guidance,
                        onChange: function (e) { setGuidance(e.target.value); },
                        onKeyDown: function (e) { if (e.key === "Enter" && !e.isComposing && !isRunning) { e.preventDefault(); runGenerate("all"); } }
                    })
                )
            ),

            active.count > 0 ? h("section", { className: "dsh-tavern-compass-funnel", "aria-label": "当前锚定漏斗" },
                h("div", { className: "dsh-tavern-compass-funnel-head" },
                    h("strong", null, "🧭 当前激活方向"),
                    h("button", {
                        type: "button",
                        className: "dsh-tavern-btn",
                        disabled: Boolean(busyAction),
                        title: "按当前罗盘路线重新生成下一步行动候选项（带路线角标）",
                        onClick: refreshCandidatesFromCompass
                    }, busyAction === "candidates" ? "提交中…" : "生成联动候选项")
                ),
                h("div", { className: "dsh-tavern-compass-funnel-items" },
                    active.shortTerm ? h("span", { className: "dsh-tavern-compass-funnel-chip", onClick: function () { setActiveHorizon("shortTerm"); } }, "今期：" + active.shortTerm.title) : null,
                    active.midTerm ? h("span", { className: "dsh-tavern-compass-funnel-chip", onClick: function () { setActiveHorizon("midTerm"); } }, "中期：" + active.midTerm.title) : null,
                    active.longTerm ? h("span", { className: "dsh-tavern-compass-funnel-chip", onClick: function () { setActiveHorizon("longTerm"); } }, "长期：" + active.longTerm.title) : null
                )
            ) : null,

            isRunning ? h("div", { className: "fork-status-alert", "data-kind": "info", role: "status" },
                h(Spinner, { className: "dsh-tavern-compass-dock-spinner" }),
                h("span", null, "后台正在结合人物卡、变量状态与世界书暗线推演" + (task.scope === "shortTerm" ? "今期" : task.scope === "midTerm" ? "中期" : task.scope === "longTerm" ? "长期" : "今期 / 中期 / 长期") + "路线…（不影响继续对话）")
            ) : null,
            task.status === "failed" && task.error ? h("div", { className: "fork-status-alert", "data-kind": "error", role: "alert" },
                h("span", null, task.error),
                h("button", { type: "button", disabled: isRunning || Boolean(busyAction), onClick: function () { runGenerate(task.scope || "all"); } }, "重试")
            ) : null,
            localError ? h("div", { className: "fork-status-alert", "data-kind": "error", role: "alert" }, h("span", null, localError)) : null,
            localNotice ? h("p", { className: "dsh-tavern-compass-notice", role: "status" }, localNotice) : null,

            h("div", { className: "dsh-tavern-compass-tabs", role: "tablist", "aria-label": "剧情规划时间跨度", onKeyDown: onHorizonKeyDown },
                PLOT_COMPASS_HORIZON_META.map(function (meta) {
                    const selected = meta.key === activeHorizon;
                    const count = Array.isArray(compass[meta.key]) ? compass[meta.key].length : 0;
                    const hasPin = Boolean(compass.pinned && compass.pinned[meta.key]);
                    return h("button", {
                        key: meta.key,
                        type: "button",
                        role: "tab",
                        "aria-selected": selected ? "true" : "false",
                        tabIndex: selected ? 0 : -1,
                        className: "dsh-tavern-compass-tab" + (selected ? " is-active" : "") + (hasPin ? " has-pin" : ""),
                        onClick: function () { setActiveHorizon(meta.key); }
                    },
                        h("span", { className: "dsh-tavern-compass-tab-title" }, (hasPin ? "★ " : "") + meta.label),
                        h("small", null, count > 0 ? meta.span + " · " + count : meta.span)
                    );
                })
            ),

            h("div", { className: "dsh-tavern-compass-section-bar" },
                h("p", { className: "dsh-tavern-settings-desc" }, activeMeta.subtitle),
                hasAnyRoutes && !isRunning ? h("button", {
                    type: "button",
                    className: "dsh-tavern-compass-link-btn",
                    disabled: Boolean(busyAction),
                    onClick: function () { runGenerate(activeHorizon); }
                }, "↻ 仅换一批" + activeMeta.label) : null
            ),

            currentRoutes.length > 0
                ? h("div", { className: "dsh-tavern-compass-cards" }, currentRoutes.map(function (route) { return renderRouteCard(activeHorizon, route); }))
                : !isRunning
                    ? h("div", { className: "dsh-tavern-compass-empty" },
                        h("p", null, "尚未生成" + activeMeta.label + "路线规划。"),
                        h("p", { className: "dsh-tavern-settings-desc" }, "点击上方「✦ 推演多路线」，AI 将基于本卡题材玩法、已埋伏笔与未触发的世界书暗线，提供多条截然不同的近/中/长期发展路线供你挑选灵感或一键分叉试玩。"),
                        h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: Boolean(busyAction), onClick: function () { runGenerate("all"); } }, "✦ 立即推演今期 / 中期 / 长期路线")
                    )
                    : null,

            Array.isArray(compass.archived) && compass.archived.length > 0 ? h("details", { className: "dsh-tavern-compass-archived" },
                h("summary", null, "已偏离/归档的旧路线（" + compass.archived.length + "）"),
                compass.archived.map(function (item, idx) {
                    return h("p", { key: idx, className: "dsh-tavern-settings-desc" },
                        "【第 " + (item.turn || "?") + " 轮 · " + item.title + "】" + (item.reason || "剧情已走向新分支")
                    );
                })
            ) : null
        )
    );
}
