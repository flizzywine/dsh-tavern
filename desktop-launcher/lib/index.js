/**
 * dsh-tavern-launcher — 宿主半侧（host half）。
 *
 * 目标：让 DSH Desktop 的 GUI（配合 DSH Better Sidebar）里头有一个「启动 Tavern」
 * 的按钮，而不必依赖托盘菜单。
 *
 * 本半侧只做三件事：
 *   1. 定位 tavern 源码树（DSH_TAVERN_SOURCE → $DSH_HOME/profiles/tavern/package.json
 *      的 dshTavern.source）；
 *   2. 动态 import 该仓库 `bin/launcher-environment.mjs` 与 `bin/service-lifecycle.mjs`，
 *      直接复用 tavern 自己的 start/stop/status 实现（不复制一份启动逻辑）；
 *   3. 在 DSH Web 服务器上注册同源 API `/tavern-launcher/api`，供浏览器半侧调用。
 *
 * 为什么复用而不是自己 spawn：启动 tavern 需要处理「桌面 0.2.0 的 dsh 是 Electron +
 * app.asar 内 CLI」这一形态（resolveDesktopAsarCommand），以及 PID 记录、端口就绪、
 * 日志里取带 token 的 Web URL 等细节，这些都已经在 tavern 仓库里实现且被真机验证过。
 *
 * 路由安全：与 dsh-better-sidebar 的 /sidebar、dsh-dream-skin 的 /dream-skin/api 同一
 * 条信任栅栏——Host 必须是回环（或配置的 trustedHosts）且浏览器标记同源。这是 DNS
 * rebinding / 跨站防御，不是身份认证。
 */
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** 插件身份（cordis 行名）。 */
export const name = "dsh-tavern-launcher";

/**
 * 只硬依赖 webServer；webRuntime 用 ctx.get 软取（缺了也能工作，只是不做
 * trustedHosts 扩展）。
 */
export const inject = ["webServer"];

/** 本插件独占的路由前缀。 */
const API_PREFIX = "/tavern-launcher/api";
/** 请求体上限（这里只有极小的 JSON 命令）。 */
const MAX_BODY_BYTES = 64 * 1024;
/** 请求体超限哨兵。 */
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");

// ── 基础工具 ────────────────────────────────────────────────────────────────

/** DSH home 目录。 */
function dshHome() {
	const configured = process.env.DSH_HOME;
	return configured !== undefined && configured.length > 0 ? configured : join(homedir(), ".dsh");
}

/** 返回 JSON 响应。 */
function writeJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(body);
}

/**
 * 读取 JSON 请求体，上限 MAX_BODY_BYTES。
 * 返回解析结果、null（非法 JSON）或 PAYLOAD_TOO_LARGE。
 */
function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let aborted = false;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES && !aborted) {
				aborted = true;
				req.destroy();
				resolve(PAYLOAD_TOO_LARGE);
				return;
			}
			if (!aborted) chunks.push(chunk);
		});
		req.on("end", () => {
			if (aborted) return;
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => {
			if (!aborted) resolve(null);
		});
	});
}

/** 回环主机名：localhost / 127.0.0.0/8 / ::1。 */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4
		&& parts[0] === "127"
		&& parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** 解析 authority（host 或 host:port）。 */
function parseAuthority(value) {
	try {
		return new URL(`http://${value}`);
	} catch {
		return undefined;
	}
}

/**
 * 判断一次请求能否进入本插件路由：Host 必须是回环或 webRuntime 配置的可信 host，
 * 且浏览器标记（sec-fetch-site / Origin）必须同源。
 */
function isTrustedApiRequest(req, trustedHosts) {
	const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
	if (host === undefined) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === undefined) return false;
	const trusted = Array.isArray(trustedHosts)
		&& trustedHosts.some((entry) => typeof entry === "string" && entry.toLowerCase() === host.toLowerCase());
	if (!isLoopbackHostname(hostUrl.hostname) && !trusted) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

// ── 定位 tavern 运行时 ──────────────────────────────────────────────────────

