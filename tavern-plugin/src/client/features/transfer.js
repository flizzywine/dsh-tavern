// Export / import of `.dshtransfer` bundles. The page lists every part the server can offer,
// lets the player pick items, packs one ZIP, and reads another back with a conflict preview.
// P0 covers text-like data (cards, world books, presets, prompts, profiles, regex, settings);
// parts the server marks unsupported are listed but disabled.
function createTransferFeatureModule() {
	const h = React.createElement

	function fmtBytes(value) {
		const bytes = Math.max(0, Number(value) || 0)
		if (bytes < 1024) return bytes + " B"
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + " KB"
		if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + " MB"
		return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB"
	}

	function fmtTime(value) {
		const time = Number(value) || 0
		if (!time) return ""
		const date = new Date(time)
		const pad = number => String(number).padStart(2, "0")
		return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
	}

	// The fork's self-drawn tick (.ap-check-mark, ui-design §三.15): role=checkbox, "mixed" for a partly picked part.
	function checkBox(props) {
		const mark = props.checked === "mixed" ? h("i", { className: "ap-check-dash" })
			: props.checked ? h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, h("path", { d: "M3.5 8.5l3 3 6-7", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" })) : null
		return h("button", { type: "button", role: "checkbox", className: "ap-pack-check dsh-tavern-transfer-check", "aria-checked": props.checked, "aria-label": props.label, disabled: props.disabled,
			onClick: props.onToggle }, h("span", { className: "ap-check-mark", "aria-hidden": "true" }, mark))
	}

	function defaultPolicies(bundle) {
		const policies = {}
		// 对话默认只带最新进度：一局存档点动辄七八份，导一份就等于整局写七八遍。
		;(bundle && bundle.parts || []).forEach(function (part) { policies[part.kind] = part.kind === "chats" ? "latest" : "new" })
		return policies
	}

	function defaultSelection(bundle) {
		const selection = {}
		;(bundle && bundle.parts || []).forEach(function (part) {
			if (!part.importable) return
			const keys = (part.items || []).filter(function (item) { return item.usable !== false && !item.duplicate }).map(function (item) { return item.key })
			if (keys.length) selection[part.kind] = Object.fromEntries(keys.map(function (key) { return [key, true] }))
		})
		return selection
	}

	function planTotals(bundle, policies, selection) {
		const totals = { added: 0, skipped: 0, conflicts: 0 }
		;(bundle && bundle.parts || []).forEach(function (part) {
			const items = part.items || []
			const chosen = part.importable ? items.filter(function (item) { return selection && selection[part.kind] && selection[part.kind][item.key] }) : []
			totals.skipped += items.length - chosen.length
			if (!part.importable) return
			if ((policies && policies[part.kind]) === "skip") { totals.skipped += chosen.length; return }
			const usable = chosen.filter(function (item) { return item.usable !== false })
			totals.added += usable.length
			totals.conflicts += usable.filter(function (item) { return item.conflict }).length
			totals.skipped += chosen.length - usable.length
		})
		return totals
	}

	function selectionPayload(selection) {
		const payload = {}
		Object.entries(selection || {}).forEach(function (entry) {
			const keys = Object.keys(entry[1] || {})
			if (keys.length) payload[entry[0]] = keys
		})
		return payload
	}

	function TavernTransferPanel(props) {
		const sessionId = props.scope && props.scope.sessionId
		const [mode, setMode] = React.useState("export")
		const [catalog, setCatalog] = React.useState(null)
		const [selected, setSelected] = React.useState({})
		const [openParts, setOpenParts] = React.useState({})
		const [busy, setBusy] = React.useState(false)
		const [exported, setExported] = React.useState(null)
		const [includeImages, setIncludeImages] = React.useState(false)
		const [importing, setImporting] = React.useState(null)
		const [openImport, setOpenImport] = React.useState({})
		const [error, setError] = usePersistentError("导出与导入")
		const [applyProgress, setApplyProgress] = React.useState(null)
		const fileInput = React.useRef(null)
		const bodyRef = React.useRef(null)
		// 服务端一次导入要写几万个文件，手机端等不到回包就再点一次是常态：这里同步挡住第二次提交，
		// 不至于按下两次就导入两遍（服务端也认同一个 token 只跑一次）。
		const applyingRef = React.useRef(false)
		// 最后生成的包，供「重新下载」复用。服务端在 token 有效期内允许多次下载，所以
		// 第一次没弹出保存界面（内嵌 WebView 常见）时，用户可以直接再点一次。
		const exportRef = React.useRef(null)

		const refresh = React.useCallback(function () {
			return rpc("getTransferCatalog", {}, sessionId).then(function (value) {
				setCatalog(value && value.parts ? value : { parts: [], groups: [] })
				return value
			}, function (err) {
				setError(String(err && err.message || err))
				return null
			})
		}, [sessionId, setError])

		useVisibleDataRefresh(props.visible, function (event) { return tavernDataChangeAffects(event, ["cards", "worldbooks", "presets", "sessions"], "transfer") }, refresh, sessionId)
		React.useEffect(function () { void refresh() }, [refresh])

		const parts = catalog ? catalog.parts || [] : []
		const groups = catalog && Array.isArray(catalog.groups) && catalog.groups.length ? catalog.groups : [
			{ id: "lore", title: "角色与设定" }, { id: "style", title: "写法与偏好" }
		]

		function partSelected(part) { return selected[part.kind] || {} }
		function isSelected(part, item) { return partSelected(part)[item.key] === true }
		function chosenItems(part) { return (part.items || []).filter(function (item) { return isSelected(part, item) }) }
		function partBytes(part) { return chosenItems(part).reduce(function (sum, item) { return sum + (Number(item.bytes) || 0) }, 0) }
		function totalBytes(part) { return (part.items || []).reduce(function (sum, item) { return sum + (Number(item.bytes) || 0) }, 0) }

		function toggleItem(part, item, next) {
			setSelected(function (current) {
				const group = Object.assign({}, current[part.kind] || {})
				if (next) group[item.key] = true
				else delete group[item.key]
				const all = Object.assign({}, current)
				if (Object.keys(group).length) all[part.kind] = group
				else delete all[part.kind]
				return all
			})
			setExported(null)
		}

		function togglePart(part) {
			const all = part.items.length > 0 && chosenItems(part).length === part.items.length
			setSelected(function (current) {
				const copy = Object.assign({}, current)
				if (all) delete copy[part.kind]
				else copy[part.kind] = Object.fromEntries(part.items.map(function (item) { return [item.key, true] }))
				return copy
			})
			setExported(null)
		}

		function quickSelect(scope) {
			const kinds = scope === "all" ? parts.filter(function (part) { return part.supported && part.items.length }).map(function (part) { return part.kind })
				: ["cards", "worldbooks", "presets", "prompts", "profile", "regex"]
			const next = {}
			parts.forEach(function (part) {
				if (!part.supported || !part.items.length) return
				if (kinds.indexOf(part.kind) === -1) return
				next[part.kind] = Object.fromEntries(part.items.map(function (item) { return [item.key, true] }))
			})
			setSelected(next)
			setExported(null)
		}

		const selection = React.useMemo(function () {
			const payload = {}
			parts.forEach(function (part) {
				const keys = Object.keys(partSelected(part))
				if (keys.length) payload[part.kind] = keys
			})
			return payload
		}, [selected, parts])

		const chatsSelected = React.useMemo(function () {
			const part = parts.find(function (row) { return row.kind === "chats" })
			return Boolean(part && chosenItems(part).length)
		}, [selected, parts])

		const stats = React.useMemo(function () {
			let count = 0, bytes = 0, kinds = 0
			parts.forEach(function (part) {
				const chosen = chosenItems(part)
				if (!chosen.length) return
				kinds += 1
				count += chosen.length
				bytes += chosen.reduce(function (sum, item) { return sum + (Number(item.bytes) || 0) }, 0)
			})
			return { count, bytes, kinds }
		}, [selected, parts])

		// 触发一次保存。手机上的内嵌 WebView 往往没有下载器，点了会静默失败，
		// 所以这里不把「保存成功」当既成事实：调用方仍然展示文件卡片和重试入口。
		function saveExport(payload) {
			if (!payload) { setError("这个包已经失效，请重新导出"); return }
			if (payload.url) {
				const link = document.createElement("a")
				link.href = payload.url
				link.download = payload.filename || "DSH酒馆备份.dshtransfer"
				link.rel = "noopener"
				document.body.appendChild(link)
				link.click()
				link.remove()
				return
			}
			if (payload.base64) {
				const bytes = Uint8Array.from(atob(payload.base64), function (value) { return value.charCodeAt(0) })
				downloadTavernBlob(new Blob([bytes], { type: "application/zip" }), payload.filename)
			}
		}

		function submitExport() {
			if (!stats.count) { setError("先选至少一个板块"); return }
			setError("")
			setBusy(true)
			rpc("createTransferExport", { selection, includeImages }, sessionId).then(function (result) {
				const payload = result.downloadUrl
					? { url: result.downloadUrl, filename: result.filename }
					: { base64: result.base64, filename: result.filename }
				exportRef.current = payload
				saveExport(payload)
				setExported({ name: result.filename, bytes: result.bytes, totals: result.totals, parts: result.parts })
				window.setTimeout(function () { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, 30)
			}, function (err) { setError(String(err && err.message || err)) }).finally(function () { setBusy(false) })
		}

		function pickImportFile(event) {
			const file = event.target.files && event.target.files[0]
			event.target.value = ""
			if (file) void readImportFile(file)
		}

		async function readImportFile(file) {
			setError("")
			setExported(null)
			setImporting({ stage: "reading", fileName: file.name })
			setBusy(true)
			try {
				const response = await fetch("/api/dsh-tavern/card-upload", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file })
				let reply = null
				try { reply = await response.json() } catch (_error) { /* the route answers JSON */ }
				if (!reply || !reply.ok) throw new Error(reply && reply.error || "上传失败（HTTP " + response.status + "）")
				const result = await rpc("previewTransferBundle", { uploadId: reply.uploadId }, sessionId)
				setImporting({ stage: "preview", fileName: file.name, token: result.token, bundle: result.bundle, policies: defaultPolicies(result.bundle), selection: defaultSelection(result.bundle) })
				setOpenImport({})
				window.setTimeout(function () { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, 30)
			} catch (err) {
				setImporting(null)
				setError(String(err && err.message || err))
			} finally {
				setBusy(false)
			}
		}

		function setPolicy(kind, value) {
			setImporting(function (current) {
				if (!current || !current.bundle) return current
				return Object.assign({}, current, { policies: Object.assign({}, current.policies, { [kind]: value }) })
			})
		}

		function applyImport() {
			if (!importing || !importing.token || applyingRef.current) return
			applyingRef.current = true
			setError("")
			setBusy(true)
			setApplyProgress(null)
			setImporting(function (current) { return Object.assign({}, current, { stage: "applying" }) })
			const payload = { token: importing.token, policies: importing.policies, selection: selectionPayload(importing.selection) }
			// 手机端断网、网关超时都会让这一次 POST 白跑；服务端同一个 token 只跑一趟，重发是安全的，
			// 所以这里自己补一次，不必等用户手再点一遍。
			const attempt = function (left) {
				return rpc("applyTransferBundle", payload, sessionId).catch(function (err) {
					const transient = !err || !err.status || err.retryable === true
					if (left <= 0 || !transient) throw err
					return new Promise(function (resolve) { window.setTimeout(resolve, 1500) }).then(function () { return attempt(left - 1) })
				})
			}
			attempt(1).then(function (result) {
				setImporting(function (current) { return Object.assign({}, current, { stage: "done", result }) })
				notifyTavernDataChanged(["cards", "worldbooks", "presets", "sessions", "plugins"], "transfer")
				void refresh()
			}, function (err) {
				setImporting(function (current) { return Object.assign({}, current, { stage: "preview" }) })
				setError(String(err && err.message || err))
			}).finally(function () { applyingRef.current = false; setBusy(false) })
		}

		// 导入过程中每秒取一次进度：慢在哪个板块、走到第几项，看得见就不会被当成卡死。
		const applyToken = importing && importing.stage === "applying" ? importing.token : ""
		React.useEffect(function () {
			if (!applyToken) return undefined
			let stopped = false
			function tick() {
				rpc("getTransferImportProgress", { token: applyToken }, sessionId).then(function (value) {
					if (!stopped && value) setApplyProgress(value)
				}, function () { /* 取不到进度不影响导入本身 */ })
			}
			tick()
			const timer = window.setInterval(tick, 1000)
			return function () { stopped = true; window.clearInterval(timer) }
		}, [applyToken, sessionId])

		function applyProgressText() {
			const row = applyProgress
			const seconds = Math.max(1, Math.round(((row && row.elapsedMs) || 0) / 1000))
			const part = row && row.label ? " · " + row.label : ""
			const count = row && row.total ? " " + Math.min(row.items || 0, row.total) + "/" + row.total : ""
			return "正在导入" + part + count + "，已 " + seconds + " 秒"
		}

		function renderItem(part, item) {
			return h("label", { className: "dsh-tavern-transfer-item", key: part.kind + ":" + item.key },
				checkBox({ checked: isSelected(part, item), label: item.title, onToggle: function () { toggleItem(part, item, !isSelected(part, item)) } }),
				h("span", { className: "dsh-tavern-transfer-item-name" }, item.title),
				item.meta ? h("span", { className: "dsh-tavern-transfer-item-note" }, item.meta) : null,
				h("span", { className: "dsh-tavern-transfer-item-size" }, Number(item.bytes) > 0 ? fmtBytes(item.bytes) : "导出时生成")
			)
		}

		function renderPart(part) {
			const chosen = chosenItems(part)
			const all = part.items.length > 0 && chosen.length === part.items.length
			const partial = chosen.length > 0 && !all
			const open = openParts[part.kind] === true
			const disabled = !part.supported || part.items.length === 0
			const total = totalBytes(part)
			const sizeText = total > 0 ? fmtBytes(total) : "按需生成"
			const size = chosen.length ? (partBytes(part) > 0 ? fmtBytes(partBytes(part)) + (all ? "" : " / " + sizeText) : sizeText) : (part.items.length ? "共 " + sizeText : "—")
			return h("article", { className: "dsh-tavern-transfer-part" + (disabled ? " is-empty" : ""), key: part.kind },
				h("div", { className: "dsh-tavern-transfer-part-head" },
					checkBox({ checked: partial ? "mixed" : all, disabled, label: "选择" + part.label, onToggle: function () { togglePart(part) } }),
					h("div", { className: "dsh-tavern-transfer-part-main" },
						h("div", { className: "dsh-tavern-transfer-part-name" },
							h("strong", null, part.label),
							part.privacy ? h("span", { className: "dsh-tavern-transfer-tag" }, part.privacy) : null,
							part.supported ? null : h("span", { className: "dsh-tavern-transfer-tag is-muted" }, "下一版")
						),
						h("p", { className: "dsh-tavern-transfer-note" }, part.note || "")
					),
					h("div", { className: "dsh-tavern-transfer-part-side" },
						h("span", { className: "dsh-tavern-transfer-count" }, part.items.length ? part.items.length + " " + (part.unit || "项") : "本机没有"),
						h("span", { className: "dsh-tavern-transfer-size" }, size),
						part.items.length ? h("button", {
							type: "button", className: "dsh-tavern-transfer-expand",
							"aria-label": (open ? "收起" : "展开") + part.label,
							onClick: function () { setOpenParts(function (current) { const next = Object.assign({}, current); if (next[part.kind]) delete next[part.kind]; else next[part.kind] = true; return next }) }
						}, h("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: "M4 6l4 4 4-4" }))) : null
					)
				),
				part.items.length && open ? h("div", { className: "dsh-tavern-transfer-items" }, part.items.map(function (item) { return renderItem(part, item) })) : null
			)
		}

		function renderExport() {
			const byGroup = {}
			parts.forEach(function (part) { (byGroup[part.group] = byGroup[part.group] || []).push(part) })
			return h("div", { className: "dsh-tavern-transfer-body", ref: bodyRef },
				h("div", { className: "dsh-tavern-transfer-quick" },
					h("span", { className: "dsh-tavern-transfer-quick-label" }, "快速选择"),
					h("button", { type: "button", className: "dsh-tavern-transfer-chip", onClick: function () { quickSelect("all") } }, "全部"),
					h("button", { type: "button", className: "dsh-tavern-transfer-chip", onClick: function () { quickSelect("domains") } }, "设定与写法"),
					h("button", { type: "button", className: "dsh-tavern-transfer-chip", onClick: function () { setSelected({}); setExported(null) } }, "清空")
				),
				groups.map(function (group) {
					const list = byGroup[group.id] || []
					if (!list.length) return null
					return h("section", { className: "dsh-tavern-transfer-group", key: group.id },
						h("div", { className: "dsh-tavern-transfer-group-title" }, group.title),
						list.map(renderPart)
					)
				}),
				exported ? h("div", { className: "dsh-tavern-transfer-exported" },
					h("div", { className: "dsh-tavern-transfer-file" },
						h("span", { className: "dsh-tavern-transfer-file-icon" }, "DSHT"),
						h("div", null,
							h("div", { className: "dsh-tavern-transfer-file-name" }, exported.name),
							h("div", { className: "dsh-tavern-transfer-file-sub" }, fmtBytes(exported.bytes) + " · " + (exported.totals ? exported.totals.items + " 项" : ""))
						)
					),
					// 大包用真链接：内嵌窗口不支持下载时，长按还能「复制链接地址」丢给系统浏览器。
					exportRef.current && exportRef.current.url
						? h("a", {
							className: "dsh-tavern-btn primary dsh-tavern-transfer-save",
							href: exportRef.current.url,
							download: exportRef.current.filename,
							role: "button"
						}, "保存到手机")
						: h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: busy, onClick: function () { saveExport(exportRef.current) } }, "保存到手机"),
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: submitExport }, "再导出")
				) : null,
				exported ? h("p", { className: "dsh-tavern-transfer-hint" },
					"点「保存到手机」后没有弹出保存位置，是当前窗口不支持下载：把酒馆地址复制到系统浏览器（Chrome 等）打开，在那里再导出一次，文件会进手机的「下载」。"
					+ "包在服务端保留一小时，期间同一个「保存到手机」可以反复点。"
					+ "保存到手机「下载」时后缀可能被系统改成 .bin（系统按下载类型改名，内容仍是完整包），导入时直接选这个文件即可。")
					: null
			)
		}

		function undoImport() {
			if (!importing || !importing.undoToken) return
			setBusy(true)
			setError("")
			rpc("undoTransferImport", { token: importing.undoToken }, sessionId).then(function (result) {
				setImporting(function (current) { return Object.assign({}, current, { undo: result }) })
				notifyTavernDataChanged(["cards", "worldbooks", "presets", "sessions"], "transfer")
				void refresh()
			}, function (err) { setError(String(err && err.message || err)) }).finally(function () { setBusy(false) })
		}

		function toggleImportPart(part) {
			setImporting(function (current) {
				if (!current) return current
				const items = (part.items || []).filter(function (item) { return item.usable !== false })
				const selected = Object.assign({}, current.selection && current.selection[part.kind] || {})
				const all = items.length > 0 && items.every(function (item) { return selected[item.key] })
				const next = Object.assign({}, current.selection)
				if (all) delete next[part.kind]
				else next[part.kind] = Object.fromEntries(items.map(function (item) { return [item.key, true] }))
				return Object.assign({}, current, { selection: next })
			})
		}

		function toggleImportItem(part, item, checked) {
			setImporting(function (current) {
				if (!current) return current
				const next = Object.assign({}, current.selection)
				const selected = Object.assign({}, next[part.kind] || {})
				if (checked) selected[item.key] = true
				else delete selected[item.key]
				if (Object.keys(selected).length) next[part.kind] = selected
				else delete next[part.kind]
				return Object.assign({}, current, { selection: next })
			})
		}

		function renderImport() {
			const state = importing
			if (!state) {
				return h("div", { className: "dsh-tavern-transfer-body", ref: bodyRef },
					h("button", {
						type: "button", className: "dsh-tavern-transfer-drop", disabled: busy,
						onClick: function () { if (fileInput.current) fileInput.current.click() },
						onDragOver: function (event) { event.preventDefault() },
						onDrop: function (event) {
							event.preventDefault()
							const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
							if (file) void readImportFile(file)
						}
					},
						h("svg", { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
							h("path", { d: "M12 16V4m0 0L7 9m5-5 5 5" }), h("path", { d: "M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" })),
						h("strong", null, "选择 .dshtransfer 文件"),
						h("span", null, "或把导出包拖到这里；导入只新增，不会覆盖现有内容")
					),
					h("p", { className: "dsh-tavern-transfer-hint" }, "包里只有数据：人物卡、世界书、预设、提示词、长期偏好、正则与设置。插件和对话记录在下一版加入。")
				)
			}
			if (state.stage === "reading") {
				return h("div", { className: "dsh-tavern-transfer-body", ref: bodyRef },
					h("div", { className: "dsh-tavern-transfer-progress" }, h("strong", null, "正在读取 " + state.fileName + "…"), h("span", null, "上传并校验包内文件"))
				)
			}
			const bundle = state.bundle || { parts: [] }
			const totals = planTotals(bundle, state.policies, state.selection)
			return h("div", { className: "dsh-tavern-transfer-body", ref: bodyRef },
				h("div", { className: "dsh-tavern-transfer-bundle" },
					h("div", { className: "dsh-tavern-transfer-bundle-name" }, bundle.name || state.fileName),
					h("div", { className: "dsh-tavern-transfer-bundle-meta" },
						h("span", null, (bundle.source && bundle.source.tavern ? "来自 " + bundle.source.tavern + " · " : "") + fmtBytes(bundle.bytes)),
						bundle.createdAt ? h("span", null, "导出于 " + fmtTime(bundle.createdAt)) : null
					),
					bundle.issues && bundle.issues.length ? h("p", { className: "dsh-tavern-transfer-warn" }, "有 " + bundle.issues.length + " 项损坏，已跳过：" + bundle.issues[0]) : null
				),
				(bundle.parts || []).map(function (part) {
					const items = part.items || []
					const selected = (state.selection && state.selection[part.kind]) || {}
					const chosen = items.filter(function (item) { return selected[item.key] })
					const allChecked = items.length > 0 && items.every(function (item) { return selected[item.key] })
					const someChecked = chosen.length > 0 && !allChecked
					const open = openImport[part.kind] === true
					const disabled = !part.importable || items.length === 0
					return h("article", { className: "dsh-tavern-transfer-part is-import", key: part.kind },
						h("div", { className: "dsh-tavern-transfer-part-head" },
							checkBox({ checked: someChecked ? "mixed" : allChecked, disabled: busy || disabled, label: "选择" + part.label, onToggle: function () { toggleImportPart(part) } }),
							h("div", { className: "dsh-tavern-transfer-part-main" },
								h("div", { className: "dsh-tavern-transfer-part-name" },
									h("strong", null, part.label),
									part.importable ? null : h("span", { className: "dsh-tavern-transfer-tag is-muted" }, "不导入"),
									part.conflicts ? h("span", { className: "dsh-tavern-transfer-tag is-warn" }, "同名 " + part.conflicts) : null
								),
								h("p", { className: "dsh-tavern-transfer-note" }, chosen.length + "/" + items.length + " 项已选" + (part.note ? " · " + part.note : ""))
							),
							h("div", { className: "dsh-tavern-transfer-part-side" },
								h(InlineField, {
									kind: "menu", hideLabel: true, label: part.label + " 的导入方式",
									value: (state.policies && state.policies[part.kind]) || "new", disabled: busy || !part.importable,
									onCommit: function (value) { setPolicy(part.kind, value) },
									options: [{ value: "new", label: part.kind === "settings" ? "合并设置" : part.kind === "plugin-data" ? "覆盖数据" : "新建副本" }]
										.concat(part.kind === "chats" ? [{ value: "latest", label: "只导最新进度（快）" }] : [], [{ value: "skip", label: "跳过" }])
								}),
								items.length ? h("button", {
									type: "button", className: "dsh-tavern-transfer-expand",
									"aria-label": (open ? "收起" : "展开") + part.label,
									onClick: function () { setOpenImport(function (current) { const next = Object.assign({}, current); if (next[part.kind]) delete next[part.kind]; else next[part.kind] = true; return next }) }
								}, h("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: "M4 6l4 4 4-4" }))) : null
							)
						),
						open && items.length ? h("div", { className: "dsh-tavern-transfer-items is-pick" },
							items.map(function (item) {
								const bad = item.usable === false
								return h("label", { className: "dsh-tavern-transfer-item" + (bad ? " is-bad" : ""), key: part.kind + ":" + item.key },
									checkBox({ checked: selected[item.key] === true, disabled: busy || disabled || bad, label: item.title,
										onToggle: function () { toggleImportItem(part, item, selected[item.key] !== true) } }),
									h("span", { className: "dsh-tavern-transfer-item-name" }, item.title),
									item.reason ? h("span", { className: "dsh-tavern-transfer-item-note" }, item.reason) : null,
									h("span", { className: "dsh-tavern-transfer-item-size" }, fmtBytes(item.bytes))
								)
							})
						) : null
					)
				}),
				state.stage === "done" && state.result ? h("div", { className: "dsh-tavern-transfer-result" },
					h("strong", null, "导入完成"),
					(state.result.results || []).map(function (row) {
						const failed = (row.failed || []).length
						return h("div", { className: "dsh-tavern-transfer-result-row", key: row.kind },
							h("span", { className: "dsh-tavern-transfer-result-name" }, row.label),
							h("span", { className: "dsh-tavern-transfer-result-detail" },
								(row.added ? "新增 " + row.added + " 项" : "") +
								(row.overwritten ? (row.added ? " · " : "") + (row.kind === "plugin-data" ? "覆盖 " : "合并 ") + row.overwritten + " 项" : "") +
								(row.skipped ? (row.added || row.overwritten ? " · " : "") + "跳过 " + row.skipped + " 项" + ((row.duplicates || []).length ? "（内容相同 " + row.duplicates.length + " 项）" : "") : "") +
								(failed ? (row.added || row.overwritten || row.skipped ? " · " : "") + failed + " 项失败" : "") +
								(!row.added && !row.overwritten && !row.skipped && !failed ? "未处理" : "")
							)
						)
					}),
					state.result.backupPath ? h("p", { className: "dsh-tavern-transfer-hint" }, "覆盖前的设置备份在 " + state.result.backupPath) : null,
					(state.result.results || []).some(function (row) { return (row.failed || []).length }) ? h("p", { className: "dsh-tavern-transfer-warn" },
						(state.result.results.find(function (row) { return (row.failed || []).length }).failed || []).map(function (item) { return item.title + "：" + item.error }).join("；")) : null,
					state.undoToken && !state.undo ? h("button", { type: "button", className: "dsh-tavern-btn danger", disabled: busy, onClick: undoImport }, "撤销本次导入") : null,
					state.undo ? h("p", { className: "dsh-tavern-transfer-hint" }, "已撤销 " + (state.undo.removed || []).length + " 项" +
						((state.undo.skipped || []).length ? "；跳过 " + state.undo.skipped.length + " 项（" + state.undo.skipped.map(function (row) { return (row.path || row.title) + "：" + row.reason }).slice(0, 3).join("；") + "）" : "")) : null,
					h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { setImporting(null) } }, "再导入一个包")
				) : null,
				state.stage !== "done" ? h("div", { className: "dsh-tavern-transfer-bar is-inline" },
					h("div", { className: "dsh-tavern-transfer-summary" },
						h("strong", null, "新增 " + totals.added + " 项"),
						h("span", null, "跳过 " + totals.skipped + " 项"),
						totals.conflicts ? h("span", { className: "is-warn" }, "其中 " + totals.conflicts + " 项同名会加副本") : null,
						(state.policies && state.policies.chats === "latest") ? h("span", { className: "is-warn" }, "对话只带最新进度，可回退的存档点不导") : null,
						state.stage === "applying" ? h("span", { className: "is-warn" }, applyProgressText()) : null
					),
					h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: busy || totals.added === 0, onClick: applyImport, title: state.stage === "applying" ? "导入还在进行，大包可能要几分钟" : "" }, busy ? "导入中…" : "确认导入")
				) : null
			)
		}

		const modeButton = function (id, label) {
			return h("button", {
				type: "button", className: "dsh-tavern-transfer-mode" + (mode === id ? " is-on" : ""),
				"aria-pressed": mode === id,
				onClick: function () { setMode(id) }
			}, label)
		}

		return h("div", { className: "dsh-tavern-transfer" },
			h("div", { className: "dsh-tavern-status-head dsh-tavern-transfer-head" },
				h("div", null,
					h("div", { className: "dsh-tavern-status-title" }, "导出与导入"),
					h("div", { className: "dsh-tavern-question-sub" }, "把选中的板块打成一个 .dshtransfer，换台机器再整包读回来")
				),
				h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void refresh() } }, "刷新")
			),
			h("div", { className: "dsh-tavern-transfer-modes" }, modeButton("export", "导出"), modeButton("import", "导入")),
			error ? h("div", { className: "dsh-tavern-transfer-error" }, error) : null,
			h("input", { ref: fileInput, type: "file", accept: ".dshtransfer,.zip,.bin,application/octet-stream", style: { display: "none" }, onChange: pickImportFile }),
			mode === "export" ? renderExport() : renderImport(),
			mode === "export" ? h("div", { className: "dsh-tavern-transfer-bar" },
				h("div", { className: "dsh-tavern-transfer-summary" },
					h("strong", null, stats.kinds + " 个板块"),
					h("span", null, stats.count + " 项"),
					h("span", null, "约 " + fmtBytes(stats.bytes)),
					chatsSelected ? h("span", { className: "is-warn" }, "对话按实际大小打包") : null,
					stats.bytes > 45 * 1024 * 1024 ? h("span", { className: "is-warn" }, "超过 45 MB，可能打包失败") : null
				),
				h("span", { className: "dsh-tavern-transfer-switch" + (chatsSelected ? "" : " is-off") },
					h(Switch, { label: "含对话配图", checked: includeImages, disabled: !chatsSelected, onChange: setIncludeImages }),
					h("span", { "aria-hidden": "true" }, "含对话配图")
				),
				h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: busy || !stats.count, onClick: submitExport }, busy ? "打包中…" : "生成导出包")
			) : null
		)
	}

	function register(input) {
		const ctx = input.ctx
		return ctx.effect(() => ctx.betterSidebar.registerTab({
			id: "dsh-tavern:transfer",
			title: "导出与导入",
			order: 7,
			single: true,
			component: function (props) {
				return React.createElement(TavernTransferPanel, props)
			}
		}), "dsh-tavern: transfer tab")
	}

	return Object.freeze({ register })
}

const transferFeature = createTransferFeatureModule()
