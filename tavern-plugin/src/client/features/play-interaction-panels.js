// Presentation and composer draft lifetime; async transitions belong to interactions.
function createPlayInteractionPanels({ interactions, useCandidatePanel, useCandidateGuidePanel, useRegenPanel, dismissCandidateError, usePhonePlay }) {
    const setCandidatePanel = interactions.candidates.set;
    const setRegenPanel = interactions.regeneration.set;
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
        const phone = usePhonePlay(props.sessionId, props.sessions);
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
        if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId || running) {
            return null;
        }
        const h = React.createElement;
        // A failure belongs to its round: a new round, a new request or success replaces it; ✕ dismisses it.
        // The detail is in the debug error hub; the player only reads one plain line (AGENTS 导演/舞台状态不变量).
        if (panel.phase === "error") {
            return h("div", { className: "dsh-tavern-candidate-error-banner", role: "alert" },
                h("span", null, "⚠ 这次没能生成选项，可以再点「生成候选项」"),
                h("button", { type: "button", className: "dsh-tavern-candidate-error-close", title: "关闭", "aria-label": "关闭", onClick: function () { dismissCandidateError(panel); } }, "✕"));
        }
        const count = (panel.choices || []).length;
        const isScript = sessionMode === "script";
        const heading = "接下来的行动";
        const summary = panel.phase === "loading" ? "正在生成…" : (isScript ? "跟随剧本" : count + " 个");
        // decode double-escaped model output for choices stored before the host fix.
        const decode = typeof decodeUnicodeEscapes === "function" ? decodeUnicodeEscapes : String;
        const items = (panel.choices || []).map(function (choice) {
            return choice !== null && typeof choice === "object" ? { ...choice, text: decode(choice.text) } : { type: "action", text: decode(String(choice)) };
        });
        // 点选项即追加到输入框，再点一次取消并从输入框移除；发送前仍可修改。
        function pick(index) {
            const item = items[index];
            const isAdded = added.includes(index);
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
        }
        // on a phone in play the folded list is one row of chips above the composer:
        // the first two choices, then 「+N」 opening the full list (the same panel as everywhere else).
        if (phone && !expanded) {
            if (panel.phase !== "loading" && !count) return null;
            const shown = items.slice(0, 2);
            return h("div", { className: "dsh-tavern-candidate-chips", role: "group", "aria-label": heading },
                panel.phase === "loading" ? h("span", { className: "dsh-tavern-question-chip is-pending", role: "status" }, summary)
                    : shown.map(function (item, index) {
                        const isAdded = added.includes(index);
                        return h("button", { key: index, type: "button", className: "dsh-tavern-question-chip" + (isAdded ? " selected" : ""), "data-type": item.type, "aria-pressed": isAdded, title: item.text, onClick: function () { pick(index); } },
                            isAdded ? h("span", { className: "dsh-tavern-question-index", "aria-hidden": true }, "✓") : null, h("span", { className: "dsh-tavern-question-text" }, item.text));
                    }),
                count > shown.length && panel.phase !== "loading" ? h("button", { type: "button", className: "dsh-tavern-question-chip dsh-tavern-question-more", "aria-label": "展开行动列表", title: "展开行动列表", onClick: function () { setExpanded(true); } }, "+" + (count - shown.length)) : null);
        }
        return h("div", { className: "dsh-tavern-question dsh-tavern-candidate-question" + (expanded ? "" : " collapsed") },
            h("div", { className: "dsh-tavern-question-head", role: "button", tabIndex: 0, "aria-expanded": expanded ? "true" : "false", onClick: function () { setExpanded(!expanded); }, onKeyDown: function (event) { if (event.target === event.currentTarget && !event.isComposing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setExpanded(!expanded); } } }, h("span", null, heading), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { type: "button", className: "dsh-tavern-question-close", title: expanded ? "收起行动列表" : "展开行动列表", "aria-label": expanded ? "收起行动列表" : "展开行动列表", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
            expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
            // one click appends the choice; only scene choices carry a marker.
            expanded ? h("div", { className: "dsh-tavern-question-body" }, items.map(function (item, index) {
                        const isAdded = added.includes(index);
                        return h("button", { key: index, className: "dsh-tavern-question-option" + (isAdded ? " selected" : ""), "data-type": item.type, "aria-pressed": isAdded, title: isAdded ? "从输入框移除" : "追加到输入框", onClick: function () { pick(index); } },
                            h("span", { className: "dsh-tavern-question-index", "aria-hidden": true }, isAdded ? "✓" : String(index + 1)),
                            h("span", { className: "dsh-tavern-question-text" },
                                item.type === "scene" ? h("span", { className: "dsh-tavern-question-tag dsh-tavern-question-tag-scene" }, "场景变化") : null,
                                h("span", null, item.text)
                            )
                        );
            })) : null,
            expanded && panel.phase === "ready" && panel.traceSessionId ? h("button", { className: "dsh-tavern-question-free", title: panel.traceMode === "continuable" ? "打开持续存在的后台 Agent" : "打开后台候选任务的推理与工具调用记录", onClick: async function () {
                        try {
                            await props.sessions.refreshSubagents(panel.sessionId);
                            props.sessions.openSubagent({ parentSessionId: panel.sessionId, childSessionId: panel.traceSessionId, mode: panel.traceMode });
                        } catch (err) {
                            tavernErrorHub.report("后台 Agent 轨迹", "无法打开后台 Agent 轨迹：" + String(err && err.message || err));
                        }
                } }, panel.traceMode === "continuable" ? "查看后台 Agent" : "查看后台候选任务轨迹") : null,
            null
        );
    }

		function CandidateGuidePanel(props) {
			const panel = useCandidateGuidePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const [guidance, setGuidance] = React.useState("");
            React.useEffect(() => setGuidance(""), [props.sessionId, panel?.messageId]);
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId) {
				return null;
			}
			const isScript = sessionMode === "script";
            function generateGuided() { return interactions.regenerateCandidates(panel, guidance); }
            function cancel() { interactions.cancelGuide(panel); }
			return h(RegenGuideForm, {
				title: "重新生成候选项",
				hint: isScript ? "跟随剧本，只重新生成一个推荐候选" : "行动候选与场景候选通用",
				loading: panel.phase === "loading" ? "正在重新生成候选项…" : "",
				error: panel.error,
				value: guidance,
				onChange: setGuidance,
				placeholder: "对候选的要求（可选）",
				examples: isScript ? ["侧重角色行动", "直接开新场景"] : ["多点暧昧动作", "场景换到白天户外", "新场景换一批人物"],
				submitLabel: "重新生成",
				onSubmit: generateGuided,
				onCancel: cancel
			});
		}

		// Shared guidance form of the candidate and body regeneration panels.
		function RegenGuideForm(props) {
			const h = React.createElement;
			function addExample(text) {
				const current = props.value.trim();
				props.onChange(current ? current + "；" + text : text);
			}
			function onKeyDown(e) {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); props.onSubmit(); }
				else if (e.key === "Escape") { e.preventDefault(); props.onCancel(); }
			}
			const body = props.loading
				? h(React.Fragment, null, h("div", { className: "dsh-tavern-regen-loading" }, props.loading), props.loadingExtra || null)
				: h(React.Fragment, null,
					props.error ? h("div", { className: "dsh-tavern-choice-error" }, props.error) : null,
					h(TextArea, {
						className: "dsh-tavern-regen-input",
						rows: 2,
						autoFocus: true,
						value: props.value,
						placeholder: props.placeholder,
						onChange: props.onChange,
						onKeyDown: onKeyDown
					}),
					props.extra || null,
					h("div", { className: "dsh-tavern-regen-foot" },
						h("div", { className: "dsh-tavern-regen-examples" }, props.examples.map(function (text) {
							return h("button", { key: text, type: "button", className: "dsh-tavern-regen-example", onClick: function () { addExample(text); } }, text);
						})),
						h("button", { type: "button", className: "dsh-tavern-regen-cancel", onClick: props.onCancel }, "取消"),
						props.secondary ? h("button", { type: "button", className: "dsh-tavern-regen-cancel", title: props.secondary.title, disabled: props.secondary.disabled, onClick: props.secondary.onClick }, props.secondary.label) : null,
						h("button", { type: "button", className: "dsh-tavern-question-primary dsh-tavern-regen-submit", onClick: props.onSubmit }, props.submitLabel)
					)
				);
			return h("div", { className: "dsh-tavern-question dsh-tavern-regen" },
				h("div", { className: "dsh-tavern-regen-head" },
					h("span", { className: "dsh-tavern-regen-title" }, props.title),
					h("span", { className: "dsh-tavern-question-sub" }, props.hint)
				),
				body
			);
		}

		// The last guidance per game, offered again when the player regenerates once more.
		function RegenPanel(props) {
        const panel = useRegenPanel();
        const sessionMode = useTavernSessionMode(props.sessionId);
        const running = props.useSession(function (snapshot) { return snapshot.running; });
        const [guidance, setGuidance] = React.useState(function () { return interactions.guidance(props.sessionId); });
        const [restyle, setRestyle] = React.useState(false);
        const [styleGuidance, setStyleGuidance] = React.useState("");
        const [reviewing, setReviewing] = React.useState(false);
        const [reviewNote, setReviewNote] = React.useState("");
        const [reviewSeconds, setReviewSeconds] = React.useState(0);
        const [reviewProgress, setReviewProgress] = React.useState(null);
        React.useEffect(function () {
            let disposed = false, loading = false;
            setReviewProgress(null);
            if (!reviewing) return;
            async function refresh() {
                if (loading) return;
                loading = true;
                try {
                    const result = await rpc("polishProgress", {}, props.sessionId);
                    if (!disposed) setReviewProgress(result.progress);
                } catch (_) { /* The running request reports failures. */ }
                finally { loading = false; }
            }
            void refresh();
            const timer = setInterval(refresh, 1000);
            return function () { disposed = true; clearInterval(timer); };
        }, [reviewing, props.sessionId]);
        React.useEffect(() => {
            if (!reviewing) return undefined;
            const started = Date.now();
            setReviewSeconds(0);
            const timer = setInterval(() => setReviewSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
            return () => clearInterval(timer);
        }, [reviewing]);
        React.useEffect(() => { setRestyle(false); setStyleGuidance(""); }, [props.sessionId]);
        const styleState = useLiveTavernView(props.sessionId, "regen-style");
        const styleEnabled = styleState.view?.styleReferenceEnabled === true;
        const opened = panel && panel.sessionId === props.sessionId && panel.phase === "input";
        React.useEffect(function () { if (opened) setGuidance(interactions.guidance(props.sessionId)); }, [opened, props.sessionId]);
        const h = React.createElement;
        if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId) return null;
        function generate() {
            return interactions.regenerateBody(panel, guidance, { restyle: styleEnabled && restyle, styleGuidance });
        }
        // 精修: like a regeneration, the panel waits and closes once the polished reply is in;
        // the comparison and its undo live on the 精修 page.
        async function runPolish() {
            setReviewing(true); setReviewNote("");
            try {
                const result = await rpc("polishBody", { guidance }, props.sessionId);
                const skipped = result.edits.filter(edit => edit.status !== "ok").length;
                if (result.guidance) { setGuidance(result.guidance); setReviewNote("审稿没有按格式输出修改清单，内容已填进意见框，可以按意见重新生成"); }
                else if (!result.view) setReviewNote(skipped ? "审稿给出的 " + skipped + " 条修改都没在正文里找到原文，正文没有改动" : "审稿没有发现需要修改的地方");
                else {
                    liveTavernView.setView(props.sessionId, result.view);
                    notifyTavernDataChanged(["sessions"], "play-controls");
                    tavernCoordination.invalidate(props.sessionId);
                    window.dispatchEvent(new CustomEvent("dsh-tavern-polished", { detail: { sessionId: props.sessionId } }));
                    setRegenPanel(null);
                }
            } catch (error) { setReviewNote("精修失败：" + String(error?.message || error)); }
            finally { setReviewing(false); }
        }
        return h(RegenGuideForm, {
                title: "重新生成正文",
                hint: "不填意见是重新来一次；填了意见就在当前正文基础上改；精修：按原则直接改好，填了意见会在精修后再照意见改一次，对比和撤销在「精修」页",
                loading: reviewing ? "正在精修正文… " + reviewSeconds + " 秒" + (reviewProgress?.edits?.length ? " · 已修 " + reviewProgress.edits.length + " 处" : "") : panel.phase === "loading" ? (panel.restyle ? "正在换文风联想并重新生成…" : panel.rewrite ? "正在按意见改写正文…" : "正在重新生成正文…") : "",
                loadingExtra: reviewing && reviewProgress?.edits?.length ? h("div", { className: "dsh-tavern-settings-desc", role: "status" },
                    h("p", null, "逐处生成中，完成后统一保存："),
                    reviewProgress.edits.map(function (edit, index) { return h("details", { key: index },
                        h("summary", null, (index + 1) + ". " + edit.reason),
                        h("p", null, h("del", null, edit.find)), h("p", null, h("ins", null, edit.replace || "（删除）"))); })) : null,
                extra: styleEnabled ? h("div", { className: "dsh-tavern-regen-style" },
                    h(Switch, { checked: restyle, onChange: setRestyle, label: "同时换一段文风联想" }),
                    restyle ? h(TextArea, { className: "dsh-tavern-regen-input", value: styleGuidance, maxLength: 500, "aria-label": "换参考的要求", placeholder: "换参考的要求（可选），例如：要金庸的打斗描写", onChange: setStyleGuidance }) : null) : null,
                error: panel.error || reviewNote,
                value: guidance,
                onChange: setGuidance,
                placeholder: "指导意见（可选）",
                examples: ["写得更长", "侧重心理描写", "加快节奏"],
                submitLabel: "生成并替换正文",
                secondary: { label: "精修", title: "按「正文精修原则」审读当前正文，直接改掉问题（一句到整段）；填了指导意见，精修后再只照意见改一次；不重新生成；前后对比、撤销和「自动精修」开关在顶部「精修」页", disabled: reviewing, onClick: runPolish },
                onSubmit: generate,
                onCancel: function () { setRegenPanel(null); }
        });
    }
    return Object.freeze({ CandidateQuestion, CandidateGuidePanel, RegenPanel });
}
