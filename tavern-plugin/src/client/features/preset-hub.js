		// One "预设" tab: the preset, system prompt set and long-term preference that
		// shape how stories are told, each picked here and shared as one file.
		function TavernPresetHubTab(props) {
			const h = React.createElement;
			const askConfirm = useTavernConfirm(props.scope && props.scope.sessionId);
			const sessionId = props.scope && props.scope.sessionId || "";
			const requestedSection = props.tab && props.tab.meta && typeof props.tab.meta.section === "string" ? props.tab.meta.section : "";
			const [section, setSection] = React.useState(requestedSection);
			const [summary, setSummary] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [exporting, setExporting] = React.useState(null);
			const [error, setError] = React.useState("");
			const [notice, setNotice] = React.useState("");
			const [generation, setGeneration] = React.useState(0);
			const importInput = React.useRef(null);
			React.useEffect(function () { if (requestedSection) setSection(requestedSection); }, [requestedSection, props.tab && props.tab.meta]);
			async function load() {
				try {
					const all = await Promise.all([rpc("listPresets", {}, sessionId), rpc("getSystemPrompts"), rpc("getUserPreferenceProfile", { sessionId: sessionId }, sessionId), rpc("getCardPersonas")]);
					const presets = all[0] || {}; const prompts = all[1] && all[1].systemPrompts || {}; const profile = all[2] && all[2].userProfile || {}; const personas = all[3] && all[3].cardPersonas || {};
					setSummary({
						presets: (presets.presets || []).filter(function (item) { return item.valid === true && item.recognized === true; }), activePresetPath: presets.activePresetPath || "",
						promptSets: prompts.promptSets || { activeId: "", sets: [] },
						profiles: (profile.profiles || []).filter(function (item) { return item.hasConfirmed; }), defaultProfileId: profile.defaultProfileId || "",
						personas: Array.isArray(personas.items) ? personas.items : [], activePersonaId: personas.activeId || ""
					});
					setError("");
				} catch (err) { setError(String(err && err.message || err)); }
			}
			React.useEffect(function () {
				void load();
				function onData(event) { if (tavernDataChangeAffects(event, ["presets", "user-profile", "system-prompts", "card-personas"], "preset-hub")) void load(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [sessionId, section]);
			async function run(task, kinds) {
				setBusy(true); setError(""); setNotice("");
				try { const message = await task(); if (kinds) notifyTavernDataChanged(kinds, "preset-hub"); await load(); if (message) setNotice(message); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function selectPreset(path) { return run(async function () { await rpc("selectPreset", { path: path }, sessionId); return "新游戏默认预设已更新。"; }, ["presets"]); }
			function selectPromptSet(id) { return run(async function () { await rpc("manageSystemPromptSet", { action: "select", id: id }); return "已切换系统提示词方案，将从下一次请求开始生效。"; }, ["system-prompts"]); }
			function selectPersona(id) { return run(async function () { await rpc("manageCardPersona", { action: "select", id: id }); return id ? "已切换卡片工作台性格，将从下一次卡片 Agent 请求开始生效。" : "卡片工作台性格已切换为空白。"; }, ["card-personas"]); }
			function selectProfile(id) { return run(async function () { await rpc("manageUserPreferenceProfile", { action: "default", profileId: id }, sessionId); return "新游戏默认长期偏好已更新。"; }, ["user-profile"]); }
			const available = summary ? { preset: Boolean(summary.activePresetPath), systemPrompts: true, userProfile: Boolean(summary.defaultProfileId) } : {};
			const parts = ["preset", "systemPrompts", "userProfile"];
			const partNames = { preset: "酒馆预设", systemPrompts: "系统提示词", userProfile: "长期偏好" };
			const chosen = exporting ? parts.filter(function (part) { return exporting[part] && available[part]; }) : [];
			function beginExport() { const next = {}; parts.forEach(function (part) { next[part] = available[part] === true; }); setExporting(next); setError(""); setNotice(""); }
			function exportBundle() {
				return run(async function () {
					const include = {}; chosen.forEach(function (part) { include[part] = true; });
					saveTavernExport(await rpc("exportSettingsBundle", { include: include }));
					setExporting(null);
					return "已导出 " + chosen.map(function (part) { return partNames[part]; }).join("、") + "。";
				});
			}
			function currentName(part) {
				if (!summary) return "";
				if (part === "preset") { const item = summary.presets.find(function (preset) { return preset.path === summary.activePresetPath; }); return item ? item.title : "未选择"; }
				if (part === "systemPrompts") { const item = summary.promptSets.sets.find(function (set) { return set.id === summary.promptSets.activeId; }); return item ? item.name : ""; }
				const item = summary.profiles.find(function (profile) { return profile.id === summary.defaultProfileId; }); return item ? item.name : "未选择";
			}
			const exportPanel = exporting ? h("section", { className: "dsh-tavern-preset-hub-export", "aria-label": "选择导出内容" },
				h("b", null, "选择要导出的内容"),
				parts.map(function (part) {
					// the shared switch, not a native checkbox.
					return h("div", { key: part, className: available[part] ? "" : "is-disabled" },
						h(Switch, { label: "导出" + partNames[part], checked: exporting[part] && available[part] === true, disabled: busy || !available[part], onChange: function (checked) { setExporting(function (current) { return Object.assign({}, current, { [part]: checked }); }); } }),
						h("span", null, partNames[part]), h("small", null, available[part] ? currentName(part) : "未选择，无法导出"));
				}),
				h("div", { className: "dsh-tavern-preset-hub-export-actions" },
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { setExporting(null); } }, "取消"),
					h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: busy || !chosen.length, onClick: function () { void exportBundle(); } }, "导出所选"))) : null;
			async function importBundle(file) {
				if (!file) return;
				let payload, parts = [];
				try {
					payload = await parseTextResourceFile(file);
					const value = JSON.parse(payload.text);
					if (value && value.spec === "dsh-tavern.bundle") {
						if (value.preset) parts.push("预设");
						if (value.systemPrompts) parts.push("系统提示词方案");
						if (value.userProfile) parts.push("长期偏好");
					} else if (value && value.spec === "dsh-tavern.system-prompts") parts.push("系统提示词方案");
					else if (value && Array.isArray(value.prompts)) parts.push("酒馆预设");
				} catch (err) { setError("无法读取文件：" + String(err && err.message || err)); return; }
				if (!parts.length) { setError("无法识别的文件：既不是 DSH Tavern 预设包，也不是酒馆预设或系统提示词文件"); return; }
				if (!await askConfirm("将导入：" + parts.join("、") + "。每一项都作为新方案加入，并设为使用中；已有内容不会被覆盖。继续？")) return;
				return run(async function () {
					const result = await rpc("importSettingsBundle", { payload: payload });
					const imported = result.imported || {}; const done = [];
					if (imported.preset) done.push("预设“" + imported.preset.title + "”" + (imported.preset.selected ? "" : "（不是可运行的酒馆预设，未设为默认）"));
					if (imported.systemPrompts) done.push("系统提示词方案“" + imported.systemPrompts.name + "”");
					if (imported.userProfile) done.push("长期偏好“" + imported.userProfile.name + "”");
					setGeneration(function (value) { return value + 1; });
					return "已导入" + done.join("、") + "。";
				}, ["presets", "user-profile", "system-prompts"]);
			}
			if (section) {
				const detail = section === "preset" ? h(presetLibraryFeature.Tab, { scope: props.scope, visible: props.visible, appendMention: props.appendMention })
					: section === "systemPrompts" ? h(SystemPromptSidebarTab, null)
					: section === "cardPersonas" ? h(CardPersonaTab, null)
					: h(UserPreferenceProfileTab, { scope: props.scope });
				return h("div", { className: "dsh-tavern-preset-hub-detail" },
					h("div", { className: "dsh-tavern-preset-hub-back" }, h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { setSection(""); } }, "← 返回预设")),
					h(React.Fragment, { key: generation }, detail));
			}
			const icons = {
				preset: "M10 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6l-3 8M16 6l3 8M9 19h6",
				systemPrompts: "M10 3L6 21M18 3l-4 18M3 9h18M2 15h18",
				userProfile: "M3 6h10m4 0h4M3 12h4m4 0h10M3 18h10m4 0h4M13 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M13 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
				cardPersonas: "M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8M4 21c0-4 3.6-7 8-7s8 3 8 7"
			};
			function row(part, title, hint, select) {
				return h("section", { className: "dsh-tavern-preset-hub-row", "aria-label": title },
					h("button", { type: "button", className: "dsh-tavern-preset-hub-head", disabled: busy, title: "查看、编辑和单独导出" + title, onClick: function () { setSection(part); } },
						h("span", { className: "dsh-tavern-preset-hub-icon", "aria-hidden": true }, h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: icons[part] }))),
						h("span", { className: "dsh-tavern-preset-hub-titles" }, h("b", null, title), h("small", null, hint)),
						h("span", { className: "dsh-tavern-preset-hub-open" }, "详情 ›")),
					h("div", { className: "dsh-tavern-preset-hub-body" }, select));
			}
			const s = summary;
			return h("div", { className: "dsh-tavern-presets dsh-tavern-preset-hub" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "预设"),
					h("div", { className: "dsh-tavern-question-sub" }, "前三项决定故事怎么讲，导出时可选择其中几项合成一个文件分享；卡片工作台性格决定卡片 Agent 的性格。"),
					h("div", { className: "dsh-tavern-system-prompt-top-actions" },
						h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入"),
						h("button", { className: "dsh-tavern-btn primary", disabled: busy || exporting !== null, onClick: beginExport }, "导出…"),
						h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; void importBundle(file); event.target.value = ""; } }))),
				exportPanel,
				error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
				notice ? h("div", { className: "dsh-tavern-system-prompt-status", role: "status" }, notice) : null,
				// the shared inline menu and loading spinner.
				s === null ? h(PanelLoading, null) : h("div", { className: "dsh-tavern-preset-hub-list" },
					row("preset", "酒馆预设", "新游戏默认使用；每局可在本局设置中单独切换",
						h(InlineField, { kind: "menu", label: "新游戏默认预设", hideLabel: true, value: s.activePresetPath, disabled: busy, onCommit: function (value) { void selectPreset(value); },
							options: [{ value: "", label: "不使用酒馆预设（默认）" }].concat(s.presets.map(function (item) { return { value: item.path, label: item.title }; })) })),
					row("systemPrompts", "系统提示词", "对所有游戏生效",
						h(InlineField, { kind: "menu", label: "系统提示词方案", hideLabel: true, value: s.promptSets.activeId, disabled: busy, onCommit: function (value) { void selectPromptSet(value); },
							options: s.promptSets.sets.map(function (item) { return { value: item.id, label: item.name }; }) })),
					row("userProfile", "长期偏好", "新游戏默认使用；每局可在本局设置中单独切换",
						h(InlineField, { kind: "menu", label: "新游戏默认长期偏好", hideLabel: true, value: s.defaultProfileId, disabled: busy, onCommit: function (value) { void selectProfile(value); },
							options: [{ value: "", label: "不启用" }].concat(s.profiles.map(function (item) { return { value: item.id, label: item.name }; })) })),
					row("cardPersonas", "卡片工作台性格", "卡片 Agent 使用；对所有卡片会话生效",
						h(InlineField, { kind: "menu", label: "卡片工作台性格", hideLabel: true, value: s.activePersonaId, disabled: busy, onCommit: function (value) { void selectPersona(value); },
							options: [{ value: "", label: "空白（默认）" }].concat(s.personas.map(function (item) { return { value: item.id, label: item.name }; })) }))));
		}

		// Shared by the 预设 tab and its detail pages: save an {name, text} export as a download.
		function saveTavernExport(result) {
			downloadTavernBlob(new Blob([result.text], { type: "application/json" }), result.name || "dsh-tavern-preset.dshpreset.json");
		}