/** 读 `$DSH_HOME/profiles/tavern/package.json`（安装记录就在它的 dshTavern 段里）。 */
function tavernProfileManifest() {
	const file = join(dshHome(), "profiles", "tavern", "package.json");
	if (!existsSync(file)) return {};
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		return parsed !== null && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** 解析 tavern 源码目录。 */
function resolveTavernSource() {
	const manifest = tavernProfileManifest();
	const candidates = [process.env.DSH_TAVERN_SOURCE, manifest?.dshTavern?.source];
	for (const candidate of candidates) {
		if (typeof candidate !== "string" || candidate.length === 0) continue;
		if (existsSync(join(candidate, "bin", "dsh-tavern.mjs"))) return candidate;
	}
	throw new Error(
		"未找到 DSH Tavern 源码目录：请设置 DSH_TAVERN_SOURCE，或保留 $DSH_HOME/profiles/tavern/package.json 里的 dshTavern.source",
	);
}

/**
 * 加载 tavern 自己的生命周期实现。
 *
 * `launcher-environment.mjs` 在 import 期计算 RUNTIME_HOST（argv --host= →
 * DSH_TAVERN_RUNTIME_HOST → DSH_TAVERN_HOST → 安装记录 host → cli）。桌面 GUI 里
 * 我们必须让它是 desktop，否则会把 $DSH_HOME 算到 ~/.dsh-tavern 去；显式补齐环境变量
 * 后这个 import 才发生。
 */
async function tavernRuntime() {
	const source = resolveTavernSource();
	if (process.env.DSH_TAVERN_RUNTIME_HOST === undefined && process.env.DSH_TAVERN_HOST === undefined) {
		process.env.DSH_TAVERN_RUNTIME_HOST = "desktop";
	}
	const bin = join(source, "bin");
	const environment = await import(pathToFileURL(join(bin, "launcher-environment.mjs")).href);
	const lifecycle = await import(pathToFileURL(join(bin, "service-lifecycle.mjs")).href);
	return { source, environment, lifecycle };
}

/** 读 service-lifecycle 的 PID 记录（同样格式，独立读以免依赖其内部函数）。 */
function readPidRecord(pidFile) {
	if (!existsSync(pidFile)) return null;
	try {
		const record = JSON.parse(readFileSync(pidFile, "utf8"));
		return Number.isInteger(record?.pid) && record.pid > 0 ? record : null;
	} catch {
		return null;
	}
}

/** 服务快照：桌面 GUI 需要的全部信息。 */
async function serviceSnapshot() {
	const { source, environment, lifecycle } = await tavernRuntime();
	const port = environment.CLI_PORT;
	const record = readPidRecord(environment.PID_FILE);
	const portOpen = await lifecycle.isPortOpen(port);
	const ready = portOpen ? await lifecycle.isServiceReady(port) : false;
	let url = "";
	if (ready) {
		let log = Buffer.alloc(0);
		try {
			log = readFileSync(environment.LOG_FILE);
		} catch {
			log = Buffer.alloc(0);
		}
		url = await lifecycle.resolveServiceWebUrl({ port, record: record ?? {}, log });
	}
	return {
		source,
		home: environment.DSH_ROOT,
		logPath: environment.LOG_FILE,
		port,
		pid: record?.pid ?? null,
		startedAt: record?.startedAt ?? null,
		portOpen,
		ready,
		running: portOpen || record !== null,
		url,
	};
}

// ── 动作串行化 ──────────────────────────────────────────────────────────────

/** start/stop 不能并发（会互相踩 PID 记录与端口探测）。 */
let actionQueue = Promise.resolve();

function serialized(task) {
	const next = actionQueue.then(task, task);
	actionQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

// ── API ─────────────────────────────────────────────────────────────────────

/** 处理一次 `/tavern-launcher/api` 调用。 */
async function handleApi(req, res) {
	const contentType = typeof req.headers["content-type"] === "string"
		? req.headers["content-type"].toLowerCase()
		: "";
	if (!contentType.startsWith("application/json")) {
		writeJson(res, 415, { ok: false, error: { code: "unsupported-media-type", message: "content-type must be application/json" } });
		return;
	}
	const payload = await readJsonBody(req);
	if (payload === PAYLOAD_TOO_LARGE) {
		writeJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "request body too large" } });
		return;
	}
	if (payload === null || typeof payload !== "object" || typeof payload.method !== "string") {
		writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "bad request" } });
		return;
	}
	try {
		switch (payload.method) {
			case "status": {
				writeJson(res, 200, { ok: true, value: await serviceSnapshot() });
				return;
			}
			case "start": {
				const state = await serialized(async () => {
					const { lifecycle } = await tavernRuntime();
					const started = await lifecycle.startService();
					return { ...(await serviceSnapshot()), url: started?.webUrl || "" };
				});
				writeJson(res, 200, { ok: true, value: state });
				return;
			}
			case "stop": {
				const state = await serialized(async () => {
					const { lifecycle } = await tavernRuntime();
					await lifecycle.stopService();
					return await serviceSnapshot();
				});
				writeJson(res, 200, { ok: true, value: state });
				return;
			}
			case "open": {
				// 只回传当前带 token 的地址，供浏览器半侧在新窗口打开酒馆界面。
				writeJson(res, 200, { ok: true, value: await serviceSnapshot() });
				return;
			}
			default:
				writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown method "${payload.method}"` } });
				return;
		}
	} catch (error) {
		console.error("[dsh-tavern-launcher] tavern 服务操作失败：", error);
		writeJson(res, 500, {
			ok: false,
			error: { code: "failed", message: error?.message !== undefined ? String(error.message) : String(error) },
		});
	}
}

/**
 * 宿主加载入口：挂载同源 API 路由。
 * @param ctx - 宿主 cordis 上下文（webServer，可选 webRuntime）。
 */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: async (req, res) => {
			const trustedHosts = ctx.get("connection")?.trustedHosts ?? ctx.get("webStartup")?.trustedHosts ?? ctx.get("webRuntime")?.trustedHosts ?? [];
			if (!isTrustedApiRequest(req, trustedHosts)) {
				writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
				return;
			}
			try {
				await handleApi(req, res);
			} catch (error) {
				console.error("[dsh-tavern-launcher] API 错误：", error);
				writeJson(res, 500, { ok: false, error: { code: "internal", message: "internal error" } });
			}
		},
	}), "dsh-tavern-launcher: tavern service API");
}
