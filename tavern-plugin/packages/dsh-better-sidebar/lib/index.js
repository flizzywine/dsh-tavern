import { access, lstat, mkdir, open, opendir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { parse } from "yaml";
import z from "@deepseek-ai/schemastery";
import { execFile, execFileSync, spawn } from "node:child_process";
import { appendFileSync, createReadStream, createWriteStream, readFileSync, statSync, watch } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { foldSurface, isSurfaceEligibleType } from "@deepseek-ai/dsh-session/surface";
import { BlockAssembler, ReasoningEffortId, createUserMessage } from "@deepseek-ai/dsh-llm";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { snapshotSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
//#region src/prefs-shared.ts
/**
* Shared "Side card" preference vocabulary (types + constants), consumed by
* BOTH halves: the host registers the schemastery schema over these values
* (config.ts) and the client reads/writes them through the settings RPC
* (client/prefs.ts, client/SideCardSection.tsx). Kept free of schemastery so
* the browser bundle never pulls the schema runtime in.
*/
/** The user-settings namespace holding the side card preferences. */
const SIDEBAR_PREFS_NS = "dsh-better-sidebar";
/** The stock exclude list (VS Code ships a similar files.exclude default). */
const EXPLORER_EXCLUDE_DEFAULTS = [".DS_Store", "Thumbs.db"];
/** Fallback prefs used whenever the settings document is unreachable or malformed. */
const SIDEBAR_PREFS_DEFAULTS = {
	autoOpenSubagent: true,
	autoOpenJobs: true,
	tasksViewMode: "graph",
	mobileNoAutoOpen: true,
	mobileDefaultTree: true,
	agentOpenTools: false,
	editorExplorer: false,
	editorGitGutter: true,
	explorerExclude: [...EXPLORER_EXCLUDE_DEFAULTS],
	customCss: "",
	htmlViewerNoSandbox: false,
	htmlViewerDefaultUnsafe: false,
	tabsEnabled: {},
	viewersEnabled: {},
	pluginSettings: {}
};
//#endregion
//#region src/config.ts
/**
* Serializable configuration and defaults for the sidebar host half. Loader
* schema validation normally fills defaults; {@link resolveSidebarConfig}
* applies the same defaults for direct callers that bypass the Loader.
*
* Schemastery comes from DSH, not from the public `schemastery` package, and
* that is load-bearing rather than stylistic: only DSH's build WRAPS a
* `meta.volatile` field in a cosmokit `Volatile` reference when it parses the
* config. The Loader's volatile-commit path walks those references
* (`volatileEntries` / `updateVolatile`), so a schema built with the public
* package produces plain values, leaves the loader nothing to commit, and
* **silently drops every live preference write** — the write reports success
* and the effective value never changes.
* @module dsh-better-sidebar/config
*/
/**
* Schemastery schema for the deployment-provided host limits.
*
* The three transfer/read caps this schema used to carry (`readLimit` /
* `mediaLimit` / `uploadLimit`) are gone: upload, download and the HTML
* preview route all stream now, so there is nothing left for a byte cap to
* protect and a large file is simply a large file. What replaced `readLimit`
* is {@link MAX_EDITABLE_BYTES} — not a transfer cap but the size above which
* a text file gets a read-only paged preview instead of an editor, because
* CodeMirror has to hold the whole document in the browser.
*
* Old profiles that still write the retired keys are harmless: schemastery
* tolerates unknown keys (the same property that keeps a legacy
* `workspaceFence` field in an old profile from being fatal).
*/
const LimitsSchema = z.object({ listLimit: z.number().step(1).min(1).default(1e3) });
/**
* Apply direct-call defaults after Loader schema validation has normally run.
*
* @param config - Deployment-provided sidebar host settings.
* @returns Complete settings consumed by the host half.
*/
function resolveSidebarConfig(config) {
	return { listLimit: config?.listLimit ?? 1e3 };
}
/**
* Schemastery schema for the user-facing preferences (validated by the
* settings service).
*
* Asserted as `z<SidebarPrefs>` (the interface lives in `prefs-shared.ts`; the
* explicit annotation is also what keeps the emitted declaration portable).
* Unknown keys are TOLERATED by this schema and pass through untouched, which
* is what keeps a legacy `workspaceFence: true` — or the retired title-bar
* compatibility keys (`titleBarScheme` / `titleBarPresetId` /
* `titleBarCompat` / `titleBarStripPx`, removed with the whole strip
* mechanism) — in an old profile harmless instead of fatal.
*/
const PrefsSchema = z.object({
	autoOpenSubagent: z.boolean().default(true),
	autoOpenJobs: z.boolean().default(true),
	tasksViewMode: z.union([z.const("graph"), z.const("tree")]).default("graph"),
	mobileNoAutoOpen: z.boolean().default(true),
	mobileDefaultTree: z.boolean().default(true),
	agentOpenTools: z.boolean().default(false),
	editorExplorer: z.boolean().default(false),
	editorGitGutter: z.boolean().default(true),
	explorerExclude: z.array(z.string()).default([...EXPLORER_EXCLUDE_DEFAULTS]),
	customCss: z.string(),
	htmlViewerNoSandbox: z.boolean().default(false),
	htmlViewerDefaultUnsafe: z.boolean().default(false),
	tabsEnabled: z.dict(z.boolean()).default({}),
	viewersEnabled: z.dict(z.boolean()).default({}),
	pluginSettings: z.dict(z.dict(z.any())).default({})
});
const volatilePrefs = Object.fromEntries(Object.entries(PrefsSchema.dict ?? {}).map(([key, field]) => [key, field.volatile()]));
/**
* Config schema of this plugin's Loader row: deployment limits plus the live
* user preferences.
*/
const Config = z.object({
	...LimitsSchema.dict,
	...volatilePrefs
});
//#endregion
//#region src/git.ts
/**
* Git operations for the sidebar source-control panel. Everything goes
* through the system `git` binary spawned per request (no library, no state),
* with porcelain-parseable output formats (`-z` NUL framing, unit separators)
* so parsing never depends on locale or color config. All commands run with
* `-C <cwd>` on the session's working directory and `--no-pager` /
* `-c color.ui=false` / `-c core.quotePath=false` so output stays
* machine-readable and paths stay literal (git's default C-quotes a non-ASCII
* path, which every diff surface would render as the file name).
*
* Commits use the user's git global identity untouched (never sets
* user.name/user.email).
*/
/** One git failure (stderr text as the message). */
var GitCommandError = class extends Error {
	code;
	command;
	constructor(message, code = "git-error", command) {
		super(message);
		this.code = code;
		this.command = command;
	}
};
/** Parse porcelain v1 -z output into entries (rename/copy pairs collapse to one row). */
function parsePorcelainZ(output) {
	const tokens = output.split("\0");
	const entries = [];
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		index += 1;
		if (token === "") continue;
		const xy = token.slice(0, 2);
		const rest = token.slice(3);
		entries.push({
			path: rest,
			xy
		});
		if ((xy[0] === "R" || xy[0] === "C") && tokens[index] !== void 0 && tokens[index] !== "") index += 1;
	}
	return entries;
}
/**
* Walk a `status --porcelain=v2 -z` read into its tokens. The fixed-width
* records are counted, never split by name — a path may contain spaces, so the
* path is everything after the Nth field. A torn tail (the row cap kills the
* child mid-record) yields no token; the walk never throws on it.
*/
function porcelainV2Tokens(output) {
	const tokens = [];
	const fields = output.split("\0");
	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index];
		if (field === "") continue;
		if (field.startsWith("# ")) {
			tokens.push({
				kind: "meta",
				line: field
			});
			continue;
		}
		if (field.startsWith("? ")) {
			tokens.push({
				kind: "record",
				xy: "??",
				path: field.slice(2)
			});
			continue;
		}
		if (!field.startsWith("1 ") && !field.startsWith("2 ") && !field.startsWith("u ")) continue;
		const fixed = field.startsWith("u ") ? 10 : field.startsWith("2 ") ? 9 : 8;
		const path = field.split(" ").slice(fixed).join(" ");
		if (path === "") continue;
		const token = {
			kind: "record",
			xy: field.slice(2, 4).replaceAll(".", " "),
			path
		};
		if (field.startsWith("2 ")) {
			const origin = fields[index + 1];
			index += 1;
			if (origin !== void 0 && origin !== "") token.origin = origin;
		}
		tokens.push(token);
	}
	return tokens;
}
/**
* Parse a `status --porcelain=v2 --branch -z` read. The metadata lines carry
* the branch identity, its tracking ref and the ahead/behind counts; the file
* records reuse the v1 XY convention (v2's `.` clean side folded to a space).
*/
function parseStatusPorcelainV2Z(output) {
	const result = {
		isRepo: true,
		entries: []
	};
	for (const token of porcelainV2Tokens(output)) {
		if (token.kind === "record") {
			result.entries.push({
				xy: token.xy,
				path: token.path
			});
			continue;
		}
		const line = token.line;
		if (line.startsWith("# branch.head ")) {
			const head = line.slice(14);
			result.detached = head === "(detached)";
			if (!result.detached) result.branch = head;
		} else if (line.startsWith("# branch.upstream ")) result.upstream = line.slice(18);
		else if (line.startsWith("# branch.ab ")) {
			const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
			if (counts !== null) {
				result.ahead = Number(counts[1]);
				result.behind = Number(counts[2]);
			}
		}
	}
	return result;
}
/**
* Resolve one `--numstat` path field to the path the file has NOW: the plain
* (`old => new`) and brace (`src/{a => b}/x.ts`) rename notations both fold
* into the new name, and anything else passes through verbatim.
*
* Only the LINE-framed output needs this: in `-z` framing git writes the two
* names as separate NUL fields, so a path is never folded into rename notation
* there — a file literally named `a => b.txt` keeps its own name.
*/
function resolveNumstatPath(path) {
	const arrow = path.indexOf(" => ");
	if (arrow === -1) return path;
	const open = path.indexOf("{");
	if (open !== -1 && open < arrow) {
		const close = path.indexOf("}", arrow + 4);
		if (close !== -1) return `${path.slice(0, open)}${path.slice(arrow + 4, close)}${path.slice(close + 1)}`;
	}
	return path.slice(arrow + 4);
}
/**
* Parse one `git diff --numstat` answer into a path → line-counts map. Both
* framings are accepted: the production `-z` one (records NUL-framed, so paths
* with newlines or quotes stay lossless) and the plain line-framed one.
*
* Three record shapes exist:
*  - `2\t0\tpath` — an ordinary change,
*  - `-\t-\tpath` — a binary change: no counts exist, so it maps to the binary
*    variant rather than to `0 0`,
*  - renames — the path field is the pair `old => new` (or the brace form
*    `src/{a => b}/x.ts`) in line framing, and two NUL-framed fields (origin
*    first) in `-z` framing.
*
* A rename is attributed to the NEW path: that is the file as it exists now,
* and the exact path `git status --porcelain` reports for the same change, so
* the counts land on the row the panel renders.
*/
function parseNumstat(output) {
	const counts = /* @__PURE__ */ new Map();
	const framed = output.includes("\0");
	const records = output.split(framed ? "\0" : "\n");
	let index = 0;
	while (index < records.length) {
		const record = records[index];
		index += 1;
		if (record === "") continue;
		const addedEnd = record.indexOf("	");
		const deletedEnd = addedEnd === -1 ? -1 : record.indexOf("	", addedEnd + 1);
		if (deletedEnd === -1) continue;
		const added = record.slice(0, addedEnd);
		const deleted = record.slice(addedEnd + 1, deletedEnd);
		let path = record.slice(deletedEnd + 1);
		if (framed && path === "") {
			const renamed = records[index + 1];
			index += 2;
			if (renamed === void 0) continue;
			path = renamed;
		} else if (!framed) path = resolveNumstatPath(path);
		if (path === "") continue;
		if (added === "-" || deleted === "-") {
			counts.set(path, { binary: true });
			continue;
		}
		const additions = Number(added);
		const deletions = Number(deleted);
		if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
		counts.set(path, {
			additions,
			deletions
		});
	}
	return counts;
}
/** Parse `git worktree list --porcelain` records. Production requests use
* `-z` so even newlines and non-ASCII bytes in checkout paths stay lossless;
* newline framing remains accepted for small fixtures and older Git output. */
function parseWorktreeList(output) {
	const rows = [];
	let path;
	let branch = "HEAD";
	let locked = false;
	let prunable = false;
	const flush = () => {
		if (path !== void 0) rows.push({
			path,
			branch,
			locked,
			prunable
		});
		path = void 0;
		branch = "HEAD";
		locked = false;
		prunable = false;
	};
	const sep = output.includes("\0") ? "\0" : "\n";
	const framed = output.endsWith(sep) ? output : `${output}${sep}`;
	for (const line of framed.split(sep)) if (line === "") flush();
	else if (line.startsWith("worktree ")) path = line.slice(9);
	else if (line.startsWith("branch refs/heads/")) branch = line.slice(18);
	else if (line === "locked" || line.startsWith("locked ")) locked = true;
	else if (line === "prunable" || line.startsWith("prunable ")) prunable = true;
	return rows;
}
/** Parse `git log --pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D%x1f%P` rows. */
function parseLogLines(output) {
	const rows = [];
	for (const line of output.split("\n")) {
		if (line === "") continue;
		const [hash, subject, author, date, hashFull, refs, parents] = line.split("");
		if (hash === void 0 || subject === void 0) continue;
		rows.push({
			hash,
			subject,
			author: author ?? "",
			date: date ?? "",
			hashFull: hashFull ?? hash,
			refs: refs ?? "",
			parents: parents?.split(" ").filter(Boolean) ?? []
		});
	}
	return rows;
}
/**
* git's CVE-2022-24765 guard (git ≥ 2.35.2) refuses to read a repository whose
* owner differs from the running user — the shape behind issue #690 is a
* root-run DSH over a site directory owned by `www`, where changing the owner
* is not an option. The refusal is per command and self-describing: git names
* the directory it refused, which is exactly what `safe.directory` takes.
* Answering it with `-c safe.directory=<dir>` therefore stays narrow — no
* config file is written, `*` is never used, and the next command faces the
* guard again.
*/
const DUBIOUS_OWNERSHIP = /dubious ownership/i;
/** The directory named by the refusal (`fatal: detected dubious ownership in
*  repository at '/srv/site'`). */
const REFUSED_REPOSITORY = /detected dubious ownership in repository at '([^']*)'/;
/** The repository path a dubious-ownership refusal names, or undefined when
*  the message carries no path (an older or reworded git) — the caller then
*  falls back to the cwd it already ran in. */
function refusedRepository(message) {
	const path = REFUSED_REPOSITORY.exec(message)?.[1];
	return path === void 0 || path === "" ? void 0 : path;
}
/** Child environment for every git call. `GIT_OPTIONAL_LOCKS=0` keeps the
*  read-only panel from taking write locks; `LC_ALL=C` keeps stdout AND stderr
*  stable, which is what makes the refused path above parseable. */
const GIT_ENV = {
	GIT_OPTIONAL_LOCKS: "0",
	LC_ALL: "C"
};
/**
* Hard ceiling on one git command's stdout. A runaway command — a whole-repo
* `diff` with no pathspec (the shape a repository with an unignored nested
* `node_modules` produced: 59 631 entries / 9.24 MB), a `show` of a generated
* file — must not be accumulated into an unbounded JS string. Exceeding it
* kills the child and rejects with the ordinary {@link GitCommandError} shape;
* callers that treat a git failure as "no answer" (the numstat sides, blame)
* keep their existing fallback.
*/
const GIT_OUTPUT_MAX_BYTES = 8388608;
/** Count the NUL bytes of one stdout chunk (the `-z` field separator). */
function countNulFields(chunk) {
	let count = 0;
	for (let at = chunk.indexOf(0); at !== -1; at = chunk.indexOf(0, at + 1)) count += 1;
	return count;
}
/** One spawn. `safe` directories ride in as per-invocation `safe.directory`
*  overrides (empty on the first attempt, so a healthy repository sees the
*  exact same argv it always did). */
function spawnGit(cwd, args, timeoutMs, safe, options = {}) {
	const full = [
		"-C",
		cwd,
		"--no-pager",
		"-c",
		"color.ui=false",
		"-c",
		"core.quotePath=false",
		...safe.flatMap((dir) => ["-c", `safe.directory=${dir}`]),
		...args
	];
	const maxBytes = options.maxBytes ?? GIT_OUTPUT_MAX_BYTES;
	const maxNulFields = options.maxNulFields;
	return new Promise((resolvePromise, reject) => {
		const child = spawn("git", full, {
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			windowsHide: true,
			env: {
				...process.env,
				...GIT_ENV
			}
		});
		let stdout = "";
		let outBytes = 0;
		let outFields = 0;
		let stderr = "";
		let fieldCapped = false;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new GitCommandError(`git ${args[0] ?? ""} timed out after ${timeoutMs}ms`, "git-error", args.join(" ")));
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			if (fieldCapped) return;
			stdout += chunk.toString("utf8");
			outBytes += chunk.length;
			if (outBytes > maxBytes) {
				child.kill("SIGKILL");
				reject(new GitCommandError(`git ${args[0] ?? ""} output exceeded ${maxBytes} bytes`, "git-error", args.join(" ")));
				return;
			}
			if (maxNulFields !== void 0) {
				outFields += countNulFields(chunk);
				if (outFields >= maxNulFields) {
					fieldCapped = true;
					child.kill("SIGKILL");
				}
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(new GitCommandError(`cannot run git: ${error.message}`, "git-error", args.join(" ")));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (fieldCapped || code === 0) resolvePromise(stdout);
			else reject(new GitCommandError(stderr.trim() || `git exited with ${String(code)}`, "git-error", args.join(" ")));
		});
	});
}
/**
* Run one git command; resolves with stdout, rejects with GitCommandError.
*
* A dubious-ownership refusal is retried ONCE with the refused repository
* (plus the cwd, which is the answer when the message named no path) trusted
* for that invocation only. Anything else — including a second refusal — is
* reported as-is, so a repository git cannot be talked into reading still
* surfaces its real error instead of a misleading "not a git repository".
*/
function runGit(cwd, args, timeoutMs = 3e4, options = {}) {
	return spawnGit(cwd, args, timeoutMs, [], options).catch((error) => {
		if (!(error instanceof GitCommandError) || !DUBIOUS_OWNERSHIP.test(error.message)) throw error;
		const refused = refusedRepository(error.message);
		return spawnGit(cwd, args, timeoutMs, refused === void 0 || refused === cwd ? [cwd] : [refused, cwd], options);
	});
}
/** Format epoch seconds plus a `+HHMM`/`-HHMM` timezone as ISO 8601. */
function isoWithOffset(seconds, timezone) {
	const zone = /^([+-])(\d{2})(\d{2})$/.exec(timezone);
	const offsetMinutes = zone === null ? 0 : (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3]));
	const shifted = /* @__PURE__ */ new Date((seconds + offsetMinutes * 60) * 1e3);
	const pad = (value) => String(value).padStart(2, "0");
	const stamp = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
	return zone === null ? `${stamp}Z` : `${stamp}${zone[1]}${zone[2]}:${zone[3]}`;
}
/**
* Parse `git blame --porcelain -L <a>,<b>` output into one row per blamed
* line. Porcelain repeats only the `<hash> <orig> <final>` header for the
* SECOND and later lines of the same commit (the author / committer / summary
* block is emitted once per commit per run), so metadata is carried forward
* per hash; every record ends with its `\t`-prefixed content line, which is
* where the walk resumes. Unknown lines are skipped, never fatal.
*/
function parseBlamePorcelain(output) {
	const rows = [];
	const seen = /* @__PURE__ */ new Map();
	const lines = output.split("\n");
	let index = 0;
	while (index < lines.length) {
		const header = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(lines[index]);
		if (header === null) {
			index += 1;
			continue;
		}
		const hash = header[1];
		const line = Number(header[2]);
		index += 1;
		let author;
		let date;
		let summary;
		while (index < lines.length && !lines[index].startsWith("	")) {
			const text = lines[index];
			index += 1;
			if (text.startsWith("author ")) author = text.slice(7);
			else if (text.startsWith("author-time ")) {
				const seconds = Number(text.slice(12));
				const zone = /^author-tz (.+)$/.exec(lines[index] ?? "");
				if (Number.isFinite(seconds)) date = isoWithOffset(seconds, zone?.[1] ?? "");
			} else if (text.startsWith("summary ")) summary = text.slice(8);
		}
		if (index < lines.length && lines[index].startsWith("	")) index += 1;
		const known = seen.get(hash);
		if (known === void 0) {
			const record = {
				author: author ?? "",
				date: date ?? "",
				summary: summary ?? ""
			};
			seen.set(hash, record);
			rows.push({
				hash,
				line,
				...record
			});
		} else rows.push({
			hash,
			line,
			...known
		});
	}
	return rows;
}
/**
* Blame one line range of a file (`git blame --porcelain -L <a>,<b>`).
* Every failure mode — not a repository, an untracked file (`git blame`
* exits non-zero: no such path in HEAD), a bad revision, a stalled mount
* hitting the command timeout — resolves to an EMPTY result: the editor's
* hover tooltip shows nothing and a missing answer can never break the
* editing surface.
*/
async function blame(cwd, path, startLine, endLine, selected) {
	try {
		return parseBlamePorcelain(await runGit(await repoRoot(cwd, selected), [
			"blame",
			"--porcelain",
			"-L",
			`${String(startLine)},${String(endLine)}`,
			"--",
			path
		]));
	} catch {
		return [];
	}
}
/** Cap on child directories probed by the workspace-container fallback scan.
*  A home-directory cwd can hold hundreds of visible folders (Library, iCloud
*  mounts…); probing them all serially is what froze the panel in #369. */
const DISCOVERY_LIMIT = 200;
/** How many BFS levels the nested-repo discovery descends below cwd; repo
*  roots up to depth DISCOVERY_MAX_DEPTH - 1 are detected (level d holds
*  depth-(d-1) dirs, whose entries are read for `.git`). 4 is the minimum
*  useful value. Cost stays bounded by the depth ≤ 3 directory count; the
*  depth-4 frontier is collected but never expanded. */
const DISCOVERY_MAX_DEPTH = 4;
/** Per-probe and direct-discovery budget. `rev-parse` is millisecond-scale on
*  a healthy checkout; a probe that needs longer is a stalled mount and is
*  better abandoned than waited on. */
const DISCOVERY_TIMEOUT_MS = 5e3;
/** Discovery results are cheap to recompute but expensive to storm: the panel
*  polls every 2s and each poll fans out into several git.* calls that all
*  resolve the same roots. A short TTL keeps fan-out at one scan per cwd. */
const DISCOVERY_CACHE_TTL_MS = 6e4;
const repoRootsCache = /* @__PURE__ */ new Map();
const repoRootsInFlight = /* @__PURE__ */ new Map();
/** Whether the directory is inside a git work tree (exit-0 `git rev-parse`).
*  Probe timeout is short: a cwd on a stalled mount must not hold the panel
*  hostage for the full command budget (issue #369). */
async function isGitRepo(cwd) {
	try {
		return (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], DISCOVERY_TIMEOUT_MS)).trim() === "true";
	} catch {
		return false;
	}
}
/** The repository top level containing `cwd` (`git rev-parse --show-toplevel`). */
async function directRepoRoot(cwd) {
	return (await runGit(cwd, ["rev-parse", "--show-toplevel"], DISCOVERY_TIMEOUT_MS)).trim();
}
/** Discover the current repository plus child repositories nested up to
*  DISCOVERY_MAX_DEPTH - 1 levels below cwd. Results are cached per cwd and
*  concurrent callers share one in-flight scan, so opening the panel (three
*  parallel git.* requests) costs a single discovery pass. */
function repoRoots(cwd) {
	const cached = repoRootsCache.get(cwd);
	if (cached !== void 0 && cached.expires > Date.now()) return Promise.resolve(cached.roots);
	const pending = repoRootsInFlight.get(cwd);
	if (pending !== void 0) return pending;
	const promise = discoverRepoRoots(cwd).then((roots) => {
		repoRootsCache.set(cwd, {
			roots,
			expires: Date.now() + DISCOVERY_CACHE_TTL_MS
		});
		repoRootsInFlight.delete(cwd);
		return roots;
	}, (error) => {
		repoRootsInFlight.delete(cwd);
		throw error;
	});
	repoRootsInFlight.set(cwd, promise);
	return promise;
}
/** Breadth-first scan below `cwd`: one `readdir` per visited directory, no
*  per-child git process (dirent `.git` presence — directory, worktree file
*  or symlink form — decides). Keeps the serial `rev-parse`-per-child storm
*  that froze the panel in #369 structurally impossible. The scan descends
*  into repositories it finds, so repos embedded inside other repos (vendored
*  checkouts that are not submodules) are discovered too. */
async function discoverRepoRoots(cwd) {
	const roots = [];
	try {
		roots.push(await directRepoRoot(cwd));
	} catch {}
	let level = [cwd];
	for (let depth = 1; depth <= DISCOVERY_MAX_DEPTH && level.length > 0; depth++) {
		const next = [];
		for (const dir of level.slice(0, DISCOVERY_LIMIT)) {
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
			let hasGit = false;
			const subdirs = [];
			for (const entry of entries) if (entry.name === ".git") {
				if (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink()) hasGit = true;
			} else if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && entry.name !== "node_modules") subdirs.push(entry.name);
			if (hasGit && dir !== cwd) {
				const resolved = await realpath(dir).catch(() => dir);
				const root = process.platform === "win32" ? resolved.replaceAll("\\", "/") : resolved;
				if (!roots.some((existing) => pathIdentity(existing) === pathIdentity(root))) roots.push(root);
			}
			for (const name of subdirs.sort((left, right) => left.localeCompare(right))) next.push(join(dir, name));
		}
		level = next;
	}
	return roots;
}
/** Resolve the selected repository, defaulting to the first discovered root. */
async function repoRoot(cwd, selected) {
	const roots = await repoRoots(cwd);
	if (roots.length === 0) throw new GitCommandError("not a git repository", "not-repo", "rev-parse");
	if (selected !== void 0) {
		const identity = pathIdentity(selected);
		const match = roots.find((root) => pathIdentity(root) === identity);
		if (match !== void 0) return match;
	}
	return roots[0];
}
/** Symbolic HEAD's real branch, including an unborn branch; rejects when detached. */
async function currentBranch(cwd) {
	return (await runGit(cwd, [
		"symbolic-ref",
		"--quiet",
		"--short",
		"HEAD"
	])).trim();
}
/** Operation markers live in THIS checkout's Git directory (not the common
* directory shared by linked worktrees). `git am` also uses rebase-apply, but
* only a rebase creates its `rebasing` marker. */
async function currentOperation(cwd) {
	const gitDir = (await runGit(cwd, ["rev-parse", "--absolute-git-dir"])).trim();
	const names = await readdir(gitDir);
	if (names.includes("rebase-merge") || names.includes("rebase-apply") && (await readdir(join(gitDir, "rebase-apply")).catch(() => [])).includes("rebasing")) return "rebase";
	return names.includes("MERGE_HEAD") ? "merge" : void 0;
}
/** Upper bound on status rows shipped to the client. Beyond this the result
*  is truncated (with `truncated: true`) so a pathological untracked set —
*  e.g. the working tree discovered under a home-directory cwd — cannot
*  freeze the browser main thread on JSON parse or list render (#369). */
const GIT_STATUS_LIMIT = 2e3;
/**
* NUL-field budget of the status read (the row cap enforced while git is
* producing, not after parsing a megabyte of untracked paths). Porcelain
* frames one field per row and TWO per rename/copy record, so the budget is
* twice the row cap: at least `GIT_STATUS_LIMIT + 1` ROWS always fit, which is
* what keeps the truncation flag honest for a rename-heavy tree, while a
* 59k-entry untracked walk is still stopped after ~200 KB instead of 9 MB.
*/
const GIT_STATUS_MAX_FIELDS = 4002;
/** Byte budget one numstat pathspec may carry (well under every platform's
*  command-line cap, so a repository with thousands of tracked modifications
*  falls back to the whole-repo diff instead of failing to spawn). */
const NUMSTAT_PATHSPEC_MAX_BYTES = 8e3;
/**
* The paths the two `--numstat` diffs of {@link status} actually have to look
* at, read from the SAME `status --porcelain=v2 -z` output:
*
*  - every reported path EXCEPT untracked ones (`??`): a file absent from the
*    index exists on neither diff side, so git can never print a numstat row
*    for it — and in the pathological case (an unignored nested
*    `node_modules`) those are 59k of the 59k paths, i.e. all of the argv;
*  - the ORIGIN path of every rename/copy record (the next NUL field): a
*    pathspec that keeps only the new name hides the pair from git's rename
*    detection, and the counts silently degrade from `0 0` to a full-file add.
*
* `[]` means "no tracked change at all": both diffs are guaranteed empty and
* the caller skips the two processes entirely. `undefined` means the set is
* too large to spell out on a command line (Windows caps one at ~32k chars) —
* the caller falls back to the unpathspec'd whole-repo diff, which is the old
* behaviour, not a wrong answer.
*/
function numstatPathsof(porcelainZ) {
	const paths = [];
	let bytes = 0;
	const add = (path) => {
		if (path === "") return true;
		bytes += Buffer.byteLength(path) + 1;
		if (bytes > NUMSTAT_PATHSPEC_MAX_BYTES) return false;
		paths.push(path);
		return true;
	};
	for (const token of porcelainV2Tokens(porcelainZ)) {
		if (token.kind !== "record" || token.xy === "??") continue;
		if (!add(token.path)) return void 0;
		if (token.origin !== void 0 && !add(token.origin)) return void 0;
	}
	return paths;
}
/**
* Working-tree status (untracked included). The read is
* `status --porcelain=v2 --branch -z --untracked-files=all`: one command
* answers the rows AND the branch identity (name, tracking ref, ahead/behind,
* detached HEAD), while preserving repository discovery and explicit
* repository selection for workspace roots. `--untracked-files=all` lists the
* contents of new directories as individual entries.
*
* The per-path line counts (#131) ride this SAME read: one batch of three git
* processes answers status and both numstat sides together, never one process
* per file, and callers keep their existing refresh cadence. A numstat failure
* costs only the counts (the rows fall back to their count-less rendering) —
* the status answer itself must never fail because of it.
*
* The porcelain read now comes FIRST, because its paths become the pathspec of
* both numstat diffs: the counts only ever ride rows the status read itself
* reports, and limiting the diffs to those paths is what keeps an unignored
* nested `node_modules` (59 631 entries / 9.24 MB of numstat) out of the two
* whole-repo walks. `--literal-pathspecs` is required: porcelain paths are
* literal file names, and without it a name like `:colon.txt` is parsed as
* pathspec magic and silently loses its counts.
*
* Each side's reading lands on its own field of the entry
* ({@link GitStatusEntry} documents why the two are never summed).
*/
async function status(cwd, selected) {
	const repositories = await repoRoots(cwd);
	if (repositories.length === 0) return {
		isRepo: false,
		entries: [],
		repositories: []
	};
	const root = await repoRoot(cwd, selected);
	const [operation, raw] = await Promise.all([currentOperation(root).catch(() => void 0), runGit(root, [
		"status",
		"--porcelain=v2",
		"--branch",
		"--ahead-behind",
		"-z",
		"--untracked-files=all"
	], void 0, { maxNulFields: GIT_STATUS_MAX_FIELDS })]);
	const snapshot = parseStatusPorcelainV2Z(raw);
	const parsed = snapshot.entries;
	const pathspec = numstatPathsof(raw);
	let unstagedNumstat = "";
	let stagedNumstat = "";
	if (pathspec === void 0 || pathspec.length > 0) {
		const literal = pathspec === void 0 ? [] : ["--literal-pathspecs"];
		const paths = pathspec === void 0 ? [] : ["--", ...pathspec];
		const [unstaged, staged] = await Promise.all([runGit(root, [
			...literal,
			"diff",
			"--numstat",
			"-z",
			...paths
		]).catch(() => ""), runGit(root, [
			...literal,
			"diff",
			"--cached",
			"--numstat",
			"-z",
			...paths
		]).catch(() => "")]);
		unstagedNumstat = unstaged;
		stagedNumstat = staged;
	}
	const stagedCounts = parseNumstat(stagedNumstat);
	const unstagedCounts = parseNumstat(unstagedNumstat);
	const truncated = parsed.length > GIT_STATUS_LIMIT;
	const bounded = truncated ? parsed.slice(0, GIT_STATUS_LIMIT) : parsed;
	return {
		...snapshot,
		operation,
		entries: bounded.map((entry) => {
			const staged = stagedCounts.get(entry.path);
			const unstaged = unstagedCounts.get(entry.path);
			if (staged === void 0 && unstaged === void 0) return entry;
			return {
				...entry,
				...staged !== void 0 ? { staged } : {},
				...unstaged !== void 0 ? { unstaged } : {}
			};
		}),
		truncated,
		root,
		repositories
	};
}
/** Platform-aware identity used only for comparing absolute checkout roots. */
function pathIdentity(path) {
	const absolute = resolve(path).replace(/[\\/]+$/, "");
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
/** Whether the current Git binary supports NUL-framed `worktree list` output.
* Git < 2.36 rejects `-z`; cache the capability after the first attempt so
* the SCM panel's polling does not repeatedly spawn a command known to fail. */
let worktreeListSupportsZ;
/** Raw usable checkout records, shared by inventory and target validation.
* Prunable records point at missing paths and are deliberately excluded from
* both the selector and the command-target allowlist. */
async function listedWorktrees(cwd) {
	let raw;
	if (worktreeListSupportsZ === false) raw = await runGit(cwd, [
		"worktree",
		"list",
		"--porcelain"
	]);
	else try {
		raw = await runGit(cwd, [
			"worktree",
			"list",
			"--porcelain",
			"-z"
		]);
		worktreeListSupportsZ = true;
	} catch {
		worktreeListSupportsZ = false;
		raw = await runGit(cwd, [
			"worktree",
			"list",
			"--porcelain"
		]);
	}
	return parseWorktreeList(raw).filter((entry) => !entry.prunable);
}
/**
* How many entries `git status` reports for one checkout, as ONE cheap command.
*
* The inventory below used to call the full `status()`, which spawns four
* processes — including the `--untracked-files=all` walk and two whole-repo
* `--numstat` diffs — just to read `.entries.length`, per linked checkout, on a
* 30 s poll. This asks the same question with a single process and without the
* untracked walk. The number differs in exactly one way, deliberately: an
* untracked DIRECTORY counts as one entry instead of as every file inside it,
* which is what "this checkout has changes" should read as anyway (and the old
* number was silently capped at `GIT_STATUS_LIMIT` regardless).
*/
async function countChanges(cwd) {
	return parsePorcelainZ(await runGit(cwd, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=normal"
	])).length;
}
/** All linked checkouts of the repository containing `cwd`, enriched with a
* live change count. The current checkout is first so a single-worktree repo
* preserves the old UI ordering. */
async function worktrees(cwd) {
	if (!await isGitRepo(cwd)) return [];
	const currentRoot = await repoRoot(cwd);
	const listed = await listedWorktrees(cwd);
	return (await Promise.all(listed.map(async (entry) => ({
		path: entry.path,
		branch: entry.branch,
		current: pathIdentity(entry.path) === pathIdentity(currentRoot),
		changes: await countChanges(entry.path).catch(() => 0)
	})))).sort((left, right) => Number(right.current) - Number(left.current));
}
/** Resolve an optional client-selected linked checkout. A caller may never use
* this seam to point Git operations at an unrelated repository: the target
* must occur in the authoritative session repository's worktree list. */
async function resolveWorktree(cwd, requested) {
	if (requested === void 0 || requested === "") return cwd;
	const identity = pathIdentity(requested);
	const match = (await listedWorktrees(cwd)).find((entry) => pathIdentity(entry.path) === identity);
	if (match === void 0) throw new GitCommandError(`unknown linked worktree: ${requested}`, "git-worktree", "worktree list");
	return match.path;
}
/** Diff text of the worktree (unstaged) or the index (staged). */
async function diff(cwd, path, staged, selected) {
	const root = await repoRoot(cwd, selected);
	const args = [
		"diff",
		"--no-ext-diff",
		"--no-color",
		"-U3"
	];
	if (staged) args.push("--cached");
	if (path !== void 0) args.push("--", path);
	return runGit(root, args);
}
/**
* Diff text of the worktree against HEAD — staged and unstaged changes in
* ONE patch, which is what "uncommitted changes" means for the editor's
* change gutter (the two-sided `diff()` above would each miss half of a file
* that is partly staged). A repository whose HEAD is not born yet cannot
* answer `diff HEAD`, so that one failure falls back to `diff --cached`
* (index against the empty tree — the unborn-HEAD shape of the same
* question). Untracked files never appear in either: the caller marks them
* from the status store instead.
*/
async function diffHead(cwd, path, selected) {
	const root = await repoRoot(cwd, selected);
	const tail = path !== void 0 ? ["--", path] : [];
	try {
		return await runGit(root, [
			"diff",
			"--no-ext-diff",
			"--no-color",
			"-U3",
			"HEAD",
			...tail
		]);
	} catch {
		return runGit(root, [
			"diff",
			"--no-ext-diff",
			"--no-color",
			"-U3",
			"--cached",
			...tail
		]);
	}
}
/** Stage paths (all when path is undefined). */
async function stage(cwd, path, selected) {
	await runGit(await repoRoot(cwd, selected), [
		"add",
		"-A",
		...path !== void 0 ? ["--", path] : []
	]);
}
/** Unstage paths (all when path is undefined). */
async function unstage(cwd, path, selected) {
	await runGit(await repoRoot(cwd, selected), [
		"reset",
		"-q",
		...path !== void 0 ? ["--", path] : []
	]);
}
/** Commit the staged changes with a message (global identity untouched). */
async function commit(cwd, message, selected) {
	await runGit(await repoRoot(cwd, selected), [
		"commit",
		"-m",
		message
	]);
}
/** Branch names (current first). */
async function branches(cwd, selected) {
	const root = await repoRoot(cwd, selected);
	const [current, raw] = await Promise.all([currentBranch(root).catch(() => ""), runGit(root, [
		"for-each-ref",
		"--format=%(refname:short)",
		"refs/heads"
	])]);
	const names = raw.split("\n").filter((line) => line !== "");
	return {
		current,
		names: current !== "" && !names.includes(current) ? [current, ...names] : names
	};
}
/** Switch to an existing branch.
*  `--end-of-options` precedes the operand: without it a caller-supplied
*  branch beginning with `-` is parsed as an OPTION, so `-f` force-discarded
*  the worktree changes and `--work-tree=…` redirected the checkout. Same
*  guard as show / commitDiff / revert / cherryPick (4100e16). */
async function checkout(cwd, branch, selected) {
	await runGit(await repoRoot(cwd, selected), [
		"checkout",
		"--end-of-options",
		branch
	]);
}
/** All refs plus HEAD in child-before-parent order for graph lanes, pageable
* via skip/count. `--all` also permits an empty history on an unborn HEAD. */
async function log(cwd, count = 30, skip = 0, selected) {
	return parseLogLines(await runGit(await repoRoot(cwd, selected), [
		"log",
		"--all",
		"--topo-order",
		"-n",
		String(count),
		"--skip",
		String(skip),
		"--decorate=short",
		"--pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D%x1f%P"
	]));
}
/**
* Content of a file at a revision (`git show <rev>:<path>`), or null when the
* revision has no such path (a new/untracked file has no HEAD side).
*
* `--end-of-options` precedes the operand: without it a caller-supplied `rev`
* beginning with `-` is parsed as an OPTION rather than a revision, so
* `rev: "--output=NUL"` silently wrote to a file and returned empty instead of
* failing (the Changes tab's diff/blame panes then rendered blank). The
* sentinel ends option parsing, so the operand can never be a flag while every
* legitimate revision form still works (`HEAD`, `:0`, `<hash>^`, `HEAD~2`,
* `origin/main`, any branch name).
*/
async function show(cwd, rev, path, selected) {
	try {
		return await runGit(await repoRoot(cwd, selected), [
			"show",
			"--end-of-options",
			`${rev}:${path}`
		]);
	} catch {
		return null;
	}
}
/** Full patch text of one commit (`git show` with the commit header suppressed).
*  Merge commits show their diff against the first parent (`-m --first-parent`
*  is a no-op for regular commits), so a history click always has content.
*  `--end-of-options` keeps a caller-supplied hash from parsing as an option. */
async function commitDiff(cwd, hash, selected) {
	return runGit(await repoRoot(cwd, selected), [
		"show",
		"--no-ext-diff",
		"--no-color",
		"--format=",
		"-m",
		"--first-parent",
		"--end-of-options",
		hash
	]);
}
/** Discard the worktree changes of one path (`git checkout -- <path>`; the index is untouched). */
async function discard(cwd, path, selected) {
	await runGit(await repoRoot(cwd, selected), [
		"checkout",
		"--",
		path
	]);
}
/** Revert one commit onto the current branch with an auto-generated message.
*  `--end-of-options` keeps a caller-supplied hash from parsing as an option. */
async function revert(cwd, hash, selected) {
	await runGit(await repoRoot(cwd, selected), [
		"revert",
		"--no-edit",
		"--end-of-options",
		hash
	]);
}
/** Cherry-pick one commit onto the current branch.
*  `--end-of-options` keeps a caller-supplied hash from parsing as an option. */
async function cherryPick(cwd, hash, selected) {
	await runGit(await repoRoot(cwd, selected), [
		"cherry-pick",
		"--end-of-options",
		hash
	]);
}
/** Push the current branch to its upstream (`git push`). A branch without a
*  tracking remote fails loudly with git's own message — the panel shows it and
*  the user fixes the tracking in a terminal. No operands, so there is nothing
*  for a caller-supplied value to smuggle in as an option. */
async function push(cwd, selected) {
	await runGit(await repoRoot(cwd, selected), ["push"]);
}
/** Pull upstream changes into the current branch (`git pull --ff-only`).
*  Fast-forward-only keeps a headless panel out of merge/conflict editors: a
*  diverged branch fails with git's own message instead of opening an
*  interactive merge, so the user resolves it in a terminal. */
async function pull(cwd, selected) {
	await runGit(await repoRoot(cwd, selected), ["pull", "--ff-only"]);
}
//#endregion
//#region src/wire.ts
/** One API failure with its wire code and HTTP status. */
var SidebarError = class extends Error {
	code;
	status;
	meta;
	constructor(code, message, status = 400, meta) {
		super(message);
		this.code = code;
		this.status = status;
		this.meta = meta;
	}
};
/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20;
/** Read and parse the JSON request body (bounded; malformed → bad-request). */
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new SidebarError("bad-request", "request body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new SidebarError("bad-request", "request body is not valid JSON");
	}
}
/**
* Read a raw text request body (the editor save route).
*
* JSON framing was what capped a save at {@link MAX_BODY_BYTES}: the whole
* document had to be string-escaped into one JSON payload, so a file the
* editor could legitimately open could not be written back. The save route
* therefore takes the document as the raw body.
*
* `limit` is a server-side sanity guard rather than a product limit — the UI
* cannot produce more than the editable size — because the encoding transform
* the caller runs afterwards needs the document as one string.
*
* @param req - the request face (async-iterable body).
* @param limit - maximum accepted body size in bytes.
* @returns the body decoded as UTF-8.
* @throws {SidebarError} too-large beyond the limit, bad-request on invalid UTF-8.
*/
async function readTextBody(req, limit) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		total += buffer.length;
		if (total > limit) throw new SidebarError("too-large", `request body exceeds the ${limit} byte limit`, 413);
		chunks.push(buffer);
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
	} catch {
		throw new SidebarError("bad-request", "request body is not valid UTF-8");
	}
}
/** Write a JSON response with the given status. */ function writeJson(res, status, body) {
	if (res.headersSent === true) {
		res.destroy?.();
		return;
	}
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}
/** Write the success envelope. */
function writeOk(res, value) {
	writeJson(res, 200, {
		ok: true,
		value
	});
}
/** Write the failure envelope for any thrown value (unknown → internal 500). */
function writeError(res, error) {
	if (error instanceof SidebarError) {
		writeJson(res, error.status, {
			ok: false,
			error: {
				code: error.code,
				message: error.message
			}
		});
		return;
	}
	if (error instanceof GitCommandError) {
		const notRepo = error.code === "not-repo";
		writeJson(res, notRepo ? 409 : 400, {
			ok: false,
			error: {
				code: notRepo ? "not-repo" : "git-error",
				message: error.message
			}
		});
		return;
	}
	writeJson(res, 500, {
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error)
		}
	});
}
/** Narrow an unknown payload value to a string, else throw bad-request. */
function requireString(payload, key) {
	const value = payload?.[key];
	if (typeof value !== "string" || value === "") throw new SidebarError("bad-request", `missing or invalid "${key}"`);
	return value;
}
//#endregion
//#region src/fs-tree.ts
/**
* Single-level directory listing for the sidebar explorer.
*
* The hot path here IS the explorer's latency budget, so the implementation is
* deliberately allocation-shy: one `readdir(withFileTypes)` call (no
* `opendir` stream), rows built only for the capped slice, paths composed by
* string concatenation, and a hand-rolled case-insensitive sort (see
* {@link compareEntries} — `localeCompare` alone costs ~15ms/10k rows, ~40x
* the whole listing budget). A short TTL cache ({@link DIRECTORY_CACHE_TTL_MS})
* absorbs the repeat listings a tree view makes on every re-render.
*
* Row semantics are unchanged: directories first, case-insensitive name order
* with a deterministic tie-break, POSIX-hidden entries flagged for dimming,
* symlinks stat'ed once so a link to a directory expands like a directory and
* a dangling one is flagged broken. Directory rows additionally get one
* bounded read of their own level to mark singleton-dir chains (`compact`)
* for the explorer's breadcrumb folding.
*/
/**
* Directory-first, case-insensitive name ordering (VSCode explorer order).
*
* `toLowerCase()` + code-point comparison instead of `localeCompare`: measured
* at ~0.35ms/10k rows against ~14.6ms for the collator, and the tie-break on
* the ORIGINAL name keeps the order total and deterministic for names that
* only differ in case (`A` before `a`).
*/
function compareEntries(a, b) {
	if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
	const la = a.name.toLowerCase();
	const lb = b.name.toLowerCase();
	if (la !== lb) return la < lb ? -1 : 1;
	if (a.name === b.name) return 0;
	return a.name < b.name ? -1 : 1;
}
/** How many symlink target stats run in flight during one level listing. */
const SYMLINK_PROBE_CONCURRENCY = 32;
/**
* The level cache, keyed by `"<absoluteDir>\0<cap>\0<excludeKey>"`.
*
* Keyed by ABSOLUTE PATH, not by session: a listing is a pure function of the
* path plus the cap AND the exclude pattern set, and its rows already carry
* absolute paths, so sharing an entry between two sessions that read the same
* directory is correct (and desirable — one directory read serves both).
* Nothing session-scoped is stored, so no session's data can leak into
* another's listing.
*
* The exclude set is part of the key, never ambient host state: a listing
* filtered by one pattern list must never be served to a request carrying
* another (the user's edit must show up on the next read, and the pattern list
* travels WITH the request — see {@link ExcludeMatcher.key}).
*/
const directoryCache = /* @__PURE__ */ new Map();
/** Cache key of one level read. */
function cacheKey(path, maxEntries, exclude) {
	return `${path}\0${maxEntries}\0${exclude?.key ?? ""}`;
}
/**
* Drop the cached level(s) for one directory (and, when called with no
* argument, everything). Writers call this after any mutation: `fs.write`,
* `fs.rename`, `fs.remove`, `fs.mkdir`, the upload route and the fs-watch
* notifier all funnel here, so a stale level is never served past the write
* that changed it.
* @param path - absolute (or session-relative) directory to invalidate; absent
*  clears the whole cache.
*/
function invalidateDirectoryCache(path) {
	if (path === void 0) {
		directoryCache.clear();
		return;
	}
	const prefix = `${resolve(path)}\0`;
	for (const key of directoryCache.keys()) if (key.startsWith(prefix)) directoryCache.delete(key);
}
/** Max entries tracked in the TTL cache before the oldest are evicted. */
const DIRECTORY_CACHE_MAX = 512;
/** Read one level through the cache when it is fresh. */
async function listDirectoryCached(path, maxEntries, exclude, gate) {
	const key = cacheKey(path, maxEntries, exclude);
	const now = Date.now();
	const hit = directoryCache.get(key);
	if (hit !== void 0 && now - hit.at < 1500) return hit.listing;
	const listing = await readDirectory(path, maxEntries, exclude, gate);
	if (directoryCache.size >= DIRECTORY_CACHE_MAX) {
		const oldest = directoryCache.keys().next().value;
		if (oldest !== void 0) directoryCache.delete(oldest);
	}
	directoryCache.set(key, {
		at: now,
		listing
	});
	return listing;
}
/**
* List one directory level (cached for {@link DIRECTORY_CACHE_TTL_MS}).
* @param path - absolute directory path.
* @param maxEntries - row bound of one level (extra rows flag `truncated`).
* @param exclude - compiled exclude-pattern probe (the explorerExclude pref):
*  matched entries are dropped from the listing AND the singleton fold probe,
*  so they never render nor block a breadcrumb fold.
* @param gate - optional shared probe budget; a batch listing many levels
*  passes ONE gate ({@link createProbeGate}) so the per-level probe bounds do
*  not multiply. Cache hits never touch it.
* @returns the sorted listing.
* @throws {SidebarError} fs-error when the level is unreadable or not a directory.
*/
async function listDirectory(path, maxEntries = 1e3, exclude, gate) {
	return await listDirectoryCached(path, maxEntries, exclude, gate);
}
/** Read one level straight from the filesystem (the cache's slow path). */
async function readDirectory(path, maxEntries, exclude, gate) {
	let dirents;
	try {
		dirents = await readdir(path, { withFileTypes: true });
	} catch (error) {
		throw new SidebarError("fs-error", `cannot list "${path}": ${messageOf(error)}`, 400);
	}
	const prefix = path.endsWith(sep) ? path : `${path}${sep}`;
	const visible = exclude === void 0 ? dirents : dirents.filter((dirent) => !exclude(`${prefix}${dirent.name}`, dirent.name));
	const truncated = visible.length > maxEntries;
	const kept = truncated ? visible.slice(0, maxEntries) : visible;
	const rows = new Array(kept.length);
	for (let index = 0; index < kept.length; index += 1) {
		const dirent = kept[index];
		rows[index] = {
			name: dirent.name,
			path: `${prefix}${dirent.name}`,
			isDir: dirent.isDirectory(),
			isSymlink: dirent.isSymbolicLink(),
			broken: false,
			hidden: dirent.name.startsWith(".")
		};
	}
	await probeSymlinkTargets(rows, gate);
	if (!truncated) await probeCompactRows(rows, exclude, gate);
	rows.sort(compareEntries);
	return {
		path,
		entries: rows,
		truncated
	};
}
/**
* Create the probe gate one listing request shares across its levels.
* @param limit - maximum probes in flight; below 1 is clamped to 1.
* @returns the gate.
*/
function createProbeGate(limit = 32) {
	const max = Math.max(1, Math.floor(limit));
	let active = 0;
	const waiting = [];
	const acquire = () => new Promise((resolve) => {
		if (active < max) {
			active += 1;
			resolve();
			return;
		}
		waiting.push(() => {
			active += 1;
			resolve();
		});
	});
	const release = () => {
		active -= 1;
		waiting.shift()?.();
	};
	return { async run(task) {
		await acquire();
		try {
			return await task();
		} finally {
			release();
		}
	} };
}
/**
* Visit every row with at most `concurrency` visitors in flight, in row order.
* Both probes below spend one await per row (a network stat, an opendir) on a
* level that can hold thousands of rows, so the bound has to exist — and be
* shared, or the two probes drift into two different ones.
*/
async function forEachRow(rows, concurrency, visit) {
	let next = 0;
	const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
		for (;;) {
			const index = next;
			next += 1;
			if (index >= rows.length) return;
			await visit(rows[index]);
		}
	});
	await Promise.all(workers);
}
/**
* Run one FILESYSTEM probe under the request's budget.
*
* The slot is taken here, around the syscall, not around the row visit: a row
* the visitor skips without touching the filesystem must not spend budget.
* @param gate - the request's gate, or absent for an unbounded probe.
* @param task - the probe operation.
* @returns the probe's own result.
*/
function runProbe(gate, task) {
	return gate === void 0 ? task() : gate.run(task);
}
/** Probe each symlink row's target once (bounded concurrency, order-preserving). */
async function probeSymlinkTargets(rows, gate, concurrency = SYMLINK_PROBE_CONCURRENCY) {
	await forEachRow(rows, concurrency, async (row) => {
		if (!row.isSymlink) return;
		const info = await runProbe(gate, () => stat(row.path)).catch(() => void 0);
		row.isDir = info !== void 0 ? info.isDirectory() : row.isDir;
		row.broken = info === void 0;
	});
}
/** How many compact probes run in flight during one level listing. */
const COMPACT_PROBE_CONCURRENCY = 32;
/**
* How many children of ONE level are probed for the singleton fold mark.
*
* Folding is decorative — it decides whether a row renders as `a/b/c` instead
* of three rows — so a wide level must not pay one `opendir` per directory row:
* a cold listing of a 100-directory level issued 100 syscalls to decorate rows
* the user may never look at. Past this many ELIGIBLE directory rows the
* remaining rows are simply left unmarked (an un-folded listing), in row order.
*/
const COMPACT_PROBE_MAX = 32;
/**
* Mark each directory row whose contents are EXACTLY one non-symlink child
* (`compact`), so the explorer can fold singleton chains into one breadcrumb
* row. The terminal link (sole FILE child) is marked too: the client
* preloads marked levels to stabilize the fold label before expansion.
* Bounded concurrency like the symlink probe: each probe is one opendir + up
* to two dirent reads, so a directory-heavy level stays responsive. A shared
* {@link ProbeGate} also keeps a whole batch's levels within one probe budget,
* and at most {@link COMPACT_PROBE_MAX} rows of one level are probed at all.
* Probe failures (unreadable child level) leave the row unmarked — it simply
* does not fold.
*/
async function probeCompactRows(rows, exclude, gate, concurrency = COMPACT_PROBE_CONCURRENCY) {
	let probed = 0;
	await forEachRow(rows, concurrency, async (row) => {
		if (!row.isDir || row.broken) return;
		if (probed >= COMPACT_PROBE_MAX) return;
		probed += 1;
		if (await runProbe(gate, () => hasSingletonChild(row.path, exclude))) row.compact = true;
	});
}
/**
* Whether `dir` holds exactly one EFFECTIVE entry (POSIX-hidden entries —
* dot-prefixed, e.g. macOS's `.DS_Store` — don't count, and neither do
* entries the user's exclude list removes) and that entry is NOT a symlink.
* Symlink children never qualify: the client's fold chain follows `compact`
* links eagerly, and a self-referential link would otherwise fold forever.
* Hidden/excluded entries never qualify either: the client walks chains
* with the same filters, so a fold never hides a visible row — the user's
* "show hidden files" switch only affects rendering, never the fold itself.
*/
async function hasSingletonChild(dir, exclude) {
	let level;
	try {
		level = await opendir(dir);
		let only = null;
		for (;;) {
			const entry = await level.read();
			if (entry === null) break;
			if (entry.name.startsWith(".")) continue;
			if (exclude !== void 0 && exclude(`${dir}${sep}${entry.name}`, entry.name)) continue;
			if (only !== null) return false;
			only = entry;
		}
		return only !== null && !only.isSymbolicLink();
	} catch {
		return false;
	} finally {
		await level?.close().catch(() => void 0);
	}
}
/** The root row label of a listing: the last path segment (or the full path at the filesystem root). */
function rootLabel(path) {
	const base = basename(path);
	return base !== "" ? base : path;
}
/** Parent of a path, or undefined at the filesystem root (the explorer's "up" target). */
function parentOf(path) {
	const parent = dirname(path);
	return parent === path ? void 0 : parent;
}
/**
* Normalize a caller-supplied path to an absolute, resolved path or throw
* fs-error. `path.isAbsolute()` is the OS's own notion of absolute: POSIX
* roots (`/...`), Windows drive letters (`C:\...`) and — on win32 — UNC
* network shares (`\\server\share\...`); drive-relative forms (`C:foo`)
* stay rejected.
*/
function requireAbsolute(path) {
	if (!isAbsolute(path)) throw new SidebarError("fs-error", `"${path}" is not an absolute path`, 400);
	return resolve(path);
}
/** Message text of an unknown thrown value. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/session-path.ts
/** `\\wsl.localhost\<distro>` root of a Windows-hosted WSL workspace. */
const WSL_LOCALHOST_ROOT = /^\\\\wsl\.localhost\\([^\\]+)(?:\\|$)/i;
/**
* `<...>\.dsh\remote-workspaces\<host-key>\<workspace>` mirror root of a
* dsh-remote session. The captured group is the mirror root itself: the
* local directory that mirrors one remote workspace.
*/
const REMOTE_MIRROR_ROOT = /^(.*\\\.dsh\\remote-workspaces\\[^\\]+\\[^\\]+)(?:\\|$)/i;
/** Metadata file dsh-remote writes at the root of every mirror directory. */
const REMOTE_META_FILE = ".dsh-remote-meta.json";
/**
* Mirror metadata cache. `resolveSessionPath` is synchronous and sits on
* every filesystem request, so the metadata is read synchronously and
* memoized per mirror root; an mtime change re-reads it.
*/
const remoteMetaCache = /* @__PURE__ */ new Map();
/**
* The remote workspace path a mirror root stands for, or undefined when the
* directory carries no usable metadata. Failures are swallowed on purpose:
* an unreadable or malformed meta file must leave the caller's path alone
* rather than break the request.
*/
function remotePathOf(mirrorRoot) {
	const metaFile = win32.join(mirrorRoot, REMOTE_META_FILE);
	let mtimeMs;
	try {
		mtimeMs = statSync(metaFile).mtimeMs;
	} catch {
		remoteMetaCache.delete(mirrorRoot);
		return;
	}
	const cached = remoteMetaCache.get(mirrorRoot);
	if (cached !== void 0 && cached.mtimeMs === mtimeMs) return cached.remotePath;
	let remotePath;
	try {
		const value = JSON.parse(readFileSync(metaFile, "utf8"))?.remotePath;
		remotePath = typeof value === "string" && value.startsWith("/") ? value : void 0;
	} catch {
		remotePath = void 0;
	}
	remoteMetaCache.set(mirrorRoot, {
		mtimeMs,
		remotePath
	});
	return remotePath;
}
/**
* The POSIX path segments of `target` relative to `base`, or undefined when
* `target` does not lie under `base`. Both are remote (POSIX) paths, so the
* comparison is case-SENSITIVE and separator handling is plain '/'.
*/
function relativeUnderPosix(base, target) {
	const normalize = (value) => value.replace(/\/+$/, "");
	const root = normalize(base);
	if (target === root) return "";
	if (!target.startsWith(`${root}/`)) return void 0;
	return target.slice(root.length + 1);
}
/**
* Reinterpret an already-absolute path in the namespace of one session.
*
* Windows treats `/foo` as rooted on the current drive, so `path.resolve()`
* turns it into e.g. `C:\\foo`. That is wrong for a session whose cwd is a
* WSL UNC path: in that namespace `/foo` means the distro's Linux `/foo`.
* It is equally wrong for a dsh-remote mirror session, whose cwd is a local
* directory (`...\\.dsh\\remote-workspaces\\<host>\\<workspace>`) standing in
* for a remote POSIX workspace: there `/srv/app/src/a.ts` means the mirrored
* file, not `C:\\srv\\app\\src\\a.ts` (which does not exist — the symptom is
* `ENOENT ... realpath 'C:\\Users\\...'`).
*
* Project only those unambiguous combinations onto the matching root; drive
* paths, UNC paths, ordinary Windows sessions and non-Windows hosts keep
* their existing semantics.
*
* What happens AFTER projection is the caller's business (the old workspace
* fence is gone; `resolveTarget` only normalizes). The important part for a
* WSL session is that `/tmp/x` is read as WSL `/tmp/x`, not silently
* redirected to `C:\\tmp\\x`. For a mirror session a remote path OUTSIDE the
* mirrored workspace (e.g. `/etc/hosts`) is deliberately left unprojected:
* it stays slash-rooted, `resolve()` then drive-roots it and the request
* fails as a missing local file — it is never mapped onto an unrelated file
* inside the mirror.
*/
function resolveSessionPath(cwd, target, platform = process.platform) {
	if (platform !== "win32" || !/^\/(?!\/)/.test(target)) return target;
	const normalizedCwd = cwd.replace(/\//g, "\\");
	const wsl = WSL_LOCALHOST_ROOT.exec(normalizedCwd);
	if (wsl !== null) {
		const distroRoot = `\\\\wsl.localhost\\${wsl[1]}`;
		const relative = target.slice(1).replace(/\//g, "\\");
		return win32.resolve(distroRoot, relative);
	}
	const mirror = REMOTE_MIRROR_ROOT.exec(normalizedCwd);
	if (mirror !== null) {
		const mirrorRoot = mirror[1];
		const remotePath = remotePathOf(mirrorRoot);
		if (remotePath !== void 0) {
			const relative = relativeUnderPosix(remotePath, target);
			if (relative !== void 0) return relative === "" ? win32.resolve(mirrorRoot) : win32.resolve(mirrorRoot, relative.replace(/\//g, "\\"));
		}
	}
	return target;
}
//#endregion
//#region src/path-security.ts
/**
* Lexical path resolution for the sidebar's filesystem routes.
*
* ⚠️ **This module no longer enforces workspace containment.** It used to
* canonicalize through `realpath` and reject anything outside the session
* workspace; the user asked for that guard to be removed, so the sidebar fs
* routes now reach any path the HOST USER can reach, bounded only by OS
* permissions (and by the browser-trust fence on the routes themselves).
*
* What remains is the part every caller still needs: turn the client's
* (possibly session-relative) target into one absolute, lexically-normalized
* path. `resolveSessionPath` joins it under the session cwd, `resolve()`
* collapses `.` / `..` segments, and {@link requireAbsolute} rejects
* non-absolute input. No `realpath`, no `isWithin`, no 403.
*
* Kept as one module (and the old names kept) so the call sites read the same
* way they did with the fence: the change is the SEMANTICS — "resolve" rather
* than "guard".
*/
/**
* Resolve an existing path to one absolute, lexically-normalized target.
*
* @param cwd - Session workspace directory (the base of relative targets).
* @param target - Client-supplied absolute or session-relative path.
* @param _fence - IGNORED. Kept as a positional parameter so every call site
*  (and the route tests) did not have to change shape in the same commit; the
*  containment decision it used to carry is gone for good. New code should
*  omit it.
* @returns The absolute path used for the filesystem operation.
* @deprecated The name is historical — this is now plain resolution. Use
*  {@link resolveTarget} in new code.
*/
async function ensureWorkspacePath(cwd, target, _fence) {
	return resolveTarget(cwd, target);
}
/**
* Resolve a path for a WRITE destination (which may not exist yet).
*
* Lexical only, exactly like {@link ensureWorkspacePath}: a missing target is
* returned as the caller composed it (its parent is created on demand), and an
* existing symlink in the path is NOT resolved — the caller writes through it,
* which is what "no containment policy" means.
*
* @param cwd - Session workspace directory (the base of relative targets).
* @param target - Client-supplied absolute or session-relative path.
* @param _fence - IGNORED (see {@link ensureWorkspacePath}).
* @returns The absolute destination path.
* @deprecated The name is historical — this is now plain resolution.
*/
async function ensureWorkspaceWritePath(cwd, target, _fence) {
	return resolveTarget(cwd, target);
}
/**
* The single resolution primitive: session-relative targets resolve under the
* session cwd, absolute targets stay absolute, and the result is `resolve()`d
* (lexical `..` collapse). Throws fs-error for a non-absolute result.
*/
function resolveTarget(cwd, target) {
	const homeExpanded = target === "~" || target.startsWith("~/") || target.startsWith("~\\") ? join(homedir(), target.slice(1)) : target;
	return requireAbsolute(resolveSessionPath(cwd, isAbsolute(homeExpanded) ? homeExpanded : join(cwd, homeExpanded)));
}
//#endregion
//#region src/text-encoding.ts
/**
* Text encoding detection/round-trip helpers for the host filesystem API.
*
* The editor transports JavaScript strings, but Windows script/config files
* are still commonly stored as the active ANSI code page (CP936/GBK) or
* UTF-16. Detect before decoding and re-detect the on-disk file before save
* so editing never silently converts an existing file to UTF-8.
*/
const UTF8_BOM = Buffer.from([
	239,
	187,
	191
]);
const UTF16LE_BOM = Buffer.from([255, 254]);
const UTF16BE_BOM = Buffer.from([254, 255]);
const UTF32LE_BOM = Buffer.from([
	255,
	254,
	0,
	0
]);
const UTF32BE_BOM = Buffer.from([
	0,
	0,
	254,
	255
]);
const ENCODING_SNIFF_LIMIT = 65536;
/** Sample the line-ending vote reads (characters, not bytes). Same window as
*  the host backend's `detectLineEndings`, so the plugin and the host reach the
*  same verdict about the same file. */
const EOL_SNIFF_LIMIT = 4096;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const GBK_DECODER = new TextDecoder("gbk", { fatal: true });
const GB18030_DECODER = new TextDecoder("gb18030", { fatal: true });
const GB18030_LOOSE_DECODER = new TextDecoder("gb18030");
const GB18030_POINTERS = 1587600;
function startsWith(bytes, prefix) {
	if (bytes.length < prefix.length) return false;
	for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
	return true;
}
function decodeUtf16(bytes, littleEndian) {
	const length = bytes.length - bytes.length % 2;
	const body = Buffer.from(bytes.subarray(0, length));
	if (!littleEndian) body.swap16();
	return body.toString("utf16le");
}
function encodeUtf16(text, littleEndian) {
	const body = Buffer.from(text, "utf16le");
	if (!littleEndian) body.swap16();
	return body;
}
function decodeUtf32(bytes, littleEndian) {
	const length = bytes.length - bytes.length % 4;
	let content = "";
	for (let offset = 0; offset < length; offset += 4) {
		const codePoint = littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
		content += codePoint <= 1114111 && !(codePoint >= 55296 && codePoint <= 57343) ? String.fromCodePoint(codePoint) : "�";
	}
	return content;
}
function encodeUtf32(text, littleEndian) {
	const codePoints = [...text].map((char) => char.codePointAt(0) ?? 65533);
	const body = Buffer.allocUnsafe(codePoints.length * 4);
	codePoints.forEach((codePoint, index) => {
		if (littleEndian) body.writeUInt32LE(codePoint, index * 4);
		else body.writeUInt32BE(codePoint, index * 4);
	});
	return body;
}
/**
* Whether one UTF-16 code unit is plausible as TEXT: tab / LF / CR, printable
* ASCII, or anything from U+00A0 up (letters, CJK, full-width punctuation)
* outside the surrogate range and the U+FFFE/FFFF tail. C0 controls other than
* whitespace, DEL and the whole C1 block never appear in text, while a 16-bit
* number stream spends a large share of its units exactly there.
*/
function isUtf16TextUnit(unit) {
	if (unit === 9 || unit === 10 || unit === 13) return true;
	if (unit >= 32 && unit <= 126) return true;
	if (unit >= 160 && unit <= 55295) return true;
	return unit >= 57344 && unit <= 65533;
}
/**
* Whether the lane sample reads as text in the given byte order: at least 90%
* of its code units must be text units ({@link isUtf16TextUnit}). A low
* amplitude 16-bit table sits far below that, real script/config text at or
* near 100%.
* @param bytes - the buffer (only the lane sample is read).
* @param pairs - how many code units to judge (the caller's lane window).
* @param littleEndian - the byte order of the candidate lane.
*/
function looksLikeUtf16Text(bytes, pairs, littleEndian) {
	if (pairs === 0) return false;
	let text = 0;
	for (let index = 0; index < pairs; index += 1) if (isUtf16TextUnit(littleEndian ? bytes[index * 2] | bytes[index * 2 + 1] << 8 : bytes[index * 2] << 8 | bytes[index * 2 + 1])) text += 1;
	return text * 10 >= pairs * 9;
}
/**
* Detect BOM-less UTF-16 from the NUL-byte lane typical of scripts/config.
*
* The lane alone is NOT enough: a raw 16-bit little-endian stream (a sample
* table, an audio buffer) leaves the high byte 0 for every value below 256 and
* matches it exactly. Its code units then land all over the C0/C1 control
* blocks instead of text, so the candidate must also read as text
* ({@link looksLikeUtf16Text}) — otherwise a binary file opened as an editable
* buffer, and a save rewrote it as UTF-16 (dropping the trailing byte of an
* odd-length file, which `decodeUtf16` truncates in the same way).
*/
function bomlessUtf16(bytes) {
	if (bytes.length < 4) return void 0;
	const pairs = Math.min(Math.floor(bytes.length / 2), 1024);
	let evenZeros = 0;
	let oddZeros = 0;
	for (let i = 0; i < pairs; i += 1) {
		if (bytes[i * 2] === 0) evenZeros += 1;
		if (bytes[i * 2 + 1] === 0) oddZeros += 1;
	}
	const minimumZeros = Math.max(2, Math.floor(pairs * .2));
	if (oddZeros >= minimumZeros && oddZeros >= evenZeros * 4 && looksLikeUtf16Text(bytes, pairs, true)) return "utf16le";
	if (evenZeros >= minimumZeros && evenZeros >= oddZeros * 4 && looksLikeUtf16Text(bytes, pairs, false)) return "utf16be";
}
function tryDecode(decoder, bytes) {
	try {
		return decoder.decode(bytes);
	} catch {
		return;
	}
}
/** Detect the GB18030 four-byte sequences that are outside the GBK subset. */
function hasGb18030FourByteSequence(bytes) {
	for (let i = 0; i + 3 < bytes.length; i += 1) {
		const b1 = bytes[i];
		const b2 = bytes[i + 1];
		const b3 = bytes[i + 2];
		const b4 = bytes[i + 3];
		if (b1 >= 129 && b1 <= 254 && b2 >= 48 && b2 <= 57 && b3 >= 129 && b3 <= 254 && b4 >= 48 && b4 <= 57) return true;
	}
	return false;
}
/**
* Whether a fatally-undecodable buffer fails only because the cap cut a
* multi-byte character in half.
*
* A capped read (`readLimit` here, {@link ENCODING_SNIFF_LIMIT} on the save
* side) may stop anywhere, and a partial CJK sequence is exactly what the
* GB18030 decoder below accepts: two trailing bytes of a three-byte character
* decode as one legacy glyph, so a >cap UTF-8 file used to come back as
* mojibake on open and could be saved back under the wrong encoding. The
* longest UTF-8 sequence is four bytes, so at most three are missing; the tail
* is a read artifact rather than file content, which leaves the prefix — the
* only bytes actually known — to decide the encoding.
*/
function hasIncompleteUtf8Tail(bytes) {
	for (let start = Math.max(0, bytes.length - 3); start < bytes.length; start += 1) {
		const lead = bytes[start];
		const size = lead >= 240 && lead <= 244 ? 4 : lead >= 224 && lead <= 239 ? 3 : lead >= 194 && lead <= 223 ? 2 : 0;
		if (size === 0 || start + size <= bytes.length) continue;
		let incomplete = true;
		for (let i = start + 1; i < bytes.length; i += 1) {
			const trail = bytes[i];
			if (trail < 128 || trail > 191) {
				incomplete = false;
				break;
			}
		}
		if (incomplete && tryDecode(UTF8_DECODER, bytes.subarray(0, start)) !== void 0) return true;
	}
	return false;
}
/**
* Decode a text buffer, or `null` when it looks binary (NUL-bearing and not
* UTF-16/32). `truncated` says the buffer is a prefix of a larger file, which
* lets a read cap cut mid-character without flipping the detected encoding.
*/
function decodeTextBytes(bytes, truncated = false) {
	if (startsWith(bytes, UTF32LE_BOM)) return {
		content: decodeUtf32(bytes.subarray(4), true),
		encoding: "utf32le-bom"
	};
	if (startsWith(bytes, UTF32BE_BOM)) return {
		content: decodeUtf32(bytes.subarray(4), false),
		encoding: "utf32be-bom"
	};
	if (startsWith(bytes, UTF8_BOM)) return {
		content: bytes.subarray(3).toString("utf8"),
		encoding: "utf8-bom"
	};
	if (startsWith(bytes, UTF16LE_BOM)) return {
		content: decodeUtf16(bytes.subarray(2), true),
		encoding: "utf16le-bom"
	};
	if (startsWith(bytes, UTF16BE_BOM)) return {
		content: decodeUtf16(bytes.subarray(2), false),
		encoding: "utf16be-bom"
	};
	const utf16 = bomlessUtf16(bytes);
	if (utf16 !== void 0) return {
		content: decodeUtf16(bytes, utf16 === "utf16le"),
		encoding: utf16
	};
	if (bytes.includes(0)) return null;
	const utf8 = tryDecode(UTF8_DECODER, bytes);
	if (utf8 !== void 0) return {
		content: utf8,
		encoding: "utf8"
	};
	if (truncated && hasIncompleteUtf8Tail(bytes)) return {
		content: bytes.toString("utf8"),
		encoding: "utf8"
	};
	const gb18030 = tryDecode(GB18030_DECODER, bytes);
	if (gb18030 !== void 0 && hasGb18030FourByteSequence(bytes)) return {
		content: gb18030,
		encoding: "gb18030"
	};
	const gbk = tryDecode(GBK_DECODER, bytes);
	if (gbk !== void 0) return {
		content: gbk,
		encoding: "gbk"
	};
	if (gb18030 !== void 0) return {
		content: gb18030,
		encoding: "gb18030"
	};
	return {
		content: bytes.toString("utf8"),
		encoding: "utf8"
	};
}
/**
* Whether an encoding stores one character as a fixed-width code unit, and
* whether that unit is little-endian. `1` covers every byte-oriented encoding
* (UTF-8, GBK, GB18030), where a `\n` byte is unambiguous.
*/
function unitWidth(encoding) {
	if (encoding === "utf16le" || encoding === "utf16le-bom" || encoding === "utf16be" || encoding === "utf16be-bom") return 2;
	if (encoding === "utf32le-bom" || encoding === "utf32be-bom") return 4;
	return 1;
}
/**
* Whether one byte is a whole character or part of one.
*
* The paged reader needs exactly this distinction and nothing finer: a
* byte-oriented encoding can be re-sniffed per window safely (a pure-ASCII
* window of a GBK document decodes identically either way), while a wide
* encoding is a property of the FILE and must not be re-litigated by a window
* that happens to contain no NUL bytes.
*
* @param encoding - an encoding a window detected.
* @returns true for UTF-16 / UTF-32 in either byte order.
*/
function isWideEncoding(encoding) {
	return unitWidth(encoding) !== 1;
}
/** Whether a fixed-width encoding is little-endian. */
function unitLittleEndian(encoding) {
	return encoding === "utf16le" || encoding === "utf16le-bom" || encoding === "utf32le-bom";
}
/**
* The byte offset just past the LAST complete line break in `bytes`, or `-1`
* when the window holds none.
*
* A byte-oriented search would be wrong for the wide encodings: in UTF-16LE the
* low byte of U+0A41 is `0x0A`, so a naive `lastIndexOf(0x0A)` cuts a character
* in half. The search therefore only accepts a `0x0A` sitting in the unit
* position a U+000A code point would occupy — the first byte of a little-endian
* unit, the last byte of a big-endian one — and reports the end of that unit.
*
* @param bytes - the window just read.
* @param encoding - the encoding {@link decodeTextAs} will use for it.
* @returns an offset into `bytes`, or `-1` when the window has no line break.
*/
function lastLineBreakEnd(bytes, encoding) {
	const width = unitWidth(encoding);
	const littleEndian = unitLittleEndian(encoding);
	for (let index = bytes.length - 1; index >= 0; index -= 1) {
		if (bytes[index] !== 10) continue;
		if (width === 1) return index + 1;
		if ((littleEndian ? index % width : width - 1 - index % width) !== 0) continue;
		return littleEndian ? index + width : index + 1;
	}
	return -1;
}
/**
* Decode a buffer UNDER A KNOWN ENCODING, without sniffing.
*
* {@link decodeTextBytes} answers "what is this file?" from the bytes alone,
* which is the wrong question for the second page of a paged read: a page that
* happens to be pure ASCII sniffs as UTF-8 while a GBK page of the same
* document sniffs as GBK, and concatenating the two yields mojibake. The paged
* reader sniffs once and decodes every later window with this.
*
* BOM handling stays with the caller: `*-bom` encodings describe the file's
* first bytes, so a caller reading from a non-zero offset should pass the
* BOM-less spelling (see `bomlessEncoding`).
*
* @param bytes - the window to decode (already known to be text).
* @param encoding - the encoding the first window established.
* @returns the decoded text; undecodable bytes fall back to UTF-8, matching
*  {@link decodeTextBytes}'s replacement-character behavior.
*/
function decodeTextAs(bytes, encoding) {
	switch (encoding) {
		case "utf8":
		case "utf8-bom": return tryDecode(UTF8_DECODER, bytes) ?? bytes.toString("utf8");
		case "utf16le":
		case "utf16le-bom": return decodeUtf16(bytes, true);
		case "utf16be":
		case "utf16be-bom": return decodeUtf16(bytes, false);
		case "utf32le-bom": return decodeUtf32(bytes, true);
		case "utf32be-bom": return decodeUtf32(bytes, false);
		case "gbk": return tryDecode(GBK_DECODER, bytes) ?? bytes.toString("utf8");
		case "gb18030": return tryDecode(GB18030_DECODER, bytes) ?? bytes.toString("utf8");
	}
}
let gbkEncodeMap;
function getGbkEncodeMap() {
	if (gbkEncodeMap !== void 0) return gbkEncodeMap;
	const map = /* @__PURE__ */ new Map();
	for (let byte = 0; byte <= 127; byte += 1) map.set(String.fromCharCode(byte), byte);
	map.set("€", 128);
	for (let lead = 129; lead <= 254; lead += 1) for (let trail = 64; trail <= 254; trail += 1) {
		if (trail === 127) continue;
		const char = tryDecode(GBK_DECODER, Uint8Array.of(lead, trail));
		if (char !== void 0 && [...char].length === 1 && !map.has(char)) map.set(char, lead << 8 | trail);
	}
	gbkEncodeMap = map;
	return map;
}
function gb18030PointerBytes(pointer) {
	let value = pointer;
	const fourth = value % 10;
	value = Math.floor(value / 10);
	const third = value % 126;
	value = Math.floor(value / 126);
	const second = value % 10;
	value = Math.floor(value / 10);
	return [
		value + 129,
		second + 48,
		third + 129,
		fourth + 48
	];
}
const gb18030PointerCache = /* @__PURE__ */ new Map();
function resolveGb18030Pointers(chars) {
	const pending = new Set([...chars].filter((char) => !gb18030PointerCache.has(char)));
	if (pending.size === 0) return;
	const bytes = Buffer.allocUnsafe(GB18030_POINTERS * 4);
	for (let pointer = 0; pointer < GB18030_POINTERS; pointer += 1) bytes.set(gb18030PointerBytes(pointer), pointer * 4);
	const decoded = GB18030_LOOSE_DECODER.decode(bytes);
	let pointer = 0;
	for (const char of decoded) {
		if (char !== "�" && pending.has(char)) {
			gb18030PointerCache.set(char, pointer);
			pending.delete(char);
			if (pending.size === 0) break;
		}
		pointer += 1;
	}
	if (pending.size > 0) throw new RangeError(`text contains characters not representable in GB18030: ${JSON.stringify([...pending])}`);
}
function encodeLegacy(text, gb18030) {
	const map = getGbkEncodeMap();
	const chars = [...text];
	if (gb18030) resolveGb18030Pointers(new Set(chars.filter((char) => !map.has(char))));
	const bytes = [];
	for (const char of chars) {
		const gbk = map.get(char);
		if (gbk !== void 0) {
			if (gbk <= 255) bytes.push(gbk);
			else bytes.push(gbk >> 8, gbk & 255);
			continue;
		}
		if (!gb18030) throw new RangeError(`text contains a character not representable in GBK: ${JSON.stringify(char)}`);
		const pointer = gb18030PointerCache.get(char);
		if (pointer === void 0) throw new RangeError(`text contains a character not representable in GB18030: ${JSON.stringify(char)}`);
		bytes.push(...gb18030PointerBytes(pointer));
	}
	return Buffer.from(bytes);
}
function encodeText(text, encoding) {
	switch (encoding) {
		case "utf8": return Buffer.from(text, "utf8");
		case "utf8-bom": return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf8")]);
		case "utf16le": return encodeUtf16(text, true);
		case "utf16le-bom": return Buffer.concat([UTF16LE_BOM, encodeUtf16(text, true)]);
		case "utf16be": return encodeUtf16(text, false);
		case "utf16be-bom": return Buffer.concat([UTF16BE_BOM, encodeUtf16(text, false)]);
		case "utf32le-bom": return Buffer.concat([UTF32LE_BOM, encodeUtf32(text, true)]);
		case "utf32be-bom": return Buffer.concat([UTF32BE_BOM, encodeUtf32(text, false)]);
		case "gbk": return encodeLegacy(text, false);
		case "gb18030": return encodeLegacy(text, true);
	}
}
/**
* Majority vote over the leading {@link EOL_SNIFF_LIMIT} characters: CRLF wins
* only when the CRLF pairs outnumber the bare LFs. A file with a single trailing
* CRLF among many LF lines therefore reads as LF, and a `\r`-only (classic Mac)
* file reads as LF without its bytes being touched — both the same verdict the
* host backend reaches, so a plugin save and a model `edit` agree.
*/
function detectEol(text) {
	const sample = text.slice(0, EOL_SNIFF_LIMIT);
	const crlf = sample.split("\r\n").length - 1;
	return crlf > sample.split("\n").length - 1 - crlf ? "crlf" : "lf";
}
/**
* Convert the editor's LF document back to the file's own style before
* encoding. CRLF content is normalized first (unlike a naive `split('\n').join`
* this can never turn an existing pair into `\r\r\n`) — the same guard the host
* backend's `restoreLineEndings` documents. Everything else, including a lone
* `\r`, is passed through untouched.
*/
function restoreEol(text, eol) {
	if (eol === "lf") return text;
	return text.replaceAll("\r\n", "\n").split("\n").join("\r\n");
}
/**
* Detect the on-disk format a save has to round-trip: byte encoding AND line
* endings, from one sniff read. Called before the temp write on every save, so
* the editor never silently converts GBK / UTF-16 / BOM'd UTF-8 bytes — nor a
* CRLF file to LF, which for a one-line edit would land as a whole-file diff
* (#871). A missing file yields UTF-8 + LF (see the comment below).
*/
async function fileFormatOf(path) {
	let handle;
	try {
		handle = await open(path, "r");
	} catch (error) {
		if (error.code === "ENOENT") return {
			encoding: "utf8",
			eol: "lf"
		};
		throw error;
	}
	try {
		const info = await handle.stat();
		const truncated = info.size > ENCODING_SNIFF_LIMIT;
		const bytes = Buffer.alloc(Math.min(info.size, ENCODING_SNIFF_LIMIT));
		const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
		const decoded = decodeTextBytes(bytes.subarray(0, bytesRead), truncated);
		return {
			encoding: decoded?.encoding ?? "utf8",
			eol: decoded === null ? "lf" : detectEol(decoded.content)
		};
	} finally {
		await handle.close();
	}
}
//#endregion
//#region src/fs-operations.ts
/**
* File mutations for the sidebar (the upload route and the tree's renames,
* deletes and mkdirs).
*
* ⚠️ **No workspace containment any more.** The guard was removed at the
* user's request, so these operations reach whatever the HOST USER can reach.
* What is still enforced is the SHAPE of a request: the relative upload path
* is sanitized (absolute paths, '.', '..' and empty segments are refused), a
* rename/mkdir name must be one path segment, a new FILE's name is additionally
* checked against the characters and device names Windows cannot store, an
* existing destination is refused instead of clobbered, and the session
* workspace root itself is never renamable or removable. Bytes stream from the
* request body to a uniquely named temp sibling and are renamed into place, so
* a failed, aborted, or oversized upload never leaves a partial file at the
* target path.
*
* The tree's rename/delete are link-aware: they address the LEXICAL row path
* (lstat decides), so renaming or deleting a symlink row renames/unlinks the
* LINK, never its target — matching what the tree row visually names (VS Code
* semantics). Every mutation invalidates the directory cache of the level(s)
* it touched.
*/
/**
* The name SHAPE every file mutation shares: one path segment, no separators,
* no `.`/`..`. Shared by rename, mkdir and the new-file rule so the three
* entries refuse the same inputs with the same sentence.
*/
function assertSingleSegmentName(name) {
	if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\")) throw new SidebarError("bad-request", "name must be a single path segment", 400);
}
/**
* Stream `chunks` into `dir/relativePath` atomically: a uniquely named temp
* sibling receives the bytes, then is renamed over the target. The parent
* directory is created on demand (recursive), so folder uploads work before
* any level exists. The unique temp name keeps concurrent uploads to the same
* target independent (each writes and renames its own file; the last rename
* wins) and never blocks later uploads after a crashed process.
*
* There is NO size cap: the bytes flow through a bounded write stream, so a
* 100 GB upload costs the host the same memory as a 1 KB one. A failed or
* aborted upload still leaves neither a partial target nor a temp file.
*
* @throws SidebarError with a wire code for shape failures; the temp file is
* always removed on failure.
*/
async function writeWorkspaceUpload(input) {
	const { cwd, dir, relativePath, chunks } = input;
	const base = resolveTarget(cwd, dir);
	if (relativePath === "" || relativePath.startsWith("/") || relativePath.startsWith("\\")) throw new SidebarError("bad-request", "relativePath must stay below the upload directory", 400);
	const segments = relativePath.split(/[\\/]/);
	if (segments.some((part) => part === "" || part === "." || part === "..")) throw new SidebarError("bad-request", "relativePath must stay below the upload directory", 400);
	const target = join(base, ...segments);
	const safeTarget = await ensureWorkspaceWritePath(cwd, target);
	const tmp = join(dirname(safeTarget), `.${basename(safeTarget)}.dsh-upload-${randomUUID()}.tmp`);
	await mkdir(dirname(safeTarget), { recursive: true });
	const stream = createWriteStream(tmp, { flags: "wx" });
	const closed = new Promise((resolve) => {
		stream.once("close", () => resolve());
	});
	let streamError;
	stream.on("error", (error) => {
		streamError = error;
	});
	try {
		for await (const chunk of chunks) {
			const buffer = Buffer.from(chunk);
			if (!stream.write(buffer)) await once(stream, "drain");
			if (streamError !== void 0) throw streamError;
		}
		await new Promise((resolve, reject) => {
			stream.end((error) => error === void 0 || error === null ? resolve() : reject(error));
		});
		if (streamError !== void 0) throw streamError;
		await rename(tmp, safeTarget);
		const info = await stat(safeTarget);
		invalidateDirectoryCache(dirname(safeTarget));
		return {
			path: target,
			size: info.size
		};
	} catch (error) {
		stream.destroy();
		await closed.catch(() => {});
		await rm(tmp, { force: true }).catch(() => {});
		throw error;
	}
}
/**
* Write one editor document to disk, preserving the file's own byte encoding
* and line ending.
*
* Two guarantees ride together here, and both are about NOT rewriting what the
* user did not touch:
*
* - **line endings** — the client transports an LF document, so writing it
*   verbatim would turn one edited line into a whole-file diff on every CRLF
*   checkout (#871). The EOL detected at read time is restored before encoding.
* - **byte encoding** — GBK / UTF-16 / BOM'd UTF-8 files stay in their own
*   encoding instead of being rewritten as UTF-8 (#523).
*
* The write is atomic (uniquely named temp sibling + rename) and the temp file
* is removed on every failure path.
*
* @throws {SidebarError} fs-conflict (409) when `expectedMtimeMs` no longer
*  matches the file OR the file is no longer there at all, fs-error when the
*  write itself fails.
*/
async function writeWorkspaceText(input) {
	const { cwd, path, content, expectedMtimeMs } = input;
	const absolute = await ensureWorkspaceWritePath(cwd, path);
	const { encoding, eol } = await fileFormatOf(absolute);
	if (expectedMtimeMs !== void 0) {
		const current = await stat(absolute).then((info) => info.mtimeMs).catch(() => void 0);
		if (current !== expectedMtimeMs) throw new SidebarError("fs-conflict", `"${absolute}" ${current === void 0 ? `no longer exists on disk (expected mtime ${expectedMtimeMs})` : `changed on disk since it was loaded (expected mtime ${expectedMtimeMs}, found ${current})`}`, 409);
	}
	const tmp = join(dirname(absolute), `.${basename(absolute)}.dsh-sidebar-tmp-${randomUUID()}.tmp`);
	try {
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(tmp, encodeText(restoreEol(content, eol), encoding), { flag: "wx" });
		await rename(tmp, absolute);
	} catch (error) {
		await rm(tmp, { force: true }).catch(() => {});
		throw new SidebarError("fs-error", `cannot write "${absolute}": ${error instanceof Error ? error.message : String(error)}`, 400);
	}
	invalidateDirectoryCache(dirname(absolute));
	const mtimeMs = await stat(absolute).then((info) => info.mtimeMs).catch(() => void 0);
	return { ...mtimeMs !== void 0 ? { mtimeMs } : {} };
}
/**
* Resolve one existing entry for a link-aware mutation through the SHARED
* resolution contract: session-relative targets join the cwd, `~` targets
* expand against the home (#713), remote-mirror namespaces project, and
* everything lands on one absolute, lexically-normalized path (plus the
* resolved workspace root for the "never rename/remove the root" check).
* No realpath, no containment: the path exists (lstat decides) and the
* operation addresses it as written.
*/
function resolveEntry(cwd, target) {
	return {
		absolute: resolveTarget(cwd, target),
		realCwd: requireAbsolute(cwd)
	};
}
/**
* Compare two spellings the way Windows itself does: the extended-length
* prefix is not part of the name and case is free. Only reached when the
* volume cannot answer with an inode (FAT/exFAT, some network shares) — weaker
* than an identity, but never weaker than the plain string compare it
* replaced.
*/
function sameSpelling(a, b) {
	const strip = (value) => value.replace(/^\\\\\?\\/, "");
	const left = strip(a);
	const right = strip(b);
	return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
/**
* Whether `target` IS the workspace root. Comparing the two SPELLINGS is not
* enough: the resolution above is deliberately lexical (a symlink row must
* keep addressing the LINK, not its target), and one directory has many
* spellings — a case variant, a `\\?\` prefix, an 8.3 short name, a mapped
* drive. Each of them walked straight past this guard and turned "delete this
* row" into a recursive delete of the whole project. `dev`+`ino` is the
* identity the filesystem itself uses, and it does not care how the path is
* spelled — read as `bigint`, because the file id is 64-bit and a JS number
* rounds it above 2^53, at which point two unrelated entries compare equal and
* a legitimate delete is refused as "the workspace root".
*
* `lstat` (not `stat`) is deliberate, and so is the removal below using the
* same call: the question is whether THIS ENTRY is the root, so a symlink is
* its own identity, never its target's. A link pointed at the root therefore
* stays deletable — only the link goes, no recursion — which is what the
* string compare did. The spellings above, the actual way a project was lost,
* are all still refused. A target that cannot be lstat'ed (it may legitimately
* be gone) falls back to the spelling.
*/
async function isWorkspaceRoot(target, root) {
	try {
		const [entry, base] = await Promise.all([lstat(target, { bigint: true }), lstat(root, { bigint: true })]);
		if (entry.ino === 0n || base.ino === 0n) return sameSpelling(target, root);
		return entry.dev === base.dev && entry.ino === base.ino;
	} catch {
		return sameSpelling(target, root);
	}
}
/** Whether a path exists (ENOENT → false; other failures propagate). */
async function pathExists(target) {
	try {
		await access(target);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
/**
* Rename one tree row within its directory: `path` → `<parent>/<name>`.
* The new name must be a single path segment (this is rename, not move);
* an existing destination is refused (POSIX rename would clobber it
* silently); the workspace root itself is never renamable; a symlink row
* renames the link, not its target. A no-op rename (same name) succeeds
* without touching the filesystem.
*
* @throws SidebarError with a wire code for shape, existence and root
* failures.
*/
async function renameWorkspaceEntry(input) {
	const { cwd, path, name } = input;
	assertSingleSegmentName(name);
	const { absolute, realCwd } = resolveEntry(cwd, path);
	if (await isWorkspaceRoot(absolute, realCwd)) throw new SidebarError("fs-error", "cannot rename the workspace root", 400);
	if (basename(absolute) === name) return { path: absolute };
	const safeDestination = await ensureWorkspaceWritePath(cwd, join(dirname(absolute), name));
	if (await pathExists(safeDestination)) throw new SidebarError("fs-error", `"${name}" already exists`, 409);
	try {
		await rename(absolute, safeDestination);
	} catch (error) {
		throw new SidebarError("fs-error", `cannot rename "${path}" to "${name}": ${error instanceof Error ? error.message : String(error)}`, 400);
	}
	invalidateDirectoryCache(dirname(safeDestination));
	return { path: safeDestination };
}
/**
* Create one directory inside an existing tree row: `<path>/<name>`.
* The name must be a single path segment; an existing destination is refused
* (mkdir would otherwise fail with EEXIST anyway, but the explicit check
* yields the same "already exists" sentence rename uses); the parent row may
* be any directory the host user can write.
*
* @throws SidebarError with a wire code for shape and existence failures.
*/
async function mkdirWorkspaceEntry(input) {
	const { cwd, path, name } = input;
	assertSingleSegmentName(name);
	const { absolute } = resolveEntry(cwd, path);
	const destination = await ensureWorkspaceWritePath(cwd, join(absolute, name));
	if (await pathExists(destination)) throw new SidebarError("fs-error", `"${name}" already exists`, 409);
	try {
		await mkdir(destination);
	} catch (error) {
		throw new SidebarError("fs-error", `cannot create "${name}": ${error instanceof Error ? error.message : String(error)}`, 400);
	}
	invalidateDirectoryCache(absolute);
	return { path: destination };
}
/**
* Characters Windows refuses in a file NAME (control characters — U+0000 to
* U+001F — are refused beside these, see {@link firstIllegalNameChar}).
* Checked on every platform: a tree row the plugin happily creates on macOS
* must not become un-openable (or un-checkout-able) on the Windows host the
* same workspace is later opened on.
*/
const ILLEGAL_FILE_NAME_CHARS = /[<>:"|?*]/;
/**
* The first character of one file name that Windows cannot store, or undefined
* when the name is storable there. Iterating the string (not indexing it) keeps
* astral characters whole, so a valid emoji name is never mistaken for two
* illegal halves.
*/
function firstIllegalNameChar(name) {
	for (const char of name) if (ILLEGAL_FILE_NAME_CHARS.test(char) || (char.codePointAt(0) ?? 0) < 32) return char;
}
/**
* Windows device names, reserved in EVERY directory with or without an
* extension (`NUL.txt` and `NUL.tar.gz` both name the device, so the check is
* on the segment before the FIRST dot).
*/
const RESERVED_FILE_NAMES = /* @__PURE__ */ new Set([
	"con",
	"prn",
	"aux",
	"nul",
	...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
	...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);
/**
* The NEW FILE name rule: one path segment ({@link assertSingleSegmentName})
* plus the two Windows-only refusals — illegal characters and reserved device
* names. Refusing them HERE, as a shape error, is what lets the inline editor
* say which rule was broken instead of surfacing a bare `EPERM` from the
* filesystem on one platform and nothing at all on the others.
*
* @throws SidebarError with a wire code of `bad-request` for every refusal.
*/
function assertCreatableFileName(name) {
	assertSingleSegmentName(name);
	const illegal = firstIllegalNameChar(name);
	if (illegal !== void 0) throw new SidebarError("bad-request", `name contains a character that is not allowed in a file name: ${JSON.stringify(illegal)}`, 400);
	if (RESERVED_FILE_NAMES.has(name.split(".")[0].toLowerCase())) throw new SidebarError("bad-request", `"${name}" is a reserved device name on Windows`, 400);
}
/**
* Create one EMPTY file inside an existing tree row: `<path>/<name>`.
* The name must be one path segment and must survive a Windows host
* ({@link assertCreatableFileName}); an existing destination — file OR
* directory — is refused with the same "already exists" sentence rename and
* mkdir use, and is never truncated (the write itself is `wx`, so a name that
* appears between the check and the write is refused too, never clobbered);
* the parent row may be any directory the host user can write (an unwritable
* one surfaces the filesystem's own refusal text).
*
* @throws SidebarError with a wire code for shape, existence and write
* failures.
*/
async function createWorkspaceFile(input) {
	const { cwd, path, name } = input;
	assertCreatableFileName(name);
	const { absolute } = await resolveEntry(cwd, path);
	const destination = await ensureWorkspaceWritePath(cwd, join(absolute, name));
	if (await pathExists(destination)) throw new SidebarError("fs-error", `"${name}" already exists`, 409);
	try {
		await writeFile(destination, "", {
			flag: "wx",
			encoding: "utf8"
		});
	} catch (error) {
		if (error.code === "EEXIST") throw new SidebarError("fs-error", `"${name}" already exists`, 409);
		throw new SidebarError("fs-error", `cannot create "${name}": ${error instanceof Error ? error.message : String(error)}`, 400);
	}
	invalidateDirectoryCache(absolute);
	return { path: destination };
}
/**
* Delete one tree row permanently (there is no trash on the host): files are
* unlinked, directories removed recursively, a symlink row unlinks the LINK
* only (lstat decides, so a link to a directory does not recurse into its
* target). The workspace root itself is never removable.
*
* @throws SidebarError with a wire code for existence and root failures.
*/
async function removeWorkspaceEntry(input) {
	const { cwd, path } = input;
	const { absolute, realCwd } = resolveEntry(cwd, path);
	if (await isWorkspaceRoot(absolute, realCwd)) throw new SidebarError("fs-error", "cannot remove the workspace root", 400);
	try {
		if ((await lstat(absolute)).isDirectory()) await rm(absolute, { recursive: true });
		else await unlink(absolute);
	} catch (error) {
		throw new SidebarError("fs-error", `cannot remove "${path}": ${error instanceof Error ? error.message : String(error)}`, 400);
	}
	invalidateDirectoryCache(dirname(absolute));
	return { path: absolute };
}
//#endregion
//#region src/search-debug.ts
/**
* Gated debug instrumentation for the fs.search engine pipeline (host half).
* Off by default: with DSH_SEARCH_DEBUG unset nothing is logged, nothing
* touches the disk, and no console output is emitted. Setting
* `DSH_SEARCH_DEBUG=1` in the dsh web environment appends one line per
* probe/search/engine-failure to `<config-dir>/search-debug.log` and mirrors
* it to the host console.
*
* The log file lives under $DSH_HOME (the DSH config dir) when set, exactly
* like pty-deps.ts resolves it; otherwise it falls back to `~/.dsh`. A
* missing/unwritable log dir must never break a search — write errors are
* swallowed.
*
* The flag is read once at module load: toggling it requires restarting the
* host, the same as any other host-side change.
*/
const SEARCH_DEBUG = process.env.DSH_SEARCH_DEBUG === "1";
const LOG_FILE = join(process.env.DSH_HOME !== void 0 && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME : join(homedir(), ".dsh"), "search-debug.log");
/** Append one debug line (gated; no-op unless DSH_SEARCH_DEBUG=1). */
function debugLog(msg) {
	if (!SEARCH_DEBUG) return;
	try {
		appendFileSync(LOG_FILE, `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}\n`);
	} catch {}
	console.log(msg);
}
//#endregion
//#region src/search-engines.ts
/**
* Optional native search engines (fd / ripgrep) behind the editor's file-name
* search (fs.search). The probe runs lazily once per process: each candidate
* binary is verified with `--version` under a 500ms budget so a dead path is
* never used. Engine stdout streams are always capped (fd's --max-results
* included; rg is capped by killing the child).
*
* Engine output is normalized to the walk contract (see fs-search.ts):
* root-relative, '/'-separated paths, case-insensitive NAME matching, sorted
* by the caller, plus the directory/file split the client needs. fd reports
* directories natively (`--type d`); rg --files reports files only, so
* `deriveRgMatches` turns a matching path segment into the directory hit the
* walk would have reported — the one real gap left is an EMPTY directory
* whose name matches (no file path carries it, so rg cannot see it; fd and
* the walk both report it).
*
* A runtime failure disables that engine for the rest of the process (a
* broken binary must not slow every later search); the caller falls back to
* the plain walk. A timeout is NOT a failure: it means this tree was too
* large, so it must not strip every other root of the engine. Hooks are
* swappable for tests (setEngineHooks).
*/
const PROBE_TIMEOUT_MS$1 = 500;
const ENGINE_TIMEOUT_MS = 15e3;
const PATH_SEPARATOR = process.platform === "win32" ? ";" : ":";
/**
* Where DeepSeek Harness keeps its own `@vscode/ripgrep` platform package
* (`@vscode/ripgrep-<platform>-<arch>/bin/rg` — the binary the harness's
* agent-side search tools run on, so the sidebar search should prefer it
* over a random PATH rg). The roots below are PACKAGE-MANAGER ROOTS (the
* directory holding `@vscode/`), not `<root>/@deepseek-ai/dsh/node_modules`
* style dependency dirs: npm and pnpm hoist the platform package next to
* `@deepseek-ai`, not under it (verified against a real install: the
* profile tree carries `<profile>/node_modules/@vscode/ripgrep-<…>` and no
* `@deepseek-ai/dsh/node_modules` at all). Both shapes are still probed —
* a tree that did not hoist keeps the package under the CLI. Deriving "the
* node_modules that provided @deepseek-ai/dsh" from the running paths also
* covers pnpm's `.pnpm/node_modules` hoist layer for free (verified on
* fnm/pnpm: execPath `.../node/versions/v22/bin/node` walks
* `bin/node_modules` → `versions/node_modules` → … → `.pnpm/node_modules`),
* and `modulePath` (the CLI entry, `…/@deepseek-ai/dsh/lib/bin.js`) covers
* a desktop shell whose bundled tree sits next to a node it did not ship —
* a Homebrew node + this checkout's dependency tree is exactly that layout
* (verified: the candidate resolves to the bundled rg on macOS).
* Wrong guesses are cheap: every candidate goes through verify() and
* unusable ones are dropped.
*
* Pure in `platform`: every path below is built with that platform's
* `node:path` dialect (see `P` in the body), so the returned shape depends
* only on the arguments — never on the OS running the probe.
*/
function bundledRgCandidates(platform, arch, execPath, env, home, modulePath = process.argv[1]) {
	const binName = platform === "win32" ? "rg.exe" : "rg";
	const platformPkg = `@vscode/ripgrep-${platform}-${arch}`;
	const P = platform === "win32" ? win32 : posix;
	const roots = [];
	const addRoot = (root) => {
		if (root !== "" && !roots.includes(root)) roots.push(root);
	};
	const walkRoots = (start) => {
		if (start === "") return;
		let current = P.dirname(start);
		while (current !== P.dirname(current)) {
			if (current.endsWith(`${P.sep}node_modules`)) addRoot(current);
			current = P.dirname(current);
		}
	};
	if (modulePath !== void 0 && modulePath !== "") walkRoots(modulePath);
	walkRoots(execPath);
	if (platform === "win32") {
		if (env.APPDATA !== void 0 && env.APPDATA !== "") addRoot(P.join(env.APPDATA, "npm", "node_modules"));
	} else {
		addRoot(P.join(P.dirname(P.dirname(execPath)), "lib", "node_modules"));
		addRoot("/opt/homebrew/lib/node_modules");
		addRoot("/usr/local/lib/node_modules");
	}
	addRoot(P.join(home, ".dsh", "profiles", "node_modules"));
	const candidates = [];
	const seen = /* @__PURE__ */ new Set();
	for (const root of roots) for (const candidate of [P.join(root, platformPkg, "bin", binName), P.join(root, "@deepseek-ai", "dsh", "node_modules", platformPkg, "bin", binName)]) if (!seen.has(candidate)) {
		seen.add(candidate);
		candidates.push(candidate);
	}
	return candidates;
}
/** Candidate binaries for one engine: the harness's bundled rg, then PATH
*  entries, then fixed well-known locations. A PATH that misses Homebrew
*  (seen in launchd-spawned processes) is covered by the fixed paths. */
function candidates(engine) {
	const env = process.env;
	const pathNames = {
		fd: ["fd", "fdfind"],
		rg: ["rg"]
	};
	const out = [];
	if (engine === "rg") out.push(...bundledRgCandidates(process.platform, process.arch, process.execPath, env, homedir()));
	for (const name of pathNames[engine]) if (env.PATH !== void 0 && env.PATH !== "") {
		for (const dir of env.PATH.split(PATH_SEPARATOR)) if (dir !== "") out.push(join(dir, name));
	}
	if (engine === "fd") out.push("/opt/homebrew/bin/fd", "/usr/local/bin/fd", "/usr/bin/fd", join(homedir(), ".cargo/bin/fd"));
	else out.push("/opt/homebrew/bin/rg", "/usr/local/bin/rg", "/usr/bin/rg");
	return out;
}
/** Verify one binary actually runs (a broken install must not be used). */
function verify(binary) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (ok) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(ok);
		};
		let child;
		try {
			child = spawn(binary, ["--version"], { stdio: "ignore" });
		} catch {
			finish(false);
			return;
		}
		const timer = setTimeout(() => {
			child.kill();
			finish(false);
		}, PROBE_TIMEOUT_MS$1);
		child.once("error", () => {
			finish(false);
		});
		child.once("exit", (code) => {
			finish(code === 0);
		});
	});
}
/** Escape glob metacharacters so a query matches literally inside -g.
*  Braces are metacharacters too ({a,b} alternation): an unbalanced '{'
*  makes rg fail to parse the glob (exit 2 → the engine looks broken), and
*  a balanced one silently matches a DIFFERENT literal ('a{b}' searches
*  'ab'). Verified against rg 15: '\{' is a valid brace escape. */
function escapeGlob(query) {
	return query.replace(/[\[\]{}*?\\]/g, "\\$&");
}
/** Directory names that are never useful filename-search results (VCS
*  internals, dependency forests, package-manager stores, build caches,
*  worktree forests, language environments).
*  The plain walk in fs-search.ts builds its case-insensitive skip set
*  from this list, and BOTH engine argvs exclude every name — with
*  --no-ignore active an rg/fd run would otherwise re-enter node_modules
*  and regress the budget-saving behavior of the walk. Excludes are
*  matched case-insensitively (fd honors --ignore-case; rg uses --iglob),
*  mirroring the walk's toLowerCase comparison. */
const SKIP_DIR_NAMES = [
	".git",
	"node_modules",
	".pnpm-store",
	".yarn",
	".turbo",
	".turbopack",
	".next",
	".nuxt",
	".output",
	".cache",
	".parcel-cache",
	"coverage",
	"dist",
	"build",
	"out",
	".worktrees",
	".worktree",
	"target",
	"venv",
	".venv",
	"__pycache__",
	".umi",
	".umi-production",
	".dumi"
];
/** A timeout means the tree is too big, not that the binary is broken —
*  it must not disable the engine for every other search root. */
var EngineTimeoutError = class extends Error {};
/** Stream a child's stdout line-by-line, capped at `max` lines (the child is
*  killed past the cap so a huge result set never buffers into memory). */
function streamLines(child, max) {
	return new Promise((resolve, reject) => {
		const lines = [];
		let truncated = false;
		let closed = false;
		const finish = (error) => {
			if (closed) return;
			closed = true;
			clearTimeout(timer);
			if (error !== void 0) {
				child.kill();
				reject(error);
			} else resolve({
				lines,
				truncated
			});
		};
		const timer = setTimeout(() => {
			finish(new EngineTimeoutError("search engine timed out"));
		}, ENGINE_TIMEOUT_MS);
		child.once("error", (error) => {
			finish(error);
		});
		child.once("close", (code) => {
			if (truncated) finish(void 0);
			else if (code !== 0 && code !== 1) finish(/* @__PURE__ */ new Error(`search engine exited with ${String(code)}`));
			else finish(void 0);
		});
		const stdout = child.stdout;
		if (stdout === null) {
			finish(/* @__PURE__ */ new Error("search engine stdout unavailable"));
			return;
		}
		createInterface({ input: stdout }).on("line", (line) => {
			if (line === "" || truncated) return;
			lines.push(line);
			if (lines.length > max) {
				truncated = true;
				child.kill();
			}
		});
	});
}
/** Normalize one engine's stdout lines to the walk contract: root-relative,
*  '/'-separated, no leading './'. fd/rg emit relative paths with the
*  PLATFORM separator; the walk contract is '/'-separated on every platform.
*  `separator` defaults to the platform separator — pass '\\' to model
*  Windows engine output (rg on Windows emits '\' paths and '.\' prefixes;
*  Windows file names can never contain '\' or '/', so the substitution is
*  lossless there). A trailing '\r' is also stripped: Windows engines emit
*  CRLF line endings, and while readline usually swallows the CR, a leftover
*  one must never leak into a path (safe on every platform — a POSIX file
*  whose name ends in CR is pathological). */
function normalizeEnginePaths(lines, separator = sep) {
	const out = [];
	for (const line of lines) {
		if (line === "") continue;
		const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
		if (trimmed === "") continue;
		const normalized = trimmed.split(separator).join("/");
		const bare = normalized.startsWith("./") ? normalized.slice(2) : normalized;
		const clean = bare.endsWith("/") ? bare.replace(/\/+$/, "") : bare;
		if (clean !== "" && clean !== ".") out.push(clean);
	}
	return out;
}
/** The fd argv: the query as a literal substring, every SKIP_DIR_NAMES
*  excluded (a bare name excludes the entry at any depth; a worktree-style
*  `.git` FILE is covered too — verified against real fd), '/' separators
*  pinned, and --max-results one ABOVE the stream sentinel (cap + 1) so a
*  full result set overflows into the same truncation detected for rg
*  (see runChild). Directory matches are read from a second invocation
*  (`type: 'd'`, see runChild) because fd cannot label its matches. */
function fdArgv(cap, query, type) {
	return [
		"--hidden",
		"--no-ignore",
		...SKIP_DIR_NAMES.flatMap((name) => ["--exclude", name]),
		"--fixed-strings",
		"--ignore-case",
		...type === void 0 ? [] : ["--type", type],
		"--path-separator",
		"/",
		"--max-results",
		String(cap + 1),
		query,
		"."
	];
}
/** The rg argv: --files listing filtered by a case-insensitive literal-name
*  glob, '/' separators pinned (rg emits '\' in cmd/PowerShell on Windows,
*  '/' in Git Bash — rg#501; the flag exists since rg 0.8, a build without
*  it fails at spawn and is disabled at runtime). Every SKIP_DIR_NAME gets
*  a glob pair: a '<name>-anywhere' glob prunes the directory tree, and the second
*  entry-only glob excludes an entry NAMED the skip word itself — a git
*  worktree has a `.git` FILE (not a directory) at its root, and the
*  directory-exclusion glob requires a path segment AFTER the word so it
*  does not cover the pointer file (verified against real rg). fd's
*  --exclude and the plain walk both skip it without the extra glob. */
function rgArgv(query) {
	const skipGlobs = SKIP_DIR_NAMES.flatMap((name) => [
		"--iglob",
		`!**/${name}/**`,
		"--iglob",
		`!**/${name}`
	]);
	const escaped = escapeGlob(query);
	return [
		"--files",
		"--hidden",
		"--no-ignore",
		...skipGlobs,
		"--iglob",
		`*${escaped}*`,
		"--iglob",
		`**/*${escaped}*/*`,
		"--iglob",
		`**/*${escaped}*/**`,
		"--path-separator",
		"/",
		"."
	];
}
/** rg reports FILES only (`rg --files` never emits a directory line), while
*  the walk contract matches entry names — files AND directories. Every rg
*  line is a file path whose glob already guarantees the query appears
*  somewhere in it, so: a basename hit stays a file match, and a matching
*  DIRECTORY segment is derived as a directory match (a directory named X
*  holding at least one file surfaces exactly as fd/walk report it).
*  EMPTY directories stay invisible to rg — no file path carries them —
*  the one gap left versus fd and the walk. Both lists are sorted and
*  capped at the same sentinel (maxMatches + 1, the caller slices back and
*  re-derives the directory subset from what it keeps, so `dirs` stays a
*  subset of `matches`); `truncated` is raised when the derived set exceeded
*  the budget — the budget, not the engine, cut the result short (runChild
*  ORs it with the stream's own sentinel). */
function deriveRgMatches(paths, query, maxMatches) {
	const needle = query.toLowerCase();
	const files = /* @__PURE__ */ new Set();
	const dirs = /* @__PURE__ */ new Set();
	for (const path of paths) {
		const segments = path.split("/");
		const base = segments[segments.length - 1];
		if (base !== void 0 && base.toLowerCase().includes(needle)) files.add(path);
		let prefix = "";
		for (let index = 0; index < segments.length - 1; index += 1) {
			const segment = segments[index];
			if (segment === void 0) continue;
			prefix = prefix === "" ? segment : `${prefix}/${segment}`;
			if (segment.toLowerCase().includes(needle)) dirs.add(prefix);
		}
	}
	const derived = [.../* @__PURE__ */ new Set([...files, ...dirs])].sort();
	return {
		paths: derived.slice(0, maxMatches + 1),
		dirs: [...dirs].sort().slice(0, maxMatches + 1),
		truncated: derived.length > maxMatches
	};
}
/** One child invocation per engine, emitting normalized relative paths.
*  fd needs two runs to fill the walk contract: the plain literal match (both
*  files and directories — the walk's own shape) and a `--type d` run for the
*  directory subset. rg's query globs admit basename hits AND files under
*  matching directories; deriveRgMatches converts the latter into the
*  directory matches the walk contract reports and drops nothing else.
*
*  Truncation symmetry: `streamLines` marks truncated when the stream
*  exceeds `cap = maxMatches + 1` lines (the +1 is a sentinel proving
*  "there is more"). rg has no --max-results so it naturally overflows
*  into the sentinel; fd MUST NOT cap at `cap` (it would stop exactly at
*  the sentinel and never be seen as truncated) — pin its --max-results
*  one higher (maxMatches + 2) so a full result set trips the same
*  sentinel and both engines report truncated identically, with the
*  caller slicing back to maxMatches. */
function runChild(probe, root, query, maxMatches) {
	const cap = maxMatches + 1;
	if (probe.engine === "rg") return streamLines(spawner(probe.binary, rgArgv(query), {
		cwd: root,
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		]
	}), cap).then(({ lines, truncated }) => {
		const derived = deriveRgMatches(normalizeEnginePaths(lines), query, maxMatches);
		return {
			paths: derived.paths,
			dirs: derived.dirs,
			truncated: truncated || derived.truncated
		};
	});
	const child = spawner(probe.binary, fdArgv(cap, query), {
		cwd: root,
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		]
	});
	const dirChild = spawner(probe.binary, fdArgv(cap, query, "d"), {
		cwd: root,
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		]
	});
	return Promise.all([streamLines(child, cap), streamLines(dirChild, cap)]).then(([matches, dirs]) => {
		const paths = normalizeEnginePaths(matches.lines);
		const dirSet = new Set(normalizeEnginePaths(dirs.lines));
		return {
			paths,
			dirs: paths.filter((path) => dirSet.has(path)),
			truncated: matches.truncated
		};
	});
}
let prober = () => probeOnce();
let runner = runChild;
/** Child spawn behind runChild — injectable so tests can drive the real
*  orchestration with scripted children (event order, stream timing). */
let spawner = spawn;
/** Engines failed at runtime: skipped for the rest of this process. */
const broken = /* @__PURE__ */ new Set();
let probePromise = null;
/** Probe once per process (lazy): each engine's first working candidate. */
async function probeOnce() {
	const found = [];
	for (const engine of ["fd", "rg"]) for (const binary of candidates(engine)) if (await verify(binary)) {
		found.push({
			engine,
			binary
		});
		break;
	}
	debugLog(`[dsh-search] engines probed: ${found.length > 0 ? found.map((p) => `${p.engine}(${p.binary})`).join(", ") : "none (plain-walk fallback)"}`);
	return found;
}
/** The verified engines for this process (cached across searches). */
function probeEngines() {
	probePromise ??= prober();
	return probePromise;
}
/** Run one engine and get capped, normalized matches; a runtime failure
*  disables that engine for the rest of the process (a broken binary must
*  not slow every later search) — but a TIMEOUT does not: a timeout means
*  THIS tree was too big, while the broken-set is per-engine, so disabling
*  here would strip every other (small) root of the engine over one huge
*  directory. */
async function runEngine(probe, root, query, maxMatches) {
	try {
		return await runner(probe, root, query, maxMatches);
	} catch (error) {
		if (error instanceof EngineTimeoutError) debugLog(`[dsh-search] engine ${probe.engine} timed out (tree too large), falling back`);
		else {
			broken.add(probe.engine);
			debugLog(`[dsh-search] engine ${probe.engine} failed at runtime, disabled: ${error instanceof Error ? error.message : String(error)}`);
		}
		throw error;
	}
}
/** The engines a caller may actually try (verified, not broken). */
async function usableEngines() {
	return (await probeEngines()).filter((probe) => !broken.has(probe.engine));
}
//#endregion
//#region src/fs-search.ts
const DEFAULT_MAX_MATCHES = 200;
const DEFAULT_MAX_VISITED = 1e5;
/**
* Directory names that are never useful filename-search results and would
* burn the visit budget before the walk reaches project files. Compared
* case-insensitively so `Node_Modules` / `.GIT` stay skipped on every
* platform. The name list lives in search-engines.ts (SKIP_DIR_NAMES) — the
* engine argvs exclude the same names so the fallback and the engines return
* the same result shape. An entry with a skip name is neither matched nor
* descended — including a worktree-style `.git` FILE, which the engine
* excludes cover as well.
*/
const SEARCH_SKIP_DIRS = new Set(SKIP_DIR_NAMES);
/** Shorten an absolute search root for log lines: ~/ for the config home. */
function relRoot(root) {
	const home = process.env.DSH_HOME !== void 0 && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME : homedir();
	if (root === home) return "~";
	const boundary = home.endsWith(sep) ? home : home + sep;
	return root.startsWith(boundary) ? `~${root.slice(home.length)}` : root;
}
/**
* Whether one matched entry is a DIRECTORY, following symlinks the way the
* tree and `fs.read` do: the dirent answers for real directories, a link is
* stat'ed (a link to a directory is a directory row — `fs.read` refuses it as
* a file), and an unresolvable link stays a plain entry.
*/
async function isDirectoryEntry(absolute, dirent) {
	if (dirent.isDirectory()) return true;
	if (!dirent.isSymbolicLink()) return false;
	return (await stat(absolute).catch(() => void 0))?.isDirectory() === true;
}
/**
* The platform's OWN path separators — on POSIX only `/`, on win32 both
* spellings. Shared by every "does this query carry a separator?" decision so
* they cannot drift apart: on POSIX a backslash is a legal name character (a
* name like `back\slash.ts` or `.\notes.md`), and reading one as a separator
* both steals the query from name matching and costs it engine eligibility.
*/
const SEPARATOR_RE = process.platform === "win32" ? /[/\\]/ : /\//;
/**
* A dot-anchored relative path (`./x`, `../x`) — the separator after the dots
* must be one of the platform's own ({@link SEPARATOR_RE}), for the same
* reason `~\` is win32-gated below: `.\notes` is a POSIX entry NAME, so
* counting its backslash here would stat a path that cannot exist instead of
* matching the name.
*/
const DOT_ANCHORED_RE = process.platform === "win32" ? /^\.+[/\\]/ : /^\.+\//;
/**
* Whether `query` carries a path separator: such a query can never hit an
* entry NAME and takes the path branches instead of name matching. Only the
* platform's own separators count — on POSIX a backslash is a legal name
* character, not a separator (the engines must stay eligible for names
* like `back\slash.ts`).
*/
function hasSeparator(query) {
	return SEPARATOR_RE.test(query);
}
/**
* Whether `query` NAMES one path (a direct-open gesture) instead of
* filtering: node's own absolute forms, the `~`-relative home spellings the
* resolution primitive expands (#713 — the client's own `isAbsolutePath`
* treats the same forms as absolute), and dot-anchored relative paths
* (`./x`, `../x`). No entry NAME can take these shapes — a name never
* contains a separator — so the predicate steals no name query, with one
* platform-bent exception: the `~\` form (and the `.\` spelling of a
* dot-anchored path) counts only on win32, because on POSIX a backslash is a
* legal name character and both `~\foo` and `.\foo` can be a file's NAME.
* Plain fragments (`records/exp1`) stay with the path-fragment branch.
*/
function isDirectPathQuery(query) {
	return isAbsolute(query) || query === "~" || query.startsWith("~/") || process.platform === "win32" && query.startsWith("~\\") || DOT_ANCHORED_RE.test(query);
}
/**
* The plain-JS fallback walk: search `root` recursively for entries whose
* name contains `query` (case-insensitive), or — for a query carrying a
* path separator, which no NAME can contain — whose root-relative path
* does.
* @param root - absolute search root.
* @param query - the name substring, or the path fragment for
*  separator-carrying queries; empty matches nothing.
* @param opts - budget overrides (tests).
* @returns the matching paths RELATIVE to `root` ('/'-separated), sorted,
*  plus which of them are directories and whether a budget cut the walk
*  short. An unreadable level is skipped (permission errors never fail the
*  whole search).
*/
async function searchFilesPlain(root, query, opts = {}) {
	const needle = query.trim().toLowerCase();
	if (needle === "") return {
		matches: [],
		dirs: [],
		truncated: false
	};
	const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
	const maxVisited = opts.maxVisited ?? DEFAULT_MAX_VISITED;
	const pathNeedle = hasSeparator(needle) ? needle.replace(/\//g, sep) : void 0;
	const matches = [];
	const dirs = [];
	let visited = 0;
	let truncated = false;
	const walk = async (dir, relDir) => {
		if (truncated) return;
		const level = await opendir(dir).catch(() => void 0);
		if (level === void 0) return;
		for await (const dirent of level) {
			visited += 1;
			if (visited > maxVisited) {
				truncated = true;
				return;
			}
			if (SEARCH_SKIP_DIRS.has(dirent.name.toLowerCase())) continue;
			const relativePath = relDir === "" ? dirent.name : `${relDir}${sep}${dirent.name}`;
			const absolute = join(dir, dirent.name);
			if (opts.exclude !== void 0 && opts.exclude(absolute, dirent.name)) continue;
			if (pathNeedle === void 0 ? dirent.name.toLowerCase().includes(needle) : relativePath.toLowerCase().includes(pathNeedle)) {
				matches.push(relativePath);
				if (await isDirectoryEntry(absolute, dirent)) dirs.push(relativePath);
				if (matches.length >= maxMatches) {
					truncated = true;
					return;
				}
			}
			if (dirent.isDirectory() && !dirent.isSymbolicLink()) {
				await walk(absolute, relativePath);
				if (truncated) return;
			}
		}
	};
	await walk(root, "");
	const normalize = (path) => path.split(sep).join("/");
	return {
		matches: matches.sort().map(normalize),
		dirs: dirs.sort().map(normalize),
		truncated
	};
}
/**
* The walk's exclude probe applied to a FLAT engine listing (the engines have
* no notion of the user's patterns). The engines are a faster walk, not a
* different surface, so the walk's two rules carry over verbatim: a row whose
* name is excluded disappears, and so does every row BELOW an excluded
* directory — the walk never descended into one, so it could never have
* reported a child as a match either. Verdicts are memoized per directory:
* the engines report hundreds of rows under the same few directories.
*/
function engineExcludeProbe(root, exclude) {
	const excludedDirs = /* @__PURE__ */ new Map();
	/** Whether the directory at `relativeDir` ('' = the search root) is
	*  excluded, itself or through an ancestor. */
	const dirExcluded = (relativeDir) => {
		if (relativeDir === "") return false;
		const cached = excludedDirs.get(relativeDir);
		if (cached !== void 0) return cached;
		const cut = relativeDir.lastIndexOf("/");
		const parent = cut === -1 ? "" : relativeDir.slice(0, cut);
		const name = cut === -1 ? relativeDir : relativeDir.slice(cut + 1);
		const verdict = dirExcluded(parent) || exclude(join(root, ...relativeDir.split("/")), name);
		excludedDirs.set(relativeDir, verdict);
		return verdict;
	};
	return (relativePath) => {
		const cut = relativePath.lastIndexOf("/");
		const parent = cut === -1 ? "" : relativePath.slice(0, cut);
		const name = cut === -1 ? relativePath : relativePath.slice(cut + 1);
		return dirExcluded(parent) || exclude(join(root, ...relativePath.split("/")), name);
	};
}
/**
* The fs.search dispatch: an absolute query is stat'ed directly (see the
* module header), a separator-carrying fragment goes to the walk, and plain
* name queries run the native engines first (when verified and healthy) with
* the plain walk as fallback. Engine output is normalized onto the walk
* contract — root-relative, '/'-separated, sorted, and split into
* matches/dirs — so the route and the client stay unchanged. A blank query
* matches nothing and touches neither the engines nor the filesystem.
*
* The engines keep their own cap (and report it through `truncated`), so a
* root whose first `maxMatches` rows are ALL excluded comes back short with
* `truncated: true` rather than silently hiding the remainder — the same
* signal a budget-cut walk gives.
*/
async function searchFiles(root, query, opts = {}) {
	const needle = query.trim();
	if (needle === "") return {
		matches: [],
		dirs: [],
		truncated: false
	};
	const started = performance.now();
	if (isDirectPathQuery(needle)) {
		const target = resolveTarget(root, needle);
		const info = await stat(target).catch(() => void 0);
		const result = info === void 0 ? {
			matches: [],
			dirs: [],
			truncated: false
		} : info.isDirectory() ? {
			matches: [target],
			dirs: [target],
			truncated: false
		} : {
			matches: [target],
			dirs: [],
			truncated: false
		};
		debugLog(`[dsh-search] engine=stat root=${relRoot(root)} query="${needle}" hits=${result.matches.length} truncated=${result.truncated} ${(performance.now() - started).toFixed(0)}ms`);
		return result;
	}
	if (hasSeparator(needle)) {
		const result = await searchFilesPlain(root, query, opts);
		debugLog(`[dsh-search] engine=plain root=${relRoot(root)} query="${needle}" hits=${result.matches.length} truncated=${result.truncated} ${(performance.now() - started).toFixed(0)}ms`);
		return result;
	}
	const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
	const isExcluded = opts.exclude === void 0 ? void 0 : engineExcludeProbe(root, opts.exclude);
	for (const probe of await usableEngines()) try {
		const result = await runEngine(probe, root, needle, maxMatches);
		const matches = [...isExcluded === void 0 ? result.paths : result.paths.filter((path) => !isExcluded(path))].sort().slice(0, maxMatches);
		const kept = new Set(matches);
		const dirs = [...new Set(result.dirs)].filter((dir) => kept.has(dir)).sort();
		debugLog(`[dsh-search] engine=${probe.engine} bin=${probe.binary} root=${relRoot(root)} query="${needle}" hits=${matches.length} truncated=${result.truncated} ${(performance.now() - started).toFixed(0)}ms`);
		return {
			matches,
			dirs,
			truncated: result.truncated
		};
	} catch {}
	const result = await searchFilesPlain(root, query, opts);
	debugLog(`[dsh-search] engine=plain root=${relRoot(root)} query="${needle}" hits=${result.matches.length} truncated=${result.truncated} ${(performance.now() - started).toFixed(0)}ms`);
	return result;
}
/**
* Normalize one raw pattern (accepts unknown wire values): trim, unify
* separators, drop the doublestar-slash head (remembered as a suffix kind) and the
* `./` and trailing-/ decorations. Returns undefined for empty/invalid input.
*/
function normalizePattern(raw) {
	if (typeof raw !== "string") return void 0;
	let pattern = raw.trim().replace(/\\/g, "/");
	if (pattern.length > 256) return void 0;
	while (pattern.startsWith("./")) pattern = pattern.slice(2);
	while (pattern.startsWith("/")) pattern = pattern.slice(1);
	while (pattern.endsWith("/")) pattern = pattern.slice(0, -1);
	let kind = "name";
	if (pattern.startsWith("**/")) {
		kind = "suffix";
		pattern = pattern.slice(3);
	}
	if (pattern === "" || pattern === "**") return;
	if (kind === "name" && pattern.includes("/")) kind = "path";
	return {
		kind,
		body: pattern
	};
}
/** Compile one normalized glob body to an anchored RegExp. */
function globToRegExp(body, insensitive) {
	let out = "";
	for (let i = 0; i < body.length; i += 1) {
		const char = body[i];
		if (char === "*") {
			if (body[i + 1] === "*") {
				out += ".*";
				i += 1;
			} else out += "[^/]*";
			continue;
		}
		if (char === "?") {
			out += "[^/]";
			continue;
		}
		out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${out}$`, insensitive ? "i" : void 0);
}
/** The cwd-relative '/' path of `entryPath` (undefined when outside `root`). */
function relativeToRoot(root, entryPath) {
	const rel = relative(root, entryPath).split(sep).join("/");
	return rel.startsWith("..") ? void 0 : rel;
}
/**
* Compile the wire patterns into one entry probe.
* @param raw - the request payload's `exclude` field (anything; validated).
* @param root - the session cwd the path-anchored patterns resolve against.
* @param platform - case-folding semantics (`'win32'` matches insensitively).
* @returns the probe (with its {@link ExcludeMatcher.key}), or undefined when
* nothing valid was declared (callers skip filtering entirely then — the
* no-pattern fast path).
*/
function compileExcludePatterns(raw, root, platform = process.platform) {
	if (!Array.isArray(raw)) return void 0;
	const compiled = [];
	for (const item of raw) {
		if (compiled.length >= 64) break;
		const normalized = normalizePattern(item);
		if (normalized === void 0) continue;
		compiled.push({
			kind: normalized.kind,
			regex: globToRegExp(normalized.body, platform === "win32")
		});
	}
	if (compiled.length === 0) return void 0;
	const needsRel = compiled.some((pattern) => pattern.kind !== "name");
	const probe = (entryPath, name) => {
		let rel;
		for (const pattern of compiled) {
			if (pattern.kind === "name") {
				if (pattern.regex.test(name)) return true;
				continue;
			}
			if (rel === void 0) {
				if (!needsRel) continue;
				rel = relativeToRoot(root, entryPath) ?? "";
			}
			if (pattern.kind === "path") {
				if (rel !== "" && pattern.regex.test(rel)) return true;
				continue;
			}
			if (pattern.regex.test(name)) return true;
			if (rel !== "") {
				const segments = rel.split("/");
				for (let start = 0; start < segments.length - 1; start += 1) if (pattern.regex.test(segments.slice(start).join("/"))) return true;
			}
		}
		return false;
	};
	const key = `${root}\0${compiled.map((pattern) => `${pattern.kind}:${pattern.regex.source}:${pattern.regex.flags}`).join("\0")}`;
	return Object.assign(probe, { key });
}
/**
* Decode a route pathname into the session + absolute file path. Rejects
* a wrong prefix (404), an empty path, malformed percent encoding, and a
* missing sessionId or file path (400). The caller still must bound the
* decoded path with the workspace real-path guard — a decoded `..`
* segment resolves outside the cwd and is refused there.
*/
function decodeHtmlUrl(pathname) {
	if (!pathname.startsWith("/sidebar/html/")) return {
		ok: false,
		status: 404,
		message: "not an html route"
	};
	const rest = pathname.slice(14);
	if (rest === "") return {
		ok: false,
		status: 400,
		message: "invalid html route path"
	};
	let segments;
	try {
		segments = rest.split("/").map((segment) => decodeURIComponent(segment));
	} catch {
		return {
			ok: false,
			status: 400,
			message: "malformed URL encoding"
		};
	}
	const [sessionId, ...pathSegments] = segments;
	if (sessionId === void 0 || sessionId === "") return {
		ok: false,
		status: 400,
		message: "sessionId and file path are required"
	};
	const unc = pathSegments[0] === "";
	const tail = unc ? pathSegments.slice(1) : pathSegments;
	if (tail.length === 0 || tail.some((segment) => segment === "")) return {
		ok: false,
		status: 400,
		message: "sessionId and file path are required"
	};
	let path;
	if (unc) path = `//${tail.join("/")}`;
	else if (tail[0] === "~") path = tail.join("/");
	else if (/^[A-Za-z]:$/.test(tail[0] ?? "")) path = tail.join("/");
	else path = `/${tail.join("/")}`;
	return {
		ok: true,
		ref: {
			sessionId,
			path
		}
	};
}
//#endregion
//#region src/bundle-route.ts
/**
* Lazy chunk route: serves the client bundle's chunk scripts
* (/sidebar/bundle/<name>.js). The official /plugins/<id>/client.js route
* cannot serve arbitrary file names, so the plugin serves its own split
* bundles (lib/client-<name>.js) here; the client injects the script on
* first use of the feature that needs it (see src/client/chunk-loader.ts).
*
* Caching contract: every response carries `cache-control: no-cache` plus an
* ETag (content hash, memoized per file by mtime/size) and honors
* If-None-Match — the browser revalidates each fetch, but a 304 avoids
* re-downloading multi-MB chunks that did not change (page refresh, HMR
* re-activation). Same browser-trust fence as every other /sidebar route;
* only allowlisted chunk names are servable (no path traversal).
*/
/** The chunk names the client may request (mirror of src/client/chunk-loader.ts). */
const CHUNK_NAMES = [
	"editor",
	"mermaid",
	"locale",
	"terminal"
];
/** Directory of this host-half module (lib/ — the chunk scripts live next to it). */
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
/** sha1 content hash shortened to 12 hex chars (same shape as the client-modules rev). */
function shortHash(input) {
	return createHash("sha1").update(input).digest("hex").slice(0, 12);
}
/** ETag memo: recompute the content hash only when the file's stat changed. */
const etags = /* @__PURE__ */ new Map();
/**
* The chunk file's ETag (quoted hash), or undefined when the file is
* missing. Hash is recomputed only when mtime/size changed (hashing a
* multi-MB chunk per request is wasteful).
*/
async function etagOf(name, chunkDir) {
	const path = join(chunkDir, `client-${name}.js`);
	const key = `${chunkDir}:${name}`;
	try {
		const info = await stat(path);
		const memo = etags.get(key);
		if (memo !== void 0 && memo.mtimeMs === info.mtimeMs && memo.size === info.size) return memo.etag;
		const etag = `"${shortHash(await readFile(path))}"`;
		etags.set(key, {
			mtimeMs: info.mtimeMs,
			size: info.size,
			etag
		});
		return etag;
	} catch {
		return;
	}
}
/**
* Build the /sidebar/bundle route handler. `fence` is the shared browser-
* trust check every /sidebar route applies; `chunkDir` is the directory the
* chunk scripts live in (overridable for tests).
*/
function createBundleRouteHandler(fence, chunkDir = LIB_DIR) {
	return async (req, res) => {
		if (!fence(req)) {
			res.writeHead(403);
			res.end("forbidden");
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405);
			res.end();
			return;
		}
		const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
		const name = /^\/sidebar\/bundle\/([a-z0-9-]+)\.js$/.exec(pathname)?.[1];
		if (name === void 0 || !CHUNK_NAMES.includes(name)) {
			res.writeHead(404);
			res.end("not found");
			return;
		}
		const etag = await etagOf(name, chunkDir);
		if (etag === void 0) {
			res.writeHead(404);
			res.end("not found");
			return;
		}
		if (req.headers["if-none-match"] === etag) {
			res.writeHead(304, {
				"cache-control": "no-cache",
				etag
			});
			res.end();
			return;
		}
		try {
			const body = await readFile(join(chunkDir, `client-${name}.js`));
			res.writeHead(200, {
				"content-type": "text/javascript; charset=utf-8",
				"cache-control": "no-cache",
				etag
			});
			res.end(body);
		} catch {
			res.writeHead(404);
			res.end("not found");
		}
	};
}
/** Register the /sidebar/bundle route (disposed with the fiber). */
function registerBundleRoute(ctx, fence) {
	return ctx.webServer.register({
		kind: "prefix",
		path: "/sidebar/bundle",
		handler: createBundleRouteHandler(fence)
	});
}
//#endregion
//#region src/fs-watch.ts
/**
* Directory change watching behind the file tree's live refresh.
*
* The tree used to go stale the moment anything wrote to disk outside the
* plugin (a build, a formatter, the model's own `bash`): a folder was listed
* once, when it was expanded, and never again. DSH 0.1.7 gave its own tree
* per-directory watching; this plugin owns its tree (it took the `files` kind
* over), so it needs its own watcher.
*
* One connection watches the directories the reader actually has expanded —
* not the whole workspace — because `fs.watch` is one OS handle per directory
* and a deep tree would exhaust them. Collapsing a folder or closing the
* socket releases its handle.
*
* A debounced change also drops the host's listing cache for that directory
* (`invalidateDirectoryCache`), so the re-list the client is about to ask for
* cannot be answered from a level cached before the change.
* @module dsh-better-sidebar/fs-watch
*/
/** How long a burst of filesystem events is folded into a single push. */
const DEBOUNCE_MS = 150;
/**
* Directory watchers one connection may hold. The cap is a resource guard,
* not a policy: a reader with more than this many folders expanded simply
* stops gaining new watchers, and collapsing any folder frees a slot.
*/
const MAX_WATCHES = 64;
/**
* Create the watcher set of one connection.
*
* `fs.watch` reports a directory's own entry list changing, which is exactly
* what re-listing that directory needs — file CONTENTS changing inside an
* expanded folder is not observable this way and is not what the tree shows.
* @param push - called once per debounced burst with the changed directory.
* @param onError - called when a directory cannot be watched or its watcher
*   fails; the directory is dropped either way, so the caller only reports it.
* @returns the connection's watcher set.
*/
function createDirectoryWatchers(push, onError) {
	const watchers = /* @__PURE__ */ new Map();
	const drop = (dir) => {
		const entry = watchers.get(dir);
		if (entry === void 0) return;
		watchers.delete(dir);
		if (entry.timer !== void 0) clearTimeout(entry.timer);
		entry.watcher.close();
	};
	const notify = (dir) => {
		const entry = watchers.get(dir);
		if (entry === void 0 || entry.timer !== void 0) return;
		entry.timer = setTimeout(() => {
			entry.timer = void 0;
			if (!watchers.has(dir)) return;
			invalidateDirectoryCache(dir);
			push({ dir });
		}, DEBOUNCE_MS);
		entry.timer.unref();
	};
	return {
		add(dir) {
			if (watchers.has(dir)) return true;
			if (watchers.size >= MAX_WATCHES) return false;
			let watcher;
			try {
				watcher = watch(dir, { persistent: false });
			} catch (error) {
				onError(dir, error);
				return false;
			}
			watcher.on("change", () => {
				notify(dir);
			});
			watcher.on("error", (error) => {
				onError(dir, error);
				drop(dir);
			});
			watchers.set(dir, {
				watcher,
				timer: void 0
			});
			return true;
		},
		remove: drop,
		close() {
			for (const dir of [...watchers.keys()]) drop(dir);
		}
	};
}
//#endregion
//#region src/sidechat-push.ts
/** Coalescing window for durable session appends. */
const DURABLE_DEBOUNCE_MS = 60;
/** Coalescing window for in-flight model deltas. */
const STREAM_DEBOUNCE_MS = 250;
/** Thread ids one socket may watch (a resource guard, not a policy). */
const MAX_WATCHED = 64;
/**
* Register the side-chat push feeds.
* @param ctx - host plugin context (its `on` subscribes the append feed).
* @returns the hub plus a disposer unbinding both listeners.
*/
function createSidechatPushHub(ctx) {
	const sockets = /* @__PURE__ */ new Set();
	if (typeof ctx.on !== "function") return {
		attach: () => {},
		dispose: () => {}
	};
	const offEvent = ctx.on("session/event", (session) => {
		const sessionId = session?.id;
		if (typeof sessionId !== "string") return;
		for (const socket of sockets) socket.notify(sessionId, DURABLE_DEBOUNCE_MS);
	});
	const offStream = ctx.on("agent/assistant-stream", (payload) => {
		const session = (payload?.agent)?.session;
		const sessionId = typeof session?.id === "string" ? session.id : void 0;
		if (sessionId === void 0) return;
		for (const socket of sockets) socket.notify(sessionId, STREAM_DEBOUNCE_MS);
	});
	return {
		attach: (ws) => {
			const socket = new SidechatSocket(ws, () => {
				sockets.delete(socket);
			});
			sockets.add(socket);
		},
		dispose: () => {
			offEvent();
			offStream();
			for (const socket of sockets) socket.close();
			sockets.clear();
		}
	};
}
/** One attached socket's watch set and per-thread coalescing timers. */
var SidechatSocket = class {
	socket;
	onClosed;
	watched = /* @__PURE__ */ new Set();
	timers = /* @__PURE__ */ new Map();
	closed = false;
	/**
	* @param socket - the accepted WebSocket.
	* @param onClosed - hub-side cleanup (idempotent).
	*/
	constructor(socket, onClosed) {
		this.socket = socket;
		this.onClosed = onClosed;
		socket.on("message", (data) => {
			this.onMessage(data);
		});
		socket.on("close", () => {
			this.close();
		});
		socket.on("error", () => {
			this.close();
		});
	}
	/** Apply one client frame (an unparseable frame is ignored, never fatal). */
	onMessage(data) {
		let frame;
		try {
			frame = JSON.parse(typeof data === "string" ? data : String(data));
		} catch {
			return;
		}
		if (frame === null || typeof frame !== "object" || frame.op !== "watch") return;
		const ids = Array.isArray(frame.threadIds) ? frame.threadIds.filter((id) => typeof id === "string" && id !== "") : [];
		this.watched.clear();
		for (const id of ids.slice(0, MAX_WATCHED)) this.watched.add(id);
		for (const [id, timer] of this.timers) {
			if (this.watched.has(id)) continue;
			clearTimeout(timer);
			this.timers.delete(id);
		}
	}
	/**
	* Coalesce one notice for a thread. The FIRST trigger's window wins, so a
	* burst of deltas never postpones the notice it already scheduled.
	* @param threadId - the session whose transcript is stale.
	* @param delayMs - coalescing window for this trigger.
	*/
	notify(threadId, delayMs) {
		if (this.closed || !this.watched.has(threadId) || this.timers.has(threadId)) return;
		this.timers.set(threadId, setTimeout(() => {
			this.timers.delete(threadId);
			this.send({ threadId });
		}, delayMs));
	}
	/** Push one notice (silently dropped once the socket is gone). */
	send(frame) {
		if (this.closed) return;
		try {
			this.socket.send(JSON.stringify(frame));
		} catch {}
	}
	/** Release every timer and de-register (idempotent). */
	close() {
		if (this.closed) return;
		this.closed = true;
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.watched.clear();
		this.onClosed();
	}
};
//#endregion
//#region src/open-external.ts
/**
* External open actions for the file tree's "open with" menu: hand a path to
* the OS file manager (reveal/select) or launch a URL scheme's registered
* handler (vscode://, cursor://, zed://, custom schemes).
*
* The client runs in a browser / DSH Desktop renderer where a raw `vscode://`
* navigation is unreliable, so both actions fan out through this host route
* and spawn the platform opener with an argv array (no shell interpolation).
* WSL is special: Node reports `linux`, while the actual desktop handlers live
* on Windows, so its commands cross the interop boundary explicitly.
*/
/** True when this Linux host is backed by Windows Subsystem for Linux. */
function isWslRuntime() {
	if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
	try {
		return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
	} catch {
		return false;
	}
}
/** Run WSL's built-in path translator by absolute path so
* `appendWindowsPath=false` cannot make the helper disappear from PATH. */
function wslPath(mode, value) {
	const translated = execFileSync("/usr/bin/wslpath", [mode, value], { encoding: "utf8" }).trim();
	if (translated === "") throw new Error(`wslpath returned no translation for ${value}`);
	return translated;
}
/** Linux/WSL absolute path -> Windows path understood by Explorer. */
function windowsPathOf(path) {
	return wslPath("-w", path);
}
/** Windows executable path -> its WSL mount path, without relying on PATH. */
function windowsExecutableOf(path) {
	return wslPath("-u", path);
}
/** Reveal/select a path in the OS file manager. On plain Linux there is no
* common select protocol — the containing directory is opened instead.
* Under WSL the desktop file manager is Windows Explorer. */
function revealCommand(path, platform = process.platform, options = {}) {
	switch (platform) {
		case "darwin": return {
			command: "open",
			args: ["-R", path]
		};
		case "win32": return {
			command: "explorer.exe",
			args: [`/select,${path}`]
		};
		case "android": return {
			command: "termux-open",
			args: [parentOf(path) ?? path]
		};
		default:
			if (options.wsl) {
				const toWindowsPath = options.toWindowsPath ?? windowsPathOf;
				return {
					command: (options.windowsExecutable ?? windowsExecutableOf)("C:\\Windows\\explorer.exe"),
					args: [`/select,${toWindowsPath(path)}`]
				};
			}
			return {
				command: "xdg-open",
				args: [parentOf(path) ?? path]
			};
	}
}
/**
* Characters `cmd.exe` interprets after Node has quoted each argv element for
* CreateProcess: `cmd /c` parses the command line AGAIN, so `%VAR%` expands,
* `&`/`|` split the command, `<`/`>` redirect, `^` escapes the next character,
* `!` triggers delayed expansion and `"` re-balances the quoting. A URL
* carrying any of them never reaches the `start` branch — it goes straight to
* rundll32, which receives the URL as one argv element and interprets nothing.
*/
const CMD_METACHARACTERS = /[&%^!|<>"]/;
/** C0/C1 control characters count as metacharacters too: `cmd.exe` treats a
*  raw CR/LF as a command separator, and `validateExternalUrl` returns the
*  RAW string (`new URL` strips those characters, so validation passes). */
const CMD_CONTROL_CHARACTERS = /\p{Cc}/u;
/** Whether `cmd.exe` would reinterpret any part of this URL — i.e. the `start`
*  branch must be skipped and rundll32 used directly. */
function cmdUnsafe(url) {
	return CMD_METACHARACTERS.test(url) || CMD_CONTROL_CHARACTERS.test(url);
}
/**
* The URL openers to try, best first — the Windows chain exists because the
* `start` route and the rundll32 route fail in disjoint situations (#412:
* rundll32 alone reported `{ started: true }` while nothing opened).
*
* Every entry is an argv array (never a shell string). macOS/Linux keep their
* single opener and WSL keeps its single absolute-path Windows dispatcher (the
* registered handlers live on the Windows side of the interop boundary): this
* chain is a Windows fix, so their behavior is unchanged.
*/
function urlCommands(url, platform = process.platform, options = {}) {
	switch (platform) {
		case "darwin": return [{
			command: "open",
			args: [url]
		}];
		case "win32": {
			const chain = [];
			if (!cmdUnsafe(url)) chain.push({
				command: options.cmdExecutable ?? "cmd.exe",
				args: [
					"/d",
					"/c",
					"start",
					"",
					url
				]
			});
			chain.push({
				command: options.rundll32Executable ?? "rundll32.exe",
				args: ["url.dll,FileProtocolHandler", url]
			});
			return chain;
		}
		case "android": return [{
			command: "termux-open-url",
			args: [url]
		}];
		default:
			if (options.wsl) return [{
				command: (options.windowsExecutable ?? windowsExecutableOf)("C:\\Windows\\System32\\rundll32.exe"),
				args: ["url.dll,FileProtocolHandler", url]
			}];
			return [{
				command: "xdg-open",
				args: [url]
			}];
	}
}
/** Convert the built-in VSCode-family local-file URL to its Remote-WSL form.
* A POSIX path produces `scheme://file//...`; keep one leading slash when it
* moves behind the `wsl+<distro>` authority. Other custom schemes are left
* alone and merely dispatched through the Windows protocol handler. */
function wslRemoteEditorUrl(url, distroName) {
	const match = /^(vscode(?:-insiders)?|cursor):\/\/file(\/\/.*)$/i.exec(url);
	if (match === null) return url;
	const scheme = match[1];
	const remotePath = match[2];
	if (scheme === void 0 || remotePath === void 0) return url;
	const distro = distroName.trim();
	if (distro === "") throw new SidebarError("internal", "WSL_DISTRO_NAME is unavailable; cannot build a Remote-WSL editor URL", 500);
	return `${scheme}://vscode-remote/wsl+${distro}${remotePath.slice(1)}`;
}
/** Validate a URL-scheme open target: a parseable custom-scheme URL (never
* http/https — those would only dump the URL into a browser tab). */
function validateExternalUrl(raw) {
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new SidebarError("bad-request", "url must be a custom-scheme URL");
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new SidebarError("bad-request", "invalid url");
	}
	if (url.protocol === "http:" || url.protocol === "https:") throw new SidebarError("bad-request", "only custom-scheme urls can be opened externally");
	return raw;
}
/** The structured failure of an action whose EVERY opener candidate died:
* `internal` on the wire, with each command and its underlying message named
* so the UI (and a bug report) can carry the real cause. */
function launchFailure(action, failures) {
	return new SidebarError("internal", `failed to launch external opener for the ${action === "url" ? "url" : "path"}: ${failures.map((f) => `"${f.command}" (${messageOf(f.error)})`).join("; ")}`, 500);
}
/**
* Launch the first candidate that actually starts, in order.
*
* Success is reported only after Node emits `spawn`; a synchronous throw or an
* `error` event (ENOENT, EACCES, …) advances to the next candidate. When every
* candidate fails the promise rejects with a structured `SidebarError` naming
* them all — the route must never answer `{ started: true }` for an open that
* launched nothing (#412: that silent success is why the menu "did nothing").
*
* Note what this can and cannot see: a detached candidate that starts but
* whose handler ignores the URL exits 0 (`start` and rundll32 both do), so the
* chain reports everything it can observe — the launch itself.
*/
function launchChain(action, chain, spawnExternal) {
	const failures = [];
	return new Promise((resolve, reject) => {
		const attempt = (index) => {
			const spec = chain[index];
			if (spec === void 0) {
				reject(launchFailure(action, failures));
				return;
			}
			let child;
			try {
				child = spawnExternal(spec.command, spec.args, {
					detached: true,
					stdio: "ignore"
				});
			} catch (error) {
				failures.push({
					command: spec.command,
					error
				});
				attempt(index + 1);
				return;
			}
			let settled = false;
			child.once("spawn", () => {
				if (settled) return;
				settled = true;
				resolve({ started: true });
			});
			child.once("error", (error) => {
				if (settled) return;
				settled = true;
				failures.push({
					command: spec.command,
					error
				});
				attempt(index + 1);
			});
			child.unref();
		};
		attempt(0);
	});
}
/**
* Launch one external open action detached from the host. Both actions fan out
* through an ordered candidate chain (one entry on macOS/Linux/Android/WSL, the
* two Windows URL routes on win32) and reject with the aggregated failure when
* none of them starts.
*/
function launchExternal(action, value, options = {}) {
	const platform = options.platform ?? process.platform;
	const wsl = options.wsl ?? (platform === "linux" && isWslRuntime());
	const commandOptions = {
		...options.commandOptions,
		wsl
	};
	let chain;
	if (action === "reveal") chain = [revealCommand(requireAbsolute(value), platform, commandOptions)];
	else {
		let url = validateExternalUrl(value);
		if (wsl) url = wslRemoteEditorUrl(url, options.distroName ?? process.env.WSL_DISTRO_NAME ?? "");
		chain = urlCommands(url, platform, commandOptions);
	}
	return launchChain(action, chain, options.spawn ?? spawn);
}
//#endregion
//#region src/file-stream.ts
/**
* One-shot file streaming for the plugin's raw byte routes.
*
* Every read-only byte route used to `readFile()` and hand the whole buffer to
* `res.end()`, which put a hard ceiling on the response and made the host's
* memory grow with the file. Streaming removes both: the bytes go from disk to
* socket through a bounded pipe, so a 10 GB image downloads through the same
* constant-memory path as a 10 KiB one.
*
* The one genuinely tricky part is WHERE the header is written. `writeHead`
* commits the response: an error after it can no longer become the plugin's
* JSON error envelope, and the client would see a `200` with a truncated body.
* So the stream is opened and awaited FIRST — `open` rejects for ENOENT /
* EACCES / EISDIR before a single header goes out — and only then does the
* status line commit. Failures after that point (the file changed under us,
* the client aborted) destroy the socket, which is the only honest signal left.
*/
/**
* Stream one file into the response with the given headers.
*
* The caller keeps ownership of every header except `content-length`, which is
* derived from `size` here: browsers need it for a download's progress bar,
* and the routes always have a fresh `stat` at hand.
*
* @param path - absolute path of the file to send (already fenced by the caller).
* @param size - the file's size in bytes, from the same `stat` the caller ran.
* @param res - the response face.
* @param headers - status/type/disposition headers, written verbatim.
* @throws {SidebarError} fs-error when the file cannot be opened — thrown
*  BEFORE the header commits, so the caller's `writeError` still produces a
*  proper envelope. After that this function never throws: the response is
*  already committed and the connection is destroyed instead.
*/
async function streamFileToResponse(path, size, res, headers) {
	const node = res;
	const stream = createReadStream(path);
	try {
		await once(stream, "open");
	} catch (error) {
		stream.destroy();
		throw new SidebarError("fs-error", `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400);
	}
	res.writeHead(200, {
		...headers,
		"content-length": String(size)
	});
	try {
		await pipeline(stream, node);
	} catch {
		node.destroy();
	}
}
//#endregion
//#region src/archive-tools.ts
/**
* Archive packing by the system's own tool, not by a writer of ours.
*
* This module replaces a hand-written ZIP encoder (~300 lines of local file
* headers, central directory, CRC-32 and raw DEFLATE) plus a recursive walk.
* Everything it did, `zip -r` does better: real DEFLATE, the platform's own
* path handling, and streaming output that grows with the data instead of a
* `Buffer.concat` of the whole archive.
*
* Two tools, tried in order, because neither is universal:
*
* - `zip` — what the file tree asks for, present on macOS and most Linux
*   distributions. Always passed `-y`: without it Info-ZIP FOLLOWS symlinks,
*   and a symlink loop (`a -> .`) then recurses until it is killed. `-y`
*   stores the link itself, which is both loop-proof and a truer archive.
*   (Verified against a real loop before this was written.)
* - `tar` — present everywhere the plugin realistically runs, including
*   Windows 10 1803+, where it is a built-in `bsdtar` and there is no `zip` at
*   all. GNU tar and bsdtar both take the same `-czf -` invocation.
*
* Output always goes to stdout (`-` as the archive name) so the caller decides
* where the bytes land; the route redirects them into a temp file, which is
* what keeps the download streamable without holding the archive in memory.
*
* Nothing in this module runs a shell: `spawn` takes an argv array, and every
* path is data. A path is never interpolated into a command string, so a
* filename with `;` or `$(...)` in it is a filename.
*
* The spawn/probe functions are injectable so the test suite never depends on
* a real `zip` being installed (AGENTS §6) — the same pattern `open-external`
* and `search-engines` use.
*/
/**
* The invocation of one tool.
*
* `zip`'s `-` as the archive name means stdout, and the leading `-` in the
* argv is understood as that operand rather than as an option because it
* follows other flags.
*/
const TOOL_SPECS = {
	zip: {
		tool: "zip",
		bin: "zip",
		flags: [
			"-r",
			"-q",
			"-X",
			"-y",
			"-"
		],
		ext: ".zip"
	},
	tar: {
		tool: "tar",
		bin: "tar",
		flags: ["-czf", "-"],
		ext: ".tar.gz"
	}
};
/** Order the tools are tried in (the `.zip` output is the better default). */
const TOOL_ORDER = ["zip", "tar"];
/** How long one availability probe may take before the tool counts as absent. */
const PROBE_TIMEOUT_MS = 3e3;
/**
* Whether one candidate binary actually runs.
*
* `--version` rather than `--help`: Info-ZIP's `zip -h` is fine but bsdtar's
* help exits non-zero on some builds, and a tool that cannot answer
* `--version` is not one worth handing a user's directory to.
*/
function probeTool(bin, spawner) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (ok) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(ok);
		};
		let child;
		try {
			child = spawner(bin, ["--version"], {
				stdio: "ignore",
				windowsHide: true
			});
		} catch {
			finish(false);
			return;
		}
		const timer = setTimeout(() => {
			child.kill();
			finish(false);
		}, PROBE_TIMEOUT_MS);
		child.once("error", () => {
			finish(false);
		});
		child.once("exit", (code) => {
			finish(code === 0);
		});
	});
}
/** Probe result cache: one process-wide answer per tool. */
const availability = /* @__PURE__ */ new Map();
/**
* The archive tool this host will use, or undefined when it has neither.
*
* The answer is cached for the process: `zip` does not appear or disappear
* between two file-tree clicks, and a probe costs a process spawn.
*
* @param spawner - the spawn implementation (tests inject a fake).
* @returns the tool spec, or undefined when no tool is available.
*/
function resolveArchiveTool(spawner = spawn) {
	return tryTools(TOOL_ORDER, spawner);
}
/**
* Resolve the first available tool from an ordered list.
*
* @param order - tool names to try, in order.
* @param spawner - the spawn implementation.
* @returns the first tool that answers, or undefined.
*/
async function tryTools(order, spawner = spawn) {
	for (const tool of order) {
		const spec = TOOL_SPECS[tool];
		let pending = availability.get(tool);
		if (pending === void 0) {
			pending = probeTool(spec.bin, spawner).then((ok) => ok ? spec : void 0);
			availability.set(tool, pending);
		}
		const found = await pending;
		if (found !== void 0) return found;
	}
}
/** `/`-joined path segments, whatever separator the platform produced. */
function toArchiveName(path) {
	return sep === "/" ? path : path.split(sep).join("/");
}
/**
* Build the argv/cwd plan for one selection.
*
* The tool's working directory is the selections' deepest COMMON ancestor, and
* every selection is passed as its path relative to that directory — so the
* archive names reproduce the tree the user sees: one selection is named by
* its own basename (`src/`), two same-named files from different folders land
* under different parents, and a selection that IS the common ancestor pushes
* the base one level up so its name keeps a component.
*
* This replaces the old per-path "grow parent segments until unique" logic.
* A path relative to a common ancestor is unique by construction, so the
* disambiguation it performed is now a property of the layout instead of an
* algorithm.
*
* @param selections - absolute paths, already fenced by the caller.
* @param spec - the resolved tool.
* @returns the plan to spawn.
* @throws {SidebarError} bad-request when a selection has no usable name.
*/
function planArchive(selections, spec) {
	if (selections.length === 0) throw new SidebarError("bad-request", "no paths to archive");
	let base = commonAncestor(selections);
	if (selections.some((selection) => relative(base, selection) === "")) {
		const parent = dirname(base);
		if (parent === base) throw new SidebarError("bad-request", "cannot archive the filesystem root");
		base = parent;
	}
	const args = selections.map((selection) => toArchiveName(relative(base, selection)));
	if (args.some((name) => name === "" || name === ".." || name.startsWith("../"))) throw new SidebarError("bad-request", "selection is not below the archive root");
	return {
		spec,
		cwd: base,
		args: [...spec.flags, ...args]
	};
}
/**
* The deepest directory containing every selection.
*
* Walked segment by segment rather than by `dirname` until the paths agree, so
* a single selection resolves to its OWN directory (the case the archive needs:
* `zip -r archive.zip src` from the parent, not `zip -r archive.zip .` from
* inside `src`).
*/
function commonAncestor(selections) {
	const [first, ...rest] = selections;
	if (first === void 0) throw new SidebarError("bad-request", "no paths to archive");
	if (rest.length === 0) return dirname(first);
	let base = first;
	for (const selection of rest) while (!isWithin(base, selection)) {
		const parent = dirname(base);
		if (parent === base) return parent;
		base = parent;
	}
	return base;
}
/** Whether `target` is `base` itself or lives below it (lexically). */
function isWithin(base, target) {
	if (base === target) return true;
	const rel = relative(base, target);
	return rel !== "" && !rel.startsWith("..") && !rel.startsWith(`..${sep}`);
}
/**
* Run one planned tool, writing the archive to an already-open file handle.
*
* The caller owns the file descriptor: it stays open across the spawn so the
* tool writes straight into the temp file, and the caller closes it once this
* promise settles (closing it earlier would truncate a running child's output).
*
* @param plan - the plan from {@link planArchive}.
* @param outputFd - writable file descriptor for the archive bytes.
* @param spawner - the spawn implementation.
* @param onSpawn - receives the child as soon as it exists, so the caller can
*  hold on to it (plug-in teardown kills the builds it started).
* @returns the exit code and the stderr tail; never rejects for a tool that
*  ran and failed (a non-zero code is a result, not an exception).
* @throws {SidebarError} fs-error when the tool cannot be started at all.
*/
function runArchiveTool(plan, outputFd, spawner = spawn, onSpawn) {
	return new Promise((resolve, reject) => {
		const child = spawner(plan.spec.bin, plan.args, {
			cwd: plan.cwd,
			stdio: [
				"ignore",
				outputFd,
				"pipe"
			],
			windowsHide: true
		});
		onSpawn?.(child);
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
			if (stderr.length > 8192) stderr = stderr.slice(-4096);
		});
		child.once("error", (error) => {
			reject(new SidebarError("fs-error", `cannot run ${plan.spec.bin}: ${error.message}`));
		});
		child.once("close", (code) => {
			resolve({
				code: code ?? 1,
				stderr: stderr.slice(-4096).trim()
			});
		});
	});
}
/** The default in-archive stem when the caller named nothing usable. */
const DEFAULT_STEM = "archive";
/**
* Sanitize a caller-supplied archive NAME into a stem, then apply the tool's
* extension. Separators, control characters and quotes are stripped (a name
* must never look like a path), and any archive suffix the caller guessed is
* removed — the tool decides the real extension, not the client.
*
* @param raw - the requested name ('' or a bare suffix yields the default).
* @param ext - the extension the resolved tool produces ('.zip' / '.tar.gz').
* @returns a flat file name with that extension.
*/
function archiveFileName(raw, ext) {
	const cleaned = [...raw.trim().replace(/\.(?:zip|tar(?:\.gz)?|tgz)$/i, "").trim()].filter((char) => {
		const code = char.codePointAt(0);
		return char !== "/" && char !== "\\" && char !== "\"" && char !== "'" && code >= 32 && code !== 127;
	}).join("").trim().replace(/^\.+/, "").slice(0, 100);
	return `${cleaned === "" ? DEFAULT_STEM : cleaned}${ext}`;
}
/** The temporary archive file's name in the OS temp directory. */
function archiveTempName(id, ext) {
	return `dsh-better-sidebar-${id}${ext}`;
}
/** How long a finished (or failed) archive stays downloadable. */
const ARCHIVE_TTL_MS = 3e5;
/**
* The `content-disposition` value for one archive download.
*
* A non-latin1 name (a Chinese folder → `报告.zip`) CANNOT go into the header
* verbatim: Node's `writeHead` validates header values and rejects anything
* above U+00FF with `Invalid character in header content` — the route turned
* that into a 500. So the name is sent twice, exactly like `/sidebar/file`
* does for a download: an ASCII-only `filename="…"` fallback for old clients
* and the RFC 5987 `filename*=UTF-8''…` form (percent-encoded, therefore pure
* ASCII) for everyone else, which wins in every current browser.
*/
function contentDispositionOf(name) {
	return `attachment; filename="${asciiFallbackOf(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
/**
* The ASCII-only fallback of a download name: characters a quoted header
* string cannot carry (or that no latin1 client could render) drop out, and a
* stray quote or backslash does too. A result with no stem left (`''` or a
* bare extension, as a fully non-latin1 name reduces to) becomes
* `download.zip`, so the header always names a usable file.
*/
function asciiFallbackOf(name) {
	const ascii = [...name].filter((char) => {
		const code = char.codePointAt(0);
		return code >= 32 && code <= 126 && char !== "\"" && char !== "\\";
	}).join("");
	const stem = ascii.replace(/\.(?:zip|tar\.gz)$/i, "");
	if (stem === "" || /^\.+$/.test(stem)) return "download.zip";
	return ascii;
}
/**
* Answer one `GET /sidebar/archive?id=&sessionId=` from the task table.
*
* Split out of index.ts because this mapping IS the contract: 400 without
* both parameters, 403 for another session's task, 409 while it builds, 410
* for a failed build, 404 for unknown/expired/already-downloaded, 200 with the
* RFC 5987 disposition otherwise. Kept here so all six branches are testable
* without a live cordis mount.
*
* The bytes are STREAMED from the temp file and the task is released only once
* the stream settles: releasing first (as the buffered version could) would
* unlink the file the response is still reading from.
*
* @param tasks - the plugin's task table.
* @param query - the request's `sessionId` / `id` values (null = absent).
* @param res - the response face.
* @throws {SidebarError} for every non-200 branch (callers turn it into the
*  JSON error envelope they already use). Thrown BEFORE any header commits, so
*  the envelope is still deliverable.
*/
async function respondArchiveDownload(tasks, query, res) {
	if (query.sessionId === null || query.id === null || query.id === "") throw new SidebarError("bad-request", "sessionId and id are required");
	const found = tasks.lookup(query.id, query.sessionId);
	if (!found.ok || found.task.state !== "ready" || found.task.file === void 0) {
		if (found.ok) throw new SidebarError("not-found", "archive is gone", 404);
		if (found.reason === "building") throw new SidebarError("bad-request", found.message, 409);
		if (found.reason === "forbidden") throw new SidebarError("forbidden", found.message, 403);
		if (found.reason === "error") throw new SidebarError("fs-error", found.message, 410);
		throw new SidebarError("not-found", found.message, 404);
	}
	const { name, file } = found.task;
	const id = found.task.id;
	try {
		await streamFileToResponse(file.path, file.size, res, {
			"content-type": name.endsWith(".tar.gz") ? "application/gzip" : "application/zip",
			"content-disposition": contentDispositionOf(name),
			"cache-control": "no-cache"
		});
	} finally {
		tasks.release(id);
	}
}
/** Create one archive task table (one per plugin mount). */
function createArchiveTasks(options = {}) {
	const tasks = /* @__PURE__ */ new Map();
	/** Running children, by task id (teardown kills them). */
	const children = /* @__PURE__ */ new Map();
	const spawner = options.spawn ?? void 0;
	const tempPathOf = (id, ext) => join(options.tempDir ?? tmpdir(), archiveTempName(id, ext));
	/** Drop settled tasks past their TTL, deleting the temp files they held. */
	const sweep = (now) => {
		for (const [id, task] of tasks) {
			if (task.state === "building" || task.expiresAt > now) continue;
			tasks.delete(id);
			if (task.file !== void 0) rm(task.file.path, { force: true }).catch(() => {});
		}
	};
	/** The task one (id, sessionId) pair names, or why it cannot be read. */
	const lookup = (id, sessionId) => {
		sweep(Date.now());
		const task = tasks.get(id);
		if (task === void 0) return {
			ok: false,
			reason: "missing",
			message: "unknown or expired archive"
		};
		if (task.sessionId !== sessionId) return {
			ok: false,
			reason: "forbidden",
			message: "archive belongs to another session"
		};
		if (task.state === "building") return {
			ok: false,
			reason: "building",
			message: "archive is still being built"
		};
		if (task.state === "error") return {
			ok: false,
			reason: "error",
			message: task.error ?? "archive failed"
		};
		return {
			ok: true,
			task
		};
	};
	return {
		async start({ sessionId, name, paths }) {
			sweep(Date.now());
			let building = 0;
			for (const task of tasks.values()) if (task.state === "building") building += 1;
			if (building >= 4) throw new SidebarError("bad-request", `too many archives are being built (max 4)`, 409);
			const spec = await (options.resolveTool ?? resolveArchiveTool)(spawner);
			if (spec === void 0) throw new SidebarError("unavailable", "no archive tool is available: neither zip nor tar could be run", 501);
			const plan = planArchive(paths, spec);
			const id = `ar-${randomUUID()}`;
			const finalName = archiveFileName(name, spec.ext);
			const tempPath = tempPathOf(id, spec.ext);
			const task = {
				id,
				sessionId,
				name: finalName,
				state: "building",
				bytes: 0,
				expiresAt: Number.POSITIVE_INFINITY
			};
			tasks.set(id, task);
			pack(id, task, plan, tempPath, spawner);
			return {
				id,
				name: finalName,
				entries: paths.length
			};
		},
		status(id, sessionId) {
			sweep(Date.now());
			const task = tasks.get(id);
			if (task === void 0) throw new SidebarError("not-found", "unknown or expired archive", 404);
			if (task.sessionId !== sessionId) throw new SidebarError("forbidden", "archive belongs to another session", 403);
			return {
				state: task.state,
				bytes: task.bytes,
				...task.error === void 0 ? {} : { error: task.error }
			};
		},
		lookup,
		release(id) {
			const task = tasks.get(id);
			tasks.delete(id);
			if (task?.file !== void 0) rm(task.file.path, { force: true }).catch(() => {});
		},
		size() {
			sweep(Date.now());
			return tasks.size;
		},
		dispose() {
			for (const child of children.values()) try {
				child.kill();
			} catch {}
			children.clear();
			for (const task of tasks.values()) if (task.file !== void 0) rm(task.file.path, { force: true }).catch(() => {});
			tasks.clear();
		}
	};
	/**
	* Pack one task: open the temp file, hand its descriptor to the tool, and
	* settle the task from the exit code.
	*
	* The descriptor stays open across the spawn and is closed only after the
	* child exits — closing it earlier would truncate output still being written.
	*/
	async function pack(id, task, plan, tempPath, spawner) {
		const settle = (error) => {
			task.state = error === void 0 ? "ready" : "error";
			if (error !== void 0) task.error = error;
			task.expiresAt = Date.now() + ARCHIVE_TTL_MS;
			children.delete(id);
		};
		let handle;
		try {
			handle = await open(tempPath, "w");
			const result = await runArchiveTool(plan, handle.fd, spawner, (child) => {
				children.set(id, child);
			});
			await handle.close();
			handle = void 0;
			if (result.code !== 0) {
				settle(result.stderr === "" ? `${plan.spec.bin} exited with code ${result.code}` : result.stderr);
				await rm(tempPath, { force: true }).catch(() => {});
				return;
			}
			const info = await stat(tempPath).catch(() => void 0);
			if (info === void 0) {
				settle(`${plan.spec.bin} produced no archive`);
				return;
			}
			task.bytes = info.size;
			task.file = {
				path: tempPath,
				size: info.size
			};
			settle(void 0);
		} catch (error) {
			await handle?.close().catch(() => {});
			task.bytes = await stat(tempPath).then((info) => info.size).catch(() => 0);
			settle(error instanceof Error ? error.message : String(error));
			await rm(tempPath, { force: true }).catch(() => {});
		}
	}
}
//#endregion
//#region src/git-graph.ts
const MAX_OUTPUT = 8388608;
const MAX_OFFSET = 1e4;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const fail = (message, code = "bad-request") => {
	throw new GitCommandError(message, code, "graph");
};
/** Separate read-only runner: bounded buffers, no prompts/lazy network fetches,
* replacement objects or optional index writes. Never pass client revisions. */
function readGit(cwd, args, allowMissing = false) {
	return new Promise((resolve, reject) => {
		execFile("git", [
			"-C",
			cwd,
			"--no-pager",
			"--no-replace-objects",
			"-c",
			"color.ui=false",
			...args
		], {
			encoding: "utf8",
			timeout: 1e4,
			maxBuffer: MAX_OUTPUT,
			windowsHide: true,
			env: {
				...process.env,
				LC_ALL: "C",
				GIT_OPTIONAL_LOCKS: "0",
				GIT_TERMINAL_PROMPT: "0",
				GIT_NO_LAZY_FETCH: "1"
			}
		}, (error, stdout, stderr) => {
			if (!error) return resolve(stdout);
			if (allowMissing && error.code === 1 && !stderr.trim()) return resolve("");
			reject(new GitCommandError(stderr.trim() || error.message, "git-error", args[0] ?? "graph"));
		});
	});
}
function cursorOf(value) {
	if (value === void 0) return void 0;
	if (typeof value !== "string" || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) fail("Invalid graph cursor");
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
		if (parsed?.version !== 1 || !/^[a-f0-9]{64}$/.test(parsed.fingerprint) || !Number.isSafeInteger(parsed.offset) || parsed.offset < 1 || parsed.offset > MAX_OFFSET) fail("Invalid graph cursor");
		return parsed;
	} catch {
		return fail("Invalid graph cursor");
	}
}
async function snapshotOf(root, branch) {
	const branches = (await readGit(root, [
		"for-each-ref",
		"--sort=refname",
		"--format=%(refname)%00%(objectname)",
		"refs/heads/",
		"refs/remotes/"
	])).trimEnd().split("\n").filter(Boolean).map((line) => {
		const [ref, hashFull] = line.split("\0");
		if (!ref || !hashFull || !OID.test(hashFull)) return fail("Invalid Git reference output", "git-error");
		return {
			ref,
			name: ref.replace(/^refs\/(heads|remotes)\//, ""),
			hashFull
		};
	});
	if (branches.length > 1e3) fail("Too many branches for graph (limit 1000)", "graph-limit");
	const head = (await readGit(root, [
		"rev-parse",
		"--verify",
		"--quiet",
		"HEAD"
	], true)).trim();
	const symbolicHead = (await readGit(root, [
		"symbolic-ref",
		"--quiet",
		"HEAD"
	], true)).trim();
	if (head && !OID.test(head)) fail("Invalid HEAD", "git-error");
	if (!head && (!symbolicHead || branches.some((item) => item.ref === symbolicHead))) fail("Cannot resolve HEAD", "git-error");
	const fingerprint = createHash("sha256").update(JSON.stringify({
		root,
		branch,
		branches,
		head,
		symbolicHead
	})).digest("hex");
	const selected = branch === void 0 ? void 0 : branches.find((item) => item.ref === branch);
	const tips = branch === void 0 ? [.../* @__PURE__ */ new Set([...branches.map((item) => item.hashFull), ...head ? [head] : []])].sort() : selected ? [selected.hashFull] : [];
	const decorations = /* @__PURE__ */ new Map();
	for (const item of branches) decorations.set(item.hashFull, [...decorations.get(item.hashFull) ?? [], item.name]);
	if (head) decorations.set(head, ["HEAD", ...decorations.get(head) ?? []]);
	return {
		branches,
		fingerprint,
		tips,
		decorations,
		selected
	};
}
/** Immutable OID traversal + before/after ref fingerprints prevents concatenating
* pages from different histories. No server cache or repository mutation. */
async function gitGraph(cwd, options = {}, selectedRepo) {
	const { branch, count = 50 } = options;
	if (branch !== void 0 && (typeof branch !== "string" || branch.length > 1024 || !/^refs\/(heads|remotes)\/.+/.test(branch))) fail("Expected a full local or remote branch ref");
	if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) fail("Invalid graph count");
	const limit = Math.min(count, 200);
	const cursor = cursorOf(options.cursor);
	let root;
	try {
		root = (await readGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
		if (selectedRepo !== void 0) root = await repoRoot(cwd, selectedRepo);
	} catch (error) {
		if (!(error instanceof GitCommandError) || !/^fatal: not a git repository(?: \(|:)/.test(error.message)) throw error;
		try {
			root = await repoRoot(cwd, selectedRepo);
		} catch (discoveryError) {
			if (!(discoveryError instanceof GitCommandError) || discoveryError.code !== "not-repo") throw discoveryError;
			if (cursor) fail("Graph repository changed; refresh", "graph-stale");
			return {
				isRepo: false,
				entries: [],
				branches: [],
				hasMore: false,
				snapshot: ""
			};
		}
		root = (await readGit(root, ["rev-parse", "--show-toplevel"])).trim();
	}
	const before = await snapshotOf(root, branch);
	if (cursor && cursor.fingerprint !== before.fingerprint) fail("Graph changed; refresh", "graph-stale");
	if (branch !== void 0 && !before.selected) fail("Unknown graph branch");
	const offset = cursor?.offset ?? 0;
	const entries = [];
	if (before.tips.length) {
		const fields = (await readGit(root, [
			"log",
			"--topo-order",
			"--no-decorate",
			"--no-show-signature",
			"--encoding=UTF-8",
			`--max-count=${limit + 1}`,
			`--skip=${offset}`,
			"--format=%H%x00%P%x00%an%x00%ai%x00%s%x00%B%x00",
			...before.tips,
			"--"
		])).split("\0");
		for (let i = 0; i + 5 < fields.length; i += 6) {
			const hashFull = fields[i].trim();
			const parents = fields[i + 1].split(" ").filter(Boolean);
			if (!OID.test(hashFull) || parents.some((parent) => !OID.test(parent))) fail("Invalid Git graph output", "git-error");
			entries.push({
				hash: hashFull.slice(0, 7),
				hashFull,
				parents,
				author: fields[i + 2],
				date: fields[i + 3],
				subject: fields[i + 4],
				message: fields[i + 5],
				refs: before.decorations.get(hashFull) ?? []
			});
		}
	}
	if ((await snapshotOf(root, branch)).fingerprint !== before.fingerprint) fail("Graph changed; refresh", "graph-stale");
	const hasMore = entries.length > limit;
	if (hasMore && offset + limit > MAX_OFFSET) fail("Graph history limit reached (10000)", "graph-limit");
	return {
		isRepo: true,
		root,
		entries: entries.slice(0, limit),
		branches: before.branches,
		hasMore,
		...hasMore ? { nextCursor: Buffer.from(JSON.stringify({
			version: 1,
			fingerprint: before.fingerprint,
			offset: offset + limit
		})).toString("base64url") } : {},
		snapshot: before.fingerprint
	};
}
//#endregion
//#region src/agent-opens.ts
/**
* The model-facing `sidebar_open` tool and its delivery registry.
*
* One tool lets the model actively open a local file, a local folder (as a
* tree rooted there), or an HTTP(S) page in the CALLING session's sidebar.
* Mirroring the agent-terminal tools, the tool binds to the calling agent's
* session through `exec.agent.session.id` — the model never passes a
* sessionId, and opens for non-active sessions are queued until that
* session's sidebar view is next connected.
*
* Delivery is a host→browser push over the dedicated `/sidebar/ws/agent-opens`
* endpoint (the same pattern as `/sidebar/ws/agent-terminals`): the registry
* keeps a per-session queue; a push is consumed on send (`delivered: true`
* means a sidebar view was attached at call time), otherwise the request
* stays queued and is replayed when a view for that session attaches.
*
* Conventions (per plugin-development-guide.md §3):
*   C1 — parameters schema-validated before `execute` runs.
*   C4 — `execute` returns one canonical JSON value; `render` is a separate
*        pure text projection.
*   C6 — `exec.signal.throwIfAborted()` before any fs work.
*   C10 — no UI/transport vocabulary in the canonical value.
*/
/**
* Cap on one session's queue of un-delivered opens. A session whose sidebar is
* never shown (a long unattended run that keeps opening files) would otherwise
* grow this array for the lifetime of the host process; past the cap the OLDEST
* queued opens are dropped, so the newest intent survives and the order of what
* remains is still FIFO.
*/
const AGENT_OPEN_QUEUE_MAX = 64;
/**
* Per-session queue of open requests plus the connected sidebar views.
*
* Lifecycle: `enqueue` adds a request and — when at least one view for the
* session is attached — pushes it immediately and removes it from the queue
* (consume-on-send: a reconnect must never replay an open the client already
* applied, and the browser tab type has no per-URL dedupe, so replaying
* would mint duplicate tabs). With no attached view the request stays queued
* and `attach` replays it on connect. `drainAll` drops every queued request
* (the feature was turned off); `dispose` also drops every subscriber.
*/
var AgentOpenRegistry = class {
	pending = /* @__PURE__ */ new Map();
	subscribers = /* @__PURE__ */ new Map();
	/** Queue one open and deliver it immediately when a view is attached.
	* @returns the request id and whether a connected view received it now. */
	enqueue(sessionId, kind, target, title) {
		const request = {
			id: randomUUID(),
			sessionId,
			kind,
			target,
			title
		};
		const list = this.pending.get(sessionId) ?? [];
		list.push(request);
		if (list.length > AGENT_OPEN_QUEUE_MAX) list.splice(0, list.length - AGENT_OPEN_QUEUE_MAX);
		this.pending.set(sessionId, list);
		const views = this.subscribers.get(sessionId);
		if (views !== void 0 && views.size > 0) {
			for (const send of views) send(request);
			this.pending.delete(sessionId);
			return {
				id: request.id,
				delivered: true
			};
		}
		return {
			id: request.id,
			delivered: false
		};
	}
	/** Attach one sidebar view (replays queued requests; consume-on-send).
	* @returns the disposer detaching the view. */
	attach(sessionId, send) {
		let views = this.subscribers.get(sessionId);
		if (views === void 0) {
			views = /* @__PURE__ */ new Set();
			this.subscribers.set(sessionId, views);
		}
		views.add(send);
		const queued = this.pending.get(sessionId) ?? [];
		if (queued.length > 0) {
			for (const request of queued) send(request);
			this.pending.delete(sessionId);
		}
		return () => {
			const current = this.subscribers.get(sessionId);
			current?.delete(send);
			if (current !== void 0 && current.size === 0) this.subscribers.delete(sessionId);
		};
	}
	/** Drop every queued request (the feature was turned off mid-session). */
	drainAll() {
		this.pending.clear();
	}
	/** Drop the queue and every subscriber (plugin teardown). */
	dispose() {
		this.pending.clear();
		this.subscribers.clear();
	}
};
/** Extract the calling agent or throw the canonical "no agent" error. */
function requireAgent(agent) {
	if (agent === void 0) throw new Error("sidebar_open requires an initiating agent");
	return agent;
}
/** Resolve the calling agent's session id (the queue scope + ownership key). */
function sessionIdOf(exec) {
	return requireAgent(exec.agent).session.id;
}
/** Pure text projection helper (the canonical value is already structured). */
function textRender(fn) {
	return (_args, value) => [{
		type: "text",
		text: fn(value)
	}];
}
/** Classify a raw target: http(s) URL or a local path (stat-driven). */
async function classifyTarget(raw, cwd) {
	if (/^https?:\/\//i.test(raw)) {
		let parsed;
		try {
			parsed = new URL(raw);
		} catch {
			throw new Error(`"${raw}" is not a valid URL`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("sidebar_open only accepts http:// and https:// URLs");
		return {
			kind: "url",
			target: raw,
			title: parsed.hostname !== "" ? parsed.hostname : raw
		};
	}
	if (!isWindowsDrivePrefix(raw) && /^[a-z][a-z0-9+.-]*:/i.test(raw)) throw new Error("sidebar_open only accepts http:// and https:// URLs; use a local path for files");
	const target = resolve(isAbsolute(raw) ? raw : join(cwd, raw));
	let info;
	try {
		info = await stat(target);
	} catch (error) {
		const code = error.code;
		if (code === "ENOENT") throw new Error(`"${raw}" does not exist (resolved to "${target}")`, { cause: error });
		if (code === "EACCES" || code === "EPERM") throw new Error(`"${target}" is not readable`, { cause: error });
		throw new Error(`cannot open "${target}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	const title = basenameOf(target);
	return {
		kind: info.isDirectory() ? "folder" : "file",
		target,
		title: title === "" ? raw : title
	};
}
/** The last path segment (mirror of the client's FileTree baseName). */
function basenameOf(path) {
	const trimmed = path.replace(/[\\/]+$/, "");
	const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return at === -1 ? trimmed : trimmed.slice(at + 1);
}
/** Whether a raw target starts with a Windows drive prefix (`C:\` / `C:/`). */
function isWindowsDrivePrefix(raw) {
	return /^[a-zA-Z]:[\\/]/.test(raw);
}
/**
* Register the `sidebar_open` tool against the host tool registry. The tool
* is gated by the side-card setting `agentOpenTools` (the caller registers
* and unregisters it); `readPrefs` supplies the live prefs so a disabled
* target tab type (editor/browser) is reported to the model instead of
* silently no-oping on the client. `resolveCwd` threads the calling
* session's live cwd so relative paths resolve the same way the sidebar's
* own routes do.
* @param ctx - host plugin context (carries the tools service).
* @param registry - the open-request registry (per-session queue + views).
* @param resolveCwd - async cwd resolver for one session id. Resolves through
*  the session header, the client-supplied cwd, and the persistence index
*  before falling back to the host process cwd (production always provides
*  persistence, so the fallback is reached only in tests / stripped-down hosts).
* @param readPrefs - live resolved side card prefs (for tab enable gates).
* @returns a disposer that unregisters the tool.
*/
function registerOpenTool(ctx, registry, resolveCwd, readPrefs) {
	return ctx.tools.register(defineTool({
		name: "sidebar_open",
		description: "Open a local file, a local folder, or an HTTP(S) page in the sidebar of the calling conversation. A file opens in the sidebar editor (per-path dedupe: an already-open file is focused); a folder opens a file window whose tree is rooted at that folder; a URL opens in the sidebar browser (sandboxed iframe). The panel auto-expands for content opens and the tab title defaults to the file/folder name or the URL hostname. The path may be absolute or relative to the session working directory. The open lands in the CALLING session's sidebar: while that session's sidebar view is not connected (e.g. the session is not the active one), the open is queued and delivered when the session sidebar is next shown — the result reports `delivered` so you know whether it is visible right now. The side card setting \"model opens files/folders/pages in the sidebar\" must be on, and the target tab type must be enabled in that session's settings.",
		parameters: {
			target: {
				type: "string",
				required: true,
				description: "Absolute or session-cwd-relative local path, or an http:// / https:// URL."
			},
			title: {
				type: "string",
				description: "Optional tab title (defaults to the file/folder name or the URL hostname)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					kind: {
						type: "string",
						required: true,
						description: "What was opened: file | folder | url."
					},
					target: {
						type: "string",
						required: true,
						description: "The absolute path or URL the open was requested for."
					},
					title: {
						type: "string",
						required: true,
						description: "The tab title used (provided title, basename, or hostname)."
					},
					delivered: {
						type: "boolean",
						required: true,
						description: "Whether the open was pushed to a connected sidebar at call time (false = queued until the session sidebar is next shown)."
					}
				}
			},
			render: textRender((v) => v.delivered ? `Opened ${v.kind} "${v.title}" (${v.target}) in the sidebar.` : `Requested opening ${v.kind} "${v.title}" (${v.target}) in the sidebar — the session sidebar is not connected yet, so the open is queued and will appear when it is next shown.`)
		},
		execute: async (args, exec) => {
			exec.signal.throwIfAborted();
			const sessionId = sessionIdOf(exec);
			const cwd = await resolveCwd(sessionId);
			const { kind, target, title: defaultTitle } = await classifyTarget(args.target, cwd);
			const prefs = readPrefs();
			const tab = kind === "url" ? "browser" : "editor";
			if (prefs.tabsEnabled[tab] === false) throw new Error(`the built-in ${tab} tab is disabled in the side card settings; ask the user to enable it (or disable this tool)`);
			const title = args.title !== void 0 && args.title.trim() !== "" ? args.title : defaultTitle;
			const { delivered } = registry.enqueue(sessionId, kind, target, title);
			return {
				kind,
				target,
				title,
				delivered
			};
		}
	}));
}
//#endregion
//#region src/sidechat-core.ts
/** The durable thread-label prefix (also the row filter in the client list). */
const SIDE_LABEL_PREFIX = "Side: ";
/** The pinned label of a freshly created thread that no prompt has reached
*  yet (Codex-style immediate create: the tab opens an EMPTY thread, the
*  first composer message carries the boundary and earns the real label).
*  The client renders it localized; the prefix keeps the row filter honest. */
const SIDE_NEW_THREAD_TITLE = "Side: New thread";
/** The plugin's producer-owned source kind, stamped on the source of
*  context-injection messages (boundary prompt + parked snapshot) so the
*  transcript recognizes them structurally — not by text prefix. Session
*  format v4 retired the bare `kind: 'plugin'` + `plugin` pair; a plugin is
*  now identified by its own `plugin:<name>` kind, which is exactly what
*  DSH's own v3→v4 migration derives for rows this plugin wrote earlier, so
*  both generations read back under one shape. */
const SIDE_INJECTION_SOURCE_KIND = "plugin:dsh-better-sidebar";
/**
* The boundary prompt delivered as the thread's first user message: the
* inherited seed is reference context only, never active instruction.
* Model-facing contract — change only with intent, tests pin the sentences.
*/
const SIDE_BOUNDARY_PROMPT = `Side conversation boundary.

Everything before this boundary is inherited history from the parent session: its completed turns, its pending question, and — if the parent was mid-turn — its in-progress output frozen at the moment this side conversation started. It is reference context only. It is not your current task.

Do not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.

Mode: this is a continuable side conversation. Your answers stay in this side thread and are viewed in the side panel; they are never delivered into the parent session.`;
/**
* Project buffered live chunks into wire rows.
* @param chunks - the session's active-attempt chunks, in index order.
* @param tailSeq - the session's last durable seq (live rows order after it).
* @returns the rows to append to the transcript feed.
*/
function liveEventsOf(chunks, tailSeq) {
	return chunks.map((delta, position) => ({
		type: "assistant/live-chunk",
		seq: tailSeq + 1 + position,
		time: delta.time,
		data: {
			attemptId: delta.attemptId,
			turn: delta.turn,
			step: delta.step,
			index: delta.index,
			chunk: delta.chunk
		}
	}));
}
/** The data record of one event (narrowed from the loose face). */
function dataOf(event) {
	return event.data;
}
/** Copy parent events verbatim (their live seq === array index contract).
*  The FULL envelope is preserved — stripping `surfaceOp` would make the
*  seed validator reject every surface-eligible message event. */
function copyEvents(events) {
	return events.map((event) => {
		const source = event;
		return {
			type: source.type,
			seq: source.seq,
			time: source.time,
			data: dataOf(source),
			...source.surfaceOp === void 0 ? {} : { surfaceOp: source.surfaceOp },
			...source.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: source.sourceEventSeqs },
			...source.ignorable === void 0 ? {} : { ignorable: source.ignorable }
		};
	});
}
/** Index of the last `turn/start` or `turn/end`, or -1. */
function lastTurnBoundary(events) {
	for (let index = events.length - 1; index >= 0; index--) {
		const type = events[index]?.type;
		if (type === "turn/start" || type === "turn/end") return index;
	}
	return -1;
}
/** Numeric field of an event's data (turn / step numbers). */
function numberAt(data, key) {
	const value = data[key];
	return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}
/** The step number still open at the log tail inside the turn starting at
*  `turnStart` (undefined when no step is open). */
function openStepInTurn(events, turnStart) {
	let open;
	for (let index = turnStart + 1; index < events.length; index++) {
		const event = events[index];
		if (event === void 0) continue;
		if (event.type === "step/start") open = numberAt(dataOf(event), "step");
		else if (event.type === "step/end") open = void 0;
	}
	return open;
}
/**
* Whether the open turn ending the log has a `tool/call` without its paired
* `tool/result` in the CURRENT open step. Providers reject dangling
* assistant calls, so such a turn cannot be honestly closed and the
* inheritance must fall back to the snapshot.
*/
function hasDanglingToolCall(events, turnStart) {
	const pending = /* @__PURE__ */ new Set();
	for (let index = turnStart + 1; index < events.length; index++) {
		const event = events[index];
		if (event === void 0) continue;
		const data = dataOf(event);
		if (event.type === "step/end") {
			pending.clear();
			continue;
		}
		if (event.type === "tool/call") {
			const callId = data.callId;
			if (typeof callId === "string") pending.add(callId);
			continue;
		}
		if (event.type === "tool/result") {
			const callId = data.message?.source?.callId;
			if (typeof callId === "string") pending.delete(callId);
		}
	}
	return pending.size > 0;
}
/**
* The result content blocks of one tool/result message under BOTH logged
* shapes: 0.1.6 wrapped them in a single `type: 'tool-result'` content block
* on a user-role message, 0.1.7's first-class tool-role message carries them
* at the message's own top level. Historical logs keep the old shape forever,
* so both are read. Undefined when the message carries no block array.
*/
function resultBlocks(content) {
	if (!Array.isArray(content)) return void 0;
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		const wrapper = block;
		if (wrapper.type === "tool-result" && Array.isArray(wrapper.content)) return wrapper.content;
	}
	return content;
}
/** The plain text of one tool/result message (its text blocks, under either
*  of the two shapes {@link resultBlocks} reads). */
function toolResultText(data) {
	const message = data.message;
	const blocks = resultBlocks(message?.content);
	if (blocks === void 0) return "";
	const parts = [];
	for (const item of blocks) {
		if (item === null || typeof item !== "object") continue;
		const textItem = item;
		if (textItem.type === "text" && typeof textItem.text === "string") parts.push(textItem.text);
	}
	return parts.join("\n");
}
/** Cap applied to one tool-result's text inside a snapshot (prompt budget). */
const SNAPSHOT_RESULT_CAP = 2e3;
/** Cap applied to the whole snapshot (prompt budget). */
const SNAPSHOT_TOTAL_CAP = 8e3;
/**
* Rebase the parent's log onto its last summarizing compaction: the
* checkpoint `user/message` already REPLACES the shadowed span on the
* model-visible surface, so a child needs only the surviving head skeleton
* (with its turn/step scaffolding — the session relational invariants demand
* it), the checkpoint itself, and the keep-window + post-compaction tail
* VERBATIM — the forgotten span never has to be physically copied again,
* while every kept event keeps its enclosing structure. The result is
* verified with the real fold before it is used: the rebased sequence must
* produce the SAME visible nodes as the parent, which keeps the child's
* model context (and provider context-cache prefix) identical to a
* full-log fork.
*
* Returns a seq-contiguous event array, or undefined to fall back to the
* verbatim full copy — no compaction in the log, a reference the rebase
* cannot resolve, or any fold the construction cannot prove equivalent.
* Failures degrade to today's behavior, never to a wrong child.
* @param events - the parent's log (live or persisted).
* @returns the rebased log, or undefined when the full copy is required.
*/
function compactionTail(events) {
	const cut = lastCheckpointIndex(events);
	if (cut === void 0) return void 0;
	const checkpoint = events[cut];
	if (checkpoint === void 0) return void 0;
	let parentNodes;
	try {
		parentNodes = foldSurface(events).nodes;
	} catch {
		return;
	}
	const surfaceIndex = parentNodes.indexOf(checkpoint.seq);
	if (surfaceIndex === -1) return void 0;
	const head = [];
	let keepFirst;
	let sawTailNode = false;
	for (let index = 0; index < parentNodes.length; index++) {
		if (index === surfaceIndex) continue;
		const seq = parentNodes[index];
		if (seq >= cut) {
			if (index < surfaceIndex) return void 0;
			sawTailNode = true;
			continue;
		}
		if (sawTailNode) return void 0;
		if (index < surfaceIndex) head.push(seq);
		else if (keepFirst === void 0) keepFirst = seq;
	}
	const headEvents = headSkeleton(events, head);
	if (headEvents === void 0) return void 0;
	let keepStart = enclosingTurnStart(events, keepFirst);
	while (keepStart > 0 && events[keepStart - 1]?.type === "agent/inbox/spliced") keepStart -= 1;
	const groupId = dataOf(events[cut - 1]).compactionId;
	const surviving = new Set(parentNodes);
	const survivingCallIds = /* @__PURE__ */ new Set();
	for (const seq of parentNodes) {
		const node = events[seq];
		if (node === void 0 || node.type !== "tool/result") continue;
		const callId = toolResultCallIdOf(node);
		if (callId !== void 0) survivingCallIds.add(callId);
	}
	const replaceCovered = /* @__PURE__ */ new Set();
	for (const [from, to] of [[keepStart, cut], [cut + 1, events.length]]) for (let index = from; index < to; index++) {
		const event = events[index];
		if (event === void 0 || isCompactionGroupEvent(event, groupId)) continue;
		const op = event.surfaceOp;
		if (op === null || typeof op !== "object" || op.op !== "replace") continue;
		const start = op.startSeq;
		const end = op.endSeq;
		if (typeof start !== "number" || typeof end !== "number" || start > end) continue;
		for (let seq = Math.max(0, start); seq <= Math.min(end, events.length - 1); seq++) replaceCovered.add(seq);
	}
	const emittedSeqs = /* @__PURE__ */ new Set();
	for (const event of headEvents) emittedSeqs.add(event.seq);
	emittedSeqs.add(checkpoint.seq);
	const keepSkip = (event) => isSurfaceEligibleType(event.type) && !surviving.has(event.seq) && !replaceCovered.has(event.seq) || event.type === "tool/call" && !survivingCallIds.has(String(dataOf(event).callId));
	for (const [from, to] of [[keepStart, cut], [cut + 1, events.length]]) for (let index = from; index < to; index++) {
		const event = events[index];
		if (event === void 0) continue;
		if (isCompactionGroupEvent(event, groupId)) continue;
		if (index < cut && keepSkip(event)) continue;
		emittedSeqs.add(event.seq);
	}
	const droppedGroups = /* @__PURE__ */ new Set();
	const keptRunIds = /* @__PURE__ */ new Set();
	for (const seq of emittedSeqs) {
		const event = events[seq];
		if (event === void 0 || event.type !== "command/run") continue;
		const id = dataOf(event).commandId;
		if (typeof id === "string") keptRunIds.add(id);
	}
	const droppedDones = /* @__PURE__ */ new Set();
	for (const seq of emittedSeqs) {
		const event = events[seq];
		if (event === void 0) continue;
		const data = dataOf(event);
		if (event.type === "compaction/summary" || event.type === "compaction/prune") {
			const range = data.shadowedRange;
			const cited = data.shadowedSeqs;
			if (range === null || typeof range !== "object" || !Array.isArray(cited)) continue;
			const start = typeof range.start === "number" ? emittedSeqs.has(range.start) : true;
			const end = typeof range.end === "number" ? emittedSeqs.has(range.end) : true;
			const citedAll = cited.every((item) => typeof item !== "number" || emittedSeqs.has(item));
			if (!start || !end || !citedAll) {
				const id = data.compactionId;
				if (typeof id === "string") droppedGroups.add(id);
			}
		} else if (event.type === "command/done") {
			const id = data.commandId;
			const sourceSeq = data.sourceEventSeq;
			const runKept = typeof id === "string" && keptRunIds.has(id);
			const sourceKept = typeof sourceSeq !== "number" || emittedSeqs.has(sourceSeq);
			if (!runKept || !sourceKept) droppedDones.add(event.seq);
		}
	}
	const expectedFirstKeptTurn = headEvents.some((event) => event.type === "turn/start") ? 2 : 1;
	let firstKeptTurn;
	for (const [from, to] of [[keepStart, cut], [cut + 1, events.length]]) {
		for (let index = from; index < to; index++) {
			const event = events[index];
			if (event === void 0 || event.type !== "turn/start") continue;
			const turn = dataOf(event).turn;
			if (typeof turn === "number") firstKeptTurn = turn;
			break;
		}
		if (firstKeptTurn !== void 0) break;
	}
	const turnOffset = firstKeptTurn === void 0 ? 0 : Math.max(0, firstKeptTurn - expectedFirstKeptTurn);
	const rebase = /* @__PURE__ */ new Map();
	const seed = [];
	let aborted = false;
	const emit = (event) => {
		if (aborted || event === void 0) return;
		const rebased = rebaseEvent(event, seed.length, rebase, turnOffset, firstKeptTurn);
		if (rebased === DROPPED) return;
		if (rebased === void 0) {
			aborted = true;
			return;
		}
		rebase.set(event.seq, seed.length);
		seed.push(rebased);
	};
	for (const event of headEvents) emit(event);
	emit(checkpoint);
	for (let index = keepStart; index < cut; index++) {
		const event = events[index];
		if (event === void 0 || isCompactionGroupEvent(event, groupId)) continue;
		if (keepSkip(event)) continue;
		if (droppedGroups.has(String(dataOf(event).compactionId))) continue;
		if (droppedDones.has(event.seq)) continue;
		emit(event);
	}
	for (let index = cut + 1; index < events.length; index++) {
		const event = events[index];
		if (event === void 0 || isCompactionGroupEvent(event, groupId)) continue;
		if (droppedGroups.has(String(dataOf(event).compactionId))) continue;
		if (droppedDones.has(event.seq)) continue;
		emit(event);
	}
	if (aborted) return void 0;
	try {
		const child = foldSurface(seed);
		if (!sameVisibleSequence(events, parentNodes, child.nodes, seed)) return void 0;
	} catch {
		return;
	}
	if (!turnSequenceValid(seed)) return void 0;
	if (!inboxSplicesValid(seed)) return void 0;
	if (!bracketsValid(seed)) return void 0;
	return seed;
}
/**
* Relational pre-check mirroring the host's grouped-record rules: a
* successful `compaction/end` requires a `compaction/summary` of the same
* compactionId earlier in the log, and a `command/done` requires its
* `command/run` (same commandId) before it. Dropping a summary or a run
* with the forgotten span while keeping its partner would ship a seed the
* host's invariant companions reject, so any unmatched partner falls back
* to the full copy.
*/
function bracketsValid(seed) {
	const summarized = /* @__PURE__ */ new Set();
	const ranCommands = /* @__PURE__ */ new Set();
	for (const event of seed) {
		const data = dataOf(event);
		if (event.type === "compaction/summary") {
			const id = data.compactionId;
			if (typeof id === "string") summarized.add(id);
		} else if (event.type === "compaction/end") {
			const id = data.compactionId;
			if (data.error === void 0 && (typeof id !== "string" || !summarized.has(id))) return false;
		} else if (event.type === "command/run") {
			const id = data.commandId;
			if (typeof id === "string") ranCommands.add(id);
		} else if (event.type === "command/done") {
			const id = data.commandId;
			if (typeof id !== "string" || !ranCommands.has(id)) return false;
		}
	}
	return true;
}
/**
* Relational pre-check mirroring the host's durable-inbox fold: every kept
* `agent/inbox/spliced` event replays POSITIONALLY over the pending inbox
* (splice.start/removedCount must stay in range, message ids unique). A
* seed whose splice history cannot replay from an empty inbox falls back
* to the full copy.
*/
function inboxSplicesValid(seed) {
	const nextTurn = [];
	const nextStep = [];
	for (const event of seed) {
		if (event.type !== "agent/inbox/spliced") continue;
		const data = dataOf(event);
		if (data.target !== "next-turn" && data.target !== "next-step") return false;
		const inbox = data.target === "next-step" ? nextStep : nextTurn;
		const rawStart = data.start;
		const removedCount = typeof data.removedCount === "number" ? data.removedCount : 0;
		const inserted = Array.isArray(data.inserted) ? data.inserted : void 0;
		const start = typeof rawStart === "number" ? rawStart : NaN;
		if (inserted === void 0 || !Number.isSafeInteger(start) || start < 0 || start > inbox.length || !Number.isSafeInteger(removedCount) || removedCount < 0 || start + removedCount > inbox.length) return false;
		inbox.splice(start, removedCount, ...inserted);
		const ids = /* @__PURE__ */ new Set();
		for (const message of [...nextTurn, ...nextStep]) {
			const id = message.id;
			if (typeof id !== "string") return false;
			if (ids.has(id)) return false;
			ids.add(id);
		}
	}
	return true;
}
/**
* Relational pre-check mirroring the CORE of the session invariant's
* counters and tool pairing: turn numbers run 1, 2, … with no nested open
* turn; steps run 1, 2, … inside the open turn and close before their turn;
* in-turn message and tool/call events name the open turn/step when they
* carry numbers — except a NON-append tool/result, which the host exempts
* from step naming (pruner replacements carry their original step); a
* tool/result must consume a pending call of its step, and a step cannot
* close with calls pending. A trailing open turn or step is legal — the
* caller closes it. This is a core mirror, not the full host contract;
* anything it cannot prove falls back to the full copy.
*/
function turnSequenceValid(seed) {
	let nextTurn = 1;
	let nextStep = 1;
	let openTurn;
	let openStep;
	let pendingCalls = /* @__PURE__ */ new Set();
	for (const event of seed) {
		const data = dataOf(event);
		if (event.type === "turn/start") {
			if (openTurn !== void 0 || data.turn !== nextTurn) return false;
			openTurn = nextTurn;
			nextTurn += 1;
			nextStep = 1;
			openStep = void 0;
			pendingCalls = /* @__PURE__ */ new Set();
		} else if (event.type === "turn/end") {
			if (openTurn === void 0 || data.turn !== openTurn || openStep !== void 0) return false;
			openTurn = void 0;
		} else if (event.type === "step/start") {
			if (openTurn === void 0 || data.turn !== openTurn || openStep !== void 0) return false;
			if (data.step !== nextStep) return false;
			openStep = nextStep;
			nextStep += 1;
			pendingCalls = /* @__PURE__ */ new Set();
		} else if (event.type === "step/end") {
			if (openTurn === void 0 || openStep === void 0 || data.turn !== openTurn || data.step !== openStep) return false;
			if (pendingCalls.size > 0) return false;
			openStep = void 0;
		} else if (event.type === "tool/call") {
			if (typeof data.turn === "number" && data.turn !== openTurn) return false;
			if (typeof data.step === "number" && data.step !== openStep) return false;
			const callId = data.callId;
			if (typeof callId === "string" && callId !== "") pendingCalls.add(callId);
		} else if (event.type === "tool/result") {
			if (event.surfaceOp !== "append") {
				if (openTurn === void 0) return false;
				continue;
			}
			if (typeof data.turn === "number" && data.turn !== openTurn) return false;
			if (typeof data.step === "number" && data.step !== openStep) return false;
			const callId = toolResultCallIdOf(event);
			if (callId !== void 0 && !pendingCalls.delete(callId)) return false;
		} else if (isSurfaceEligibleType(event.type)) {
			if (typeof data.turn === "number" && data.turn !== openTurn) return false;
			if (typeof data.step === "number" && data.step !== openStep) return false;
		}
	}
	return true;
}
/** The callId a tool/result event's message cites, when it carries one. */
function toolResultCallIdOf(event) {
	if (event.type !== "tool/result") return void 0;
	const callId = dataOf(event).message?.source?.callId;
	return typeof callId === "string" && callId !== "" ? callId : void 0;
}
/**
* The surviving pre-cut head as a state-machine-complete event list: the
* head nodes (surface order == log order for surviving appends) wrapped in
* a turn/step skeleton NORMALIZED to turn 1 step 1 — the seed is a fresh
* log, the host's turn/step counters must start there, and the head node's
* original numbers are envelope metadata the rebase is free to rewrite
* (the protected system head can be a mid-session rewrite living in a later
* turn/step). Closers are recovered from the log when the skeleton's own
* closers were dropped with the span. A head wider than one step/turn (or
* numbers that disagree) is not a shape this builder represents and falls
* back to the full copy.
* @param events - the parent's log.
* @param head - seqs of the surviving pre-cut surface nodes before the
*  checkpoint's surface slot.
* @returns the head segment's events, or undefined when the shape is not
*  representable.
*/
function headSkeleton(events, head) {
	if (head.length === 0) return [];
	const first = events[head[0]];
	const last = events[head[head.length - 1]];
	if (first === void 0 || last === void 0) return void 0;
	let turnStart;
	let stepStart;
	for (let index = head[0] - 1; index >= 0; index--) {
		const event = events[index];
		if (event === void 0) break;
		if (event.type === "turn/end") break;
		if (event.type === "step/start" && stepStart === void 0) stepStart = event;
		if (event.type === "turn/start") {
			turnStart = event;
			break;
		}
	}
	const normalized = (event, over) => {
		const data = { ...dataOf(event) };
		if (over.turn !== void 0 && typeof data.turn === "number") data.turn = over.turn;
		if (over.step !== void 0 && typeof data.step === "number") data.step = over.step;
		return {
			...event,
			data
		};
	};
	const parts = [];
	if (turnStart !== void 0) {
		const turn = dataOf(turnStart).turn;
		if (typeof turn !== "number") return void 0;
		const step = stepStart !== void 0 ? dataOf(stepStart).step : void 0;
		if (stepStart !== void 0 && typeof step !== "number") return void 0;
		for (const seq of head) {
			const node = events[seq];
			if (node === void 0) return void 0;
			const nodeData = dataOf(node);
			if (nodeData.turn !== turn && nodeData.turn !== void 0) return void 0;
			if (stepStart !== void 0 && nodeData.step !== step && nodeData.step !== void 0) return void 0;
		}
		parts.push(normalized(turnStart, { turn: 1 }));
		if (stepStart !== void 0) parts.push(normalized(stepStart, {
			turn: 1,
			step: 1
		}));
		for (const seq of head) parts.push(normalized(events[seq], {
			turn: 1,
			...stepStart !== void 0 ? { step: 1 } : {}
		}));
		let closedStep = false;
		for (let index = head[head.length - 1] + 1; index < events.length; index++) {
			const event = events[index];
			if (event === void 0) break;
			if (!closedStep && event.type === "step/end" && typeof step === "number" && dataOf(event).step === step && dataOf(event).turn === turn) {
				parts.push(normalized(event, {
					turn: 1,
					step: 1
				}));
				closedStep = true;
				continue;
			}
			if (event.type === "turn/end" && dataOf(event).turn === turn) {
				parts.push(normalized(event, { turn: 1 }));
				break;
			}
			if (event.type === "turn/start") break;
		}
		return closedStep || step === void 0 ? parts : void 0;
	}
	for (const seq of head) {
		const node = events[seq];
		if (node === void 0) return void 0;
		parts.push(node);
	}
	return parts;
}
/** Log index of the turn/start enclosing one seq, the seq itself when the
*  node sits between turns (the keep window then starts verbatim at its own
*  skeleton root), or the log length when there is no keep window at all. */
function enclosingTurnStart(events, seq) {
	if (seq === void 0) return events.length;
	for (let index = seq - 1; index >= 0; index--) {
		const event = events[index];
		if (event === void 0) return seq;
		if (event.type === "turn/start") return index;
		if (event.type === "turn/end") return seq;
	}
	return seq;
}
/** Whether one event belongs to the compaction group being consumed (its
*  log-only start/summary/end records leave with the span they priced).
*  Other groups' records stay — they meter history the child keeps. A
*  summary without a `compactionId` is malformed; nothing is excluded for
*  it and the equivalence check decides. */
function isCompactionGroupEvent(event, groupId) {
	if (!event.type.startsWith("compaction/")) return false;
	if (typeof groupId !== "string") return false;
	return dataOf(event).compactionId === groupId;
}
/** Index of the checkpoint user/message of the last summarizing compaction:
*  the event right after a `compaction/summary` — that adjacency is the
*  shadow-price contract. An orphaned summary (its replacement never
*  landed) is skipped in favor of the previous complete one. */
function lastCheckpointIndex(events) {
	for (let index = events.length - 1; index >= 0; index--) {
		if (events[index]?.type !== "compaction/summary") continue;
		if (events[index + 1]?.type === "user/message") return index + 1;
	}
}
/** One `type` + model-visible-content token per visible node, mirroring the
*  renderer's projection: a user/message IS its whole data object, every
*  other surface event projects `data.message` (its envelope turn/step and
*  headerSeq are rewritten by the rebase and never reach the model). */
function visibleToken(event) {
	if (event === void 0) return "missing";
	if (event.type === "user/message") return `${event.type}:${JSON.stringify(dataOf(event))}`;
	const message = dataOf(event).message;
	return `${event.type}:${JSON.stringify(message ?? null)}`;
}
/** Compare the parent's visible nodes with the rebased child's by content. */
function sameVisibleSequence(parent, parentNodes, childNodes, child) {
	if (parentNodes.length !== childNodes.length) return false;
	for (let index = 0; index < parentNodes.length; index++) if (visibleToken(parent[parentNodes[index]]) !== visibleToken(child[childNodes[index]])) return false;
	return true;
}
/**
* Copy one kept event into the rebased sequence: envelope seq references
* are remapped through the rebase map, `data.turn` numbers at or past the
* first kept turn shift down by the gap the dropped span left (the host's
* turn counter must stay contiguous), and a seq reference the map cannot
* serve (it points into the dropped span) degrades the event honestly — a
* replace whose shadowed nodes are gone becomes an append, dropped
* citations vanish — except `developer/message.headerSeq`, whose referent
* cannot be degraded: that aborts the whole tail.
* @param event - the kept event to copy.
* @param seq - the event's position in the rebased sequence.
* @param rebase - old seq → rebased position over the kept set.
* @param turnOffset - turns removed before the keep window (0 = no shift).
* @param firstKeptTurn - the first kept turn number; smaller numbers are
*  head-side and never shift.
* @returns the rebased event, or undefined when the tail is not provable.
*/
/** Sentinel: the event is log-only metering whose referenced span did not
*  survive the rebase — drop it instead of aborting the whole tail. */
const DROPPED = Symbol("dropped");
function rebaseEvent(event, seq, rebase, turnOffset, firstKeptTurn) {
	const source = event;
	const seed = {
		type: source.type,
		seq,
		time: source.time,
		data: dataOf(source)
	};
	if (source.ignorable === true) seed.ignorable = true;
	const sourceData = dataOf(event);
	if (turnOffset > 0 && typeof sourceData.turn === "number" && firstKeptTurn !== void 0 && sourceData.turn >= firstKeptTurn) seed.data = {
		...seed.data,
		turn: sourceData.turn - turnOffset
	};
	if (event.type === "command/done" && typeof sourceData.sourceEventSeq === "number") {
		const mapped = rebase.get(sourceData.sourceEventSeq);
		if (mapped === void 0) return DROPPED;
		seed.data = {
			...seed.data,
			sourceEventSeq: mapped
		};
	}
	if (event.type === "compaction/summary" || event.type === "compaction/prune") {
		const range = sourceData.shadowedRange;
		const cited = sourceData.shadowedSeqs;
		if (range === null || typeof range !== "object" || !Array.isArray(cited)) return seed;
		const start = typeof range.start === "number" ? rebase.get(range.start) : void 0;
		const end = typeof range.end === "number" ? rebase.get(range.end) : void 0;
		const mapped = cited.map((item) => typeof item === "number" ? rebase.get(item) : void 0);
		if (start === void 0 || end === void 0 || mapped.includes(void 0)) return DROPPED;
		seed.data = {
			...seed.data,
			shadowedRange: {
				start,
				end
			},
			shadowedSeqs: mapped
		};
	}
	const headerSeq = sourceData.headerSeq;
	if (event.type === "developer/message" && typeof headerSeq === "number") {
		const mapped = rebase.get(headerSeq);
		if (mapped === void 0) return void 0;
		seed.data = {
			...seed.data,
			headerSeq: mapped
		};
	}
	const op = event.surfaceOp;
	if (op === "append") seed.surfaceOp = "append";
	else if (op !== null && typeof op === "object" && "op" in op && op.op === "replace") {
		const replace = op;
		const start = typeof replace.startSeq === "number" ? rebase.get(replace.startSeq) : void 0;
		const end = typeof replace.endSeq === "number" ? rebase.get(replace.endSeq) : void 0;
		seed.surfaceOp = start !== void 0 && end !== void 0 && start <= end ? {
			op: "replace",
			startSeq: start,
			endSeq: end
		} : "append";
	}
	const cited = event.sourceEventSeqs;
	if (Array.isArray(cited)) {
		const mapped = cited.map((item) => typeof item === "number" ? rebase.get(item) : void 0);
		if (!mapped.includes(void 0)) seed.sourceEventSeqs = mapped;
	}
	return seed;
}
/**
* Build the side-thread inheritance for one parent log: the full event log
* up to the click moment, honestly closed when it ends inside an open turn.
* When the parent has compacted, the log is first rebased onto its last
* summarizing compaction (`compactionTail`) — same model-visible surface, a
* fraction of the durable copy.
* @param events - the parent's log (live or persisted).
* @param live - the parent's in-flight stream chunks (DSH 0.1.5+ publishes
*   them outside the log); used only by the snapshot fallback.
*/
function buildSidechatInheritance(events, live = []) {
	if (events.length === 0) return {
		seed: [],
		snapshot: null
	};
	const log = compactionTail(events) ?? events;
	const boundary = lastTurnBoundary(log);
	if (boundary < 0 || log[boundary]?.type === "turn/end") return {
		seed: copyEvents(log),
		snapshot: null
	};
	if (hasDanglingToolCall(log, boundary)) return {
		seed: copyEvents(log.slice(0, boundary)),
		snapshot: buildOpenTurnSnapshot(log, live)
	};
	const seed = copyEvents(log);
	const last = log[log.length - 1];
	const turn = numberAt(dataOf(log[boundary]), "turn");
	const now = last?.time ?? 0;
	const openStep = openStepInTurn(log, boundary);
	if (openStep !== void 0) seed.push({
		type: "step/end",
		seq: seed.length,
		time: now,
		data: {
			turn,
			step: openStep
		}
	});
	seed.push({
		type: "turn/end",
		seq: seed.length,
		time: now,
		data: {
			turn,
			reason: { kind: "interrupted" }
		}
	});
	return {
		seed,
		snapshot: null
	};
}
/** One assistant content block reduced to the text the snapshot shows. */
function messageTexts(message) {
	const content = message?.content;
	let text = "";
	let reasoning = "";
	if (!Array.isArray(content)) return {
		text,
		reasoning
	};
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		const candidate = block;
		if (typeof candidate.text !== "string" || candidate.text === "") continue;
		if (candidate.type === "text") text += candidate.text;
		else if (candidate.type === "reasoning") reasoning += candidate.text;
	}
	return {
		text,
		reasoning
	};
}
/**
* Expand one attempt's compact `AssistantStreamRecord[]` (the durable stream
* DSH 0.1.5 embeds in `assistant/message.stream` and `assistant/attempt.stream`)
* into the text/reasoning it carried. Tool-call records contribute no text.
*/
function streamTexts(stream) {
	let text = "";
	let reasoning = "";
	if (!Array.isArray(stream)) return {
		text,
		reasoning
	};
	for (const record of stream) {
		if (record === null || typeof record !== "object") continue;
		const entry = record;
		if (entry.type === "text-chunks" || entry.type === "reasoning-chunks") {
			if (!Array.isArray(entry.texts)) continue;
			const joined = entry.texts.filter((part) => typeof part === "string").join("");
			if (entry.type === "text-chunks") text += joined;
			else reasoning += joined;
			continue;
		}
		if (entry.type === "chunk") {
			const chunk = entry.chunk;
			if (chunk === null || typeof chunk !== "object" || typeof chunk.text !== "string") continue;
			if (chunk.type === "text-delta") text += chunk.text;
			else if (chunk.type === "reasoning-delta") reasoning += chunk.text;
		}
	}
	return {
		text,
		reasoning
	};
}
/** One live delta's contribution to the snapshot. */
function liveTexts(chunk) {
	if (typeof chunk.text !== "string" || chunk.text === "") return {
		text: "",
		reasoning: ""
	};
	if (chunk.type === "text-delta") return {
		text: chunk.text,
		reasoning: ""
	};
	if (chunk.type === "reasoning-delta") return {
		text: "",
		reasoning: chunk.text
	};
	return {
		text: "",
		reasoning: ""
	};
}
/**
* Structured text snapshot of the parent's OPEN turn (from its `turn/start`
* to the log tail): the assistant/reasoning output so far and the tool
* activity — executed tools with their result text, the still-executing one
* marked. Returns null when there is no open turn or nothing to show.
*
* The in-flight step's text is NOT in the log on DSH 0.1.5 (the model stream
* is process-local until it settles), so it comes from `live`; settled steps
* read their durable `assistant/message` content, and a failed attempt reads
* its embedded `assistant/attempt.stream`.
* @param events - the parent's log.
* @param live - the parent's in-flight stream chunks, in index order.
*/
function buildOpenTurnSnapshot(events, live = []) {
	const boundary = lastTurnBoundary(events);
	if (boundary < 0 || events[boundary]?.type !== "turn/start") return null;
	const openTurn = numberAt(dataOf(events[boundary]), "turn");
	let text = "";
	let reasoning = "";
	const tools = [];
	const pendingCalls = /* @__PURE__ */ new Map();
	for (let index = boundary + 1; index < events.length; index++) {
		const event = events[index];
		if (event === void 0) continue;
		const data = dataOf(event);
		if (event.type === "step/end") {
			pendingCalls.clear();
			continue;
		}
		if (event.type === "assistant/message") {
			const settled = messageTexts(data.message);
			text += settled.text;
			reasoning += settled.reasoning;
			continue;
		}
		if (event.type === "assistant/attempt") {
			const attempt = streamTexts(data.stream);
			text += attempt.text;
			reasoning += attempt.reasoning;
			continue;
		}
		if (event.type === "tool/call") {
			const callId = data.callId;
			if (typeof callId === "string") pendingCalls.set(callId, {
				name: typeof data.name === "string" ? data.name : "tool",
				args: typeof data.arguments === "string" ? data.arguments : ""
			});
			continue;
		}
		if (event.type === "tool/result") {
			const source = data.message;
			const callId = typeof source?.source?.callId === "string" ? source.source.callId : void 0;
			const name = callId !== void 0 ? pendingCalls.get(callId)?.name : void 0;
			const args = callId !== void 0 ? pendingCalls.get(callId)?.args : void 0;
			if (callId !== void 0) pendingCalls.delete(callId);
			const result = toolResultText(data).slice(0, SNAPSHOT_RESULT_CAP);
			const failed = data.error !== void 0;
			const line = [`- \`${name ?? "tool"}\`${failed ? " (failed)" : ""}` + (args !== void 0 && args !== "" ? ` — arguments: \`${args}\`` : ""), ...result === "" ? [] : [`  Result: ${result}`]].join("\n");
			tools.push(line);
		}
	}
	for (const [, call] of pendingCalls) {
		const line = `- \`${call.name}\` (executing) — arguments: \`${call.args}\``;
		tools.push(line);
	}
	for (const delta of live) {
		if (delta.turn !== openTurn) continue;
		const contribution = liveTexts(delta.chunk);
		text += contribution.text;
		reasoning += contribution.reasoning;
	}
	const sections = [];
	if (text.trim() !== "") sections.push(`Assistant output so far:\n\n${text}`);
	if (reasoning.trim() !== "") sections.push(`Reasoning so far:\n\n${reasoning}`);
	if (tools.length > 0) sections.push(`Tool activity:\n${tools.join("\n")}`);
	if (sections.length === 0) return null;
	const body = sections.join("\n\n");
	return body.length > SNAPSHOT_TOTAL_CAP ? `Parent session in-progress turn (reference only):\n\n${body.slice(0, SNAPSHOT_TOTAL_CAP)}…` : `Parent session in-progress turn (reference only):\n\n${body}`;
}
/** Truncate + prefix a question into a durable thread label. */
function sideLabel(question) {
	const flat = question.replace(/\s+/g, " ").trim();
	const max = Math.max(1, 42);
	const body = flat.length > max ? `${flat.slice(0, 41)}…` : flat;
	return `${SIDE_LABEL_PREFIX}${body}`;
}
/**
* Whether the thread log already carries the side boundary message — i.e.
* the first prompt was delivered. Tolerant to the content shape (block
* array or bare string) and to inherited seed messages (only an OWN
* boundary message starts with the prefix; seed messages came from the
* parent's log, which never contains one).
*/
function boundaryDelivered(events) {
	for (const event of events) {
		if (event.type !== "user/message") continue;
		if (messageLeadText(dataOf(event)).startsWith("Side conversation boundary")) return true;
	}
	return false;
}
/** The leading text of a user/message's content (block array or bare string). */
function messageLeadText(data) {
	const content = data.content;
	const first = Array.isArray(content) ? content[0] : content;
	return typeof first === "string" ? first : typeof first === "object" && first !== null && "text" in first ? String(first.text) : "";
}
/** Flatten one pending message's content into the text the bubble shows. */
function pendingText(message) {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		const item = block;
		if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
	}
	return parts.join("\n");
}
/** The identity one inbox message carries (`MessageId`, a branded string). */
function pendingInputId(message) {
	const id = message?.id;
	return typeof id === "string" && id !== "" ? id : void 0;
}
/**
* Project one agent's inbox into wire rows, in CLAIM order: every `next-step`
* entry first, then the queued turns (the host's `Inbox.claim` drains exactly
* that way). Messages without an identity are skipped — they could not be
* dequeued, so showing them as pending would offer a dead button.
*/
function pendingInputs(nextStep, nextTurn) {
	const rows = [];
	const add = (message, target) => {
		const id = pendingInputId(message);
		if (id === void 0) return;
		rows.push({
			id,
			target,
			text: pendingText(message)
		});
	};
	for (const message of nextStep) add(message, "next-step");
	for (const message of nextTurn) add(message, "next-turn");
	return rows;
}
/**
* Fold a log's `agent/inbox/spliced` events into the message ids STILL pending
* after it — the durable record of the inbox (the host's own
* `inboxProjectionDefinition` semantics: apply every splice in order).
*
* This is the reading the ghost sweep needs: a seeded thread's inherited
* prefix can leave messages "pending" that the parent had already claimed
* (the claim splice sits inside the parent's open turn, which the seed
* truncation cuts away), and those must never be delivered as the child's
* own input.
* @param events - the log (or any prefix of it), contiguous from seq 0.
* @param limit - exclusive upper bound of event count to fold (the inherited
*   prefix length, or the whole log).
* @returns the ids of messages still pending after the folded events.
*/
function pendingIdsInLog(events, limit) {
	const nextTurn = [];
	const nextStep = [];
	const end = limit === void 0 ? events.length : Math.min(limit, events.length);
	for (let index = 0; index < end; index++) {
		const event = events[index];
		if (event === void 0 || event.type !== "agent/inbox/spliced") continue;
		const data = dataOf(event);
		const target = data.target === "next-step" ? nextStep : data.target === "next-turn" ? nextTurn : void 0;
		if (target === void 0) continue;
		const start = typeof data.start === "number" && Number.isSafeInteger(data.start) ? data.start : 0;
		const removed = typeof data.removedCount === "number" && Number.isSafeInteger(data.removedCount) ? data.removedCount : 0;
		const inserted = Array.isArray(data.inserted) ? data.inserted : [];
		target.splice(Math.max(0, Math.min(start, target.length)), Math.max(0, removed), ...inserted);
	}
	const ids = [];
	for (const message of [...nextStep, ...nextTurn]) {
		const id = pendingInputId(message);
		if (id !== void 0) ids.push(id);
	}
	return ids;
}
/**
* The message ids a seeded thread INHERITED as still-pending but never
* actually owned: fold only the inherited prefix (`[0, inheritedEventCount)`),
* which is exactly the region the parent's own claim splices may have been
* cut out of. The caller removes precisely these from the live inbox, so a
* user's genuinely queued side-thread input is never touched.
* @param events - the thread's log.
* @param inheritedEventCount - the thread's inherited prefix length.
* @returns the ghost message ids present in the prefix fold.
*/
function inheritedPendingIds(events, inheritedEventCount) {
	return pendingIdsInLog(events, Math.max(0, Math.trunc(inheritedEventCount)));
}
/**
* The thread's effective model selection: `pending ?? lastUsed` of its own
* `model/selection` / `request/header` fold (see {@link parentModelSelection},
* which this is the same projection as). Used by the routes to report what the
* thread will actually request with.
*/
function effectiveModelSelection(events) {
	return parentModelSelection(events);
}
/** The events a thread produced itself: everything after the LAST
*  `session/end-seed` marker (the fork-seed boundary). A log with no marker
*  (a thread created before seeding existed) is returned whole. */
function threadOwnLogEvents(events) {
	for (let index = events.length - 1; index >= 0; index--) if (events[index]?.type === "session/end-seed") return events.slice(index + 1);
	return [...events];
}
/**
* The agent preset a session actually runs: newest `agent-preset/selected`
* event wins, else the creation header (mirror of the dsh-agent-presets
* resolveSessionPreset helper — replicated here to avoid a host dependency
* on that package).
*/
function resolvePresetId(header, events) {
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		if (event?.type !== "agent-preset/selected") continue;
		const preset = dataOf(event).agentPreset;
		if (typeof preset === "string") return preset;
	}
	return header.agentPreset;
}
/**
* The model selection a session CURRENTLY runs, projected from its durable
* log (mirror of the core `modelSelection` projection — replicated here
* like resolvePresetId to avoid a host dependency). An explicit
* `model/selection` event stays PENDING until a same-route `request/header`
* consumes it; the value the composer's model selector shows is
* `pending ?? lastUsed`.
*
* This is NOT what `agent.options.provider/model` holds: those freeze the
* creation-time deployment default and are never rewritten by a UI model
* switch — DSH 0.1.5 routes requests through the session-local selection
* and its `agent/request` waterfall instead. Anyone inheriting "the
* parent's current model" must read this projection; inheriting
* `parent.options` verbatim silently ships the stale creation default
* (issue #368).
*
* A `request/header` contributes provider/model/effort, EXCEPT when its
* effort is marked as an adapter default (`adapterDefaults.reasoningEffort`)
* which the core selection getter deliberately does not adopt as a sticky pick.
*/
function parentModelSelection(events) {
	let pending;
	let lastUsed;
	for (const event of events) {
		if (event.type === "model/selection") {
			const selection = looseSelection(dataOf(event));
			if (selection !== void 0) pending = selection;
			continue;
		}
		if (event.type !== "request/header") continue;
		const header = dataOf(event).header;
		const config = header?.config;
		if (config === null || typeof config !== "object") continue;
		const selection = looseSelection(config);
		if (selection === void 0) continue;
		const isDefaultEffort = header?.adapterDefaults?.reasoningEffort === true;
		lastUsed = {
			provider: selection.provider,
			model: selection.model,
			...!isDefaultEffort && selection.reasoningEffort !== void 0 ? { reasoningEffort: selection.reasoningEffort } : {}
		};
		if (sameSelection(pending, lastUsed)) pending = void 0;
	}
	return pending ?? lastUsed;
}
function sameSelection(left, right) {
	if (left === right) return true;
	if (left === void 0 || right === void 0) return false;
	return left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort;
}
/** Narrow one loose record into a model selection (non-empty strings only). */
function looseSelection(data) {
	const { provider, model, reasoningEffort } = data;
	if (typeof provider !== "string" || provider === "") return void 0;
	if (typeof model !== "string" || model === "") return void 0;
	return {
		provider,
		model,
		...typeof reasoningEffort === "string" && reasoningEffort !== "" ? { reasoningEffort } : {}
	};
}
/**
* The host's category map, verbatim (the arms are mutually exclusive, so the
* order only mirrors the host's for review).
* @param name - durable tool-call name.
* @returns the category the main agent's process group counts it under.
*/
function activityOf(name) {
	if (name === "read") return "read";
	if (name === "read_image") return "readImage";
	if (name === "grep" || name === "glob" || name.endsWith("_inspect")) return "search";
	if (name === "write") return "write";
	if (name === "edit" || name === "apply_patch") return "edit";
	if ([
		"bash",
		"pwsh",
		"exec_command",
		"write_stdin"
	].includes(name) || name.startsWith("terminal_")) return "commands";
	if (name === "run_code") return "code";
	if (name === "web_search") return "webSearch";
	if (name === "web_fetch") return "webFetch";
	if (name === "subagent" || name.startsWith("subagent_")) return "subagents";
	if ([
		"todo_write",
		"create_goal",
		"update_goal",
		"get_goal"
	].includes(name)) return "plan";
	if (name === "ask_user_question" || name === "request_user_input") return "questions";
	return "tools";
}
/** The host's live-detail key priority, verbatim. */
const LIVE_TOOL_DETAIL_KEYS = [
	"title",
	"description",
	"objective",
	"task",
	"task_name",
	"name",
	"question",
	"questions",
	"prompt",
	"message",
	"command",
	"cmd",
	"queries",
	"query",
	"pattern",
	"url",
	"uri",
	"file_path",
	"path",
	"target",
	"action",
	"status"
];
/** Grapheme segmenter when the runtime has one (the host relies on `Intl.Segmenter`). */
const SEGMENTER = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : void 0;
/** Split into user-perceived characters, falling back to code points. */
function graphemes(text) {
	if (SEGMENTER === void 0) return Array.from(text);
	return Array.from(SEGMENTER.segment(text), (part) => part.segment);
}
/** Collapse whitespace and truncate on a grapheme boundary (the host's normalize). */
function normalizeDetail(value) {
	const flat = (typeof value === "string" ? value : Array.isArray(value) && value.every((item) => typeof item === "string") ? value.join(", ") : "").replace(/\s+/g, " ").trim();
	const chars = graphemes(flat);
	if (chars.length <= 160) return flat;
	return `${chars.slice(0, 159).join("").trimEnd()}…`;
}
/** The first `question` string of an `ask_user_question` argument list. */
function questionDetail(value) {
	if (!Array.isArray(value)) return "";
	for (const item of value) {
		if (item === null || typeof item !== "object") continue;
		const detail = normalizeDetail(item.question);
		if (detail !== "") return detail;
	}
	return "";
}
/**
* The host's `liveToolDetail`: parse the raw arguments and take the first
* present key of {@link LIVE_TOOL_DETAIL_KEYS}, falling back to the tool name.
* @param name - tool-call name.
* @param argsRaw - the call's raw `arguments` JSON string.
*/
function liveToolDetail(name, argsRaw) {
	let args;
	try {
		args = JSON.parse(argsRaw);
	} catch {
		return normalizeDetail(name);
	}
	if (args === null || typeof args !== "object") return normalizeDetail(name);
	const record = args;
	for (const key of LIVE_TOOL_DETAIL_KEYS) {
		if (!(key in record)) continue;
		const value = record[key];
		const detail = key === "questions" ? questionDetail(value) : normalizeDetail(value);
		if (detail !== "") return detail;
	}
	return normalizeDetail(name);
}
/**
* Extract the concatenated plain text of a content-block list (the durable
* `ContentBlock[]` shape, structurally: blocks with `type: 'text'` carry
* `text`; anything else — a tool call, an image, … — contributes nothing).
* @param content - the raw `content` field of a message event.
* @returns the joined text, or undefined when the message carries no text.
*/
function contentText(content) {
	if (!Array.isArray(content)) return void 0;
	const parts = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		const candidate = block;
		if (candidate.type === "text" && typeof candidate.text === "string") parts.push(candidate.text);
	}
	return parts.length > 0 ? parts.join("\n") : void 0;
}
/** A tool-call content block under BOTH durable vocabularies (0.1.7 `tool-call`; older logs `tool_use`). */
function announcedCalls(content) {
	if (!Array.isArray(content)) return [];
	const found = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		const candidate = block;
		if (candidate.type !== "tool-call" && candidate.type !== "tool_use") continue;
		const rawId = candidate.id ?? candidate.callId;
		if (typeof rawId !== "string" || typeof candidate.name !== "string") continue;
		found.push({
			callId: rawId,
			name: candidate.name,
			args: typeof candidate.arguments === "string" ? candidate.arguments : ""
		});
	}
	return found;
}
/** The callId of one `tool/result` event under both logged shapes. */
function resultCallId(data) {
	const message = data.message;
	for (const candidate of [
		data.callId,
		message?.source?.callId,
		message?.toolCallId,
		data.toolCallId
	]) if (typeof candidate === "string" && candidate !== "") return candidate;
}
/** Rank one range's calls into the host's summary shape. */
function summarize(calls, live) {
	const counts = /* @__PURE__ */ new Map();
	let running;
	let preparing;
	let runningDetail = "";
	let runningSeq = -Infinity;
	const ordered = calls.slice().sort((left, right) => left.seq - right.seq);
	for (const call of ordered) {
		const kind = activityOf(call.name);
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
		if (call.settled || !live) continue;
		if (call.seq < runningSeq) continue;
		runningSeq = call.seq;
		running = kind;
		preparing = call.preparing ? true : void 0;
		runningDetail = call.preparing ? kind === "tools" ? call.name : "" : liveToolDetail(call.name, call.args);
	}
	const ranked = [...counts].map(([kind, count]) => ({
		kind,
		count
	}));
	ranked.sort((left, right) => right.count - left.count);
	return {
		counts: ranked,
		...running === void 0 ? {} : { running },
		runningDetail,
		...preparing === true ? { preparing: true } : {}
	};
}
/** Cap one detail line without cutting a surrogate pair in half. */
function truncateText(text) {
	const chars = graphemes(text);
	if (chars.length <= 400) return text;
	return `${chars.slice(0, 399).join("").trimEnd()}…`;
}
/** Start an empty range. */
function openRange() {
	return {
		calls: [],
		ids: /* @__PURE__ */ new Set()
	};
}
/** Append one call to a range (deduped by callId). */
function addCall(range, call) {
	if (range.ids.has(call.callId)) return;
	range.calls.push(call);
	range.ids.add(call.callId);
}
/**
* Fold a session event log into the host's merged activity view: the newest
* range's summary and the newest text line. Scans BACKWARD from the end and
* stops at the range it reports, so a long history costs only its recent tail.
*
* @param events - the session's append-only event log (oldest → newest).
* @param options - `live` (whether the session is executing; a settled one
*   reports no running tool, like the host's closed groups) and `maxEvents`.
* @returns the current summary plus the optional detail fields.
*/
function foldProcess(events, options) {
	const live = options.live;
	const maxEvents = Math.max(1, options.maxEvents ?? 400);
	let range = openRange();
	/** The newest NON-EMPTY range (the fallback when the newest one is empty). */
	let answer;
	/** Whether {@link answer} is the newest range (only then can it be running). */
	let answerLive = false;
	const settled = /* @__PURE__ */ new Set();
	let latestText;
	let lastEventTime;
	let crossed = 0;
	for (let index = events.length - 1, scanned = 0; index >= 0; index -= 1) {
		if (scanned >= maxEvents) break;
		const event = events[index];
		if (event === void 0) continue;
		scanned += 1;
		lastEventTime ??= event.time;
		const { type, data } = event;
		if (type === "tool/result") {
			const callId = resultCallId(data);
			if (callId !== void 0) settled.add(callId);
			continue;
		}
		if (type === "tool/call") {
			const callId = typeof data.callId === "string" && data.callId !== "" ? data.callId : `anon-${event.seq}`;
			addCall(range, {
				callId,
				name: typeof data.name === "string" ? data.name : "tool",
				args: typeof data.arguments === "string" ? data.arguments : "",
				seq: event.seq,
				settled: settled.has(callId),
				preparing: false
			});
			continue;
		}
		if (type !== "assistant/message" && type !== "user/message") continue;
		const message = type === "assistant/message" ? data.message : void 0;
		if (message !== void 0) for (const announced of announcedCalls(message.content)) {
			const isSettled = settled.has(announced.callId);
			addCall(range, {
				callId: announced.callId,
				name: announced.name,
				args: announced.args,
				seq: event.seq,
				settled: isSettled,
				preparing: !isSettled
			});
		}
		const text = message === void 0 ? void 0 : contentText(message.content);
		if (text !== void 0) latestText ??= text;
		if (type !== "user/message" && text === void 0) continue;
		if (range.calls.length > 0) {
			answer = range.calls;
			answerLive = crossed === 0;
			break;
		}
		crossed += 1;
		if (crossed > 1) break;
		range = openRange();
	}
	return {
		current: summarize(answer ?? range.calls, live && (answer === void 0 ? crossed === 0 : answerLive)),
		...latestText === void 0 ? {} : { text: truncateText(latestText) },
		...lastEventTime === void 0 ? {} : { lastEventTime }
	};
}
//#endregion
//#region src/subagent-live-route.ts
/**
* Build the live-preview routes bound to the plugin context.
* @param ctx - host plugin context.
*/
function buildSubagentLiveApi(ctx) {
	return { async live(payload) {
		const rootSessionId = requireString(payload, "rootSessionId");
		const subagents = ctx.get("subagents");
		if (subagents === void 0 || typeof subagents.listDescendants !== "function") throw new SidebarError("subagents-unavailable", "the subagent service is not mounted in this deployment", 503);
		let descendants;
		try {
			descendants = await subagents.listDescendants(rootSessionId);
		} catch (error) {
			throw new SidebarError("subagents-unavailable", `subagent catalog read failed: ${error instanceof Error ? error.message : String(error)}`, 503);
		}
		const live = {};
		/**
		* Fold one session into the map. `running` is the caller-visible activity
		* flag: the catalog's for a child, undefined for the topology ROOT (the
		* host cannot classify it, and the page already knows the answer from the
		* session list). The fold's own `live` gate is that flag when it exists,
		* and the LOG's evidence for the root.
		*/
		const foldInto = (sessionId, running) => {
			const view = running === void 0 ? {} : { running };
			try {
				const fold = foldProcess(ctx.sessions.get(sessionId)?.snapshotEvents() ?? [], { live: running !== false });
				if (fold.current.counts.length > 0 || fold.current.running !== void 0) view.summary = fold.current;
				if (fold.text !== void 0) view.text = fold.text;
				if (fold.lastEventTime !== void 0) view.lastEventTime = fold.lastEventTime;
			} catch {}
			live[sessionId] = view;
		};
		foldInto(rootSessionId, void 0);
		for (const entry of descendants) {
			if (entry.kind !== "child") continue;
			if (entry.label?.startsWith("Side: ") ?? false) continue;
			foldInto(entry.id, entry.activity === "running");
		}
		return { live };
	} };
}
//#endregion
//#region src/team-routes.ts
/** The CAS actions the wire accepts (mirrors the domain union). */
const TASK_ACTIONS = /* @__PURE__ */ new Set([
	"claim",
	"release",
	"edit",
	"set_dependencies",
	"complete",
	"reopen",
	"reassign",
	"delete"
]);
/** The service's stale-revision code (0.1.6 returned it as a result union). */
const STALE_REVISION_CODE = "TEAM_TASK_STALE_REVISION";
/** Narrow an unknown payload value to a string array (else undefined). */
function stringArrayOf(value) {
	if (!Array.isArray(value)) return void 0;
	const out = value.filter((item) => typeof item === "string");
	return out.length === value.length ? out : void 0;
}
/**
* The thrown value's `HarnessError` code, when it carries one. Read
* structurally: the plugin does not import `@deepseek-ai/dsh-llm` for a
* string, and a non-TeamError rejection simply has no code to route on.
*/
function errorCodeOf(error) {
	if (typeof error !== "object" || error === null) return void 0;
	const code = error.code;
	return typeof code === "string" ? code : void 0;
}
/**
* Build the Agent Teams write routes bound to the plugin context.
* @param ctx - host plugin context.
*/
function buildTeamsApi(ctx) {
	const teams = ctx.get("agentTeams");
	const agents = ctx.get("agents");
	/**
	* The live lead agent of the requested tree plus its membership check.
	* Throws 503 when the experimental layer is absent and 404 when the root
	* simply leads no team (a normal page state, but never for a mutation).
	*/
	const membershipOf = async (payload) => {
		if (teams === void 0) throw new SidebarError("team-error", "the agent-teams layer is not mounted in this deployment", 503);
		const rootSessionId = requireString(payload, "rootSessionId");
		const agent = agents?.get(rootSessionId);
		if (agent === void 0) throw new SidebarError("team-error", "the tree root is not live in this process", 404);
		try {
			if (teams.tryMembership(agent) === void 0) throw new SidebarError("team-error", "the tree root leads no team", 404);
		} catch (error) {
			if (error instanceof SidebarError) throw error;
			throw new SidebarError("team-error", error instanceof Error ? error.message : String(error), 404);
		}
		return {
			svc: teams,
			agent
		};
	};
	/**
	* Translate one service rejection: a stale revision keeps its own wire code
	* so the client's task window can say "someone else changed this task"
	* instead of showing a generic failure.
	*/
	const serviceError = (error) => {
		const message = error instanceof Error ? error.message : String(error);
		return errorCodeOf(error) === STALE_REVISION_CODE ? new SidebarError("team-conflict", message, 409) : new SidebarError("team-error", message, 400);
	};
	return {
		async taskCreate(payload) {
			const membership = await membershipOf(payload);
			const record = payload;
			const blockedBy = stringArrayOf(record.blockedBy);
			const writeScopes = stringArrayOf(record.writeScopes);
			const req = {
				subject: requireString(payload, "subject"),
				description: typeof record.description === "string" ? record.description : "",
				...blockedBy !== void 0 ? { blockedBy } : {},
				...writeScopes !== void 0 ? { writeScopes } : {}
			};
			try {
				return {
					ok: true,
					value: await membership.svc.createTask(membership.agent, req)
				};
			} catch (error) {
				throw serviceError(error);
			}
		},
		async taskUpdate(payload) {
			const membership = await membershipOf(payload);
			const record = payload;
			const expectedRevision = record.expectedRevision;
			if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new SidebarError("bad-request", "missing or invalid \"expectedRevision\"");
			const action = record.action;
			if (typeof action !== "string" || !TASK_ACTIONS.has(action)) throw new SidebarError("bad-request", "missing or invalid \"action\"");
			const blockedBy = stringArrayOf(record.blockedBy);
			const writeScopes = stringArrayOf(record.writeScopes);
			const req = {
				taskId: requireString(payload, "taskId"),
				expectedRevision,
				action,
				...typeof record.subject === "string" ? { subject: record.subject } : {},
				...typeof record.description === "string" ? { description: record.description } : {},
				...blockedBy !== void 0 ? { blockedBy } : {},
				...writeScopes !== void 0 ? { writeScopes } : {},
				...typeof record.owner === "string" ? { owner: record.owner } : {}
			};
			try {
				return {
					ok: true,
					value: await membership.svc.updateTask(membership.agent, req)
				};
			} catch (error) {
				throw serviceError(error);
			}
		}
	};
}
//#endregion
//#region src/workflow-runs.ts
/** The four recorded event types (prefix match keeps the scan cheap). */
const EVENT_PREFIX = "tool-workflow/";
/**
* Fold one session's event log into its workflow runs, oldest first. Rows
* referencing an unknown run (a log window that starts mid-run, or a corrupt
* tail) are skipped — the official panel asserts a leading run-start instead,
* but the route merges two sources where ordering is guaranteed anyway.
* @param events - the session's append-only event log (oldest → newest).
* @param originSessionId - the session the log belongs to.
* @returns the session's runs in run-start order.
*/
function foldWorkflowRuns(events, originSessionId) {
	const runs = [];
	const byRunId = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (!event.type.startsWith(EVENT_PREFIX)) continue;
		const data = event.data;
		switch (event.type) {
			case "tool-workflow/run-start": {
				const runId = typeof data.runId === "string" ? data.runId : void 0;
				if (runId === void 0 || byRunId.has(runId)) break;
				const fold = {
					view: {
						runId,
						name: typeof data.name === "string" && data.name !== "" ? data.name : runId,
						originSessionId,
						status: "running",
						phases: [],
						startedSeq: event.seq,
						startedAt: event.time
					},
					memberBySeq: /* @__PURE__ */ new Map()
				};
				byRunId.set(runId, fold);
				runs.push(fold);
				break;
			}
			case "tool-workflow/agent-start": {
				const fold = runOf(data, byRunId);
				const seq = seqOf(data);
				if (fold === void 0 || seq === void 0 || fold.memberBySeq.has(seq)) break;
				const member = {
					seq,
					label: typeof data.label === "string" && data.label !== "" ? data.label : `#${seq}`,
					...typeof data.phase === "string" ? { phase: data.phase } : {},
					childId: typeof data.childId === "string" ? data.childId : ""
				};
				fold.memberBySeq.set(seq, member);
				let phase = fold.view.phases.find((candidate) => candidate.title === member.phase);
				if (phase === void 0) {
					phase = member.phase === void 0 ? { members: [] } : {
						title: member.phase,
						members: []
					};
					fold.view.phases.push(phase);
				}
				phase.members.push(member);
				break;
			}
			case "tool-workflow/agent-end": {
				const fold = runOf(data, byRunId);
				const seq = seqOf(data);
				const member = fold?.memberBySeq.get(seq ?? -1);
				if (member === void 0) break;
				const outcome = data.outcome;
				if (outcome === "completed" || outcome === "failed" || outcome === "cancelled") member.outcome = outcome;
				break;
			}
			case "tool-workflow/run-end": {
				const fold = runOf(data, byRunId);
				if (fold === void 0) break;
				const stopReason = data.stopReason;
				if (stopReason === "completed" || stopReason === "cancelled" || stopReason === "error") {
					fold.view.stopReason = stopReason;
					fold.view.status = stopReason === "error" ? "failed" : stopReason;
				} else fold.view.status = "failed";
				fold.view.finishedAt = event.time;
				break;
			}
		}
	}
	return runs.map((fold) => fold.view);
}
/** The run a workflow event belongs to (undefined = unknown/orphan row). */
function runOf(data, byRunId) {
	const runId = data.runId;
	return typeof runId === "string" ? byRunId.get(runId) : void 0;
}
/** The member sequence number of one agent-start/agent-end row. */
function seqOf(data) {
	const seq = data.seq;
	return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? seq : void 0;
}
//#endregion
//#region src/workflow-routes.ts
/** Per-session cap of mirrored live workflow events (a bounded, lossy ring). */
const MIRROR_MAX_ENTRIES = 500;
/**
* The live workflow-event mirror: subscribes to the session append feed and
* caches `tool-workflow/*` rows the session store's own log can lag behind
* (the same rehydration-boundary gap the job-output mirror exists for).
*/
function createWorkflowEventMirror(ctx) {
	const perSession = /* @__PURE__ */ new Map();
	if (typeof ctx.on !== "function") return { entries: () => [] };
	const dispose = ctx.on("session/event", (session, event) => {
		const sessionId = session?.id;
		if (typeof sessionId !== "string" || !event.type.startsWith("tool-workflow/")) return;
		let list = perSession.get(sessionId);
		if (list === void 0) perSession.set(sessionId, list = []);
		const minimal = {
			type: event.type,
			seq: event.seq,
			time: event.time,
			data: event.data
		};
		list.push(minimal);
		if (list.length > MIRROR_MAX_ENTRIES) list.splice(0, list.length - MIRROR_MAX_ENTRIES);
	});
	ctx.effect(() => dispose, "dsh-better-sidebar: workflow event mirror");
	return { entries: (sessionId) => perSession.get(sessionId) ?? [] };
}
/**
* Build the workflow-runs route bound to the plugin context. The tree walk
* reuses the host subagent runtime (`ctx.get('subagents')`); without it the
* route still folds the root session alone (a degraded but honest tree of
* one), matching the Subagent page's own fallback lineage.
* @param ctx - host plugin context.
*/
function buildWorkflowsApi(ctx) {
	const mirror = createWorkflowEventMirror(ctx);
	/** The tree's session ids: the root plus every descendant the catalog knows. */
	const treeSessionIds = async (rootSessionId) => {
		const subagents = ctx.get("subagents");
		if (subagents === void 0 || typeof subagents.listDescendants !== "function") return [rootSessionId];
		try {
			return [rootSessionId, ...(await subagents.listDescendants(rootSessionId)).map((entry) => entry.id)];
		} catch {
			return [rootSessionId];
		}
	};
	return { async list(payload) {
		const rootSessionId = requireString(payload, "rootSessionId");
		const runs = [];
		for (const sessionId of await treeSessionIds(rootSessionId)) try {
			const bySeq = /* @__PURE__ */ new Map();
			for (const event of ctx.sessions.get(sessionId)?.snapshotEvents() ?? []) if (event.type.startsWith("tool-workflow/")) bySeq.set(event.seq, event);
			for (const event of mirror.entries(sessionId)) bySeq.set(event.seq, event);
			if (bySeq.size === 0) continue;
			const ordered = [...bySeq.values()].sort((left, right) => left.seq - right.seq);
			runs.push(...foldWorkflowRuns(ordered, sessionId));
		} catch {}
		runs.sort((left, right) => left.startedSeq - right.startedSeq);
		return { runs };
	} };
}
//#endregion
//#region src/session-store.ts
/**
* Read one persisted session's header and full event log.
* @param persistence - the live `sessionPersistence` service.
* @param sessionId - the stored session to read.
* @returns the header and log; rejects when the session does not exist.
*/
async function readPersistedSession(persistence, sessionId) {
	const handle = await persistence.open(sessionId, "read");
	try {
		const { events } = await handle.read();
		return {
			header: handle.header,
			events,
			inheritedEventCount: handle.inheritedEventCount ?? 0
		};
	} finally {
		await handle.close();
	}
}
/**
* Resolve the service and read one persisted session, or `undefined` when
* the service is absent or the session cannot be read.
* @param ctx - host plugin context.
* @param sessionId - the stored session to read.
* @returns the persisted session, or `undefined`.
*/
async function readPersistedSessionOf(ctx, sessionId) {
	const persistence = ctx.get("sessionPersistence");
	if (persistence === void 0) return void 0;
	try {
		return await readPersistedSession(persistence, sessionId);
	} catch {
		return;
	}
}
//#endregion
//#region src/sidechat-routes.ts
/**
* Side Chat routes of the /sidebar JSON API ('sidechat.start' /
* 'sidechat.prompt' / 'sidechat.cancel' / 'sidechat.dispose' /
* 'sidechat.info' / 'sidechat.events').
*
* A side thread is a child session the plugin creates ITSELF with a custom
* seed — the parent's full event log up to the click moment, honestly closed
* at an in-progress turn (see sidechat-core.ts). The child is marked
* `origin: 'subagent'` so the main session list hides it, and EVERY
* operation goes through these routes because the generic session RPCs are
* fenced away from subagent-origin identities (the api-remotes
* agent-lookup ownership fence). No DSH source is touched:
*
* - creation uses the public AgentRegistry.create seam (the same one
*   api-proxy's session.fork and the subagent fork provider use), with the
*   parent's preset composition and provider/model selection so the child's
*   first request shares the parent's token prefix (provider-side prefix
*   cache reuse);
* - the first prompt (boundary + question) and every follow-up are admitted
*   with the stock `agent.followup`;
* - a cold thread (DSH restart, or a closed thread) is resumed with
*   AgentRegistry.resume, composing the preset the child recorded.
*/
/** Timeout guarding the create call (the registry detaches it before the
*  handle becomes visible, so the child is never cancelled by it). */
const CREATE_TIMEOUT_MS = 15e3;
/** Head cap of one `sidechat.events` response (the ceiling the old
*  client-side walk could load: 40 pages × 200 events). A pathological
*  thread beyond it renders its tail window — the same degradation the
*  capped walk had, never a failed poll. */
const EVENTS_CAP$1 = 8e3;
/** Per-activation disposers of created thread agents (the dispose route
*  releases them; the session and its history always stay persisted). */
const threadDisposers = /* @__PURE__ */ new Map();
/** The in-progress-turn snapshot captured at creation of an EMPTY thread,
*  waiting to ride the first prompt (lost on a host restart — the boundary
*  prompt is then delivered alone, a logged degradation). */
const pendingSnapshots = /* @__PURE__ */ new Map();
/** Per-thread model-selection refs installed on the live agent. The host's
*  own composer commits a model switch by appending `model/selection` AND
*  installing this agent-scoped ref (`SessionController.selectForNextRequest`);
*  the ref is what prompt assembly and request routing actually read, because
*  the controller caches one selection object per agent and never re-reads the
*  projection. A subagent-origin thread never passes through the controller's
*  fence, so the plugin installs the same seam itself. */
const threadModelRefs = /* @__PURE__ */ new Map();
/** Resolve the parent's preset and build the child's composition setup
*  (mirror of api-proxy's composeAgent minus the model-selection install —
*  the child carries the parent's provider/model in agentOptions). */
async function composeChildSetup(ctx, presetId) {
	const presets = ctx.get("agentPresets");
	if (presets === void 0) return { setup: () => Promise.resolve() };
	const resolved = await presets.resolve(presetId);
	return {
		agentPreset: resolved.id,
		setup: async (agentCtx) => {
			await presets.mount(agentCtx, resolved.id);
		}
	};
}
/** Build the cold-resume setup from the thread's PERSISTED record (the
*  recorded preset wins, newest selection event first). */
async function composePersistedSetup(ctx, childId) {
	const persistence = ctx.get("sessionPersistence");
	if (persistence === void 0) return () => Promise.resolve();
	const inspected = await readPersistedSession(persistence, childId);
	const presetId = resolvePresetId(inspected.header, inspected.events);
	const presets = ctx.get("agentPresets");
	if (presets === void 0 || presetId === void 0) return () => Promise.resolve();
	const resolved = await presets.resolve(presetId);
	return async (agentCtx) => {
		await presets.mount(agentCtx, resolved.id);
	};
}
/** One text-block prompt (the thread boundary + question, or a follow-up). */
function textPrompt(text) {
	return [{
		type: "text",
		text
	}];
}
/** Admit one user message to a live agent through the stock followup path. */
function admitFollowup(agent, blocks) {
	const message = createUserMessage({
		content: blocks,
		source: { kind: "user" }
	});
	agent.followup(message);
}
/**
* Deliver the thread's FIRST contact as TWO log-separated messages: the
* boundary prompt (+ the parked in-progress snapshot) rides `agent.inject`
* — queued model-facing context that does NOT wake the driver and is
* claimed FIRST at the opening step (Inbox.claim drains next-step before
* next-turn) — and the user's question is the follow-up that wakes it. The
* log therefore records two user/message events (injection, then question)
* instead of one wrapped blob: the transcript shows the question as a user
* bubble and collapses the injection as a context row. The injection source
* carries the plugin's producer-owned kind (`plugin:dsh-better-sidebar` —
* session format v4 refuses the retired bare `kind: 'plugin'`) so recognition
* is structural; its text still opens with SIDE_BOUNDARY_PREFIX, keeping
* boundaryDelivered intact.
*/
function admitFirstContact(agent, injectionText, question) {
	agent.inject(createUserMessage({
		content: textPrompt(injectionText),
		source: { kind: SIDE_INJECTION_SOURCE_KIND }
	}));
	admitFollowup(agent, textPrompt(question));
}
/** The live thread agent, or undefined (cold — the caller resumes). */
function liveThreadAgent(ctx, childId) {
	return ctx.get("agents")?.get(childId);
}
/**
* Cold-thread log memo: how many THREADS keep their decoded log. The
* transcript polls `sidechat.events` per open thread (15 s fallback, plus one
* pull per push frame), so a handful of threads is the whole working set.
*/
const COLD_LOG_MEMO_MAX = 16;
const coldLogMemo = /* @__PURE__ */ new Map();
/**
* Read one COLD thread's persisted log, memoized by the stored artifact's
* IDENTITY: `childId` plus the host's change token (dev/ino/size/mtimeNs/
* ctimeNs) and the physical size.
*
* Why: a cold thread is re-read on every poll, and each read opens the handle,
* decodes the ENTIRE persisted log and scans it back to `session/end-seed` —
* O(thread history) per tick for an answer that only changes when the artifact
* does. With the memo a repeat poll costs one `stat`.
*
* Only the RESULT is memoized, never the handle:
* {@link readPersistedSession} still opens and closes it (its `finally`), so a
* concurrent writer is unaffected. A host without `stat`, or a session whose
* stat is unreadable, reads uncached — the read itself then reports the real
* error (404 for a gone thread) exactly as before.
*/
async function readColdThreadLog(persistence, childId) {
	const identity = await storedIdentityOf(persistence, childId);
	if (identity === void 0) return (await readPersistedSession(persistence, childId)).events;
	const key = `${childId}\0${identity}`;
	const hit = coldLogMemo.get(key);
	if (hit !== void 0) {
		coldLogMemo.delete(key);
		coldLogMemo.set(key, hit);
		return hit;
	}
	const events = (await readPersistedSession(persistence, childId)).events;
	const prefix = `${childId}\0`;
	for (const existing of coldLogMemo.keys()) if (existing.startsWith(prefix)) coldLogMemo.delete(existing);
	coldLogMemo.set(key, events);
	while (coldLogMemo.size > COLD_LOG_MEMO_MAX) {
		const oldest = coldLogMemo.keys().next().value;
		if (oldest === void 0) break;
		coldLogMemo.delete(oldest);
	}
	return events;
}
/** The stored artifact's change identity, or undefined when unavailable. */
async function storedIdentityOf(persistence, childId) {
	const stat = persistence.stat;
	if (typeof stat !== "function") return void 0;
	try {
		const snapshot = await stat.call(persistence, childId);
		if (snapshot === void 0) return void 0;
		return `${String(snapshot.revision ?? "")}\0${String(snapshot.sizeBytes ?? "")}`;
	} catch {
		return;
	}
}
/**
* The thread's event log (seed + its own events, already expanded): the live
* agent's in-memory log while the thread is attached — the freshest read,
* including events not yet flushed — else the persisted logical log. Both
* DSH generations expose these seams with the same shape (the 0.1.2
* persistence layer packs chunk rows on disk but expands them on inspect;
* the live log is `Session.snapshotEvents()`, the 0.1.2-alpha.4 rename of
* the `Session.events` property), which is why the transcript reads here
* instead of the client's session-history RPC: that face
* (`ctx.connection.api`) was removed in 0.1.2-alpha.1's Remote-gateway
* migration.
*/
async function threadLogEvents(ctx, childId) {
	const agent = liveThreadAgent(ctx, childId);
	if (agent !== void 0) return agent.session.snapshotEvents();
	const persistence = ctx.get("sessionPersistence");
	if (persistence === void 0) throw new SidebarError("sidechat-error", "the session persistence service is unavailable", 503);
	try {
		return await readColdThreadLog(persistence, childId);
	} catch (error) {
		throw new SidebarError("not-found", `thread "${childId}" is not available: ${error instanceof Error ? error.message : String(error)}`, 404);
	}
}
/** The thread's unclaimed inbox as wire rows, in claim order. An inbox whose
*  projection is not readable (a host without AgentLoop's inbox unit) reads as
*  "nothing pending" instead of failing the transcript poll. */
function pendingOf(agent) {
	try {
		return pendingInputs(agent.inbox.nextStep, agent.inbox.nextTurn);
	} catch {
		return [];
	}
}
/** Whether the thread's inbox already holds a boundary injection.
*  `boundaryDelivered` only sees the boundary once a CLAIM logged the durable
*  `user/message`; a second prompt arriving before that claim would otherwise
*  deliver a second boundary + question pair (two injections queued at once). */
function boundaryPending(agent) {
	try {
		for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) if (messageLeadTextOf(message).startsWith("Side conversation boundary")) return true;
	} catch {}
	return false;
}
/** The leading text of an inbox message's content (block array or bare string). */
function messageLeadTextOf(message) {
	const content = message?.content;
	const first = Array.isArray(content) ? content[0] : content;
	if (typeof first === "string") return first;
	if (first !== null && typeof first === "object" && "text" in first) return String(first.text);
	return "";
}
/**
* Remove exactly the inbox messages a seeded thread INHERITED as still-pending
* but never owned. The create path fences a fresh thread hard (nothing of its
* own can be queued yet), but a COLD thread cannot use that blanket clear:
* input the user genuinely queued in the thread before a host restart is
* legitimate work. The inherited prefix fold identifies the ghosts by identity
* instead, so only they are dropped.
*
* This closes the last documented hole of the 2026-09-13 leak fix — threads
* created before that fence (or by any build without it) still leaked the
* parent's already-claimed input after a cold resume.
* See docs/plans/2026-10-12-sidechat-native-surface.md.
* @param agent - the just-resumed thread agent.
* @returns how many inherited ghosts were dropped.
*/
function dropInheritedGhosts(agent) {
	const log = agent.session.snapshotEvents();
	const ghosts = new Set(inheritedPendingIds(log, Number(agent.session.inheritedEventCount)));
	if (ghosts.size === 0) return 0;
	let removed = 0;
	for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
		const id = pendingInputId(message);
		if (id === void 0 || !ghosts.has(id)) continue;
		if (agent.inbox.remove(id)) removed++;
	}
	return removed;
}
/** The thread's EFFECTIVE model route: what its log says it will request with
*  (`pending ?? lastUsed` of the `model/selection` / `request/header` fold),
*  falling back to the agent's frozen creation-time options only when the log
*  records no selection at all. Reading `agent.options` alone ships the
*  creation-time deployment default — the bug #368 fixed for inheritance. */
function selectionOf(agent) {
	const logged = effectiveModelSelection(agent.session.snapshotEvents());
	if (logged !== void 0) return logged;
	const { provider, model, reasoningEffort } = agent.options;
	if (provider === void 0 || model === void 0) return void 0;
	return {
		provider,
		model,
		...reasoningEffort === void 0 ? {} : { reasoningEffort: String(reasoningEffort) }
	};
}
/** One wire selection as the agent-scoped ref's branded value. */
function brandedSelection(selection) {
	return {
		provider: selection.provider,
		model: selection.model,
		...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }
	};
}
/**
* Hand the agent the model-selection seam, once per live agent: the ref prompt
* assembly snapshots and request routing applies. Seeded from the thread's
* recorded selection, so a resumed thread keeps the model the user picked
* instead of reverting to the deployment default.
* @param agent - the live thread agent.
* @param childId - thread identity (the ref's key).
* @returns the installed (or already installed) ref.
*/
function ensureModelSelection(agent, childId) {
	const existing = threadModelRefs.get(childId);
	if (existing !== void 0) return existing;
	const selection = selectionOf(agent);
	const ref = {
		current: selection === void 0 ? void 0 : brandedSelection(selection),
		assembled: void 0
	};
	installModelSelection(agent.ctx, ref);
	threadModelRefs.set(childId, ref);
	return ref;
}
/** Resolve the thread's live agent, cold-resuming the persisted session under
*  its recorded composition. Every context-delivering route shares this. */
async function ensureLiveThread(ctx, childId) {
	const live = liveThreadAgent(ctx, childId);
	if (live !== void 0) return live;
	const agents = ctx.get("agents");
	if (agents?.resume === void 0) throw new SidebarError("sidechat-error", "the agents service is unavailable", 503);
	const setup = await composePersistedSetup(ctx, childId);
	try {
		const handle = await agents.resume({
			resumeSessionId: childId,
			setup
		});
		threadDisposers.set(childId, () => handle.dispose());
		dropInheritedGhosts(handle.agent);
		ensureModelSelection(handle.agent, childId);
		return handle.agent;
	} catch (error) {
		throw new SidebarError("sidechat-error", `thread resume failed: ${error instanceof Error ? error.message : String(error)}`, 500);
	}
}
/** Reject a wire selection the deployment cannot route. Mirrors the
*  controller's own `selectModel` validation when the LLM service exposes it;
*  a host without the seam accepts the selection verbatim. */
async function normalizeSelection(ctx, requested) {
	const llm = ctx.get("llm");
	if (llm?.resolveCallConfig === void 0) return requested;
	let resolved;
	try {
		resolved = await llm.resolveCallConfig({
			provider: requested.provider,
			model: requested.model,
			...requested.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(requested.reasoningEffort) }
		});
	} catch (error) {
		throw new SidebarError("bad-request", `model "${requested.provider}/${requested.model}" is unavailable: ${error instanceof Error ? error.message : String(error)}`, 400);
	}
	const provider = typeof resolved?.provider === "string" ? resolved.provider : requested.provider;
	const model = typeof resolved?.model === "string" ? resolved.model : requested.model;
	const effort = resolved?.reasoningEffort === void 0 ? void 0 : String(resolved.reasoningEffort);
	return {
		provider,
		model,
		...effort === void 0 ? {} : { reasoningEffort: effort }
	};
}
/** The host model catalog the composer lists, normalized for the side-chat
*  picker. The service is not a plugin peer, so it is probed structurally; a
*  deployment without it (headless, older host) degrades to
*  `available: false`. */
async function modelCatalogOf(ctx) {
	const service = ctx.get("sessionController");
	if (service?.modelCatalog === void 0) return {
		available: false,
		groups: [],
		failures: []
	};
	try {
		const catalog = await service.modelCatalog();
		return {
			available: true,
			...catalog?.default === void 0 ? {} : { default: catalog.default },
			groups: catalog?.groups ?? [],
			failures: catalog?.failures ?? []
		};
	} catch (error) {
		return {
			available: false,
			groups: [],
			failures: [{
				id: "host",
				message: error instanceof Error ? error.message : String(error)
			}]
		};
	}
}
/** Build the Side Chat routes (all optional services degrade to a wire
*  error the tab surfaces inline). The record keys are the FULL wire method
*  names the /sidebar/api dispatcher looks up (`api[method]`).
*  @param ctx - host plugin context.
*  @param live - the live assistant stream buffer; absent only in tests that
*    never exercise streaming (then every `live` response is empty). */
function buildSidechatApi(ctx, live) {
	return {
		"sidechat.start": async (payload) => {
			const sessionId = requireString(payload, "sessionId");
			const rawQuestion = payload.question;
			const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
			const parent = liveThreadAgent(ctx, sessionId);
			if (parent === void 0) throw new SidebarError("sidechat-error", `parent session "${sessionId}" is not running`, 409);
			const parentSession = parent.session;
			const workingDirectory = ctx.get("workingDirectory");
			const parentCwd = workingDirectory?.get(parentSession) ?? parentSession.header.cwd;
			const parentSelection = parentModelSelection(parentSession.snapshotEvents());
			const routeProvider = parentSelection?.provider ?? parent.options.provider;
			const routeModel = parentSelection?.model ?? parent.options.model;
			const inheritance = buildSidechatInheritance(parentSession.snapshotEvents(), live?.chunksFor(sessionId) ?? []);
			const { agentPreset, setup } = await composeChildSetup(ctx, resolvePresetId(parentSession.header, parentSession.snapshotEvents()));
			const childId = `session-${randomUUID()}`;
			const label = question === "" ? SIDE_NEW_THREAD_TITLE : sideLabel(question);
			const descriptor = snapshotSubagentDescriptor({
				mode: "continuable",
				provider: "sidechat",
				label,
				...routeProvider === void 0 ? {} : { agentProvider: routeProvider },
				...routeModel === void 0 ? {} : { agentModel: routeModel }
			});
			const directorySeed = workingDirectory === void 0 ? [] : [{
				type: "working-directory/change",
				seq: inheritance.seed.length,
				time: Date.now(),
				data: { cwd: parentCwd }
			}];
			const descriptorEvent = {
				type: "subagent/descriptor",
				seq: inheritance.seed.length + directorySeed.length,
				time: Date.now(),
				data: descriptor
			};
			const seed = [
				...inheritance.seed,
				...directorySeed,
				descriptorEvent
			];
			const targetEffort = parentSelection !== void 0 ? parentSelection.reasoningEffort === void 0 ? void 0 : ReasoningEffortId(parentSelection.reasoningEffort) : parent.options.reasoningEffort;
			const childAgentOptions = {
				...parent.options,
				...routeProvider === void 0 ? {} : { provider: routeProvider },
				...routeModel === void 0 ? {} : { model: routeModel }
			};
			if (targetEffort !== void 0) childAgentOptions.reasoningEffort = targetEffort;
			else delete childAgentOptions.reasoningEffort;
			const options = {
				sessionId: childId,
				meta: {
					...parentCwd === void 0 ? {} : { cwd: parentCwd },
					parentSession: parentSession.id,
					isSeeded: true,
					origin: "subagent",
					delegationDepth: (parentSession.header.delegationDepth ?? 0) + 1,
					...agentPreset === void 0 ? {} : { agentPreset }
				},
				seed,
				inheritedEventCount: seed.length,
				agentOptions: childAgentOptions,
				setup,
				signal: AbortSignal.timeout(CREATE_TIMEOUT_MS)
			};
			const agents = ctx.get("agents");
			if (agents?.create === void 0) throw new SidebarError("sidechat-error", "the agents service is unavailable", 503);
			let handle;
			try {
				handle = await agents.create(options);
			} catch (error) {
				throw new SidebarError("sidechat-error", `thread creation failed: ${error instanceof Error ? error.message : String(error)}`, 500);
			}
			threadDisposers.set(childId, () => handle.dispose());
			handle.agent.inbox.clear();
			ensureModelSelection(handle.agent, childId);
			const titles = ctx.get("sessionTitle");
			const pinTitle = (label) => {
				if (titles === void 0) return;
				try {
					titles.rename(handle.agent.session, label);
				} catch {}
			};
			if (question === "") {
				if (inheritance.snapshot !== null) pendingSnapshots.set(childId, inheritance.snapshot);
				pinTitle(SIDE_NEW_THREAD_TITLE);
			} else {
				const promptParts = [SIDE_BOUNDARY_PROMPT];
				if (inheritance.snapshot !== null) promptParts.push(inheritance.snapshot);
				admitFirstContact(handle.agent, promptParts.join("\n\n"), question);
				pinTitle(sideLabel(question));
			}
			return { childId };
		},
		"sidechat.prompt": async (payload) => {
			const childId = requireString(payload, "childId");
			const text = requireString(payload, "text").trim();
			if (text === "") throw new SidebarError("bad-request", "text is required");
			const agent = await ensureLiveThread(ctx, childId);
			if (boundaryDelivered(agent.session.snapshotEvents()) || boundaryPending(agent)) admitFollowup(agent, textPrompt(text));
			else {
				const parts = [SIDE_BOUNDARY_PROMPT];
				const snapshot = pendingSnapshots.get(childId);
				pendingSnapshots.delete(childId);
				if (snapshot !== void 0) parts.push(snapshot);
				admitFirstContact(agent, parts.join("\n\n"), text);
				const titles = ctx.get("sessionTitle");
				if (titles !== void 0) try {
					titles.rename(agent.session, sideLabel(text));
				} catch {}
			}
			return { accepted: true };
		},
		"sidechat.cancel": async (payload) => {
			const agent = liveThreadAgent(ctx, requireString(payload, "childId"));
			if (agent !== void 0) agent.cancel({ kind: "user" }, { keepInbox: true });
			return { accepted: true };
		},
		"sidechat.dispose": async (payload) => {
			const childId = requireString(payload, "childId");
			pendingSnapshots.delete(childId);
			threadModelRefs.delete(childId);
			const dispose = threadDisposers.get(childId);
			if (dispose !== void 0) {
				threadDisposers.delete(childId);
				try {
					await dispose();
				} catch {}
			}
			return { accepted: true };
		},
		"sidechat.info": async (payload) => {
			const childId = requireString(payload, "childId");
			const agent = liveThreadAgent(ctx, childId);
			if (agent !== void 0) {
				const preset = agent.session.header.agentPreset;
				const selection = selectionOf(agent);
				return {
					live: true,
					status: agent.status,
					...selection === void 0 ? {} : selectionFields(selection),
					...preset === void 0 ? {} : { preset }
				};
			}
			const persistence = ctx.get("sessionPersistence");
			if (persistence !== void 0) try {
				const inspected = await readPersistedSession(persistence, childId);
				const preset = resolvePresetId(inspected.header, inspected.events);
				const selection = effectiveModelSelection(inspected.events);
				return {
					live: false,
					...preset === void 0 ? {} : { preset },
					...selection === void 0 ? {} : selectionFields(selection)
				};
			} catch {}
			return { live: false };
		},
		"sidechat.events": async (payload) => {
			const childId = requireString(payload, "childId");
			const rawAfter = payload.afterSeq;
			if (rawAfter !== void 0 && (typeof rawAfter !== "number" || !Number.isSafeInteger(rawAfter) || rawAfter < 0)) throw new SidebarError("bad-request", "afterSeq must be a non-negative integer");
			const own = threadOwnLogEvents(await threadLogEvents(ctx, childId));
			const fresh = rawAfter === void 0 ? own : own.filter((event) => event.seq > rawAfter);
			const tailSeq = own.at(-1)?.seq ?? -1;
			const agent = liveThreadAgent(ctx, childId);
			return {
				events: fresh.length > EVENTS_CAP$1 ? fresh.slice(fresh.length - EVENTS_CAP$1) : fresh,
				live: liveEventsOf(live?.chunksFor(childId) ?? [], tailSeq),
				pending: agent === void 0 ? [] : pendingOf(agent)
			};
		},
		"sidechat.dequeue": async (payload) => {
			const childId = requireString(payload, "childId");
			const rawId = payload.messageId;
			if (rawId !== void 0 && (typeof rawId !== "string" || rawId === "")) throw new SidebarError("bad-request", "messageId must be a non-empty string");
			const agent = liveThreadAgent(ctx, childId);
			if (agent === void 0) return {
				accepted: true,
				removed: 0
			};
			if (rawId === void 0) {
				const queued = pendingOf(agent).length;
				agent.inbox.clear();
				return {
					accepted: true,
					removed: queued
				};
			}
			return {
				accepted: true,
				removed: agent.inbox.remove(rawId) ? 1 : 0
			};
		},
		"sidechat.models": async () => modelCatalogOf(ctx),
		"sidechat.model": async (payload) => {
			const childId = requireString(payload, "childId");
			const provider = requireString(payload, "provider");
			const model = requireString(payload, "model");
			const rawEffort = payload.reasoningEffort;
			if (rawEffort !== void 0 && (typeof rawEffort !== "string" || rawEffort === "")) throw new SidebarError("bad-request", "reasoningEffort must be a non-empty string");
			const selection = await normalizeSelection(ctx, {
				provider,
				model,
				...rawEffort === void 0 ? {} : { reasoningEffort: rawEffort }
			});
			const agent = await ensureLiveThread(ctx, childId);
			agent.session.append("model/selection", brandedSelection(selection));
			ensureModelSelection(agent, childId).current = brandedSelection(selection);
			return {
				accepted: true,
				selection
			};
		}
	};
}
/** The wire fields of one model selection (shared by info's live/cold arms). */
function selectionFields(selection) {
	return {
		provider: selection.provider,
		model: selection.model,
		...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: selection.reasoningEffort }
	};
}
//#endregion
//#region src/assistant-live.ts
/** Per-attempt buffer ceiling; beyond it the oldest deltas are dropped. */
const LIVE_CHUNK_CAP = 4e3;
/** A frame's `chunk` payload must be a JSON record to be worth buffering. */
function chunkOf(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** A finite non-negative integer, or undefined. */
function countOf(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : void 0;
}
/**
* Fold `agent/assistant-stream` frames into per-session live buffers.
*
* Frames arrive for every attached agent, so the buffer is keyed by the
* emitting session and ignores anything it cannot identify. An out-of-order
* or mismatched chunk drops the attempt rather than splicing a gap: a
* transcript with a hole is worse than one that settles at the next durable
* event.
* @param ctx - host plugin context (its `on` subscribes the session feed).
* @param cap - per-attempt chunk ceiling.
* @returns the read face and a disposer unbinding the listener.
*/
function createAssistantLiveBuffer(ctx, cap = LIVE_CHUNK_CAP) {
	const attempts = /* @__PURE__ */ new Map();
	const off = ctx.on("agent/assistant-stream", (payload) => {
		const record = payload;
		const frame = record?.frame;
		if (frame === void 0) return;
		const session = (record?.agent)?.session;
		const sessionId = typeof session?.id === "string" ? session.id : void 0;
		if (sessionId === void 0) return;
		const type = frame["type"];
		if (type === "end") {
			attempts.delete(sessionId);
			return;
		}
		const attemptId = typeof frame["attemptId"] === "string" ? frame.attemptId : void 0;
		if (attemptId === void 0) return;
		if (type === "start") {
			const turn = countOf(frame["turn"]);
			const step = countOf(frame["step"]);
			if (turn === void 0 || step === void 0) return;
			const known = attempts.has(sessionId);
			attempts.delete(sessionId);
			if (!known && attempts.size >= 64) {
				const oldest = attempts.keys().next().value;
				if (oldest !== void 0) attempts.delete(oldest);
			}
			attempts.set(sessionId, {
				attemptId,
				turn,
				step,
				chunks: [],
				nextIndex: 0
			});
			return;
		}
		if (type !== "chunk") return;
		const attempt = attempts.get(sessionId);
		if (attempt === void 0 || attempt.attemptId !== attemptId) return;
		const index = countOf(frame["index"]);
		const chunk = chunkOf(frame["chunk"]);
		if (index === void 0 || chunk === void 0 || index !== attempt.nextIndex) {
			attempts.delete(sessionId);
			return;
		}
		attempt.nextIndex = index + 1;
		const time = countOf(frame["time"]) ?? 0;
		attempt.chunks.push({
			attemptId,
			turn: attempt.turn,
			step: attempt.step,
			index,
			time,
			chunk
		});
		if (attempt.chunks.length > cap) attempt.chunks.splice(0, attempt.chunks.length - cap);
	});
	return {
		chunksFor: (sessionId) => attempts.get(sessionId)?.chunks ?? [],
		dispose: () => {
			off();
		}
	};
}
//#endregion
//#region src/changes-ops.ts
/** Recent-window bound: the lens shows the recent tail, not eternity. */
const EVENTS_CAP = 4e3;
/** How long one `wait: true` request parks before answering with the window. */
const WAIT_MS = 25e3;
/** The event types the session lens folds — a plain tool pair, or a PTC one. */
function isFileToolEvent(event) {
	return event.type === "tool/call" || event.type === "tool/result" || event.type === "tool/ptc-dispatch-start" || event.type === "tool/ptc-dispatch";
}
/**
* Build the `changes.ops` handler for one plugin context.
* @param ctx - host plugin context (sessions + sessionPersistence).
* @returns the route handler.
*/
function createChangesOpsApi(ctx) {
	return async (payload, signal) => {
		const sessionId = requireString(payload, "sessionId");
		const record = payload;
		const rawAfter = record.afterSeq;
		if (rawAfter !== void 0 && (typeof rawAfter !== "number" || !Number.isSafeInteger(rawAfter) || rawAfter < -1)) throw new SidebarError("bad-request", "afterSeq must be an integer of at least -1");
		if (record.wait !== void 0 && typeof record.wait !== "boolean") throw new SidebarError("bad-request", "wait must be a boolean");
		const afterSeq = rawAfter ?? -1;
		/** Read the live or persisted log, keeping only the delta past the cursor. */
		const readWindow = async () => {
			let events = ctx.sessions.get(sessionId)?.snapshotEvents();
			if (events === void 0) {
				const persistence = ctx.get("sessionPersistence");
				if (persistence !== void 0) try {
					events = (await readPersistedSession(persistence, sessionId)).events;
				} catch {}
			}
			const filtered = (events ?? []).filter((event) => isFileToolEvent(event) && event.seq > afterSeq);
			const window = filtered.length > EVENTS_CAP ? filtered.slice(-4e3) : filtered;
			return {
				events: window,
				lastSeq: window.at(-1)?.seq ?? afterSeq
			};
		};
		if (record.wait !== true) return readWindow();
		const pending = [];
		let wake;
		const notified = new Promise((resolve) => {
			wake = resolve;
		});
		const dispose = ctx.on("session/event", (session, event) => {
			const minimal = {
				type: event.type,
				seq: event.seq,
				time: event.time,
				data: event.data
			};
			if (session?.id !== sessionId || !isFileToolEvent(minimal) || minimal.seq <= afterSeq) return;
			pending.push(minimal);
			if (pending.length > EVENTS_CAP) pending.shift();
			wake?.();
		});
		const timer = setTimeout(() => wake?.(), WAIT_MS);
		const abort = () => {
			wake?.();
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const initial = await readWindow();
			if (initial.events.length > 0 || signal?.aborted === true) return initial;
			await notified;
			const current = await readWindow();
			if (pending.length === 0) return current;
			const merged = new Map(current.events.map((event) => [event.seq, event]));
			for (const event of pending) merged.set(event.seq, event);
			const events = [...merged.values()].sort((left, right) => left.seq - right.seq).slice(-4e3);
			return {
				events,
				lastSeq: events.at(-1)?.seq ?? afterSeq
			};
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			dispose();
		}
	};
}
//#endregion
//#region src/commit-message.ts
/**
* Commit-message suggestion: the prompt contract and the model-route
* vocabulary shared by the `git.suggest-message` host route (src/index.ts)
* and its tests. Deliberately free of cordis, git and the LLM service, so
* the wording and the route parse stay unit-testable without a host.
*
* The generation itself runs through the harness LLM service (`ctx.llm`) with
* the route the CONVERSATION runs on by default, or a route the user pinned in
* the Git card's settings (see {@link parseModelRoute}). The plugin never
* touches a credential: the harness resolves provider endpoints and keys.
*/
/** Max diff characters fed to the model. A huge change set is truncated (with
*  an explicit marker) so bulk renames or generated-file diffs cannot flood
*  the model context. */
const SUGGEST_DIFF_LIMIT = 12e3;
/** Narrow an untrusted language value to the supported pair. */
function normalizeLanguage(value) {
	return value === "zh" ? "zh" : "en";
}
/** Truncate one diff to {@link SUGGEST_DIFF_LIMIT}, marking the cut. */
function truncateDiff(diff) {
	if (diff.length <= 12e3) return diff;
	return `${diff.slice(0, SUGGEST_DIFF_LIMIT)}\n...(diff truncated)`;
}
/**
* Parse a pinned route of the form `provider/model`. The FIRST slash splits:
* a model id may carry its own slashes (e.g. a vendor-prefixed id), the
* provider never does. Anything malformed (empty half, no slash) yields
* undefined so the caller falls back to the conversation's own route.
*/
function parseModelRoute(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return void 0;
	const provider = trimmed.slice(0, slash).trim();
	const model = trimmed.slice(slash + 1).trim();
	if (provider === "" || model === "") return void 0;
	return {
		provider,
		model
	};
}
/** First non-empty string among the candidates (unknown-shape reads). */
function firstString(...values) {
	for (const value of values) if (typeof value === "string" && value.trim() !== "") return value.trim();
	return "";
}
/**
* One provider entry of the harness LLM catalog, read tolerantly: the
* adapter-registration shape is not part of this plugin's contract, so every
* plausible field is probed and an entry that yields no route is dropped
* (never guessed) — a wrong route would fail at generation time instead.
* @param entry - one `listProviders()` element.
* @returns the provider route and a display label, or undefined.
*/
function providerEntryOf(entry) {
	if (entry === null || typeof entry !== "object") return void 0;
	const record = entry;
	const provider = firstString(record.provider, record.route, record.id);
	if (provider === "") return void 0;
	return {
		provider,
		label: firstString(record.name, record.displayName, record.label, record.title, provider)
	};
}
/**
* One model entry of a provider's advertised catalog (same tolerant read as
* {@link providerEntryOf}).
* @param entry - one `listModels()` element.
* @returns the model id and a display name, or undefined.
*/
function modelEntryOf(entry) {
	if (entry === null || typeof entry !== "object") return void 0;
	const record = entry;
	const id = firstString(record.id, record.model, record.name);
	if (id === "") return void 0;
	return {
		id,
		name: firstString(record.name, record.displayName, record.label, record.title, id)
	};
}
/**
* The reasoning-effort ladder, lowest first. Effort ids are adapter-owned, so
* this is only a RANKING hint: an id outside the ladder still forms a valid
* route, it just cannot be ordered against these.
*/
const REASONING_LEVEL_ORDER = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* The lowest reasoning effort a model advertises, from the `efforts` list of
* its resolved model info. Commit-message drafting is a one-line generation:
* the highest default (DSH's DeepSeek adapter defaults to `high` unless the
* connection configures otherwise) spends the output budget on thinking and
* can leave no text at all, so the cheapest supported level is requested
* explicitly. Mirrors pi-web's generate-commit.
*
* An UNKNOWN effort id never outranks a known one; when every id is unknown
* the adapter's own first entry wins (its declared order is the only signal
* available).
* @param efforts - `modelInfo.reasoning.efforts` (unknown shape).
* @returns the effort id to request, or undefined when the model advertises
* none (passing an effort to a non-reasoning model is rejected by the
* harness, so the caller must omit the field entirely).
*/
function lowestReasoningEffortOf(efforts) {
	if (!Array.isArray(efforts)) return void 0;
	const ids = [];
	for (const entry of efforts) {
		const id = entry !== null && typeof entry === "object" ? entry.id : void 0;
		if (typeof id === "string" && id !== "") ids.push(id);
	}
	let best;
	let bestRank = Number.POSITIVE_INFINITY;
	for (const id of ids) {
		const rank = REASONING_LEVEL_ORDER.indexOf(id);
		if (rank < 0) continue;
		if (rank < bestRank) {
			best = id;
			bestRank = rank;
		}
	}
	return best ?? ids[0];
}
/**
* The harness's default model selection (settings namespace
* `agent-default-model`), read tolerantly: it is the route a NEW conversation
* would use, so it is available before any message is sent — unlike the
* conversation-derived history.
* @param selection - `agentDefaultModel.currentSelection()`.
* @returns the default route, or undefined when the service or its value is
* unavailable.
*/
function defaultRouteOf(selection) {
	if (selection === null || typeof selection !== "object") return void 0;
	const record = selection;
	const provider = firstString(record.provider);
	const model = firstString(record.model);
	if (provider === "" || model === "") return void 0;
	return {
		provider,
		model
	};
}
/**
* Every provider/model route a session's log has actually USED, newest first
* and de-duplicated: the newest `request/header` event wins, so the list is
* the routes this deployment really dispatched on — the fallback a pinned
* model picker can always offer, even when the harness advertises no catalog.
* @param events - the session's log events (newest last).
* @param limit - max routes to return.
* @returns the distinct routes, newest first.
*/
function collectModelRoutes(events, limit = 20) {
	const routes = [];
	const seen = /* @__PURE__ */ new Set();
	for (let index = events.length - 1; index >= 0 && routes.length < limit; index--) {
		const event = events[index];
		if (event === void 0 || event.type !== "request/header") continue;
		const config = event.data?.header?.config;
		if (config === null || typeof config !== "object") continue;
		const provider = config.provider;
		const model = config.model;
		if (typeof provider !== "string" || provider === "") continue;
		if (typeof model !== "string" || model === "") continue;
		const key = `${provider}/${model}`;
		if (seen.has(key)) continue;
		seen.add(key);
		routes.push({
			provider,
			model
		});
	}
	return routes;
}
/**
* The Conventional-Commits prompt for one pending change set. Staged wins
* upstream (it is exactly what `git commit` records); `files` is the matching
* path list and `diff` the already-truncated patch text.
* @param language - the panel locale ('zh' | 'en').
* @param files - the changed paths the diff covers (repo-root relative).
* @param diff - the patch text (truncate with {@link truncateDiff} first).
* @returns the system and user halves, in that language.
*/
function buildCommitPrompt(language, files, diff) {
	const fileList = files.join("\n");
	if (language === "zh") return {
		system: "你是 git 提交信息生成助手。根据给定的文件清单与差异，生成一行 Conventional Commits 风格的中文提交信息（类型前缀：feat/fix/refactor/chore/docs/test/perf/style，必要时可附简短正文）。只输出提交信息本身，不要解释。",
		user: `改动的文件：\n${fileList}\n\n差异：\n${diff}`
	};
	return {
		system: "You are a git commit message assistant. Based on the given file list and diff, write a one-line Conventional Commits style commit message in English (type prefix: feat/fix/refactor/chore/docs/test/perf/style, with a short body when needed). Output only the commit message itself, no explanation.",
		user: `Changed files:\n${fileList}\n\nDiff:\n${diff}`
	};
}
/** Drop the model's prose scaffolding: fenced blocks, quotes and blank runs.
*  Models routinely wrap a one-line commit message in a code fence despite
*  the instruction; the panel inserts the text straight into the commit box,
*  so anything but the message itself would land in the commit. */
function cleanSuggestion(text) {
	return text.split("\n").filter((line) => !line.trimStart().startsWith("```")).join("\n").replace(/\r/g, "").split("\n").map((line) => line.trimEnd()).join("\n").trim();
}
//#endregion
//#region src/fs-batch.ts
/**
* Row bound of ONE `fs.trees` batch request.
*
* Shared by both halves so they cannot drift: the host refuses a larger batch
* outright (`too many paths (max N)`), and the client splits the visible set on
* the same number — a session whose persisted expansion set reaches the cap
* used to blank its WHOLE file tree on every mount/refresh. Kept free of
* runtime dependencies so the browser bundle pulls nothing in with it.
*/
const FS_TREES_MAX_PATHS = 64;
//#endregion
//#region src/active-worktree.ts
/**
* Follow the linked git worktree a session is ACTUALLY working in.
*
* The explorer starts from the host's committed workingDirectory, which can
* change independently of the immutable header. It can also follow a linked
* git worktree (`git worktree add`)
* during its life  including a worktree of a repository that is not the one
* the current directory points at  and the sidebar should follow it.
*
* The active root is derived from the session's own `tool/call` arguments:
* absolute paths are collected newest-event-first (structured `cwd` / `workdir`
* / `path` / ... fields weigh more than free-form mentions, repeated mentions
* accumulate), each path's git top level is resolved with
* `git rev-parse --show-toplevel` (falling back to its directory for files),
* and only top levels whose `--absolute-git-dir` differs from their
* `--git-common-dir` (i.e. real LINKED worktrees, not the main checkout and
* not submodules) are adopted. The highest-scoring linked worktree of the
* newest event that has one wins, but only evidence after the last committed
* working-directory/change is eligible. When there is no evidence the cwd is
* kept (lifted to the repository top level for subdirectory sessions).
*
* Resolutions are cached process-wide ({@link ACTIVE_ROOT_TTL_MS}), concurrent
* callers share one in-flight resolution AND one in-flight base probe, and
* every cache is bounded — so the client's periodic re-ask, the debounced
* fs-watch frames and the twelve route handlers that funnel through
* `cwdOf()` are answered without a process spawn after the first scan.
*/
/**
* How long one computed root is reused before the event log is scanned again.
*
* 15 s, deliberately longer than the client's per-tab 5 s poll: at 3 s every
* poll was a cache miss (one `git rev-parse --show-toplevel` spawn plus up to
* 4 000 events of backlog scanning per ask, measured 9.6–44.7 ms), which is
* the opposite of what this cache is for. The semantic cost of the longer TTL
* is that a session which MOVES into a linked worktree is followed within at
* most 15 s of the move (was 3 s) — every event-driven re-ask (fs-watch
* frames, route calls, editor opens) is served from the cache in the meantime
* and no refresh path is turned off.
*/
const ACTIVE_ROOT_TTL_MS = 15e3;
/** Only the newest slice of the event log is considered. */
const ACTIVE_ROOT_MAX_EVENTS = 4e3;
/** Upper bound on git probes per scan (cache misses are what cost). */
const ACTIVE_ROOT_MAX_PROBES = 24;
/** Bounds of the three process-wide caches below (LRU, oldest evicted first). */
const PATH_TOP_CACHE_MAX = 512;
const LINKED_WORKTREE_CACHE_MAX = 512;
const ACTIVE_ROOT_CACHE_MAX = 256;
/** Explicit override, mainly for tests and manual pinning. */
const ACTIVE_ROOT_OVERRIDE_ENV = "DSH_SIDEBAR_WORKTREE_ROOT";
/** Keys whose string values describe where a tool actually ran. */
const ACTIVE_ROOT_STRUCTURED_FIELD = /^(cwd|workdir|work_dir|workingdirectory|path|file_path|filepath|target|root)$/i;
/** Absolute Windows paths embedded in free-form command text. */
const ACTIVE_ROOT_PATH_PATTERN = /[A-Za-z]:(?:\\|\/)[^\\/\s"'\x60,;|)<>*?]+(?:[\\/][^\\/\s"'\x60,;|)<>*?]+)*/g;
/**
* One computed root per session, reused for {@link ACTIVE_ROOT_TTL_MS}. `base`
* is the RAW base the caller passed (not the lifted one), because the entry has
* to be usable BEFORE the git probe below: that probe is a real process spawn
* (measured ~7 ms), and the repeated asks  every debounced watch frame, every
* route call, the client's 5 s poll  are exactly what the TTL exists to keep
* free.
*
* All three maps are BOUNDED: a long-lived host (and a `keepMounted` right
* sidebar that keeps asking about every session it has ever shown) would
* otherwise grow them forever. `pathTopCache` caches negative answers too
* (`undefined` = "no git top level here"), which is what keeps a non-repo
* session cheap; those entries are evictable like any other.
*/
const activeWorktreeRootCache = /* @__PURE__ */ new Map();
const pathTopCache = /* @__PURE__ */ new Map();
const linkedWorktreeCache = /* @__PURE__ */ new Map();
/**
* In-flight de-duplication, mirroring `git.ts`'s `repoRootsInFlight`.
*
* `activeRootInFlight` collapses a burst of asks for the SAME (session, base)
* into one resolution (one base spawn, one event scan); `topLevelInFlight`
* collapses the base probe across DIFFERENT sessions that share a base (N tabs
* of one workspace would otherwise spawn N `git rev-parse` processes at once).
* Both delete their entry on the resolved AND the rejected path, so a failure
* never poisons the map.
*/
const activeRootInFlight = /* @__PURE__ */ new Map();
const topLevelInFlight = /* @__PURE__ */ new Map();
/**
* Insert or refresh one cache entry, evicting the least recently used entry
* once the cache holds more than `max`. Map iteration order is insertion
* order, so deleting before setting moves the key to the young end — which is
* what makes a HIT refresh recency (this is the repo's bounded-cache style
* from `fs-tree.ts`'s `directoryCache`, with the recency touch added).
*/
function cachePut(map, key, value, max) {
	map.delete(key);
	map.set(key, value);
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === void 0) break;
		map.delete(oldest);
	}
}
/** Latest committed directory change, observed incrementally per live Session. */
const directoryEpochs = /* @__PURE__ */ new WeakMap();
/**
* Cache identity must notice explicit cd even when its resulting base equals
* the old base (an old tool may have temporarily selected a linked worktree).
* Indexed reads inspect only newly appended events, with zero snapshot copies;
* unchanged live cursors cost O(1). A first read only needs the same bounded
* history window used by the worktree evidence scan.
*/
function directoryEpochOf(ctx, sessionId) {
	const session = ctx.sessions.get(sessionId);
	if (session?.seq === void 0 || session.eventAt === void 0) return void 0;
	const end = session.seq;
	const previous = directoryEpochs.get(session);
	if (previous?.through === end) return previous.epoch;
	const start = previous?.through ?? Math.max(0, end - ACTIVE_ROOT_MAX_EVENTS);
	let epoch = previous?.epoch ?? -1;
	for (let index = end - 1; index >= start; index -= 1) {
		const event = session.eventAt(index);
		if (event?.type !== "working-directory/change") continue;
		epoch = event.seq;
		break;
	}
	directoryEpochs.set(session, {
		through: end,
		epoch
	});
	return epoch;
}
/**
* Normalized IDENTITY of a path (case- and separator-insensitive), for
* comparisons and cache keys only: it lowercases, so it must never be handed
* back to the filesystem. On Linux (case-sensitive) `…/iHpOqm` → `…/ihpoqm`
* is a different, usually non-existent path, and probing it silently drops
* the candidate; macOS and Windows mask that because their filesystems fold
* case. Keep the real path next to its key.
*/
function pathKeyOf(value) {
	return value.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}
/** Whether `target` is `base` itself or lives under it. */
function pathUnderOf(base, target) {
	const b = pathKeyOf(base);
	const t = pathKeyOf(target);
	return t === b || t.startsWith(`${b}/`);
}
/** `git rev-parse --show-toplevel` of an existing directory, or undefined. */
async function gitTopLevelOf(cwd) {
	if (cwd === "" || !isAbsolute(cwd)) return void 0;
	try {
		if (!(await stat(cwd)).isDirectory()) return void 0;
		return (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
	} catch {
		return;
	}
}
/**
* {@link gitTopLevelOf} with in-flight sharing per path identity: concurrent
* asks for one directory (a route burst, or several sessions rooted in the
* same repository) spawn ONE git process between them.
*/
function topLevelOf(cwd) {
	const key = pathKeyOf(cwd);
	const pending = topLevelInFlight.get(key);
	if (pending !== void 0) return pending;
	const promise = gitTopLevelOf(cwd).then((top) => {
		topLevelInFlight.delete(key);
		return top;
	}, (error) => {
		topLevelInFlight.delete(key);
		throw error;
	});
	topLevelInFlight.set(key, promise);
	return promise;
}
/** Collapse duplicated separators without destroying a UNC prefix. */
function normalizeActivePath(value) {
	const trimmed = value.replace(/[\\/]+$/, "");
	if (trimmed.startsWith("\\\\")) return `\\\\${trimmed.slice(2).replace(/[\\/]+/g, "\\")}`;
	return trimmed.replace(/[\\/]+/g, sep);
}
function addActivePath(map, value, weight) {
	if (typeof value !== "string") return;
	const normalized = normalizeActivePath(value);
	if (normalized === "" || !isAbsolute(normalized)) return;
	const key = pathKeyOf(normalized);
	const entry = map.get(key);
	if (entry === void 0) map.set(key, {
		path: normalized,
		score: weight
	});
	else entry.score += weight;
}
/**
* Collect every absolute path one tool call mentions.
* @param value - JSON-decoded tool arguments (nested values are walked).
* @param map - accumulator keyed by normalized path identity.
* @param structured - whether the current value sits in a cwd/workdir/path field.
*/
function collectActivePaths(value, map, structured) {
	if (typeof value === "string") {
		if (isAbsolute(value)) {
			addActivePath(map, value, structured ? 8 : 1);
			return;
		}
		const head = value.charCodeAt(0);
		if (head === 123 || head === 91) try {
			collectActivePaths(JSON.parse(value), map, structured);
		} catch {}
		for (const match of value.match(ACTIVE_ROOT_PATH_PATTERN) ?? []) addActivePath(map, match, 1);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectActivePaths(item, map, structured);
		return;
	}
	if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) {
		const isStructured = ACTIVE_ROOT_STRUCTURED_FIELD.test(key);
		collectActivePaths(item, map, structured || isStructured);
	}
}
/** git top level for one path (its directory when the path names a file). */
async function topOfActivePath(value) {
	const key = pathKeyOf(value);
	if (pathTopCache.has(key)) {
		const cached = pathTopCache.get(key);
		cachePut(pathTopCache, key, cached, PATH_TOP_CACHE_MAX);
		return cached;
	}
	let top = await topLevelOf(value);
	if (top === void 0) top = await topLevelOf(dirname(value));
	const result = top === void 0 ? void 0 : requireAbsolute(top);
	cachePut(pathTopCache, key, result, PATH_TOP_CACHE_MAX);
	return result;
}
/**
* Whether a git top level is a LINKED worktree: its git dir lives under the
* common dir (`<main>/.git/worktrees/<name>`) instead of being it. Submodules
* report the same dir for both, so they are excluded.
*/
async function isLinkedWorktree(top) {
	const key = pathKeyOf(top);
	const cached = linkedWorktreeCache.get(key);
	if (cached !== void 0) {
		cachePut(linkedWorktreeCache, key, cached, LINKED_WORKTREE_CACHE_MAX);
		return cached;
	}
	let linked = false;
	try {
		const out = (await runGit(top, [
			"rev-parse",
			"--absolute-git-dir",
			"--git-common-dir"
		])).trim().split(/\r?\n/);
		const gitDir = out[0];
		const commonRaw = out[1] ?? "";
		if (gitDir !== void 0 && gitDir !== "" && commonRaw !== "") {
			const common = isAbsolute(commonRaw) ? commonRaw : join(top, commonRaw);
			linked = pathKeyOf(requireAbsolute(gitDir)) !== pathKeyOf(requireAbsolute(common));
		}
	} catch {
		linked = false;
	}
	cachePut(linkedWorktreeCache, key, linked, LINKED_WORKTREE_CACHE_MAX);
	return linked;
}
/** The newest linked worktree the session's tool/call paths resolve to. */
async function activeRootFromEvents(events, base) {
	if (events.length === 0) return void 0;
	const baseKey = pathKeyOf(base);
	const start = Math.max(0, events.length - ACTIVE_ROOT_MAX_EVENTS);
	let probes = 0;
	for (let index = events.length - 1; index >= start; index -= 1) {
		const event = events[index];
		if (event?.type === "working-directory/change") break;
		if (event === void 0 || event.type !== "tool/call") continue;
		const weights = /* @__PURE__ */ new Map();
		collectActivePaths(event.data, weights, false);
		if (weights.size === 0) continue;
		const ordered = [...weights.values()].sort((left, right) => right.score - left.score);
		const scores = /* @__PURE__ */ new Map();
		for (const candidate of ordered) {
			if (probes >= ACTIVE_ROOT_MAX_PROBES) break;
			probes += 1;
			const top = await topOfActivePath(candidate.path);
			if (top === void 0) continue;
			const topKey = pathKeyOf(top);
			if (topKey === baseKey) continue;
			if (!await isLinkedWorktree(top)) continue;
			const entry = scores.get(topKey);
			if (entry === void 0) scores.set(topKey, {
				top,
				score: candidate.score
			});
			else entry.score += candidate.score;
		}
		if (scores.size > 0) {
			let best;
			let bestScore = -1;
			for (const entry of scores.values()) if (entry.score > bestScore) {
				best = entry.top;
				bestScore = entry.score;
			}
			if (best !== void 0) return best;
		}
		if (probes >= ACTIVE_ROOT_MAX_PROBES) return void 0;
	}
}
/** The session's live event log, or the persisted one while it is detached. */
async function sessionEventsOf(ctx, sessionId) {
	const live = ctx.sessions.get(sessionId);
	const events = typeof live?.snapshotEvents === "function" ? live.snapshotEvents() : void 0;
	if (events !== void 0) return events;
	return (await readPersistedSessionOf(ctx, sessionId))?.events ?? [];
}
/**
* The directory the sidebar should treat as the session's root.
*
* The cache is consulted BEFORE the probe, and concurrent asks for the same
* (session, base) share ONE in-flight resolution: twelve route handlers funnel
* through `cwdOf()`, so a burst of parallel `/sidebar/*` calls used to spawn a
* `git rev-parse` process per call.
* @param ctx - host plugin context.
* @param sessionId - session whose tool calls are inspected.
* @param base - the authoritative session cwd (already resolved by the caller).
* @returns the active linked worktree, the repository top level, or `base`.
*/
async function activeWorktreeRootOf(ctx, sessionId, base) {
	if (base === "") return base;
	const override = (process.env[ACTIVE_ROOT_OVERRIDE_ENV] ?? "").trim();
	if (override !== "" && isAbsolute(override)) return requireAbsolute(override);
	const directoryEpoch = directoryEpochOf(ctx, sessionId);
	const cached = activeWorktreeRootCache.get(sessionId);
	if (cached !== void 0 && cached.expires > Date.now() && cached.base === base && cached.directoryEpoch === directoryEpoch) {
		cachePut(activeWorktreeRootCache, sessionId, cached, ACTIVE_ROOT_CACHE_MAX);
		return cached.root;
	}
	const flightKey = `${sessionId}\0${base}\0${directoryEpoch ?? ""}`;
	const pending = activeRootInFlight.get(flightKey);
	if (pending !== void 0) return pending;
	const promise = resolveActiveWorktreeRoot(ctx, sessionId, base, directoryEpoch).then((root) => {
		activeRootInFlight.delete(flightKey);
		return root;
	}, (error) => {
		activeRootInFlight.delete(flightKey);
		throw error;
	});
	activeRootInFlight.set(flightKey, promise);
	return promise;
}
/** One uncached resolution (see {@link activeWorktreeRootOf}). */
async function resolveActiveWorktreeRoot(ctx, sessionId, base, directoryEpoch) {
	const top = await topLevelOf(base);
	if (top === void 0) {
		cachePut(activeWorktreeRootCache, sessionId, {
			root: base,
			base,
			directoryEpoch,
			expires: Date.now() + ACTIVE_ROOT_TTL_MS
		}, ACTIVE_ROOT_CACHE_MAX);
		return base;
	}
	const canonicalTop = requireAbsolute(top);
	const effectiveBase = pathUnderOf(base, canonicalTop) ? base : canonicalTop;
	const root = await activeRootFromEvents(await sessionEventsOf(ctx, sessionId), effectiveBase) ?? effectiveBase;
	cachePut(activeWorktreeRootCache, sessionId, {
		root,
		base,
		directoryEpoch,
		expires: Date.now() + ACTIVE_ROOT_TTL_MS
	}, ACTIVE_ROOT_CACHE_MAX);
	return root;
}
//#endregion
//#region src/editor-limits.ts
/**
* The one size constant both halves need, kept dependency-free on purpose.
*
* This replaces the retired `readLimit` deployment knob (`config.ts`). The old
* cap answered "how many bytes may the host hand the client" by truncating the
* document — which produced an editor that could neither be trusted nor saved
* (issue #732: saving a partial document destroys the tail). Transfer size is
* no longer a thing this plugin limits at all: upload, download, the HTML
* preview route and the archive route all stream, so a 10 GB file is simply a
* 10 GB file.
*
* What is still bounded is what an EDITOR can hold. CodeMirror keeps the whole
* document in the browser, so a file above this size gets a read-only paged
* preview (see `paged-text.tsx` / `jsonl-preview.tsx`) instead of an edit
* buffer. VS Code draws the same line at a different number — its
* `getLargeFileConfirmationLimit()` is 50 MB on the web build — and the shape
* of the answer (threshold → degraded read-only view) is deliberately the same.
*
* Imported by BOTH halves, so this module must stay free of node builtins and
* of anything that reaches them.
*/
/**
* Text files at or below this size load whole and are editable; anything above
* gets the read-only paged preview.
*/
const MAX_EDITABLE_BYTES = 5242880;
/**
* Bytes one `fs.readPage` request returns. Pages are trimmed back to the last
* newline so a page is normally a whole number of lines (and therefore, for
* JSONL, a whole number of records); a single line longer than this is
* returned untrimmed and stitched back together by the client.
*
* Sized so that even a file of very short lines lands in the low thousands of
* rendered rows per page — the preview renders a page's rows as plain elements,
* and the page size is the only thing bounding that.
*/
const PAGE_BYTES = 131072;
/**
* Hard ceiling on one editor save request body.
*
* This is a SERVER-SIDE SANITY GUARD, not a product limit: the editor cannot
* produce more than {@link MAX_EDITABLE_BYTES} of text, so the UI can never
* reach it. It exists because the save route receives a raw body and the
* encoding transform (`restoreEol` + `encodeText`) needs the whole document as
* a string.
*/
const WRITE_BODY_GUARD_BYTES = 8388608;
//#endregion
//#region src/index.ts
/**
* dsh-better-sidebar host half: the /sidebar JSON API (explorer listing, file
* read/write, git), the /sidebar/file media route (images), the /sidebar/html
* preview route, the /sidebar/bundle lazy-chunk route (client code splits),
* and the WebSocket upgrades. Every route delegates admission to the same
* public Connection service as the /api gateway (Host/Origin and browser
* authentication), read per request.
*
* All operations are conversation-scoped: requests carry a sessionId and the
* session's authoritative cwd comes from the session store.
*/
/** Plugin identity for cordis.yml rows. */
const name = "dsh-better-sidebar";
/** Services required before mounting: routes, sessions, native request admission, and tools. */
const inject = [
	"webServer",
	"sessions",
	"connection",
	"tools"
];
/** Content types for the media route, by extension. */
const MEDIA_TYPES = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".avif": "image/avif",
	".pdf": "application/pdf",
	".html": "text/html",
	".htm": "text/html"
};
/** Content type served by /sidebar/file (binary-safe fallback for unknowns). */
function mediaTypeForPath(path) {
	return MEDIA_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}
/**
* Resolve the committed execution directory before client or original-header
* hints. Live reads are synchronous; detached reads use the host observation
* lease and its revision-keyed projection cache, never a plugin-owned log fold
* or TTL that could hide a working_directory change.
*/
async function sessionCwdOf(ctx, sessionId, clientCwd) {
	const session = ctx.sessions.get(sessionId);
	if (session !== void 0) {
		const cwd = ctx.get("workingDirectory")?.get(session) ?? session.header.cwd;
		if (cwd !== void 0 && cwd !== "") return cwd;
	}
	const query = ctx.get("sessionQuery");
	if (query !== void 0) {
		const observation = await query.observeSession(sessionId, { projectionMode: "all" });
		try {
			const cwd = observation.projections?.values.workingDirectory ?? observation.header.cwd ?? ctx.get("workingDirectory")?.defaultDirectory;
			if (cwd !== void 0 && cwd !== "") return requireAbsolute(cwd);
		} finally {
			observation[Symbol.dispose]();
		}
	}
	if (clientCwd !== void 0 && clientCwd !== "") try {
		return requireAbsolute(clientCwd);
	} catch {
		throw new SidebarError("bad-request", `invalid working directory "${clientCwd}"`);
	}
	const persistence = ctx.get("sessionPersistence");
	if (persistence !== void 0) {
		const metaCwd = (await readPersistedSession(persistence, sessionId)).header.cwd;
		if (metaCwd !== void 0 && metaCwd !== "") try {
			return requireAbsolute(metaCwd);
		} catch {
			throw new SidebarError("bad-request", `invalid working directory "${metaCwd}"`);
		}
	}
	return process.cwd();
}
/** Optional repository selected by the Git panel when cwd is a container. */
function selectedRepoOf(payload) {
	if (payload.repoRoot === void 0) return void 0;
	return requireAbsolute(requireString(payload, "repoRoot"));
}
/** One required 1-based line number of a `git blame -L` request. */
function requireLineNumber(payload, key) {
	const value = payload?.[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new SidebarError("bad-request", `"${key}" must be a positive integer line number`);
	return value;
}
/**
* Resolve a relative path an EDITOR surface carried (the file tree, the
* editor buffer, and `fs.read`, which the untracked-diff fallback reads
* through): the session-relative interpretation wins when it names an
* existing path, with the repository root as the fallback. Git's
* status/diff ROWS deliberately do NOT come through here — they are
* repository-root-relative by construction, see {@link resolveStatusPath}.
*/
async function resolveGitPath(cwd, raw, selected) {
	if (isAbsolute(raw)) return requireAbsolute(resolveSessionPath(cwd, raw));
	const sessionPath = requireAbsolute(join(cwd, raw));
	if (await stat(sessionPath).then(() => true).catch(() => false)) return sessionPath;
	const root = await repoRoot(cwd, selected).catch(() => cwd);
	return requireAbsolute(join(root, raw));
}
/** Max providers / per-provider models the `git.models` catalog answers with.
*  The catalog only feeds the Git card's pinned-model dropdown, so a huge
*  deployment still resolves to a bounded, fast reply. */
const MODEL_CATALOG_PROVIDER_LIMIT = 20;
const MODEL_CATALOG_MODEL_LIMIT = 50;
/** The Git card's plugin-owned settings key holding the pinned
*  `provider/model` route ('' or absent = follow the conversation). */
const COMMIT_MODEL_SETTING_KEY = "commitModel";
/**
* The provider/model route the user PINNED for commit-message generation
* (the Git card's settings write `pluginSettings.git.commitModel`). Absent,
* empty or malformed means "follow the conversation" — a bad value must
* never lock the feature out, it falls back.
*/
function pinnedCommitRouteOf(getSettings) {
	const value = getSettings()?.get().value;
	if (value === null || typeof value !== "object") return void 0;
	const pluginSettings = value.pluginSettings;
	if (pluginSettings === null || typeof pluginSettings !== "object") return void 0;
	const blob = pluginSettings.git;
	if (blob === null || typeof blob !== "object") return void 0;
	return parseModelRoute(blob[COMMIT_MODEL_SETTING_KEY]);
}
/**
* The provider/model route the CURRENT conversation runs on, read without
* spawning anything: the live agent's own options are authoritative, and a
* session that has not attached yet still carries its newest `request/header`
* event (the record the agent loop writes). Undefined while neither is
* available — a cold conversation with no request yet has no route to follow.
*/
function conversationModelRoute(ctx, sessionId) {
	const options = ctx.get("agents")?.get(sessionId)?.options;
	if (options !== void 0 && typeof options.provider === "string" && options.provider !== "" && typeof options.model === "string" && options.model !== "") return {
		provider: options.provider,
		model: options.model
	};
	const events = ctx.sessions.get(sessionId)?.snapshotEvents();
	return events === void 0 ? void 0 : collectModelRoutes(events, 1)[0];
}
/**
* The harness's DEFAULT model route (settings namespace `agent-default-model`):
* the route a brand-new conversation would use, so the suggestion still works
* on a session that has not sent its first message (no `request/header` yet)
* and in a deployment whose LLM adapters advertise no catalog.
*/
function defaultModelRoute(ctx) {
	return defaultRouteOf(ctx.get("agentDefaultModel")?.currentSelection());
}
/** Output budget of one suggestion: enough for a subject plus a short body,
*  and (with reasoning pinned to the lowest level) no more. */
const SUGGEST_MAX_TOKENS = 512;
/** Hard deadline of one suggestion (the panel shows the model as busy while
*  it runs, so a stalled provider must not leave it spinning forever). */
const SUGGEST_TIMEOUT_MS = 3e4;
/**
* The reasoning effort to request for one route: the LOWEST the model
* advertises, or undefined when it advertises none. A one-line commit message
* needs no deliberation, while a high default (the DeepSeek adapter defaults
* to `high` unless the connection says otherwise) both delays the answer and
* can consume the whole output budget, yielding an empty message.
*/
async function commitReasoningEffort(llm, route) {
	if (llm.resolveModelInfo === void 0) return void 0;
	return lowestReasoningEffortOf((await Promise.resolve(llm.resolveModelInfo(route.provider, route.model)).catch(() => void 0))?.reasoning?.efforts);
}
/**
* One generation stream through the harness LLM service. The service is not
* injected (the plugin must not require it), so it is read through `ctx.get`
* and checked: a deployment without the LLM surface gets a clean 503 instead
* of a TypeError. Chunks are assembled with the harness's own BlockAssembler
* — the same chunk-to-message algorithm the agent loop uses.
*/
async function streamCommitMessage(ctx, route, system, user) {
	const llm = ctx.get("llm");
	if (llm === void 0) throw new SidebarError("git-suggest-error", "the harness LLM service is unavailable", 503);
	const effort = await commitReasoningEffort(llm, route);
	const assembler = new BlockAssembler();
	try {
		for await (const chunk of llm.stream({
			provider: route.provider,
			model: route.model,
			messages: [createUserMessage({
				content: [{
					type: "text",
					text: user
				}],
				source: { kind: "plugin:dsh-better-sidebar" }
			})],
			system,
			maxTokens: SUGGEST_MAX_TOKENS,
			signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
			...effort === void 0 ? {} : { reasoningEffort: effort }
		})) assembler.push(chunk);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw new SidebarError("git-suggest-error", `the model did not answer within ${Math.round(SUGGEST_TIMEOUT_MS / 1e3)}s`, 504);
		throw error;
	}
	const message = cleanSuggestion(assembler.blocks().map((block) => block.type === "text" ? block.text : "").join(""));
	if (message === "") {
		const finish = assembler.finish?.kind;
		throw new SidebarError("git-suggest-error", `the model returned an empty message (finish=${typeof finish === "string" ? finish : "unknown"})`, 500);
	}
	return message;
}
/**
* Resolve a path a git status/diff ROW carried: the changes tree's rows and
* every action they offer (the inline diff preview, and the destructive
* discard). Git prints those paths RELATIVE TO THE REPO TOP LEVEL, which may
* sit above the session cwd, and the client forwards them verbatim — so a
* relative name ALWAYS joins the repository root. Joining the session cwd
* first instead hit a same-named file in the subdirectory the session sits
* in (#765: `git.discard` on the row `README.md` restored the `pkg/README.md`
* one level down and left the root `README.md` — the file the row names —
* dirty). Absolute paths pass through; a cwd outside any repository falls
* back to itself, where the git command fails exactly as it did before.
*/
async function resolveStatusPath(cwd, raw, selected) {
	if (isAbsolute(raw)) return requireAbsolute(resolveSessionPath(cwd, raw));
	const root = await repoRoot(cwd, selected).catch(() => cwd);
	return requireAbsolute(join(root, raw));
}
/** How many leading bytes a binary read returns for client-side detect sniffing. */
const READ_HEAD_LIMIT = 4096;
/**
* `stat` one path for a raw byte route, turning an unreadable path into the
* route's own error shape.
*
* A bare `stat` rejection escaped as a 500 "internal", which reads as a plugin
* fault; a file the user asked for that does not exist (or cannot be read) is
* a 400 with a usable message. The streaming helper opens the file BEFORE
* committing the response for the same reason — the error has to stay
* deliverable.
*/
async function statFileForRoute(path) {
	return await stat(path).catch((error) => {
		throw new SidebarError("fs-error", `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400);
	});
}
/**
* Read one file for the editor host.
*
* Three outcomes, and the size policy is deliberately about EDITING rather
* than about transfer:
*
* - at or below {@link MAX_EDITABLE_BYTES}: the whole document (or the binary
*   verdict + a 4 KiB sniff head);
* - above it: `too-large`, carrying only the 4 KiB head. The client answers it
*   with the read-only paged preview, and the head still lets a `detect`-based
*   third-party viewer claim the file — which is also what keeps the binary
*   path (images, office documents) intact for a file of any size.
*
* There is no truncation outcome any more. The old capped read handed the
* editor a partial document it could neither trust nor save (issue #732);
* "too big to edit" is now its own state instead of a quietly damaged one.
*
* Text encoding is detected before the NUL-based binary verdict, so UTF-16 /
* UTF-32 / GBK text stays text.
*/
async function readText(path) {
	const info = await stat(path).catch((error) => {
		throw new SidebarError("fs-error", `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400);
	});
	if (info.isDirectory()) throw new SidebarError("fs-error", `"${path}" is a directory`, 400);
	const size = info.size;
	const oversized = size > MAX_EDITABLE_BYTES;
	const handle = await open(path, "r").catch((error) => {
		throw new SidebarError("fs-error", `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400);
	});
	try {
		const window = oversized ? READ_HEAD_LIMIT : size;
		const buffer = Buffer.alloc(window);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const slice = buffer.subarray(0, bytesRead);
		const decoded = decodeTextBytes(slice, oversized);
		if (decoded === null) return {
			kind: "binary",
			size,
			mtimeMs: info.mtimeMs,
			head: slice.subarray(0, Math.min(slice.length, READ_HEAD_LIMIT)).toString("base64")
		};
		if (oversized) return {
			kind: "too-large",
			size,
			mtimeMs: info.mtimeMs,
			head: slice.toString("base64")
		};
		return {
			kind: "text",
			content: decoded.content,
			size,
			mtimeMs: info.mtimeMs
		};
	} finally {
		await handle.close();
	}
}
/**
* The WIDE encoding a file was found to use, per (path, size, mtime) triple.
*
* Only wide encodings (UTF-16/UTF-32) are memoized, and that is the whole
* point: a page window that happens to contain no NUL bytes cannot tell wide
* text from byte-oriented text, so a later window of a UTF-16 document must
* not be allowed to re-decide. Byte-oriented encodings (UTF-8 / GBK / GB18030)
* are deliberately NOT memoized — a long ASCII prefix sniffs as UTF-8 while a
* later GBK window sniffs as GBK, and decoding each window on its own terms is
* what recovers the right text for both. (That is safe because pages are
* line-aligned: 0x0A can be neither a UTF-8 continuation byte nor a GBK trail
* byte, so a window boundary never splits a character.)
*
* The size+mtime in the key drops the entry the moment the file changes.
*/
const wideEncodingCache = /* @__PURE__ */ new Map();
/** Bound on {@link wideEncodingCache} (a paged read is a handful of entries). */
const PAGE_ENCODING_CACHE_MAX = 64;
/**
* Read one byte window of a text file, trimmed back to the last newline so a
* page is a whole number of lines — and, for a JSONL file, a whole number of
* records.
*
* A window with no newline at all (one line longer than {@link PAGE_BYTES}) is
* returned untrimmed: the client stitches consecutive pages back together and
* gives up on a single record past its own bound.
*
* @param path - absolute, already resolved path.
* @param offset - byte offset to start at (`0` for the first page).
* @throws {SidebarError} fs-error for an unreadable path or a bad offset.
*/
async function readPage(path, offset) {
	const info = await stat(path).catch((error) => {
		throw new SidebarError("fs-error", `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400);
	});
	if (info.isDirectory()) throw new SidebarError("fs-error", `"${path}" is a directory`, 400);
	const size = info.size;
	if (offset >= size) return {
		kind: "text",
		text: "",
		offset,
		nextOffset: size,
		eof: true,
		size,
		mtimeMs: info.mtimeMs,
		encoding: "utf8"
	};
	const handle = await open(path, "r").catch((error) => {
		throw new SidebarError("fs-error", `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400);
	});
	try {
		const length = Math.min(PAGE_BYTES, size - offset);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, offset);
		let slice = buffer.subarray(0, bytesRead);
		let nextOffset = offset + bytesRead;
		const cacheKey = `${path}\u0000${size}\u0000${info.mtimeMs}`;
		const locked = wideEncodingCache.get(cacheKey);
		if (nextOffset < size) {
			const lastBreak = lastLineBreakEnd(slice, locked ?? "utf8");
			if (lastBreak >= 0) {
				slice = slice.subarray(0, lastBreak);
				nextOffset = offset + lastBreak;
			}
		}
		const decoded = decodeTextBytes(slice, true);
		let encoding;
		let text;
		if (locked !== void 0) {
			encoding = locked;
			text = offset === 0 && decoded !== null ? decoded.content : decodeTextAs(slice, locked);
		} else {
			encoding = decoded?.encoding ?? "utf8";
			text = decoded?.content ?? decodeTextAs(slice, "utf8");
			if (decoded !== null && isWideEncoding(decoded.encoding)) {
				if (wideEncodingCache.size >= PAGE_ENCODING_CACHE_MAX) {
					const oldest = wideEncodingCache.keys().next();
					if (!oldest.done) wideEncodingCache.delete(oldest.value);
				}
				wideEncodingCache.set(cacheKey, decoded.encoding);
			}
		}
		return {
			kind: "text",
			text,
			offset,
			nextOffset,
			eof: nextOffset >= size,
			size,
			mtimeMs: info.mtimeMs,
			encoding
		};
	} finally {
		await handle.close();
	}
}
function buildApi(ctx, resolved, getSettings, assistantLive, archiveTasks) {
	const cwdOf = async (payload) => {
		const sessionId = requireString(payload, "sessionId");
		const record = payload;
		return {
			sessionId,
			cwd: await activeWorktreeRootOf(ctx, sessionId, await sessionCwdOf(ctx, sessionId, typeof record?.cwd === "string" && record.cwd !== "" ? record.cwd : void 0))
		};
	};
	/** Resolve the optional Git-panel checkout selector against the selected
	* session repository. Unlike `cwd`, `worktree` is never trusted directly. */
	const gitCwdOf = async (payload) => {
		const base = await cwdOf(payload);
		const record = payload;
		const requested = typeof record?.worktree === "string" && record.worktree !== "" ? record.worktree : void 0;
		if (requested === void 0) return base;
		const root = await repoRoot(base.cwd, selectedRepoOf(payload));
		return {
			sessionId: base.sessionId,
			cwd: await resolveWorktree(root, requested)
		};
	};
	const subagentLiveApi = buildSubagentLiveApi(ctx);
	const changesOps = createChangesOpsApi(ctx);
	const workflowsApi = buildWorkflowsApi(ctx);
	const teamsApi = buildTeamsApi(ctx);
	return {
		"session.phase": async (payload) => {
			const sessionId = requireString(payload, "sessionId");
			const session = ctx.sessions.get(sessionId);
			if (session === void 0) return { blank: false };
			return { blank: !session.snapshotEvents().some((event) => event.type === "user/message" || event.type === "assistant/message") };
		},
		"session.cwd": async (payload) => {
			const { sessionId, cwd } = await cwdOf(payload);
			return {
				sessionId,
				cwd,
				root: rootLabel(cwd),
				parent: parentOf(cwd) ?? null
			};
		},
		"fs.tree": async (payload) => {
			const { cwd } = await cwdOf(payload);
			const record = payload;
			const target = record.path === void 0 ? cwd : await ensureWorkspacePath(cwd, requireString(payload, "path"));
			const exclude = compileExcludePatterns(record.exclude, cwd);
			return listDirectory(target, resolved.listLimit, exclude, createProbeGate());
		},
		"fs.trees": async (payload) => {
			const { cwd } = await cwdOf(payload);
			const record = payload;
			const paths = Array.isArray(record?.paths) ? record.paths.filter((value) => typeof value === "string" && value !== "") : [];
			if (paths.length === 0) throw new SidebarError("bad-request", "paths must be a non-empty array");
			if (paths.length > 64) throw new SidebarError("bad-request", `too many paths (max 64)`);
			const exclude = compileExcludePatterns(record?.exclude, cwd);
			const gate = createProbeGate();
			return { levels: await Promise.all(paths.map(async (raw) => {
				const homeRelative = raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\");
				const requested = isAbsolute(raw) || homeRelative ? raw : `${cwd}${sep}${raw}`;
				try {
					return await listDirectory(await ensureWorkspacePath(cwd, requested), resolved.listLimit, exclude, gate);
				} catch (error) {
					return {
						path: requested,
						entries: [],
						truncated: false,
						error: messageOf(error)
					};
				}
			})) };
		},
		"fs.search": async (payload) => {
			const { cwd } = await cwdOf(payload);
			const record = payload;
			return searchFiles(cwd, requireString(payload, "query"), { exclude: compileExcludePatterns(record.exclude, cwd) });
		},
		"fs.read": async (payload) => {
			const { cwd } = await cwdOf(payload);
			const selected = selectedRepoOf(payload);
			return await readText(await ensureWorkspacePath(cwd, await resolveGitPath(cwd, requireString(payload, "path"), selected)));
		},
		"fs.readPage": async (payload) => {
			const { cwd } = await cwdOf(payload);
			const selected = selectedRepoOf(payload);
			const path = await ensureWorkspacePath(cwd, await resolveGitPath(cwd, requireString(payload, "path"), selected));
			const record = payload;
			return await readPage(path, typeof record?.offset === "number" && Number.isFinite(record.offset) && record.offset >= 0 ? Math.floor(record.offset) : 0);
		},
		"fs.rename": async (payload) => {
			const { cwd } = await cwdOf(payload);
			return renameWorkspaceEntry({
				cwd,
				path: requireString(payload, "path"),
				name: requireString(payload, "name")
			});
		},
		"fs.mkdir": async (payload) => {
			const { cwd } = await cwdOf(payload);
			return mkdirWorkspaceEntry({
				cwd,
				path: requireString(payload, "path"),
				name: requireString(payload, "name")
			});
		},
		"fs.createFile": async (payload) => {
			const { cwd } = await cwdOf(payload);
			return createWorkspaceFile({
				cwd,
				path: requireString(payload, "path"),
				name: requireString(payload, "name")
			});
		},
		"fs.remove": async (payload) => {
			const { cwd } = await cwdOf(payload);
			return removeWorkspaceEntry({
				cwd,
				path: requireString(payload, "path")
			});
		},
		"git.worktrees": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			const selected = selectedRepoOf(payload);
			return worktrees(selected !== void 0 ? await repoRoot(cwd, selected).catch(() => cwd) : cwd);
		},
		"git.status": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			return status(cwd, selectedRepoOf(payload));
		},
		"git.diff": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			const record = payload;
			const repoRoot = selectedRepoOf(payload);
			return { diff: await diff(cwd, record.path === void 0 ? void 0 : await resolveStatusPath(cwd, requireString(payload, "path"), repoRoot), record.staged === true, repoRoot) };
		},
		"git.diff-head": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			const repoRoot = selectedRepoOf(payload);
			return { diff: await diffHead(cwd, await ensureWorkspacePath(cwd, await resolveGitPath(cwd, requireString(payload, "path"), repoRoot)), repoRoot) };
		},
		"git.stage": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await stage(cwd, payload.path === void 0 ? void 0 : requireString(payload, "path"), selectedRepoOf(payload));
			return { ok: true };
		},
		"git.unstage": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await unstage(cwd, payload.path === void 0 ? void 0 : requireString(payload, "path"), selectedRepoOf(payload));
			return { ok: true };
		},
		"git.commit": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await commit(cwd, requireString(payload, "message"), selectedRepoOf(payload));
			return { ok: true };
		},
		"git.push": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await push(cwd, selectedRepoOf(payload));
			return { ok: true };
		},
		"git.pull": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await pull(cwd, selectedRepoOf(payload));
			return { ok: true };
		},
		"git.branch": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			return branches(cwd, selectedRepoOf(payload));
		},
		"git.checkout": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await checkout(cwd, requireString(payload, "branch"), selectedRepoOf(payload));
			return { ok: true };
		},
		"git.graph": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			try {
				return await gitGraph(cwd, payload, selectedRepoOf(payload));
			} catch (error) {
				if (error instanceof GitCommandError && (error.code === "graph-stale" || error.code === "graph-limit" || error.code === "bad-request")) throw new SidebarError(error.code, error.message, error.code === "graph-stale" ? 409 : 400);
				throw error;
			}
		},
		"git.log": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			const record = payload;
			return log(cwd, typeof record.count === "number" && Number.isInteger(record.count) && record.count > 0 ? record.count : void 0, typeof record.skip === "number" && Number.isInteger(record.skip) && record.skip >= 0 ? record.skip : void 0, selectedRepoOf(payload));
		},
		"git.commit-diff": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			return { diff: await commitDiff(cwd, requireString(payload, "hash"), selectedRepoOf(payload)) };
		},
		"git.discard": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			const repoRoot = selectedRepoOf(payload);
			await discard(cwd, await resolveStatusPath(cwd, requireString(payload, "path"), repoRoot), repoRoot);
			return { ok: true };
		},
		"git.revert": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await revert(cwd, requireString(payload, "hash"), selectedRepoOf(payload));
			return { ok: true };
		},
		"git.cherry-pick": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			await cherryPick(cwd, requireString(payload, "hash"), selectedRepoOf(payload));
			return { ok: true };
		},
		"git.show": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			const repoRoot = selectedRepoOf(payload);
			const path = requireString(payload, "path");
			return { content: await show(cwd, requireString(payload, "rev"), path, repoRoot) };
		},
		"git.blame": async (payload) => {
			const { cwd } = await gitCwdOf(payload);
			const repoRoot = selectedRepoOf(payload);
			const path = await ensureWorkspacePath(cwd, await resolveGitPath(cwd, requireString(payload, "path"), repoRoot));
			const startLine = requireLineNumber(payload, "startLine");
			const endLine = requireLineNumber(payload, "endLine");
			if (endLine < startLine) throw new SidebarError("bad-request", "\"endLine\" must not precede \"startLine\"");
			return { lines: await blame(cwd, path, startLine, endLine, repoRoot) };
		},
		"git.suggest-message": async (payload) => {
			const { cwd, sessionId } = await gitCwdOf(payload);
			const repoRoot = selectedRepoOf(payload);
			const language = normalizeLanguage(payload.language);
			const route = pinnedCommitRouteOf(getSettings) ?? conversationModelRoute(ctx, sessionId) ?? defaultModelRoute(ctx);
			if (route === void 0) throw new SidebarError("git-suggest-error", "cannot resolve a model route for this conversation", 503);
			const status$1 = await status(cwd, repoRoot);
			const staged = status$1.entries.filter((entry) => entry.xy[0] !== " " && entry.xy[0] !== "?");
			const untracked = status$1.entries.filter((entry) => entry.xy === "??");
			const unstaged = status$1.entries.filter((entry) => entry.xy !== "??" && entry.xy[1] !== " " && entry.xy[1] !== "?");
			if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) throw new SidebarError("git-suggest-empty", "no pending changes", 400);
			const focus = staged.length > 0 ? {
				diff: await diff(cwd, void 0, true, repoRoot),
				files: staged
			} : unstaged.length > 0 ? {
				diff: await diff(cwd, void 0, false, repoRoot),
				files: unstaged
			} : {
				diff: "",
				files: untracked
			};
			const prompt = buildCommitPrompt(language, focus.files.map((entry) => entry.path), truncateDiff(focus.diff));
			return {
				message: await streamCommitMessage(ctx, route, prompt.system, prompt.user),
				provider: route.provider,
				model: route.model
			};
		},
		"git.commit-model": (payload) => {
			const record = payload ?? {};
			const pinned = pinnedCommitRouteOf(getSettings);
			const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
			const route = pinned ?? (sessionId === "" ? void 0 : conversationModelRoute(ctx, sessionId)) ?? defaultModelRoute(ctx);
			return {
				...route === void 0 ? {} : { route },
				/** Whether the route above is a PINNED one (the panel may want to
				*  label it differently from the conversation's own model). */
				pinned: pinned !== void 0
			};
		},
		"git.models": async (payload) => {
			const record = payload ?? {};
			const llm = ctx.get("llm");
			const providers = llm === void 0 ? [] : await Promise.resolve(llm.listProviders()).then((listed) => Array.isArray(listed) ? listed.slice(0, MODEL_CATALOG_PROVIDER_LIMIT) : []).then((entries) => Promise.all(entries.map(async (entry) => {
				const parsed = providerEntryOf(entry);
				if (parsed === void 0) return {
					provider: "",
					name: "",
					models: []
				};
				const models = await Promise.resolve(llm.listModels(parsed.provider)).then((list) => Array.isArray(list) ? list.slice(0, MODEL_CATALOG_MODEL_LIMIT) : []).catch(() => []);
				return {
					provider: parsed.provider,
					name: parsed.label,
					models: models.flatMap((model) => {
						const item = modelEntryOf(model);
						return item === void 0 ? [] : [{
							id: item.id,
							name: item.name
						}];
					})
				};
			}))).catch(() => []);
			const events = typeof record.sessionId === "string" ? ctx.sessions.get(record.sessionId)?.snapshotEvents() ?? [] : [];
			return {
				llm: llm !== void 0,
				providers: providers.filter((provider) => provider.provider !== ""),
				recent: collectModelRoutes(events),
				default: defaultModelRoute(ctx)
			};
		},
		"changes.ops": changesOps,
		"subagents.live": (payload) => subagentLiveApi.live(payload),
		"workflows.list": (payload) => workflowsApi.list(payload),
		"teams.taskCreate": (payload) => teamsApi.taskCreate(payload),
		"teams.taskUpdate": (payload) => teamsApi.taskUpdate(payload),
		"settings.get": () => {
			const settings = getSettings();
			return settings === void 0 ? {
				value: void 0,
				revision: void 0,
				externalDisable: false
			} : {
				...settings.get(),
				externalDisable: settings.externalDisable()
			};
		},
		"settings.update": async (payload) => {
			const settings = getSettings();
			if (settings === void 0) throw new SidebarError("settings-rejected", "the settings service is not mounted in this deployment", 503);
			const record = payload;
			const patch = record?.patch;
			if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new SidebarError("bad-request", "patch must be a plain object");
			const expectedRevision = typeof record?.expectedRevision === "number" ? record.expectedRevision : void 0;
			try {
				return await settings.update(patch, expectedRevision);
			} catch (error) {
				if (error instanceof SettingsConflictError) throw new SidebarError("settings-conflict", error.message, 409);
				throw new SidebarError("settings-rejected", error instanceof Error ? error.message : String(error), 400);
			}
		},
		"open.external": (payload) => {
			const action = payload?.action;
			if (action === "reveal") return launchExternal("reveal", requireString(payload, "path"));
			if (action === "url") return launchExternal("url", requireString(payload, "url"));
			throw new SidebarError("bad-request", "action must be \"reveal\" or \"url\"");
		},
		"archive.build": async (payload) => {
			const { sessionId, cwd } = await cwdOf(payload);
			const record = payload;
			const paths = Array.isArray(record?.paths) ? record.paths.filter((value) => typeof value === "string" && value !== "") : [];
			if (paths.length === 0) throw new SidebarError("bad-request", "paths must be a non-empty array");
			const name = typeof record?.name === "string" ? record.name : "";
			const selected = [];
			for (const raw of paths) selected.push(await ensureWorkspacePath(cwd, raw));
			return await archiveTasks.start({
				sessionId,
				name,
				paths: selected
			});
		},
		"archive.status": (payload) => archiveTasks.status(requireString(payload, "id"), requireString(payload, "sessionId")),
		...buildSidechatApi(ctx, assistantLive)
	};
}
/** The npm package name of this plugin, exactly as its Loader row declares it. */
const SIDEBAR_PACKAGE_NAME = "dsh-better-sidebar";
/**
* Profile entry id of the sibling `dsh-web-ui` right panel this sidebar yields
* to when it is the active provider. Kept as a literal: it is that plugin's
* own mount choice, not a contract this plugin can derive.
*/
const AIONUI_PANEL_ENTRY = "aionui-panel";
/** The file-backed settings document DSH 0.1.7 retired. */
const LEGACY_SETTINGS_FILE = "settings.yaml";
/**
* The Loader entry id of this plugin's own row.
*
* DSH 0.1.7 addresses settings forms by profile entry id, and that id is a
* mount choice rather than a package property: this bundle's patch uses
* `better-sidebar`, while an aggregate bundle mounts the same package under
* its own id. The row is therefore identified by the package name plus fiber
* identity, with an enabled same-name row as the fallback for the moment
* before the fiber is attached.
* @param ctx - the plugin's own context.
* @returns the row's configured id, or undefined when no row can be identified.
*/
function ownEntryId(ctx) {
	let fallback;
	try {
		for (const entry of ctx.loader.entries()) {
			const id = entry.options.id;
			if (entry.options.name !== SIDEBAR_PACKAGE_NAME || typeof id !== "string" || id === "") continue;
			if (entry.fiber === ctx.fiber) return id;
			if (entry.disabled !== true && fallback === void 0) fallback = id;
		}
	} catch {
		return;
	}
	return fallback;
}
/**
* Read this plugin's preference section out of the retired `settings.yaml`.
*
* Both names are tried: the settings service renames the document before it
* imports any section, so on a host that already booted once only the
* `.imported` copy is left, while a host migrated for the first time may still
* be mid-import.
* @param home - the harness home the retired document lives under.
* @returns the section's own fields, or undefined when no usable section exists.
*/
async function readLegacyPrefs(home) {
	const declared = new Set(Object.keys(Config.dict ?? {}));
	for (const name of [`${LEGACY_SETTINGS_FILE}.imported`, LEGACY_SETTINGS_FILE]) {
		let text;
		try {
			text = await readFile(join(home, name), "utf8");
		} catch {
			continue;
		}
		let document;
		try {
			document = parse(text);
		} catch {
			continue;
		}
		if (document === null || typeof document !== "object" || Array.isArray(document)) continue;
		const section = document[SIDEBAR_PREFS_NS];
		if (section === null || typeof section !== "object" || Array.isArray(section)) continue;
		const filtered = Object.fromEntries(Object.entries(section).filter(([key]) => declared.has(key)));
		if (Object.keys(filtered).length > 0) return filtered;
	}
}
/**
* One-time import of the Side card preferences a pre-0.1.7 release persisted.
*
* The 0.1.6 line stored them through the file-backed settings provider, in
* `$DSH_HOME/settings.yaml` under a `dsh-better-sidebar` section. This release
* deletes that provider; its migration renames the document to
* `settings.yaml.imported` and re-imports each section into the entry of the
* SAME id — and because a section key is the package name while the row id is
* a mount choice, DSH warns and leaves this section behind. Without this
* import every existing user would silently lose their preferences.
*
* The import runs only while the row's user layer is still empty, so it can
* never overwrite a value set after the upgrade, and re-running it is a no-op.
* @param ctx - host plugin context (profile home, logger).
* @param settings - the settings forms service.
* @param ns - this plugin row's entry id.
* @returns which outcome the import reached.
*/
async function importLegacyPrefs(ctx, settings, ns) {
	const home = ctx.profileContext?.home;
	if (home === void 0) return "no-profile-home";
	const row = settings.describe().find((candidate) => candidate.ns === ns);
	if (row === void 0) return "no-form";
	const user = row.user;
	if (user !== null && typeof user === "object" && Object.keys(user).length > 0) return "already-configured";
	const section = await readLegacyPrefs(home);
	if (section === void 0) return "no-legacy-section";
	await settings.update(ns, section);
	return "imported";
}
/**
* Plugin body: mount the fenced routes and the sidebar_open push socket.
* @param ctx - host plugin context (webServer, sessions, connection).
* @param config - deployment-provided limits; the Loader validates against
* {@link Config} and fills defaults, direct callers get them from
* {@link resolveSidebarConfig}.
*/
function apply(ctx, config) {
	const resolved = resolveSidebarConfig(config);
	const fence = (req) => ctx.connection.requestRejection(req) === void 0;
	const agentOpenRegistry = new AgentOpenRegistry();
	let settingsFace;
	let openToolsDisposers = null;
	ctx.inject(["settings"], (sctx) => {
		const ns = ownEntryId(ctx);
		if (ns === void 0) {
			ctx.logger?.warn?.("dsh-better-sidebar: no loader row for this package; Side card preferences stay at defaults");
			return;
		}
		ctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), "dsh-better-sidebar: settings page policy");
		const viewOf = () => {
			const descriptor = sctx.settings.describe({ redactSecrets: true }).find((candidate) => candidate.ns === ns);
			return descriptor === void 0 ? {
				value: void 0,
				revision: void 0
			} : {
				value: descriptor.value,
				revision: descriptor.revision
			};
		};
		const externalDisable = () => {
			return (sctx.settings.describe({ redactSecrets: true }).find((candidate) => candidate.ns === AIONUI_PANEL_ENTRY)?.value)?.rightPanel === "aionui-panel";
		};
		const prefsOf = () => {
			const value = viewOf().value;
			return value !== null && typeof value === "object" ? value : SIDEBAR_PREFS_DEFAULTS;
		};
		const syncOpenToolsGate = () => {
			if (prefsOf().agentOpenTools === true) {
				if (openToolsDisposers === null) openToolsDisposers = registerOpenTool(ctx, agentOpenRegistry, (sessionId) => sessionCwdOf(ctx, sessionId), prefsOf);
			} else if (openToolsDisposers !== null) {
				openToolsDisposers();
				openToolsDisposers = null;
				agentOpenRegistry.drainAll();
			}
		};
		settingsFace = {
			get: () => {
				syncOpenToolsGate();
				return viewOf();
			},
			externalDisable,
			update: async (patch, expectedRevision) => {
				await sctx.settings.update(ns, patch, expectedRevision);
				return viewOf();
			}
		};
		syncOpenToolsGate();
		Promise.resolve(ctx.loader?.await?.()).then(() => importLegacyPrefs(ctx, sctx.settings, ns)).then((outcome) => {
			if (outcome === "no-profile-home" || outcome === "no-form") {
				ctx.logger.warn("dsh-better-sidebar: legacy preference import could not run (%s)", outcome);
				return;
			}
			ctx.logger.info("dsh-better-sidebar: legacy preference import: %s", outcome);
		}).catch((error) => {
			ctx.logger.warn("dsh-better-sidebar: legacy preference import was rejected");
			ctx.logger.warn(error);
		});
	});
	const assistantLive = createAssistantLiveBuffer(ctx);
	ctx.effect(() => () => {
		assistantLive.dispose();
	}, "dsh-better-sidebar: live assistant stream buffer");
	const archiveTasks = createArchiveTasks();
	ctx.effect(() => () => {
		archiveTasks.dispose();
	}, "dsh-better-sidebar: archive task table");
	const api = buildApi(ctx, resolved, () => settingsFace, assistantLive, archiveTasks);
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/sidebar/api",
		handler: async (req, res) => {
			if (!fence(req)) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: {
						code: "method-error",
						message: "method not allowed"
					}
				});
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith("/sidebar/api/") ? pathname.slice(13) : void 0;
			if (method === void 0 || method.includes("/")) {
				writeError(res, new SidebarError("not-found", "unknown sidebar API method", 404));
				return;
			}
			const controller = method === "changes.ops" ? new AbortController() : void 0;
			const response = controller === void 0 ? void 0 : res;
			const abort = () => {
				controller?.abort();
			};
			response?.once("close", abort);
			try {
				const payload = await readJsonBody(req);
				const handler = Object.hasOwn(api, method) ? api[method] : void 0;
				if (typeof handler !== "function") throw new SidebarError("not-found", `unknown sidebar API method "${method}"`, 404);
				const result = await handler(payload, controller?.signal);
				if (controller?.signal.aborted !== true) writeOk(res, result);
			} catch (error) {
				if (controller?.signal.aborted !== true) writeError(res, error);
			} finally {
				response?.off("close", abort);
			}
		}
	}), "dsh-better-sidebar: /sidebar/api routes");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/sidebar/upload",
		handler: async (req, res) => {
			if (!fence(req)) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: {
						code: "method-error",
						message: "method not allowed"
					}
				});
				return;
			}
			try {
				const url = new URL(req.url ?? "/", "http://dsh.internal");
				const sessionId = url.searchParams.get("sessionId");
				const dir = url.searchParams.get("dir");
				const relativePath = url.searchParams.get("relativePath");
				if (sessionId === null || dir === null || relativePath === null || relativePath.trim() === "") throw new SidebarError("bad-request", "sessionId, dir, and relativePath are required");
				const { path, size } = await writeWorkspaceUpload({
					cwd: await activeWorktreeRootOf(ctx, sessionId, await sessionCwdOf(ctx, sessionId, url.searchParams.get("cwd") ?? void 0)),
					dir,
					relativePath,
					chunks: req
				});
				writeOk(res, {
					path,
					size
				});
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dsh-better-sidebar: /sidebar/upload route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/sidebar/write",
		handler: async (req, res) => {
			if (!fence(req)) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: {
						code: "method-error",
						message: "method not allowed"
					}
				});
				return;
			}
			try {
				const url = new URL(req.url ?? "/", "http://dsh.internal");
				const sessionId = url.searchParams.get("sessionId");
				const path = url.searchParams.get("path");
				if (sessionId === null || path === null || path === "") throw new SidebarError("bad-request", "sessionId and path are required");
				const cwd = await activeWorktreeRootOf(ctx, sessionId, await sessionCwdOf(ctx, sessionId, url.searchParams.get("cwd") ?? void 0));
				const raw = url.searchParams.get("expectedMtimeMs");
				const parsed = raw === null ? NaN : Number(raw);
				const expectedMtimeMs = Number.isFinite(parsed) ? parsed : void 0;
				writeOk(res, {
					ok: true,
					...await writeWorkspaceText({
						cwd,
						path,
						content: await readTextBody(req, WRITE_BODY_GUARD_BYTES),
						...expectedMtimeMs === void 0 ? {} : { expectedMtimeMs }
					})
				});
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dsh-better-sidebar: /sidebar/write route");
	ctx.effect(() => registerBundleRoute(ctx, fence), "dsh-better-sidebar: /sidebar/bundle chunk route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/sidebar/archive",
		handler: async (req, res) => {
			if (!fence(req)) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: {
						code: "method-error",
						message: "method not allowed"
					}
				});
				return;
			}
			try {
				const url = new URL(req.url ?? "/", "http://dsh.internal");
				await respondArchiveDownload(archiveTasks, {
					sessionId: url.searchParams.get("sessionId"),
					id: url.searchParams.get("id")
				}, res);
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dsh-better-sidebar: /sidebar/archive route");
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/sidebar/file",
		handler: async (req, res) => {
			if (!fence(req)) {
				res.writeHead(403);
				res.end("forbidden");
				return;
			}
			if (req.method !== "GET") {
				res.writeHead(405);
				res.end();
				return;
			}
			try {
				const url = new URL(req.url ?? "/", "http://dsh.internal");
				const sessionId = url.searchParams.get("sessionId");
				const raw = url.searchParams.get("path");
				if (sessionId === null || raw === null) throw new SidebarError("bad-request", "sessionId and path are required");
				const path = await ensureWorkspacePath(await activeWorktreeRootOf(ctx, sessionId, await sessionCwdOf(ctx, sessionId, url.searchParams.get("cwd") ?? void 0)), raw);
				const info = await statFileForRoute(path);
				if (!info.isFile()) throw new SidebarError("fs-error", "not a file", 400);
				const type = mediaTypeForPath(path);
				const headers = {
					"content-type": type,
					"cache-control": "no-cache"
				};
				if (type === "image/svg+xml") {
					headers["content-security-policy"] = "sandbox; object-src 'none'";
					headers["x-content-type-options"] = "nosniff";
					headers["referrer-policy"] = "no-referrer";
				}
				if (url.searchParams.get("download") === "1") headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`;
				await streamFileToResponse(path, info.size, res, headers);
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dsh-better-sidebar: /sidebar/file media route");
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/sidebar/html",
		handler: async (req, res) => {
			if (!fence(req)) {
				res.writeHead(403);
				res.end("forbidden");
				return;
			}
			if (req.method !== "GET") {
				res.writeHead(405);
				res.end();
				return;
			}
			try {
				const decoded = decodeHtmlUrl(new URL(req.url ?? "/", "http://dsh.internal").pathname);
				if (!decoded.ok) {
					writeError(res, new SidebarError("bad-request", decoded.message, decoded.status));
					return;
				}
				const { sessionId, path } = decoded.ref;
				const absolute = await ensureWorkspacePath(await activeWorktreeRootOf(ctx, sessionId, await sessionCwdOf(ctx, sessionId)), path);
				const info = await statFileForRoute(absolute);
				if (!info.isFile()) throw new SidebarError("fs-error", "not a file", 400);
				const type = mediaTypeForPath(absolute);
				await streamFileToResponse(absolute, info.size, res, {
					"content-type": type === "text/html" ? "text/html; charset=utf-8" : type,
					"cache-control": "no-cache",
					"x-content-type-options": "nosniff",
					"referrer-policy": "no-referrer",
					"content-security-policy": "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'"
				});
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dsh-better-sidebar: /sidebar/html preview route");
	const agentOpenWss = new WebSocketServer({ noServer: true });
	ctx.effect(() => ctx.webServer.registerUpgrade({
		path: "/sidebar/ws/agent-opens",
		handler: (req, socket, head) => {
			if (!fence(req)) {
				socket.destroy();
				return;
			}
			agentOpenWss.handleUpgrade(req, socket, head, (ws) => {
				attachAgentOpen(agentOpenRegistry, ws, req);
			});
		}
	}), "dsh-better-sidebar: agent-opens push WebSocket");
	const fsWatchWss = new WebSocketServer({ noServer: true });
	ctx.effect(() => ctx.webServer.registerUpgrade({
		path: "/sidebar/ws/fs-watch",
		handler: (req, socket, head) => {
			if (!fence(req)) {
				socket.destroy();
				return;
			}
			fsWatchWss.handleUpgrade(req, socket, head, (ws) => {
				attachFsWatch(ctx, ws, req);
			});
		}
	}), "dsh-better-sidebar: file-tree watch WebSocket");
	const sidechatWss = new WebSocketServer({ noServer: true });
	const sidechatPush = createSidechatPushHub(ctx);
	ctx.effect(() => () => {
		sidechatPush.dispose();
	}, "dsh-better-sidebar: side-chat push hub");
	ctx.effect(() => ctx.webServer.registerUpgrade({
		path: "/sidebar/ws/sidechat",
		handler: (req, socket, head) => {
			if (!fence(req)) {
				socket.destroy();
				return;
			}
			sidechatWss.handleUpgrade(req, socket, head, (ws) => {
				sidechatPush.attach(ws);
			});
		}
	}), "dsh-better-sidebar: side-chat push WebSocket");
	ctx.effect(() => () => {
		openToolsDisposers?.();
		agentOpenRegistry.dispose();
		for (const wss of [
			agentOpenWss,
			fsWatchWss,
			sidechatWss
		]) {
			for (const client of wss.clients) client.close();
			wss.close();
		}
	}, "dsh-better-sidebar: teardown");
}
/**
* Serve one session's directory-watch socket until it closes.
*
* Frames are `{ op: 'watch' | 'unwatch', path }`, where `path` is relative to
* the session's workspace exactly like `fs.tree`'s. A path that fails
* resolution, or a rejection past the watcher cap, is answered with
* `{ dir, ok: false }` so the client can stop asking rather than retry.
* @param ctx - host plugin context (session cwd).
* @param ws - the accepted socket.
* @param req - the upgrade request carrying `?sessionId=`.
*/
async function attachFsWatch(ctx, ws, req) {
	try {
		const sessionId = new URL(req.url ?? "/", "http://dsh.internal").searchParams.get("sessionId");
		if (sessionId === null) {
			ws.close(1008, "sessionId is required");
			return;
		}
		const watchers = createDirectoryWatchers((event) => {
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ dir: event.dir }));
		}, (dir, error) => {
			ctx.logger.warn("dsh-better-sidebar: cannot watch %s", dir);
			ctx.logger.warn(error);
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
				dir,
				ok: false
			}));
		});
		ws.on("close", () => {
			watchers.close();
		});
		ws.on("error", () => {
			watchers.close();
		});
		ws.on("message", (data) => {
			handleFsWatchFrame(ctx, ws, watchers, sessionId, data);
		});
	} catch (error) {
		ws.close(1011, error instanceof Error ? error.message : String(error));
	}
}
/**
* Apply one watch frame.
* @param ctx - host plugin context.
* @param ws - the owning socket.
* @param watchers - the socket's watcher set.
* @param sessionId - the session the socket was opened for.
* @param data - the raw frame text.
*/
async function handleFsWatchFrame(ctx, ws, watchers, sessionId, data) {
	let frame;
	try {
		frame = JSON.parse(typeof data === "string" ? data : String(data));
	} catch {
		return;
	}
	const path = typeof frame.path === "string" ? frame.path : void 0;
	if (path === void 0 || path === "") return;
	try {
		const dir = await ensureWorkspacePath(await activeWorktreeRootOf(ctx, sessionId, await sessionCwdOf(ctx, sessionId)), path);
		if (frame.op === "unwatch") {
			watchers.remove(dir);
			return;
		}
		if (frame.op !== "watch") return;
		const ok = watchers.add(dir);
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
			dir,
			ok
		}));
	} catch (error) {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
			dir: path,
			ok: false,
			reason: error instanceof Error ? error.message : String(error)
		}));
	}
}
/** Push queued `sidebar_open` requests for one session to a connected view. */
async function attachAgentOpen(registry, ws, req) {
	try {
		const sessionId = new URL(req.url ?? "/", "http://dsh.internal").searchParams.get("sessionId");
		if (sessionId === null) {
			ws.close(1008, "sessionId is required");
			return;
		}
		const send = (request) => {
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(request));
		};
		const unsubscribe = registry.attach(sessionId, send);
		ws.on("close", () => {
			unsubscribe();
		});
		ws.on("error", () => {
			unsubscribe();
		});
	} catch (error) {
		ws.close(1011, error instanceof Error ? error.message : String(error));
	}
}
//#endregion
export { Config, FS_TREES_MAX_PATHS, apply, contentDispositionOf, inject, mediaTypeForPath, name };
