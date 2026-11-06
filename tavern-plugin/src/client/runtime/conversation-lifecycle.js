		function createPlayWorkspaceResolver(options) {
			for (const method of ["currentWorkspaceId", "resourceRoot", "createWorkspace"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Play Workspace Resolver 缺少 " + method + " adapter");
			}
			let fallbackPromise = null;
			return async function () {
				const currentWorkspaceId = String(options.currentWorkspaceId() || "");
				if (currentWorkspaceId) return currentWorkspaceId;
				if (!fallbackPromise) {
					fallbackPromise = (async function () {
						const root = await options.resourceRoot();
						const created = await options.createWorkspace({ path: root.path });
						if (!created || !created.workspaceId) throw new Error("无法创建 DSH Tavern Workspace");
						return created.workspaceId;
					})();
					fallbackPromise.catch(function () { fallbackPromise = null; });
				}
				return fallbackPromise;
			};
		}

		function createSessionListRecoveryModule(options) {
			for (const method of ["summary", "binding", "refresh", "open"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Session List Recovery 缺少 " + method + " adapter");
			}
			const now = typeof options.now === "function" ? options.now : Date.now;
			const sleep = typeof options.sleep === "function" ? options.sleep : function (ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); };
			// 宿主的 session.list 是本地调用，正常几毫秒就回；8 秒上限意味着任一环卡住时
			// 用户要实打实等满 8 秒才看到报错。压到 4 秒、阶梯收紧密，卡死时更快暴露，
			// 正常路径也不会被拉长。
			const timeoutMs = Math.max(100, Number(options.timeoutMs || 4000));
			const retryDelays = Array.isArray(options.retryDelays) && options.retryDelays.length ? options.retryDelays : [0, 120, 250, 400, 650, 900, 1200];
			const isUnknownSession = typeof options.isUnknownSession === "function" ? options.isUnknownSession : function (error) {
				return /sessions\.(select|retain): unknown session/i.test(String(error && error.message || error || ""));
			};
			const active = new Map();

			function ready(sessionId) {
				return Boolean(options.summary(sessionId) && options.binding(sessionId));
			}

			async function synchronize(sessionId) {
				const expiresAt = now() + timeoutMs;
				let attempt = 0;
				while (!ready(sessionId) && now() < expiresAt) {
					try { await options.refresh(); }
					catch (error) {
						// An aborted or temporarily failed list request is recoverable here. The
						// deadline still bounds retries when the DSH service is genuinely down.
					}
					if (ready(sessionId)) return;
					const remaining = expiresAt - now();
					if (remaining <= 0) break;
					const delay = Math.max(0, Number(retryDelays[Math.min(attempt, retryDelays.length - 1)]) || 0);
					attempt += 1;
					await sleep(Math.min(delay, remaining));
				}
				if (ready(sessionId)) return;
				// 区分两种结局：宿主列表始终没有这一行（会话不在了 / 已被删），还是行在但
				// binding 没跟上（新建会话的 scope 尚未 retain）。前者刷新页面也没用，
				// 必须让用户去删掉这条历史记录，否则只能反复重试同一次超时。
				const missing = !options.summary(sessionId);
				// The host also leaves out a save whose old log it could not upgrade. That reason
				// matters more than "deleted": deleting the history would throw the save away.
				if (missing && typeof options.explainMissing === "function") {
					let reason = "";
					try { reason = await options.explainMissing(sessionId); } catch (_error) {}
					if (reason) throw new Error(reason);
				}
				throw new Error(missing
					? "DSH 会话 " + sessionId + " 已不在宿主列表中（可能已被删除），请删除这条历史记录后重试；若刚更新过请先刷新页面。"
					: "DSH Session 列表同步超时，请刷新页面后重试：" + sessionId);
			}

			function wait(sessionId) {
				if (ready(sessionId)) return Promise.resolve();
				if (active.has(sessionId)) return active.get(sessionId);
				const task = synchronize(sessionId).finally(function () { active.delete(sessionId); });
				active.set(sessionId, task);
				return task;
			}

			async function open(sessionId) {
				try { await options.open(sessionId); return; }
				catch (error) { if (!isUnknownSession(error)) throw error; }
				await wait(sessionId);
				await options.open(sessionId);
			}

			return Object.freeze({ ready: ready, wait: wait, open: open });
		}

		// alpha.2 exposes Session creation and preset selection on separate controllers.
		function createConversationHostAdapter(ctx) {
			let injectedAgentPresets;
			if (ctx && typeof ctx.inject === "function") {
				ctx.inject(["remote.agentPresets"], function (scope) {
					const service = scope.remote.agentPresets;
					injectedAgentPresets = service;
					return function () {
						if (injectedAgentPresets === service) injectedAgentPresets = undefined;
					};
				});
			}
			return Object.freeze({
				workspaceId: function (snapshot, sessionId) {
					const items = snapshot.items || [];
					const owner = sessionId && items.find(function (item) { return (item.sessionIds || []).includes(sessionId); });
					return (owner || items[0] || {}).workspaceId || "";
				},
				// uiWorkspace.connectWorkspace may reuse a blank Session that already has a
				// Tavern opening and a locked preset. New conversations must have their own Session.
				connectWorkspace: function (workspaceId) { return ctx.sessions.create({ workspaceId: workspaceId }); },
				forkSession: function (sessionId, atSeq) {
					if (!ctx.sessions || typeof ctx.sessions.fork !== "function") throw new Error("当前 DSH 版本不支持原生分叉，请升级 DSH 后重试");
					return ctx.sessions.fork({ sessionId: sessionId, atSeq: atSeq, increaseTitle: true });
				},
				ensurePreset: async function (sessionId, request) {
					// Select before writing the opening; the Session stream publishes preset state.
					// Keep Tavern's private Skill roots; its preset also mounts Cordis tools for card workbenches.
					const agentPreset = "tavern";
					let agentPresets = injectedAgentPresets;
					if (!agentPresets) {
						try {
							agentPresets = ctx.remote && ctx.remote.agentPresets;
						} catch (error) {
							if (!error || !/without inject/.test(String(error.message || error))) throw error;
						}
					}
					if (agentPresets && typeof agentPresets.select === "function") {
						const result = await agentPresets.select(sessionId, agentPreset);
						if (!result.ok) throw new Error(result.error && result.error.message || "无法切换到酒馆模式");
						return;
					}
					// DSHA 1.1 exposes the same host operation on the authenticated
					// connection API and wraps the result in the request envelope.
					const legacyAgentPresets = ctx.connection && ctx.connection.api && ctx.connection.api.agentPresets;
					if (!legacyAgentPresets || typeof legacyAgentPresets.select !== "function") throw new Error("当前 DSHA 版本不支持切换酒馆模式，请升级 DSHA 后重试");
					const response = await legacyAgentPresets.select({ sessionId: sessionId, agentPreset: agentPreset });
					const result = response && response.result;
					if (!result || !result.ok) throw new Error(result && result.error && result.error.message || "无法切换到酒馆模式");
				}
			});
		}

        function createConversationAttemptStore(storage) {
            const memory = new Map();
            const prefix = "dsh-tavern-pending-start:";
            return {
                get(key) {
                    if (memory.has(key)) return memory.get(key);
                    try {
                        const value = JSON.parse(storage.getItem(prefix + key) || "null");
                        if (value && typeof value.sessionId === "string" && value.sessionId) return value;
                    } catch (_) {}
                },
                set(key, value) {
                    memory.set(key, value);
                    storage.setItem(prefix + key, JSON.stringify(value));
                },
                delete(key) { memory.delete(key); storage.removeItem(prefix + key); },
                complete(sessionId) {
                    const keys = new Set(memory.keys());
                    for (let index = 0; index < storage.length; index++) {
                        const key = storage.key(index);
                        if (key && key.startsWith(prefix)) keys.add(key.slice(prefix.length));
                    }
                    for (const key of keys) if (this.get(key)?.sessionId === sessionId) this.delete(key);
                }
            };
        }

        function createConversationLifecycleModule(options) {
            for (const method of ["archiveCurrent", "resolveWorkspace", "connectWorkspace", "waitForSession", "ensurePreset", "createChat", "rememberPending", "finishOpen"]) {
                if (!options || typeof options[method] !== "function") throw new Error("Conversation Lifecycle 缺少 " + method + " adapter");
            }
            const attempts = options.attempts || new Map();
            const running = new Map();
            function start(request) {
                // Preview tokens are ephemeral; retries after re-opening the picker
                // must still find the Session belonging to the same user choice.
                const key = JSON.stringify([request.kind, request.targetMode, request.card && request.card.path,
                    request.openingId, request.userName, request.requestMode, request.task, request.pending]);
                if (running.has(key)) return running.get(key);
                const work = run(request, key).finally(() => running.delete(key));
                running.set(key, work);
                return work;
            }
            async function run(request, key) {
                let phase = "清理当前空白对话";
                let attempt = attempts.get(key);
                const timing = options.trace ? options.trace("startGame") : null;
                const step = (name, work) => timing ? timing.measure(name, work) : work();
                let successful = false;
                try {
                    const existingId = attempt && attempt.sessionId || request.preparedSessionId || "";
                    await step("archiveCurrent", () => options.archiveCurrent(existingId));
                    if (!attempt) {
                        let sessionId = existingId;
                        if (!sessionId) {
                            phase = request.kind === "card" ? "准备卡片工作区" : "准备游玩工作区";
                            const workspaceId = request.preparedWorkspaceId || await step("resolveWorkspace", () => options.resolveWorkspace(request));
                            phase = "创建 DSH Session";
                            sessionId = await step("connectWorkspace", () => options.connectWorkspace(workspaceId));
                        }
                        attempt = { sessionId, initialized: false };
                        attempts.set(key, attempt);
                    }
                    const sessionId = attempt.sessionId;
                    phase = "等待 DSH Session 就绪";
                    await step("waitForSession", () => options.waitForSession(sessionId));
                    if (!attempt.initialized) {
                        phase = "切换到酒馆模式";
                        await step("ensurePreset", () => options.ensurePreset(sessionId, request));
                        phase = request.kind === "card" ? "创建卡片工作台对话" : "写入人物卡开场白";
                        await step("createChat", () => options.createChat(request, sessionId));
                        attempt = { sessionId, initialized: true };
                        attempts.set(key, attempt);
                    }
                    phase = "同步并打开 DSH Session";
                    const pending = Object.assign({}, request.pending || {}, { sessionId, targetMode: request.targetMode });
                    options.rememberPending(pending);
                    await step("finishOpen", () => options.finishOpen(pending));
                    attempts.delete(key);
                    successful = true;
                    return { sessionId, pending };
                } catch (error) {
                    const failure = error instanceof Error ? error : new Error(String(error || "创建对话失败"));
                    failure.phase = phase;
                    failure.sessionId = attempt && attempt.sessionId;
                    // Phantom Session ids (create returned an id the DSH list never
                    // shows — e.g. failed Windows persistence) must not be reused on
                    // the next click, or waitForSession keeps timing out on the same id.
                    if (attempt && !attempt.initialized && /列表同步超时/.test(failure.message)) attempts.delete(key);
                    throw failure;
                } finally { if (timing) timing.finish(successful); }
            }
            return { start };
        }

        // Only workspace preparation is speculative; Sessions belong to confirmed starts.
        function createConversationPrewarmModule(options) {
            let active = null;
            function cancel() { active = null; }
            function begin(request) {
                const record = { key: String(request.key || ""), promise: Promise.resolve().then(() => options.resolveWorkspace(request)) };
                active = record;
                record.promise.catch(() => {});
                return record.promise;
            }
            async function claim(key) {
                const record = active;
                if (!record || record.key !== String(key || "")) return "";
                active = null;
                return await record.promise;
            }
            return Object.freeze({ begin, claim, cancel });
        }
