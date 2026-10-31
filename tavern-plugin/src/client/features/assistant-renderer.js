		function createTavernFrameSlashExecutor(ctx, hostWindow) {
			hostWindow = hostWindow || window;
            // A deliberately bounded, read-only subset of ST slash commands. Parse
            // every stage before reading anything; never forward a mixed pipeline.
            function slashError(message) {
                return Object.assign(new Error(message), { code: "UNSUPPORTED_SLASH_PIPELINE" });
            }
            function decodeSlashText(value) {
                value = value.trim();
                if ((value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) value = value.slice(1, -1);
                return value.replace(/\\([\\|"'])/g, '$1');
            }
            function readPipeline(line) {
                const stages = [];
                let start = 0, quote = '', escaped = false;
                for (let i = 0; i < line.length; i++) {
                    const ch = line[i];
                    if (escaped) { escaped = false; continue; }
                    if (ch === '\\') { escaped = true; continue; }
                    if (quote) { if (ch === quote) quote = ''; continue; }
                    if ((ch === '"' || ch === "'") && (i === start || /[\s=]/.test(line[i - 1]))) { quote = ch; continue; }
                    if (ch === '|') { stages.push(line.slice(start, i).trim()); start = i + 1; }
                }
                if (quote) throw slashError('人物卡命令引号未闭合');
                stages.push(line.slice(start).trim());
                return stages.map(function (stage) {
                    const match = /^\/(pass|return|findentry|findlore|findwi)(?:\s+([\s\S]*))?$/i.exec(stage);
                    if (!match) throw slashError('暂不支持这条人物卡命令管道；/pass 和 /findentry 只能与只读命令组合，未发送消息');
                    const command = match[1].toLowerCase();
                    let text = match[2] || '';
                    if (command === 'pass' || command === 'return') return { command: 'pass', text: decodeSlashText(text) };
                    const args = {};
                    while (true) {
                        const named = /^([a-zA-Z_]\w*)=/.exec(text);
                        if (!named) break;
                        const key = named[1];
                        if (!['file', 'field'].includes(key) || Object.hasOwn(args, key)) throw slashError('不支持或重复的 /findentry 参数: ' + key);
                        text = text.slice(named[0].length);
                        let end = 0;
                        if (text[0] === '"' || text[0] === "'") {
                            const quote = text[0]; end = 1;
                            for (; end < text.length; end++) {
                                if (text[end] === '\\') { end++; continue; }
                                if (text[end] === quote) { end++; break; }
                            }
                            if (end < text.length && !/\s/.test(text[end])) throw slashError('/findentry 引号后需要空格');
                        } else {
                            while (end < text.length && !/\s/.test(text[end])) end++;
                        }
                        args[key] = decodeSlashText(text.slice(0, end));
                        text = text.slice(end).trimStart();
                    }
                    const field = args.field || 'key';
                    if (!args.file) throw slashError('/findentry 需要 file=当前世界书名称（或 current）');
                    if (!['key', 'keysecondary', 'comment', 'name', 'content', 'uid'].includes(field)) throw slashError('暂不支持 /findentry 字段: ' + field);
                    return { command: 'findentry', file: args.file, field: field, text: decodeSlashText(text) };
                });
            }
            async function executeReadPipeline(line, sessionId) {
                const stages = readPipeline(line);
                let pipe = '';
                for (const stage of stages) {
                    const text = stage.text.replace(/\{\{pipe\}\}/gi, function () { return pipe; });
                    if (stage.command === 'pass') { pipe = text; continue; }
                    const file = stage.file.replace(/\{\{pipe\}\}/gi, function () { return pipe; });
                    const result = await rpc('getTavernHelperWorldbook', { name: file }, sessionId);
                    const query = text.toLowerCase();
                    let found = null, best = Infinity;
                    for (const entry of result?.worldbook?.entries || []) {
                        const field = stage.field;
                        const value = field === 'key' ? entry.strategy?.keys : field === 'keysecondary' ? entry.strategy?.keys_secondary?.keys
                            : field === 'comment' ? entry.name : entry[field];
                        for (const item of Array.isArray(value) ? value : [value]) {
                            if (item === undefined || item === null || !query) continue;
                            const candidate = String(item).toLowerCase();
                            const position = candidate.indexOf(query);
                            // Exact matches outrank substrings. Stable ties retain book order.
                            const score = candidate === query ? 0 : position < 0 ? Infinity : 1 + position + (candidate.length - query.length) / (candidate.length + 1);
                            if (score < best) { best = score; found = entry; }
                        }
                    }
                    pipe = found?.uid === undefined ? '' : String(found.uid);
                }
                return pipe;
            }
			function inputFacade(sessionId) {
				const actx = ctx.sessions.scope(sessionId);
				const conversation = ctx.get("conversation");
				if (!actx || !conversation) return null;
				try { return conversation.input.for(actx); } catch (_) { return null; }
			}
			function readInputDraft(sessionId) {
				const input = inputFacade(sessionId);
				if (!input) return "";
				try {
					const state = input.state && typeof input.state.getSnapshot === "function" ? input.state.getSnapshot() : null;
					if (state && typeof state.draft === "string") return state.draft;
				} catch (_) {}
				return "";
			}
			const execute = function (line, sessionId, options) {
                if (options && typeof options.inputText === "string") {
                    const text = options.inputText.trim();
                    const binding = ctx.sessions.binding(sessionId);
                    if (!text || !binding) return Promise.reject(new Error("开局消息为空或原对话已关闭"));
                    return Promise.resolve(binding.session.prompt([{ type:"text", text:text }], "queue")).then(function (result) {
                        if (!result?.ok) throw new Error(result?.error?.message || "消息发送失败");
                        return { submitted:true };
                    });
                }
                if (/^\s*\/(?:pass|return|findentry|findlore|findwi)(?:\s|$)/i.test(String(line))) return executeReadPipeline(String(line), sessionId);
                if (/^\/ejs(?:-refresh)?(?:\s|$)/.test(String(line))) return rpc("executeFullTemplateCommand", {text:line}, sessionId).then(function(result){return result.pipe;});
				const draftMatch = /^\/setinput(?: ([\s\S]*))?$/.exec(String(line || ""));
                // Preflight before touching the composer: otherwise the greedy
                // send match silently includes unsupported commands in the draft.
                const pipes = draftMatch ? [] : Array.from(String(line || "").matchAll(/\|\s*(\/[\w-]+)/g));
                const unsupported = pipes.find((part, index) => part[1] !== "/trigger" || index !== pipes.length - 1);
                if (!draftMatch && (/^\/cut(?:\s|$)/.test(String(line)) || unsupported || (pipes.length && !/^\/send\s/.test(String(line))))) {
                    const command = unsupported ? unsupported[1] : /^\/cut(?:\s|$)/.test(String(line)) ? "/cut" : pipes[0][1];
                    const error = new Error("暂不支持人物卡命令管道中的 " + command + "，未发送消息。当前支持 /send … | /trigger；/cut 删除楼层尚未实现。");
                    error.code = "UNSUPPORTED_SLASH_PIPELINE";
                    return Promise.reject(error);
                }
				const match = /^\/send\s+([\s\S]+)\|\s*\/trigger\s*$/.exec(String(line || ""));
				const triggerOnly = /^\/trigger\s*$/.test(String(line || ""));
				if (!draftMatch && !triggerOnly && (!match || !match[1].trim())) {
                    if (!ctx.remote?.commands?.execute) return Promise.reject(new Error("当前酒馆没有注册这条命令"));
                    return ctx.remote.commands.execute(sessionId, String(line), []).then(function (execution) {
                        if (!execution) throw new Error("当前酒馆没有注册这条命令");
                        if (execution.result?.kind === "error") throw new Error(execution.result.text || "命令执行失败");
                        return String(execution.result?.text || "");
                    });
                }
				const actx = ctx.sessions.scope(sessionId);
				const conversation = ctx.get("conversation");
				if (!actx || !conversation) return Promise.reject(new Error("当前对话输入框不可用"));
				const input = conversation.input.for(actx);
				if (draftMatch) { input.setDraft(draftMatch[1] || ""); return Promise.resolve({ drafted: true }); }
				const binding = triggerOnly && ctx.sessions.binding(sessionId);
                // DSH requires nonempty prompt content. Helper messages are already
                // persisted; admit a continuation without resending them or touching the draft.
                const triggerContent = [{ type: "text", text: "继续。" }];
                // Template execution owns the generation queue; waiting here would deadlock it.
                if (options?.waitForCompletion === false) {
                    if (triggerOnly) return Promise.resolve(binding.session.prompt(triggerContent, "queue")).then(function(result) {
                        if (!result?.ok) throw new Error(result?.error?.message || "生成提交失败");
                        return {submitted:true};
                    });
                    input.setDraft(match[1]);
                    return Promise.resolve(input.submit("queue")).then(function(){return {submitted:true};});
                }
				const sessions = ctx.sessions.list;
				return new Promise(function (resolve, reject) {
					let observedRun = false;
					let settled = false;
					let stop = function () {};
					let timer = null;
					function finish(error) {
						if (settled) return;
						settled = true;
						hostWindow.clearTimeout(timer);
						stop();
						if (error) reject(error); else resolve({ submitted: true });
					}
					function inspect() {
						const summary = sessions.getSnapshot().byId[sessionId];
						if (!summary) { finish(new Error("当前对话已关闭")); return; }
						if (summary.running === true) observedRun = true;
						else if (observedRun) finish();
					}
					stop = sessions.subscribe(inspect);
					timer = hostWindow.setTimeout(function () { finish(new Error("等待开局生成完成超时")); }, 15 * 60 * 1000);
					try {
						if (triggerOnly) {
							// Helper messages are already persisted and projected into the next request.
							Promise.resolve(binding.session.prompt(triggerContent, "queue")).then(function (result) {
								if (!result || !result.ok) finish(new Error(result && result.error && result.error.message || "开局生成提交失败"));
							}, finish);
						} else {
							input.setDraft(match[1]);
							input.submit("queue");
						}
						inspect();
					} catch (error) { finish(error); }
				});
			};
			execute.readInput = readInputDraft;
			return execute;
		}

		const tavernSessionTransition = (function () {
			let active = null;
			const listeners = new Set();
			function publish(next) {
				if (active === next) return;
				active = next;
				listeners.forEach(function (listener) { listener(); });
			}
			return {
				begin: function (preview) { publish(preview && typeof preview === "object" ? preview : {}); },
				end: function () { publish(null); },
				getSnapshot: function () { return active; },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }
			};
		})();

		const tavernConversationForkRequests = (function () {
			let handler = null;
			return Object.freeze({
				bind: function (next) {
					handler = next;
					return function () { if (handler === next) handler = null; };
				},
				request: function (input) {
					if (typeof handler !== "function") return Promise.reject(new Error("分叉功能尚未就绪，请刷新页面后重试"));
					return Promise.resolve(handler(input));
				}
			});
		})();

		// the one shared large view (image-viewer.js openSceneImage).
		function openSceneImagePreview(url, opener, version, onEditPrompt, gallery, label) { return openSceneImage(url, opener, version, onEditPrompt, gallery, label); }

		function createTavernAssistantRendererFeatureModule() {
			function TavernUserNodeView(props) {
				const data = props.node.data;
				const location = props.node.location;
				const turnRef = location && (location.kind === "turn" || location.kind === "step") ? location.turn : null;
				const turn = turnRef ? Number(turnRef.turn) : 0;
				const liveState = useScopedLiveTavernView(props.sessionId, String(data.time || ""), [["mode"], ["canEditBody"], ["replayFailedTurn"], ["editableUserInputTurns"], ["failedUserInputTurns"], ["transcriptTurns"], ["transcriptFrom"], ["inputSources", String(turn)], ["inputTemplateDisplays", String(turn)], ["userInputEdits", String(turn)]]);
				const parts = userContentParts(data.content);
				// The host keeps rendering the original append node; an edited player
				// input is carried back by the view instead (see bodyEditor.saveUser).
				const editedText = liveState.view?.userInputEdits?.[String(turn)];
				const text = typeof editedText === "string" ? editedText : tavernUserTextForTurn(liveState.view, turn, data.content);
				const [copied, setCopied] = React.useState(false);
				const copyTimer = React.useRef(null);
				React.useEffect(function () { return function () { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }; }, []);
				function copy() {
					DshUi.writeClipboard(text).then(function (ok) {
						if (!ok) return;
						setCopied(true);
						if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
						copyTimer.current = window.setTimeout(function () { copyTimer.current = null; setCopied(false); }, 1000);
					});
				}
				// The row plan hides rolled-back and superseded turns, but the host keeps
				// drawing their nodes forever. Name the last input the page shows, not
				// the last one the log ever appended.
				const transcriptTurns = liveState.view?.transcriptTurns;
				const transcriptFrom = liveState.view?.transcriptFrom;
				const latestUserTurn = props.useChat(React.useCallback(function (snapshot) {
					return latestTavernUserTurn(snapshot, transcriptTurns ? { turns: transcriptTurns, from: transcriptFrom } : null);
				}, [transcriptTurns, transcriptFrom]));
				const selectAssistantId = React.useCallback(function (snapshot) { return tavernAssistantMessageIdForTurn(snapshot, turn); }, [turn]);
				const assistantMessageId = props.useChat(selectAssistantId);
				const forkState = useScopedLiveTavernView(props.sessionId, "user-fork:" + String(assistantMessageId || ""), [["mode"], ["forkTurnsByMessageId", String(assistantMessageId || "")]]);
				const running = props.useSession(function (snapshot) { return snapshot.running === true; });
				const [forking, setForking] = React.useState(false);
				const [editBusy, setEditBusy] = React.useState(false);
				const playView = Boolean(liveState.view && isPlayMode(liveState.view.mode));
				const forkTurn = Number(forkState.view && forkState.view.forkTurnsByMessageId && forkState.view.forkTurnsByMessageId[String(assistantMessageId || "")]) || 0;
				const canFork = playView && forkTurn > 0;
				// Only the latest player input offers the quick edit; earlier floors keep
				// their text so an edit cannot move the current round.
				const editableTurns = Array.isArray(liveState.view?.editableUserInputTurns) ? liveState.view.editableUserInputTurns : [];
				const failedTurns = Array.isArray(liveState.view?.failedUserInputTurns) ? liveState.view.failedUserInputTurns : [];
				const committedEdit = editableTurns.some(value => Number(value) === Number(turn));
				const failedEdit = failedTurns.some(value => Number(value) === Number(turn));
				const canEdit = playView && latestUserTurn > 0 && Number(turn) === Number(latestUserTurn) && !running
					&& liveState.view?.canEditBody !== false && (committedEdit || failedEdit);
				async function fork() {
					if (forking) return;
					setForking(true);
					try { await tavernConversationForkRequests.request({ sessionId: props.sessionId, turn: forkTurn }); }
					catch (error) { tavernErrorHub.report("分叉对话", error); }
					finally { setForking(false); }
				}
				async function edit() {
					if (editBusy) return;
					setEditBusy(true);
					try {
						const result = await rpc("getBodyEdit", { role: "user", turn, seq: data.seq }, props.sessionId);
						window.dispatchEvent(new CustomEvent("dsh-tavern-open-body-edit", { detail: { sessionId: props.sessionId, edit: result.edit,
							texts: result.edit.parts.filter(function (part) { return part.kind === "text"; }).map(function (part) { return part.text; }) } }));
					} catch (error) { tavernErrorHub.report("编辑输入", error); }
					finally { setEditBusy(false); }
				}
				const renderedImages = renderTavernMessageImages(props, parts.images, "end");
				const extras = parts.rest.map(function (block, index) {
					return React.createElement("div", { key: index, className: "dsh-tavern-user-extra" }, React.createElement(DshUi.JsonBlock, { label: typeof props.t === "function" ? props.t("message.extraBlock") : "附加内容", payload: block, truncatedLabel: function (total) { return "内容过长（共 " + String(total) + " 项）"; } }));
				});
				const time = Number.isFinite(Number(data.time)) ? new Date(Number(data.time)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
				const templateDisplay = typeof editedText === "string" ? null : liveState.view?.inputTemplateDisplays?.[turn];
				return React.createElement("div", { className: "dsh-tavern-user-row" },
					React.createElement("div", { className: "dsh-tavern-user-stack" }, renderedImages, (text !== "" || extras.length > 0) ? React.createElement("div", { className: "dsh-tavern-user-bubble" }, templateDisplay ? React.createElement(TavernMessageFrame, {content:templateDisplay,sessionId:props.sessionId,turn:turn,partIndex:"user-template",frameOwner:props.frameOwner,eager:true}) : React.createElement("div", { style: { whiteSpace: "pre-wrap" } }, text), extras) : null),
					React.createElement("div", { className: "dsh-tavern-user-actions" }, time ? React.createElement("span", null, time) : null,
						canEdit ? React.createElement(DshUi.Tooltip, { label: "编辑这条输入", side: "bottom" }, React.createElement("button", { type: "button", className: "dsh-tavern-user-edit", "aria-label": "编辑这条输入", disabled: editBusy, onClick: edit }, React.createElement(DshUi.IconEditOutlineRegular, null))) : null,
						canFork ? React.createElement(DshUi.Tooltip, { label: forking ? "正在分叉…" : "从这一轮分叉", side: "bottom" }, React.createElement("button", { type: "button", className: "dsh-tavern-user-fork", "aria-label": "从这一轮分叉", disabled: forking, onClick: fork }, React.createElement(DshUi.IconBranchOutlineRegular, null))) : null,
						React.createElement(DshUi.Tooltip, { label: copied ? "已复制" : "复制", side: "bottom" }, React.createElement("button", { type: "button", className: "dsh-tavern-user-copy", "aria-label": copied ? "已复制" : "复制", onClick: copy }, React.createElement(copied ? DshUi.IconCheckOutlineRegular : DshUi.IconCopyOutlineRegular, null))))
				);
			}
			function tavernAssistantViewPaths(turn, eager = true) {
				return ["mode", eager ? "tavernHelper" : "$helperAvailable",
					"cardSave", "tavernRuntimePolicy", "tavernMvuRuntime", "statusBarPlacement", "regenInProgress", "replacingDshTurns", "suppressedDshTurns"].map(field => [field]).concat([["$projectionTurn", String(turn)], ["$projectionLatestTurn", String(turn)]]);
			}
			function tavernReceiptViewPaths(turn, receipt, latest) {
				const paths = [["$mvuReceiptTurn", String(turn)], ["$settlementOwner", String(turn)], ["polishedTurns"], ["autoPolishedTurns"]];
				if (latest || receipt?.status === "pending") paths.push(["$receiptBusy"]);
				return paths;
			}
			function TavernTurnMvuReceipt(props) {
				const current = liveTavernView.getSnapshot(props.sessionId).view;
				const state = useLiveTavernView(props.sessionId, "receipt", tavernReceiptViewPaths(props.turn,
					tavernMvuReceiptForTurn(current, props.turn), props.turn === current?.settlementTurn));
				const receipt = tavernMvuReceiptForTurn(state.view, props.turn);
				// This reply's text is a 精修 (manual or automatic): a small mark, the 精修 page has the comparison.
				const view = state.view || current;
				const auto = (view?.autoPolishedTurns || []).includes(Number(props.turn));
				const polished = auto || (view?.polishedTurns || []).includes(Number(props.turn))
					? React.createElement("div", { className: "dsh-tavern-auto-polished", title: (auto ? "正文写完后已按精修原则自动润色" : "这轮正文已精修") + "，「精修」页可对比和撤销" }, "已精修") : null;
				return receipt ? React.createElement(React.Fragment, null, React.createElement(TavernMvuReceipt, { ...props, receipt,
					latest: props.turn === state.view?.settlementTurn, busy: Boolean(state.view?.activity?.busy) }), polished) : polished;
			}
			function TavernInlineStatusRuntime(props) {
				const state = useLiveTavernView(props.sessionId, "inline-status");
				return state.view ? React.createElement(TavernPersistentStatusRuntime, {
					sessionId: props.sessionId, view: state.view, executeSlash: props.executeSlash, panels: "status"
				}) : null;
			}
            function TavernPreparedScriptMessage(props) {
                const [status, setStatus] = React.useState("idle");
                const sending = React.useRef(false);
                const [error, setError] = React.useState("");
                return React.createElement("div", {className:"dsh-tavern-hint", "data-dsh-script-message":true},
                    React.createElement("p", null, status === "sent" ? "卡片消息已提交。" : "有一条卡片准备的消息尚未发送。"),
                    React.createElement("button", {type:"button", className:"dsh-tavern-btn", disabled:status !== "idle", onClick:async function () {
                        if (sending.current) return;
                        sending.current = true; setStatus("sending"); setError("");
                        try {
                            await props.executeSlash("", props.sessionId, {inputText:props.preparedText});
                            setStatus("sent");
                        } catch (err) { sending.current = false; setStatus("idle"); setError(String(err && err.message || err)); }
                    }}, status === "sent" ? "已提交" : status === "sending" ? "正在提交…" : "发送卡片消息"),
                    error ? React.createElement("p", {role:"alert"}, error) : null);
            }

            function TavernLegacyGreeting(props) {
                const native = React.useRef(null), node = React.useRef(null);
                React.useLayoutEffect(function () {
                    return mountTavernLegacyMessage({node:node.current, native:native.current, source:props.source});
                }, [props.source]);
                return React.createElement("div", {className:"mes", mesid:"0", is_user:"false"},
                    React.createElement("div", {ref:native}, props.children),
                    React.createElement("div", {ref:node, "data-dsh-legacy-message":"0"}));
            }

			// DSH owns the chat list; Tavern owns what each floor renders. Floors older than the
			// latest twenty that sit far outside the viewport keep only their measured height, so
			// a long history loaded with "load earlier" no longer keeps every paragraph in the page.
			const TAVERN_LIVE_FLOORS = 20;
			const TAVERN_DISTANT_FLOOR_MARGIN = "2000px 0px";
			const TAVERN_DISTANT_FLOOR_DELAY = 2000;
			function useTavernDistantFloor(ref, enabled) {
				const [height, setHeight] = React.useState(0);
				React.useEffect(function () {
					const node = ref.current;
					if (!enabled || !node || typeof window.IntersectionObserver !== "function") { setHeight(0); return; }
					let timer = null;
					const observer = new window.IntersectionObserver(function (entries) {
						if (entries[entries.length - 1]?.isIntersecting) {
							if (timer !== null) { window.clearTimeout(timer); timer = null; }
							setHeight(0);
						} else if (timer === null) timer = window.setTimeout(function () {
							timer = null;
							const measured = node.getBoundingClientRect().height;
							if (measured > 0) setHeight(measured);
						}, TAVERN_DISTANT_FLOOR_DELAY);
					}, { rootMargin: TAVERN_DISTANT_FLOOR_MARGIN });
					observer.observe(node);
					return function () { observer.disconnect(); if (timer !== null) window.clearTimeout(timer); };
				}, [ref, enabled]);
				return height;
			}

			// opening a long chat used to mount every loaded floor in the host's one React
			// commit (小圆: 12 floors, ~20k nodes, ~300 ms). A settled floor other than the latest is first rendered as an
			// empty placeholder and gets its content once it is within TAVERN_DEFERRED_FLOOR_VIEWPORTS of the chat
			// viewport. The check runs before paint (a rAF after the commit, and the scroller's scroll event, which also
			// follows the host's toBottom, restored position and turn jumps), so a placeholder is never painted in view;
			// an IntersectionObserver is the backstop (resize, leaving the stage). Floors only go from placeholder to
			// mounted. The stage text index, 履历, jumps and voice read the session, not this DOM.
			const TAVERN_EAGER_FLOORS = 1;
			const TAVERN_DEFERRED_FLOOR_VIEWPORTS = 1.5;
			const tavernDeferredFloors = (function () {
				const pending = new Map(), observers = new WeakMap();
				let frame = null, listening = false;
				function flowItem(node) { return node.closest('[class*="_flowItem"]') || node; }
				function mountAll(mounts) {
					if (!mounts.length) return;
					const run = function () { mounts.forEach(function (mount) { mount(); }); };
					// Commit before this frame paints; outside React work flushSync is synchronous.
					if (ReactDOM && typeof ReactDOM.flushSync === "function") ReactDOM.flushSync(run); else run();
				}
				function release(node) {
					const entry = pending.get(node);
					if (!entry) return null;
					pending.delete(node);
					entry.observer?.unobserve(node);
					if (!pending.size && listening) { document.removeEventListener("scroll", check, true); listening = false; }
					return entry.mount;
				}
				function check(event) {
					if (event && event.type === "scroll" && ![...pending.values()].some(function (entry) { return entry.scroller === event.target; })) return;
					if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
					// Under the stage cover the transcript is content-visibility:hidden; a rect read there would
					// lay out the whole skipped chat. The observer mounts what is near once it is uncovered.
					if (!pending.size || document.documentElement.hasAttribute("data-fork-gal-stage")) return;
					const views = new Map(), near = [];
					for (const [node, entry] of pending) {
						if (!node.isConnected) { release(node); continue; }
						const scroller = entry.scroller;
						let view = views.get(scroller);
						if (!view) {
							const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
							const margin = (box.height || window.innerHeight) * TAVERN_DEFERRED_FLOOR_VIEWPORTS;
							view = { top: box.top - margin, bottom: box.bottom + margin, shown: box.height > 0 };
							views.set(scroller, view);
						}
						if (!view.shown) continue;
						const box = flowItem(node).getBoundingClientRect();
						if (box.height > 0 && box.bottom >= view.top && box.top <= view.bottom) near.push(node);
					}
					mountAll(near.map(release).filter(Boolean));
				}
				function observerFor(scroller) {
					if (!scroller || typeof window.IntersectionObserver !== "function") return null;
					let observer = observers.get(scroller);
					if (!observer) {
						observer = new window.IntersectionObserver(function (entries) {
							mountAll(entries.filter(function (entry) { return entry.isIntersecting; }).map(function (entry) { return release(entry.target); }).filter(Boolean));
						}, { root: scroller, rootMargin: TAVERN_DEFERRED_FLOOR_VIEWPORTS * 100 + "% 0px" });
						observers.set(scroller, observer);
					}
					return observer;
				}
				return {
					add(node, mount) {
						if (!node) { mount(); return function () {}; }
						const scroller = node.closest("[data-conversation-scroll]"), observer = observerFor(scroller);
						pending.set(node, { mount, scroller, observer });
						observer?.observe(node);
						if (!listening) { document.addEventListener("scroll", check, { capture: true, passive: true }); listening = true; }
						// After the commit (host scroll restore / toBottom included), before the first paint.
						if (frame === null) frame = requestAnimationFrame(function () { frame = null; check(); });
						return function () { release(node); };
					}
				};
			})();
			function useTavernLatestDshTurn(useChat) {
				const latest = typeof useChat === "function" ? useChat(function (chat) { const order = chat && chat.timeline && chat.timeline.turnOrder; return order && order.length ? order[order.length - 1] : null; }) : null;
				return latest === null || latest === undefined || !Number.isFinite(Number(latest)) ? null : Number(latest);
			}
			function useTavernDeferredFloor(ref, far, content) {
				// Decided once, by the first render that would mount the floor's content (an old floor may first wait
				// for its history window): a floor that grows old while mounted stays mounted.
				const decided = React.useRef(null), [mounted, setMounted] = React.useState(false);
				if (decided.current === null && content) decided.current = far;
				const deferred = decided.current === true && !mounted;
				React.useLayoutEffect(function () {
					if (deferred) return tavernDeferredFloors.add(ref.current, function () { setMounted(true); });
				}, [ref, deferred]);
				return deferred;
			}

			// Third-party plugins: use the public tavernUi API (docs/plugin-api.md), never patch this file; its structure changes freely.
			function TavernReasoningSeat(props) {
				const blocks = (Array.isArray(props.blocks) ? props.blocks : []).filter(function (block) { return block && block.kind === "reasoning"; });
				if (!blocks.length) return null;
				return React.createElement("div", { className: "dsh-tavern-assistant" }, blocks.map(function (block, index) {
					const live = props.streaming && index === blocks.length - 1;
					return React.createElement("details", { key: index, className: "dsh-tavern-assistant-reasoning", open: live }, React.createElement("summary", null, live ? "思考中…" : "思考过程"), React.createElement("pre", null, String(block.text || "")));
				}));
			}
			// Card-workbench replies a plugin asked to fold (tavernUi.registerReplyPresenter):
			// the answer to a presented question is one line, and 展开 brings the original back.
			// Decisions are cached per turn so a re-render does not call into plugins again;
			// 展开 survives scrolling a message out of view, but not a page reload.
			const tavernReplyFoldDecisions = new Map();
			const tavernReplyFoldOpen = new Set();
			function tavernReplyFoldFor(input) {
				if (!input.turn || String(input.text || "").trim() === "") return null;
				const key = input.sessionId + ":" + input.turn;
				const cached = tavernReplyFoldDecisions.get(key);
				// A presenter that was disposed (plugin disabled, fold switch off) must
				// not keep its cached fold: recompute and unfold on the next render.
				const stillRegistered = Boolean(cached) && tavernUiExtensions.replyPresenters().some(function (presenter) { return presenter.owner === cached.owner; });
				if (cached && cached.text === input.text && stillRegistered) return cached;
				if (cached && !stillRegistered) tavernReplyFoldDecisions.delete(key);
				const found = tavernUiExtensions.presentReply(input);
				if (!found) { tavernReplyFoldDecisions.delete(key); return null; }
				const entry = { text: input.text, owner: found.owner, summary: found.fold.summary };
				tavernReplyFoldDecisions.set(key, entry);
				// A long conversation should not pin every old decision in memory.
				if (tavernReplyFoldDecisions.size > 200) tavernReplyFoldDecisions.delete(tavernReplyFoldDecisions.keys().next().value);
				return entry;
			}
			function TavernAssistantNodeView(props) {
				useTavernUiExtensions();
				useTavernProseLayoutRevision();
				const data = props.node.data;
                const historyNode = React.useRef(null);
				const turnRef = props.node.location.kind === "turn" || props.node.location.kind === "step" ? props.node.location.turn : null;
				const turn = turnRef ? Number(turnRef.turn) : 0;
				const settled = data.status !== "running";
				const revision = String(data.status || "") + ":" + String(data.finalNode && data.finalNode.seq || "");
				const mapping = useLiveTavernView(props.sessionId, revision, [["$storyHostTurn", String(turn)]]);
				const storyTurn = tavernStoryTurnForDshTurn(mapping.view, turn);
				const currentView = liveTavernView.getSnapshot(props.sessionId).view;
                const liveState = useLiveTavernView(props.sessionId, revision, tavernAssistantViewPaths(storyTurn, storyTurn > 0 && storyTurn === tavernLatestProjectionTurn(currentView)));
				const sessionTransitioning = React.useSyncExternalStore(tavernSessionTransition.subscribe, tavernSessionTransition.getSnapshot, tavernSessionTransition.getSnapshot);
				const tail = props.useTurnData("turn-tail");
				const [, setFoldRevision] = React.useState(0);
				// DSH draws one node per step. A turn with tool calls has several steps, but its story,
				// pictures and receipts belong to the turn: only the step that closes it shows them;
				// earlier steps keep their own (usually empty) text (#222).
				const ownsTurn = !tail || !tail.closing || !data.finalNode || tail.closing.finalNode.seq === data.finalNode.seq;
					const projection = settled && ownsTurn ? tavernProjectionForTurn(liveState.view, storyTurn) : null;
					const latestProjectionTurn = tavernLatestProjectionTurn(liveState.view);
				// Only the latest 3 rounds run a card's HTML interface (heavy status bars);
				// earlier ones show text and a 「渲染此轮」 button.
				const [renderRound, setRenderRound] = React.useState(false);
				const deferHtml = !renderRound && storyTurn > 0 && latestProjectionTurn - storyTurn >= 3 ? function () { setRenderRound(true); } : null;
                React.useEffect(function () {
                    if(!historyNode.current || !currentView?.historyWindow || !ownsTurn || projection || storyTurn<=0 || storyTurn>=tavernLatestProjectionTurn(currentView))return;
                    let cancelWait = null;
                    const node = historyNode.current;
                    const inView = () => { const box = node.getBoundingClientRect(); return box.bottom > 0 && box.top < window.innerHeight; };
                    const observer = new IntersectionObserver(entries=>{
                        if(!entries.some(entry=>entry.isIntersecting) || cancelWait) return;
                        // Only when the player scrolled here; a floor a layout change showed waits.
                        cancelWait = whenScrolledByPlayer(()=>{
                            cancelWait = null;
                            if (!inView()) return;
                            observer.disconnect();
                            void requestOlderHistory(props.sessionId,currentView.historyWindow.from).catch(error=>tavernErrorHub.report("读取历史",error));
                        });
                    });
                    observer.observe(node);
                    return ()=>{ observer.disconnect(); if (cancelWait) cancelWait(); };
                },[props.sessionId,storyTurn,projection,currentView?.historyWindow?.revision,currentView?.historyWindow?.from]);
				const owner = React.useMemo(function () {
					if (!turnRef || turnRef.status !== "closed" || !data.finalNode || !tail || !tail.closing || tail.closing.finalNode.seq !== data.finalNode.seq) return undefined;
					return { turn: turnRef, seq: data.finalNode.seq, openFile: props.openFile };
				}, [turnRef, data.finalNode, tail, props.openFile]);
				const mentions = React.useMemo(function () { return owner === undefined ? undefined : props.fileMentions(owner); }, [owner, props.fileMentions]);
				const copyLabel = props.t ? props.t("copy") : "复制", copiedLabel = props.t ? props.t("copied") : "已复制";
				const codeLabels = React.useMemo(() => ({ copyLabel, copiedLabel }), [copyLabel, copiedLabel]);
				const superseded = galIsSuperseded(liveState.view, turn, storyTurn);
				const forkStageSource = React.useMemo(() => ({ nativeTurn: turn, nodeId: props.node.id, order: props.node.anchorSeq, superseded }), [turn, props.node.id, props.node.anchorSeq, superseded]);
				const waitingForHistory = Boolean(currentView?.historyWindow && ownsTurn && !projection && settled && storyTurn>0 && storyTurn<latestProjectionTurn);
				const playView = isPlayMode(liveState.view && liveState.view.mode) && storyTurn > 0 && !sessionTransitioning && ownsTurn;
				useTavernUiExtensions();
				useTavernProseLayoutRevision();
				const turnView = useTavernTurnView(props.sessionId);
				const pluginMedia = useTavernPluginMedia(props.sessionId, storyTurn, playView && settled);
				const pluginText = playView ? createTavernPluginTextContext({ items: pluginMedia.items, extras: [], sessionId: props.sessionId, turn: storyTurn, streaming: data.status === "running" }) : null;

                // 正文走工具调用时整段正文一次性落地：宿主把提交折叠成一条普通回复，
                // 消息 ID 带 tavern-tool-reply: 前缀。普通逐字流式的回复没有这个前缀，
                // 生成完仍停在末尾，读者不会被打断。只有页面看着这一回合跑完、读者
                // 本来就在跟随底部时，才把正文开头放回视口顶部。
                const replyMessageId = data.finalNode && typeof data.finalNode.messageId === "string" ? data.finalNode.messageId : "";
                const replyText = (Array.isArray(data.blocks) ? data.blocks : []).filter(function (block) { return block && block.kind === "text"; })
                    .map(function (block) { return String(block.text || ""); }).join("\n");
                React.useLayoutEffect(function () {
                    if (!playView || !settled || replyText.trim() === "") return;
                    if (!replyMessageId.startsWith("tavern-tool-reply:")) return;
                    if (!tavernReplyRunWatch || !tavernReplyRunWatch.watching(props.sessionId)) return;
                    if (tavernReplyRunWatch.seen(props.sessionId, replyMessageId)) return;
                    tavernReplyRunWatch.mark(props.sessionId, replyMessageId);
                    if (historyNode.current) tavernReplyReveal(historyNode.current, { host: window });
                }, [props.sessionId, replyMessageId, replyText, playView, settled]);
                // The host chat store knows the latest turn before the Tavern view has loaded (a reload, a cold chat).
                const latestDshTurn = useTavernLatestDshTurn(props.useChat);
                const eagerFloor = latestDshTurn !== null && turn > 0 && turn === latestDshTurn || storyTurn > 0 && latestProjectionTurn > 0 && latestProjectionTurn - storyTurn < TAVERN_EAGER_FLOORS;
                const deferredFloor = useTavernDeferredFloor(historyNode, settled && !eagerFloor && (data.blocks || []).length > 0, !sessionTransitioning && !waitingForHistory);
                // the newest floor is on screen when the chat opens; tavern.css keeps it out of
                // content-visibility, so the deferred floors measure it at its real height, not the 800 px estimate.
                const floorShown = data.status === "running" || data.status === "interrupted" || (data.blocks || []).length > 0;
                React.useLayoutEffect(function () {
                    const item = eagerFloor && historyNode.current ? historyNode.current.closest('[class*="_flowItem"]') : null;
                    if (!item) return;
                    item.setAttribute("data-fork-latest-floor", "");
                    return function () { item.removeAttribute("data-fork-latest-floor"); };
                }, [eagerFloor, floorShown]);
                const rendered = sessionTransitioning ? [React.createElement("div", { key: "switching", className: "dsh-tavern-session-switching", role: "status" }, "正在完成游戏初始化…")] : waitingForHistory ? [React.createElement("div", {key:"history",role:"status"}, "正在读取历史内容…")] : deferredFloor ? [] : renderTavernAssistantBlocks({
					// Publish native identity and this node's regeneration decision, not the whole view.
					forkStageSource,
					codeLabels,
					blocks: isPlayMode(liveState.view?.mode) && !ownsTurn ? [] : data.blocks,
					groupPart: props.groupPart,
					deferHtml: deferHtml,
					streaming: data.status === "running",
					interrupted: data.status === "interrupted",
					// also prepare the newest reply after a reload, not only turns seen streaming.
					voiceAuto: voiceObservedTurn(props.sessionId, turn, data.status === "running") || (settled && storyTurn > 0 && storyTurn === latestProjectionTurn),
					projection: projection,
					helperContext: liveState.view && liveState.view.tavernHelper,
                    frameSizing: liveState.view?.tavernRuntimePolicy?.frameSizing,
                    helperContextReader: () => liveTavernView.getSnapshot(props.sessionId).view?.tavernHelper,
					trustedCardMode: Boolean(liveState.view && liveState.view.tavernRuntimePolicy && liveState.view.tavernRuntimePolicy.trustedCardMode),
					htmlSketches: Boolean(liveState.view && groupOfMode(liveState.view.mode) === "card"),
					frameOwner: props.frameOwner,
                    eagerFrame: storyTurn > 0 && storyTurn === latestProjectionTurn,
					executeSlash: props.executeSlash,
					sessionId: props.sessionId,
					turn: storyTurn,
					scriptLayer: (function () {
						const messageId = liveState.view?.tavernHelper?.turnMessageIds?.[String(storyTurn)];
						return settled && !sessionTransitioning && Number.isSafeInteger(messageId) && liveState.view?.tavernRuntimePolicy?.trustedCardMode
							? { sessionId: props.sessionId, messageId: messageId } : null;
					})(),
					renderMessageImages: function (images) { return renderTavernMessageImages(props, images && images.images, images && images.align); },
					plugin: pluginText,
					mentions: mentions,
					t: props.t
				});
				const distantHeight = useTavernDistantFloor(historyNode, !deferredFloor && settled && !sessionTransitioning && storyTurn > 0 && latestProjectionTurn - storyTurn >= TAVERN_LIVE_FLOORS);
				// A reply the row plan does not draw (an old body being regenerated, a repair
				// copy): its row is hidden; render nothing into it either. After all hooks.
				if (!tavernPlanShowsRow(tavernPlanOf(liveState.view), String(turn), "assistant-step")) return null;
				if (deferredFloor) return React.createElement("div", { ref:historyNode, className: "dsh-tavern-assistant", "data-deferred-floor": true, style: { minHeight: "800px" } });
				if (!(data.status === "running" || data.status === "interrupted" || rendered.length > 0)) return null;
				if (distantHeight > 0) return React.createElement("div", { ref:historyNode, className: "dsh-tavern-assistant", "data-distant-floor": true, style: { height: distantHeight + "px" } });
				// A registered presenter may fold this finished reply into one line; only the step
				// that closes the turn may, so earlier tool steps keep their own (usually empty) text.
				const replyTextForFold = (Array.isArray(data.blocks) ? data.blocks : []).filter(function (block) { return block && block.kind === "text"; }).map(function (block) { return String(block.text || ""); }).join("\n");
				const cardSave = liveState.view?.cardSave;
				const replyChanged = Boolean(cardSave && Number(cardSave.turn) === turn && (cardSave.changed === true || cardSave.createsCard === true));
				const fold = settled && ownsTurn && !sessionTransitioning
					? tavernReplyFoldFor({ sessionId: props.sessionId, mode: String(liveState.view?.mode || ""), turn: turn, text: replyTextForFold, changed: replyChanged, streaming: false })
					: null;
				const foldKey = props.sessionId + ":" + turn;
				const foldOpen = fold !== null && tavernReplyFoldOpen.has(foldKey);
				if (fold !== null && !foldOpen) {
					return React.createElement("button", {
						type: "button", className: "dsh-tavern-assistant-fold", "aria-expanded": false, title: "展开这一轮的原文",
						onClick: function () { tavernReplyFoldOpen.add(foldKey); setFoldRevision(function (value) { return value + 1; }); }
					},
						React.createElement("span", { className: "dsh-tavern-assistant-fold-paw", "aria-hidden": true }, "🐾"),
						React.createElement("b", null, fold.summary),
						React.createElement("span", { className: "dsh-tavern-assistant-fold-hint" }, "· 展开"));
				}
				const foldBack = foldOpen ? React.createElement("button", {
					type: "button", className: "dsh-tavern-assistant-fold-back", "aria-expanded": true, title: "收起到一行",
					onClick: function () { tavernReplyFoldOpen.delete(foldKey); setFoldRevision(function (value) { return value + 1; }); }
				}, "🐾 收起") : null;
				const mvuReceiptNode = settled && ownsTurn ? React.createElement(TavernTurnMvuReceipt, { sessionId: props.sessionId, turn: storyTurn }) : null;
                const inlineStatus = liveState.view?.statusBarPlacement === "body" && !sessionTransitioning && storyTurn > 0 && storyTurn === latestProjectionTurn && data.finalNode && tail?.closing?.finalNode?.seq === data.finalNode.seq
                    ? React.createElement(TavernInlineStatusRuntime, { sessionId: props.sessionId, executeSlash: props.executeSlash }) : null;
                const helper = liveState.view?.tavernHelper;
                const greetingId = helper?.turnMessageIds?.[String(storyTurn)];
                const legacyGreeting = settled && !sessionTransitioning && greetingId === 0 && liveState.view?.tavernRuntimePolicy?.trustedCardMode;
                const greetingSource = helper?.messages?.[0]?.message || "";
                // Recover messages staged by earlier system versions, independent
                // of any card name, wording, or rendered guide DOM.
                const prepared = helper?.chatMetadata?.dsh_pending_opening;
                const pendingMessage = greetingId === 0 && helper?.messages?.length === 1
                    && prepared?.lifecycleRevision === Number(helper?.lifecycleRevision || 0)
                    && typeof prepared.text === "string" && prepared.text.trim()
                    ? React.createElement(TavernPreparedScriptMessage, {key:props.sessionId+":"+prepared.lifecycleRevision, sessionId:props.sessionId, preparedText:prepared.text, executeSlash:props.executeSlash}) : null;
                const tavernBody = legacyGreeting ? React.createElement(TavernLegacyGreeting, {key:props.sessionId+":greeting", source:greetingSource, sessionId:props.sessionId, executeSlash:props.executeSlash}, rendered) : rendered;
                // A plugin's look for the whole turn (registerTurnView) wraps Tavern's own rendering.
                const body = playView && !waitingForHistory ? tavernTurnViewElement(turnView.view, { gameId: props.sessionId, turn: storyTurn, settled: settled, streaming: data.status === "running",
                    greeting: greetingId === 0, text: (data.blocks || []).filter(block => block && block.kind === "text").map(block => String(block.text || "")).join("\n"),
                    lines: bubbleCastLines(projection && projection.body) }, tavernBody) : tavernBody;
                const refusalNotice = settled && !sessionTransitioning ? tavernModelRefusalNotice((data.blocks || []).filter(block => block && block.kind === "text").map(block => String(block.text || "")).join("\n")) : "";
                const refusalNode = refusalNotice ? React.createElement("div", { className: "dsh-tavern-refusal-notice", role: "note" }, refusalNotice) : null;
				// Plugin media without a found anchor goes after the text.
				const trailingMedia = pluginMedia.items.filter(function (item) { return !(pluginText && pluginText.placed.has(item.id)); });
				const pluginMediaNode = trailingMedia.length ? React.createElement("div", { className: "dsh-tavern-plugin-media-list" }, trailingMedia.map(function (item) {
					return React.createElement(TavernPluginMediaItem, { key: item.id, item: item, sessionId: props.sessionId, turn: storyTurn });
				})) : null;
				const pluginActions = playView && settled ? React.createElement(TavernPluginMessageActions, { sessionId: props.sessionId, turn: storyTurn, settled: settled, text: replyTextForFold }) : null;
				// the round's tavern_roll results lead its story text (dice-roll.js).
				const diceNode = typeof props.useChat === "function" ? tavernStageBoundary("骰子", React.createElement(DiceRolls, { useChat: props.useChat, nativeTurn: turn, nodeKey: props.node.key })) : null;
				const illustrationDraft = playView && settled ? React.createElement(TavernIllustrationDraft, { sessionId: props.sessionId, turn: storyTurn, items: pluginMedia.items }) : null;
				return React.createElement("div", { ref:historyNode, className: "dsh-tavern-assistant", "data-streaming": data.status === "running" || undefined }, foldBack, diceNode, body, refusalNode, pendingMessage, pluginMediaNode, illustrationDraft, pluginActions, mvuReceiptNode, inlineStatus);
			}
			function TavernForkAssistantAction(props) {
				const liveState = useScopedLiveTavernView(props.sessionId, String(props.messageId || ""), [["mode"], ["forkTurnsByMessageId", String(props.messageId || "")]]);
				const [forking, setForking] = React.useState(false);
				const view = liveState.view;
				const forkTurn = Number(view && view.forkTurnsByMessageId && view.forkTurnsByMessageId[String(props.messageId || "")]) || 0;
				const canFork = view && isPlayMode(view.mode) && forkTurn > 0;
				if (!canFork) return null;
				async function fork() {
					if (forking) return;
					setForking(true);
					try { await tavernConversationForkRequests.request({ sessionId: props.sessionId, turn: forkTurn }); }
					catch (error) { tavernErrorHub.report("分叉对话", error); }
					finally { setForking(false); }
				}
				return React.createElement(DshUi.Tooltip, { label: forking ? "正在分叉…" : "从这一轮分叉", side: "bottom" },
					React.createElement("button", { type: "button", className: "dsh-tavern-message-fork", "aria-label": "从这一轮分叉", disabled: forking, onClick: fork },
						React.createElement(DshUi.IconBranchOutlineRegular, null)));
			}
			function TavernIllustrateAssistantAction(props) {
				const liveState = useScopedLiveTavernView(props.sessionId, String(props.messageId || ""), [["mode"], ["forkTurnsByMessageId", String(props.messageId || "")]]);
				const view = liveState.view;
				const turn = Number(view && view.forkTurnsByMessageId && view.forkTurnsByMessageId[String(props.messageId || "")]) || 0;
				useTavernUiExtensions();
				useTavernProseLayoutRevision();
				const play = Boolean(view && isPlayMode(view.mode) && turn > 0);
				// Tavern draws nothing itself; an illustrator plugin answers this button.
				const illustrator = play ? tavernUiExtensions.illustrator() : null;
				return illustrator && tavernPluginAllowed(illustrator.owner, props.sessionId) ? React.createElement(TavernPluginIllustrateAction, { key: props.sessionId + ":" + turn, sessionId: props.sessionId, turn: turn, illustrator: illustrator }) : null;
			}
			// Drawn like DSH's own action icons (copy, branch): 16px, 1px strokes.
			function TavernIllustrateIcon() {
				return React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, strokeWidth: 1 },
					React.createElement("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor" }),
					React.createElement("circle", { cx: 5.5, cy: 6, r: 1.25, stroke: "currentColor" }),
					React.createElement("path", { d: "M1.75 11.5 5.6 8.2C6 7.86 6.6 7.88 6.97 8.25L8.6 9.88 10.6 8.05C10.98 7.7 11.57 7.72 11.93 8.09L14.25 10.5", stroke: "currentColor", strokeLinejoin: "round" }));
			}
			function TavernPluginIllustrateAction(props) {
				const [busy, setBusy] = React.useState(false);
				const [manualOpen, setManualOpen] = React.useState(false);
				const [instruction, setInstruction] = React.useState("");
				const [manualError, setManualError] = React.useState("");
				const [manualBusy, setManualBusy] = React.useState(false);
				const dialogRef = React.useRef(null);
				const pressRef = React.useRef(null), suppressClickRef = React.useRef(false), submitLockRef = React.useRef(false);
				const instructionTitleId = React.useId();
				function clearPress() {
					if (pressRef.current) clearTimeout(pressRef.current.timer);
					pressRef.current = null;
				}
				function openManual() {
					clearPress();
					setManualError("");
					setInstruction("");
					setManualOpen(true);
				}
				// Progress and outcome show in the turn's text (TavernIllustrationDraft), not here.
				async function draw() {
					if (busy) return;
					setBusy(true);
					try { await runTavernIllustrator(props.illustrator, props.sessionId, props.turn); }
					finally { setBusy(false); }
				}
				async function submitManual(event) {
					event.preventDefault();
					if (submitLockRef.current || manualBusy) return;
					if (instruction.length > 2000) { setManualError("配图要求不能超过 2000 字"); return; }
					submitLockRef.current = true;
					setManualBusy(true);
					setManualError("");
					try {
						await runTavernIllustrator(props.illustrator, props.sessionId, props.turn, instruction);
						setManualOpen(false);
						setInstruction("");
					} catch (error) {
						setManualError(String(error && error.message || error));
					} finally {
						submitLockRef.current = false;
						setManualBusy(false);
					}
				}
				React.useEffect(function () {
					const dialog = dialogRef.current;
					if (!dialog) return;
					if (manualOpen && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
					else if (!manualOpen && dialog.open) dialog.close();
				}, [manualOpen]);
				React.useEffect(function () { return function () { clearPress(); }; }, []);
				const label = busy ? "正在整理画面…" : "为这一轮配图";
				return React.createElement(React.Fragment, null,
					React.createElement(DshUi.Tooltip, { label: label, side: "bottom" },
						React.createElement("button", { type: "button", className: "dsh-tavern-message-fork dsh-tavern-message-illustrate", "aria-label": label, title: "点击直接配图；长按或右键填写本次画面要求", disabled: busy, onClick: function (event) {
							if (suppressClickRef.current) { suppressClickRef.current = false; event.preventDefault(); return; }
							return draw();
						},
						onPointerDown: function (event) {
							if (busy || event.button !== 0 || event.isPrimary === false) return;
							suppressClickRef.current = false;
							clearPress();
						const press = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: null };
						press.timer = setTimeout(function () {
							if (pressRef.current !== press) return;
							pressRef.current = null;
							suppressClickRef.current = true;
							openManual();
						}, 550);
						pressRef.current = press;
						},
						onPointerMove: function (event) {
							const press = pressRef.current;
							if (press && press.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) { clearPress(); suppressClickRef.current = true; }
						},
						onPointerUp: function (event) { if (pressRef.current && pressRef.current.id === event.pointerId) clearPress(); },
						onPointerCancel: function () { if (pressRef.current) suppressClickRef.current = true; clearPress(); },
						onPointerLeave: function () { if (pressRef.current) { clearPress(); suppressClickRef.current = true; } },
						onContextMenu: function (event) { event.preventDefault(); openManual(); },
						onKeyDown: function (event) { if (event.shiftKey && event.key === "F10") { event.preventDefault(); openManual(); } }
						}, React.createElement(TavernIllustrateIcon, null))),
					React.createElement("dialog", { ref: dialogRef, "aria-labelledby": instructionTitleId, onCancel: function (event) { event.preventDefault(); if (!manualBusy) setManualOpen(false); }, onClose: function () { if (manualOpen && !manualBusy) setManualOpen(false); },
						style: { colorScheme: "light dark", width: "min(420px, calc(100vw - 32px))", maxWidth: "calc(100vw - 32px)", padding: "18px", border: "1px solid var(--dsw-alias-border-l2, currentColor)", borderRadius: "12px", background: "var(--dsw-specific-sidebar-fill, Canvas)", color: "var(--dsw-alias-label-primary, CanvasText)", boxShadow: "0 18px 60px rgba(0,0,0,.35)" } },
						React.createElement("form", { onSubmit: submitManual },
							React.createElement("h2", { id: instructionTitleId, style: { margin: "0 0 6px", fontSize: "16px" } }, "本次配图要求"),
							React.createElement("p", { style: { margin: "0 0 12px", color: "var(--dsw-alias-label-secondary, GrayText)", fontSize: "12px", lineHeight: 1.5 } }, "仅本次生图使用，不会保存到设置。可写视角、镜头、动作或想画的内容。"),
							React.createElement("textarea", { autoFocus: true, rows: 5, maxLength: 2000, value: instruction, disabled: manualBusy, "aria-label": "本次配图要求（最多 2000 字）", placeholder: "例如：从门外侧拍摄，镜头略低；角色正在推开窗户。", onChange: function (event) { setInstruction(event.target.value); },
								style: { boxSizing: "border-box", width: "100%", resize: "vertical", padding: "9px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2, currentColor)", background: "var(--dsw-specific-input-major, Canvas)", color: "var(--dsw-alias-label-primary, CanvasText)", font: "inherit" } }),
							React.createElement("div", { style: { marginTop: "5px", textAlign: "right", color: "var(--dsw-alias-label-secondary, GrayText)", fontSize: "11px" } }, instruction.length + " / 2000"),
							manualError ? React.createElement("div", { role: "alert", style: { marginTop: "8px", color: "var(--dsh-tavern-accent-error, #c54f4f)", fontSize: "12px" } }, manualError) : null,
							React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" } },
								React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: manualBusy, onClick: function () { setManualOpen(false); } }, "取消"),
								React.createElement("button", { type: "submit", className: "dsh-tavern-btn", disabled: manualBusy }, manualBusy ? "正在提交…" : "按要求配图")))))
			}
			function register(input) {
				// uiWorkspace 由 dsh-client-ui-workspace 提供；缺失时（老宿主/未加载）退化为 sessions.retain。
				input.ctx.effect(function () {
					installTavernReplyRuns(input.ctx.sessions);
					return function () { disposeTavernReplyRuns(); };
				}, "dsh-tavern: reply reveal runs");
				function resolveUiWorkspace() {
					try { return input.ctx.get("uiWorkspace") || null; } catch (_) { return null; }
				}
				const scriptOwner = createTavernScriptSessionOwner({ sessions: createSessionCompat(input.ctx.sessions, resolveUiWorkspace()), executeSlash: createTavernFrameSlashExecutor(input.ctx) });
				const executeSlash = createTavernFrameSlashExecutor(input.ctx);
				input.ctx.effect(function () {
					scriptOwner.start();
					return function () { scriptOwner.dispose(); };
				}, "dsh-tavern: game script owner");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.session.header.actions", function () { return input.slots.register({
						name: "conversation.session.header.actions", id: "dsh-tavern-script-runtime", order: -140, label: "人物卡脚本运行时"
					}, function () { return React.createElement(TavernScriptRuntime, { owner: scriptOwner }); }); });
				}, "dsh-tavern: conversation script lifecycle");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.node", function () { return input.slots.register({
						name: "conversation.chat.node",
						key: "assistant-step",
						priority: -1
					}, function (props) {
						// Hide only our model-facing seed; keep it in Session history and requests.
						if (props.node.data.finalNode && /^tavern-seed-trajectory:v1:.+:2$/.test(String(props.node.data.finalNode.messageId || ""))) return null;
						// The process panel's copy of the answer step holds only its thinking; the story,
						// pictures and receipts belong to the reply seat. Otherwise the body shows twice.
						if (props.groupPart === "reasoning") return React.createElement(TavernReasoningSeat, { blocks: props.node.data.blocks, streaming: props.node.data.status === "running" });
						return React.createElement(TavernAssistantNodeView, Object.assign({}, props, { executeSlash: executeSlash }));
					}); });
				}, "dsh-tavern: inline assistant renderer");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.node", function () { return input.slots.register({
						name: "conversation.chat.node",
						key: "user",
						priority: -1
					}, TavernUserNodeView); });
				}, "dsh-tavern: raw user message renderer");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.assistant-actions", function () { return input.slots.register({
						name: "conversation.chat.assistant-actions", id: "dsh-tavern-fork", order: 20,
						inject: function (sessionId) { return { sessionId: sessionId }; }
					}, TavernForkAssistantAction); });
				}, "dsh-tavern: conversation fork action");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.assistant-actions", function () { return input.slots.register({
						name: "conversation.chat.assistant-actions", id: "dsh-tavern-illustrate", order: 21,
						inject: function (sessionId) { return { sessionId: sessionId }; }
					}, TavernIllustrateAssistantAction); });
				}, "dsh-tavern: earlier-turn illustration action");
			}
			return Object.freeze({ register: register });
		}
