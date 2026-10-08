		function createPlayControlsFeatureModule() {
			const historyProjection = createTurnHistoryProjection();
			function TavernConversationExportAction(props) {
                // The header only needs session membership. Building a complete
                // Tavern view here delays the button behind templates and history.
                const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
                const available = Boolean(useTavernSessionMode(owner));
                const [busy, setBusy] = React.useState(false);
                const [open, setOpen] = React.useState(false);
                const root = React.useRef(null);
                React.useEffect(function () {
                    setOpen(false);
                }, [props.sessionId]);
                React.useEffect(function () {
                    if (!open) return;
                    function outside(event) { if (!root.current || !root.current.contains(event.target)) setOpen(false); }
                    function escape(event) { if (event.key === "Escape") { setOpen(false); root.current?.querySelector("[aria-haspopup]")?.focus(); } }
                    document.addEventListener("pointerdown", outside, true);
                    document.addEventListener("keydown", escape);
                    return function () { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
                }, [open]);
				if (!available) return null;
				async function exportText() {
					setBusy(true);
					try {
						const snapshot = props.sessions.list.getSnapshot();
						const summary = snapshot.byId && snapshot.byId[props.sessionId];
						const result = await rpc("exportConversation", { title: summary && summary.displayTitle || "" }, props.sessionId);
						// With illustrations the Markdown and its pictures arrive together as a zip.
						const blob = result.base64
							? new Blob([Uint8Array.from(atob(result.base64), function (value) { return value.charCodeAt(0); })], { type: "application/zip" })
							: new Blob([result.text], { type: "text/markdown;charset=utf-8" });
						const url = URL.createObjectURL(blob);
						const link = document.createElement("a");
						link.href = url; link.download = result.filename || "对话记录.md";
						document.body.appendChild(link); link.click(); link.remove();
						window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
					} catch (err) { tavernErrorHub.report("导出故事正文", err); }
					finally { setBusy(false); }
				}
				async function exportSave() {
					setBusy(true);
					try {
						const result = await rpc("exportGameSave", { images: true }, props.sessionId);
						const bytes = Uint8Array.from(atob(result.base64), function (value) { return value.charCodeAt(0); });
						const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
						const link = document.createElement("a");
						link.href = url; link.download = result.filename;
						document.body.appendChild(link); link.click(); link.remove();
						window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
					} catch (err) { tavernErrorHub.report("导出存档", err); }
					finally { setBusy(false); }
				}
				async function exportLogs() {
					setBusy(true);
					try {
						const result = await rpc("exportTavernLogs", {}, props.sessionId);
						const bytes = Uint8Array.from(atob(result.base64), function (value) { return value.charCodeAt(0); });
						const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
						const link = document.createElement("a");
						link.href = url; link.download = result.filename;
						document.body.appendChild(link); link.click(); link.remove();
						window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
					} catch (err) { tavernErrorHub.report("导出日志", err); }
					finally { setBusy(false); }
				}
                return React.createElement("div", { className: "dsh-tavern-more-actions dsh-tavern-export-menu", ref: root },
                    React.createElement("button", { type: "button", className: "dsh-tavern-export-action", "aria-label": busy ? "导出中" : "导出", title: "导出", "aria-haspopup": "menu", "aria-expanded": open, "aria-busy": busy, onClick: function () { setOpen(value => !value); } },
                        React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, React.createElement("path", { d: "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" })),
                        React.createElement("span", { className: "dsh-tavern-header-action-label" }, busy ? "导出中…" : "导出")),
                    React.createElement("div", { className: "dsh-tavern-more-menu", role: "menu", "aria-label": "导出", hidden: !open, onClick: function (event) { if (event.target.closest("button:not(:disabled)")) setOpen(false); } },
                        React.createElement("button", { type: "button", role: "menuitem", disabled: busy, title: "导出这一局的存档，可在其他电脑的酒馆里导入继续玩", onClick: exportSave }, "存档"),
                        React.createElement("button", { type: "button", role: "menuitem", "data-tavern-log-export": "", disabled: busy, "aria-label": "日志", title: "下载 Session、MVU、生图与更新日志；含私人剧情，分享前请检查隐私", onClick: exportLogs }, "日志（用于排查错误）"),
                        React.createElement("button", { type: "button", role: "menuitem", disabled: busy, title: "导出玩家与角色正文的 Markdown；有配图时连同图片打包为 zip", onClick: exportText }, "故事正文")
                    ));
            }

			function TavernCompactionAction(props) {
				const [busy, setBusy] = React.useState(false);
				const [resultLabel, setResultLabel] = React.useState("");
				const [resultTitle, setResultTitle] = React.useState("");
				const running = props.useSession(function (snapshot) { return snapshot.running; });
				async function compactContext() {
					setBusy(true);
					setResultLabel("");
					setResultTitle("");
					try {
                        const response = await rpc("runCompaction", {}, props.sessionId);
                        const operation = response.result;
                        if (!operation) throw new Error("当前会话不支持剧情压缩");
                        setResultTitle("前台：" + operation.foreground.message + "；后台：" + (operation.background.message || "无后台"));
                        if (operation.status !== "completed") throw new Error("上下文压缩未全部完成。前台：" + operation.foreground.message + "；后台：" + (operation.background.message || "无后台"));
                        setResultLabel(operation.backgroundSessionId ? "前台和后台已压缩" : "前台已压缩");
					} catch (err) { tavernErrorHub.report("压缩上下文", err); }
					finally { setBusy(false); }
				}
				return React.createElement("button", { className: props.inMenu ? "" : "dsh-tavern-choice-trigger", role: props.inMenu ? "menuitem" : undefined, disabled: busy || running, title: resultTitle || "前台使用剧情提示词、后台使用 DSH 内置提示词并联合压缩", onClick: compactContext }, busy ? "压缩中…" : (resultLabel || "压缩上下文"));
			}

			// @include modules/story-ledger.js

			// @include script-navigation.js

        function TavernStorageMigration(props) {
            const [state, setState] = React.useState(null);
            const [error, setError] = React.useState("");
            const [started, setStarted] = React.useState(false);
            const [requestBusy, setRequestBusy] = React.useState(false);
            const [refresh, setRefresh] = React.useState(0);
            React.useEffect(function () {
                let disposed = false, timer;
                async function read() {
                    try {
                        const next = await rpc("getStorageMigration", {}, props.sessionId);
                        if (disposed) return;
                        setState(next); setError("");
                        if (next.phase === "running") timer = setTimeout(read, 1000);
                        else if (next.phase === "completed" && started) liveTavernView.invalidate(props.sessionId);
                    } catch (err) { if (!disposed) setError(String(err.message || err)); }
                }
                read();
                return function () { disposed = true; clearTimeout(timer); };
            }, [props.sessionId, refresh, started]);
            async function migrate() {
                if (requestBusy || state?.phase === "running") return;
                setRequestBusy(true); setError("");
                try {
                    await rpc("migrateStorage", {}, props.sessionId);
                    setStarted(true); setRefresh(value => value + 1);
                } catch (err) { setError(String(err.message || err)); }
                finally { setRequestBusy(false); }
            }
            if (!state && !error || state?.format === "native" && !started) return null;
            const h = React.createElement;
            const busy = requestBusy || state?.phase === "running";
            const complete = state?.format === "native" && state.phase === "completed";
            const stage = {reading:"正在读取旧存档…",converting:"正在转换并读回存档…",verifying:"正在校验并切换存档…"}[state?.stage] || "正在迁移…";
            return h("section", {className:"dsh-tavern-status-section", "aria-label":"存档格式"},
                h("div", {className:"dsh-tavern-status-label"}, "存档格式"),
                h("div", {className:"dsh-tavern-status-empty"}, complete ? "已迁移为新版存档，旧文件和历史版本已保留。" : "本局使用旧格式。迁移后使用新版存储，剧情、变量和历史版本保留。旧文件也会保留，但不包含迁移后的新进度。"),
                busy ? h("div", {role:"status"}, stage + " 大存档可能需要较长时间，暂时不要关闭或重启酒馆。") : null,
                error || state?.phase === "failed" ? h("div", {className:"dsh-card-error",role:"alert"}, error || state.error) : null,
                !state ? h("button", {className:"dsh-tavern-btn",onClick:()=>setRefresh(value=>value+1)}, "重新检查存档格式") :
                !complete ? h("button", {type:"button",className:"dsh-tavern-btn",disabled:busy || props.busy,onClick:migrate}, busy ? "迁移中…" : state.phase === "failed" ? "重试迁移" : "迁移旧存档") : null,
                !busy && props.busy && !complete ? h("div", {className:"dsh-tavern-status-empty"}, "请等待本轮游玩和后台结算完成后再迁移。") : null
            );
        }

			function TavernStatusPanel(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const [error, setError] = usePersistentError("酒馆状态");
			const [guideDraft, setGuideDraft] = React.useState("");
			const guideInputRef = React.useRef(null);
			const [guideBusy, setGuideBusy] = React.useState(false);
            const [guideNotice, setGuideNotice] = React.useState("");
			const [guideError, setGuideError] = usePersistentError("Guide");
			const [debugBusy, setDebugBusy] = React.useState(false);
			const [settlementRetryBusy, setSettlementRetryBusy] = React.useState(false);
			const [cardUpdateBusy, setCardUpdateBusy] = React.useState(false);
            const [cardUpdateError, setCardUpdateError] = React.useState("");
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const stateKey = String(running) + ":" + String(latestMessageId || "");
			const liveState = useLiveTavernView(props.sessionId, stateKey);
			const view = liveState.view;
			const loadState = liveState.phase;
            React.useEffect(function () {
                if (view?.characterDesignTask?.status === "done" && view.characterDesignTask.published?.length) notifyTavernDataChanged(["worldbooks", "cards"], "character-design");
            }, [props.sessionId, JSON.stringify(view?.characterDesignTask?.published || [])]);
			const missingCard = isMissingTavernCardError(liveState.error);
			const debugTurns = view && Array.isArray(view.debugTurns) ? view.debugTurns : [];
			const latestDebugTurn = Number(debugTurns[0] && debugTurns[0].turn) || 0;
			React.useEffect(function () {
				setError(missingCard ? "" : (liveState.error || ""));
			}, [liveState.error, missingCard]);
            const [resourceLinkBusy, setResourceLinkBusy] = React.useState(false);
            const [resourceLinkError, setResourceLinkError] = React.useState("");
            const [resourceBinding, setResourceBinding] = React.useState(null);
            React.useEffect(function () {
                const cardPath = view?.card?.path;
                let active = true, revision = 0;
                setResourceBinding(null); setResourceLinkError("");
                async function refreshBinding() {
                    if (!cardPath) return;
                    const request = ++revision;
                    try {
                        const result = await rpc("getWorldBookBinding", { cardPath }, props.sessionId);
                        if (active && request === revision) setResourceBinding({ cardPath, binding: result.binding });
                    } catch (_) {
                        if (active && request === revision) setResourceBinding({ cardPath, failed: true });
                    }
                }
                function onData(event) { if (tavernDataChangeAffects(event, ["worldbooks", "cards"])) refreshBinding(); }
                refreshBinding();
                window.addEventListener("dsh-tavern-data-changed", onData);
                return () => { active = false; window.removeEventListener("dsh-tavern-data-changed", onData); };
            }, [props.sessionId, view?.card?.path]);
            const currentResourceBinding = resourceBinding?.cardPath === view?.card?.path ? resourceBinding : null;
            const primaryWorldBook = currentResourceBinding?.binding?.books?.[0] || currentResourceBinding?.binding;
            const noWorldBook = currentResourceBinding && !currentResourceBinding.failed && !primaryWorldBook?.source;
            const unavailableWorldBook = primaryWorldBook?.source && !primaryWorldBook.available;
            async function openWorldBookDetail() {
                setResourceLinkBusy(true); setResourceLinkError("");
                try {
                    const result = await rpc("getWorldBookBinding", { cardPath: view.card.path }, props.sessionId);
                    const binding = result.binding?.books?.[0] || result.binding;
                    setResourceBinding({ cardPath: view.card.path, binding: result.binding });
                    if (!binding?.source) { setResourceLinkError("本局人物卡尚未绑定世界书。"); return; }
                    if (!binding.available) { setResourceLinkError("绑定的世界书已不可用，请在人物卡详情中检查绑定。"); return; }
                    props.openStyleTab("dsh-tavern:worldbooks", { worldBookSource: binding.source });
                } catch (err) { setResourceLinkError(String(err && err.message || err)); }
                finally { setResourceLinkBusy(false); }
            }
			async function openDebugger() {
				if (!latestDebugTurn || debugBusy) return;
				setDebugBusy(true);
				try { await openPlayChatDebugWorkspace(props.sessionId, latestDebugTurn); }
				catch (error) { tavernErrorHub.report("交给卡片 Agent 调试", error); }
				finally { setDebugBusy(false); }
			}
			async function addGuide() {
				const text = guideDraft.trim();
				if (!text) return;
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("addGuide", { text: text }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
					setGuideDraft("");
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
            async function saveGuideLibrary() {
                if (guideBusy || !(view.guides || []).length) return;
                const name = await askTavernText({ title: "Guide 方案名称", initialValue: "本局 Guide", maxLength: 80 });
                if (!name) return;
                setGuideBusy(true); setGuideError(""); setGuideNotice("");
                try {
                    await rpc("saveGuideLibrary", { name }, props.sessionId);
                    notifyTavernDataChanged(["guide-library"], "guide-library");
                    setGuideNotice("已保存到Guide 库，本局 Guide保持不变。");
                } catch (err) { setGuideError(String(err.message || err)); }
                finally { setGuideBusy(false); }
            }
			async function removeGuide(guide, index) {
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("deleteGuide", guide.id ? { id: guide.id } : { index, expected: guide }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			async function applyUpdatedCard() {
				if (cardUpdateBusy || !view?.cardUpdate || view.cardUpdate.error) return;
				if (!await askConfirm("加载人物卡和世界书的最新变化？\n\n重新加载会破坏提示词缓存，增加下一轮的 Token 费用和等待时间。")) return;
				setCardUpdateBusy(true); setCardUpdateError("");
				try { await rpc("applyUpdatedCard", { digest: view.cardUpdate.digest }, props.sessionId); liveTavernView.invalidate(props.sessionId); }
				catch (error) { setCardUpdateError(String(error.message || error)); }
				finally { setCardUpdateBusy(false); }
			}
			async function retrySettlement() {
				if (!view || settlementRetryBusy) return;
				setSettlementRetryBusy(true);
				try {
					await rpc("retrySettlement", { turn: view.settlementTurn }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (retryError) { tavernErrorHub.report("重试后台结算", retryError); }
				finally { setSettlementRetryBusy(false); }
			}
			async function designCharacter(initialValue = "") {
                await askTavernText({ title: "设计人物", description: "设计意见（选填）。留空则根据当前剧情和已有档案设计人物。", initialValue, allowEmpty: true, maxLength: 4000, confirmLabel: "开始设计",
                    onSubmit: async guidance => { await rpc("designCharacter", { guidance }, props.sessionId); liveTavernView.invalidate(props.sessionId); }
                });
            }
            React.useEffect(function () {
                if (view?.characterDesignTask?.status !== "running") return;
                const timer = setInterval(() => liveTavernView.invalidate(props.sessionId), 2000);
                return () => clearInterval(timer);
            }, [props.sessionId, view?.characterDesignTask?.status]);
			function characterDesignTime(ts) {
				if (!ts) return "";
				const date = new Date(ts);
				return (date.getMonth() + 1) + "/" + date.getDate() + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
			}
			const h = React.createElement;
			if (!view) return h("aside", { className: "dsh-tavern-status dsh-tavern-status-dashboard" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "状态栏")),
				h("div", { className: "dsh-tavern-status-body" },
					h("div", { className: "dsh-tavern-status-empty" }, missingCard ? "人物卡已删除，酒馆状态不可用；已有对话仍可查看。" : (loadState === "retrying" ? "正在重新连接酒馆状态…" : (error || (loadState === "loading" ? "正在加载酒馆状态…" : "选择人物卡后，这里会显示持续状态。")))),
					loadState === "retrying" || missingCard ? h("button", { className: "dsh-tavern-btn", onClick: function () { liveTavernView.invalidate(props.sessionId); } }, "重新加载") : null
				)
			);
			if (view.mode === "card") return null;
			const statusText = view.settleStatus === "running" ? "正在执行后台结算" : (view.settleStatus === "error" ? "后台结算失败" : "后台结算已完成");
			const cardUpdateNotice = !view.cardUpdate ? "" : view.cardUpdate.error ? "检查更新失败：" + view.cardUpdate.error
				: view.cardUpdate.worldbookSyncRequired || view.cardUpdate.legacy ? "旧存档需同步"
				: view.cardUpdate.cardChanged && view.cardUpdate.worldbookChanged ? "人物卡和世界书有变化"
				: view.cardUpdate.cardChanged ? "人物卡有变化"
				: view.cardUpdate.worldbookChanged ? "世界书有变化" : "";
			return h("aside", { className: "dsh-tavern-status dsh-tavern-status-dashboard" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-role" }, view.card.name),
                    h("nav", { className: "dsh-tavern-status-resource-links", "aria-label": "本局资料" },
                        h("button", { type: "button", disabled: !view.card.path, onClick: () => props.openStyleTab("dsh-tavern:cards", { cardPath: view.card.path }) }, "打开人物卡 ↗"),
                        h("button", { type: "button", disabled: !view.card.path || resourceLinkBusy || !currentResourceBinding || noWorldBook || unavailableWorldBook, title: "打开本局人物卡绑定的世界书；多本绑定时打开主世界书", onClick: openWorldBookDetail }, resourceLinkBusy ? "正在打开…" : !currentResourceBinding ? "正在读取世界书…" : noWorldBook ? "未绑定世界书" : unavailableWorldBook ? "世界书不可用" : "打开世界书 ↗")),
                    resourceLinkError ? h("div", { className: "dsh-card-error", role: "status" }, resourceLinkError) : null,
					(view.card.tags || []).length ? h("div", { className: "dsh-tavern-status-tags" }, (view.card.tags || []).slice(0, 8).map(function (tag) { return h("span", { key: tag, className: "dsh-tavern-status-tag" }, tag); })) : null,
					h("div", { className: "dsh-tavern-status-settle" }, h("span", { className: "dsh-tavern-status-dot " + (view.settleStatus || "idle") }), statusText)
				),
					h("div", { className: "dsh-tavern-status-body" },
                        h(TavernBackgroundWait, {sessionId:props.sessionId, activity:view.activity}),
                        h(TavernStorageMigration, {key:props.sessionId,sessionId:props.sessionId,busy:running || view.activity?.busy || view.settleStatus === "running"}),
					["story", "script"].includes(view.mode || "story") && view.requestMode !== "sillytavern" && view.cardUpdate ? h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-card-reload" },
							h("button", { className: "dsh-tavern-btn" + (cardUpdateNotice ? "" : " quiet"), disabled: running || cardUpdateBusy || !!view.cardUpdate.error || view.settleStatus === "running", onClick: applyUpdatedCard }, cardUpdateBusy ? "正在重新加载人物卡和世界书…" : "重新加载人物卡和世界书"),
							cardUpdateNotice ? h("span", { className: "dsh-tavern-card-reload-notice", role: "status" }, cardUpdateNotice) : null
						),
						cardUpdateError ? h("p", { className: "dsh-card-error", role: "alert" }, "未应用更新：" + cardUpdateError) : null
					) : null,
					h(TavernCardAppDock, { sessionId: props.sessionId }),
					view.settleStatus === "error" ? h("div", { className: "dsh-card-error" },
						h("div", null, view.settleError || "后台结算失败，请重试。"),
						h("button", { className: "dsh-tavern-btn", disabled: settlementRetryBusy, onClick: retrySettlement }, settlementRetryBusy ? "重试中…" : "重试后台结算")
					) : null,
					view.worldBookError ? h("div", { className: "dsh-card-error" }, "世界书召回失败：" + view.worldBookError) : null,
					view.foregroundError ? h("div", { className: "dsh-card-error" }, view.foregroundError.message || "前台正文生成失败，请重新生成本轮正文。") : null,
					view.tavernHelper && view.statusBarPlacement !== "body" ? h("section", { className: "dsh-tavern-status-section" },
						h(TavernPersistentStatusRuntime, { sessionId: props.sessionId, view: view, executeSlash: props.executeSlash })
					) : null,
					(view.presentationWarnings || []).map(function (warning, index) {
						return h("div", { className: "dsh-card-error", key: "presentation-warning-" + index }, warning);
					}),
					h("details", { className: "dsh-tavern-status-section dsh-tavern-status-support" },
                        h("summary", null, "遇到显示或生成问题？"),
                        h("p", { className: "dsh-tavern-settings-desc" }, "正则加载、前端美化或内容生成异常，可交给卡片 Agent 排查。"),
						h("div", { className: "dsh-tavern-debug-panel" },
							h("button", { className: "dsh-tavern-debug-open", disabled: debugBusy || !latestDebugTurn, onClick: openDebugger }, debugBusy ? "正在打开卡片 Agent…" : "交给卡片 Agent 调试")
						)
					),
                    view.mode === "script" && view.scriptProgress ? h(ScriptNavigation, {
                        sessionId: props.sessionId, cursor: view.scriptProgress.cursor, total: view.scriptProgress.totalChunks, chunkSize: view.scriptProgress.chunkSize,
                        busy: running || view.activity?.busy || view.regenInProgress
                    }) : null,
					h("section", { className: "dsh-tavern-status-section dsh-tavern-guide-section" },
						h("div", { className: "dsh-tavern-status-label" }, "Guide", h("span", { className: "dsh-tavern-guide-caption" }, (view.guides || []).length + " 条")),
                        h("p", { className: "dsh-tavern-settings-desc" }, "Guide 是本局持续生效的要求，会同时注入前台（正文）和后台（候选、变量结算），可用来引导剧情走向、文风和数值尺度。"),
                        h("details", { className: "dsh-tavern-guide-destinations" },
                            h("summary", null, "长期偏好与人物设定"),
                            h("div", null, "跨游戏通用的个人喜好，可在长期偏好中设置。", h("button", { type: "button", onClick: () => props.openStyleTab("dsh-tavern:user-profile") }, "打开长期偏好 ↗")),
                            h("div", null, "故事专属设定写入人物卡。", h("button", { type: "button", disabled: !view.card.path, onClick: () => props.openStyleTab("dsh-tavern:cards", { cardPath: view.card.path }) }, "打开人物卡 ↗"))),
						h("div", { className: "dsh-tavern-guide-list" },
							(view.guides || []).length ? (view.guides || []).map(function (guide, index) {
								return h("div", { key: guide.id || index, className: "dsh-tavern-guide-item" },
									h("div", { className: "dsh-tavern-guide-text" }, guide.text),
									h("button", { className: "dsh-tavern-worldbook-del", disabled: guideBusy, onClick: function () { removeGuide(guide, index); } }, "删除")
								);
							}) : h("div", { className: "dsh-tavern-status-empty" }, "暂无 Guide。添加后用于后续剧情和候选项生成，不再需要时请删除。")
						),
						h("div", { className: "dsh-tavern-guide-actions" },
                            h("button", { type: "button", className: "dsh-tavern-btn", onClick: () => props.openStyleTab("dsh-tavern:guide-library") }, "打开 Guide 库 ↗"),
                            h("button", { type: "button", className: "dsh-tavern-btn", disabled: guideBusy || !(view.guides || []).length, onClick: saveGuideLibrary }, "保存到 Guide 库")),
                        guideNotice ? h("p", { role: "status", className: "dsh-tavern-settings-desc" }, guideNotice) : null,
                        h("div", { className: "dsh-tavern-guide-add" },
							h("textarea", { className: "dsh-tavern-regen-input", ref: guideInputRef, rows: 2, maxLength: 2000, value: guideDraft, "aria-label": "新 Guide 内容", placeholder: "例如：这段先放慢节奏，让角色把话说完，暂时不要推进到第二天。", onChange: function (e) { setGuideDraft(e.target.value); } }),
							h("button", { className: "dsh-card-primary", disabled: guideBusy || guideDraft.trim() === "", onClick: addGuide }, guideBusy ? "保存中…" : "添加 Guide")
						),
						guideError ? h("div", { className: "dsh-card-error" }, guideError) : null
					),
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-character-design-head" },
                            h("div", { className: "dsh-tavern-status-label" }, "人物设计档案（" + ((view.characterDesigns && view.characterDesigns.characters || []).length) + "）"),
                            h("button", { className: "dsh-tavern-btn", disabled: running || view.activity?.busy || view.characterDesignTask?.status === "running", onClick: () => designCharacter(view.characterDesignTask?.status === "failed" ? view.characterDesignTask.guidance : "") }, view.characterDesignTask?.status === "running" ? "设计中…" : view.characterDesignTask?.status === "failed" ? "重试设计" : "设计人物")),
                        view.characterDesignTask?.status === "failed" ? h("div", { className: "dsh-card-error", role: "alert" }, view.characterDesignTask.error) : null,
                        view.characterDesignTask?.status === "done" && view.characterDesignTask.published?.length ? h("div", { className: "dsh-tavern-status-empty", role: "status" }, "已写入世界书并同步到本局：" + view.characterDesignTask.published.join("、") + "。下一轮正文会带上这些档案。") : null,
                        view.characterDesignTask?.status === "done" && view.characterDesignTask.reused?.length ? h("div", { className: "dsh-tavern-status-empty", role: "status" }, "已复用本局世界书：" + view.characterDesignTask.reused.join("、") + "，未重复建立档案。") : null,
						h("div", { className: "dsh-tavern-character-designs" },
							(view.characterDesigns && view.characterDesigns.characters || []).length ? view.characterDesigns.characters.map(function (character, index) {
								const summary = character.identity || character.narrativeRole || "已建立完整人物设计";
								const aliases = Array.isArray(character.aliases) && character.aliases.length ? character.aliases.join("、") : "";
								return h(TavernLazyDetails, { key: character.name || index, className: "dsh-tavern-character-design",
									summary: h("summary", null,
										h("span", null,
											h("span", { className: "dsh-tavern-character-design-name" }, character.name),
											h("span", { className: "dsh-tavern-character-design-summary", title: summary }, summary)
									),
									character.updatedAt ? h("time", { className: "dsh-tavern-character-design-meta", dateTime: new Date(character.updatedAt).toISOString() }, characterDesignTime(character.updatedAt)) : h("span", { className: "dsh-tavern-character-design-meta" }, "查看")
								),
									render: function () { return h("div", { className: "dsh-tavern-character-design-body" },
										aliases ? h("div", { className: "dsh-tavern-character-design-row" }, h("b", null, "别名"), h("p", null, aliases)) : null,
										(character.sections || []).map(function (section) {
											return h("div", { key: section.key, className: "dsh-tavern-character-design-row" }, h("b", null, section.label), h("p", null, section.text));
										})
									); }
								});
							}) : h("div", { className: "dsh-tavern-status-empty" }, "点击“设计人物”，按你的要求创建或补充档案。")
						)
					),
					h(TavernLedger, { sessionId: props.sessionId, ledger: view.ledger, ledgerTask: view.ledgerTask, busy: running || view.activity?.busy }),
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "人物姿势"),
						view.posture ? h("div", { className: "dsh-tavern-status-now" }, view.posture) : h("div", { className: "dsh-tavern-status-empty" }, "等待第一轮状态结算")
					)

				)
			);
		}

		function TavernCardAppDock(props) {
			const slotRef = React.useRef(null);
			const controllerRef = React.useRef(null);
			const presence = React.useSyncExternalStore(tavernCardAppPresence.subscribe, tavernCardAppPresence.inspect);
			React.useEffect(function () {
				if (!slotRef.current) return;
				const controller = createTavernCardAppDock({ document: document, slot: slotRef.current, sessionId: props.sessionId, onChange: tavernCardAppPresence.change });
				controllerRef.current = controller;
				return function () { controllerRef.current = null; controller.dispose(); };
			}, []);
			return React.createElement("section", { className: "dsh-tavern-status-section dsh-tavern-card-app-section", hidden: !presence.attached },
				React.createElement("div", { className: "dsh-tavern-card-app-head" },
					React.createElement("div", { className: "dsh-tavern-status-label" }, "人物卡应用"),
					React.createElement("button", { className: "dsh-tavern-btn", disabled: !presence.attached, onClick: function () { if (controllerRef.current) controllerRef.current.open(); } }, presence.attached ? "打开手机" : "恢复中…")
				),
				presence.recovering ? React.createElement("div", { className: "dsh-tavern-card-app-recovering", role: "status" }, "正在恢复人物卡应用…") : null,
				React.createElement("div", { ref: slotRef, className: "dsh-tavern-card-app-slot" })
			);
		}

		function TavernStatusTab(props) {
			const binding = React.useSyncExternalStore(
				function (listener) { return props.sessions.list.subscribe(listener); },
				function () { return props.sessions.binding(props.sessionId); },
				function () { return props.sessions.binding(props.sessionId); }
			);
			const h = React.createElement;
			if (!binding) return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "酒馆状态")),
				h("div", { className: "dsh-tavern-status-body" }, h("div", { className: "dsh-tavern-status-empty" }, "正在连接当前会话…"))
			);
			function useSession(selector) {
				return React.useSyncExternalStore(
					function (listener) { return binding.session.subscribe(listener); },
					function () { return selector(binding.session.getSnapshot()); },
					function () { return selector(binding.session.getSnapshot()); }
				);
			}
			const chat = resolveConversationChatBinding(props.uiConversation, binding);
			function useChat(selector) {
				return React.useSyncExternalStore(
					function (listener) { return chat.subscribe(listener); },
					function () { return selector(chat.getSnapshot()); },
					function () { return selector(chat.getSnapshot()); }
				);
			}
			return h(TavernStatusPanel, { sessionId: props.sessionId, useSession: useSession, useChat: useChat, executeSlash: props.executeSlash, openStyleTab: props.openStyleTab });
		}

		const candidatePanel = { value: null, listeners: new Set() };
		function setCandidatePanel(value) {
            if (value) {
                const previous = candidatePanel.value;
                const sameChoices = previous && previous.sessionId === value.sessionId && previous.messageId === value.messageId && previous.phase === value.phase && JSON.stringify(previous.choices) === JSON.stringify(value.choices);
                value = Object.assign({}, value, { expanded: value.expanded ?? (sameChoices ? previous.expanded : value.phase === "error") });
            }
			candidatePanel.value = value;
			candidatePanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useCandidatePanel() {
			return React.useSyncExternalStore(subscribeCandidatePanel, candidatePanelSnapshot, candidatePanelSnapshot);
		}
		function subscribeCandidatePanel(listener) {
			candidatePanel.listeners.add(listener);
			return function () { candidatePanel.listeners.delete(listener); };
		}
		function candidatePanelSnapshot() { return candidatePanel.value; }
		function readyCandidatePanel(sessionId, messageId, candidates) {
			const value = candidates && typeof candidates === "object" ? candidates : {};
			return {
				sessionId: sessionId,
				messageId: messageId,
				phase: "ready",
				choices: Array.isArray(value.choices) ? value.choices : [],
				traceSessionId: String(value.traceSessionId || ""),
				traceMode: value.traceMode === "continuable" ? "continuable" : "one-shot",
				error: ""
			};
		}
		function candidateRequestId() { return "candidate-request-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
		async function submitCandidateTask(sessionId, messageId, guidance) {
			const requestId = candidateRequestId();
			let lastError = null;
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const controller = new AbortController();
				const timer = window.setTimeout(function () { controller.abort(); }, 2000);
				try {
					const result = await rpc("submitTask", { kind: "candidate", requestId: requestId, messageId: messageId, guidance: guidance || "" }, sessionId, { signal: controller.signal });
					const view = coordinationView(result, sessionId);
					tavernCoordination.setView(sessionId, view);
					return view.task;
				} catch (error) {
					lastError = error;
					const message = String(error && error.message || "");
					if (!(error && error.name === "AbortError") && !/failed to fetch|networkerror|signal timed out/i.test(message)) throw error;
				} finally { window.clearTimeout(timer); }
				await new Promise(function (resolve) { window.setTimeout(resolve, 250); });
			}
			tavernCoordination.invalidate(sessionId);
			throw lastError || new Error("持久任务提交失败");
		}

		const regenPanel = { value: null, listeners: new Set() };
		function setRegenPanel(value) {
			regenPanel.value = value;
			regenPanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useRegenPanel() {
			const [value, setValue] = React.useState(regenPanel.value);
			React.useEffect(function () { regenPanel.listeners.add(setValue); return function () { regenPanel.listeners.delete(setValue); }; }, []);
			return value;
		}

		const candidateGuidePanel = { value: null, listeners: new Set() };
		function setCandidateGuidePanel(value) {
			candidateGuidePanel.value = value;
			candidateGuidePanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useCandidateGuidePanel() {
			const [value, setValue] = React.useState(candidateGuidePanel.value);
			React.useEffect(function () { candidateGuidePanel.listeners.add(setValue); return function () { candidateGuidePanel.listeners.delete(setValue); }; }, []);
			return value;
		}

		async function submitBodyRegeneration(sessionId, panel, guidance) {
			const res = await rpc("regenBody", { guidance: String(guidance || "").trim() }, sessionId);
			applyBodyRegenerationResult({ liveTavernView: liveTavernView, historyProjection: historyProjection, sessionId: sessionId, view: res.view, tail: panel.tail });
			setCandidatePanel(null);
		}

		// A failed turn never committed a story round, so recovering it is not a
		// rollback: remove the interrupted reply and resend the same input, which
		// lets the provider reuse the cached prompt prefix.
		async function submitFailedTurnReplay(sessionId) {
			const res = await rpc("replayTurn", {}, sessionId);
			applyBodyRegenerationResult({ liveTavernView: liveTavernView, historyProjection: historyProjection, sessionId: sessionId, view: res.view, tail: null });
			setRegenPanel(null);
			setCandidatePanel(null);
			setCandidateGuidePanel(null);
			notifyTavernDataChanged(["sessions"], "play-controls");
			tavernCoordination.invalidate(sessionId);
			return res;
		}

		function CandidateAction(props) {
			const [busy, setBusy] = React.useState(false);
			const candidatePanelState = useCandidatePanel();
			const regenPanelState = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const frontRunning = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const rollbackViewState = useLiveTavernView(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activityState = useTavernCoordination(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activity = describeTavernActivity(activityState.view && activityState.view.activity);
			const settlementActive = activity.role === "settlement" && (activity.phase === "pending" || activity.phase === "running");
			const canRollback = rollbackViewState.view && (rollbackViewState.view.canRegenerate ?? rollbackViewState.view.canRollback) === true;
            const clearIncomplete = rollbackViewState.view && rollbackViewState.view.canClearIncompleteReply === true;
			const canReplayFailed = rollbackViewState.view && rollbackViewState.view.canReplayFailedTurn === true;
			const candidateTask = activityState.view && activityState.view.task;
			const taskForMessage = candidateTask && candidateTask.kind === "candidate" && candidateTask.input && String(candidateTask.input.messageId || "") === String(props.messageId || "") ? candidateTask : null;
			const taskBusy = !!(taskForMessage && taskForMessage.busy);
			const regenBusy = regenPanelState !== null && regenPanelState.sessionId === props.sessionId && regenPanelState.phase === "loading";
			const [replayBusy, setReplayBusy] = React.useState(false);
			const projectedTaskRef = React.useRef("");
			React.useEffect(function () {
				if (!taskForMessage) return;
				const projection = String(taskForMessage.taskId || "") + ":" + String(taskForMessage.version || 0) + ":" + String(taskForMessage.status || "");
				if (projectedTaskRef.current === projection) return;
				projectedTaskRef.current = projection;
				if (taskForMessage.busy) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
					return;
				}
				if (taskForMessage.status === "succeeded" && taskForMessage.result && taskForMessage.result.candidates) {
					setCandidatePanel(readyCandidatePanel(props.sessionId, props.messageId, taskForMessage.result.candidates));
					setCandidateGuidePanel(null);
					return;
				}
				if (taskForMessage.terminal) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(taskForMessage.error || "候选生成未完成") });
				}
			}, [props.sessionId, props.messageId, taskForMessage && taskForMessage.taskId, taskForMessage && taskForMessage.version, taskForMessage && taskForMessage.status]);
			const reconciledActivityRef = React.useRef("");
			React.useEffect(function () {
				if (!activityState.view || activity.busy) return;
				const revision = activity.phase + ":" + String(activityState.view.updatedAt || 0);
				if (reconciledActivityRef.current === revision) return;
				reconciledActivityRef.current = revision;
				// The host list stream already carries running/activity/blank changes; a full
				// session.list rescans every stored Session and cost seconds per turn.
				liveTavernView.invalidate(props.sessionId);
			}, [props.sessionId, activity.phase, activity.busy, activityState.view && activityState.view.updatedAt]);
			async function generate(force, guidance) {
				if (busy || activity.busy) return;
				setBusy(true);
				setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
				try {
					await submitCandidateTask(props.sessionId, props.messageId, guidance);
				} catch (err) { tavernErrorHub.report("候选项生成", err); setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(err && err.message || err) }); }
				finally { setBusy(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
			}
			function regenerationPanelFor(event, phase) {
				const tail = event && event.currentTarget ? event.currentTarget.closest('[data-chat-flow-kind="turn-tail"]') : null;
				return { sessionId: props.sessionId, phase: phase, guidance: "", text: "", error: "", tail: tail };
			}
			function openRegeneration(event) {
				if (!canRollback || frontRunning || (activity.busy && !settlementActive) || regenBusy) return;
				setCandidatePanel(null);
				setRegenPanel(regenerationPanelFor(event, "input"));
			}
			// A failed tail has nothing to replace: one click clears the
			// interrupted reply and replays the same request, so no guidance box.
			async function replayFailed() {
				if (!canReplayFailed || frontRunning || replayBusy) return;
				setReplayBusy(true);
				try { await submitFailedTurnReplay(props.sessionId); }
				catch (err) { tavernErrorHub.report("重新生成本轮", err); }
				finally { setReplayBusy(false); liveTavernView.invalidate(props.sessionId); }
			}
			const h = React.createElement;
			const isScript = sessionMode === "script";
			const hasReadyPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "ready";
			if (!isPlayMode(sessionMode) || latestMessageId !== props.messageId) return null;
			return h(React.Fragment, null,
				h("button", { className: "dsh-tavern-choice-trigger", disabled: busy || taskBusy || activity.busy || settlementActive || regenBusy, title: settlementActive ? "当前正文正在后台结算，请等待完成" : (activity.busy ? activity.blockReason : (hasReadyPanel ? "重新生成候选项（可先填写意见）" : (isScript ? "手动生成候选项；由于跟随剧本，只有一个推荐候选项" : "手动生成候选项"))), onClick: function () {
					setRegenPanel(null);
					if (hasReadyPanel) {
						const previous = candidatePanelState;
						setCandidatePanel(null);
						setCandidateGuidePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "input", error: "", previous: previous });
					} else {
						generate(false);
					}
				} }, settlementActive ? "后台结算中…" : (activity.busy ? activity.label : ((busy || taskBusy) ? "生成中…" : (hasReadyPanel ? "重新生成候选项" : "生成候选项")))),
				(canReplayFailed || canRollback) ? h("button", { className: "dsh-tavern-choice-trigger", disabled: frontRunning || (!canReplayFailed && activity.busy && !settlementActive) || regenBusy || replayBusy, title: canReplayFailed ? "移除被中断的回复并原样重放本轮请求（复用模型缓存）" : (settlementActive ? "重新生成将取消当前正文的后台结算" : (activity.busy ? activity.blockReason : "可选择填写意见，再重新生成并替换当前正文")), onClick: canReplayFailed ? replayFailed : openRegeneration }, replayBusy ? "重放中…" : regenBusy ? "重生成中…" : canReplayFailed ? "重新生成本轮" : "重新生成正文") : null
			);
		}

		function TavernRollbackAction(props) {
			const [rolling, setRolling] = React.useState(false);
			const regenPanelState = useRegenPanel();
			const frontRunning = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const rollbackViewState = useLiveTavernView(props.sessionId, "rollback:" + String(frontRunning) + ":" + String(latestMessageId || ""));
			const activityState = useTavernCoordination(props.sessionId, "rollback:" + String(frontRunning) + ":" + String(latestMessageId || ""));
			const activity = describeTavernActivity(activityState.view && activityState.view.activity);
			const settlementActive = activity.role === "settlement" && (activity.phase === "pending" || activity.phase === "running");
			const canRollback = rollbackViewState.view && rollbackViewState.view.canRollback === true;
            const clearIncomplete = rollbackViewState.view && rollbackViewState.view.canClearIncompleteReply === true;
			const regenBusy = regenPanelState !== null && regenPanelState.sessionId === props.sessionId && regenPanelState.phase === "loading";
			const targetTurn = Number(rollbackViewState.view && rollbackViewState.view.rollbackTargetTurn) || 0;
            const targetLabel = targetTurn > 0 ? "回退第 " + targetTurn + " 轮" : "回退本轮";
			const blocked = rolling || frontRunning || regenBusy || activity.busy || settlementActive;
			async function rollback() {
				if (!canRollback || blocked) return;
				setRolling(true);
				try {
					const result = await rpc("rollbackTurn", { expectedTurn: clearIncomplete ? null : targetTurn }, props.sessionId);
					historyProjection.rolledBack(props.sessionId, result && result.view);
					setCandidatePanel(null);
					setRegenPanel(null);
					setCandidateGuidePanel(null);
					notifyTavernDataChanged(["sessions"], "play-controls");
					if (result && result.view && result.view.rollbackWarning) tavernErrorHub.report("回退提示", new Error(result.view.rollbackWarning));
				} catch (err) {
					tavernErrorHub.report("回退本轮", err);
				} finally { setRolling(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
			}
			if (!canRollback) {
                // While a reply is streaming, the surface has no settled target yet; the
                // server's "not in the message stream" reason would wrongly read as permanent.
                const reason = blocked && !rolling ? "正在生成或后台处理中，完成或停止后才能回退" : rollbackViewState.view && rollbackViewState.view.rollbackUnavailableReason;
                return reason ? React.createElement("button", { type: "button", role: "menuitem", disabled: true, className: "dsh-tavern-menu-unavailable", title: reason },
                    React.createElement("span", null, "回退本轮"),
                    React.createElement("small", null, reason.includes("没有可回退") ? "暂无可回退轮次" : reason)) : null;
            }
			return React.createElement("button", { className: "danger", role: "menuitem", disabled: blocked, title: blocked ? "请等待当前生成或后台处理完成后再回退" : clearIncomplete ? "清除未完成回复，保留已完成剧情" : "删除最近一次用户输入和这段 LLM 输出", onClick: rollback }, rolling ? "处理中…" : clearIncomplete ? "清除未完成回复" : targetLabel);
		}

        function TavernUndoRollbackAction(props) {
            const [busy, setBusy] = React.useState(false);
            const running = props.useSession(function (state) { return state.running === true; });
            const live = useLiveTavernView(props.sessionId, "undo:" + String(running));
            const turn = Number(live.view && live.view.undoRollbackTurn) || 0;
            if (!turn) return null;
            async function undo() {
                if (busy || running) return;
                setBusy(true);
                try {
                    const result = await rpc("undoRollbackTurn", {}, props.sessionId);
                    historyProjection.restored(props.sessionId, result && result.view);
                    setCandidatePanel(null); setRegenPanel(null); setCandidateGuidePanel(null);
                    notifyTavernDataChanged(["sessions"], "play-controls");
                } catch (error) { tavernErrorHub.report("撤销回退", error); }
                finally { setBusy(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
            }
            return React.createElement("button", { role: "menuitem", disabled: busy || running, onClick: undo,
                title: "恢复第 " + turn + " 轮正文和状态；新的操作会使此恢复点失效" }, busy ? "恢复中…" : "撤销回退（恢复第 " + turn + " 轮）");
        }

		const bodyEditPanel = { value: null, listeners: new Set() };
		function setBodyEditPanel(value) {
			bodyEditPanel.value = value;
			bodyEditPanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useBodyEditPanel() {
			const [value, setValue] = React.useState(bodyEditPanel.value);
			React.useEffect(function () { bodyEditPanel.listeners.add(setValue); return function () { bodyEditPanel.listeners.delete(setValue); }; }, []);
			return value;
		}
		function TavernEditBodyAction(props) {
			const [busy, setBusy] = React.useState(false);
			const running = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const live = useLiveTavernView(props.sessionId, "edit:" + String(running) + ":" + String(latestMessageId));
			const coordination = useTavernCoordination(props.sessionId, String(running));
			const activity = describeTavernActivity(coordination.view && coordination.view.activity);
			async function openEditor() {
				setBusy(true);
				try {
					const result = await rpc("getBodyEdit", {}, props.sessionId);
					setRegenPanel(null); setCandidatePanel(null); setCandidateGuidePanel(null);
					setBodyEditPanel({ sessionId: props.sessionId, edit: result.edit, texts: result.edit.parts.filter(function (part) { return part.kind === "text"; }).map(function (part) { return part.text; }), busy: false, error: "" });
				} catch (error) { tavernErrorHub.report("编辑正文", error); }
				finally { setBusy(false); }
			}
			if (!live.view || !(live.view.canEditBody ?? live.view.canRollback)) return null;
			return React.createElement("button", { role: "menuitem", disabled: busy || running || activity.busy, onClick: openEditor }, busy ? "读取中…" : "编辑正文");
		}
		function BodyEditPanel(props) {
			const panel = useBodyEditPanel();
			const running = props.useSession(function (snapshot) { return snapshot.running === true; });
			const h = React.createElement;
			if (!panel || panel.sessionId !== props.sessionId) return null;
			async function save() {
				setBodyEditPanel(Object.assign({}, panel, { busy: true, error: "" }));
				try {
					const result = await rpc("saveBodyEdit", { token: panel.edit.token, texts: panel.texts }, props.sessionId);
					liveTavernView.setView(props.sessionId, result.view);
					notifyTavernDataChanged(["sessions"], "play-controls");
					tavernCoordination.invalidate(props.sessionId);
					setBodyEditPanel(null);
				} catch (error) { setBodyEditPanel(Object.assign({}, panel, { busy: false, error: String(error.message || error) })); }
			}
			let textIndex = 0;
			return h("div", { className: "dsh-tavern-question", role: "region", "aria-label": "编辑正文" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "编辑正文")),
				panel.error ? h("div", { className: "dsh-tavern-choice-error", role: "alert" }, panel.error) : null,
				h("div", { style: { maxHeight: "50vh", overflowY: "auto" } }, panel.edit.parts.map(function (part, index) {
					if (part.kind === "html") return h("div", { key: index, className: "dsh-tavern-question-sub" }, "HTML 内容保持原样");
					if (part.kind !== "text") return null;
					const current = textIndex++;
					return h("textarea", { key: index, className: "dsh-tavern-regen-input", "aria-label": "正文文本 " + (current + 1), rows: Math.min(12, Math.max(3, panel.texts[current].split("\n").length)), value: panel.texts[current], disabled: panel.busy, onChange: function (event) {
						const texts = panel.texts.slice(); texts[current] = event.target.value;
						setBodyEditPanel(Object.assign({}, panel, { texts: texts }));
					} });
				})),
				h("div", { className: "dsh-tavern-question-foot" },
					h("button", { className: "dsh-tavern-question-primary", disabled: panel.busy || running, onClick: save }, panel.busy ? "保存中…" : "保存"),
					h("button", { className: "dsh-tavern-question-free", disabled: panel.busy, onClick: function () { setBodyEditPanel(null); } }, "取消")));
		}

        // @include modules/background-wait.js

		function TavernStopBackgroundAction(props) {
			const [busy, setBusy] = React.useState(false);
			const state = useTavernCoordination(props.sessionId);
			const activity = state.view && state.view.activity;
			if (!activity || (!activity.busy && activity.phase !== "pending")) return null;
			async function stop() {
				if (busy) return;
				setBusy(true);
				try {
					await rpc("stopBackground", { operationId: activity.operationId }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
					tavernCoordination.invalidate(props.sessionId);
				} catch (error) { tavernErrorHub.report("停止后台", error); }
				finally { setBusy(false); }
			}
			return React.createElement("button", { type: "button", className: "dsh-tavern-choice-trigger", role: props.inMenu ? "menuitem" : undefined, disabled: busy, onClick: stop }, busy ? "正在停止…" : "停止后台");
		}

        function TavernConversationPreset(props) {
            const h = React.createElement;
            const [data, setData] = React.useState(null);
            const [error, setError] = React.useState("");
            const [busy, setBusy] = React.useState(false);
            const [notice, setNotice] = React.useState("");
            async function refresh() {
                const [catalog, session] = await Promise.all([rpc("listPresets", {}, props.sessionId), rpc("getSession", {}, props.sessionId)]);
                setData({ presets: catalog.presets || [], current: session.view?.runtimePreset });
            }
            React.useEffect(() => { refresh().catch(err => setError(String(err.message || err))); }, []);
            async function change(path) {
                setBusy(true); setError(""); setNotice("");
                try { await rpc("applyConversationPreset", { sessionId: props.sessionId, path }, props.sessionId); await refresh(); setNotice("已保存"); liveTavernView.invalidate(props.sessionId); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
                catch (err) { setError(String(err.message || err)); }
                finally { setBusy(false); }
            }
            return h("div", { className: "dsh-local-field" }, h("label", null, "当前预设", h("select", { className: "dsh-tavern-settings-select", "aria-label": "本局预设", value: data?.current?.id || "", disabled: busy || !data, onChange: event => change(event.target.value) },
                h("option", { value: "" }, "不使用外部预设"),
                data?.current?.id && !data.presets.some(p => p.path === data.current.id) ? h("option", { value: data.current.id }, data.current.name + "（源文件已移除）") : null,
                (data?.presets || []).filter(p => p.valid && p.recognized).map(p => h("option", { key: p.path, value: p.path }, p.title)))),
                h("p", { className: "dsh-tavern-settings-desc" }, "用于后续正文，选择后自动保存。"), error ? h("p", { role: "alert" }, "保存失败：" + error) : h("span", { role: "status", className: "dsh-local-feedback" }, busy ? "保存中…" : notice));
        }

        function TavernLocalPlayerName(props) {
            const [name, setName] = React.useState(null), [busy, setBusy] = React.useState(false), [status, setStatus] = React.useState("");
            React.useEffect(() => { let active = true; rpc("getSession", {}, props.sessionId).then(result => { if (active) setName(result.view?.playerName || "你"); }, err => { if (active) setStatus("读取失败：" + err.message); }); return () => { active = false; }; }, []);
            async function save(value) {
                if (busy || value === name) return;
                setBusy(true); setStatus("保存中…");
                try { const result = await rpc("setPlayerName", { userName: value }, props.sessionId); setName(result.playerName || "你"); setStatus("已保存"); liveTavernView.invalidate(props.sessionId); notifyTavernDataChanged(["sessions"], "play-controls"); }
                catch (err) { setStatus("保存失败：" + err.message); }
                finally { setBusy(false); }
            }
            return React.createElement("div", { className: "dsh-local-field" },
                React.createElement("label", null, "玩家称呼", React.createElement("input", { key: name, defaultValue: name || "", placeholder: "你", maxLength: 80, disabled: name === null || busy, onBlur: event => save(event.target.value), onKeyDown: event => { if (event.key === "Enter" && !event.nativeEvent?.isComposing && event.nativeEvent?.keyCode !== 229) event.currentTarget.blur(); } })),
                React.createElement("p", { className: "dsh-local-help" }, "离开输入框后保存，仅用于后续内容。"), React.createElement("span", { role: "status", className: "dsh-local-feedback" }, status));
        }

        function TavernStatusBarSetting(props) {
            const h = React.createElement;
            const state = useLiveTavernView(props.sessionId, "status-bar-setting");
            const [busy, setBusy] = React.useState(false);
            const [error, setError] = React.useState("");
            async function change(placement) {
                setBusy(true); setError("");
                try {
                    await rpc("setStatusBarPlacement", { placement: placement }, props.sessionId);
                    liveTavernView.invalidate(props.sessionId);
                } catch (err) { setError(String(err.message || err)); }
                finally { setBusy(false); }
            }
            return h("div", { className: "dsh-local-field" },
                h("label", null, "状态栏位置", h("select", { className: "dsh-tavern-settings-select", "aria-label": "状态栏位置",
                    value: state.view?.statusBarPlacement || "sidebar", disabled: busy || !state.view, onChange: event => change(event.target.value) },
                    h("option", { value: "sidebar" }, "侧边栏"), h("option", { value: "body" }, "正文下方"))),
                error ? h("p", { role: "alert" }, "保存失败：" + error) : null);
        }

        function TavernConversationSettingsTab(props) {
            const h = React.createElement;
            const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
            const mode = useTavernSessionMode(owner);
            return h("aside", { className: "dsh-tavern-status dsh-local-settings", "aria-label": "本局设置" },
                h("div", { className: "dsh-tavern-status-head" }, h("strong", null, "本局设置")),
                h("div", { className: "dsh-tavern-status-body" }, isPlayMode(mode) ? h(React.Fragment, null,
                    h("p", { className: "dsh-local-intro" }, "仅影响本局，修改后自动保存。已有对话和变量会保留。"),
                    h("section", { className: "dsh-local-section" }, h("h3", null, "基本信息"),
                        h(TavernLocalPlayerName, { key: owner + ":name", sessionId: owner }),
                        h(TavernStatusBarSetting, { key: owner + ":status", sessionId: owner }),
                        h(TavernConversationPreset, { key: owner + ":preset", sessionId: owner }),
                        h(UserPreferenceProfileTab, { key: owner + ":profile", scope: { sessionId: owner }, conversationOnly: true }),
                        h("p", { className: "dsh-local-warning" }, "切换预设或长期偏好会使提示词缓存失效，首次请求会增加耗时和费用。")),
                    h(TavernConversationBackgroundModel, { key: owner, sessionId: owner }), h(TavernConversationWritingSkills, { key: owner + ":skills", sessionId: owner })) : h("p", null, "请选择一个游玩对话。")));
        }

        function TavernConversationSettingsAction(props) {
            const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
            const mode = useTavernSessionMode(owner);
            if (!isPlayMode(mode)) return null;
            return React.createElement("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-header-settings", "aria-label": "酒馆状态", title: "查看本局酒馆状态", onClick: () => props.open(owner) },
                React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": "true" },
                    React.createElement("path", { d: "M4 7h3m4 0h9M4 17h9m4 0h3" }),
                    React.createElement("circle", { cx: 9, cy: 7, r: 2 }), React.createElement("circle", { cx: 15, cy: 17, r: 2 })),
                React.createElement("span", { className: "dsh-tavern-header-action-label" }, "酒馆状态"));
        }

        function TavernConversationBackgroundModel(props) {
            const h = React.createElement;
            const [catalog, setCatalog] = React.useState([]);
            const [selection, setSelection] = React.useState(null);
            const [tasks, setTasks] = React.useState({ variables: true, posture: true, characterDesign: false, variableFeedback: true });
            const [saved, setSaved] = React.useState(null);
            const [features, setFeatures] = React.useState({ webSearchEnabled: false, sceneImagesEnabled: false, sceneImagesAvailable: false });
            const [loaded, setLoaded] = React.useState(false);
            const [busy, setBusy] = React.useState(false);
            const [error, setError] = React.useState("");
            const [notice, setNotice] = React.useState("");
            const [reasoning, setReasoning] = React.useState({ key: "", value: null, error: "" });
            const key = selection ? JSON.stringify({ provider: selection.provider, model: selection.model }) : "";
            async function load() {
                setError("");
                try {
                    const result = await rpc("getConversationBackgroundConfig", { sessionId: props.sessionId }, props.sessionId);
                    setCatalog(result.modelCatalog || []); setSelection(result.backgroundModel); setSaved(result.backgroundModel);
                    setTasks(result.backgroundTasks); setFeatures({ webSearchEnabled: result.webSearchEnabled === true, sceneImagesEnabled: result.sceneImagesEnabled === true, sceneImagesAvailable: result.sceneImagesAvailable === true }); setLoaded(true);
                } catch (err) { setError(String(err.message || err)); }
            }
            React.useEffect(() => { void load(); }, []);
            React.useEffect(() => {
                let active = true;
                if (key) rpc("getBackgroundModelReasoning", JSON.parse(key), props.sessionId).then(result => {
                    if (active) setReasoning({ key, value: result.reasoning, error: "" });
                }, err => { if (active) setReasoning({ key, value: null, error: String(err.message || err) }); });
                return () => { active = false; };
            }, [key]);
            async function save(patch) {
                if (busy || !loaded) return;
                setBusy(true); setError(""); setNotice("");
                try {
                    const result = await rpc("setConversationBackgroundConfig", Object.assign({ sessionId: props.sessionId, backgroundModel: selection }, patch), props.sessionId);
                    setSaved(result.backgroundModel); setSelection(result.backgroundModel); setTasks(result.backgroundTasks); setFeatures({ ...features, webSearchEnabled: result.webSearchEnabled, sceneImagesEnabled: result.sceneImagesEnabled });
                    setNotice("已保存");
                    window.dispatchEvent(new CustomEvent("dsh-tavern-image-settings-changed"));
                    liveTavernView.invalidate(props.sessionId);
                } catch (err) { setError(String(err.message || err)); }
                finally { setBusy(false); }
            }
            const efforts = reasoning.key === key ? reasoning.value?.efforts || [] : [];
            const known = !selection || catalog.some(group => group.provider === selection.provider && group.models.some(model => model.id === selection.model));
            return h("div", { className: "dsh-local-runtime" },
                h("section", { className: "dsh-local-section" }, h("h3", null, "后台模型"),
                    h("p", { className: "dsh-tavern-settings-desc" }, "仅影响本局，下一次后台任务生效。正在运行的任务不变，保留原后台 Agent 和历史。"),
                    h("p", { className: "dsh-tavern-settings-desc" }, "建议前台和后台使用 High 推理强度，优先保证正文输出和后台任务的质量。不推荐 Max，以免过度思考、增加等待。若更在意响应速度，可按需降低。"),
                    h("p", { className: "dsh-local-warning" }, "切换模型或推理强度会使缓存失效，首次请求会增加耗时和费用。"),
                    h("label", null, "后台模型", h("select", { "aria-label": "本局后台模型", className: "dsh-tavern-settings-select", value: key, disabled: !loaded || busy, onChange: event => { return save({ backgroundModel: event.target.value ? JSON.parse(event.target.value) : null }); } },
                        h("option", { value: "" }, "跟随前台"),
                        !known ? h("option", { value: key }, backgroundModelLabel(selection, catalog) + "（当前不可用）") : null,
                        catalog.map(group => h("optgroup", { key: group.provider, label: group.providerName || group.provider }, group.models.map(model => h("option", { key: model.id, value: JSON.stringify({ provider: group.provider, model: model.id }) }, model.name || model.id)))))),
                    h("label", null, "推理强度", h("select", { "aria-label": "本局后台推理强度", className: "dsh-tavern-settings-select", value: selection?.reasoningEffort || "", disabled: !key || !efforts.length || busy, onChange: event => { const next = { ...selection }; if (event.target.value) next.reasoningEffort = event.target.value; else delete next.reasoningEffort; return save({ backgroundModel: next }); } },
                        h("option", { value: "" }, key ? "模型默认" : "跟随前台"), efforts.map(item => h("option", { key: item.id, value: item.id }, item.name || item.id)))),
                    ), h("section", { className: "dsh-local-section" }, h("h3", null, "后台结算"), h("p", { className: "dsh-local-help" }, "从下一次后台任务生效，正在运行的任务不变。"),
                    [["variables", "变量结算", "MVU 卡建议开启，否则变量和状态栏可能不再同步。普通卡不执行此任务。"], ["posture", "人物姿势结算", "总结本轮结束时人物的位置、动作和姿势。"], ["variableFeedback", "变量回灌前台", "每轮把上一轮变化的变量最新值告诉前台（单项最多 100 字），减少时间、地点、数值前后不一致。"]].map(([name, title, description]) => h("label", { key: name, className: "dsh-tavern-background-task" },
                        h("span", null, title, h("span", { className: "dsh-tavern-settings-desc" }, description)),
                        h("input", { type: "checkbox", role: "switch", "aria-label": title, checked: tasks[name], disabled: !loaded || busy, onChange: event => { return save({ backgroundTasks: { [name]: event.target.checked } }); } }))),
                    h("p", { className: "dsh-local-warning" }, "调整结算任务会使缓存失效，首次请求会增加耗时和费用。")), h("section", { className: "dsh-local-section" }, h("h3", null, "扩展功能"),
                    [["webSearchEnabled", "联网搜索", "本局前台和后台可按需搜索；从后续请求生效。切换会使缓存失效，首次请求会增加耗时和费用。"]].map(([name, title, description]) => h("label", { key: name, className: "dsh-tavern-background-task" },
                        h("span", null, title, h("span", { className: "dsh-tavern-settings-desc" }, description)),
                        h("input", { type: "checkbox", role: "switch", "aria-label": title, checked: features[name], disabled: !loaded || busy, onChange: event => { return save({ [name]: event.target.checked }); } }))),
                    ), error || key && reasoning.key === key && reasoning.error ? h("p", { role: "alert", className: "dsh-tavern-prompt-error" }, error || reasoning.error) : null,
                    notice ? h("p", { role: "status" }, notice) : null,
                    !loaded && error ? h("button", { className: "dsh-tavern-btn", onClick: load }, "重试") : null,
                    h("div", { role: "status", className: "dsh-local-feedback" }, busy ? "保存中…" : ""));
        }

		function TavernMoreActions(props) {
			const [open, setOpen] = React.useState(false);
			const [placement, setPlacement] = React.useState(null);
			const root = React.useRef(null);
			const trigger = React.useRef(null);
			// The mobile composer seat scrolls (overflow-y: auto), which clipped an absolutely
			// positioned menu to a thin strip. Anchor it to the viewport above the trigger instead.
			React.useLayoutEffect(function () {
				if (!open) { setPlacement(null); return; }
				function place() {
					const rect = trigger.current && trigger.current.getBoundingClientRect();
					if (!rect) return;
					const width = document.documentElement.clientWidth || window.innerWidth;
					setPlacement({ position: "fixed", top: "auto", left: "auto", right: Math.max(8, width - rect.right) + "px", bottom: (window.innerHeight - rect.top + 6) + "px", maxHeight: Math.max(120, rect.top - 12) + "px", overflowY: "auto" });
				}
				place();
				window.addEventListener("resize", place);
				if (window.visualViewport) window.visualViewport.addEventListener("resize", place);
				return function () { window.removeEventListener("resize", place); if (window.visualViewport) window.visualViewport.removeEventListener("resize", place); };
			}, [open]);
			React.useEffect(function () {
				if (!open) return;
				function closeOutside(event) { if (!root.current || !root.current.contains(event.target)) setOpen(false); }
				function closeOnEscape(event) { if (event.key === "Escape") setOpen(false); }
				document.addEventListener("pointerdown", closeOutside, true);
				document.addEventListener("keydown", closeOnEscape);
				return function () { document.removeEventListener("pointerdown", closeOutside, true); document.removeEventListener("keydown", closeOnEscape); };
			}, [open]);
			return React.createElement("div", { className: "dsh-tavern-more-actions", ref: root },
				React.createElement("button", { ref: trigger, type: "button", className: "dsh-tavern-choice-trigger", "aria-haspopup": "menu", "aria-expanded": open, onClick: function () { setOpen(function (value) { return !value; }); } }, "更多 ▾"),
				React.createElement("div", { className: "dsh-tavern-more-menu", role: "menu", hidden: !open, style: placement || undefined, onClick: function (event) { if (event.target && event.target.closest && event.target.closest("button:not(:disabled)")) setOpen(false); } },
                    React.createElement(TavernStopBackgroundAction, Object.assign({}, props, { inMenu: true })),
					React.createElement(TavernEditBodyAction, props),
					React.createElement(TavernRollbackAction, props),
                    React.createElement(TavernUndoRollbackAction, props),
					React.createElement(TavernCompactionAction, Object.assign({}, props, { inMenu: true })))
			);
		}

		function CandidateDockActions(props) {
			const address = props.sessions && props.sessions.subagentAddress(props.sessionId);
			const ownerSessionId = address ? address.parentSessionId : props.sessionId;
			const sessionMode = useTavernSessionMode(ownerSessionId);
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const running = props.useSession(function (snapshot) { return snapshot.running === true; });
			const live = useLiveTavernView(ownerSessionId, String(running) + ":" + String(latestMessageId || ""));
			const imageTurn = Number(live.view && live.view.latestAssistantTurn) || 0;
			const h = React.createElement;
			if (!sessionMode) return null;
			if (address) return isPlayMode(sessionMode) ? h("div", { className: "dsh-tavern-dock-actions" },
				h(TavernStopBackgroundAction, { sessionId: ownerSessionId }),
				h(TavernImageAgentUndoAction, { parentSessionId: ownerSessionId, agentSessionId: props.sessionId, running })) : null;
			return h("div", { className: "dsh-tavern-dock-actions" },
				isPlayMode(sessionMode) && latestMessageId ? React.createElement(CandidateAction, Object.assign({}, props, { messageId: latestMessageId })) : null,
				isPlayMode(sessionMode) && live.view && !live.view.canClearIncompleteReply ? React.createElement(TavernPluginComposerActions, { sessionId: props.sessionId, turn: imageTurn, running: running }) : null,
				isPlayMode(sessionMode) ? React.createElement(TavernMoreActions, props) : React.createElement(TavernCompactionAction, props),
                live.view && live.view.contextCompaction && (live.view.contextCompaction.warning || live.view.contextCompaction.operation && live.view.contextCompaction.operation.status === "running") ? h("span", { role: "status", className: "dsh-tavern-settings-desc" }, live.view.contextCompaction.warning || "正在压缩前后台上下文…") : null
			);
		}

        function observeTurnErrorProjection(root, apply, host = window) {
            let frame = null, disposed = false;
            const selector = '[data-chat-flow-kind], [data-turn-tail]';
            function containsRows(node) {
                return node.nodeType === 1 && (node.matches(selector) || !!node.querySelector(selector));
            }
            const observer = new host.MutationObserver(function (records) {
                if (disposed || !records.some(function (record) {
                    if (record.type === "attributes") return true;
                    // Native error contents may replace our controls; prose streaming cannot.
                    if (record.target.closest?.('[data-chat-flow-kind="turn-error"]')) return true;
                    return Array.from(record.addedNodes).some(containsRows) || Array.from(record.removedNodes).some(containsRows);
                })) return;
                if (frame === null) frame = host.requestAnimationFrame(function () {
                    frame = null;
                    if (!disposed) apply();
                });
            });
            observer.observe(root, { childList: true, subtree: true, attributes: true,
                attributeFilter: ["data-chat-flow-kind", "data-chat-flow-key", "data-chat-turn", "data-turn-tail"] });
            return { disconnect() {
                disposed = true; observer.disconnect();
                if (frame !== null) host.cancelAnimationFrame(frame);
                frame = null;
            } };
        }
		function SupersededTurnErrors(props) {
			const marker = React.useRef(null);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const state = useLiveTavernView(props.sessionId, "suppression:" + String(latestMessageId || "") + ":" + String(running));
			const turns = state.view && state.view.suppressedDshErrorTurns || [];
			const hiddenTurns = state.view && state.view.hiddenDshErrorTurns;
			const replayTurn = state.view && state.view.canReplayFailedTurn ? Number(state.view.replayFailedTurn) || null : null;
			const staleTurns = state.view && state.view.staleDshErrorTurns || [];
			const filteredStreak = Number(state.view && state.view.filteredFailureStreak) || 0;
			const canRewind = !!(state.view && state.view.canRegenerate === true);
			const draft = props.useInput(snapshot => snapshot.draft);
			const draftRef = React.useRef(draft);
			draftRef.current = draft;
			const revision = turns.join(",") + ":" + (Array.isArray(hiddenTurns) ? "saved:" + hiddenTurns.join(",") : "local") + ":" + String(replayTurn || "")
				+ ":" + staleTurns.join(",") + ":" + filteredStreak + ":" + canRewind;
			// Clearing a failed tail is the first half of both recovery actions.
			async function clearFailedTail() {
				const result = await rpc("rollbackTurn", { expectedTurn: null }, props.sessionId);
				historyProjection.rolledBack(props.sessionId, result && result.view);
				setCandidatePanel(null); setRegenPanel(null); setCandidateGuidePanel(null);
				return result || {};
			}
			function refreshAfterRecovery() {
				notifyTavernDataChanged(["sessions"], "play-controls");
				liveTavernView.invalidate(props.sessionId);
				tavernCoordination.invalidate(props.sessionId);
			}
			React.useEffect(function () {
				const root = marker.current && marker.current.closest("[data-conversation-scroll]");
				if (!root) return;
				const projection = createSupersededErrorProjection(root);
				const controls = createTurnErrorControls(root, {
                    sessionId: props.sessionId, storage: window.localStorage, hiddenTurns: hiddenTurns, replayTurn: replayTurn,
                    onToggle: !Array.isArray(hiddenTurns) ? undefined : async function (turn, hidden) {
                        const result = await rpc("setFailedErrorVisibility", { sessionId: props.sessionId, turn: turn, hidden: hidden });
                        liveTavernView.setView(props.sessionId, result.view);
                    },
                    onReplay: replayTurn === null ? undefined : async function () {
                        try { await submitFailedTurnReplay(props.sessionId); }
                        catch (error) { tavernErrorHub.report("重新生成本轮", error); }
                        finally { liveTavernView.invalidate(props.sessionId); }
                    },
                    staleTurns: staleTurns, filteredStreak: filteredStreak, canRewind: canRewind,
                    onWithdraw: replayTurn === null ? undefined : async function () {
                        try {
                            const result = await clearFailedTail();
                            const text = String(result.view && result.view.clearedInput || "");
                            if (text.trim() !== "") {
                                const current = String(draftRef.current || "");
                                props.inputActions.setDraft(current.trim() === "" ? text : text + "\n" + current);
                            }
                        } catch (error) { tavernErrorHub.report("撤回这条输入", error); }
                        finally { refreshAfterRecovery(); }
                    },
                    onRewind: replayTurn === null || !canRewind ? undefined : async function () {
                        try {
                            const cleared = await clearFailedTail();
                            const target = Number(cleared.view && cleared.view.rollbackTargetTurn) || null;
                            const result = await rpc("rollbackTurn", { expectedTurn: target }, props.sessionId);
                            historyProjection.rolledBack(props.sessionId, result && result.view);
                            if (result && result.view && result.view.rollbackWarning) tavernErrorHub.report("回退提示", new Error(result.view.rollbackWarning));
                        } catch (error) { tavernErrorHub.report("回退上一轮", error); }
                        finally { refreshAfterRecovery(); }
                    },
                    onError: function (error) { tavernErrorHub.report("保存错误提示状态失败", error); }
                });
				const apply = function () { projection.apply(turns); controls.apply(); };
				apply();
				const observer = observeTurnErrorProjection(root, apply);
				return function () { observer.disconnect(); controls.dispose(); projection.dispose(); };
			}, [props.sessionId, revision]);
			return React.createElement("span", { ref: marker, hidden: true, "data-tavern-error-projection": props.sessionId });
		}
		// @include background-suppression.js
		const pollBackgroundSuppression = createBackgroundSuppressionPoller(rpc);
		// Undo the scene-image agent's latest drawing conversation; pictures stay.
		function TavernImageAgentUndoAction(props) {
			const h = React.createElement;
			const [available, setAvailable] = React.useState(false);
			const [status, setStatus] = React.useState("");
			const askConfirm = useTavernConfirm(props.agentSessionId);
			React.useEffect(function () {
				setAvailable(false); setStatus("");
				let active = true;
				rpc("getImageAgentUndo", { parentSessionId: props.parentSessionId, agentSessionId: props.agentSessionId })
					.then(function (result) { if (active) setAvailable(result.available === true); }, function () {});
				return function () { active = false; };
			}, [props.parentSessionId, props.agentSessionId]);
			if (!available) return null;
			async function undo() {
				if (!await askConfirm("撤销文生图 Agent 最近一轮对话？\n\n已画好的图片会保留，只是 Agent 不再记得那次画图的过程。")) return;
				setStatus("busy");
				try {
					const result = await rpc("undoImageAgentTurn", { parentSessionId: props.parentSessionId, agentSessionId: props.agentSessionId });
					setStatus(result.undone ? "" : "empty");
					window.dispatchEvent(new CustomEvent("dsh-tavern-background-history-changed", { detail: { sessionId: props.agentSessionId } }));
				} catch (err) { setStatus(""); tavernErrorHub.report("撤销文生图对话", err); }
			}
			return h("button", { type: "button", className: "dsh-tavern-choice-trigger", disabled: status === "busy" || props.running, title: "撤销最近一轮画图对话；图片保留", onClick: undo },
				status === "busy" ? "撤销中…" : status === "empty" ? "没有可撤销的对话" : "撤销最近一轮");
		}
		function TurnHistoryProjection(props) {
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const suppressionState = useLiveTavernView(props.sessionId, "suppression:" + String(latestMessageId || "") + ":" + String(running));
			const [backgroundTurns, setBackgroundTurns] = React.useState([]);
			const [backgroundRevision, setBackgroundRevision] = React.useState(0);
			React.useEffect(function () { setBackgroundTurns([]); }, [props.sessionId]);
			React.useEffect(function () {
				function changed(event) { if (event.detail?.sessionId === props.sessionId) setBackgroundRevision(value => value + 1); }
				window.addEventListener("dsh-tavern-background-history-changed", changed);
				return function () { window.removeEventListener("dsh-tavern-background-history-changed", changed); };
			}, [props.sessionId]);
			React.useEffect(function () {
				if (!String(props.sessionId || "").startsWith("background-")) return;
				return pollBackgroundSuppression(props.sessionId, running,
					result => setBackgroundTurns(result.turns || []),
					error => console.warn("后台回退显示刷新失败", error));
			}, [props.sessionId, latestMessageId, running, backgroundRevision]);
			const foregroundTurns = suppressionState.view && Array.isArray(suppressionState.view.suppressedDshTurns) ? suppressionState.view.suppressedDshTurns : [];
			const suppressedDshTurns = foregroundTurns.concat(backgroundTurns);
			const suppressedDshTurnsRevision = suppressedDshTurns.join(",");
			const regeneratedDshTurns = suppressionState.view && suppressionState.view.regeneratedDshTurns || {};
			const regeneratedDshTurnsRevision = JSON.stringify(regeneratedDshTurns);
			React.useEffect(function () {
				let frame = null;
				function applyProjectionState() {
					frame = null;
					historyProjection.apply(props.sessionId, suppressedDshTurns, regeneratedDshTurns);
				}
				function scheduleProjection() {
					if (frame === null) frame = window.requestAnimationFrame(applyProjectionState);
				}
				scheduleProjection();
				// Only chat-row mounts and ownership changes matter; streamed prose and
				// composer edits mutate the page every frame and must not re-scan history.
				const rowSelector = "[data-chat-flow-kind], [data-chat-turn], [data-turn-tail]";
				function touchesRows(node) {
					return node.nodeType === 1 && (node.matches(rowSelector) || !!node.querySelector(rowSelector));
				}
				const observer = new window.MutationObserver(function (records) {
					if (records.some(function (record) {
						return record.type === "attributes" || Array.from(record.addedNodes).some(touchesRows) || Array.from(record.removedNodes).some(touchesRows);
					})) scheduleProjection();
				});
				observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-chat-flow-kind", "data-chat-turn", "data-turn-tail"] });
				return function () { observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame); };
			}, [props.sessionId, latestMessageId, running, suppressedDshTurnsRevision, regeneratedDshTurnsRevision]);
			return null;
		}
		function CandidateQuestion(props) {
            // 宿主输入器可由 textarea 升级为 contenteditable，两种入口共享聚焦与收起逻辑。
            const inputSelector = "[data-composer-card] :is(textarea, [contenteditable='true'])";
            const dismissMode = useCandidatePreferences();
			const panel = useCandidatePanel();
            const draft = props.useInput(snapshot => snapshot.draft);
            const draftRef = React.useRef(draft);
            draftRef.current = draft;
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const [added, setAdded] = React.useState([]);
            const expanded = Boolean(panel && panel.expanded);
            function setExpanded(value) {
                if (panel) setCandidatePanel(Object.assign({}, panel, { expanded: value }));
            }
            React.useEffect(() => { if (running && panel?.expanded) setExpanded(false); }, [running, panel]);
			React.useEffect(function () {
				if (typeof document === "undefined" || !panel?.expanded) return;
				function onComposerFocus(event) {
					// 手机开始手动输入就收起候选，给键盘上方的正文留出空间；面板编辑器不受影响。
					if (window.matchMedia(TAVERN_MOBILE_QUERY + ", (pointer: coarse)").matches && event.target?.matches(inputSelector)) setExpanded(false);
				}
				document.addEventListener("focusin", onComposerFocus);
				return function () { document.removeEventListener("focusin", onComposerFocus); };
			}, [panel]);
			React.useEffect(function () {
				setAdded([]);
			}, [panel?.choices]);

			if (panel && panel.sessionId === props.sessionId && panel.phase === "error") {
				return React.createElement("div", { className: "dsh-tavern-choice-error dsh-tavern-candidate-error-banner" },
					"候选项生成失败：" + (panel.error || "未知错误") + "。请点上方“生成候选项”重试。"
				);
			}
			if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId || running) {
				return null;
			}
			const h = React.createElement;
			const count = (panel.choices || []).length;
			const isScript = sessionMode === "script";
			const heading = "接下来的行动";
			const summary = panel.phase === "loading" ? "正在生成…" : (panel.error ? "生成失败" : (isScript ? "跟随剧本" : count + " 个"));
			return h("div", { className: "dsh-tavern-question dsh-tavern-candidate-question" + (expanded ? "" : " collapsed") },
				h("div", { className: "dsh-tavern-question-head", role: "button", tabIndex: 0, "aria-expanded": expanded ? "true" : "false", onClick: function () { setExpanded(!expanded); }, onKeyDown: function (event) { if (event.target === event.currentTarget && !event.isComposing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setExpanded(!expanded); } } }, h("span", null, heading), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { type: "button", className: "dsh-tavern-question-close", title: expanded ? "收起行动列表" : "展开行动列表", "aria-label": expanded ? "收起行动列表" : "展开行动列表", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
				expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
				expanded && panel.error ? h("div", { className: "dsh-tavern-choice-error" }, "候选项生成失败，请点回复下方的“生成候选项”重试") : null,
				expanded ? h("div", { className: "dsh-tavern-question-body" }, (panel.choices || []).map(function (choice, index) {
					const item = choice !== null && typeof choice === "object" ? choice : { type: "action", text: String(choice) };
					// 点选项即追加到输入框，再点一次取消并从输入框移除；发送前仍可修改。
					const isAdded = added.includes(index);
					return h("button", { key: index, className: "dsh-tavern-question-option" + (isAdded ? " selected" : ""), "aria-pressed": isAdded, title: isAdded ? "从输入框移除" : "追加到输入框", onClick: function () {
						const marked = item.type === "scene" ? "【场景变化】" + item.text : item.text;
						const current = String(draftRef.current || "");
						let next;
						if (isAdded) {
							// 只移除原样追加的那一行；用户改过的文字保留不动。
							const lines = current.split("\n");
							const at = lines.lastIndexOf(marked);
							if (at >= 0) lines.splice(at, 1);
							next = lines.join("\n").replace(/^\n+|\n+$/g, "");
						} else next = current + (current && !current.endsWith("\n") ? "\n" : "") + marked;
						draftRef.current = next;
						props.inputActions.setDraft(next);
						if (!isAdded && dismissMode !== "after-send") setCandidatePanel(null);
						else setAdded(list => isAdded ? list.filter(value => value !== index) : list.concat(index));
					} },
						h("span", { className: "dsh-tavern-question-text" },
							item.type === "scene" ? h("span", { className: "dsh-tavern-question-tag dsh-tavern-question-tag-scene" }, "场景变化") : null,
							h("span", null, item.text)
						)
					);
				})) : null
			);
		}

		function CandidateGuidePanel(props) {
			const panel = useCandidateGuidePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const [guidance, setGuidance] = React.useState("");
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId) {
				return null;
			}
			const isScript = sessionMode === "script";
			async function generateGuided() {
				const guide = guidance.trim();
				const messageId = panel.messageId;
				setCandidateGuidePanel({ sessionId: props.sessionId, messageId: messageId, phase: "loading", error: "", previous: panel.previous });
				try {
					setCandidatePanel({ sessionId: props.sessionId, messageId: messageId, phase: "loading", choices: [], error: "" });
					await submitCandidateTask(props.sessionId, messageId, guide);
					setCandidateGuidePanel(null);
				} catch (err) {
					tavernErrorHub.report("候选项重新生成", err);
					setCandidateGuidePanel({ sessionId: props.sessionId, messageId: messageId, phase: "input", error: String(err && err.message || err), previous: panel.previous });
				}
			}
			function cancel() {
				setCandidateGuidePanel(null);
				if (panel.previous) setCandidatePanel(panel.previous);
			}
			const body = panel.phase === "loading"
				? h("div", { className: "dsh-tavern-question-sub" }, "正在重新生成候选项…")
				: h(React.Fragment, null,
					panel.error ? h("div", { className: "dsh-tavern-choice-error" }, panel.error) : null,
					h("textarea", {
						className: "dsh-tavern-regen-input",
						rows: 2,
						value: guidance,
						placeholder: isScript ? "对候选的要求（可选）：例如“侧重角色行动”“直接开新场景”" : "对候选的要求（可选）：例如“多点暧昧动作”“场景换到白天户外”“新场景换一批人物”",
						onChange: function (e) { setGuidance(e.target.value); }
					}),
					h("div", { className: "dsh-tavern-question-foot" },
						h("button", { className: "dsh-tavern-question-primary", disabled: panel.phase === "loading", onClick: generateGuided }, "按此意见重新生成"),
						h("button", { className: "dsh-tavern-question-free", onClick: cancel }, "取消")
					)
				);
			return h("div", { className: "dsh-tavern-question" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "重新生成候选项"), h("span", { className: "dsh-tavern-question-sub" }, isScript ? "可填写意见；由于跟随剧本，只会重新生成一个推荐候选项" : "可填写意见，行动候选与场景候选通用")),
				body
			);
		}

		function RegenPanel(props) {
			const panel = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const [guidance, setGuidance] = React.useState("");
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId) return null;
			async function generate() {
				const guide = guidance.trim();
				setRegenPanel(Object.assign({}, panel, { phase: "loading", error: "" }));
				try {
					await submitBodyRegeneration(props.sessionId, panel, guide);
					setRegenPanel(null);
				} catch (err) {
					tavernErrorHub.report("正文重新生成", err);
					setRegenPanel(Object.assign({}, panel, { phase: "error", error: String(err && err.message || err) }));
				}
			}
			const body = panel.phase === "loading"
				? h("div", { className: "dsh-tavern-question-sub" }, "正在重新生成正文…")
				: h(React.Fragment, null,
						panel.error ? h("div", { className: "dsh-tavern-choice-error" }, panel.error) : null,
						h("textarea", {
							className: "dsh-tavern-regen-input",
							rows: 2,
							value: guidance,
							placeholder: "指导意见（可选）：例如“写得更长，侧重心理描写”",
							onChange: function (e) { setGuidance(e.target.value); }
						}),
						h("div", { className: "dsh-tavern-question-foot" },
							h("button", { className: "dsh-tavern-question-primary", disabled: panel.phase === "loading", onClick: generate }, "生成并替换正文"),
							h("button", { className: "dsh-tavern-btn quiet", onClick: function () { setRegenPanel(null); } }, "取消")
						)
					);
			return h("div", { className: "dsh-tavern-question" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "重新生成正文"), h("span", { className: "dsh-tavern-question-sub" }, "生成后直接替换当前正文")),
				body
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
			const uiConversation = ctx.get("uiConversation") || ctx.get("conversation");
			const executeSlash = createTavernFrameSlashExecutor(ctx);
            ctx.effect(() => ctx.betterSidebar.registerTab({
                id: "dsh-tavern:conversation-settings", title: "本局设置", order: 8, single: true,
                component: props => React.createElement(TavernConversationSettingsTab, { sessionId: props.scope.sessionId, sessions: ctx.sessions })
            }), "dsh-tavern: conversation settings tab");
            // Replace shipped host chrome that is noise in the Tavern profile.
            // Same id + lower priority shadows the host entry (lowest renders).
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "dsh-better-sidebar:bottom-toggle", order: 10, priority: -1 },
                () => null
            )), "dsh-tavern: hide bottom panel toggle");
            ctx.effect(() => slots.inject("conversation.session.header.actions", () => slots.register(
                { name: "conversation.session.header.actions", id: "agent-preset", order: -10, priority: -1 },
                () => null
            )), "dsh-tavern: hide host agent-preset label");
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "open-in-app", order: -10, priority: -1 },
                () => null
            )), "dsh-tavern: hide host open-in-app");
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "session-log-download", order: 0, priority: -1 },
                () => null
            )), "dsh-tavern: hide host session-log-download");
            ctx.effect(() => slots.inject("conversation.session.header.actions", () => slots.register(
                { name: "conversation.session.header.actions", id: "dsh-tavern-immersive", order: 9 },
                () => React.createElement(TavernImmersiveAction)
            )), "dsh-tavern: immersive header action");
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "dsh-tavern-conversation-settings", order: 80 },
                props => React.createElement(TavernConversationSettingsAction, { ...props, sessions: ctx.sessions, open: sessionId => openTavernSidebarTab(ctx, { type: "dsh-tavern:status" }, { sessionId }) })
            )), "dsh-tavern: conversation settings action");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:status",
				title: "酒馆状态",
				order: 7,
				single: true,
				component: function (props) {
					return React.createElement(TavernStatusTab, { sessions: ctx.sessions, uiConversation: uiConversation, sessionId: props.scope.sessionId, executeSlash: executeSlash, openStyleTab: function (type, meta) { openTavernSidebarTab(ctx, { type: type, meta: meta }, { sessionId: props.scope.sessionId }); } });
				}
			}), "dsh-tavern: Better Sidebar status tab");
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
				{ name: "conversation.session.header.utilities", id: "dsh-tavern-conversation-export", order: 90 },
				function (props) { return React.createElement(TavernConversationExportAction, Object.assign({}, props, { sessions: ctx.sessions })); }
			)), "dsh-tavern: conversation text export utility");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-actions", order: -130, label: "候选项操作" },
				function (props) { return React.createElement(CandidateDockActions, Object.assign({}, props, {
					sessions: ctx.sessions,
					executeCompact: function (sessionId) { return ctx.remote.commands.execute(sessionId, "/compact", []); }
				})); }
			)), "dsh-tavern: candidate dock actions");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-question", order: -120, label: "下一步行动" },
				function (props) { return React.createElement(React.Fragment, null,
					React.createElement(SupersededTurnErrors, Object.assign({}, props, { key: props.sessionId })),
					React.createElement(TurnHistoryProjection, Object.assign({}, props, { key: "history:" + props.sessionId })),
					React.createElement(CandidateQuestion, Object.assign({}, props, { sessions: ctx.sessions }))
				); }
			)), "dsh-tavern: candidate question panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-guide", order: -115, label: "重新生成候选项" },
				function (props) { return React.createElement(CandidateGuidePanel, props); }
			)), "dsh-tavern: candidate guide panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-regen", order: -110, label: "重新生成正文" },
				function (props) { return React.createElement(React.Fragment, null, React.createElement(RegenPanel, props), React.createElement(BodyEditPanel, props)); }
			)), "dsh-tavern: regen body panel");
		}
		return Object.freeze({ register: register });
		}
		const playControlsFeature = createPlayControlsFeatureModule();
		const assistantRendererFeature = createTavernAssistantRendererFeatureModule();
