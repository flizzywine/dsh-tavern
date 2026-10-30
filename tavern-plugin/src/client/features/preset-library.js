		function groupPresetEntriesByPhase(preset) {
			const result = { front: [], middle: [], back: [], unassigned: [] };
			const entries = preset?.entries || [], assigned = new Set();
			["front", "middle", "back"].forEach(function (phase) {
				(preset?.dshPreset?.[phase] || []).forEach(function (item) {
					const entry = Number.isInteger(item.source?.sourcePromptIndex) ? entries.find(entry => entry.sourcePromptIndex === item.source.sourcePromptIndex) : entries.find(entry => entry.entryKey === (item.id || item.entryKey));
					if (entry && !assigned.has(entry)) { assigned.add(entry); result[phase].push(entry); }
				});
			});
			result.unassigned = entries.filter(entry => !assigned.has(entry));
			return result;
		}


			function createExternalPresetAndBypassPlanFeatureModule() {
			function usePresetCatalog(sessionId, errorSink, visible) {
				const [catalog, setCatalog] = React.useState({ presets: [], activePresetPath: "", activePresetTitle: "", sessionMode: "" });
				function refresh() {
					return Promise.all([rpc("listPresets", {}, sessionId), readSessionViewAfterLive(sessionId)]).then(function (all) {
						const result = all[0] || {}; const view = all[1] && all[1].view;
						const next = { presets: result.presets || [], activePresetPath: result.activePresetPath || "", activePresetTitle: result.activePresetTitle || "", sessionMode: view && view.mode || "", runtimePreset: view && view.runtimePreset || null };
						setCatalog(next); if (errorSink) errorSink(""); return next;
					}, function (err) { if (errorSink) errorSink(String(err && err.message || err)); return null; });
				}
				useVisibleDataRefresh(visible, function (event) { return tavernDataChangeAffects(event, ["presets", "sessions"], "presets"); }, refresh, sessionId);
				return [catalog, refresh];
			}

			function ExternalPresetLibraryTab(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
				const [error, setError] = usePersistentError("酒馆预设库");
				const [catalog, refresh] = usePresetCatalog(props.scope.sessionId, setError, props.visible);
				const [detailPath, setDetailPath] = React.useState("");
				const [preset, setPreset] = React.useState(null);
				const [entryDrafts, setEntryDrafts] = React.useState({});
				const dragEntry = React.useRef(null);
				const movingEntry = React.useRef(false);
				const [dragging, setDragging] = React.useState(false);
				const [regexDrafts, setRegexDrafts] = React.useState({});
				const [busy, setBusy] = React.useState(false);
				const importInput = React.useRef(null);
				const presetGroups = React.useMemo(function () { return groupPresetEntriesByPhase(preset); }, [preset]);
				// Rows mount their editor only while expanded; closed <details> would still build every form.
				const [openRows, setOpenRows] = React.useState(function () { return new Set(); });
				function rowToggle(key) {
					return { open: openRows.has(key), onToggle: function (event) {
						const open = event.currentTarget.open;
						setOpenRows(function (current) {
							if (current.has(key) === open) return current;
							const next = new Set(current);
							if (open) next.add(key); else next.delete(key);
							return next;
						});
					} };
				}
				const h = React.createElement;
				async function importFile(file) {
					if (!file) return; setBusy(true); setError("");
					try { await rpc("importPreset", { payload: await parseTextResourceFile(file) }, props.scope.sessionId); await refresh(); notifyTavernDataChanged(["presets"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function selectPreset(path) {
					setBusy(true); setError("");
					try { await rpc("selectPreset", { path: path }, props.scope.sessionId); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function loadPreset(path) {
					setBusy(true); setError("");
					try { const result = await rpc("getPreset", { path: path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts({}); setRegexDrafts({}); setDetailPath(path); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				function entryValue(entry) { return { name: String(entry.name || ""), role: String(entry.role || "system"), content: String(entry.content || ""), enabled: entry.enabled === true }; }
				function regexValue(script) { return { name: String(script.name || ""), findRegex: String(script.findRegex || ""), replaceString: String(script.replaceString || ""), enabled: script.enabled === true }; }
				function entryDraft(entry) { return Object.assign({}, entryValue(entry), entryDrafts[entry.entryKey] || {}); }
				function regexDraft(script) { return Object.assign({}, regexValue(script), regexDrafts[script.regexKey] || {}); }
				function updateEntryDraft(entry, patch) { setEntryDrafts(function (current) { return Object.assign({}, current, { [entry.entryKey]: Object.assign({}, entryValue(entry), current[entry.entryKey] || {}, patch) }); }); }
				function updateRegexDraft(script, patch) { setRegexDrafts(function (current) { return Object.assign({}, current, { [script.regexKey]: Object.assign({}, regexValue(script), current[script.regexKey] || {}, patch) }); }); }
				async function movePresetEntry(entryKey, phase, beforeEntryKey = "") {
					if (!preset || busy || movingEntry.current || entryKey === beforeEntryKey) return;
					movingEntry.current = true; setBusy(true); setError("");
					try {
						const result = await rpc("movePresetEntry", { path: preset.path, entryKey, phase, beforeEntryKey, revision: preset.revision }, props.scope.sessionId);
						setPreset(result.preset); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets");
					} catch (error) { setError(String(error?.message || error)); }
					finally { movingEntry.current = false; setBusy(false); dragEntry.current = null; setDragging(false); }
				}
				function presetDropHandlers(phase, beforeEntryKey = "") {
					return {
						onDragOver: function (event) { if (dragEntry.current && !busy) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; event.currentTarget.classList.add("is-drop-target"); } },
						onDragLeave: function (event) { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove("is-drop-target"); },
						onDrop: function (event) {
							if (!dragEntry.current || busy) return;
							event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove("is-drop-target");
							const key = dragEntry.current; dragEntry.current = null; setDragging(false);
							void movePresetEntry(key, phase, beforeEntryKey);
						}
					};
				}
				function dropZone(phase, beforeEntryKey = "") {
					return h("div", { className: "dsh-tavern-preset-drop", "data-drop-phase": phase, "data-drop-before": beforeEntryKey, ...presetDropHandlers(phase, beforeEntryKey) });
				}
				async function savePresetEntry(entry) {
					if (!preset) return; setBusy(true); setError("");
					const draft = entryDraft(entry);
					try { await rpc("updatePresetEntry", { path: preset.path, entryKey: entry.entryKey, patch: { name: draft.name, role: draft.role, content: draft.content, enabled: draft.enabled } }, props.scope.sessionId); const result = await rpc("getPreset", { path: preset.path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts(function (current) { const next = Object.assign({}, current); delete next[entry.entryKey]; return next; }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function savePresetRegex(script) {
					if (!preset) return; setBusy(true); setError("");
					const draft = regexDraft(script);
					try { const result = await rpc("updatePresetRegex", { path: preset.path, regexKey: script.regexKey, patch: { name: draft.name, findRegex: draft.findRegex, replaceString: draft.replaceString, enabled: draft.enabled } }, props.scope.sessionId); setPreset(result.preset || null); setRegexDrafts(function (current) { const next = Object.assign({}, current); delete next[script.regexKey]; return next; }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function togglePresetEntry(entry) {
					if (!preset || entry.marker === true || !entry.edit || !Array.isArray(entry.edit.enabledPaths) || entry.edit.enabledPaths.length === 0) return;
					const enabled = entry.enabled !== true; setBusy(true); setError("");
					try { await rpc("updatePresetEntry", { path: preset.path, entryKey: entry.entryKey, patch: { enabled: enabled } }, props.scope.sessionId); const result = await rpc("getPreset", { path: preset.path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts(function (current) { if (!Object.prototype.hasOwnProperty.call(current, entry.entryKey)) return current; return Object.assign({}, current, { [entry.entryKey]: Object.assign({}, current[entry.entryKey], { enabled: enabled }) }); }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function togglePresetRegex(script) {
					if (!preset) return; const enabled = script.enabled !== true; setBusy(true); setError("");
					try { const result = await rpc("updatePresetRegex", { path: preset.path, regexKey: script.regexKey, patch: { enabled: enabled } }, props.scope.sessionId); setPreset(result.preset || null); setRegexDrafts(function (current) { if (!Object.prototype.hasOwnProperty.call(current, script.regexKey)) return current; return Object.assign({}, current, { [script.regexKey]: Object.assign({}, current[script.regexKey], { enabled: enabled }) }); }); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function rename(item) {
					const current = item.path.split("/").pop(); const name = await askTavernText({ title: "重命名酒馆预设", initialValue: current, maxLength: 120 });
					if (name === null || name === current) return;
					setBusy(true); setError("");
					try {
						const result = await rpc("renameResource", { path: item.path, name: name }, props.scope.sessionId);
						if (item.path === catalog.activePresetPath) await rpc("selectPreset", { path: result.resource.path }, props.scope.sessionId);
						await refresh(); if (detailPath === item.path) await loadPreset(result.resource.path); notifyTavernDataChanged(["presets", "sessions"], "presets");
					}
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function exportFile(item) {
					setBusy(true); setError("");
					try {
						const result = await rpc("exportPreset", { path: item.path }, props.scope.sessionId);
						downloadTavernBlob(new Blob([result.text], { type: "application/json" }), result.name || "preset.json");
					} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function remove(item) {
					if (!await askConfirm("删除酒馆预设“" + item.title + "”吗？\n工作版和原版都会删除；已有对话保留。")) return;
					setBusy(true); setError("");
					try {
						if (item.path === catalog.activePresetPath) await rpc("selectPreset", { path: "" }, props.scope.sessionId);
						await rpc("deletePreset", { path: item.path }, props.scope.sessionId); setDetailPath(""); setPreset(null); await refresh(); notifyTavernDataChanged(["presets", "sessions"], "presets");
					}
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				const inCardMode = catalog.sessionMode === "card";
				function entryRow(entry) {
					const groups = presetGroups;
					const phase = ["front", "middle", "back"].find(phase => groups[phase].some(item => item.entryKey === entry.entryKey));
					const index = phase ? groups[phase].findIndex(item => item.entryKey === entry.entryKey) : -1;
					const handle = phase ? h("button", { type: "button", className: "dsh-tavern-preset-drag", disabled: busy, draggable: !busy, "aria-label": "拖动条目：" + entry.name, title: "拖动排序或移到其他分段",
						onClick: event => { event.preventDefault(); event.stopPropagation(); },
						onDragStart: event => { event.stopPropagation(); dragEntry.current = entry.entryKey; event.dataTransfer.setData("text/plain", entry.entryKey); event.dataTransfer.effectAllowed = "move"; setDragging(true); },
						onDragEnd: event => { event.stopPropagation(); dragEntry.current = null; setDragging(false); event.currentTarget.closest(".dsh-tavern-presets")?.querySelectorAll(".is-drop-target").forEach(node => node.classList.remove("is-drop-target")); }
					}, "⠿") : null;
					const draft = entryDraft(entry); const editable = entry.marker !== true && entry.edit && entry.edit.promptPath; const toggleable = entry.marker !== true && entry.edit && Array.isArray(entry.edit.enabledPaths) && entry.edit.enabledPaths.length > 0; const dirty = JSON.stringify(draft) !== JSON.stringify(entryValue(entry));
					const state = toggleable ? h("button", { type: "button", role: "switch", className: "dsh-tavern-prompt-state is-toggle " + (entry.enabled ? "on" : "off"), disabled: busy, title: entry.enabled ? "点击停用此条目" : "点击启用此条目", "aria-label": entry.name + "启用状态", "aria-checked": entry.enabled === true, onClick: function (event) { event.preventDefault(); event.stopPropagation(); togglePresetEntry(entry); } }) : h("span", { className: "dsh-tavern-prompt-state " + (entry.enabled ? "on" : "off"), title: "系统占位状态只读" }, entry.enabled ? "启用" : "停用");
					const rowKey = "entry:" + entry.entryKey;
					return h("details", { key: entry.entryKey, className: "dsh-tavern-prompt-row role-" + String(entry.role || "system"), ...rowToggle(rowKey), ...(phase ? presetDropHandlers(phase, entry.entryKey) : {}) },
						h("summary", { className: "dsh-tavern-prompt-head dsh-tavern-preset-entry-head" + (phase ? " has-drag" : "") }, handle, h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, entry.name), h("span", null, String(entry.content || "").slice(0, 400).replace(/\s+/g, " ").trim() || (entry.marker ? "系统占位" : "空条目"))), state),
						!openRows.has(rowKey) ? null : editable ? h("div", { className: "dsh-tavern-prompt-editor" },
							phase ? h("div", { className: "dsh-tavern-prompt-editor-actions" },
								h("label", null, "移动到", h("select", { value: phase, disabled: busy, "aria-label": entry.name + "所在分段", onChange: event => movePresetEntry(entry.entryKey, event.target.value) }, h("option", { value: "front" }, "前段"), h("option", { value: "middle" }, "中段"), h("option", { value: "back" }, "后段"))),
								h("button", { disabled: busy || index === 0, onClick: () => movePresetEntry(entry.entryKey, phase, groups[phase][index - 1].entryKey) }, "上移"),
								h("button", { disabled: busy || index === groups[phase].length - 1, onClick: () => movePresetEntry(entry.entryKey, phase, groups[phase][index + 2]?.entryKey || "") }, "下移")) : null,
							h("label", { className: "dsh-tavern-prompt-editor-field" }, "名称", h("input", { type: "text", value: draft.name, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { name: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field" }, "角色", h("select", { value: draft.role, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { role: event.target.value }); } }, h("option", { value: "system" }, "system"), h("option", { value: "user" }, "user"), h("option", { value: "assistant" }, "assistant"))),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "内容", h("textarea", { value: draft.content, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { content: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-toggle" }, h("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { enabled: event.target.checked }); } }), "启用此条目"),
							h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy || !dirty, onClick: function () { savePresetEntry(entry); } }, "保存此条目")))
						: h("div", null, h("div", { className: "dsh-tavern-extension-note" }, "这是由兼容运行时填充的系统占位，不能在这里编辑。"), h("pre", { className: "dsh-tavern-prompt-content" }, entry.content || "[由运行时提供的占位]")));
				}
				function regexRow(script) {
					const draft = regexDraft(script); const dirty = JSON.stringify(draft) !== JSON.stringify(regexValue(script));
					const state = h("button", { type: "button", role: "switch", className: "dsh-tavern-prompt-state is-toggle " + (script.enabled ? "on" : "off"), disabled: busy, title: script.enabled ? "点击停用此正则" : "点击启用此正则", "aria-label": script.name + "启用状态", "aria-checked": script.enabled === true, onClick: function (event) { event.preventDefault(); event.stopPropagation(); togglePresetRegex(script); } });
					const rowKey = "regex:" + script.regexKey;
					return h("details", { key: script.regexKey, className: "dsh-tavern-prompt-row role-regex", ...rowToggle(rowKey) },
						h("summary", { className: "dsh-tavern-prompt-head dsh-tavern-preset-regex-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, script.name), h("span", null, script.findRegex || "空查找规则")), state),
						!openRows.has(rowKey) ? null : h("div", { className: "dsh-tavern-prompt-editor" },
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "名称", h("input", { type: "text", value: draft.name, disabled: busy, onChange: function (event) { updateRegexDraft(script, { name: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "查找规则", h("textarea", { value: draft.findRegex, disabled: busy, onChange: function (event) { updateRegexDraft(script, { findRegex: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "替换内容", h("textarea", { value: draft.replaceString, disabled: busy, onChange: function (event) { updateRegexDraft(script, { replaceString: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-toggle" }, h("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: function (event) { updateRegexDraft(script, { enabled: event.target.checked }); } }), "启用此正则"),
							h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy || !dirty, onClick: function () { savePresetRegex(script); } }, "保存此正则"))));
				}
				function phaseSection(phase, title, description, entries) {
					return h("section", { className: "dsh-tavern-preset-phase phase-" + phase, "aria-label": title, ...presetDropHandlers(phase) },
						h("div", { className: "dsh-tavern-preset-phase-head" }, h("div", null, h("div", { className: "dsh-tavern-preset-phase-title" }, title), h("div", { className: "dsh-tavern-preset-phase-description" }, description)), h("span", { className: "dsh-tavern-preset-phase-count" }, entries.length + " 项")),
						entries.map(entry => h(React.Fragment, { key: entry.entryKey }, dropZone(phase, entry.entryKey), entryRow(entry))), dropZone(phase), entries.length ? null : h("div", { className: "dsh-tavern-preset-phase-empty" }, "此段暂无提示词，可将条目拖到这里"));
				}
				if (preset && preset.path === detailPath) {
					const entryGroups = presetGroups;
					return h("div", { className: "dsh-tavern-presets" + (dragging ? " is-dragging" : "") },
					h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setDetailPath(""); setPreset(null); } }, "← 返回酒馆预设库"), h("div", { className: "dsh-tavern-status-title" }, preset.title)),
					h("div", { className: "dsh-tavern-preset-detail" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
						h("div", { className: "dsh-tavern-preset-summary" }, h("b", null, "编辑前／中／后三段预设"), h("p", null, "前、中、后表示这些内容放在提示词的什么位置。点击条目就能修改；拖动左侧手柄可调整顺序或跨段移动，松开后自动保存。"), h("p", null, "保存后可在“本局设置”中选择预设，让已保存的提示词和正则从下一轮生效；这会使提示词缓存失效。"), h("p", null, "预设会影响游玩时的正文生成。DSH 和酒馆的工作方式不同，同一份预设不一定有同样的效果。"), h("p", null, "在卡片模式里引用预设，只是让 Agent 帮你查看或修改它；负责后台工作的 Agent 不使用这些预设。")),
						h("div", { className: "dsh-tavern-preset-detail-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { exportFile(preset); } }, "导出"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { rename(preset); } }, "重命名"), h("button", { className: "dsh-tavern-btn danger", disabled: busy, onClick: function () { remove(preset); } }, "删除")),
						h("div", { className: "dsh-tavern-preset-section-title" }, "提示词三段 · " + (preset.entries || []).length + " 个源条目"),
						phaseSection("front", "前段", "放在系统提示词的开头，在 DSH 自带说明和聊天历史之前。适合写模型身份、世界背景和通用规则。", entryGroups.front),
						phaseSection("middle", "中段", "放进每轮的任务说明里，和这一轮的写作要求一起发给模型。适合写需要每轮提醒的叙事和文风要求。", entryGroups.middle),
						phaseSection("back", "后段", "放在发给模型的内容最末尾，在本轮输入和任务说明之后。适合最后再强调输出格式、篇幅等要求。", entryGroups.back),
						entryGroups.unassigned.length ? h("details", { className: "dsh-tavern-preset-unassigned" }, h("summary", null, "未进入三段 · " + entryGroups.unassigned.length + " 项"), h("p", null, "这些条目是人物卡、聊天历史等内容的占位，或没有排进预设的发送顺序，不会作为预设文字发给模型。"), entryGroups.unassigned.map(entryRow)) : null,
						h("div", { className: "dsh-tavern-preset-section-title" }, "正则脚本 · " + (preset.extractableRegexScripts || []).length), (preset.extractableRegexScripts || []).map(regexRow)));
				}
				return h("div", { className: "dsh-tavern-presets" },
					h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "酒馆预设库"), h("div", { className: "dsh-tavern-question-sub" }, "导入、选择和修改酒馆预设"), h("button", { className: "dsh-tavern-btn primary", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入酒馆预设"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importFile(file); event.target.value = ""; } })),
					h("div", { className: "dsh-tavern-preset-list" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
						h("label", { className: "dsh-tavern-preset-selector" }, h("span", null, "新游戏默认预设"), h("select", { value: catalog.activePresetPath, disabled: busy, onChange: function (event) { selectPreset(event.target.value); } }, h("option", { value: "" }, "不使用酒馆预设（默认）"), catalog.presets.filter(function (item) { return item.valid === true && item.recognized === true; }).map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); }))),
						h("details", { className: "dsh-tavern-preset-summary dsh-tavern-external-preset-notice dsh-tavern-help" },
						h("summary", null, h("strong", null, catalog.activePresetPath ? "当前预设：" + catalog.activePresetTitle : "当前使用内置设置"), h("span", null, "使用说明")),
						h("p", { className: "dsh-tavern-preset-warning" }, h("strong", null, "使用建议："), "一般用内置设置就够了。想改文风或写法，可以在卡片模式里让 Agent 修改人物卡，也可以在游玩时用 Guide 告诉它你的要求。酒馆预设也会影响模型怎么写，使用前先看看里面写了什么。"),
						h("p", null, "酒馆的预设可以导入使用，但 DSH 和酒馆的工作方式不同，用起来不一定是原来的效果。使用酒馆预设可能大幅增加思考时间和游玩延迟，请留意。"), h("p", null, "每局游戏默认保留开局时的预设。可在这里临时切换当前游戏的预设，或在编辑后应用最新配置；会提示缓存失效，并保留对话和变量。"),
						h("p", null, "预设分成前、中、后三段，区别是放进提示词的位置："),
						h("p", null, h("strong", null, "前段："), "放在系统提示词开头，先告诉模型它是谁、故事背景是什么、要遵守哪些通用规则。"),
						h("p", null, h("strong", null, "中段："), "放进每轮的任务说明，提醒模型这一轮该怎么写，比如叙事方式和文风。"),
						h("p", null, h("strong", null, "后段："), "放在本轮发给模型的内容最末尾，最后再强调输出格式、篇幅等要求。")),
					catalog.presets.length ? catalog.presets.map(function (item) {
						return h("div", { key: item.path, className: "dsh-tavern-preset-row" },
								h("div", { className: "dsh-tavern-preset-row-head" }, h("button", { className: "dsh-tavern-preset-row-main", disabled: busy, title: "查看并编辑预设", onClick: function () { loadPreset(item.path); } }, h("b", null, item.title), h("span", null, "前 " + Number(item.phaseCounts && item.phaseCounts.front || 0) + " · 中 " + Number(item.phaseCounts && item.phaseCounts.middle || 0) + " · 后 " + Number(item.phaseCounts && item.phaseCounts.back || 0) + " · 正则 " + item.regexCount))),
							h("div", { className: "dsh-tavern-preset-row-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { loadPreset(item.path); } }, "打开预设 ›"), inCardMode ? h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: function () { props.appendMention("preset", item.path, item.title); } }, "在对话中引用") : null)
						);
					}) : h(EmptyState, { noun: "外部预设" })));
			}

			function register(input) {
				const ctx = input.ctx;
				const appendMention = input.appendMention;
				return ctx.effect(function () {
					const dispose = registerTab(ctx.betterSidebar, { id: "dsh-tavern:presets", title: "预设", order: 4, single: true, component: function (props) { return React.createElement(TavernPresetHubTab, { scope: props.scope, tab: props.tab, visible: props.visible, appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); } }); } });
					return function () { if (typeof dispose === "function") dispose(); };
				}, "dsh-tavern: preset library");
			}
			return Object.freeze({ register: register, Tab: ExternalPresetLibraryTab });
			}
			const presetLibraryFeature = createExternalPresetAndBypassPlanFeatureModule();
