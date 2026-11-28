// the play status side panel, redesigned.
// Rendering only. All state, RPC and rules stay in TavernStatusPanel; this module is
// included inside the play-controls feature module so it can reuse its components.

function StatusTabIcon(props) {
    const h = React.createElement;
    const sessionId = React.useSyncExternalStore(function (fn) { return props.sessions.list.subscribe(fn); }, function () { return props.sessions.list.getSnapshot().current || ""; });
    const state = useLiveTavernView(sessionId);
    const settle = state && state.view && state.view.settleStatus;
    const label = settle === "running" ? "正在更新状态" : settle === "error" ? "状态更新失败，请打开酒馆状态重试" : "酒馆状态";
    return h("span", { className: "fork-status-tab-icon", "data-state": settle || "done", role: "img", "aria-label": label, title: label, style: { width: props.size, height: props.size } },
        settle === "running" ? h(Spinner, { className: "fork-status-tab-spinner" })
            : settle === "error" ? h("span", { className: "fork-status-tab-error", "aria-hidden": true }, "!")
            : DshUi.IconGaugeOutline16 ? h(DshUi.IconGaugeOutline16, { size: props.size, width: props.size, height: props.size }) : null);
}

function StatusPanelView(p) {
    const h = React.createElement;
    const view = p.view, running = p.running;
    // The composer's guide chip asks the panel to focus the guide input.
    React.useEffect(function () {
        function focus() { const node = p.guideInputRef.current; if (node) { node.scrollIntoView({ block: "center", behavior: "smooth" }); node.focus({ preventScroll: true }); } }
        window.addEventListener("dsh-fork-focus-guide", focus);
        return function () { window.removeEventListener("dsh-fork-focus-guide", focus); };
    }, []);
    const settle = view.settleStatus || "done";
    const guides = view.guides || [];
    // Card and world book edits enter an idle game by themselves (upstream auto-reload): the alert says what happened;
    // only a legacy copy or a failed reload offers a button.
    const cardUpdate = ["story", "script"].includes(view.mode || "story") && view.requestMode !== "sillytavern" && view.cardUpdate ? view.cardUpdate : null;
    const update = !cardUpdate ? null : cardUpdate.error ? { kind: "error", text: "检查人物卡更新失败：" + cardUpdate.error }
        : cardUpdate.worldbookSyncRequired || cardUpdate.legacy ? { kind: "info", text: "旧存档的世界书副本需要同步一次", action: "同步" }
        : cardUpdate.autoReloadError ? { kind: "error", text: "自动重新加载人物卡失败：" + cardUpdate.autoReloadError, action: "重试" }
        : cardUpdate.autoReloading ? { kind: "info", text: "人物卡或世界书有变化，正在重新加载…" }
        : cardUpdate.available && (cardUpdate.cardChanged || cardUpdate.worldbookChanged) ? { kind: "info", text: "人物卡或世界书有变化，空闲时自动重新加载" }
        : view.cardAutoReload ? { kind: "info", text: "已自动重新加载人物卡（" + new Date(view.cardAutoReload.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "）" }
        : null;
    const reloadDisabled = running || p.cardUpdateBusy || settle === "running";
    const debugButton = h(TavernDebugButton, { sessionId: p.props.sessionId, turn: p.latestDebugTurn, label: "交给调试 Agent" });

    function section(key, title, extra, body) {
        return h("section", { key, className: "fork-status-section" },
            h("header", null, h("h3", null, title), extra || null), body);
    }
    // 手机输入法在按键归属期给 keyCode 229（部分 WebKit 还会先结束 composition），回车因此可能永远对不上：
    // 这里是快捷键，不是唯一入口，输入框旁常驻的「添加」按钮才是手机上的保存路径。
    const guideDraftText = String(p.guideDraft === undefined || p.guideDraft === null ? "" : p.guideDraft).trim();
    function onGuideKey(event) {
        const native = event.nativeEvent || event;
        if (native.isComposing || event.isComposing || event.keyCode === 229) return;
        if ((event.key === "Enter" || event.keyCode === 13) && !event.shiftKey) { event.preventDefault(); p.addGuide(); }
    }

    return h("aside", { className: "dsh-tavern-status fork-status" },
        h("div", { className: "dsh-tavern-status-body fork-status-body" },
            // Alerts: one line each, action on the right.
            h(TavernBackgroundWait, { sessionId: p.props.sessionId, activity: view.activity }),
            h(TavernSaveUpgrade, { key: p.props.sessionId, sessionId: p.props.sessionId, busy: running || view.activity?.busy || settle === "running" }),
            h("nav", { className: "dsh-tavern-status-resource-links", "aria-label": "本局资料" },
                h("button", { type: "button", disabled: !view.card.path, onClick: () => p.props.openStyleTab("dsh-tavern:cards", { cardPath: view.card.path }) }, "打开人物卡 ↗"),
                h("button", { type: "button", disabled: !view.card.path || p.resourceLinkBusy || !p.currentResourceBinding || p.noWorldBook || p.unavailableWorldBook, onClick: p.openWorldBookDetail }, "打开世界书 ↗")),
            p.resourceLinkError ? h("p", { role: "status" }, p.resourceLinkError) : null,
            update ? h("div", { className: "fork-status-alert", "data-kind": update.kind },
                h("span", { title: "保留剧情和数值，替换本局人物卡与世界书" }, update.text),
                update.action ? h("button", { type: "button", disabled: reloadDisabled, onClick: p.applyUpdatedCard }, p.cardUpdateBusy ? "加载中…" : update.action) : null,
                p.cardUpdateError ? h("div", { className: "fork-status-alert-detail", role: "alert" }, p.cardUpdateError) : null) : null,
            settle === "error" ? h("div", { className: "fork-status-alert", "data-kind": "error" },
                h("span", null, view.settleError || "后台结算失败"),
                h("button", { type: "button", disabled: p.settlementRetryBusy, onClick: p.retrySettlement }, p.settlementRetryBusy ? "重试中…" : "重试"), debugButton) : null,
            view.worldBookError ? h("div", { className: "fork-status-alert", "data-kind": "error" }, h("span", null, "世界书召回失败：" + view.worldBookError), debugButton) : null,
            view.foregroundError ? h("div", { className: "fork-status-alert", "data-kind": "error" }, h("span", null, view.foregroundError.message || "正文生成失败，可撤回这条输入后重发。"), debugButton) : null,
            (view.presentationWarnings || []).map(function (warning, index) { return h("div", { key: "w" + index, className: "fork-status-alert", "data-kind": "warn" }, h("span", null, warning)); }),

            h(TavernCardAppDock, { key: p.props.sessionId, sessionId: p.props.sessionId, active: p.props.active !== false }),
            h("div", { className: "fork-status-card" },
                h(TavernPersistentStatusRuntime, { sessionId: p.props.sessionId, view: view, executeSlash: p.props.executeSlash,
                    panels: view.statusBarPlacement === "body" ? "pinned" : "all", section: true })),

            TAVERN_PLAY_FEATURES.postureSummary && view.posture ? section("now", "此刻", null, h("p", { className: "fork-status-now" }, view.posture)) : null,

            view.mode === "script" && view.scriptProgress ? h(ScriptNavigation, { sessionId: p.props.sessionId, cursor: view.scriptProgress.cursor, total: view.scriptProgress.totalChunks, chunkSize: view.scriptProgress.chunkSize,
                    busy: running || view.activity?.busy || view.regenInProgress }) : null,

            section("guide", "Guide", h("span", { className: "fork-status-count", title: "Guide 会注入之后的正文、候选与变量结算" }, guides.length ? String(guides.length) : ""),
                h(React.Fragment, null,
                    guides.length ? h("ul", { className: "fork-status-guides" }, guides.map(function (guide, index) {
                        return h("li", { key: guide.id || index },
                            h("span", null, guide.text),
                            h("button", { type: "button", "aria-label": "删除这条指引", title: "删除", disabled: p.guideBusy, onClick: function () { p.removeGuide(guide, index); } }, "×"));
                    })) : null,
                    h("div", { className: "dsh-tavern-status-resource-links fork-status-guide-links" },
                        h("button", { type: "button", onClick: () => p.props.openStyleTab("dsh-tavern:guide-library") }, "打开 Guide 库 ↗"),
                        h("button", { type: "button", disabled: p.guideBusy || !guides.length, onClick: p.saveGuideLibrary }, "保存到 Guide 库")),
                    p.guideNotice ? h("p", { role: "status" }, p.guideNotice) : null,
                    h("div", { className: "fork-status-guide-row" },
                        h(TextArea, { className: "fork-status-guide-input", inputRef: p.guideInputRef, "aria-label": "新 Guide 内容", rows: 1, maxLength: 2000, value: p.guideDraft, disabled: p.guideBusy,
                            enterKeyHint: "done",
                            placeholder: guides.length ? "继续添加…" : "写一条正文要求，例如：多写心理活动，对话不超过三句",
                            onChange: function (text) { p.setGuideDraft(text); }, onKeyDown: onGuideKey }),
                        // 回车保存是桌面快捷键；手机输入法吞掉回车时，这一条是唯一可靠的保存入口。
                        h("button", { type: "button", className: "fork-status-guide-save", disabled: p.guideBusy || !guideDraftText, onClick: function () { p.addGuide(); } },
                            p.guideBusy ? "添加中…" : "添加")),
                    p.guideError ? h("div", { className: "fork-status-alert", "data-kind": "error" }, h("span", null, p.guideError)) : null)),

            h(TavernPluginTasks, { sessionId: p.props.sessionId, activity: view.activity, busy: running || view.activity?.busy || view.activity?.phase === "pending" }),
            h(TavernPluginStatusSections, { sessionId: p.props.sessionId }),
            TAVERN_PLAY_FEATURES.storyLedger ? h(TavernLedger, { sessionId: p.props.sessionId, ledger: view.ledger, ledgerTask: view.ledgerTask, busy: running || view.activity?.busy, foregroundRunning: running }) : null,
            h(TavernMvuVariables, { sessionId: p.props.sessionId, view: view }),

            h("footer", { className: "fork-status-foot" },
                h("details", { className: "fork-status-menu" },
                    h("summary", null, "调整文风"),
                    h("div", null,
                        h("button", { type: "button", onClick: function () { window.dispatchEvent(new CustomEvent("dsh-fork-focus-guide")); } }, "只改这一局", h("small", null, "写作指引")),
                        h("button", { type: "button", onClick: function () { p.props.openStyleTab("dsh-tavern:presets", { section: "userProfile" }); } }, "以后都这样", h("small", null, "长期偏好")),
                        h("button", { type: "button", disabled: running, onClick: function () { window.dispatchEvent(new CustomEvent("dsh-tavern-adjust-card-style", { detail: { card: view.card } })); } }, "改这张卡", h("small", null, "卡片助手")),
                        h("button", { type: "button", onClick: function () { p.props.openStyleTab("dsh-tavern:presets", { section: "preset" }); } }, "换预设", h("small", null, "酒馆预设")))),
                h(TavernDebugButton, { sessionId: p.props.sessionId, turn: p.latestDebugTurn, className: "fork-status-link", label: "交给调试 Agent" })))
    );
}
