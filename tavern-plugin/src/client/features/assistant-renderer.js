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
			return function (line, sessionId, options) {
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

		// The plan behind a picture, for judging whether the Agent's staging or the image model fell short.
		function sceneImagePlanDetails(version) {
			if (!version || !(version.prompt || version.composition || version.description)) return null;
			const details = document.createElement("details");
			details.className = "dsh-tavern-image-plan";
			const summary = document.createElement("summary");
			summary.textContent = "画面方案";
			details.append(summary);
			[["画面", version.description], ["时刻", version.moment === "earlier" ? "本轮中间的瞬间" : "本轮结尾"], ["构图", version.composition], ["提示词", version.prompt]].forEach(function (row) {
				if (!row[1]) return;
				const label = document.createElement("dt");
				label.textContent = row[0];
				const value = document.createElement("dd");
				value.textContent = row[1];
				details.append(label, value);
			});
			details.addEventListener("click", function (event) { event.stopPropagation(); });
			return details;
		}

		function openSceneImagePreview(url, opener, version) {
			const dialog = document.createElement("dialog");
			dialog.className = "dsh-tavern-image-preview";
			dialog.setAttribute("aria-label", "场景插画预览");
			const close = document.createElement("button");
			close.type = "button";
			close.textContent = "缩小并返回 ×";
			close.setAttribute("aria-label", "缩小并返回");
			const image = document.createElement("img");
			image.src = url;
			image.alt = "放大的场景插画";
			close.addEventListener("click", function () { dialog.close(); });
			dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
			dialog.addEventListener("close", function () { dialog.remove(); if (opener && opener.isConnected) opener.focus(); }, { once: true });
			dialog.append(close, image);
			const plan = sceneImagePlanDetails(version);
			if (plan) dialog.append(plan);
			document.body.append(dialog);
			dialog.showModal();
			close.focus();
		}

		function createTavernAssistantRendererFeatureModule() {
			function TavernUserNodeView(props) {
				const data = props.node.data;
				const location = props.node.location;
				const turnRef = location && (location.kind === "turn" || location.kind === "step") ? location.turn : null;
				const turn = turnRef ? Number(turnRef.turn) : 0;
				const liveState = useScopedLiveTavernView(props.sessionId, String(data.time || ""), [["inputSources", String(turn)], ["inputTemplateDisplays", String(turn)]]);
				const parts = userContentParts(data.content);
				const text = tavernUserTextForTurn(liveState.view, turn, data.content);
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
				const renderedImages = parts.images.length > 0 ? props.renderMessageImages({ images: parts.images, align: "end" }) : null;
				const extras = parts.rest.map(function (block, index) {
					return React.createElement("div", { key: index, className: "dsh-tavern-user-extra" }, React.createElement(DshUi.JsonBlock, { label: typeof props.t === "function" ? props.t("message.extraBlock") : "附加内容", payload: block, truncatedLabel: function (total) { return "内容过长（共 " + String(total) + " 项）"; } }));
				});
				const time = Number.isFinite(Number(data.time)) ? new Date(Number(data.time)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
				return React.createElement("div", { className: "dsh-tavern-user-row" },
					React.createElement("div", { className: "dsh-tavern-user-stack" }, renderedImages, (text !== "" || extras.length > 0) ? React.createElement("div", { className: "dsh-tavern-user-bubble" }, liveState.view?.inputTemplateDisplays?.[turn] ? React.createElement(TavernMessageFrame, {content:liveState.view.inputTemplateDisplays[turn],sessionId:props.sessionId,turn:turn,partIndex:"user-template",frameOwner:props.frameOwner,eager:true}) : React.createElement("div", { style: { whiteSpace: "pre-wrap" } }, text), extras) : null),
					React.createElement("div", { className: "dsh-tavern-user-actions" }, time ? React.createElement("span", null, time) : null, React.createElement(DshUi.Tooltip, { label: copied ? "已复制" : "复制", side: "bottom" }, React.createElement("button", { type: "button", className: "dsh-tavern-user-copy", "aria-label": copied ? "已复制" : "复制", onClick: copy }, React.createElement(copied ? DshUi.IconCheckOutline16 : DshUi.IconCopyOutline16, null))))
				);
			}
			// While a picture is being made: a placeholder frame where it will appear
			// (or a slim line under the current picture), the stage, elapsed time and a quiet cancel.
			function SceneImagePending(props) {
				const state = props.state;
				const [now, setNow] = React.useState(Date.now());
				React.useEffect(function () { const timer = window.setInterval(function () { setNow(Date.now()); }, 1000); return function () { window.clearInterval(timer); }; }, []);
				const started = Number(state.createdAt) || 0;
				const seconds = started ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
				const elapsed = started ? (seconds >= 60 ? Math.floor(seconds / 60) + " 分 " + (seconds % 60) + " 秒" : seconds + " 秒") : "";
				const cancelling = Boolean(state.cancelRequestedAt);
				const line = React.createElement("div", { className: "dsh-tavern-image-pending-line", role: "status" },
					React.createElement("span", { className: "dsh-tavern-image-pending-spinner", "aria-hidden": true }),
					React.createElement("span", null, sceneImageStageLabel(state)),
					elapsed ? React.createElement("span", { className: "dsh-tavern-image-pending-time" }, elapsed) : null,
					React.createElement("button", { type: "button", className: "dsh-tavern-image-pending-cancel", disabled: props.disabled || cancelling, onClick: props.onCancel }, cancelling ? "正在取消…" : "取消"));
				return props.picture ? React.createElement("div", { className: "dsh-tavern-image-pending" },
					React.createElement("div", { className: "dsh-tavern-image-pending-frame", "aria-hidden": true }), line) : line;
			}
			function SceneIllustration(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
				// The message view may already read the record (to place the picture); reuse it.
				const fetchedState = useSceneImageRecord(props.record === undefined ? props.sessionId : null, props.turn);
				const state = props.record === undefined ? fetchedState : props.record;
				const [error, setError] = React.useState("");
				const [selected, setSelected] = React.useState("");
			const [refreshes, setRefreshes] = React.useState({});
				const [busy, setBusy] = React.useState(false);
				const [adjusting, setAdjusting] = React.useState(false);
				const [instruction, setInstruction] = React.useState("");
				const [referenceDraft, setReferenceDraft] = React.useState(null);
				const requestRef = React.useRef(null);
				const versions = state && state.versions || [];
				const version = versions.find(function (item) { return item.id === selected; }) || versions[versions.length - 1];
				const index = version ? versions.findIndex(function (item) { return item.id === version.id; }) : -1;
				const lastId = versions.length ? versions[versions.length - 1].id : "";
				React.useEffect(function () { setSelected(lastId); setError(""); }, [lastId]);
				React.useEffect(function () {
					if (state && ["failed", "cancelled"].includes(state.status) && state.kind === "adjust" && state.instruction) {
						setSelected(state.baseVersionId); setInstruction(state.instruction); setAdjusting(true);
					}
				}, [state && state.requestId, state && state.status]);
				function notify() { window.dispatchEvent(new CustomEvent("dsh-tavern-image-changed", { detail: { sessionId: props.sessionId } })); }
				async function retrySave() {
					if (busy || !state || state.status === "running") return;
					setBusy(true); setError("");
					try { await rpc("retrySceneImageSave", { turn: props.turn, key: state.key, requestId: state.requestId }, props.sessionId); }
					catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				async function cancelImage() {
					if (busy || !state || state.status !== "running" || state.cancelRequestedAt) return;
					setBusy(true); setError("");
					try { await rpc("cancelSceneImage", { turn: props.turn, key: state.key, requestId: state.requestId }, props.sessionId); }
					catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				async function generate(kind) {
				const reusable = requestRef.current && !(state && requestRef.current.id === state.requestId && ["failed", "cancelled", "idle"].includes(state.status));
				const clickId = reusable && requestRef.current.signature === kind + ":" + (version && version.id) + ":" + instruction ? requestRef.current.id : sceneImageRequestId();
				recordImageInteraction(props.sessionId, props.turn, clickId, "click");
					if ((!version && kind !== "generate") || busy || state.status === "running" || state.recovery === "save") { recordImageInteraction(props.sessionId, props.turn, clickId, "blocked", "busy-or-existing"); return; }
					const confirmNewRequestId = await sceneImagePurchaseConfirmation(state, askConfirm);
					if (confirmNewRequestId === false) { recordImageInteraction(props.sessionId, props.turn, clickId, "cancelled", "confirmation"); return; }
					if (requestRef.current && requestRef.current.id === state.requestId && ["failed", "cancelled", "idle"].includes(state.status)) requestRef.current = null;
					setBusy(true); setError("");
					const signature = kind + ":" + (version && version.id) + ":" + instruction;
					if (!requestRef.current || requestRef.current.signature !== signature) requestRef.current = { signature: signature, id: clickId };
					try {
						await rpc("generateSceneImage", { turn: props.turn, key: state.key, kind: kind, versionId: version && version.id, instruction: kind === "adjust" ? instruction : "", requestId: requestRef.current.id, confirmNewRequestId: confirmNewRequestId }, props.sessionId);
						requestRef.current = null; setAdjusting(false); setInstruction("");
					} catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				async function removeImage() {
					if (!version || locked || !await askConfirm("删除这张图片？删除后可以重新生成。")) return;
					setBusy(true); setError("");
					try {
						await rpc("removeSceneImage", { turn: props.turn, key: state.key, versionId: version.id }, props.sessionId);
						setSelected(""); setAdjusting(false); setReferenceDraft(null); setInstruction(""); requestRef.current = null;
					} catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				function openReference() {
					const people = version.referencePeople || [];
					setReferenceDraft({ key: state.key, versionId: version.id, gateway: state.reference.gateway, service: state.reference.service, personId: version.referenceSingle && people.length === 1 ? people[0].id : "" });
				}
				async function setReference(enabled, personId) {
					if (!version || locked) return;
					if (enabled && (!referenceDraft || referenceDraft.key !== state.key || referenceDraft.versionId !== version.id || !referenceDraft.personId)) return;
					setBusy(true); setError("");
					try { await rpc("setSceneImageReference", { turn: props.turn, key: state.key, versionId: version.id, consent: enabled ? referenceDraft.gateway : state.reference.gateway, personId: enabled ? referenceDraft.personId : personId, enabled: enabled }, props.sessionId); setReferenceDraft(null); }
					catch (e) { setError(String(e.message || e)); }
					finally { setBusy(false); notify(); }
				}
				const url = version ? "/api/dsh-tavern/scene-image?" + new URLSearchParams({ sessionId: props.sessionId, turn: String(props.turn), key: state.key, versionId: version.id }).toString() : "";
				if (!state) return null;
				// Without a picture, generation lives in the turn's action row.
				if (!version && state.status === "idle") return null;
				const locked = busy || state.status === "running" || state.recovery === "save";
				const referencePeople = version && version.referencePeople || [];
				const referenceBindings = state.reference && state.reference.bindings ? state.reference.bindings.filter(function (binding) { return version && binding.versionId === version.id; }) : [];
				const canBindReference = state.enabled && state.reference && state.reference.supported && referencePeople.length > 0;
				const showReference = referenceDraft && version && referenceDraft.key === state.key && referenceDraft.versionId === version.id;
				return React.createElement("div", { className: "dsh-tavern-illustration" },
					url ? React.createElement("a", { href: url, "aria-label": "放大场景插画", onClick: function (event) { event.preventDefault(); openSceneImagePreview(url, event.currentTarget, version); } }, React.createElement("img", { src: url, alt: "本段场景插画", loading: "lazy", onError: function () { setError("图片加载失败，请刷新后重试"); } })) : null,
					version ? React.createElement("div", { className: "dsh-tavern-image-actions" },
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: removeImage }, "删除图片"),
						versions.length > 1 ? React.createElement(React.Fragment, null,
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "上一张插图", disabled: index <= 0, onClick: function () { setSelected(versions[index - 1].id); } }, "‹"),
							React.createElement("span", null, String(index + 1) + " / " + String(versions.length)),
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "下一张插图", disabled: index >= versions.length - 1, onClick: function () { setSelected(versions[index + 1].id); } }, "›")
						) : null,
						state.enabled ? React.createElement(React.Fragment, null,
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: function () { setAdjusting(true); } }, "重画")
						) : null
					) : null,
					canBindReference || referenceBindings.length ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: openReference }, referenceBindings.length ? "管理造型参考" : "用作造型参考") : null,
					version && state.enabled && version.profile && version.profile !== state.profile ? React.createElement("span", { role: "status" }, "将按新渠道重新整理画面，可能产生文字模型费用。") : null,
					state.referenceWarning || state.reference && state.reference.warning ? React.createElement("span", { role: "status" }, state.referenceWarning || state.reference.warning) : null,
					showReference ? React.createElement("div", { className: "dsh-tavern-image-adjust dsh-tavern-image-reference", role: "region", "aria-label": "造型参考" },
						canBindReference ? React.createElement(React.Fragment, null,
							React.createElement("label", null, "参考人物", React.createElement("select", { value: referenceDraft.personId, disabled: locked, onChange: function (event) { setReferenceDraft(Object.assign({}, referenceDraft, { personId: event.target.value })); } },
								React.createElement("option", { value: "" }, "请选择图中人物"),
								referencePeople.map(function (person) { return React.createElement("option", { key: person.id, value: person.id }, person.name + (person.description ? " · " + person.description : "") + (referencePeople.filter(function (other) { return other.name === person.name; }).length > 1 ? " · " + person.id.slice(-8) : "")); })
							)),
							React.createElement("p", null, "确认图片中的所选人物。整张图会发送给：" + referenceDraft.service + "。从当前游戏进度起用于该人物的造型参考，不自动绑定其他人；仅辅助外貌一致，不保证锁脸，也不沿用旧服装。"),
							referenceDraft.gateway !== state.reference.gateway ? React.createElement("p", { role: "status" }, "渠道配置已变化，请关闭后重新选择参考图。") : null,
							React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: locked || !referenceDraft.personId || referenceDraft.gateway !== state.reference.gateway, onClick: function () { return setReference(true); } }, "确认使用")
						) : null,
						referenceBindings.map(function (binding) { return React.createElement("button", { key: binding.personId, type: "button", className: "dsh-tavern-btn", disabled: locked, onClick: function () { return setReference(false, binding.personId); } }, "取消「" + binding.name + "」的参考"); }),
						React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { setReferenceDraft(null); } }, "关闭参考设置")
					) : null,
					adjusting && state.enabled ? React.createElement("div", { className: "dsh-tavern-image-adjust dsh-tavern-image-repaint", role: "region", "aria-label": "重画插图" },
						React.createElement("textarea", { value: instruction, maxLength: 2000, rows: 2, autoFocus: true, "aria-label": "重画意见（选填）", placeholder: "想怎么改？例如：改成雨夜，镜头拉近。留空可重新构思画面，或按原方案再画一张", onChange: function (event) { setInstruction(event.target.value); }, onKeyDown: function (event) {
							if (event.key === "Escape" && !busy) setAdjusting(false);
							else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !locked) { event.preventDefault(); generate(instruction.trim() ? "adjust" : "replan"); }
						}, disabled: locked }),
						React.createElement("div", { className: "dsh-tavern-image-repaint-actions" },
							React.createElement("button", { type: "button", className: "dsh-tavern-image-repaint-cancel", disabled: busy, onClick: function () { setAdjusting(false); } }, "取消"),
							instruction.trim() ? null : React.createElement("button", { type: "button", className: "dsh-tavern-btn", title: "沿用这张图的画面方案，只换随机种子", disabled: locked, onClick: function () { return generate("repaint"); } }, "同方案重画"),
							React.createElement("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-image-repaint-submit", title: instruction.trim() ? "按意见修改这张图的方案后重画" : "重新读正文、选时刻、写构图，多跑一次文字模型", disabled: locked, onClick: function () { return generate(instruction.trim() ? "adjust" : "replan"); } }, instruction.trim() ? "按意见重画" : "重新构思画面"))
					) : null,
					state.status === "running" ? React.createElement(SceneImagePending, { state: state, picture: !version, disabled: busy, onCancel: cancelImage }) : null,
					state.recovery === "save" && state.status !== "running" ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: retrySave }, "重试保存") : null,
					error || state && state.error ? React.createElement("span", { role: "alert", className: "dsh-tavern-settings-error" }, error || state.error) : null
				);
			}
			function tavernAssistantViewPaths(turn, eager = true) {
				return ["mode", eager ? "tavernHelper" : "$helperAvailable",
					"tavernRuntimePolicy", "tavernMvuRuntime", "releaseCapabilities", "statusBarPlacement"].map(field => [field]).concat([["$projectionTurn", String(turn)], ["$projectionLatestTurn", String(turn)]]);
			}
			function tavernReceiptViewPaths(turn, receipt, latest) {
				const paths = [["$mvuReceiptTurn", String(turn)], ["$settlementOwner", String(turn)]];
				if (latest || receipt?.status === "pending") paths.push(["$receiptBusy"]);
				return paths;
			}
			function TavernTurnMvuReceipt(props) {
				const current = liveTavernView.getSnapshot(props.sessionId).view;
				const state = useLiveTavernView(props.sessionId, "receipt", tavernReceiptViewPaths(props.turn,
					tavernMvuReceiptForTurn(current, props.turn), props.turn === current?.settlementTurn));
				const receipt = tavernMvuReceiptForTurn(state.view, props.turn);
				return receipt ? React.createElement(TavernMvuReceipt, { ...props, receipt,
					latest: props.turn === state.view?.settlementTurn, busy: Boolean(state.view?.activity?.busy) }) : null;
			}
			function TavernInlineStatusRuntime(props) {
				const state = useLiveTavernView(props.sessionId, "inline-status");
				return state.view ? React.createElement(TavernPersistentStatusRuntime, {
					sessionId: props.sessionId, view: state.view, executeSlash: props.executeSlash
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

			// Third-party plugins: use the public tavernUi API (docs/plugin-api.md), never patch this file; its structure changes freely.
			function TavernAssistantNodeView(props) {
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
					const projection = settled ? tavernProjectionForTurn(liveState.view, storyTurn) : null;
					const latestProjectionTurn = tavernLatestProjectionTurn(liveState.view);
                React.useEffect(function () {
                    if(!historyNode.current || !currentView?.historyWindow || projection || storyTurn<=0 || storyTurn>=tavernLatestProjectionTurn(currentView))return;
                    const observer = new IntersectionObserver(entries=>{
                        if(entries.some(entry=>entry.isIntersecting)) {
                            observer.disconnect();
                            void requestOlderHistory(props.sessionId,currentView.historyWindow.from).catch(error=>tavernErrorHub.report("读取历史",error));
                        }
                    });
                    observer.observe(historyNode.current);
                    return ()=>observer.disconnect();
                },[props.sessionId,storyTurn,projection,currentView?.historyWindow?.revision,currentView?.historyWindow?.from]);
				const tail = props.useTurnData("turn-tail");
				const owner = React.useMemo(function () {
					if (!turnRef || turnRef.status !== "closed" || !data.finalNode || !tail || !tail.closing || tail.closing.finalNode.seq !== data.finalNode.seq) return undefined;
					return { turn: turnRef, seq: data.finalNode.seq, openFile: props.openFile };
				}, [turnRef, data.finalNode, tail, props.openFile]);
				const mentions = React.useMemo(function () { return owner === undefined ? undefined : props.fileMentions(owner); }, [owner, props.fileMentions]);
				const waitingForHistory = Boolean(currentView?.historyWindow && !projection && settled && storyTurn>0 && storyTurn<latestProjectionTurn);
				const playView = isPlayMode(liveState.view && liveState.view.mode) && storyTurn > 0 && !sessionTransitioning;
				useTavernUiExtensions();
				const pluginMedia = useTavernPluginMedia(props.sessionId, storyTurn, playView && settled);
				const sceneImagesEnabled = Boolean(liveState.view && liveState.view.releaseCapabilities && liveState.view.releaseCapabilities.sceneImages);
				const sceneShown = sceneImagesEnabled && settled && playView;
				const sceneRecord = useSceneImageRecord(sceneShown ? props.sessionId : null, storyTurn);
				const sceneAnchor = (function () {
					const versions = sceneRecord && sceneRecord.versions || [];
					for (let index = versions.length - 1; index >= 0; index -= 1) if (versions[index].anchor) return versions[index].anchor;
					return "";
				})();
				const illustration = sceneShown ? React.createElement(SceneIllustration, { key: props.sessionId + ":" + storyTurn + ":" + JSON.stringify(projection), sessionId: props.sessionId, turn: storyTurn, record: sceneRecord }) : null;
				const pluginText = playView ? createTavernPluginTextContext({ items: pluginMedia.items, extras: illustration && sceneAnchor ? [{ id: "scene-illustration", anchor: sceneAnchor, render: function () { return illustration; } }] : [], sessionId: props.sessionId, turn: storyTurn, streaming: data.status === "running" }) : null;
                const rendered = sessionTransitioning ? [React.createElement("div", { key: "switching", className: "dsh-tavern-session-switching", role: "status" }, "正在完成游戏初始化…")] : waitingForHistory ? [React.createElement("div", {key:"history",role:"status"}, "正在读取历史内容…")] : renderTavernAssistantBlocks({
					blocks: data.blocks,
					streaming: data.status === "running",
					interrupted: data.status === "interrupted",
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
					renderMessageImages: props.renderMessageImages,
					plugin: pluginText,
					mentions: mentions,
					t: props.t
				});
				const distantHeight = useTavernDistantFloor(historyNode, settled && !sessionTransitioning && storyTurn > 0 && latestProjectionTurn - storyTurn >= TAVERN_LIVE_FLOORS);
				if (!(data.status === "running" || data.status === "interrupted" || rendered.length > 0)) return null;
				if (distantHeight > 0) return React.createElement("div", { ref:historyNode, className: "dsh-tavern-assistant", "data-distant-floor": true, style: { height: distantHeight + "px" } });
				const mvuReceiptNode = settled ? React.createElement(TavernTurnMvuReceipt, { sessionId: props.sessionId, turn: storyTurn }) : null;
				const trailingIllustration = pluginText && pluginText.placed.has("scene-illustration") ? null : illustration;
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
                const body = legacyGreeting ? React.createElement(TavernLegacyGreeting, {key:props.sessionId+":greeting", source:greetingSource, sessionId:props.sessionId, executeSlash:props.executeSlash}, rendered) : rendered;
                const refusalNotice = settled && !sessionTransitioning ? tavernModelRefusalNotice((data.blocks || []).filter(block => block && block.kind === "text").map(block => String(block.text || "")).join("\n")) : "";
                const refusalNode = refusalNotice ? React.createElement("div", { className: "dsh-tavern-refusal-notice", role: "note" }, refusalNotice) : null;
				// Plugin media without a found anchor goes after the text.
				const trailingMedia = pluginMedia.items.filter(function (item) { return !(pluginText && pluginText.placed.has(item.id)); });
				const pluginMediaNode = trailingMedia.length ? React.createElement("div", { className: "dsh-tavern-plugin-media-list" }, trailingMedia.map(function (item) {
					return React.createElement(TavernPluginMediaItem, { key: item.id, item: item, sessionId: props.sessionId, turn: storyTurn });
				})) : null;
				const pluginActions = playView && settled ? React.createElement(TavernPluginMessageActions, { sessionId: props.sessionId, turn: storyTurn, settled: settled }) : null;
				return React.createElement("div", { ref:historyNode, className: "dsh-tavern-assistant", "data-streaming": data.status === "running" || undefined }, body, refusalNode, pendingMessage, pluginMediaNode, trailingIllustration, pluginActions, mvuReceiptNode, inlineStatus);
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
						React.createElement(DshUi.IconBranchOutline16, null)));
			}
			function TavernIllustrateAssistantAction(props) {
				const liveState = useScopedLiveTavernView(props.sessionId, String(props.messageId || ""), [["mode"], ["releaseCapabilities"], ["forkTurnsByMessageId", String(props.messageId || "")]]);
				const view = liveState.view;
				const turn = Number(view && view.forkTurnsByMessageId && view.forkTurnsByMessageId[String(props.messageId || "")]) || 0;
				const shown = Boolean(view && isPlayMode(view.mode) && view.releaseCapabilities && view.releaseCapabilities.sceneImages && turn > 0);
				return shown ? React.createElement(SceneImageAction, { key: props.sessionId + ":" + turn, sessionId: props.sessionId, turn: turn }) : null;
			}
			function register(input) {
				const scriptOwner = createTavernScriptSessionOwner({ sessions: input.ctx.sessions, executeSlash: createTavernFrameSlashExecutor(input.ctx) });
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
