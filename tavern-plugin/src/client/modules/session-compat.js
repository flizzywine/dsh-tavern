// 兼容垫层：为 tavern 客户端提供 0.2.0 已删除的会话 API 等价物。
//
// 0.1.5 的 ctx.sessions 提供 { list, current, open(), clear(), binding(id), scope(id) }；
// 0.2.0 只保留 { list, binding(id), scope(id), create(), fork() }，「当前会话」改为
// 主视图 retain（retainedBy.mainView）的推导属性，打开/关闭会话由 uiWorkspace 服务负责。
// tavern 侧栏、会话选择器、恢复模块都还在用旧形状，这里一次性补齐，避免散落的 typeof 兜底。

function mainSessionId(snapshot) {
	const items = Object.values((snapshot && snapshot.byId) || {});
	// 0.2.0：主视图 retain 的会话即「当前会话」（dsh-client-ui-workspace 的同一判据）。
	for (const row of items) {
		if (row && row.retainedBy && (row.retainedBy.mainView ?? 0) > 0) return row.id;
	}
	// 回退：0.1.5 的快照带 current / selected 语义，老宿主直接沿用。
	if (snapshot && typeof snapshot.current === "string" && snapshot.current) return snapshot.current;
	return "";
}

// 统一取「当前主会话」：compat 视图（createSessionCompat）的 current 已经是主视图
// 推导值；宿主基线对象（0.1.5 的 ctx.sessions、测试替身、服务端 headless 执行器）
// 只有裸 list 时回退到快照判定。0.2.0 删掉了顶层 current，散落的直接读取会永远得到
// 空串，卡片脚本运行时就选不中会话。
function tavernMainSessionId(sessions) {
	if (!sessions) return "";
	if (typeof sessions.current === "string" && sessions.current) return sessions.current;
	const snapshot = sessions.list && typeof sessions.list.getSnapshot === "function" ? sessions.list.getSnapshot() : null;
	return mainSessionId(snapshot);
}

