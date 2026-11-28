		function UserPreferenceProfileTab(props) {
			const h = React.createElement;
			const sessionId = props.scope?.sessionId || "";
			const [profileId, setProfileId] = React.useState("");
			const [record, setRecord] = React.useState(null);
			const [exporting, setExporting] = React.useState(false);
			const [error, setError] = React.useState("");
			React.useEffect(function () {
				const refresh = createUserProfileRefreshModule({
					load: function () { return rpc("getUserPreferenceProfile", { profileId: profileId || undefined }, sessionId); },
					onValue: function (result) { setRecord(result.userProfile); },
					onSuccess: function () { setError(""); },
					onError: function (err) { setError(String(err && err.message || err)); }
				});
				refresh.request();
				function onData(event) { if (tavernDataChangeAffects(event, ["user-profile"], "user-profile")) refresh.request(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { refresh.dispose(); window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [sessionId, profileId]);
			async function exportProfile() {
				setExporting(true); setError("");
				try { saveTavernExport(await rpc("exportSettingsBundle", { include: { userProfile: true }, userProfileId: record.profileId }, sessionId)); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setExporting(false); }
			}
			function archiveSection(title, entry) {
				if (!entry) return null;
				const details = [
					...(entry.dimensions || []).map(function (item) { return [item.label || item.id, item.conclusion, item.evidence].filter(Boolean).join("\n"); }),
					...(entry.rawAnswers || []).map(function (item) { return [item.question, item.answer].filter(Boolean).join("\n"); }),
					...(entry.uncertainties || [])
				];
				const text = [entry.summary, entry.injectionText !== entry.summary ? entry.injectionText : ""].filter(Boolean).join("\n\n");
				return h("section", null,
					h("h3", { className: "dsh-tavern-status-label" }, title),
					text ? h("div", { className: "dsh-tavern-user-profile-text" }, text) : null,
					details.length ? h("details", null, h("summary", null, "偏好维度和访谈记录"),
						h("div", { className: "dsh-tavern-user-profile-text" }, details.join("\n\n"))) : null);
			}
			const loading = !record || Boolean(profileId && record.profileId !== profileId);
			const profiles = record?.profiles || [];
			return h("div", { className: "dsh-tavern-user-profile" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "长期偏好"),
					h("div", { className: "dsh-tavern-question-sub" }, tavernUserProfileRemovalNotice)),
				record && profiles.length ? h("div", { className: "dsh-tavern-profile-controls" },
					h("section", { className: "dsh-tavern-profile-library" },
						h("div", { className: "dsh-tavern-profile-library-bar" },
							h("select", { "aria-label": "查看长期偏好", value: profileId || record.profileId, disabled: exporting, onChange: function (event) { setProfileId(event.target.value); } },
								profiles.map(function (item) { return h("option", { key: item.id, value: item.id }, item.name); })),
							h("button", { type: "button", className: "dsh-tavern-btn", disabled: loading || exporting || !record.hasConfirmed, onClick: exportProfile }, "导出")))) : null,
				h("div", { className: "dsh-tavern-user-profile-body", "aria-busy": loading && !error },
					error ? h("div", { className: "dsh-card-error", role: "alert" }, error) : null,
					loading ? (error ? null : h("div", { className: "dsh-tavern-status-empty" }, "正在读取长期偏好…")) :
						h(React.Fragment, null,
							archiveSection("已确认内容", record.confirmed),
							archiveSection("未确认草案", record.draft),
							!record.confirmed && !record.draft ? h("div", { className: "dsh-tavern-status-empty" }, "暂无已保存的长期偏好。") : null)));
		}

		const tavernUserProfileRemovalNotice = "长期偏好功能已废弃。历史内容仍可查看，已确认的偏好可导出。";
