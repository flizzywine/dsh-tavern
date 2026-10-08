		function sceneImageRequestId() {
			// LAN HTTP deployments may not expose crypto.randomUUID. This identifies a
			// request, not an authentication secret; no secure-context API is required.
			return "scene-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
		}
		function sceneImageStageLabel(record) {
			return record && record.cancelRequestedAt ? "正在取消…" : record && record.stage === "queued" ? "排队等待生图…" : record && record.stage === "saving" ? "保存图片…" : record && record.stage === "generating" ? "生成图片…" : "整理画面…";
		}
		async function sceneImagePurchaseConfirmation(record, askConfirm) {
			if (!record || record.outcome !== "unconfirmed" || record.providerTask) return undefined;
			return await askConfirm("上一次生图结果未确认，服务可能已经计费。仍要重新请求一张图片吗？这可能再次产生费用。") ? record.requestId : false;
		}
		function useSceneImageRecord(sessionId, turn) {
			const [state, setState] = React.useState(null);
			React.useEffect(function () {
				let active = true, timer, revision = 0, missingRetries = 0;
				setState(null);
				if (!sessionId || !turn) return;
				async function refresh(event) {
					if (event && event.detail && event.detail.sessionId !== sessionId) return;
					const requested = ++revision;
					window.clearTimeout(timer);
					try {
						const result = await rpc("sceneImageStatus", { turn: turn }, sessionId);
						if (!active || requested !== revision) return;
						setState(result.illustration);
						if (result.illustration.reason === "target-unavailable") {
                            if (missingRetries++ < 5) timer = window.setTimeout(refresh, 1500);
                        } else {
                            missingRetries = 0;
                            if (result.illustration.status === "running") timer = window.setTimeout(refresh, 1500);
                        }
					} catch (e) {
						if (active && requested === revision) setState(function (previous) { return Object.assign({}, previous || { status: "unavailable", versions: [] }, { error: String(e.message || e) }); });
					}
				}
				void refresh();
				window.addEventListener("dsh-tavern-image-changed", refresh);
				window.addEventListener("dsh-tavern-image-settings-changed", refresh);
				window.addEventListener("focus", refresh);
				return function () { active = false; window.clearTimeout(timer); window.removeEventListener("dsh-tavern-image-changed", refresh); window.removeEventListener("dsh-tavern-image-settings-changed", refresh); window.removeEventListener("focus", refresh); };
			}, [sessionId, turn]);
			return state;
		}
		function SceneImageAction(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const [settings, setSettings] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const requestRef = React.useRef(null);
			const state = useSceneImageRecord(props.sessionId, props.turn);
			React.useEffect(function () {
				let active = true, revision = 0;
				async function refresh() {
					const request = ++revision;
					try { const result = await rpc("getSceneImageSettings", { conversation: true, sessionId: props.sessionId }, props.sessionId); if (active && revision === request) setSettings(result.settings); }
					catch (_) { if (active && revision === request) setSettings(null); }
				}
				void refresh();
				const timer = window.setInterval(refresh, 15000);
				window.addEventListener("dsh-tavern-image-settings-changed", refresh);
				window.addEventListener("focus", refresh);
				return function () { active = false; window.clearInterval(timer); window.removeEventListener("dsh-tavern-image-settings-changed", refresh); window.removeEventListener("focus", refresh); };
			}, []);
			async function generate() {
				const reusable = requestRef.current && !(state && requestRef.current.id === state.requestId && ["failed", "cancelled", "idle"].includes(state.status));
				const clickId = reusable && state && requestRef.current.key === state.key ? requestRef.current.id : sceneImageRequestId();
				recordImageInteraction(props.sessionId, props.turn, clickId, "click");
				if (!settings || !settings.enabled || !settings.ready || settings.migrationPending || !state || !state.key || busy || props.running || state.status === "running" || state.recovery === "save" || state.versions && state.versions.length) { recordImageInteraction(props.sessionId, props.turn, clickId, "blocked", "not-ready"); return; }
				const confirmNewRequestId = await sceneImagePurchaseConfirmation(state, askConfirm);
				if (confirmNewRequestId === false) { recordImageInteraction(props.sessionId, props.turn, clickId, "cancelled", "confirmation"); return; }
				if (requestRef.current && requestRef.current.id === state.requestId && ["failed", "cancelled", "idle"].includes(state.status)) requestRef.current = null;
				setBusy(true); setError("");
				if (!requestRef.current || requestRef.current.key !== state.key) requestRef.current = { key: state.key, id: clickId };
				try { await rpc("generateSceneImage", { turn: props.turn, key: state.key, requestId: requestRef.current.id, confirmNewRequestId: confirmNewRequestId }, props.sessionId); requestRef.current = null; }
				catch (e) { setError(String(e.message || e)); }
				finally { setBusy(false); window.dispatchEvent(new CustomEvent("dsh-tavern-image-changed", { detail: { sessionId: props.sessionId } })); }
			}
			if (!settings || settings.enabled !== true) return null;
			const unavailable = settings.migrationPending ? "旧生图配置待迁移，请在全局设置中保存生图 API 配置。" : !settings.ready ? "生图配置未完成，请在设置中补全并保存。" : "";
			const working = state && state.status === "running";
			return React.createElement(React.Fragment, null,
				React.createElement("button", { type: "button", className: "dsh-tavern-choice-trigger", title: unavailable || (!props.turn ? "请先生成一段正文" : !state ? "正在读取生图状态…" : state.error || undefined), disabled: Boolean(unavailable) || !state || !state.key || props.running || busy || working || state.recovery === "save" || state.versions && state.versions.length > 0, onClick: generate }, busy ? "整理画面…" : working ? sceneImageStageLabel(state) : state && state.recovery === "save" ? "图片待保存" : state && state.outcome === "unconfirmed" ? state.providerTask ? "查询原任务" : "重新生图" : state && state.status === "failed" && !state.versions.length ? "重试生图" : "生图"),
				unavailable ? React.createElement("span", { role: "status", className: "dsh-tavern-settings-desc" }, unavailable) : null,
				// The saved failure already shows under the illustration; only report this click's own error here.
				error && error !== (state && state.error) ? React.createElement("span", { role: "alert", className: "dsh-tavern-settings-error" }, error) : null
			);
		}
		function SceneImageSettings() {
			const [form, setForm] = React.useState(null);
			const [dirty, setDirty] = React.useState(false);
			const [key, setKey] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const [connection, setConnection] = React.useState(null);
			const [models, setModels] = React.useState([]);
			const [modelNotice, setModelNotice] = React.useState("");
			const [checking, setChecking] = React.useState("");
			const [trial, setTrial] = React.useState({ state: "idle" });
			async function runTrial() {
				setTrial({ state: "running" });
				try { setTrial({ state: "done", result: await rpc("testSceneImageGeneration", {}) }); }
				catch (e) { setTrial({ state: "failed", error: String(e.message || e) }); }
			}
			React.useEffect(function () {
				let active = true;
				rpc("getSceneImageSettings").then(function (result) { if (active) setForm(result.settings); }, function (e) { if (active) setNotice(String(e.message || e)); });
				return function () { active = false; };
			}, []);
			async function save(patch) {
				setBusy(true); setNotice("");
				try {
					const channel = form.channels.find(function (item) { return item.id === form.provider; });
					const input = patch ? Object.assign({ provider: form.provider }, patch) : { provider: form.provider, style: form.style, apiKey: key };
					if (!patch) channel.fields.forEach(function (field) { input[field] = form[field]; });
					if (!patch && form.provider === "comfyui") input.workflow = form.workflow;
					if (!patch && form.provider === "novelai") { input.endpoints = syncedEndpoints(form); input.artists = form.artists || []; }
					let result = await rpc("saveSceneImageSettings", input); setForm(result.settings); setKey(""); setDirty(false);
					window.dispatchEvent(new CustomEvent("dsh-tavern-image-settings-changed"));
					setNotice("已保存全局 API 配置；请在本局设置中开启场景生图。");
					window.dispatchEvent(new CustomEvent("dsh-tavern-image-settings-changed"));
					return true;
				}
				catch (e) { setNotice(String(e.message || e)); return false; }
				finally { setBusy(false); }
			}
			async function chooseChannel(provider) {
				setBusy(true); setNotice("");
				setConnection(null); setModels([]); setModelNotice("");
				try {
					const result = await rpc("getSceneImageSettings", { provider });
					setForm(result.settings); setKey(""); setDirty(true);
					setNotice("已读取此渠道配置；配置完成后点击保存。未保存的修改不保留。");
				} catch (e) { setNotice(String(e.message || e)); }
				finally { setBusy(false); }
			}
			const selectedChannel = form && (form.channels || []).find(function (item) { return item.id === form.provider; });
			const modelOptions = Array.from(new Set((selectedChannel && selectedChannel.models || []).concat(models)));
			function resetConnection() { setConnection(null); setModels([]); setModelNotice(""); }
			async function inspectConnection(listModels) {
				setBusy(true); setChecking(listModels ? "models" : "connection"); setNotice("");
				if (listModels) setModelNotice(""); else setConnection(null);
				try {
					const result = await rpc(listModels ? "listSceneImageModels" : "testSceneImageConnection", { provider: form.provider, endpoint: form.endpoint, baseURL: form.baseURL, authType: form.authType, username: form.username, apiKey: key });
					if (listModels) { setModels(result.models || []); setModelNotice(result.message); }
					else setConnection(result);
				} catch (e) {
					if (listModels) setModelNotice(String(e.message || e));
					else setConnection({ status: "failed", message: String(e.message || e) });
				} finally { setBusy(false); setChecking(""); }
			}
			async function importWorkflow(event) {
				const file = event.target.files && event.target.files[0];
				if (!file) return;
				setBusy(true); setNotice("");
				try {
					if (file.size > 512000) throw new Error("工作流文件不能超过 500 KB");
					let workflow; try { workflow = JSON.parse(await file.text()); } catch (e) { throw new Error("工作流不是有效 JSON 文件"); }
					setForm(function (current) { return Object.assign({}, current, { workflow: workflow }); }); setDirty(true);
					setNotice("已选择工作流，保存后将校验；不会请求生图。请只导入可信维护者提供的文件。");
				} catch (e) { setNotice(String(e.message || e)); }
				finally { setBusy(false); event.target.value = ""; }
			}
			// NovelAI endpoints and the artist library are lists edited in place; only
			// the save button writes them. Ids only need to be unique and stable.
			function libraryId() { return Math.random().toString(36).slice(2, 10); }
			function syncedEndpoints(current) {
				return (current.endpoints || []).map(function (entry) { return entry.id === current.endpoint ? Object.assign({}, entry, { baseURL: current.baseURL }) : entry; });
			}
			const endpoints = form && form.endpoints || [];
			const currentEndpoint = form && endpoints.find(function (entry) { return entry.id === form.endpoint; });
			// Each save writes only the shown endpoint's key, so a typed key must be saved before leaving it.
			function keyPending() {
				if (!key) return false;
				setNotice("请先保存当前接入点的 API Key，再切换或新建接入点。");
				return true;
			}
			function switchEndpoint(id) {
				setDirty(true); setKey(""); resetConnection();
				setForm(function (current) {
					const list = syncedEndpoints(current), next = list.find(function (entry) { return entry.id === id; });
					return Object.assign({}, current, { endpoints: list, endpoint: id, baseURL: next ? next.baseURL : "", hasKey: Boolean(next && next.hasKey) });
				});
			}
			function addEndpoint() {
				if (keyPending()) return;
				const entry = { id: libraryId(), name: "接入点 " + (endpoints.length + 1), baseURL: "", hasKey: false };
				setForm(function (current) { return Object.assign({}, current, { endpoints: syncedEndpoints(current).concat([entry]) }); });
				switchEndpoint(entry.id);
				setNotice("已新增接入点，请填写地址和 API Key 后保存。");
			}
			function removeEndpoint() {
				if (endpoints.length < 2) return;
				const rest = endpoints.filter(function (entry) { return entry.id !== form.endpoint; });
				setForm(function (current) { return Object.assign({}, current, { endpoints: rest }); });
				switchEndpoint(rest[0].id);
				setNotice("已删除接入点「" + (currentEndpoint ? currentEndpoint.name : "") + "」；保存后生效。");
			}
			function renameEndpoint(name) {
				setDirty(true);
				setForm(function (current) { return Object.assign({}, current, { endpoints: (current.endpoints || []).map(function (entry) { return entry.id === current.endpoint ? Object.assign({}, entry, { name: name }) : entry; }) }); });
			}
			const artists = form && form.artists || [];
			const currentArtist = form && artists.find(function (entry) { return entry.id === form.activeArtist; });
			function updateArtists(list, active) {
				setDirty(true);
				setForm(function (current) { return Object.assign({}, current, { artists: list }, active === undefined ? {} : { activeArtist: active }); });
			}
			function addArtist() {
				const entry = { id: libraryId(), name: "画师串 " + (artists.length + 1), prompt: "", quality: "", negative: "" };
				updateArtists(artists.concat([entry]), entry.id);
			}
			function removeArtist() {
				if (!currentArtist) return;
				updateArtists(artists.filter(function (entry) { return entry.id !== currentArtist.id; }), "");
				setNotice("已删除画师串「" + currentArtist.name + "」；保存后生效。");
			}
			function editArtist(field, value) {
				updateArtists(artists.map(function (entry) { return entry.id === form.activeArtist ? Object.assign({}, entry, { [field]: value }) : entry; }));
			}
			// Previews are shrunk in the browser (longest side 512px, JPEG) before upload,
			// and saved with the settings; until then the form holds the data URL.
			async function choosePreview(event) {
				const file = event.target.files && event.target.files[0];
				event.target.value = "";
				if (!file) return;
				try {
					if (!/^image\//.test(file.type)) throw new Error("请选择图片文件");
					const bitmap = await createImageBitmap(file);
					const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
					const canvas = document.createElement("canvas");
					canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
					canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
					if (bitmap.close) bitmap.close();
					editArtist("previewData", canvas.toDataURL("image/jpeg", 0.85));
				} catch (e) { setNotice("预览图读取失败：" + String(e.message || e)); }
			}
			function previewSource(entry) {
				if (entry.previewData) return entry.previewData;
				return entry.preview ? "/api/dsh-tavern/scene-image-artist-preview?" + new URLSearchParams({ id: entry.id, v: entry.preview }).toString() : "";
			}
			function artistCard(entry) {
				const selected = (form.activeArtist || "") === (entry ? entry.id : "");
				const source = entry ? previewSource(entry) : "";
				return React.createElement("button", { key: entry ? entry.id : "", type: "button", className: "dsh-tavern-btn dsh-tavern-artist-card", "aria-pressed": selected, disabled: busy, title: entry ? entry.prompt : "不使用画师串",
					onClick: function () { updateArtists(artists, entry ? entry.id : ""); } },
					React.createElement("span", { className: "dsh-tavern-artist-thumb" }, source ? React.createElement("img", { src: source, alt: "" }) : (entry ? "无预览" : "—")),
					React.createElement("span", { className: "dsh-tavern-artist-name" }, entry ? entry.name : "不使用"));
			}
			function artistLibrary() {
				const h = React.createElement;
				return h("div", { className: "dsh-tavern-image-section-body" },
					h("div", { role: "group", "aria-label": "画师串", className: "dsh-tavern-artist-grid" }, [artistCard(null)].concat(artists.map(artistCard)).concat([
						h("button", { key: "add", type: "button", className: "dsh-tavern-btn dsh-tavern-artist-card dsh-tavern-artist-add", disabled: busy || artists.length >= 50, onClick: addArtist },
							h("span", { className: "dsh-tavern-artist-thumb", "aria-hidden": true }, "+"), h("span", { className: "dsh-tavern-artist-name" }, "新建画师串"))])),
					currentArtist ? h("div", { className: "dsh-tavern-artist-editor" },
						h("div", { className: "dsh-tavern-image-row" },
							h("label", null, "名称", h("input", { value: currentArtist.name, maxLength: 40, disabled: busy, onChange: function (e) { editArtist("name", e.target.value); } })),
							h("div", { className: "dsh-tavern-image-field" }, h("span", null, "预览图"),
								h("div", { className: "dsh-tavern-image-actions" },
									h("label", { className: "dsh-tavern-btn dsh-tavern-file-btn" }, previewSource(currentArtist) ? "更换图片" : "上传图片", h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", disabled: busy, onChange: choosePreview })),
									previewSource(currentArtist) ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { updateArtists(artists.map(function (entry) { return entry.id === currentArtist.id ? Object.assign({}, entry, { preview: "", previewData: "" }) : entry; })); } }, "移除") : null))),
						h("label", null, "画师与风格标签", h("textarea", { value: currentArtist.prompt, rows: 2, maxLength: 1000, placeholder: "例如：artist:wlop, artist:ciloranko；支持 {选项A|选项B}", disabled: busy, onChange: function (e) { editArtist("prompt", e.target.value); } })),
						h("div", { className: "dsh-tavern-image-row" },
							h("label", null, "质量词（选填）", h("textarea", { value: currentArtist.quality, rows: 2, maxLength: 600, placeholder: "填写后替代通用正面提示词", disabled: busy, onChange: function (e) { editArtist("quality", e.target.value); } })),
							h("label", null, "负面词（选填）", h("textarea", { value: currentArtist.negative, rows: 2, maxLength: 4000, placeholder: "填写后替代通用负面提示词", disabled: busy, onChange: function (e) { editArtist("negative", e.target.value); } }))),
						h("div", { className: "dsh-tavern-image-actions" }, h("button", { type: "button", className: "dsh-tavern-btn danger", disabled: busy, onClick: removeArtist }, "删除此画师串"))) : null);
			}
			function channelField(field) {
				if (field === "username" && form.authType !== "basic") return null;
				const labels = { baseURL: "API 根地址", model: "生图模型名称", size: "图片尺寸／分辨率", aspectRatio: "画面比例", authType: "服务鉴权", username: "鉴权用户名", negativePrompt: "负面提示词（不希望出现的内容）", steps: "生成步数", guidance: "提示词引导强度（CFG）", qualityTags: "正面提示词", qualityPreset: "官方质量词预设", ucPreset: "官方负面预设", sampler: "采样器", noiseSchedule: "噪声表", cfgRescale: "CFG Rescale", varietyBoost: "Variety Boost", promptOrder: "段落排列顺序", sectionWeights: "段落权重", useOrder: "保留用户顺序", seed: "随机种子", referenceImage: "图片参考（Base64，img2img）", imageStrength: "图片参考强度" };
				const placeholders = { negativePrompt: "留空沿用默认；例如：模糊、水印、多余的手指", qualityTags: "留空沿用默认；支持通配符 {选项A|选项B}", promptOrder: "留空沿用默认 quality,scene,style,artist", sectionWeights: "留空不改权重；例如：1.5,1,1,0.75", seed: "留空每次随机；填写后相同种子可复现", referenceImage: "留空为纯文生图；只接受 base64，可带 data:image/...;base64, 前缀，不会代下载网址", imageStrength: "留空按 0.7；越小越贴近参考图", cfgRescale: "留空为 0；0–1，可减轻高 CFG 的过饱和" };
				const limits = { baseURL: 2000, qualityTags: 600, cfgRescale: 8, qualityPreset: 16, ucPreset: 16, imageStrength: 8, promptOrder: 120, sectionWeights: 120, useOrder: 8, negativePrompt: 4000, seed: 20, referenceImage: 50000 };
				const rows = { negativePrompt: 3, qualityTags: 2 };
				// Enumerated controls; the empty string means "not chosen yet", and the
				// fallback value below is the same default the backend applies.
				const choices = {
					authType: [["none", "无需鉴权"], ["basic", "用户名和密码"], ["bearer", "Bearer Token（反向代理）"]],
					useOrder: [["true", "保留（按段落顺序提交）"], ["false", "不保留（由模型自行排序）"]],
					qualityPreset: [["none", "不追加"], ["light", "轻量"], ["standard", "标准"]],
					ucPreset: [["none", "不追加"], ["light", "轻量"], ["heavy", "重度"], ["human-focus", "人物向"]],
					sampler: [["k_euler_ancestral", "Euler Ancestral（默认）"], ["k_euler", "Euler"], ["k_dpmpp_2s_ancestral", "DPM++ 2S Ancestral"], ["k_dpmpp_2m", "DPM++ 2M"], ["k_dpmpp_2m_sde", "DPM++ 2M SDE"], ["k_dpmpp_sde", "DPM++ SDE"], ["ddim_v3", "DDIM"]],
					noiseSchedule: [["karras", "Karras（默认）"], ["native", "Native"], ["exponential", "Exponential"], ["polyexponential", "Polyexponential"]],
					varietyBoost: [["false", "关闭"], ["true", "开启（构图更多样）"]]
				};
				const choiceDefaults = { authType: "none", useOrder: "true", qualityPreset: "none", ucPreset: "none", sampler: "k_euler_ancestral", noiseSchedule: "karras", varietyBoost: "false" };
				function change(event) { const value = event.target.value; setDirty(true); if (["baseURL", "authType", "username"].includes(field)) resetConnection(); if (field === "authType") setKey(""); setForm(function (current) { return Object.assign({}, current, { [field]: value }, field === "authType" ? { hasKey: false } : {}); }); }
				let control;
				const options = field === "sampler" && /^nai-diffusion-5/.test(form.model || "") ? choices.sampler.filter(function (option) { return option[0] !== "ddim_v3"; }) : choices[field];
				if (choices[field]) control = React.createElement("select", { value: form[field] || choiceDefaults[field], disabled: busy, onChange: change }, options.map(function (option) { return React.createElement("option", { key: option[0], value: option[0] }, option[1]); }));
				else if (rows[field]) control = React.createElement("textarea", { value: form[field] || "", rows: rows[field], maxLength: limits[field], placeholder: placeholders[field], disabled: busy, onChange: change });
				else if (["steps", "guidance", "seed", "imageStrength", "cfgRescale"].includes(field)) control = React.createElement("input", { value: form[field] || "", type: "number", min: field === "steps" ? undefined : 0, max: field === "seed" ? 4294967295 : ["imageStrength", "cfgRescale"].includes(field) ? 1 : undefined, step: field === "cfgRescale" ? "0.05" : ["guidance", "imageStrength"].includes(field) ? "0.1" : "1", placeholder: placeholders[field] || "留空沿用默认", disabled: busy, onChange: change });
				else control = React.createElement("input", { value: form[field] || "", type: "text", maxLength: limits[field], placeholder: placeholders[field], disabled: busy, onChange: change });
				return React.createElement("label", { key: field }, labels[field] || field, control);
			}
			const h = React.createElement;
			const novelai = form && form.provider === "novelai";
			const v5 = novelai && /^nai-diffusion-5/.test(form.model || "");
			function section(title, hint) {
				return h.apply(null, ["section", { className: "dsh-tavern-image-section", "aria-label": title }, h("h4", null, title), hint ? h("p", { className: "dsh-tavern-image-hint" }, hint) : null].concat(Array.prototype.slice.call(arguments, 2)));
			}
			function row() { return h.apply(null, ["div", { className: "dsh-tavern-image-row" }].concat(Array.prototype.slice.call(arguments))); }
			function actions() { return h.apply(null, ["div", { className: "dsh-tavern-image-actions" }].concat(Array.prototype.slice.call(arguments))); }
			function fieldsOf(names) { return selectedChannel ? names.filter(function (field) { return selectedChannel.fields.includes(field); }) : []; }
			// ComfyUI shows only parameters the imported workflow can bind.
			function advancedVisible(field) {
				if (form.provider !== "comfyui") return true;
				const binding = field === "negativePrompt" ? "negative" : field;
				return Boolean(form[field] || form.workflow && form.workflow.bindings && form.workflow.bindings[binding] && form.workflow.bindings[binding].length);
			}
			const needsKey = form && form.provider !== "dsh-image-gen" && !(["webui", "comfyui"].includes(form.provider) && form.authType === "none");
			const negativeFields = fieldsOf(["negativePrompt"]).filter(advancedVisible);
			const sampling = fieldsOf(["steps", "guidance"]).filter(advancedVisible);
			const setStyle = function (patch) { setDirty(true); setForm(function (current) { return Object.assign({}, current, { style: Object.assign({}, current.style, patch) }); }); };
			return h("div", { className: "dsh-tavern-settings-group" },
				h("h3", { className: "dsh-tavern-image-settings-title" }, "生图 API 配置（全局共用）"),
				h("div", { className: "dsh-tavern-image-settings" },
					h("p", { className: "dsh-tavern-settings-intro" }, "保存后，在本局设置中开启场景生图，再点输入框上方的「生图」。连接测试不生成图片；实际生图可能产生费用。"),
					!form ? null : section("服务", selectedChannel ? selectedChannel.hint : "",
						h("label", null, "提供商", h("select", { value: form.provider, disabled: busy, onChange: function (e) { return chooseChannel(e.target.value); } }, (form.channels || []).map(function (item) { return h("option", { key: item.id, value: item.id }, item.label); }))),
						form.migrationPending ? h("p", { role: "status", className: "dsh-tavern-image-hint" }, "检测到旧配置。保存后将迁入生图模块；旧密钥不会显示或发送到新地址。") : null,
						novelai ? h("div", { className: "dsh-tavern-image-inline" },
							h("label", null, "接入点", h("select", { value: form.endpoint || "", disabled: busy, onChange: function (e) { if (!keyPending()) switchEndpoint(e.target.value); } }, endpoints.map(function (entry) { return h("option", { key: entry.id, value: entry.id }, entry.name + (entry.hasKey ? "" : "（未配置 Key）")); }))),
							h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || endpoints.length >= 10, onClick: addEndpoint }, "新建"),
							endpoints.length > 1 ? h("button", { type: "button", className: "dsh-tavern-btn danger", disabled: busy, onClick: removeEndpoint }, "删除") : null) : null,
						novelai ? h("p", { className: "dsh-tavern-image-hint" }, "官方站和同协议中转站可各存一条、各用各的 Key；切换只改请求地址，模型和提示词设置不变。") : null,
						novelai && currentEndpoint ? row(h("label", null, "接入点名称", h("input", { value: currentEndpoint.name, maxLength: 40, disabled: busy, onChange: function (e) { renameEndpoint(e.target.value); } })), channelField("baseURL"))
							: fieldsOf(["baseURL"]).map(channelField),
						fieldsOf(["authType", "username"]).length ? row.apply(null, fieldsOf(["authType", "username"]).map(channelField)) : null,
						needsKey ? h("label", null, (form.authType === "basic" ? "鉴权密码" : "API Key") + (form.hasKey ? "（已保存，留空沿用）" : ""), h("input", { type: "password", autoComplete: "new-password", value: key, placeholder: form.hasKey ? "更换地址后需重新填写" : "", disabled: busy, onChange: function (e) { setKey(e.target.value); setDirty(true); resetConnection(); } })) : null,
						form.provider === "dsh-image-gen" ? actions(
							h("span", { role: "status" }, form.pluginError || (form.pluginReady ? "已读取插件配置：" + form.pluginProvider + " / " + form.model + " · " + form.aspectRatio + " · " + form.size + "。未验证 Key 或执行生图。" : "请先在 dsh-image-gen 插件设置中配置云端渠道和 Key。")),
							h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { return chooseChannel("dsh-image-gen"); } }, "刷新插件配置"))
							: actions(
								h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !form.baseURL, onClick: function () { return inspectConnection(false); } }, checking === "connection" ? "验证中…" : "测试连接与鉴权"),
								connection ? h("span", { role: "status", "data-connection-status": connection.status }, connection.message) : null),
						connection && connection.httpStatus ? h("details", null,
							h("summary", null, "连接诊断"),
							h("p", { className: "dsh-tavern-image-hint" }, "HTTP " + connection.httpStatus + " · 只读检查路径：" + (connection.probePath || "/") + "。未调用生图接口；根路径返回 404 不代表生图接口不可用。")) : null),
					!form ? null : section("模型与画面", "",
						selectedChannel && form.provider !== "dsh-image-gen" && selectedChannel.fields.includes("model") ? h("div", { className: "dsh-tavern-image-inline" },
							h("label", null, "生图模型", h("input", { list: "dsh-tavern-image-models", value: form.model || "", placeholder: "选择或输入模型名称", disabled: busy, onChange: function (e) { const value = e.target.value; setDirty(true); setForm(function (current) { return Object.assign({}, current, { model: value }); }); } })),
							h("datalist", { id: "dsh-tavern-image-models" }, modelOptions.map(function (model) { return h("option", { key: model, value: model }, model); })),
							selectedChannel.canListModels ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !form.baseURL, onClick: function () { return inspectConnection(true); } }, checking === "models" ? "获取中…" : "获取模型列表") : null) : null,
						// A datalist only offers entries matching the typed value, so a filled
						// model name hides the fetched list. Offer the fetched models directly.
						models.length && selectedChannel && selectedChannel.fields.includes("model") ? h("label", null, "从获取的 " + models.length + " 个模型中选择",
							h("select", { value: models.includes(form.model) ? form.model : "", disabled: busy, onChange: function (e) { const value = e.target.value; if (!value) return; setDirty(true); setForm(function (current) { return Object.assign({}, current, { model: value }); }); } },
								h("option", { value: "" }, "请选择…"),
								models.map(function (model) { return h("option", { key: model, value: model }, model); }))) : null,
						modelNotice ? h("p", { role: "status", className: "dsh-tavern-image-hint" }, modelNotice) : null,
						form.provider === "comfyui" ? h("div", { className: "dsh-tavern-image-field" }, h("span", null, "工作流"),
							actions(h("span", { className: "dsh-tavern-image-hint" }, form.workflow ? form.workflow.name || "已选择，保存时校验" : "尚未导入"),
								h("label", { className: "dsh-tavern-btn dsh-tavern-file-btn" }, form.workflow ? "更换工作流" : "导入工作流", h("input", { type: "file", accept: ".json,application/json", disabled: busy, onChange: importWorkflow })))) : null,
						form.provider !== "dsh-image-gen" && fieldsOf(["size", "aspectRatio"]).length ? row.apply(null, fieldsOf(["size", "aspectRatio"]).map(channelField)) : null,
						row(h("label", null, "风格预设", h("select", { value: form.style.preset, disabled: busy, onChange: function (e) { setStyle({ preset: e.target.value }); } }, (form.stylePresets || []).map(function (preset) { return h("option", { key: preset.id, value: preset.id }, preset.label); }))),
							!["comfyui", "dsh-image-gen"].includes(form.provider) ? h("label", null, "画幅方向", h("select", { value: form.style.orientation || "auto", disabled: busy, onChange: function (e) { setStyle({ orientation: e.target.value }); } },
								h("option", { value: "auto" }, "按画面自动切换横竖"), h("option", { value: "fixed" }, "固定为上面的尺寸"))) : null),
						!["comfyui", "dsh-image-gen"].includes(form.provider) && (form.style.orientation || "auto") === "auto" ? h("p", { className: "dsh-tavern-image-hint" }, "每张图由 AI 按构图选竖图或横图，把上面的尺寸或比例横竖对调，分辨率不变；正方形和 1K、2K 这类尺寸保持不变。") : null,
						h("label", null, "补充描述／标签（选填）", h("textarea", { value: form.style.custom, rows: 2, maxLength: 2000, placeholder: "例如：低饱和、柔和光线、胶片质感", disabled: busy, onChange: function (e) { setStyle({ custom: e.target.value }); } }))),
					novelai ? section("画师串", "可存多套、点选切换，可附预览图。选中的画师串拼在提示词的 artist 段。", artistLibrary()) : null,
					form && (novelai || negativeFields.length) ? section("提示词", novelai ? "留空沿用默认。官方预设选中后会把该模型的标准质量词或负面词并入，并与手写内容去重。" : "",
						novelai ? channelField("qualityTags") : null,
						negativeFields.map(channelField),
						novelai ? row(channelField("qualityPreset"), channelField("ucPreset")) : null) : null,
					form && (novelai || sampling.length) ? h("details", { className: "dsh-tavern-image-section" },
						h("summary", null, "生成参数"),
						h("div", { className: "dsh-tavern-image-section-body" },
							h("p", { className: "dsh-tavern-image-hint" }, "选填，留空沿用默认。步数越高通常越慢，也可能增加费用。" + (form.provider === "comfyui" ? "只显示当前工作流已映射的参数。" : "")),
							sampling.length ? row.apply(null, sampling.map(channelField)) : null,
							novelai ? row(channelField("sampler"), channelField("noiseSchedule")) : null,
							novelai ? row(channelField("cfgRescale"), v5 ? channelField("seed") : channelField("varietyBoost")) : null,
							novelai && !v5 ? row(channelField("seed")) : null)) : null,
					novelai ? h("details", { className: "dsh-tavern-image-section" },
						h("summary", null, "段落顺序与权重（高级）"),
						h("div", { className: "dsh-tavern-image-section-body" }, h("p", { className: "dsh-tavern-image-hint" }, "提示词按 quality、scene、style、artist 四段拼接。顺序须为四段的完整排列；权重为不超过四个正数，作用于整段，V4 及以上按数值生效，Anime V3 只分加强、不变、减弱。{选项A|选项B} 每次随机取一个，单独的 {标签} 按 NovelAI 权重语法原样提交。"),
						row(channelField("promptOrder"), channelField("sectionWeights")),
						row(channelField("useOrder")))) : null,
					h("div", { className: "dsh-tavern-image-footer" },
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: !form || busy, onClick: function () { return save(); } }, busy && !checking ? "保存中…" : "保存生图配置"),
						notice ? h("span", { role: "status" }, notice) : (dirty ? h("span", { className: "dsh-tavern-image-hint" }, "有未保存的修改") : null)),
					form ? h("div", { className: "dsh-tavern-image-field", "aria-label": "测试生图" },
						actions(
							h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || dirty || trial.state === "running", onClick: function () { setTrial({ state: "confirm" }); } }, trial.state === "running" ? "生成中…" : "测试生图"),
							h("span", { className: "dsh-tavern-image-hint" }, dirty ? "请先保存配置再测试。" : "按已保存的配置生成一张固定测试图，不进入任何游戏。")),
						trial.state === "confirm" ? actions(
							h("span", { role: "status" }, "会真实请求一次生图，可能产生费用。"),
							h("button", { type: "button", className: "dsh-tavern-btn", onClick: runTrial }, "确认生成"),
							h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { setTrial({ state: "idle" }); } }, "取消")) : null,
						trial.state === "done" ? h("figure", { className: "dsh-tavern-image-trial" },
							h("img", { src: "data:" + trial.result.mediaType + ";base64," + trial.result.data, alt: "测试生图结果" }),
							h("figcaption", { role: "status" }, "生成成功" + (trial.result.model ? " · " + trial.result.model : "") + " · 用时 " + Math.round(trial.result.durationMs / 1000) + " 秒")) : null,
						trial.state === "failed" ? h("p", { role: "alert", className: "dsh-tavern-settings-error" }, trial.error) : null) : null)
			);
		}
