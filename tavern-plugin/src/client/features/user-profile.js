		function UserPreferenceProfileTab(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const h = React.createElement;
			const sessionId = props.scope && props.scope.sessionId || "";
			const [record, setRecord] = React.useState(null);
			const [currentConversation, setCurrentConversation] = React.useState(null);
			const [editing, setEditing] = React.useState(false);
			const [injectionText, setInjectionText] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const editingRef = React.useRef(editing);
			editingRef.current = editing;
			const refreshRef = React.useRef(null);
			const [error, setError] = usePersistentError("长期偏好");
            const [saveNotice, setSaveNotice] = React.useState("");
			function applyResult(result) {
				const next = result && result.userProfile || null;
				setRecord(next);
				if (result && Object.prototype.hasOwnProperty.call(result, "currentConversation")) setCurrentConversation(result.currentConversation || null);
				if (!editingRef.current && next && next.confirmed) {
					setInjectionText(String(next.confirmed.injectionText || ""));
				}
			}
			React.useEffect(function () {
				const refresh = createUserProfileRefreshModule({
					load: function () { return rpc("getUserPreferenceProfile", { sessionId: sessionId }, sessionId); },
					onValue: applyResult,
					onSuccess: function () { setError(""); },
					onError: function (err) { setError(String(err && err.message || err)); }
				});
				refreshRef.current = refresh;
				refresh.request();
				function onData(event) { if (tavernDataChangeAffects(event, ["user-profile", "sessions"], "user-profile")) refresh.request(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { refresh.dispose(); if (refreshRef.current === refresh) refreshRef.current = null; window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [sessionId]);
			async function manageProfile(action, profileId) {
				if (busy || editing) return;
				let name;
				if (action === "select" || action === "default") name = undefined;
				else {
					name = await askTavernText({ title: action === "create" ? "新长期偏好名称" : "长期偏好名称", initialValue: action === "rename" ? record.name : "", maxLength: 80 });
					if (!name) return;
				}
				setBusy(true); setError(""); setSaveNotice("");
				if (refreshRef.current) refreshRef.current.invalidate();
				try {
					const result = await rpc("manageUserPreferenceProfile", { action: action, profileId: profileId, name: name }, sessionId);
					if (refreshRef.current) refreshRef.current.invalidate();
					applyResult(result);
					notifyTavernDataChanged(["user-profile"], "user-profile");
				} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function exportProfile() {
				setBusy(true); setError(""); setSaveNotice("");
				try { saveTavernExport(await rpc("exportSettingsBundle", { include: { userProfile: true }, userProfileId: record.profileId }, sessionId)); }
				catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			function openAgentTask() {
				window.dispatchEvent(new CustomEvent("dsh-tavern-open-user-profile-task"));
			}
			async function toggleCurrent(applySelected, profileId) {
				if (!currentConversation || busy) return;
				const enabled = applySelected === true;
				setBusy(true); setError(""); setSaveNotice("");
				if (refreshRef.current) refreshRef.current.invalidate();
				try {
					const result = await rpc("setConversationUserProfileEnabled", { sessionId: sessionId, enabled: enabled, profileId: enabled ? (profileId || record.profileId) : undefined }, sessionId);
					if (refreshRef.current) refreshRef.current.invalidate();
					applyResult(result); setSaveNotice("已保存");
					notifyTavernDataChanged(["user-profile", "sessions"], "user-profile");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function beginEdit() {
				if (!record || !record.confirmed) return;
				setInjectionText(String(record.confirmed.injectionText || ""));
				setEditing(true);
			}
			async function saveEdit() {
				if (!injectionText.trim() || busy) return;
				if (!await askConfirm("保存长期偏好修改？已开始的游戏会保留原来的内容，直到你主动更新。")) return;
				setBusy(true); setError(""); setSaveNotice("");
				if (refreshRef.current) refreshRef.current.invalidate();
				try {
					const result = await rpc("updateUserPreferenceProfile", { profileId: record.profileId, expectedRevision: record.confirmedRevision, summary: record.confirmed.summary, injectionText: injectionText }, sessionId);
					if (refreshRef.current) refreshRef.current.invalidate();
					applyResult(result);
					setEditing(false);
					notifyTavernDataChanged(["user-profile"], "user-profile");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			const profiles = record && record.profiles || [];
			const active = currentConversation && currentConversation.enabled ? profiles.find(function (item) { return item.id === (currentConversation.profileId || "default"); }) : null;
			const outdated = active && active.confirmedRevision > currentConversation.revision;
			const header = h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "长期偏好"));
			const gameControls = currentConversation ? h("section", { className: "dsh-tavern-profile-game", "aria-label": "当前游戏长期偏好" },
                    h("select", { className: "dsh-tavern-settings-select", "aria-label": "本局长期偏好", value: currentConversation.enabled ? currentConversation.profileId || "default" : "", disabled: busy || editing, onChange: function (event) { return toggleCurrent(Boolean(event.target.value), event.target.value); } },
                        h("option", { value: "" }, "不使用长期偏好"),
                        currentConversation.enabled && !profiles.some(function (item) { return item.id === currentConversation.profileId && item.hasConfirmed; }) ? h("option", { value: currentConversation.profileId || "default" }, "当前长期偏好（库中已不可用）") : null,
                        profiles.filter(function (item) { return item.hasConfirmed; }).map(function (item) { return h("option", { key: item.id, value: item.id }, item.name); })),
                    h("p", { className: "dsh-tavern-settings-desc" }, "选择后从下一轮生效；查看内容可核对本局使用的长期偏好。"),
                    currentConversation.enabled ? h("details", null, h("summary", null, "查看内容"), h("div", { className: "dsh-tavern-user-profile-text" }, currentConversation.content || "暂无长期偏好内容")) : null,
                    outdated ? h("div", { className: "dsh-tavern-profile-update" }, h("span", null, "长期偏好已修改，这局仍使用修改前的内容。"), h("button", { className: "dsh-tavern-btn", disabled: busy || editing, onClick: function () { toggleCurrent(true, active.id); } }, "更新到当前游戏")) : null
                ) : null;
			if (props.conversationOnly) return h("section", { className: "dsh-local-profile dsh-local-field", "aria-label": "本局长期偏好" }, h("div", { className: "dsh-local-label" }, "长期偏好"), record ? gameControls : h("p", null, "正在读取长期偏好…"), error ? h("p", { role: "alert" }, error) : h("span", { role: "status", className: "dsh-local-feedback" }, busy ? "保存中…" : saveNotice));
			const controls = record ? h("div", { className: "dsh-tavern-profile-controls" },
				h("section", { className: "dsh-tavern-profile-default" }, h("label", { htmlFor: "tavern-profile-default" }, "默认长期偏好"), h("select", { id: "tavern-profile-default", value: record.defaultProfileId || "", disabled: busy || editing, onChange: function (event) { manageProfile("default", event.target.value); } }, h("option", { value: "" }, "不启用"), profiles.filter(function (item) { return item.hasConfirmed; }).map(function (item) { return h("option", { key: item.id, value: item.id }, item.name); })), h("small", null, "用于新开的游戏和卡片会话，已有会话保留原偏好。")),
				h("section", { className: "dsh-tavern-profile-library" }, h("div", { className: "dsh-tavern-profile-section-title" }, "长期偏好库"), h("div", { className: "dsh-tavern-profile-library-bar" }, h("select", { "aria-label": "查看长期偏好", value: record.profileId, disabled: busy || editing, onChange: function (event) { manageProfile("select", event.target.value); } }, profiles.map(function (item) { return h("option", { key: item.id, value: item.id }, item.name); })), h("button", { className: "dsh-tavern-btn", disabled: busy || editing, onClick: function () { manageProfile("create"); } }, "新建"), h("button", { className: "dsh-tavern-btn", disabled: busy || editing, onClick: function () { manageProfile("rename", record.profileId); } }, "重命名"), h("button", { className: "dsh-tavern-btn", disabled: busy || editing || !record.hasConfirmed, title: record.hasConfirmed ? "把这份长期偏好单独导出成一个文件" : "确认后才能导出", onClick: function () { void exportProfile(); } }, "导出")), h("small", null, "在这里查看和编辑，不会改变游戏使用的长期偏好。"))
			) : null;
			if (record === null) return h("div", { className: "dsh-tavern-user-profile" }, header, h("div", { className: "dsh-tavern-user-profile-body" }, error ? h("div", { className: "dsh-card-error" }, error) : h("div", { className: "dsh-tavern-status-empty" }, "正在读取长期偏好…")));
			if (!record.hasConfirmed) return h("div", { className: "dsh-tavern-user-profile" }, header, controls,
				h("div", { className: "dsh-tavern-user-profile-body" },
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-status-empty" }, record.hasDraft ? "已有未确认草案，可交给卡片 Agent 继续核对。" : "通过分批访谈建立长期游玩与写作偏好。"),
					h("div", { className: "dsh-tavern-user-profile-actions" }, h("button", { className: "dsh-tavern-script-primary", onClick: openAgentTask }, record.hasDraft ? "继续核对长期偏好" : "开始建立长期偏好"))
			));
			const confirmed = record.confirmed || {};
			return h("div", { className: "dsh-tavern-user-profile" }, header, controls,
				h("div", { className: "dsh-tavern-user-profile-body" },
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					record.hasDraft ? h("div", { className: "dsh-tavern-extension-note" }, "有待确认的修改；当前仍使用已保存的长期偏好。") : null,
					editing ? h("div", { className: "dsh-tavern-user-profile-editor" },
						h("div", { className: "dsh-tavern-status-label", style: { marginTop: "14px" } }, "长期偏好内容"),
						h("textarea", { value: injectionText, onChange: function (event) { setInjectionText(event.target.value); } }),
						h("div", { className: "dsh-tavern-user-profile-meta" }, "保存到长期偏好库，不会自动改变正在玩的游戏。"),
						h("div", { className: "dsh-tavern-user-profile-actions" },
							h("button", { className: "dsh-tavern-script-primary", disabled: busy || !injectionText.trim(), onClick: saveEdit }, "保存并确认修改"),
							h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setEditing(false); } }, "取消")
						)
					) : h(React.Fragment, null,
						h("div", { className: "dsh-tavern-status-label", style: { marginTop: "14px" } }, "长期偏好内容"),
						h("div", { className: "dsh-tavern-user-profile-text" }, String(confirmed.injectionText || "")),
						h("div", { className: "dsh-tavern-user-profile-actions" },
							h("button", { className: "dsh-tavern-script-primary", onClick: beginEdit }, "直接修改"),
							h("button", { className: "dsh-tavern-btn", onClick: openAgentTask }, "交给卡片 Agent 调查/修改")
						)
					)
			));
		}
