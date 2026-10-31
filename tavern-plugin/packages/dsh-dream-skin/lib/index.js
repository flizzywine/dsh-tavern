import {createFontLibrary, FONT_ROUTE} from './font-library.js';
import {createInterfaceSkins} from './interface-skins.js';
import {createSkinStore} from './skin-store.js';
/**
 * dsh-dream-skin — host half.
 *
 * Durable, origin-independent persistence for the browser half.
 *
 * The browser half previously stored every preference in localStorage, which
 * is scoped per origin (scheme + host + port). DSH Desktop binds its web
 * server to an OS-assigned port on every launch (profile.js forces the
 * webserver row to `port: 0`, and the launcher passes `--port 0`), so the GUI
 * origin changes on every restart and localStorage "forgets" the saved skin,
 * wallpaper and settings — the data is still in the leveldb, just under the
 * previous port's origin.
 *
 * This host half gives the browser half a stable channel that survives
 * origin changes:
 *
 *   - a state file at `$DSH_HOME/dream-skin.json` (default `~/.dsh/...`),
 *     written atomically (tmp + rename);
 *   - a fenced JSON API at `/dream-skin/api` — POST `{method:"get"}` returns
 *     the whole state object, POST `{method:"set", patch:{...}}` replaces it
 *     (full replacement, so keys removed on the client disappear too).
 *
 * The browser half seeds its in-memory cache from localStorage (so the first
 * paint is correct), then loads the authoritative state from this API and
 * re-applies it; writes are debounced and pushed here as the full state.
 *
 * Route security: the same trust fence as dsh-better-sidebar's /sidebar
 * routes — loopback (or a configured trusted authority) Host header and
 * same-origin browser markers only (403) — then the host's own session check,
 * `connection.requestRejection(req)`, exactly as `/api/...` uses it (401 when
 * the browser session is missing). A client that reaches a trusted authority
 * cannot read or write preferences without logging in.
 */

import { homedir } from "node:os";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/** State file name inside the DSH home directory. */
const STATE_FILENAME = "dream-skin.json";
/** Max accepted request body (wallpapers are base64 data URLs, can be MBs). */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** Route prefix owned by this plugin. */
const API_PREFIX = "/dream-skin/api";

/** Plugin identity for cordis.yml rows. */
export const name = "dsh-dream-skin";
/**
 * Services required before mounting: only the web server routes. The trust
 * fence host list is soft-resolved — DSH 0.2.0 exposed it as `webRuntime`,
 * DSH 0.2.1 dropped that service and keeps the same list on `connection` and
 * `webStartup` (see `trustedHosts`).
 */
export const inject = ["webServer"];

// ── state file ─────────────────────────────────────────────────────────────

/** Absolute path of the state file under the DSH home directory. */
function statePath() {
	const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
	return join(home, STATE_FILENAME);
}

