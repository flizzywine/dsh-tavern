// @include-protocol candidate-tabs.cjs
// Presentation and composer draft lifetime; async transitions belong to interactions.
function createPlayInteractionPanels({ interactions, useCandidatePanel, useCandidateGuidePanel, useRegenPanel, dismissCandidateError }) {
    const setCandidatePanel = interactions.candidates.set;
    const setRegenPanel = interactions.regeneration.set;
		function buildCandidateTabs(items, isScript) {
            return candidateTabs.buildCandidateChoiceTabs(items, { isScript });
        }
        function formatCandidateDraftText(item) {
            return candidateTabs.formatCandidateChoiceText(item);
        }
        function candidateItemBadges(item, tabKind) {
            return candidateTabs.candidateChoiceBadges(item, { tabKind }).map(function (badge) {
                return { className: "dsh-tavern-question-tag dsh-tavern-question-tag-" + badge.kind, label: badge.label };
            });
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
        const [activeTab, setActiveTab] = React.useState("featured");
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
                setActiveTab("featured");
            }, [panel?.choices]);
        // 候选项属于这一局最近一轮（服务端只留那一份）。页面手里的消息 id 可能为空（宿主
        // 没有投影节点）或另一套 id，判断只认这一局，不认两个 id 是否相等。
        if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || running) {
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
        const items = (panel.choices || []).map(function (choice, index) {
            return candidateTabs.normalizeCandidateChoice(choice, index, decode);
        });
        const tabState = buildCandidateTabs(items, isScript);
        const currentTab = tabState.hasTabs ? (tabState.tabs.find(function (tab) { return tab.key === activeTab; }) || tabState.tabs[0]) : tabState.current;
        const visibleItems = currentTab.items;
        // 点选项即追加到输入框，再点一次取消并从输入框移除；发送前仍可修改。
        function pick(index) {
            const item = items[index];
            const isAdded = added.includes(index);
            const marked = formatCandidateDraftText(item);
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
            if (!isAdded) tavernPlayEvents.emit("choice", props.sessionId, { choiceIndex: index });
            if (!isAdded && dismissMode !== "after-send") setCandidatePanel(null);
            else setAdded(list => isAdded ? list.filter(value => value !== index) : list.concat(index));
        }
        function onTabKeyDown(event) {
            if (!tabState.hasTabs || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
            event.preventDefault();
            const at = tabState.tabs.findIndex(function (tab) { return tab.key === currentTab.key; });
            const nextIndex = (at + (event.key === "ArrowRight" ? 1 : tabState.tabs.length - 1)) % tabState.tabs.length;
            const nextTab = tabState.tabs[nextIndex];
            setActiveTab(nextTab.key);
            const buttons = event.currentTarget.querySelectorAll("[role='tab']");
            if (buttons[nextIndex]) buttons[nextIndex].focus();
        }
        return h("div", { className: "dsh-tavern-question dsh-tavern-candidate-question" + (expanded ? "" : " collapsed") },
            h("div", { className: "dsh-tavern-question-head", role: "button", tabIndex: 0, "aria-expanded": expanded ? "true" : "false", onClick: function () { setExpanded(!expanded); }, onKeyDown: function (event) { if (event.target === event.currentTarget && !event.isComposing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setExpanded(!expanded); } } }, h("span", null, heading), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { type: "button", className: "dsh-tavern-question-close", title: expanded ? "收起行动列表" : "展开行动列表", "aria-label": expanded ? "收起行动列表" : "展开行动列表", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
            expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
            expanded && tabState.hasTabs ? h("div", { className: "dsh-tavern-question-tabs", role: "tablist", "aria-label": "行动视角切换", onKeyDown: onTabKeyDown }, tabState.tabs.map(function (tab) {
                const isSelectedTab = tab.key === currentTab.key;
                const pickedCount = (tab.kind === "featured" && !tab.custom) ? 0 : tab.items.filter(function (item) { return added.includes(item.index); }).length;
                return h("button", { key: tab.key, type: "button", role: "tab", "data-tab": tab.key, "data-kind": tab.kind, className: "dsh-tavern-question-tab" + (isSelectedTab ? " active" : "") + (pickedCount > 0 ? " has-picked" : ""), "aria-selected": isSelectedTab ? "true" : "false", tabIndex: isSelectedTab ? 0 : -1, onClick: function () { setActiveTab(tab.key); } },
                    h("span", { className: "dsh-tavern-question-tab-label" }, tab.label),
                    h("span", { className: "dsh-tavern-question-tab-count" }, pickedCount > 0 ? "✓" + pickedCount : String(tab.items.length)));
            })) : null,
            expanded ? h("div", { className: "dsh-tavern-question-body" }, visibleItems.map(function (item, visibleIndex) {
                        const isAdded = added.includes(item.index);
                        const badges = candidateItemBadges(item, currentTab.kind);
                        const actorAttr = item.actor || (Array.isArray(item.actors) && item.actors.length > 0 ? item.actors.join(",") : undefined);
                        return h("button", { key: item.index, className: "dsh-tavern-question-option" + (isAdded ? " selected" : ""), "data-type": item.type, "data-actor": actorAttr, "aria-pressed": isAdded, title: isAdded ? "从输入框移除" : "追加到输入框", onClick: function () { pick(item.index); } },
                            h("span", { className: "dsh-tavern-question-index", "aria-hidden": true }, isAdded ? "✓" : String(visibleIndex + 1)),
                            h("span", { className: "dsh-tavern-question-text" },
                                badges.length > 0 ? h("span", { className: "dsh-tavern-question-tags" }, badges.map(function (badge, badgeIndex) {
                                    return h("span", { key: badgeIndex, className: badge.className }, badge.label);
                                })) : null,
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
            React.useEffect(() => setGuidance(""), [props.sessionId, panel?.messageId]);
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId) {
				return null;
			}
			const isScript = sessionMode === "script";
            function generateGuided() { return interactions.regenerateCandidates(panel, guidance); }
            function cancel() { interactions.cancelGuide(panel); }
			return h(RegenGuideForm, {
				title: "重新生成候选项",
				hint: isScript ? "跟随剧本，只重新生成一个推荐候选" : "角色与全局候选项通用",
				loading: panel.phase === "loading" ? "正在重新生成候选项…" : "",
				error: panel.error,
				value: guidance,
				onChange: setGuidance,
				placeholder: "对候选的要求（可选）",
				examples: isScript ? ["侧重角色行动", "直接开新场景"] : ["让对手戏角色更主动", "多点暧昧动作", "增加突发插曲", "场景换到白天户外"],
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
				? (props.loading || props.loadingExtra ? h(React.Fragment, null, props.loading ? h("div", { className: "dsh-tavern-regen-loading" }, props.loading) : null, props.loadingExtra || null) : null)
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
					props.hint ? h("span", { className: "dsh-tavern-question-sub" }, props.hint) : null
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
        const [reviewing, setReviewing] = React.useState(false);
        const [reviewNote, setReviewNote] = React.useState("");
        const [reviewSeconds, setReviewSeconds] = React.useState(0);
        const [reviewProgress, setReviewProgress] = React.useState(null);
        const polishRequest = React.useRef(null);
        React.useEffect(function () {
            setReviewing(false);
            setReviewNote("");
            if (!panel || panel.sessionId !== props.sessionId) return undefined;
            const stop = tavernSessionSignals?.subscribe(props.sessionId, "polish-saved", signal => {
                const pending = polishRequest.current;
                if (!pending || pending.panel !== panel || pending.id !== signal.version) return;
                polishRequest.current = null;
                setReviewing(false);
                setReviewNote("");
                liveTavernView.invalidate(props.sessionId);
                setRegenPanel(null);
            });
            return function () {
                if (polishRequest.current?.panel === panel) polishRequest.current = null;
                stop?.();
            };
        }, [panel, props.sessionId]);
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
        const styleState = useLiveTavernView(props.sessionId, "regen-style");
        const statusView = useLiveTavernView(props.sessionId, "regen-status");
        const wasRegenerating = React.useRef(false);
        // rpc 的响应可能迟迟不回（结算拖住、连接断了），正文却已经写进存档。视图看得到
        // 服务端进出这次重新生成时，面板按它自己收尾，别把玩家锁在「正在重新生成正文…」。
        React.useEffect(function () {
            const view = statusView.view;
            if (!panel || panel.sessionId !== props.sessionId || panel.phase !== "loading") { wasRegenerating.current = false; return; }
            if (!view) return;
            if (view.regenInProgress === true) { wasRegenerating.current = true; return; }
            if (!wasRegenerating.current) return;
            wasRegenerating.current = false;
            setRegenPanel(null);
            liveTavernView.invalidate(props.sessionId);
            tavernCoordination.invalidate(props.sessionId);
        }, [panel, statusView.view]);
        // 看门狗：表单已经转了很久，而服务端视图明确不在重新生成（rpc 可能彻底丢了响应），
        // 说明这轮已经落盘；按存档收尾，玩家不至于只能刷新页面。
        const loadingSince = React.useRef(0);
        React.useEffect(function () {
            const loading = Boolean(panel && panel.sessionId === props.sessionId && panel.phase === "loading");
            if (!loading) { loadingSince.current = 0; return undefined; }
            if (typeof setTimeout !== "function") return undefined;
            loadingSince.current = Date.now();
            const timer = setTimeout(function () {
                if (Date.now() - loadingSince.current < 30000) return;
                const view = statusView.view;
                if (view && view.regenInProgress === true) return;
                setRegenPanel(null);
                liveTavernView.invalidate(props.sessionId);
                tavernCoordination.invalidate(props.sessionId);
            }, 30000);
            return function () { clearTimeout(timer); };
        }, [panel, props.sessionId, statusView.view]);
        const styleEnabled = styleState.view?.styleReferenceEnabled === true;
        const opened = panel && panel.sessionId === props.sessionId && panel.phase === "input";
        React.useEffect(function () { if (opened) setGuidance(interactions.guidance(props.sessionId)); }, [opened, props.sessionId]);
        const h = React.createElement;
        // 面板上这一行字就是「请求已经被接住了」的唯一凭据：留空则重新生成没有可显示的理由，
        // 表单会原样留在原地（输入框、生成并替换正文都在），玩家以为刚才那一下没被接住。
        const loadingText = reviewing
            ? "正在精修正文… " + reviewSeconds + " 秒" + (reviewProgress?.edits?.length ? " · 已修 " + reviewProgress.edits.length + " 处" : "")
            : panel && panel.phase === "loading"
                ? (panel.restyle ? "正在换文风联想并重新生成…" : panel.rewrite ? "正在按意见改写正文…" : "")
                : "";
        // 重新生成一提交，宿主就把会话报成运行中（页面上的发送键要立刻换成停止）；
        // 这次还在等正文落盘的面板不能跟着消失，否则「正在重新生成正文…」只剩一瞬。
        if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || (running && panel.phase !== "loading")) return null;
        // 没填意见的普通重新生成不等面板收尾：这一步没有要玩家跟踪的进度（按钮上已写「重生成中…」，
        // 正文区也在等新正文），表单留在原地只会让人再点一次「生成并替换正文」。
        if (panel.phase === "loading" && !loadingText) return null;
        function generate() {
            return interactions.regenerateBody(panel, guidance, { restyle: styleEnabled && Boolean(guidance.trim()) });
        }
        // 精修: like a regeneration, the panel waits and closes once the polished reply is in;
        // the comparison and its undo live on the 精修 page.
        async function runPolish() {
            const pending = { panel, id: window.crypto?.randomUUID?.() || "polish-" + Date.now() + "-" + Math.random().toString(36).slice(2) };
            polishRequest.current = pending;
            let received = false;
            setReviewing(true); setReviewNote("");
            try {
                const result = await rpc("polishBody", { guidance, requestId: pending.id }, props.sessionId);
                if (polishRequest.current !== pending) return;
                received = !result.queued;
                const skipped = result.edits.filter(edit => edit.status !== "ok").length;
                if (result.queued) setReviewNote("精修已排队，等当前回合结束后保存。");
                else if (result.guidance) { setGuidance(result.guidance); setReviewNote("审稿没有按格式输出修改清单，内容已填进意见框，可以按意见重新生成"); }
                else if (!result.view) setReviewNote(skipped ? "审稿给出的 " + skipped + " 条修改都没在正文里找到原文，正文没有改动" : "审稿没有发现需要修改的地方");
                else {
                    liveTavernView.setView(props.sessionId, result.view);
                    notifyTavernDataChanged(["sessions"], "play-controls");
                    tavernCoordination.invalidate(props.sessionId);
                    setRegenPanel(null);
                }
            } catch (error) {
                if (polishRequest.current === pending) setReviewNote("精修未确认完成：" + String(error?.message || error));
            } finally {
                if (polishRequest.current === pending) {
                    if (received) polishRequest.current = null;
                    setReviewing(false);
                }
            }
        }
        return h(RegenGuideForm, {
                title: "重新生成正文",
                loading: loadingText,
                loadingExtra: reviewing && reviewProgress?.edits?.length ? h("div", { className: "dsh-tavern-settings-desc", role: "status" },
                    h("p", null, "逐处生成中，完成后统一保存："),
                    reviewProgress.edits.map(function (edit, index) { return h("details", { key: index },
                        h("summary", null, (index + 1) + ". " + edit.reason),
                        h("p", null, h("del", null, edit.find)), h("p", null, h("ins", null, edit.replace || "（删除）"))); })) : null,
                error: panel.error || reviewNote,
                value: guidance,
                onChange: setGuidance,
                placeholder: "指导意见（可选）",
                examples: [],
                submitLabel: "生成并替换正文",
                secondary: { label: "精修", title: "按「正文精修原则」审读当前正文，直接改掉问题（一句到整段）；填了指导意见，精修后再只照意见改一次；不重新生成；前后对比、撤销和「自动精修」开关在顶部「精修」页", disabled: reviewing, onClick: runPolish },
                onSubmit: generate,
                onCancel: function () { setRegenPanel(null); }
        });
    }
    return Object.freeze({ CandidateQuestion, CandidateGuidePanel, RegenPanel });
}