// createSessionCompat(sessions) -> 兼容后的 sessions 视图
// 返回的新对象保留 list/binding/scope/create/fork/refresh 原样，并补回：
//   current    —— 主会话 id（0.1.5 语义，随列表快照推导）
//   open(id)   —— 切到某会话（0.2.0 用 uiWorkspace.openSession，缺失时退化为 retain）
//   clear()    —— 取消当前选择（0.2.0 用 uiWorkspace.clearMain）
function createSessionCompat(sessions, uiWorkspace) {
	if (!sessions || typeof sessions.list !== "object" || sessions.list === null) return sessions;
	const compat = {
		list: sessions.list,
		binding: sessions.binding ? sessions.binding.bind(sessions) : undefined,
		scope: sessions.scope ? sessions.scope.bind(sessions) : undefined,
		create: sessions.create ? sessions.create.bind(sessions) : undefined,
		fork: typeof sessions.fork === "function" ? sessions.fork.bind(sessions) : undefined,
		refresh: typeof sessions.refresh === "function" ? sessions.refresh.bind(sessions) : undefined,
		refreshSubagents: typeof sessions.refreshSubagents === "function" ? sessions.refreshSubagents.bind(sessions) : undefined,
		retain: typeof sessions.retain === "function" ? sessions.retain.bind(sessions) : undefined,
		subagentAddress: typeof sessions.subagentAddress === "function" ? sessions.subagentAddress.bind(sessions) : undefined,
	};

	Object.defineProperty(compat, "current", {
		enumerable: true,
		get: function () {
			const snapshot = sessions.list.getSnapshot ? sessions.list.getSnapshot() : null;
			return mainSessionId(snapshot);
		},
	});

	// 0.1.5 的 open() 同步返回；这里统一返回 Promise，调用点已 await。
	//
	// 0.2.0 的 uiWorkspace.openSession → replaceMain 会立即 sessions.retain(target)，
	// 而 retain 在宿主基线快照里没有这一行时同步抛「unknown session」。宿主基线只在
	// session.list 响应落地后才增长；点击旧存档时若首屏拉取尚未返回（或曾被排入同一次
	// in-flight 拉取），retain 就会先行失败。因此在真正打开前先确认列表里已有这一行：
	// 没有就强制刷新基线（refreshList 的 single-flight 会把并发刷新合并成同一次拉取，
	// 所以要重读到行出现为止，或到确认它真的不在为止），让 retain 找得到目标。
	function knownSession(sessionId) {
		const snapshot = sessions.list && typeof sessions.list.getSnapshot === "function" ? sessions.list.getSnapshot() : null;
		return Boolean(snapshot && snapshot.byId && snapshot.byId[sessionId]);
	}
	// 宿主的 refresh 是 single-flight：紧接着再 await 一次只会拿到同一次拉取的结果，
	// 连拉三次等于白等。让出一拍再重试，才可能读到新出现的那一行。
	function retireTick() {
		return new Promise(function (resolve) {
			if (typeof window !== "undefined" && typeof window.setTimeout === "function") window.setTimeout(resolve, 80);
			else setTimeout(resolve, 80);
		});
	}
	async function ensureKnownSession(target, attempts) {
		for (let index = 0; index < attempts; index += 1) {
			if (knownSession(target)) return true;
			try { await compat.refresh(); } catch (_) { /* 单次拉取失败由下一次重试兜底 */ }
			if (knownSession(target)) return true;
			if (index + 1 < attempts) await retireTick();
		}
		return knownSession(target);
	}
	compat.open = function (sessionId) {
		const target = String(sessionId || "");
		if (!target) return compat.clear();
		if (knownSession(target)) return openTarget(target);
		return ensureKnownSession(target, 3).then(function (known) {
			// 基线里始终没有这一行：交给调用方处理（recovery 判定 unknown session 后
			// 继续等待，或直接把「会话不存在」暴露给用户）。
			if (!known && typeof compat.onMissingSession === "function") compat.onMissingSession(target);
			return openTarget(target);
		});
	};
	function openTarget(target) {
		if (uiWorkspace && typeof uiWorkspace.openSession === "function") {
			return Promise.resolve(uiWorkspace.openSession(target));
		}
		// 兜底：至少 retain 一次，让 summary+binding 两个就绪条件成立。
		// 未知会话的 sessions.retain 错误冒泡给 recovery 的 isUnknownSession 判定。
		if (typeof compat.retain === "function") {
			compat.retain(target, { source: "tavern" });
		}
		return Promise.resolve();
	}

	compat.clear = function () {
		if (uiWorkspace && typeof uiWorkspace.clearMain === "function") {
			return Promise.resolve(uiWorkspace.clearMain());
		}
		return Promise.resolve();
	};

	return compat;
}

// sessionListAdapters(sessions) -> createSessionListRecoveryModule 的适配器集合。
//
// 0.2.0 的会话 scope 只在被 retain 之后才存在，create() 出来的会话先只有列表
// placeholder 行。若 binding 只读 scope，新建会话在 wait() 里永远不就绪，
// 8 秒后必然抛「DSH Session 列表同步超时」。这里以列表行兜底：就绪 = 会话已进列表，
// scope 由 open() 走 uiWorkspace 时再 materialize。
function sessionListAdapters(sessions) {
	const readRow = function (sessionId) {
		const snapshot = sessions.list && typeof sessions.list.getSnapshot === "function" ? sessions.list.getSnapshot() : null;
		return (snapshot && snapshot.byId && snapshot.byId[sessionId]) || undefined;
	};
	return {
		summary: readRow,
		binding: function (sessionId) {
			return (typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined) || readRow(sessionId);
		},
		refresh: function () { return typeof sessions.refresh === "function" ? sessions.refresh() : Promise.resolve(); },
		open: function (sessionId) { return sessions.open(sessionId); },
		isUnknownSession: function (error) {
			// 0.1.5 选中未知会话报 sessions.select；0.2.0 的 retain 报 sessions.retain。
			return /sessions\.(select|retain): unknown session/i.test(String(error && error.message || error || ""));
		},
	};
}