/** Read the state object; `{}` when absent or corrupt. */
function readState() {
	try {
		const parsed = JSON.parse(readFileSync(statePath(), "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** Persist the state object atomically (tmp + rename, direct-write fallback). */
function writeState(state) {
	const file = statePath();
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	const body = JSON.stringify(state);
	// The state file holds the user's wallpaper data URLs (personal images),
	// so keep it owner-only on POSIX (mode is ignored on Windows).
	writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
	try {
		renameSync(tmp, file);
	} catch {
		// rename can fail on Windows if the target is transiently locked; a
		// direct write is a safe fallback for this single-process case.
		writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
	}
}

// ── trust fence (mirror of dsh-better-sidebar/src/trust-fence.ts) ─────────

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return undefined;
	}
}

/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4
		&& parts[0] === "127"
		&& parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form — mirrors dsh-client-connection's guard.
 * Anything WHATWG parsing would silently rewrite (whitespace, dangling
 * colon, zero-padded port, path fragment, bogus host spellings) is refused,
 * so a misconfigured entry cannot quietly broaden the authority grant. The
 * host list here comes from webRuntime (already validated by dsh-web-app);
 * this is a defensive second check that fails loud on a broken value.
 */
function assertTrustedAuthority(entry) {
	const entryUrl = parseAuthority(entry);
	if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return;
	throw new Error(`dsh-dream-skin: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}

/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		assertTrustedAuthority(entry);
		const entryUrl = parseAuthority(entry);
		if (entryUrl === undefined) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
			? entryUrl.hostname === hostUrl.hostname
			: entryUrl.host === hostUrl.host;
	});
}

/**
 * Decide whether one request may reach the plugin routes.
 * @param req - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
 */
function isTrustedApiRequest(req, trustedHosts) {
	const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
	if (host === undefined) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === undefined) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

// ── JSON body / response helpers ───────────────────────────────────────────

/** Sentinel: the request body exceeded MAX_BODY_BYTES (respond 413, not 400). */
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");

/**
 * Read a JSON request body, capped at MAX_BODY_BYTES.
 * Resolves the parsed body, or `null` when not valid JSON, or
 * `PAYLOAD_TOO_LARGE` when the body exceeded the cap.
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
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				resolve(parsed);
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => {
			if (!aborted) resolve(null);
		});
	});
}

/** Write a JSON response with the given status code. */
function writeJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store"
	});
	res.end(body);
}

/** Handle one fenced API request. */
async function handleApi(req, res, skins, fonts) {
	if (req.method !== "POST") {
		writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
		return;
	}
	// Content-type fence: only JSON bodies are meaningful here. Without it a
	// cross-site form POST (which the trust fence already blocks via
	// sec-fetch-site) would otherwise be parsed as `{}` and mis-handled. This
	// keeps the surface narrow and matches the official plugin behavior.
	const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"].toLowerCase() : "";
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
	const skinMethods = {
        listFonts: () => fonts.listFonts(),
        listInterfaceSkins: () => skins.list(),
        getActiveInterfaceSkin: () => skins.active(),
        importInterfaceSkin: () => skins.importSkin(payload.args),
        selectInterfaceSkin: () => skins.select(payload.args?.id ?? null),
        deleteInterfaceSkin: () => skins.remove(payload.args?.id)
    };
    if (Object.hasOwn(skinMethods, payload.method)) {
        try { writeJson(res, 200, {ok:true, value:await skinMethods[payload.method]()}); }
        catch (error) {
            // Validation errors are useful to the player; filesystem details stay in logs.
            console.warn('[dsh-dream-skin] CSS skin request failed:', error);
            writeJson(res, 400, {ok:false, error:{code:'skin-error', message:error.code ? '皮肤文件读写失败' : error.message}});
        }
        return;
    }
	if (payload.method === "get") {
		writeJson(res, 200, { ok: true, value: readState() });
		return;
	}
	if (payload.method === "set") {
		const patch = payload.patch;
		if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
			writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "patch must be a plain object" } });
			return;
		}
		// Merge into the current state. Only the keys present in `patch` are
		// touched: a string value sets it, null removes it, and keys not in the
		// patch are left untouched. This makes concurrent writers (e.g. two
		// browser tabs, each with its own in-memory cache) safe — a tab that
		// changed the accent won't wipe the wallpaper another tab just set.
		// Only string / null values are accepted, so a compromised page cannot
		// smuggle non-JSON types into the file.
		const next = readState();
		for (const [key, value] of Object.entries(patch)) {
			if (typeof key !== "string") continue;
			if (value === null) delete next[key];
			else if (typeof value === "string") next[key] = value;
		}
		writeState(next);
		writeJson(res, 200, { ok: true });
		return;
	}
	writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown method "${payload.method}"` } });
}

/**
 * Trusted authorities this deployment serves, read lazily from whichever
 * web-runtime service the host exposes. DSH 0.2.0 published the fence list as
 * `webRuntime.trustedHosts`; 0.2.1 removed that service and keeps the same
 * value on `connection.trustedHosts` (the transport) and
 * `webStartup.trustedHosts` (the invocation). Resolving per request also picks
 * up a service that mounts after this plugin.
 * @param ctx - host cordis context.
 * @returns configured trusted hosts, or an empty list when none is exposed.
 */
function trustedHosts(ctx) {
	for (const service of ["webRuntime", "connection", "webStartup"]) {
		const hosts = ctx.get(service)?.trustedHosts;
		if (Array.isArray(hosts)) return hosts;
	}
	return [];
}

/**
 * Host loader entry: mount the fenced persistence API.
 * @param ctx - host cordis context (webServer).
 */
export function apply(ctx) {
    const skins = createInterfaceSkins({store:createSkinStore()});
    const fonts = createFontLibrary({dataRoot:join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profile-data/tavern/data')});
	for (const route of [API_PREFIX, FONT_ROUTE]) ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: route,
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req, trustedHosts(ctx))) {
				writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
				return;
			}
			const connection = ctx.get("connection");
			const rejection = typeof connection?.requestRejection === "function" ? connection.requestRejection(req) : 503;
			if (rejection) {
				const code = rejection === 401 ? "unauthorized" : rejection === 403 ? "forbidden" : "unavailable";
				writeJson(res, rejection, { ok: false, error: { code, message: code } });
				return;
			}
			try {
				if (route === FONT_ROUTE) { await fonts.serve(req,res); return; }
                await handleApi(req, res, skins, fonts);
			} catch (error) {
				// Do not echo the internal error back to the browser — the
				// trusted-origin page does not need filesystem paths etc.
				console.error("[dsh-dream-skin] persistence API error:", error);
				writeJson(res, 500, { ok: false, error: { code: "internal", message: "internal error" } });
			}
		}
	}), "dsh-dream-skin: persistence API routes");
}
