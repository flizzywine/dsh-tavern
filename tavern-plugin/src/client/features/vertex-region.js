// 设置 › 模型 › Google Vertex AI 的地区 (Region) 选择器。
// 通过 globalThis[Symbol.for('dsh.vertexRegion')] 发布，由 bin/settings-models-endpoints-patch.mjs 注入到
// dsh-client-ui-settings-models 的 ProviderEditor 中。
function createVertexRegionFeature({ React, rpc }) {
	const VERTEX_REGIONS = [
		{ id: "global", label: "全球" },
		{ id: "asia-east1", label: "台湾" },
		{ id: "asia-east2", label: "香港" },
		{ id: "asia-northeast1", label: "东京" },
		{ id: "asia-northeast3", label: "首尔" },
		{ id: "asia-south1", label: "孟买" },
		{ id: "asia-southeast1", label: "新加坡" },
		{ id: "asia-southeast2", label: "雅加达" },
		{ id: "australia-southeast1", label: "悉尼" },
		{ id: "us-central1", label: "爱荷华" },
		{ id: "us-east1", label: "南卡罗来纳" },
		{ id: "us-east4", label: "北弗吉尼亚" },
		{ id: "us-east5", label: "俄亥俄" },
		{ id: "us-south1", label: "达拉斯" },
		{ id: "us-west1", label: "俄勒冈" },
		{ id: "us-west4", label: "拉斯维加斯" },
		{ id: "northamerica-northeast1", label: "蒙特利尔" },
		{ id: "southamerica-east1", label: "圣保罗" },
		{ id: "europe-central2", label: "华沙" },
		{ id: "europe-north1", label: "芬兰" },
		{ id: "europe-southwest1", label: "马德里" },
		{ id: "europe-west1", label: "比利时" },
		{ id: "europe-west2", label: "伦敦" },
		{ id: "europe-west3", label: "法兰克福" },
		{ id: "europe-west4", label: "荷兰" },
		{ id: "europe-west6", label: "苏黎世" },
		{ id: "europe-west8", label: "米兰" },
		{ id: "europe-west9", label: "巴黎" },
		{ id: "me-central1", label: "多哈" },
		{ id: "me-central2", label: "达曼" },
		{ id: "me-west1", label: "特拉维夫" }
	];

	function normalizeProject(value) {
		const project = typeof value === "string" ? value.trim() : "";
		return project && /^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(project) ? project : "";
	}

	function normalizeLocation(value) {
		const location = typeof value === "string" ? value.trim().toLowerCase() : "";
		return location && /^[a-z][a-z0-9-]{1,62}$/.test(location) ? location : "";
	}

	function parseProjectFromUrl(url) {
		if (typeof url !== "string") return "";
		const match = url.match(/\/projects\/([A-Za-z0-9.:-]+)\/locations\/[A-Za-z0-9-]+/);
		return match ? normalizeProject(match[1]) : "";
	}

	function parseLocationFromUrl(url) {
		if (typeof url !== "string") return "";
		const pathMatch = url.match(/\/projects\/[A-Za-z0-9.:-]+\/locations\/([A-Za-z0-9-]+)/);
		if (pathMatch) return normalizeLocation(pathMatch[1]);
		const hostMatch = url.match(/^https?:\/\/([a-z0-9-]+)-aiplatform\.googleapis\.com(?:[/:]|$)/i);
		return hostMatch ? normalizeLocation(hostMatch[1]) : "";
	}

	function buildVertexBaseUrl(project, location) {
		const id = normalizeProject(project);
		const loc = normalizeLocation(location);
		if (!id || !loc) return "";
		const host = loc === "global" ? "aiplatform.googleapis.com" : loc + "-aiplatform.googleapis.com";
		return "https://" + host + "/v1/projects/" + id + "/locations/" + loc;
	}

	function formatRegionLabel(id) {
		if (!id) return "默认（global）";
		const entry = VERTEX_REGIONS.find(function (item) { return item.id === id; });
		return entry ? entry.id + " (" + entry.label + ")" : id;
	}

	function VertexRegionField(props) {
		const h = React.createElement;
		const effectiveUrl = String(props.baseURL || props.fallbackBaseURL || "").trim();
		const urlProject = parseProjectFromUrl(effectiveUrl);
		const urlLocation = parseLocationFromUrl(effectiveUrl);

		const [open, setOpen] = React.useState(false);
		const [filter, setFilter] = React.useState("");
		const [draftRegion, setDraftRegion] = React.useState(urlLocation || "global");
		const [pendingRegion, setPendingRegion] = React.useState("");
		const [detectedProject, setDetectedProject] = React.useState("");
		const [manualProject, setManualProject] = React.useState("");
		const [probing, setProbing] = React.useState(false);

		const rootRef = React.useRef(null);
		const filterRef = React.useRef(null);
		const projectRef = React.useRef(null);

		const activeProject = urlProject || normalizeProject(manualProject) || detectedProject;
		const activeRegion = urlLocation || pendingRegion;

		// 当前 baseURL 未包含 project 时，尝试从后端（环境变量 / 已存或正在输入的 API Key）自动解析。
		React.useEffect(function () {
			if (urlProject) return;
			let alive = true;
			setProbing(true);
			rpc("resolveVertexConfig", {
				baseUrl: effectiveUrl,
				keyRef: props.keyRef || "",
				apiKey: props.keyDraft || ""
			}).then(function (result) {
				if (!alive) return;
				const found = normalizeProject(result && result.project);
				if (found) setDetectedProject(found);
			}, function () {}).finally(function () {
				if (alive) setProbing(false);
			});
			return function () { alive = false; };
		}, [urlProject, effectiveUrl, props.keyRef, props.keyDraft]);

		// 点击弹窗外部时关闭
		React.useEffect(function () {
			if (!open || !rootRef.current) return;
			const doc = rootRef.current.ownerDocument;
			const onPointerDown = function (event) {
				if (rootRef.current && !rootRef.current.contains(event.target)) {
					setOpen(false);
				}
			};
			doc.addEventListener("pointerdown", onPointerDown, true);
			if (filterRef.current) filterRef.current.focus();
			return function () { doc.removeEventListener("pointerdown", onPointerDown, true); };
		}, [open]);

		const query = filter.trim().toLowerCase();
		const filtered = VERTEX_REGIONS.filter(function (item) {
			if (!query) return true;
			return item.id.toLowerCase().includes(query) || item.label.toLowerCase().includes(query);
		});
		const customCandidate = query && normalizeLocation(query) && !VERTEX_REGIONS.some(function (item) { return item.id === query; })
			? normalizeLocation(query)
			: "";

		function openMenu() {
			if (props.disabled) return;
			setDraftRegion(activeRegion || "global");
			setFilter("");
			setOpen(function (current) { return !current; });
		}

		function applyRegion(regionId) {
			const loc = normalizeLocation(regionId);
			if (!loc) return;
			setOpen(false);
			if (activeProject) {
				const nextUrl = buildVertexBaseUrl(activeProject, loc);
				if (nextUrl && typeof props.onChangeBaseURL === "function") {
					setPendingRegion("");
					props.onChangeBaseURL(nextUrl);
				}
				return;
			}
			setPendingRegion(loc);
			if (projectRef.current) {
				projectRef.current.focus();
			}
		}

		function handleProjectChange(event) {
			const raw = event.target.value;
			setManualProject(raw);
			const parsed = normalizeProject(raw);
			const loc = activeRegion || draftRegion || "global";
			if (parsed && loc && typeof props.onChangeBaseURL === "function") {
				const nextUrl = buildVertexBaseUrl(parsed, loc);
				if (nextUrl) {
					setPendingRegion("");
					props.onChangeBaseURL(nextUrl);
				}
			}
		}

		function handlePopoverKeyDown(event) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				return;
			}
			const list = customCandidate
				? filtered.concat([{ id: customCandidate, label: "自定义地区" }])
				: filtered;
			if (!list.length) return;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const index = list.findIndex(function (item) { return item.id === draftRegion; });
				const step = event.key === "ArrowDown" ? 1 : -1;
				const nextIndex = index < 0 ? 0 : (index + step + list.length) % list.length;
				setDraftRegion(list[nextIndex].id);
			} else if (event.key === "Enter") {
				event.preventDefault();
				const chosen = list.some(function (item) { return item.id === draftRegion; }) ? draftRegion : list[0].id;
				applyRegion(chosen);
			}
		}

		const showProjectInput = !urlProject && !detectedProject;

		return h("div", { className: (props.fieldClassName ? props.fieldClassName + " " : "") + "dsh-vertex-region-field", ref: rootRef },
			h("span", { className: props.labelClassName || "dsh-vertex-region-label" }, "地区 (Region)"),
			h("div", { className: "dsh-vertex-region-anchor" },
				h("button", {
					type: "button",
					className: (props.inputClassName ? props.inputClassName + " " : "") + "dsh-vertex-region-trigger",
					"aria-label": "地区 (Region)",
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					disabled: props.disabled,
					onClick: openMenu
				},
					h("span", { className: "dsh-vertex-region-value" }, formatRegionLabel(activeRegion)),
					h("span", { className: "dsh-vertex-region-caret", "aria-hidden": "true" }, open ? "▴" : "▾")
				),
				open ? h("div", {
					className: "dsh-vertex-region-popover",
					role: "dialog",
					"aria-label": "选择 Vertex 地区",
					onKeyDown: handlePopoverKeyDown
				},
					h("div", { className: "dsh-vertex-region-filter" },
						h("span", { className: "dsh-vertex-region-filter-label" }, "过滤"),
						h("input", {
							ref: filterRef,
							type: "text",
							className: "dsh-vertex-region-filter-input",
							value: filter,
							placeholder: "输入文本以进行过滤",
							"aria-label": "过滤地区",
							onChange: function (event) { setFilter(event.target.value); }
						})
					),
					h("ul", { className: "dsh-vertex-region-list", role: "listbox", "aria-label": "地区列表" },
						filtered.map(function (item) {
							const selected = draftRegion === item.id;
							return h("li", {
								key: item.id,
								role: "option",
								"aria-selected": selected,
								className: "dsh-vertex-region-option" + (selected ? " is-selected" : ""),
								onClick: function () { setDraftRegion(item.id); },
								onDoubleClick: function () { applyRegion(item.id); }
							}, item.id + " (" + item.label + ")");
						}),
						customCandidate ? h("li", {
							key: "__custom__:" + customCandidate,
							role: "option",
							"aria-selected": draftRegion === customCandidate,
							className: "dsh-vertex-region-option is-custom" + (draftRegion === customCandidate ? " is-selected" : ""),
							onClick: function () { setDraftRegion(customCandidate); },
							onDoubleClick: function () { applyRegion(customCandidate); }
						}, "使用自定义地区：" + customCandidate) : null,
						!filtered.length && !customCandidate ? h("li", { className: "dsh-vertex-region-empty" }, "没有匹配的地区") : null
					),
					h("div", { className: "dsh-vertex-region-actions" },
						h("button", {
							type: "button",
							className: "dsh-vertex-region-btn",
							onClick: function () { setOpen(false); }
						}, "取消"),
						h("button", {
							type: "button",
							className: "dsh-vertex-region-btn is-primary",
							disabled: !normalizeLocation(draftRegion),
							onClick: function () { applyRegion(draftRegion); }
						}, "确定")
					)
				) : null
			),
			showProjectInput ? h("div", { className: "dsh-vertex-project-row" },
				h("input", {
					ref: projectRef,
					type: "text",
					className: props.inputClassName || "dsh-vertex-project-input",
					value: manualProject,
					placeholder: probing ? "正在自动识别 Project ID…" : "填写 GCP Project ID（用于生成地区端点）",
					"aria-label": "GCP Project ID",
					disabled: props.disabled,
					onChange: handleProjectChange
				})
			) : null,
			activeRegion && activeRegion !== "global" ? h("p", { className: "dsh-vertex-region-hint" },
				"Gemini 3/4 仅在 global 地区可用；当前已切换到 " + activeRegion + "。"
			) : null
		);
	}

	function register(ctx) {
		const key = Symbol.for("dsh.vertexRegion");
		const published = Object.freeze({ VertexRegionField: VertexRegionField });
		if (ctx && typeof ctx.effect === "function") {
			ctx.effect(function () {
				globalThis[key] = published;
				return function () {
					if (globalThis[key] === published) delete globalThis[key];
				};
			}, "dsh-tavern: vertex region field");
			return;
		}
		globalThis[key] = published;
	}

	return { VertexRegionField: VertexRegionField, register: register, VERTEX_REGIONS: VERTEX_REGIONS, buildVertexBaseUrl: buildVertexBaseUrl, parseLocationFromUrl: parseLocationFromUrl, parseProjectFromUrl: parseProjectFromUrl };
}
