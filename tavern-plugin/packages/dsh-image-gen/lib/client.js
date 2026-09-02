window.__ModuleLoader__.load({
	id: "dsh-image-gen",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/types/shared.js
		/** Browser route used by the generated-image card. */
		const IMAGE_ROUTE = "/plugins/dsh-image-gen/image";
		/** Browser route used for deleting generated images and workspace files. */
		const DELETE_ROUTE = "/plugins/dsh-image-gen/delete";
		/** Same-origin route used by the browser image workbench. */
		const STUDIO_ROUTE = "/plugins/dsh-image-gen/studio";
		/** Namespace persisted through DSH Settings. */
		const IMAGE_GENERATION_NAMESPACE = "image-generation";
		/** Providers supported by the first browser workbench release. */
		const CLOUD_IMAGE_PROVIDERS = [
			"google",
			"openai",
			"seedream",
			"dashscope",
			"grok"
		];
		/** Default endpoints and base URLs. */
		const DEFAULT_GOOGLE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
		const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
		const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1";
		const DEFAULT_GROK_MODEL = "grok-imagine-image-2.0";
		const DEFAULT_SEEDREAM_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
		const DEFAULT_DASHSCOPE_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1";
		const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
		const DEFAULT_COMFYUI_TIMEOUT_MS = 3e5;
		const DEFAULT_COMFYUI_WORKFLOW_LABEL = "API workflow";
		/** Default model names. */
		const DEFAULT_GOOGLE_MODEL = "gemini-3.1-flash-image";
		const DEFAULT_OPENAI_MODEL = "gpt-image-2";
		const DEFAULT_SEEDREAM_MODEL = "doubao-seedream-5-0-260128";
		const DEFAULT_DASHSCOPE_MODEL = "qwen-image-3.0";
		/** Named workflows, falling back to the legacy single-workflow fields when the list is empty. */
		function resolveComfyUIWorkflows(source) {
			const named = [];
			for (const entry of source.comfyuiWorkflows ?? []) {
				const name = typeof entry?.name === "string" ? entry.name.trim() : "";
				const json = typeof entry?.json === "string" ? entry.json : "";
				if (name.length > 0 && json.trim().length > 0) {
					const presetPrompt = typeof entry.presetPrompt === "string" ? entry.presetPrompt.trim() : "";
					named.push(presetPrompt.length > 0 ? {
						name,
						json,
						presetPrompt
					} : {
						name,
						json
					});
				}
			}
			if (named.length > 0) return named;
			const legacyJson = typeof source.comfyuiWorkflowJson === "string" ? source.comfyuiWorkflowJson : "";
			if (legacyJson.trim().length === 0) return [];
			const legacyName = typeof source.comfyuiWorkflowName === "string" ? source.comfyuiWorkflowName.trim() : "";
			return [{
				name: legacyName.length > 0 ? legacyName : DEFAULT_COMFYUI_WORKFLOW_LABEL,
				json: legacyJson
			}];
		}
		/** The workflow ComfyUI calls use by default: the configured active name, else the first entry. */
		function activeComfyUIWorkflow(source) {
			const workflows = resolveComfyUIWorkflows(source);
			if (workflows.length === 0) return void 0;
			const activeName = typeof source.comfyuiActiveWorkflow === "string" ? source.comfyuiActiveWorkflow.trim() : "";
			return workflows.find((workflow) => workflow.name === activeName) ?? workflows[0];
		}
		/** Derive a workflow label that does not collide with the given existing names. */
		function uniqueComfyUIWorkflowName(name, existing) {
			const base = name.trim().length > 0 ? name.trim() : DEFAULT_COMFYUI_WORKFLOW_LABEL;
			if (!existing.includes(base)) return base;
			for (let index = 2;; index += 1) {
				const candidate = `${base} (${index})`;
				if (!existing.includes(candidate)) return candidate;
			}
		}
		const DEFAULT_MODELS = {
			grok: DEFAULT_GROK_MODEL,
			google: DEFAULT_GOOGLE_MODEL,
			openai: DEFAULT_OPENAI_MODEL,
			seedream: DEFAULT_SEEDREAM_MODEL,
			dashscope: DEFAULT_DASHSCOPE_MODEL,
			comfyui: DEFAULT_COMFYUI_WORKFLOW_LABEL
		};
		const DEFAULT_BASE_URLS = {
			grok: DEFAULT_GROK_BASE_URL,
			google: DEFAULT_GOOGLE_ENDPOINT,
			openai: DEFAULT_OPENAI_BASE_URL,
			seedream: DEFAULT_SEEDREAM_BASE_URL,
			dashscope: DEFAULT_DASHSCOPE_ENDPOINT,
			comfyui: DEFAULT_COMFYUI_BASE_URL
		};
		//#endregion
		//#region lib/types/comfyui-workflow.js
		/** Pure ComfyUI API-workflow validation and placeholder injection. */
		const COMFYUI_PROMPT_PLACEHOLDER = "{{prompt}}";
		const COMFYUI_IMAGE_PLACEHOLDER = "{{image}}";
		/** Legacy single-percent placeholders from early releases, still accepted. */
		const LEGACY_PROMPT_PLACEHOLDER = "%prompt%";
		const LEGACY_IMAGE_PLACEHOLDER = "%image%";
		/** LoadImage-style input key that receives the uploaded source image name. */
		const IMAGE_INPUT_KEY = "image";
		/** Validate imported JSON without exposing workflow graph details to callers. */
		function validateComfyUIWorkflowJson(workflowJson) {
			const imageInputs = countImagePlaceholders(parseWorkflow(workflowJson));
			if (imageInputs > 1) throw new Error(`ComfyUI workflow must contain at most one ${COMFYUI_IMAGE_PLACEHOLDER} image input; found ${String(imageInputs)}`);
		}
		function parseWorkflow(workflowJson) {
			if (workflowJson.trim().length === 0) throw new Error("Import a ComfyUI API workflow JSON file in Settings before generating");
			if (new TextEncoder().encode(workflowJson).byteLength > 5242880) throw new Error("ComfyUI workflow file must be no larger than 5 MB");
			let value;
			try {
				value = JSON.parse(workflowJson);
			} catch {
				throw new Error("ComfyUI workflow file is not valid JSON");
			}
			if (!isRecord(value) || Object.keys(value).length === 0) throw new Error("ComfyUI workflow must be a non-empty API-format JSON object");
			if (!Object.values(value).some((node) => {
				const inputs = record$1(node)?.inputs;
				return inputs !== void 0 && containsPromptPlaceholder(inputs);
			})) throw new Error(`ComfyUI workflow must contain ${COMFYUI_PROMPT_PLACEHOLDER} (or ${LEGACY_PROMPT_PLACEHOLDER}) in a text input`);
			return value;
		}
		/** Count `inputs.image` fields that are exactly an image placeholder. */
		function countImagePlaceholders(workflow) {
			let count = 0;
			for (const node of Object.values(workflow)) {
				const inputs = record$1(record$1(node)?.inputs);
				if (inputs !== void 0 && isImagePlaceholder(inputs[IMAGE_INPUT_KEY])) count += 1;
			}
			return count;
		}
		function isImagePlaceholder(value) {
			return value === "{{image}}" || value === LEGACY_IMAGE_PLACEHOLDER;
		}
		function containsPromptPlaceholder(value) {
			if (typeof value === "string") return value.includes("{{prompt}}") || value.includes(LEGACY_PROMPT_PLACEHOLDER);
			if (Array.isArray(value)) return value.some(containsPromptPlaceholder);
			return isRecord(value) && Object.values(value).some(containsPromptPlaceholder);
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function record$1(value) {
			return isRecord(value) ? value : void 0;
		}
		//#endregion
		//#region lib/types/client/gallery-store.js
		const DB_NAME = "dsh_image_gen_db";
		const DB_VERSION = 2;
		const STORE_NAME = "gallery_history";
		const TOMBSTONE_STORE = "gallery_tombstones";
		let dbPromise = null;
		let tombstonesCache = null;
		function getDB() {
			if (dbPromise) return dbPromise;
			dbPromise = new Promise((resolve, reject) => {
				if (typeof indexedDB === "undefined") {
					reject(/* @__PURE__ */ new Error("IndexedDB is not supported in this environment."));
					return;
				}
				const request = indexedDB.open(DB_NAME, DB_VERSION);
				request.onupgradeneeded = (event) => {
					const db = event.target.result;
					if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" }).createIndex("createdAt", "createdAt", { unique: false });
					if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) db.createObjectStore(TOMBSTONE_STORE, { keyPath: "id" });
				};
				request.onsuccess = () => {
					resolve(request.result);
				};
				request.onerror = () => {
					reject(request.error);
				};
			});
			return dbPromise;
		}
		async function loadTombstones(db) {
			if (tombstonesCache) return tombstonesCache;
			return new Promise((resolve) => {
				if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
					tombstonesCache = /* @__PURE__ */ new Set();
					resolve(tombstonesCache);
					return;
				}
				try {
					const req = db.transaction(TOMBSTONE_STORE, "readonly").objectStore(TOMBSTONE_STORE).getAllKeys();
					req.onsuccess = () => {
						tombstonesCache = new Set(req.result.map(String));
						resolve(tombstonesCache);
					};
					req.onerror = () => {
						tombstonesCache = /* @__PURE__ */ new Set();
						resolve(tombstonesCache);
					};
				} catch {
					tombstonesCache = /* @__PURE__ */ new Set();
					resolve(tombstonesCache);
				}
			});
		}
		const listeners = /* @__PURE__ */ new Set();
		function notifyListeners() {
			for (const listener of listeners) try {
				listener();
			} catch (err) {
				console.error("[dsh-image-gen] Gallery listener error:", err);
			}
		}
		/**
		* Subscribe to gallery mutations (insert/delete/clear).
		*/
		function subscribeGallery(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/**
		* Save or update a gallery record by attachmentId.
		* Skipped if the item was previously deleted (tombstoned).
		* Preserves existing isFavorite, tags, and original createdAt on re-renders.
		*/
		async function saveGalleryItem(item) {
			try {
				const db = await getDB();
				if ((await loadTombstones(db)).has(item.id)) return;
				await new Promise((resolve, reject) => {
					const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
					const getReq = store.get(item.id);
					getReq.onsuccess = () => {
						const existing = getReq.result;
						const fav = item.isFavorite !== void 0 ? item.isFavorite : existing?.isFavorite;
						const userTags = item.tags !== void 0 ? item.tags : existing?.tags;
						const savedPath = item.savedTo !== void 0 ? item.savedTo : existing?.savedTo;
						const record = {
							...existing,
							...item,
							createdAt: existing?.createdAt ?? item.createdAt ?? Date.now(),
							...fav !== void 0 ? { isFavorite: fav } : {},
							...userTags !== void 0 ? { tags: userTags } : {},
							...savedPath !== void 0 ? { savedTo: savedPath } : {}
						};
						const putReq = store.put(record);
						putReq.onsuccess = () => resolve();
						putReq.onerror = () => reject(putReq.error);
					};
					getReq.onerror = () => reject(getReq.error);
				});
				notifyListeners();
			} catch (err) {
				console.warn("[dsh-image-gen] Failed to save gallery item to IndexedDB:", err);
			}
		}
		/**
		* Retrieve all gallery records sorted by createdAt descending.
		*/
		async function getGalleryItems() {
			try {
				const db = await getDB();
				return await new Promise((resolve, reject) => {
					const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).index("createdAt").openCursor(null, "prev");
					const items = [];
					req.onsuccess = (event) => {
						const cursor = event.target.result;
						if (cursor) {
							items.push(cursor.value);
							cursor.continue();
						} else resolve(items);
					};
					req.onerror = () => reject(req.error);
				});
			} catch (err) {
				console.warn("[dsh-image-gen] Failed to read gallery items from IndexedDB:", err);
				return [];
			}
		}
		/**
		* Toggle favorite status of a gallery item.
		* Returns the new favorite status (true if favorited, false if unfavorited).
		*/
		async function toggleFavoriteGalleryItem(id) {
			try {
				const db = await getDB();
				const newStatus = await new Promise((resolve, reject) => {
					const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
					const getReq = store.get(id);
					getReq.onsuccess = () => {
						const item = getReq.result;
						if (!item) {
							resolve(false);
							return;
						}
						const nextFavorite = !item.isFavorite;
						item.isFavorite = nextFavorite;
						const putReq = store.put(item);
						putReq.onsuccess = () => resolve(nextFavorite);
						putReq.onerror = () => reject(putReq.error);
					};
					getReq.onerror = () => reject(getReq.error);
				});
				notifyListeners();
				return newStatus;
			} catch (err) {
				console.warn("[dsh-image-gen] Failed to toggle favorite item in IndexedDB:", err);
				return false;
			}
		}
		/**
		* Delete a single gallery record by ID and record a tombstone.
		*/
		async function deleteGalleryItem(id) {
			const db = await getDB();
			const tombstones = await loadTombstones(db);
			await new Promise((resolve, reject) => {
				const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], "readwrite");
				const store = tx.objectStore(STORE_NAME);
				const tombstoneStore = tx.objectStore(TOMBSTONE_STORE);
				store.delete(id);
				tombstoneStore.put({
					id,
					deletedAt: Date.now()
				});
				tx.oncomplete = () => {
					tombstones.add(id);
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			});
			notifyListeners();
		}
		/**
		* Bulk delete multiple gallery records by IDs and record tombstones in a single transaction.
		*/
		async function bulkDeleteGalleryItems(ids) {
			if (ids.length === 0) return;
			const db = await getDB();
			const tombstones = await loadTombstones(db);
			const now = Date.now();
			await new Promise((resolve, reject) => {
				const tx = db.transaction([STORE_NAME, TOMBSTONE_STORE], "readwrite");
				const store = tx.objectStore(STORE_NAME);
				const tombstoneStore = tx.objectStore(TOMBSTONE_STORE);
				for (const id of ids) {
					store.delete(id);
					tombstoneStore.put({
						id,
						deletedAt: now
					});
				}
				tx.oncomplete = () => {
					for (const id of ids) tombstones.add(id);
					resolve();
				};
				tx.onerror = () => reject(tx.error ?? /* @__PURE__ */ new Error("IndexedDB transaction failed"));
				tx.onabort = () => reject(tx.error ?? /* @__PURE__ */ new Error("IndexedDB transaction aborted"));
			});
			notifyListeners();
		}
		/**
		* Standardize path format across Windows and POSIX (lowercase, forward slashes, no trailing slash).
		*/
		function normalizeWorkspacePath(rawPath) {
			return rawPath.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
		}
		/**
		* Determine if a gallery item belongs to the given workspace context.
		* Compares workspaceId, sessionId membership, workspacePath, and savedTo file path prefix.
		*/
		function isItemInWorkspace(item, workspace) {
			if (!workspace || !workspace.workspaceId && !workspace.path && (!workspace.sessionIds || workspace.sessionIds.length === 0)) return true;
			if (item.workspaceId && workspace.workspaceId && item.workspaceId === workspace.workspaceId) return true;
			if (item.sessionId && Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(item.sessionId)) return true;
			if (item.workspacePath && workspace.path) {
				if (normalizeWorkspacePath(item.workspacePath) === normalizeWorkspacePath(workspace.path)) return true;
			}
			if (item.savedTo && workspace.path) {
				const normSaved = normalizeWorkspacePath(item.savedTo);
				const normWs = normalizeWorkspacePath(workspace.path);
				if (normSaved === normWs || normSaved.startsWith(normWs + "/")) return true;
			}
			return false;
		}
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const mergeClasses = (...classes) => classes.filter((className, index, array) => {
			return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
		}).join(" ").trim();
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const toCamelCase = (string) => string.replace(/^([A-Z])|[\s-_]+(\w)/g, (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase());
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const toPascalCase = (string) => {
			const camelCase = toCamelCase(string);
			return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
		};
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/defaultAttributes.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var defaultAttributes = {
			xmlns: "http://www.w3.org/2000/svg",
			width: 24,
			height: 24,
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const hasA11yProp = (props) => {
			for (const prop in props) if (prop.startsWith("aria-") || prop === "role" || prop === "title") return true;
			return false;
		};
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/context.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const LucideContext = (0, react.createContext)({});
		const useLucideContext = () => (0, react.useContext)(LucideContext);
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/Icon.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Icon = (0, react.forwardRef)(({ color, size, strokeWidth, absoluteStrokeWidth, className = "", children, iconNode, ...rest }, ref) => {
			const { size: contextSize = 24, strokeWidth: contextStrokeWidth = 2, absoluteStrokeWidth: contextAbsoluteStrokeWidth = false, color: contextColor = "currentColor", className: contextClass = "" } = useLucideContext() ?? {};
			const calculatedStrokeWidth = absoluteStrokeWidth ?? contextAbsoluteStrokeWidth ? Number(strokeWidth ?? contextStrokeWidth) * 24 / Number(size ?? contextSize) : strokeWidth ?? contextStrokeWidth;
			return (0, react.createElement)("svg", {
				ref,
				...defaultAttributes,
				width: size ?? contextSize ?? defaultAttributes.width,
				height: size ?? contextSize ?? defaultAttributes.height,
				stroke: color ?? contextColor,
				strokeWidth: calculatedStrokeWidth,
				className: mergeClasses("lucide", contextClass, className),
				...!children && !hasA11yProp(rest) && { "aria-hidden": "true" },
				...rest
			}, [...iconNode.map(([tag, attrs]) => (0, react.createElement)(tag, attrs)), ...Array.isArray(children) ? children : [children]]);
		});
		//#endregion
		//#region node_modules/.pnpm/lucide-react@1.38.0_react@18.3.1/node_modules/lucide-react/dist/esm/createLucideIcon.mjs
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const createLucideIcon = (iconName, iconNode) => {
			const Component = (0, react.forwardRef)(({ className, ...props }, ref) => (0, react.createElement)(Icon, {
				ref,
				iconNode,
				className: mergeClasses(`lucide-${toKebabCase(toPascalCase(iconName))}`, `lucide-${iconName}`, className),
				...props
			}));
			Component.displayName = toPascalCase(iconName);
			return Component;
		};
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Check = createLucideIcon("check", [["path", {
			d: "M20 6 9 17l-5-5",
			key: "1gmf2c"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const ChevronDown = createLucideIcon("chevron-down", [["path", {
			d: "m6 9 6 6 6-6",
			key: "qrunsl"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const ChevronLeft = createLucideIcon("chevron-left", [["path", {
			d: "m15 18-6-6 6-6",
			key: "1wnfg3"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const ChevronRight = createLucideIcon("chevron-right", [["path", {
			d: "m9 18 6-6-6-6",
			key: "mthhwq"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Clipboard = createLucideIcon("clipboard", [["rect", {
			width: "8",
			height: "4",
			x: "8",
			y: "2",
			rx: "1",
			ry: "1",
			key: "tgr4d6"
		}], ["path", {
			d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
			key: "116196"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Copy = createLucideIcon("copy", [["rect", {
			width: "14",
			height: "14",
			x: "8",
			y: "8",
			rx: "2",
			ry: "2",
			key: "17jyea"
		}], ["path", {
			d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
			key: "zix9uf"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Download = createLucideIcon("download", [
			["path", {
				d: "M12 15V3",
				key: "m9g1x1"
			}],
			["path", {
				d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
				key: "ih7n3h"
			}],
			["path", {
				d: "m7 10 5 5 5-5",
				key: "brsn70"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Expand = createLucideIcon("expand", [
			["path", {
				d: "m15 15 6 6",
				key: "1s409w"
			}],
			["path", {
				d: "m15 9 6-6",
				key: "ko1vev"
			}],
			["path", {
				d: "M21 16v5h-5",
				key: "1ck2sf"
			}],
			["path", {
				d: "M21 8V3h-5",
				key: "1qoq8a"
			}],
			["path", {
				d: "M3 16v5h5",
				key: "1t08am"
			}],
			["path", {
				d: "m3 21 6-6",
				key: "wwnumi"
			}],
			["path", {
				d: "M3 8V3h5",
				key: "1ln10m"
			}],
			["path", {
				d: "M9 9 3 3",
				key: "v551iv"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const FileText = createLucideIcon("file-text", [
			["path", {
				d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
				key: "1oefj6"
			}],
			["path", {
				d: "M14 2v5a1 1 0 0 0 1 1h5",
				key: "wfsgrz"
			}],
			["path", {
				d: "M10 9H8",
				key: "b1mrlr"
			}],
			["path", {
				d: "M16 13H8",
				key: "t4e002"
			}],
			["path", {
				d: "M16 17H8",
				key: "z1uh3a"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Heart = createLucideIcon("heart", [["path", {
			d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
			key: "mvr1a0"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const ImagePlus = createLucideIcon("image-plus", [
			["path", {
				d: "M16 5h6",
				key: "1vod17"
			}],
			["path", {
				d: "M19 2v6",
				key: "4bpg5p"
			}],
			["path", {
				d: "M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5",
				key: "1ue2ih"
			}],
			["path", {
				d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
				key: "1xmnt7"
			}],
			["circle", {
				cx: "9",
				cy: "9",
				r: "2",
				key: "af1f0g"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Image$1 = createLucideIcon("image", [
			["rect", {
				width: "18",
				height: "18",
				x: "3",
				y: "3",
				rx: "2",
				ry: "2",
				key: "1m3agn"
			}],
			["circle", {
				cx: "9",
				cy: "9",
				r: "2",
				key: "af1f0g"
			}],
			["path", {
				d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
				key: "1xmnt7"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const LoaderCircle = createLucideIcon("loader-circle", [["path", {
			d: "M21 12a9 9 0 1 1-6.219-8.56",
			key: "13zald"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const PanelLeftClose = createLucideIcon("panel-left-close", [
			["rect", {
				width: "18",
				height: "18",
				x: "3",
				y: "3",
				rx: "2",
				key: "afitv7"
			}],
			["path", {
				d: "M9 3v18",
				key: "fh3hqa"
			}],
			["path", {
				d: "m16 15-3-3 3-3",
				key: "14y99z"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const PanelLeft = createLucideIcon("panel-left", [["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			key: "afitv7"
		}], ["path", {
			d: "M9 3v18",
			key: "fh3hqa"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const PencilLine = createLucideIcon("pencil-line", [
			["path", {
				d: "M13 21h8",
				key: "1jsn5i"
			}],
			["path", {
				d: "m15 5 4 4",
				key: "1mk7zo"
			}],
			["path", {
				d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
				key: "1a8usu"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Plus = createLucideIcon("plus", [["path", {
			d: "M5 12h14",
			key: "1ays0h"
		}], ["path", {
			d: "M12 5v14",
			key: "s699le"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const RefreshCw = createLucideIcon("refresh-cw", [
			["path", {
				d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
				key: "v9h5vc"
			}],
			["path", {
				d: "M21 3v5h-5",
				key: "1q7to0"
			}],
			["path", {
				d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
				key: "3uifl3"
			}],
			["path", {
				d: "M8 16H3v5",
				key: "1cv678"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Search = createLucideIcon("search", [["path", {
			d: "m21 21-4.34-4.34",
			key: "14j7rj"
		}], ["circle", {
			cx: "11",
			cy: "11",
			r: "8",
			key: "4ej97u"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const SlidersHorizontal = createLucideIcon("sliders-horizontal", [
			["path", {
				d: "M10 5H3",
				key: "1qgfaw"
			}],
			["path", {
				d: "M12 19H3",
				key: "yhmn1j"
			}],
			["path", {
				d: "M14 3v4",
				key: "1sua03"
			}],
			["path", {
				d: "M16 17v4",
				key: "1q0r14"
			}],
			["path", {
				d: "M21 12h-9",
				key: "1o4lsq"
			}],
			["path", {
				d: "M21 19h-5",
				key: "1rlt1p"
			}],
			["path", {
				d: "M21 5h-7",
				key: "1oszz2"
			}],
			["path", {
				d: "M8 10v4",
				key: "tgpxqk"
			}],
			["path", {
				d: "M8 12H3",
				key: "a7s4jb"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Sparkles = createLucideIcon("sparkles", [
			["path", {
				d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
				key: "1s2grr"
			}],
			["path", {
				d: "M20 2v4",
				key: "1rf3ol"
			}],
			["path", {
				d: "M22 4h-4",
				key: "gwowj6"
			}],
			["circle", {
				cx: "4",
				cy: "20",
				r: "2",
				key: "6kqj1y"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Trash2 = createLucideIcon("trash-2", [
			["path", {
				d: "M10 11v6",
				key: "nco0om"
			}],
			["path", {
				d: "M14 11v6",
				key: "outv1u"
			}],
			["path", {
				d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
				key: "miytrc"
			}],
			["path", {
				d: "M3 6h18",
				key: "d0wm0j"
			}],
			["path", {
				d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
				key: "e791ji"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const TriangleAlert = createLucideIcon("triangle-alert", [
			["path", {
				d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
				key: "wmoenq"
			}],
			["path", {
				d: "M12 9v4",
				key: "juzpu7"
			}],
			["path", {
				d: "M12 17h.01",
				key: "p32p05"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const Upload = createLucideIcon("upload", [
			["path", {
				d: "M12 3v12",
				key: "1x0j5s"
			}],
			["path", {
				d: "m17 8-5-5-5 5",
				key: "7q97r8"
			}],
			["path", {
				d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
				key: "ih7n3h"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const X = createLucideIcon("x", [["path", {
			d: "M18 6 6 18",
			key: "1bl5f8"
		}], ["path", {
			d: "m6 6 12 12",
			key: "d8bk6v"
		}]]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const ZoomIn = createLucideIcon("zoom-in", [
			["circle", {
				cx: "11",
				cy: "11",
				r: "8",
				key: "4ej97u"
			}],
			["line", {
				x1: "21",
				x2: "16.65",
				y1: "21",
				y2: "16.65",
				key: "13gj7c"
			}],
			["line", {
				x1: "11",
				x2: "11",
				y1: "8",
				y2: "14",
				key: "1vmskp"
			}],
			["line", {
				x1: "8",
				x2: "14",
				y1: "11",
				y2: "11",
				key: "durymu"
			}]
		]);
		/**
		* @license lucide-react v1.38.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		const ZoomOut = createLucideIcon("zoom-out", [
			["circle", {
				cx: "11",
				cy: "11",
				r: "8",
				key: "4ej97u"
			}],
			["line", {
				x1: "21",
				x2: "16.65",
				y1: "21",
				y2: "16.65",
				key: "13gj7c"
			}],
			["line", {
				x1: "8",
				x2: "14",
				y1: "11",
				y2: "11",
				key: "durymu"
			}]
		]);
		let currentCacheBytes = 0;
		const cache = /* @__PURE__ */ new Map();
		/**
		* Fetch or reuse an image Blob by attachment ID.
		* Refreshes LRU recency on hit and enforces count/byte limits on arrival.
		*/
		function fetchAttachmentBlob(attachment) {
			const key = String(attachment.attachmentId);
			const existing = cache.get(key);
			if (existing !== void 0) {
				cache.delete(key);
				cache.set(key, existing);
				return existing.promise;
			}
			const entry = {
				promise: Promise.resolve().then(async () => {
					try {
						const response = await fetch(IMAGE_ROUTE, {
							method: "POST",
							credentials: "same-origin",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ attachment })
						});
						if (!response.ok) throw new Error(`Image unavailable (${response.status})`);
						const blob = await response.blob();
						if (cache.get(key) === entry) {
							entry.bytes = blob.size;
							currentCacheBytes += blob.size;
							enforceLimits();
						}
						return blob;
					} catch (err) {
						if (cache.get(key) === entry) cache.delete(key);
						throw err;
					}
				}),
				bytes: 0
			};
			cache.set(key, entry);
			enforceLimits();
			return entry.promise;
		}
		/** Evict one item from memory cache (e.g. when deleted from gallery). */
		function evictAttachmentCache(attachmentId) {
			const key = String(attachmentId);
			const entry = cache.get(key);
			if (entry !== void 0) {
				currentCacheBytes = Math.max(0, currentCacheBytes - entry.bytes);
				cache.delete(key);
			}
		}
		function enforceLimits() {
			while (cache.size > 30 || currentCacheBytes > 134217728) {
				const oldestKey = cache.keys().next().value;
				if (oldestKey === void 0) break;
				const oldest = cache.get(oldestKey);
				if (oldest !== void 0) currentCacheBytes = Math.max(0, currentCacheBytes - oldest.bytes);
				cache.delete(oldestKey);
			}
		}
		//#endregion
		//#region lib/types/client/browser-image-utils.js
		/**
		* Shared browser image and DOM helpers for client views.
		* Completely decoupled from gallery-view and studio-view to prevent circular dependencies.
		*/
		/** Copy an image Blob to the OS clipboard, converting to PNG if required by the browser. */
		async function copyImageBlob(blob) {
			try {
				if (blob.type === "image/png") {
					await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
					return true;
				}
				if (typeof createImageBitmap === "function") {
					const bitmap = await createImageBitmap(blob);
					try {
						const canvas = document.createElement("canvas");
						canvas.width = bitmap.width;
						canvas.height = bitmap.height;
						const ctx = canvas.getContext("2d");
						if (!ctx) return false;
						ctx.drawImage(bitmap, 0, 0);
						const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
						if (!pngBlob) return false;
						await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
						return true;
					} finally {
						bitmap.close();
					}
				}
				const img = new Image();
				const url = URL.createObjectURL(blob);
				try {
					await new Promise((resolve, reject) => {
						img.onload = () => resolve();
						img.onerror = () => reject(/* @__PURE__ */ new Error("Image decode failed"));
						img.src = url;
					});
					const canvas = document.createElement("canvas");
					canvas.width = img.naturalWidth;
					canvas.height = img.naturalHeight;
					const ctx = canvas.getContext("2d");
					if (!ctx) return false;
					ctx.drawImage(img, 0, 0);
					const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
					if (!pngBlob) return false;
					await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
					return true;
				} finally {
					URL.revokeObjectURL(url);
				}
			} catch {
				return false;
			}
		}
		/** Safely trigger a browser file download by mounting an anchor element into the DOM. */
		function downloadBlobUrl(url, filename) {
			const link = document.createElement("a");
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			try {
				link.click();
			} finally {
				document.body.removeChild(link);
			}
		}
		/** Human-readable relative time formatter supporting zh and en. */
		function formatRelativeTime$1(timestamp, lang) {
			const diff = Math.max(0, Date.now() - timestamp);
			if (lang === "zh") {
				if (diff < 6e4) return "刚刚";
				if (diff < 36e5) return `${Math.floor(diff / 6e4)} 分钟前`;
				if (diff < 864e5) return `${Math.floor(diff / 36e5)} 小时前`;
				if (diff < 2592e6) return `${Math.floor(diff / 864e5)} 天前`;
				const d = new Date(timestamp);
				return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
			}
			if (diff < 6e4) return "Just now";
			if (diff < 36e5) return `${Math.floor(diff / 6e4)}m ago`;
			if (diff < 864e5) return `${Math.floor(diff / 36e5)}h ago`;
			if (diff < 2592e6) return `${Math.floor(diff / 864e5)}d ago`;
			const d = new Date(timestamp);
			return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
		}
		//#endregion
		//#region lib/types/client/studio-view.js
		const COPY = {
			zh: {
				title: "云端图像工作台",
				configured: "API 已配置",
				unconfigured: "未配置",
				recent: "最近生成",
				empty: "还没有生成记录",
				generate: "文生图",
				edit: "图生图",
				details: "图片详情",
				reference: "参考图",
				optional: "可选",
				upload: "点击上传或拖拽图片到此处",
				uploadHint: "支持 JPG / PNG / WebP / GIF，最大 10MB（最多 5 张）",
				prompt: "提示词 Prompt",
				clear: "清空",
				promptPlaceholder: "描述主体、构图、风格、光线与需要出现的文字…（支持 Ctrl+Enter 快捷生成）",
				provider: "Provider",
				model: "Model",
				ratio: "比例",
				quality: "清晰度",
				start: "开始生成",
				generating: "正在生成…",
				cancelGenerate: "取消生成",
				retry: "重新加载",
				configLoadFailed: "工作台配置加载失败，请检查服务后重试。",
				noProvider: "请先在设置中配置至少一个云端图像 Provider 的 API Key。",
				selectConfigured: "该 Provider 尚未配置，请先到设置中配置 API Key。",
				needPrompt: "请输入提示词",
				needReference: "请先添加至少一张参考图",
				result: "本次结果",
				continueEdit: "继续编辑（垫图）",
				regenerate: "再次生成",
				copy: "复制",
				copied: "已复制到剪贴板",
				copyFailed: "复制失败",
				download: "下载",
				remove: "删除",
				fit: "适应窗口",
				loading: "正在读取图片…",
				generationFailed: "生成失败",
				selectHistory: "从左侧选择一张图片，或在右侧开始新的生成。",
				created: "生成时间",
				elapsed: "耗时",
				dimensions: "尺寸",
				output: "输出参数",
				closeReference: "移除参考图",
				uploadInvalid: "请选择有效的图片文件（最大 10MB）",
				imageLoadFailed: "图片读取失败",
				fullscreen: "大图全屏",
				close: "关闭",
				copyPpt: "复制 Prompt",
				copiedPrompt: "已复制 Prompt",
				copiedImage: "已复制图片",
				favorite: "收藏",
				favorited: "已收藏",
				favoriteAdded: "已添加到收藏",
				favoriteRemoved: "已取消收藏",
				loadMore: "加载更多 ({n})",
				deleteModalTitle: "从图库删除",
				deleteModalDesc: "确定从图库中删除这张图片吗？（原聊天记录不会受影响）",
				deleteWorkspaceFilesLabel: "同时删除工作区本地文件",
				confirm: "确定删除",
				cancel: "取消",
				deletedToast: "已从图库删除",
				referencesCount: "参考图 ({current}/{max})",
				addMoreRef: "+ 添加",
				maxReferencesExceeded: "最多支持添加 {max} 张参考图",
				newGeneration: "新建生成",
				new: "新建",
				configuredCount: "API 已配置 · {count}",
				unconfiguredStatus: "API 未配置",
				providerStatus: "云端提供商与模型状态",
				collapseSidebar: "折叠最近生成",
				expandSidebar: "展开最近生成"
			},
			en: {
				title: "Cloud Image Studio",
				configured: "API configured",
				unconfigured: "Not configured",
				recent: "Recent generations",
				empty: "No generated images yet",
				generate: "Text to image",
				edit: "Image to image",
				details: "Image details",
				reference: "Reference image",
				optional: "optional",
				upload: "Click or drop images here",
				uploadHint: "JPG / PNG / WebP / GIF, up to 10MB (max 5)",
				prompt: "Prompt",
				clear: "Clear",
				promptPlaceholder: "Describe the subject, composition, style, lighting, and exact text… (Ctrl+Enter to generate)",
				provider: "Provider",
				model: "Model",
				ratio: "Aspect ratio",
				quality: "Quality",
				start: "Generate",
				generating: "Generating…",
				cancelGenerate: "Cancel",
				retry: "Retry",
				configLoadFailed: "Failed to load studio configuration.",
				noProvider: "Configure an API key for at least one cloud image provider in Settings.",
				selectConfigured: "This provider is not configured. Add its API key in Settings first.",
				needPrompt: "Enter a prompt",
				needReference: "Add at least one reference image first",
				result: "Current result",
				continueEdit: "Continue editing",
				regenerate: "Generate again",
				copy: "Copy",
				copied: "Copied to clipboard",
				copyFailed: "Copy failed",
				download: "Download",
				remove: "Delete",
				fit: "Fit",
				loading: "Loading image…",
				generationFailed: "Generation failed",
				selectHistory: "Select an image on the left, or start a new generation on the right.",
				created: "Created",
				elapsed: "Elapsed",
				dimensions: "Dimensions",
				output: "Output",
				closeReference: "Remove reference",
				uploadInvalid: "Choose a valid image file up to 10MB.",
				imageLoadFailed: "Could not load image",
				fullscreen: "Fullscreen",
				close: "Close",
				copyPpt: "Copy Prompt",
				copiedPrompt: "Prompt copied",
				copiedImage: "Image copied",
				favorite: "Favorite",
				favorited: "Favorited",
				favoriteAdded: "Added to favorites",
				favoriteRemoved: "Removed from favorites",
				loadMore: "Load more ({n})",
				deleteModalTitle: "Delete from gallery",
				deleteModalDesc: "Remove this image from the local gallery? (Chat history remains unaffected)",
				deleteWorkspaceFilesLabel: "Also delete local workspace files",
				confirm: "Delete",
				cancel: "Cancel",
				deletedToast: "Deleted from gallery",
				referencesCount: "References ({current}/{max})",
				addMoreRef: "+ Add",
				maxReferencesExceeded: "Up to {max} reference images allowed",
				newGeneration: "New generation",
				new: "New",
				configuredCount: "API configured · {count}",
				unconfiguredStatus: "Not configured",
				providerStatus: "Provider & Model Status",
				collapseSidebar: "Collapse sidebar",
				expandSidebar: "Expand recent list"
			}
		};
		const StudioView = ({ locale, workspace }) => {
			const [lang, setLang] = (0, react.useState)(() => locale?.getSnapshot?.().active?.startsWith("en") ? "en" : "zh");
			const [config, setConfig] = (0, react.useState)(null);
			const [configLoading, setConfigLoading] = (0, react.useState)(true);
			const [configError, setConfigError] = (0, react.useState)(null);
			const [items, setItems] = (0, react.useState)([]);
			const [sidebarCollapsed, setSidebarCollapsed] = (0, react.useState)(false);
			const [visibleLimit, setVisibleLimit] = (0, react.useState)(30);
			const [selected, setSelected] = (0, react.useState)(null);
			const [mode, setMode] = (0, react.useState)("generate");
			const [panelTab, setPanelTab] = (0, react.useState)("generate");
			const [provider, setProvider] = (0, react.useState)("google");
			const [model, setModel] = (0, react.useState)("");
			const [ratio, setRatio] = (0, react.useState)("1:1");
			const [quality, setQuality] = (0, react.useState)("1K");
			const [prompt, setPrompt] = (0, react.useState)("");
			const [references, setReferences] = (0, react.useState)([]);
			const [isGenerating, setIsGenerating] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [zoom, setZoom] = (0, react.useState)(100);
			const [fit, setFit] = (0, react.useState)(true);
			const [offset, setOffset] = (0, react.useState)({
				x: 0,
				y: 0
			});
			const [isDragging, setIsDragging] = (0, react.useState)(false);
			const dragStartRef = (0, react.useRef)(null);
			const hasDraggedRef = (0, react.useRef)(false);
			const [dragging, setDragging] = (0, react.useState)(false);
			const [lightboxOpen, setLightboxOpen] = (0, react.useState)(false);
			const [showDeleteModal, setShowDeleteModal] = (0, react.useState)(false);
			const [deleteWorkspaceFiles, setDeleteWorkspaceFiles] = (0, react.useState)(true);
			const requestRef = (0, react.useRef)(null);
			const canvasRef = (0, react.useRef)(null);
			const fileInputRef = (0, react.useRef)(null);
			const image = useAttachmentImage(selected?.attachment);
			const maxReferences = provider === "dashscope" ? 3 : 5;
			const referencesRef = (0, react.useRef)(references);
			referencesRef.current = references;
			const t = (key, values) => {
				let text = COPY[lang][key];
				for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, value);
				return text;
			};
			(0, react.useEffect)(() => locale?.subscribe?.(() => setLang(locale.getSnapshot().active?.startsWith("en") ? "en" : "zh")), [locale]);
			const loadConfig = (0, react.useCallback)(async () => {
				setConfigLoading(true);
				setConfigError(null);
				const controller = new AbortController();
				try {
					const response = await fetch(STUDIO_ROUTE, {
						signal: controller.signal,
						credentials: "same-origin"
					});
					const payload = await response.json();
					if (!response.ok || !("providers" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "Studio unavailable");
					setConfig(payload);
					const initial = payload.providers.find((item) => item.provider === payload.activeProvider) ?? payload.providers[0];
					if (initial !== void 0) applyProvider(initial);
				} catch (fetchError) {
					if (!controller.signal.aborted) setConfigError(messageOf(fetchError));
				} finally {
					setConfigLoading(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				loadConfig();
			}, [loadConfig]);
			(0, react.useEffect)(() => {
				let mounted = true;
				const load = () => void getGalleryItems().then((next) => {
					if (!mounted) return;
					setItems(next);
					setSelected((current) => current === null ? null : next.find((item) => item.id === current.id) ?? null);
				});
				load();
				const unsubscribe = subscribeGallery(load);
				return () => {
					mounted = false;
					unsubscribe();
				};
			}, []);
			(0, react.useEffect)(() => {
				return () => {
					requestRef.current?.abort();
				};
			}, []);
			(0, react.useEffect)(() => {
				return () => {
					for (const item of referencesRef.current) if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
				};
			}, []);
			(0, react.useEffect)(() => {
				const handleKeyDown = (e) => {
					if (e.key === "Escape" && lightboxOpen) setLightboxOpen(false);
				};
				window.addEventListener("keydown", handleKeyDown);
				return () => window.removeEventListener("keydown", handleKeyDown);
			}, [lightboxOpen]);
			(0, react.useEffect)(() => {
				const canvasEl = canvasRef.current;
				if (!canvasEl) return;
				const onWheel = (e) => {
					if (selected === null || !image.url) return;
					e.preventDefault();
					const delta = e.deltaY < 0 ? 15 : -15;
					setFit(false);
					setZoom((prev) => Math.min(500, Math.max(25, prev + delta)));
				};
				canvasEl.addEventListener("wheel", onWheel, { passive: false });
				return () => canvasEl.removeEventListener("wheel", onWheel);
			}, [selected, image.url]);
			(0, react.useEffect)(() => {
				const handleMouseMove = (e) => {
					if (!dragStartRef.current) return;
					const dx = e.clientX - dragStartRef.current.x;
					const dy = e.clientY - dragStartRef.current.y;
					if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
						hasDraggedRef.current = true;
						setFit(false);
					}
					setOffset({
						x: dragStartRef.current.startX + dx,
						y: dragStartRef.current.startY + dy
					});
				};
				const handleMouseUp = () => {
					dragStartRef.current = null;
					setIsDragging(false);
				};
				window.addEventListener("mousemove", handleMouseMove);
				window.addEventListener("mouseup", handleMouseUp);
				return () => {
					window.removeEventListener("mousemove", handleMouseMove);
					window.removeEventListener("mouseup", handleMouseUp);
				};
			}, []);
			const activeProfile = (0, react.useMemo)(() => config?.providers.find((item) => item.provider === provider), [config, provider]);
			const configuredCount = config?.providers.filter((item) => item.configured).length ?? 0;
			const displayItems = (0, react.useMemo)(() => items.slice(0, visibleLimit), [items, visibleLimit]);
			const applyProvider = (profile) => {
				if (!profile.supportsEditing) setMode("generate");
				setProvider(profile.provider);
				setModel(profile.model);
				setRatio(profile.defaultRatio);
				setQuality(profile.defaultQuality);
				setError(null);
			};
			const changeProvider = (value) => {
				const profile = config?.providers.find((item) => item.provider === value);
				if (profile !== void 0) {
					applyProvider(profile);
					const providerMax = value === "dashscope" ? 3 : 5;
					if (referencesRef.current.length > providerMax) {
						const keep = referencesRef.current.slice(0, providerMax);
						const overflow = referencesRef.current.slice(providerMax);
						for (const item of overflow) if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
						setReferences(keep);
						referencesRef.current = keep;
						setError(t("maxReferencesExceeded", { max: String(providerMax) }));
					}
				}
			};
			const resetFit = () => {
				setFit(true);
				setZoom(100);
				setOffset({
					x: 0,
					y: 0
				});
			};
			const selectItem = (item) => {
				setSelected(item);
				setPanelTab("details");
				resetFit();
			};
			const startNew = () => {
				setSelected(null);
				setPanelTab("generate");
				resetFit();
			};
			const handleCanvasMouseDown = (e) => {
				if (e.button !== 0 && e.button !== 1) return;
				if (selected === null || !image.url) return;
				setIsDragging(true);
				hasDraggedRef.current = false;
				dragStartRef.current = {
					x: e.clientX,
					y: e.clientY,
					startX: offset.x,
					startY: offset.y
				};
			};
			const handleImageClick = () => {
				if (!hasDraggedRef.current) setLightboxOpen(true);
			};
			const addReferenceFiles = (fileList) => {
				if (!fileList || fileList.length === 0) return;
				const files = Array.from(fileList);
				const validFiles = [];
				for (const file of files) {
					if (![
						"image/jpeg",
						"image/png",
						"image/webp",
						"image/gif"
					].includes(file.type) || file.size > 10485760) {
						setError(t("uploadInvalid"));
						continue;
					}
					validFiles.push(file);
				}
				if (validFiles.length === 0) return;
				const currentLen = referencesRef.current.length;
				const available = maxReferences - currentLen;
				if (available <= 0) {
					setError(t("maxReferencesExceeded", { max: String(maxReferences) }));
					return;
				}
				const toAdd = validFiles.slice(0, available);
				if (validFiles.length > available) setError(t("maxReferencesExceeded", { max: String(maxReferences) }));
				else setError(null);
				const newItems = toAdd.map((file, idx) => ({
					id: `upload-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
					file,
					previewUrl: URL.createObjectURL(file)
				}));
				setReferences((prev) => [...prev, ...newItems]);
			};
			const removeReference = (id) => {
				const target = referencesRef.current.find((item) => item.id === id);
				if (target && target.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
				setReferences((prev) => prev.filter((item) => item.id !== id));
			};
			const clearAllReferences = () => {
				for (const item of referencesRef.current) if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
				setReferences([]);
			};
			const continueEdit = async () => {
				if (selected === null) return;
				if (config?.providers.find((item) => item.provider === selected.provider)?.supportsEditing !== true) return;
				const targetItem = selected;
				const targetAttId = targetItem.attachment.attachmentId;
				const targetMax = targetItem.provider === "dashscope" ? 3 : 5;
				if (referencesRef.current.some((r) => r.attachment?.attachmentId === targetAttId)) {
					setMode("edit");
					setPanelTab("generate");
					changeProvider(targetItem.provider);
					return;
				}
				if (referencesRef.current.length >= targetMax) {
					setError(t("maxReferencesExceeded", { max: String(targetMax) }));
					return;
				}
				try {
					const blob = image.blob ?? await fetchAttachmentBlob(targetItem.attachment);
					if (referencesRef.current.some((r) => r.attachment?.attachmentId === targetAttId)) {
						setMode("edit");
						setPanelTab("generate");
						changeProvider(targetItem.provider);
						return;
					}
					if (referencesRef.current.length >= targetMax) {
						setError(t("maxReferencesExceeded", { max: String(targetMax) }));
						return;
					}
					const independentUrl = URL.createObjectURL(blob);
					const newItem = {
						id: `item-${targetItem.id}-${Date.now()}`,
						attachment: targetItem.attachment,
						previewUrl: independentUrl
					};
					const nextList = [...referencesRef.current, newItem];
					setReferences(nextList);
					referencesRef.current = nextList;
					setError(null);
					setMode("edit");
					setPanelTab("generate");
					changeProvider(targetItem.provider);
				} catch {
					setError(t("imageLoadFailed"));
				}
			};
			const cancelGeneration = () => {
				if (requestRef.current) {
					requestRef.current.abort();
					requestRef.current = null;
					setIsGenerating(false);
				}
			};
			const submit = async () => {
				if (isGenerating || activeProfile === void 0) return;
				if (prompt.trim().length === 0) return setError(t("needPrompt"));
				if (!activeProfile.configured) return setError(t("selectConfigured"));
				if (mode === "edit" && references.length === 0) return setError(t("needReference"));
				setIsGenerating(true);
				setError(null);
				const controller = new AbortController();
				requestRef.current = controller;
				try {
					const referencesPayload = mode === "edit" && references.length > 0 ? await Promise.all(references.map(async (ref) => {
						if (ref.attachment !== void 0) return { attachment: ref.attachment };
						if (ref.file !== void 0) return {
							mediaType: ref.file.type,
							data: await fileToBase64(ref.file),
							...ref.file.name ? { name: ref.file.name } : {}
						};
						throw new Error("无效参考图");
					})) : void 0;
					const response = await fetch(STUDIO_ROUTE, {
						method: "POST",
						credentials: "same-origin",
						signal: controller.signal,
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							mode,
							provider,
							model,
							prompt: prompt.trim(),
							ratio,
							quality,
							...workspace?.path ? { workspaceRoot: workspace.path } : {},
							...referencesPayload === void 0 ? {} : { references: referencesPayload }
						})
					});
					const payload = await response.json();
					if (!response.ok || !("attachment" in payload)) throw new Error("error" in payload && payload.error ? payload.error : t("generationFailed"));
					const item = {
						id: String(payload.attachment.attachmentId),
						attachment: payload.attachment,
						prompt: payload.prompt,
						provider: payload.provider,
						model: payload.model,
						createdAt: payload.createdAt,
						aspectRatio: ratio,
						imageSize: quality,
						output: payload.output,
						...payload.savedTo ? { savedTo: payload.savedTo } : {},
						...workspace?.path ? { workspacePath: workspace.path } : {},
						...workspace?.workspaceId ? { workspaceId: workspace.workspaceId } : {}
					};
					await saveGalleryItem(item);
					setSelected(item);
					setPanelTab("details");
					resetFit();
				} catch (submitError) {
					if (controller.signal.aborted) return;
					setError(messageOf(submitError));
				} finally {
					if (requestRef.current === controller) {
						requestRef.current = null;
						setIsGenerating(false);
					}
				}
			};
			const handleConfirmDelete = async () => {
				if (selected === null) return;
				const idToDelete = selected.id;
				const attachmentId = selected.attachment.attachmentId;
				const savedPath = selected.savedTo;
				setShowDeleteModal(false);
				try {
					if (deleteWorkspaceFiles && typeof savedPath === "string" && savedPath.trim().length > 0) {
						const res = await fetch(DELETE_ROUTE, {
							method: "POST",
							credentials: "same-origin",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ paths: [savedPath] })
						});
						if (!res.ok) throw new Error(`删除请求网络异常 (${res.status})`);
						const data = await res.json().catch(() => null);
						if (!data || data.ok === false || Array.isArray(data.failedFiles) && data.failedFiles.length > 0) {
							const reason = data?.failedFiles?.[0]?.error || "工作区文件删除失败";
							throw new Error(reason);
						}
					}
					await deleteGalleryItem(idToDelete);
					evictAttachmentCache(attachmentId);
					flash(t("deletedToast"));
				} catch (delError) {
					setError(messageOf(delError));
				}
			};
			const copySelected = async () => {
				if (image.blob === null) return;
				const ok = await copyImageBlob(image.blob);
				flash(ok ? t("copiedImage") : t("copyFailed"));
			};
			const downloadSelected = () => {
				if (image.url === null || selected === null) return;
				downloadBlobUrl(image.url, `dsh-${selected.provider}-${selected.id.slice(-8)}.${extension(selected.attachment.mediaType)}`);
			};
			const toggleFavorite = async () => {
				if (selected === null) return;
				const targetId = selected.id;
				const nextFav = await toggleFavoriteGalleryItem(targetId);
				setSelected((curr) => curr !== null && curr.id === targetId ? {
					...curr,
					isFavorite: nextFav
				} : curr);
				flash(nextFav ? t("favoriteAdded") : t("favoriteRemoved"));
			};
			const flash = (message) => {
				setNotice(message);
				window.setTimeout(() => setNotice(null), 2200);
			};
			return (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-ig-workbench",
				"aria-label": t("title"),
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: `dsh-ig-workbench-grid ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`,
						children: [
							!sidebarCollapsed && (0, react_jsx_runtime.jsxs)("aside", {
								className: "dsh-ig-recent-panel",
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-panel-title",
									children: [(0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: "8px"
										},
										children: [(0, react_jsx_runtime.jsx)("span", { children: t("recent") }), (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-ig-count-badge",
											children: items.length
										})]
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-collapse-btn",
										onClick: () => setSidebarCollapsed(true),
										title: t("collapseSidebar"),
										children: (0, react_jsx_runtime.jsx)(PanelLeftClose, { size: 15 })
									})]
								}), (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-recent-scroll",
									children: [items.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-ig-recent-empty",
										children: [(0, react_jsx_runtime.jsx)(ImagePlus, { size: 22 }), (0, react_jsx_runtime.jsx)("span", { children: t("empty") })]
									}) : displayItems.map((item) => (0, react_jsx_runtime.jsx)(RecentItem, {
										item,
										active: selected?.id === item.id,
										lang,
										onClick: () => selectItem(item)
									}, item.id)), items.length > visibleLimit && (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-load-more",
										onClick: () => setVisibleLimit((l) => l + 30),
										children: t("loadMore", { n: String(items.length - visibleLimit) })
									})]
								})]
							}),
							(0, react_jsx_runtime.jsxs)("main", {
								className: "dsh-ig-canvas-column",
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-ig-canvas-toolbar",
										children: [(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-canvas-toolbar-left",
											children: [sidebarCollapsed && (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												onClick: () => setSidebarCollapsed(false),
												title: t("expandSidebar"),
												children: [(0, react_jsx_runtime.jsx)(PanelLeft, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("recent") })]
											}), (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-ig-status-badge-wrap",
												children: [(0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-ig-status-badge",
													children: [
														(0, react_jsx_runtime.jsx)("span", { className: `dsh-ig-status-dot ${configuredCount > 0 ? "is-ready" : "is-muted"}` }),
														(0, react_jsx_runtime.jsx)("span", {
															className: "dsh-ig-status-text",
															children: configuredCount > 0 ? t("configuredCount", { count: String(configuredCount) }) : t("unconfiguredStatus")
														}),
														(0, react_jsx_runtime.jsx)(ChevronDown, {
															size: 11,
															className: "dsh-ig-status-arrow"
														})
													]
												}), config !== null && (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-ig-status-popover",
													children: [(0, react_jsx_runtime.jsx)("div", {
														className: "dsh-ig-status-popover-title",
														children: t("providerStatus")
													}), (0, react_jsx_runtime.jsx)("ul", {
														className: "dsh-ig-status-list",
														children: config.providers.map((p) => (0, react_jsx_runtime.jsxs)("li", {
															className: p.configured ? "is-configured" : "is-missing",
															children: [(0, react_jsx_runtime.jsxs)("div", {
																className: "dsh-ig-status-item-name",
																children: [(0, react_jsx_runtime.jsx)("strong", { children: p.label }), (0, react_jsx_runtime.jsx)("small", { children: p.model })]
															}), (0, react_jsx_runtime.jsx)("span", {
																className: "dsh-ig-status-item-tag",
																children: p.configured ? t("configured") : t("unconfigured")
															})]
														}, p.provider))
													})]
												})]
											})]
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-canvas-toolbar-right",
											children: [
												selected !== null && (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													onClick: startNew,
													title: t("newGeneration"),
													children: [(0, react_jsx_runtime.jsx)(Plus, { size: 13 }), (0, react_jsx_runtime.jsx)("span", { children: t("newGeneration") })]
												}),
												(0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: fit ? "is-active" : "",
													onClick: resetFit,
													children: [
														t("fit"),
														" ",
														(0, react_jsx_runtime.jsx)(ChevronDown, { size: 13 })
													]
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														setFit(false);
														setZoom((value) => Math.max(25, value - 25));
													},
													title: "Zoom out",
													children: (0, react_jsx_runtime.jsx)(ZoomOut, { size: 16 })
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: "dsh-ig-zoom-display",
													children: fit ? "AUTO" : `${Math.round(zoom)}%`
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => {
														setFit(false);
														setZoom((value) => Math.min(500, value + 25));
													},
													title: "Zoom in",
													children: (0, react_jsx_runtime.jsx)(ZoomIn, { size: 16 })
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													onClick: () => setLightboxOpen(true),
													title: t("fullscreen"),
													disabled: selected === null,
													children: (0, react_jsx_runtime.jsx)(Expand, { size: 16 })
												})
											]
										})]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: `dsh-ig-canvas ${isDragging ? "is-dragging" : ""}`,
										ref: canvasRef,
										onMouseDown: handleCanvasMouseDown,
										onDoubleClick: resetFit,
										children: isGenerating ? (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-generating-state",
											children: [
												(0, react_jsx_runtime.jsx)("div", {
													className: "dsh-ig-generation-orbit",
													children: (0, react_jsx_runtime.jsx)(Sparkles, { size: 28 })
												}),
												(0, react_jsx_runtime.jsx)("strong", { children: t("generating") }),
												(0, react_jsx_runtime.jsxs)("span", { children: [
													activeProfile?.label,
													" · ",
													model
												] })
											]
										}) : selected === null ? (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-canvas-empty",
											children: [(0, react_jsx_runtime.jsx)(ImagePlus, { size: 36 }), (0, react_jsx_runtime.jsx)("span", { children: t("selectHistory") })]
										}) : image.loading ? (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-canvas-empty",
											children: [(0, react_jsx_runtime.jsx)(LoaderCircle, {
												className: "dsh-ig-spin",
												size: 28
											}), (0, react_jsx_runtime.jsx)("span", { children: t("loading") })]
										}) : image.url !== null ? (0, react_jsx_runtime.jsx)("img", {
											src: image.url,
											alt: selected.prompt,
											draggable: false,
											onClick: handleImageClick,
											style: {
												transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom / 100})`,
												transformOrigin: "center center",
												transition: isDragging ? "none" : "transform 0.08s ease-out"
											}
										}) : (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-canvas-empty",
											children: [(0, react_jsx_runtime.jsx)(ImagePlus, { size: 32 }), (0, react_jsx_runtime.jsx)("span", { children: t("imageLoadFailed") })]
										})
									}),
									selected !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-result-strip",
											children: [(0, react_jsx_runtime.jsx)("span", { children: t("result") }), (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												disabled: config?.providers.find((item) => item.provider === selected.provider)?.supportsEditing !== true,
												onClick: () => void continueEdit(),
												children: [(0, react_jsx_runtime.jsx)(PencilLine, { size: 15 }), t("continueEdit")]
											}), (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												onClick: () => {
													setMode("generate");
													setPanelTab("generate");
													setPrompt(selected.prompt);
												},
												children: [(0, react_jsx_runtime.jsx)(RefreshCw, { size: 15 }), t("regenerate")]
											})] })]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-result-actions",
											children: [(0, react_jsx_runtime.jsx)("p", { children: selected.prompt }), (0, react_jsx_runtime.jsxs)("div", { children: [
												(0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													onClick: () => void toggleFavorite(),
													title: selected.isFavorite ? t("favorited") : t("favorite"),
													children: [(0, react_jsx_runtime.jsx)(Heart, {
														size: 15,
														fill: selected.isFavorite ? "#ef4444" : "none",
														color: selected.isFavorite ? "#ef4444" : "currentColor"
													}), (0, react_jsx_runtime.jsx)("span", { children: selected.isFavorite ? t("favorited") : t("favorite") })]
												}),
												(0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													onClick: () => void copySelected(),
													children: [(0, react_jsx_runtime.jsx)(Clipboard, { size: 15 }), (0, react_jsx_runtime.jsx)("span", { children: t("copy") })]
												}),
												(0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													onClick: downloadSelected,
													children: [(0, react_jsx_runtime.jsx)(Download, { size: 15 }), (0, react_jsx_runtime.jsx)("span", { children: t("download") })]
												}),
												(0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													onClick: () => setShowDeleteModal(true),
													children: [(0, react_jsx_runtime.jsx)(Trash2, { size: 15 }), (0, react_jsx_runtime.jsx)("span", { children: t("remove") })]
												})
											] })]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-result-meta",
											children: [
												(0, react_jsx_runtime.jsx)("span", { children: formatRelativeTime$1(selected.createdAt, lang) }),
												(0, react_jsx_runtime.jsx)("span", { children: selected.provider }),
												(0, react_jsx_runtime.jsx)("span", { children: selected.model }),
												(0, react_jsx_runtime.jsx)("span", { children: selected.attachment.width && selected.attachment.height ? `${selected.attachment.width} × ${selected.attachment.height}` : "—" })
											]
										})
									] })
								]
							}),
							(0, react_jsx_runtime.jsxs)("aside", {
								className: "dsh-ig-generate-panel",
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-panel-tabs",
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: panelTab === "generate" ? "is-active" : "",
										onClick: () => setPanelTab("generate"),
										children: t("generate")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: panelTab === "details" ? "is-active" : "",
										onClick: () => setPanelTab("details"),
										children: t("details")
									})]
								}), panelTab === "details" ? (0, react_jsx_runtime.jsx)(DetailsPanel, {
									item: selected,
									t
								}) : (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-generator-form",
									children: [
										(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-mode-switch",
											children: [(0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: mode === "generate" ? "is-active" : "",
												onClick: () => setMode("generate"),
												children: [(0, react_jsx_runtime.jsx)(Sparkles, { size: 15 }), t("generate")]
											}), (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												disabled: activeProfile?.supportsEditing !== true,
												className: mode === "edit" ? "is-active" : "",
												onClick: () => setMode("edit"),
												children: [(0, react_jsx_runtime.jsx)(ImagePlus, { size: 15 }), t("edit")]
											})]
										}),
										mode === "edit" && (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-field",
											children: [
												(0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-ig-field-label",
													children: [(0, react_jsx_runtime.jsxs)("label", { children: [
														t("referencesCount", {
															current: String(references.length),
															max: String(maxReferences)
														}),
														" ",
														(0, react_jsx_runtime.jsx)("b", { children: "*" })
													] }), references.length > 0 && (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														onClick: clearAllReferences,
														children: t("clear")
													})]
												}),
												references.length === 0 ? (0, react_jsx_runtime.jsxs)("button", {
													type: "button",
													className: `dsh-ig-upload ${dragging ? "is-dragging" : ""}`,
													onClick: () => fileInputRef.current?.click(),
													onDragOver: (event) => {
														event.preventDefault();
														setDragging(true);
													},
													onDragLeave: () => setDragging(false),
													onDrop: (event) => {
														event.preventDefault();
														setDragging(false);
														addReferenceFiles(event.dataTransfer.files);
													},
													children: [
														(0, react_jsx_runtime.jsx)(Upload, { size: 20 }),
														(0, react_jsx_runtime.jsx)("strong", { children: t("upload") }),
														(0, react_jsx_runtime.jsx)("small", { children: t("uploadHint") })
													]
												}) : (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-ig-reference-grid",
													children: [references.map((item, index) => (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-ig-reference-card",
														children: [(0, react_jsx_runtime.jsx)("img", {
															src: item.previewUrl,
															alt: `Ref ${index + 1}`
														}), (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															title: t("closeReference"),
															onClick: () => removeReference(item.id),
															children: (0, react_jsx_runtime.jsx)(X, { size: 12 })
														})]
													}, item.id)), references.length < maxReferences && (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														className: "dsh-ig-reference-add",
														onClick: () => fileInputRef.current?.click(),
														title: t("upload"),
														children: [(0, react_jsx_runtime.jsx)(Upload, { size: 16 }), (0, react_jsx_runtime.jsx)("span", { children: t("addMoreRef") })]
													})]
												}),
												(0, react_jsx_runtime.jsx)("input", {
													ref: fileInputRef,
													type: "file",
													multiple: true,
													accept: "image/png,image/jpeg,image/webp,image/gif",
													hidden: true,
													onChange: (event) => {
														addReferenceFiles(event.target.files);
														event.target.value = "";
													}
												})
											]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-field",
											children: [
												(0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-ig-field-label",
													children: [(0, react_jsx_runtime.jsxs)("label", {
														htmlFor: "dsh-ig-prompt",
														children: [
															t("prompt"),
															" ",
															(0, react_jsx_runtime.jsx)("b", { children: "*" })
														]
													}), (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														onClick: () => setPrompt(""),
														children: t("clear")
													})]
												}),
												(0, react_jsx_runtime.jsx)("textarea", {
													id: "dsh-ig-prompt",
													value: prompt,
													maxLength: 2e3,
													onChange: (event) => setPrompt(event.target.value),
													onKeyDown: (event) => {
														if (event.nativeEvent.isComposing) return;
														if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
															event.preventDefault();
															if (!isGenerating && config !== null && prompt.trim().length > 0) submit();
														}
													},
													placeholder: t("promptPlaceholder")
												}),
												(0, react_jsx_runtime.jsxs)("small", { children: [prompt.length, "/2000"] })
											]
										}),
										config === null ? configLoading ? (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-ig-form-loading",
											children: (0, react_jsx_runtime.jsx)(LoaderCircle, {
												className: "dsh-ig-spin",
												size: 18
											})
										}) : (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-config-error",
											children: [(0, react_jsx_runtime.jsx)("p", { children: configError ?? t("configLoadFailed") }), (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												onClick: () => void loadConfig(),
												children: [(0, react_jsx_runtime.jsx)(RefreshCw, { size: 13 }), (0, react_jsx_runtime.jsx)("span", { children: t("retry") })]
											})]
										}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-field-grid",
											children: [(0, react_jsx_runtime.jsx)(FieldSelect, {
												label: t("provider"),
												value: provider,
												onChange: changeProvider,
												options: config.providers.map((item) => ({
													value: item.provider,
													label: `${item.label}${item.configured ? "" : ` · ${t("unconfigured")}`}`
												}))
											}), (0, react_jsx_runtime.jsx)(FieldSelect, {
												label: t("model"),
												value: model,
												onChange: setModel,
												options: activeProfile === void 0 ? [] : [{
													value: activeProfile.model,
													label: activeProfile.model
												}]
											})]
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-field-grid",
											children: [(0, react_jsx_runtime.jsx)(FieldSelect, {
												label: t("ratio"),
												value: ratio,
												onChange: setRatio,
												options: activeProfile?.ratioOptions ?? []
											}), (0, react_jsx_runtime.jsx)(FieldSelect, {
												label: t("quality"),
												value: quality,
												onChange: setQuality,
												options: activeProfile?.qualityOptions ?? []
											})]
										})] }),
										configuredCount === 0 && config !== null && (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-ig-inline-note",
											children: t("noProvider")
										}),
										error !== null && (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-ig-form-error",
											children: error
										}),
										isGenerating ? (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-generate-button is-cancel",
											onClick: cancelGeneration,
											children: [(0, react_jsx_runtime.jsx)(LoaderCircle, {
												className: "dsh-ig-spin",
												size: 17
											}), (0, react_jsx_runtime.jsx)("span", { children: t("cancelGenerate") })]
										}) : (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-generate-button",
											disabled: config === null,
											onClick: () => void submit(),
											children: [(0, react_jsx_runtime.jsx)(Sparkles, { size: 17 }), (0, react_jsx_runtime.jsx)("span", { children: t("start") })]
										})
									]
								})]
							})
						]
					}),
					lightboxOpen && selected !== null && (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-ig-lightbox-backdrop",
						onClick: () => setLightboxOpen(false),
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-ig-lightbox-topbar",
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-lightbox-meta",
									children: [
										(0, react_jsx_runtime.jsx)("span", {
											className: "dsh-ig-tag",
											children: selected.provider
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: "dsh-ig-tag dsh-ig-tag-model",
											children: selected.model
										}),
										selected.attachment.width && selected.attachment.height ? (0, react_jsx_runtime.jsxs)("span", {
											className: "dsh-ig-tag",
											children: [
												selected.attachment.width,
												" × ",
												selected.attachment.height
											]
										}) : null
									]
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-lightbox-close-btn",
									title: t("close"),
									onClick: () => setLightboxOpen(false),
									children: (0, react_jsx_runtime.jsx)(X, { size: 18 })
								})]
							}),
							(0, react_jsx_runtime.jsx)("div", {
								className: "dsh-ig-lightbox-img-wrap",
								onClick: (e) => e.stopPropagation(),
								children: image.url !== null ? (0, react_jsx_runtime.jsx)("img", {
									className: "dsh-ig-lightbox-img",
									src: image.url,
									alt: selected.prompt
								}) : (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-lightbox-loading",
									children: (0, react_jsx_runtime.jsx)("div", { className: "dsh-ig-lightbox-spinner" })
								})
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-ig-lightbox-bottombar",
								onClick: (e) => e.stopPropagation(),
								children: [(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-lightbox-prompt-text",
									title: selected.prompt,
									children: selected.prompt
								}), (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-lightbox-actions",
									children: [
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn",
											title: t("copyPpt"),
											onClick: async () => {
												await navigator.clipboard.writeText(selected.prompt);
												flash(t("copiedPrompt"));
											},
											children: [(0, react_jsx_runtime.jsx)(FileText, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("copyPpt") })]
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn",
											title: t("copy"),
											onClick: async () => {
												if (!image.blob) return;
												const ok = await copyImageBlob(image.blob);
												flash(ok ? t("copiedImage") : t("copyFailed"));
											},
											children: [(0, react_jsx_runtime.jsx)(Copy, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("copy") })]
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn",
											title: t("download"),
											onClick: downloadSelected,
											children: [(0, react_jsx_runtime.jsx)(Download, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("download") })]
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn",
											title: selected.isFavorite ? t("favorited") : t("favorite"),
											onClick: () => void toggleFavorite(),
											children: [(0, react_jsx_runtime.jsx)(Heart, {
												size: 14,
												fill: selected.isFavorite ? "#ef4444" : "none",
												color: selected.isFavorite ? "#ef4444" : "currentColor"
											}), (0, react_jsx_runtime.jsx)("span", { children: selected.isFavorite ? t("favorited") : t("favorite") })]
										})
									]
								})]
							})
						]
					}),
					showDeleteModal && selected !== null && (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-workbench-modal-backdrop",
						onClick: () => setShowDeleteModal(false),
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-workbench-modal-box",
							onClick: (e) => e.stopPropagation(),
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-workbench-modal-header",
									children: [(0, react_jsx_runtime.jsx)(TriangleAlert, {
										size: 20,
										color: "#dc2626"
									}), (0, react_jsx_runtime.jsx)("strong", { children: t("deleteModalTitle") })]
								}),
								(0, react_jsx_runtime.jsx)("p", {
									className: "dsh-ig-workbench-modal-desc",
									children: t("deleteModalDesc")
								}),
								Boolean(selected.savedTo) && (0, react_jsx_runtime.jsxs)("label", {
									className: "dsh-ig-workbench-modal-option",
									children: [(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: deleteWorkspaceFiles,
										onChange: (e) => setDeleteWorkspaceFiles(e.target.checked)
									}), (0, react_jsx_runtime.jsx)("span", { children: t("deleteWorkspaceFilesLabel") })]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-workbench-modal-actions",
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-workbench-modal-cancel",
										onClick: () => setShowDeleteModal(false),
										children: t("cancel")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-workbench-modal-danger",
										onClick: () => void handleConfirmDelete(),
										children: t("confirm")
									})]
								})
							]
						})
					}),
					notice !== null && (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-workbench-toast",
						children: notice
					})
				]
			});
		};
		const FieldSelect = ({ label, value, options, onChange }) => (0, react_jsx_runtime.jsxs)("label", {
			className: "dsh-ig-field-select",
			children: [(0, react_jsx_runtime.jsx)("span", { children: label }), (0, react_jsx_runtime.jsx)("select", {
				value,
				onChange: (event) => onChange(event.target.value),
				children: options.map((option) => (0, react_jsx_runtime.jsx)("option", {
					value: option.value,
					children: option.label
				}, option.value))
			})]
		});
		const DetailsPanel = ({ item, t }) => item === null ? (0, react_jsx_runtime.jsxs)("div", {
			className: "dsh-ig-details-empty",
			children: [(0, react_jsx_runtime.jsx)(ImagePlus, { size: 28 }), (0, react_jsx_runtime.jsx)("span", { children: t("selectHistory") })]
		}) : (0, react_jsx_runtime.jsxs)("dl", {
			className: "dsh-ig-details",
			children: [
				(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("prompt") }), (0, react_jsx_runtime.jsx)("dd", { children: item.prompt })] }),
				(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("provider") }), (0, react_jsx_runtime.jsx)("dd", { children: item.provider })] }),
				(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("model") }), (0, react_jsx_runtime.jsx)("dd", { children: item.model })] }),
				(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("dimensions") }), (0, react_jsx_runtime.jsx)("dd", { children: item.attachment.width && item.attachment.height ? `${item.attachment.width} × ${item.attachment.height}` : "—" })] }),
				(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("output") }), (0, react_jsx_runtime.jsx)("dd", { children: item.output ?? "—" })] }),
				(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("created") }), (0, react_jsx_runtime.jsx)("dd", { children: new Date(item.createdAt).toLocaleString() })] })
			]
		});
		const RecentItem = ({ item, active, lang, onClick }) => {
			const [setRef, inView] = useInView();
			const image = useAttachmentImage(item.attachment, inView);
			return (0, react_jsx_runtime.jsxs)("button", {
				ref: setRef,
				type: "button",
				className: `dsh-ig-recent-item ${active ? "is-active" : ""}`,
				onClick,
				children: [(0, react_jsx_runtime.jsx)("div", {
					className: "dsh-ig-recent-thumb",
					children: image.url !== null ? (0, react_jsx_runtime.jsx)("img", {
						src: image.url,
						alt: "",
						loading: "lazy"
					}) : (0, react_jsx_runtime.jsx)(ImagePlus, { size: 18 })
				}), (0, react_jsx_runtime.jsxs)("div", { children: [
					(0, react_jsx_runtime.jsx)("strong", { children: item.prompt }),
					(0, react_jsx_runtime.jsx)("span", { children: formatRelativeTime$1(item.createdAt, lang) }),
					(0, react_jsx_runtime.jsxs)("small", { children: [
						item.provider,
						" · ",
						item.model
					] }),
					(0, react_jsx_runtime.jsx)("small", { children: item.attachment.width && item.attachment.height ? `${item.attachment.width} × ${item.attachment.height}` : "—" })
				] })]
			});
		};
		function useInView() {
			const [inView, setInView] = (0, react.useState)(false);
			const observerRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				return () => {
					observerRef.current?.disconnect();
				};
			}, []);
			return [(0, react.useCallback)((el) => {
				observerRef.current?.disconnect();
				if (!el || inView) return;
				if (typeof IntersectionObserver === "undefined") {
					setInView(true);
					return;
				}
				const observer = new IntersectionObserver(([entry]) => {
					if (entry?.isIntersecting) {
						setInView(true);
						observer.disconnect();
					}
				}, { rootMargin: "120px" });
				observerRef.current = observer;
				observer.observe(el);
			}, [inView]), inView];
		}
		function useAttachmentImage(attachment, shouldLoad = true) {
			const [value, setValue] = (0, react.useState)({
				url: null,
				blob: null,
				loading: false
			});
			(0, react.useEffect)(() => {
				if (attachment === void 0 || !shouldLoad) {
					setValue({
						url: null,
						blob: null,
						loading: false
					});
					return;
				}
				let cancelled = false;
				let objectUrl = null;
				setValue({
					url: null,
					blob: null,
					loading: true
				});
				fetchAttachmentBlob(attachment).then((blob) => {
					if (cancelled) return;
					objectUrl = URL.createObjectURL(blob);
					setValue({
						url: objectUrl,
						blob,
						loading: false
					});
				}).catch(() => {
					if (!cancelled) setValue({
						url: null,
						blob: null,
						loading: false
					});
				});
				return () => {
					cancelled = true;
					if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
				};
			}, [attachment?.attachmentId, shouldLoad]);
			return value;
		}
		function fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const result = reader.result;
					const commaIndex = result.indexOf(",");
					resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
				};
				reader.onerror = () => reject(reader.error ?? /* @__PURE__ */ new Error("Failed to read image file"));
				reader.readAsDataURL(file);
			});
		}
		function extension(mediaType) {
			return mediaType === "image/jpeg" ? "jpg" : mediaType.split("/")[1] ?? "png";
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region lib/types/client/conversation-regenerate.js
		/** Build the workbench request that reproduces a conversation image with an edited prompt. */
		function conversationRegenerateRequest(image, prompt, remembered) {
			if (!CLOUD_IMAGE_PROVIDERS.includes(image.provider)) throw new Error("当前图片使用的 Provider 暂不支持重新生成");
			const provider = image.provider;
			const settings = remembered ?? outputSettings(provider, image.output);
			return {
				mode: "generate",
				provider,
				model: image.model,
				prompt: prompt.trim(),
				ratio: settings.ratio,
				quality: settings.quality
			};
		}
		function outputSettings(provider, output) {
			const normalized = (output ?? "").trim();
			if (provider === "grok") {
				const [ratio, quality] = normalized.split(",").map((value) => value.trim());
				return {
					ratio: isRatio(ratio) ? ratio : "1:1",
					quality: quality === "2k" ? "2k" : "1k"
				};
			}
			if (provider === "google") {
				const [rawRatio, rawQuality] = normalized.split(",").map((value) => value.trim());
				return {
					ratio: isRatio(rawRatio) ? rawRatio : "1:1",
					quality: rawQuality === "1K" || rawQuality === "2K" || rawQuality === "4K" ? rawQuality : "1K"
				};
			}
			if (provider === "seedream") return {
				ratio: "auto",
				quality: normalized === "1K" || normalized === "4K" ? normalized : "2K"
			};
			if (provider === "openai") return {
				ratio: ratioFromSize(normalized, "x"),
				quality: "standard"
			};
			return {
				ratio: ratioFromSize(normalized, "*"),
				quality: "standard"
			};
		}
		function ratioFromSize(size, separator) {
			return (separator === "x" ? {
				"1024x1024": "1:1",
				"1536x1024": "3:2",
				"1024x1536": "2:3"
			} : {
				"1024*1024": "1:1",
				"1536*1024": "3:2",
				"1024*1536": "2:3",
				"1664*928": "16:9",
				"928*1664": "9:16"
			})[size] ?? "1:1";
		}
		function isRatio(value) {
			return value === "1:1" || value === "3:2" || value === "2:3" || value === "4:3" || value === "3:4" || value === "16:9" || value === "9:16";
		}
		//#endregion
		//#region lib/types/client/gallery-view.js
		/**
		* Native Workspace Gallery & Studio View Component for DSH `conversation.view` slot.
		* Fully i18n-reactive (Chinese & English) with modular tabs, multi-dimensional filters,
		* responsive image grid, and placeholder routes.
		*/
		const DICT$1 = {
			zh: {
				tabGallery: "图库",
				tabStudio: "工作台",
				tabFavorites: "收藏",
				tabCompare: "对比",
				tabTasks: "任务",
				filterAllProviders: "全部提供商",
				filterGoogle: "Google Gemini",
				filterOpenAI: "OpenAI / 中转站",
				filterSeedream: "字节 Seedream",
				filterDashScope: "阿里 DashScope",
				filterComfyUI: "本地 ComfyUI",
				filterAllModels: "全部模型",
				filterAllRatios: "全部比例",
				searchPlaceholder: "搜索 Prompt、标签…",
				filterCurrentWorkspace: "仅看此工作区",
				filterCurrentWorkspaceHint: "只展示属于当前工作区的生图记录与物理文件",
				sortNewest: "最新生成",
				sortOldest: "最早生成",
				totalCount: "共 {count} 张生成图片",
				emptyTitle: "暂无生图记录",
				emptyDesc: "在对话中让 Agent 生图后，生成的图片会自动收录到这里。",
				favEmptyTitle: "暂无收藏图片",
				favEmptyDesc: "在图库中点击卡片右下角的 ♡ 按钮，即可将喜爱的图片收录到这里。",
				noMatchTitle: "未找到匹配结果",
				noMatchDesc: "尝试更换搜索关键词或调整筛选条件。",
				copiedPrompt: "已复制 Prompt",
				copiedImage: "已复制图片",
				copyFailed: "复制失败",
				favoriteAdded: "已添加到收藏",
				favoriteRemoved: "已取消收藏",
				preview: "查看大图",
				download: "下载图片",
				copyImg: "复制图片",
				copyPpt: "复制 Prompt",
				regenerate: "重新生成",
				regenerateTitle: "重新生成图片",
				regenerateHint: "可按需修改 Prompt，基于当前模型和比例在画廊生成一张新图片。",
				confirmRegenerate: "开始生成",
				regenerating: "正在重新生成…",
				regenerateSuccess: "已生成新图片并收录到画廊",
				regenerateFailed: "重新生成失败",
				delete: "从画廊删除",
				confirmDelete: "确定要从画廊中删除这张图片吗？（不会影响原聊天记录）",
				deleted: "已从画廊删除",
				model: "模型",
				prompt: "Prompt",
				close: "关闭 (Esc)",
				prevImage: "上一张 (←)",
				nextImage: "下一张 (→)",
				manage: "批量删除",
				exitManage: "退出选择",
				selectedCount: "已选 {n} 项",
				selectAll: "全选",
				invertSelect: "反选",
				clearSelect: "清空",
				batchDelete: "批量删除",
				batchDeleteTitle: "确认批量删除选中的 {count} 张图片？",
				batchDeleteTitleSingle: "确认从画廊中删除这张图片？",
				batchDeleteDesc: "将从画廊历史记录中移除所选图片。",
				deleteWorkspaceFilesOpt: "同时清理工作区磁盘物理文件（不可恢复）",
				cancel: "取消",
				confirmBatchDelete: "确认删除 ({count})",
				confirmDeleteSingle: "确认删除",
				batchDeletedToast: "已删除 {count} 张图片",
				batchDeletedWithFilesToast: "已删除 {count} 张图片，并清理了 {files} 个工作区文件",
				deleteFailedFileLocked: "已删除 {count} 张图片，但有 {files} 个文件因被系统占用未能删除",
				deleteFailedDatabase: "删除失败：本地数据库操作异常",
				justNow: "刚刚",
				minutesAgo: "{n} 分钟前",
				hoursAgo: "{n} 小时前",
				daysAgo: "{n} 天前",
				studioTitle: "AI 图像工作台 (Studio)",
				studioDesc: "工作台模块正在紧锣密鼓开发中。在此你将体验大图精修、变体生成 (Variations)、参数重调并一键将生成结果无缝插回 DSH 正在进行的对话。",
				studioTip: "💡 提示：目前你可以在“图库”中点击任意图片，在弹窗中进行查看、复制与下载。",
				compareTitle: "多模型横向对比 (Compare)",
				compareDesc: "支持单个 Prompt 一键同时调度 Gemini、Seedream、DashScope 及本地 ComfyUI 模型并排生成，直观横评画质与细节。",
				tasksTitle: "异步任务队列 (Tasks)",
				tasksDesc: "集中管理后台批量生图、多模型并发生成与本地 ComfyUI 耗时任务。支持状态追踪、失败重试与执行耗时分析。",
				comingSoonBadge: "即将推出"
			},
			en: {
				tabGallery: "Gallery",
				tabStudio: "Studio",
				tabFavorites: "Favorites",
				tabCompare: "Compare",
				tabTasks: "Tasks",
				filterAllProviders: "All Providers",
				filterGoogle: "Google Gemini",
				filterOpenAI: "OpenAI / Relay",
				filterSeedream: "ByteDance Seedream",
				filterDashScope: "Aliyun DashScope",
				filterComfyUI: "Local ComfyUI",
				filterAllModels: "All Models",
				filterAllRatios: "All Ratios",
				searchPlaceholder: "Search prompt, tags…",
				filterCurrentWorkspace: "Current workspace only",
				filterCurrentWorkspaceHint: "Only show images belonging to the active workspace",
				sortNewest: "Newest first",
				sortOldest: "Oldest first",
				totalCount: "{count} images total",
				emptyTitle: "No images generated yet",
				emptyDesc: "Images generated during conversations will automatically appear here.",
				favEmptyTitle: "No favorite images yet",
				favEmptyDesc: "Click the ♡ button on any card in the gallery to collect your favorite images here.",
				noMatchTitle: "No matching images",
				noMatchDesc: "Try a different search keyword or adjust filter criteria.",
				copiedPrompt: "Prompt copied",
				copiedImage: "Image copied",
				copyFailed: "Copy failed",
				favoriteAdded: "Added to favorites",
				favoriteRemoved: "Removed from favorites",
				preview: "Full Preview",
				download: "Download",
				copyImg: "Copy Image",
				copyPpt: "Copy Prompt",
				regenerate: "Regenerate",
				regenerateTitle: "Regenerate Image",
				regenerateHint: "Edit prompt if needed. A new image will be generated and added to the gallery.",
				confirmRegenerate: "Generate",
				regenerating: "Regenerating…",
				regenerateSuccess: "New image generated and added to gallery",
				regenerateFailed: "Regeneration failed",
				delete: "Delete from gallery",
				confirmDelete: "Are you sure you want to remove this image from the gallery? (Chat history will not be affected)",
				deleted: "Deleted from gallery",
				model: "Model",
				prompt: "Prompt",
				close: "Close (Esc)",
				prevImage: "Previous (←)",
				nextImage: "Next (→)",
				manage: "Batch Delete",
				exitManage: "Done",
				selectedCount: "{n} selected",
				selectAll: "Select All",
				invertSelect: "Invert",
				clearSelect: "Clear",
				batchDelete: "Batch Delete",
				batchDeleteTitle: "Delete {count} selected images?",
				batchDeleteTitleSingle: "Delete this image from gallery?",
				batchDeleteDesc: "These images will be removed from your gallery history.",
				deleteWorkspaceFilesOpt: "Also delete files from workspace disk (cannot be undone)",
				cancel: "Cancel",
				confirmBatchDelete: "Delete ({count})",
				confirmDeleteSingle: "Delete",
				batchDeletedToast: "Deleted {count} images",
				batchDeletedWithFilesToast: "Deleted {count} images and cleaned {files} workspace files",
				deleteFailedFileLocked: "Deleted {count} images, but {files} files could not be deleted (busy/locked)",
				deleteFailedDatabase: "Failed to delete: local database error",
				justNow: "Just now",
				minutesAgo: "{n}m ago",
				hoursAgo: "{n}h ago",
				daysAgo: "{n}d ago",
				studioTitle: "AI Image Studio",
				studioDesc: "Studio workbench is under active development. Fine-tune prompts, generate variations (2x/4x), and inject images directly into DSH chat.",
				studioTip: "💡 Tip: You can currently click any image in the Gallery to preview, copy, or download it.",
				compareTitle: "Model Comparison (Compare)",
				compareDesc: "Side-by-side multi-model benchmarking coming soon. Test Gemini, Seedream, DashScope, and ComfyUI with a single prompt.",
				tasksTitle: "Task Queue (Tasks)",
				tasksDesc: "Centralized view for batch generation, asynchronous ComfyUI runs, live progress tracking, and retry controls.",
				comingSoonBadge: "Coming Soon"
			}
		};
		/** Format human-readable relative time */
		function formatRelativeTime(timestamp, t) {
			const diff = Date.now() - timestamp;
			if (diff < 6e4) return t("justNow");
			if (diff < 36e5) {
				const mins = Math.max(1, Math.floor(diff / 6e4));
				return t("minutesAgo", { n: String(mins) });
			}
			if (diff < 864e5) {
				const hours = Math.floor(diff / 36e5);
				return t("hoursAgo", { n: String(hours) });
			}
			if (diff < 2592e6) {
				const days = Math.floor(diff / 864e5);
				return t("daysAgo", { n: String(days) });
			}
			const d = new Date(timestamp);
			return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
		}
		/** Extract standard aspect ratio for precise filtering */
		function getItemRatio(item) {
			if (item.aspectRatio && item.aspectRatio !== "custom") return item.aspectRatio;
			if (item.output) {
				const ratioMatch = item.output.match(/\b(1:1|16:9|9:16|4:3|3:4|3:2|2:3)\b/);
				if (ratioMatch?.[1]) return ratioMatch[1];
				const dimMatch = item.output.match(/(\d{3,4})\s*[×x*]\s*(\d{3,4})/);
				if (dimMatch?.[1] && dimMatch[2]) {
					const w = parseInt(dimMatch[1], 10);
					const h = parseInt(dimMatch[2], 10);
					if (w === h) return "1:1";
					const approx = w / h;
					if (Math.abs(approx - 16 / 9) < .05) return "16:9";
					if (Math.abs(approx - 9 / 16) < .05) return "9:16";
					if (Math.abs(approx - 4 / 3) < .05) return "4:3";
					if (Math.abs(approx - 3 / 4) < .05) return "3:4";
					if (Math.abs(approx - 3 / 2) < .05) return "3:2";
					if (Math.abs(approx - 2 / 3) < .05) return "2:3";
				}
			}
			return "1:1";
		}
		/** Format aspect ratio or dimensions for card metadata (e.g., 1024×1024 or 16:9) */
		function formatCardMeta(item) {
			if (item.output) {
				const dimMatch = item.output.match(/(\d{3,4})\s*[×x*]\s*(\d{3,4})/);
				if (dimMatch?.[1] && dimMatch[2]) return `${dimMatch[1]}×${dimMatch[2]}`;
			}
			if (item.aspectRatio && item.aspectRatio !== "custom") return item.aspectRatio;
			if (item.output) {
				const ratioMatch = item.output.match(/\b(1:1|16:9|9:16|4:3|3:4|3:2|2:3)\b/);
				if (ratioMatch?.[1]) return ratioMatch[1];
			}
			if (item.imageSize) return item.imageSize;
			return "1:1";
		}
		const GalleryViewTab = (props) => {
			const { locale, sessionId, useSessions, useWorkspaces } = props;
			const [activeTab, setActiveTab] = (0, react.useState)("gallery");
			const [items, setItems] = (0, react.useState)([]);
			const [search, setSearch] = (0, react.useState)("");
			const [selectedProvider, setSelectedProvider] = (0, react.useState)("all");
			const [selectedRatio, setSelectedRatio] = (0, react.useState)("all");
			const [sortBy, setSortBy] = (0, react.useState)("newest");
			const [onlyCurrentWorkspace, setOnlyCurrentWorkspace] = (0, react.useState)(() => {
				try {
					const stored = localStorage.getItem("dsh-ig-only-current-workspace");
					return stored === null ? true : stored === "true";
				} catch {
					return true;
				}
			});
			const [serverWorkspaces, setServerWorkspaces] = (0, react.useState)([]);
			const [serverActiveRoot, setServerActiveRoot] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				try {
					localStorage.setItem("dsh-ig-only-current-workspace", String(onlyCurrentWorkspace));
				} catch {}
			}, [onlyCurrentWorkspace]);
			(0, react.useEffect)(() => {
				let mounted = true;
				fetch(STUDIO_ROUTE).then((res) => res.ok ? res.json() : null).then((data) => {
					if (!mounted || !data) return;
					if (Array.isArray(data.workspaces)) setServerWorkspaces(data.workspaces);
					if (typeof data.workspaceRoot === "string") setServerActiveRoot(data.workspaceRoot);
				}).catch(() => {});
				return () => {
					mounted = false;
				};
			}, []);
			const liveWorkspaces = useWorkspaces ? useWorkspaces((s) => s?.items) : null;
			const liveSessions = useSessions ? useSessions((s) => s) : null;
			const currentSessionId = sessionId || liveSessions?.current;
			const activeWorkspace = (0, react.useMemo)(() => {
				const allWs = Array.isArray(liveWorkspaces) && liveWorkspaces.length > 0 ? liveWorkspaces : serverWorkspaces;
				if (allWs.length > 0) {
					if (currentSessionId) {
						const matched = allWs.find((ws) => Array.isArray(ws.sessionIds) && ws.sessionIds.includes(currentSessionId));
						if (matched) return matched;
					}
					if (serverActiveRoot) {
						const normActive = serverActiveRoot.replace(/\\/g, "/").toLowerCase();
						const matched = allWs.find((ws) => ws.path && ws.path.replace(/\\/g, "/").toLowerCase() === normActive);
						if (matched) return matched;
					}
					return allWs[0];
				}
				if (serverActiveRoot) return {
					workspaceId: "default",
					path: serverActiveRoot,
					title: "Workspace",
					sessionIds: []
				};
				return null;
			}, [
				liveWorkspaces,
				serverWorkspaces,
				currentSessionId,
				serverActiveRoot
			]);
			const [previewItem, setPreviewItem] = (0, react.useState)(null);
			const [previewUrl, setPreviewUrl] = (0, react.useState)(null);
			const previewUrlRef = (0, react.useRef)(null);
			previewUrlRef.current = previewUrl;
			const [previewBlob, setPreviewBlob] = (0, react.useState)(null);
			const [toast, setToast] = (0, react.useState)(null);
			const [showRegenerateModal, setShowRegenerateModal] = (0, react.useState)(false);
			const [regeneratePrompt, setRegeneratePrompt] = (0, react.useState)("");
			const [isRegenerating, setIsRegenerating] = (0, react.useState)(false);
			const regenerateControllerRef = (0, react.useRef)(null);
			const [isManageMode, setIsManageMode] = (0, react.useState)(false);
			const [selectedIds, setSelectedIds] = (0, react.useState)(/* @__PURE__ */ new Set());
			const lastSelectedIndexRef = (0, react.useRef)(null);
			const [showDeleteModal, setShowDeleteModal] = (0, react.useState)(false);
			const [deleteWorkspaceFiles, setDeleteWorkspaceFiles] = (0, react.useState)(true);
			const [isDeleting, setIsDeleting] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setSelectedIds(/* @__PURE__ */ new Set());
				lastSelectedIndexRef.current = null;
			}, [
				activeTab,
				search,
				selectedProvider,
				selectedRatio,
				sortBy,
				onlyCurrentWorkspace
			]);
			const [lang, setLang] = (0, react.useState)(() => {
				return (locale?.getSnapshot?.()?.active)?.startsWith("en") ? "en" : "zh";
			});
			(0, react.useEffect)(() => {
				if (!locale?.subscribe) return;
				return locale.subscribe(() => {
					const active = locale.getSnapshot?.()?.active;
					setLang(active?.startsWith("en") ? "en" : "zh");
				});
			}, [locale]);
			const dict = lang === "en" ? DICT$1.en : DICT$1.zh;
			const t = (key, params) => {
				let text = dict[key] || DICT$1.zh[key] || key;
				if (params) for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, v);
				return text;
			};
			const showToast = (msg) => {
				setToast(msg);
				setTimeout(() => {
					setToast(null);
				}, 2e3);
			};
			(0, react.useEffect)(() => {
				const seat = document.querySelector("[data-composer-seat]");
				if (seat) {
					const prevDisplay = seat.style.display;
					seat.style.display = "none";
					return () => {
						seat.style.display = prevDisplay;
					};
				}
			}, []);
			(0, react.useEffect)(() => {
				let active = true;
				const load = () => {
					getGalleryItems().then((res) => {
						if (active) setItems(res);
					});
				};
				load();
				const unsubscribe = subscribeGallery(load);
				return () => {
					active = false;
					unsubscribe();
				};
			}, []);
			const [previewLoading, setPreviewLoading] = (0, react.useState)(false);
			const blobCache = (0, react.useMemo)(() => /* @__PURE__ */ new Map(), []);
			const abortControllerRef = (0, react.useRef)(null);
			const filteredItems = (0, react.useMemo)(() => {
				return items.filter((item) => {
					if (activeTab === "favorites" && !item.isFavorite) return false;
					if (selectedProvider !== "all" && item.provider !== selectedProvider) return false;
					if (selectedRatio !== "all") {
						if (getItemRatio(item) !== selectedRatio) return false;
					}
					if (search.trim().length > 0) {
						const q = search.trim().toLowerCase();
						const matchPrompt = item.prompt?.toLowerCase().includes(q);
						const matchModel = item.model?.toLowerCase().includes(q);
						const matchProvider = item.provider?.toLowerCase().includes(q);
						const matchTags = item.tags?.some((t) => t.toLowerCase().includes(q));
						if (!matchPrompt && !matchModel && !matchProvider && !matchTags) return false;
					}
					if (onlyCurrentWorkspace && activeWorkspace) {
						if (!isItemInWorkspace(item, activeWorkspace)) return false;
					}
					return true;
				}).sort((a, b) => {
					if (sortBy === "oldest") return a.createdAt - b.createdAt;
					return b.createdAt - a.createdAt;
				});
			}, [
				items,
				activeTab,
				selectedProvider,
				selectedRatio,
				search,
				sortBy,
				onlyCurrentWorkspace,
				activeWorkspace
			]);
			const workspaceItemsCount = (0, react.useMemo)(() => {
				if (!activeWorkspace) return items.length;
				return items.filter((item) => isItemInWorkspace(item, activeWorkspace)).length;
			}, [items, activeWorkspace]);
			const currentPreviewIndex = (0, react.useMemo)(() => {
				if (!previewItem) return -1;
				return filteredItems.findIndex((i) => i.id === previewItem.id);
			}, [previewItem, filteredItems]);
			const hasPrev = currentPreviewIndex > 0;
			const hasNext = currentPreviewIndex >= 0 && currentPreviewIndex < filteredItems.length - 1;
			const openPreviewItem = (item, blob) => {
				if (abortControllerRef.current) {
					abortControllerRef.current.abort();
					abortControllerRef.current = null;
				}
				if (previewUrlRef.current) {
					URL.revokeObjectURL(previewUrlRef.current);
					previewUrlRef.current = null;
				}
				setPreviewItem(item);
				if (blob) {
					blobCache.set(item.id, blob);
					const url = URL.createObjectURL(blob);
					previewUrlRef.current = url;
					setPreviewBlob(blob);
					setPreviewUrl(url);
					setPreviewLoading(false);
					return;
				}
				const cached = blobCache.get(item.id);
				if (cached) {
					const url = URL.createObjectURL(cached);
					previewUrlRef.current = url;
					setPreviewBlob(cached);
					setPreviewUrl(url);
					setPreviewLoading(false);
					return;
				}
				setPreviewLoading(true);
				setPreviewBlob(null);
				setPreviewUrl(null);
				const controller = new AbortController();
				abortControllerRef.current = controller;
				fetchAttachmentBlob(item.attachment).then((fetchedBlob) => {
					if (controller.signal.aborted) return;
					blobCache.set(item.id, fetchedBlob);
					const url = URL.createObjectURL(fetchedBlob);
					previewUrlRef.current = url;
					setPreviewBlob(fetchedBlob);
					setPreviewUrl(url);
					setPreviewLoading(false);
				}).catch((err) => {
					if (controller.signal.aborted) return;
					setPreviewLoading(false);
					showToast(t("copyFailed"));
				});
			};
			const handleClosePreview = () => {
				if (abortControllerRef.current) {
					abortControllerRef.current.abort();
					abortControllerRef.current = null;
				}
				if (regenerateControllerRef.current) {
					regenerateControllerRef.current.abort();
					regenerateControllerRef.current = null;
					setIsRegenerating(false);
				}
				setShowRegenerateModal(false);
				if (previewUrlRef.current) {
					URL.revokeObjectURL(previewUrlRef.current);
					previewUrlRef.current = null;
				}
				setPreviewItem(null);
				setPreviewUrl(null);
				setPreviewBlob(null);
				setPreviewLoading(false);
			};
			const goToPrev = () => {
				if (currentPreviewIndex > 0) {
					const prevItem = filteredItems[currentPreviewIndex - 1];
					if (prevItem) openPreviewItem(prevItem);
				}
			};
			const goToNext = () => {
				if (currentPreviewIndex >= 0 && currentPreviewIndex < filteredItems.length - 1) {
					const nextItem = filteredItems[currentPreviewIndex + 1];
					if (nextItem) openPreviewItem(nextItem);
				}
			};
			const handleOpenRegenerate = () => {
				if (!previewItem || isRegenerating) return;
				setRegeneratePrompt(previewItem.prompt);
				setShowRegenerateModal(true);
			};
			const handleCancelRegeneratePrompt = () => {
				setShowRegenerateModal(false);
			};
			const handleAbortRegenerating = () => {
				regenerateControllerRef.current?.abort();
				regenerateControllerRef.current = null;
				setIsRegenerating(false);
				showToast(t("cancel"));
			};
			const handleConfirmRegenerate = async () => {
				if (!previewItem || isRegenerating || regeneratePrompt.trim().length === 0) return;
				setShowRegenerateModal(false);
				setIsRegenerating(true);
				const controller = new AbortController();
				regenerateControllerRef.current = controller;
				try {
					const request = conversationRegenerateRequest(previewItem, regeneratePrompt, previewItem.aspectRatio ? {
						ratio: previewItem.aspectRatio,
						quality: previewItem.imageSize || "standard"
					} : void 0);
					if (activeWorkspace?.path) request.workspaceRoot = activeWorkspace.path;
					const response = await fetch(STUDIO_ROUTE, {
						method: "POST",
						credentials: "same-origin",
						signal: controller.signal,
						headers: { "content-type": "application/json" },
						body: JSON.stringify(request)
					});
					const payload = await response.json().catch(() => null);
					if (!response.ok || payload === null || !("attachment" in payload)) throw new Error(payload && "error" in payload && payload.error ? payload.error : t("regenerateFailed"));
					const newItem = {
						id: String(payload.attachment.attachmentId),
						attachment: payload.attachment,
						prompt: payload.prompt,
						provider: payload.provider,
						model: payload.model,
						createdAt: payload.createdAt,
						aspectRatio: request.ratio,
						imageSize: request.quality,
						output: payload.output,
						...payload.savedTo ? { savedTo: payload.savedTo } : {},
						...activeWorkspace?.path ? { workspacePath: activeWorkspace.path } : {},
						...activeWorkspace?.workspaceId ? { workspaceId: activeWorkspace.workspaceId } : {},
						...currentSessionId ? { sessionId: currentSessionId } : {}
					};
					await saveGalleryItem(newItem);
					if (activeTab !== "gallery") setActiveTab("gallery");
					if (search.trim().length > 0) setSearch("");
					openPreviewItem(newItem);
					showToast(t("regenerateSuccess"));
				} catch (err) {
					if (controller.signal.aborted) return;
					showToast(err instanceof Error ? err.message : String(err));
				} finally {
					setIsRegenerating(false);
					regenerateControllerRef.current = null;
				}
			};
			(0, react.useEffect)(() => {
				return () => {
					if (abortControllerRef.current) abortControllerRef.current.abort();
					if (regenerateControllerRef.current) regenerateControllerRef.current.abort();
					if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
				};
			}, []);
			(0, react.useEffect)(() => {
				const onKeyDown = (e) => {
					if (["INPUT", "TEXTAREA"].includes(e.target?.tagName)) return;
					if (showRegenerateModal) {
						if (e.key === "Escape") {
							e.preventDefault();
							setShowRegenerateModal(false);
						}
						return;
					}
					if (showDeleteModal) {
						if (e.key === "Escape" && !isDeleting) {
							e.preventDefault();
							setShowDeleteModal(false);
							if (!isManageMode) setSelectedIds(/* @__PURE__ */ new Set());
						}
						return;
					}
					if (previewItem) {
						if (e.key === "Escape") handleClosePreview();
						else if (e.key === "ArrowLeft" || e.key === "Left") {
							e.preventDefault();
							goToPrev();
						} else if (e.key === "ArrowRight" || e.key === "Right") {
							e.preventDefault();
							goToNext();
						}
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [
				showRegenerateModal,
				showDeleteModal,
				isDeleting,
				isManageMode,
				previewItem,
				currentPreviewIndex,
				filteredItems
			]);
			const handleCardClick = (item, index, e, blob) => {
				if (e.shiftKey || isManageMode) {
					e.stopPropagation();
					if (!isManageMode) setIsManageMode(true);
					if (e.shiftKey && lastSelectedIndexRef.current !== null) {
						const from = Math.min(lastSelectedIndexRef.current, index);
						const to = Math.max(lastSelectedIndexRef.current, index);
						const rangeItems = filteredItems.slice(from, to + 1);
						setSelectedIds((prev) => {
							const next = new Set(prev);
							for (const r of rangeItems) next.add(r.id);
							return next;
						});
					} else {
						setSelectedIds((prev) => {
							const next = new Set(prev);
							if (next.has(item.id)) next.delete(item.id);
							else next.add(item.id);
							return next;
						});
						lastSelectedIndexRef.current = index;
					}
					return;
				}
				if (blob) openPreviewItem(item, blob);
			};
			const handleToggleSelect = (id, index, e) => {
				e.stopPropagation();
				if (!isManageMode) setIsManageMode(true);
				if (e.shiftKey && lastSelectedIndexRef.current !== null) {
					const from = Math.min(lastSelectedIndexRef.current, index);
					const to = Math.max(lastSelectedIndexRef.current, index);
					const rangeItems = filteredItems.slice(from, to + 1);
					setSelectedIds((prev) => {
						const next = new Set(prev);
						for (const r of rangeItems) next.add(r.id);
						return next;
					});
				} else {
					setSelectedIds((prev) => {
						const next = new Set(prev);
						if (next.has(id)) next.delete(id);
						else next.add(id);
						return next;
					});
					lastSelectedIndexRef.current = index;
				}
			};
			const handleSelectAll = () => {
				setSelectedIds(new Set(filteredItems.map((i) => i.id)));
			};
			const handleInvertSelect = () => {
				setSelectedIds((prev) => {
					const next = /* @__PURE__ */ new Set();
					for (const item of filteredItems) if (!prev.has(item.id)) next.add(item.id);
					return next;
				});
			};
			const handleClearSelect = () => {
				setSelectedIds(/* @__PURE__ */ new Set());
				lastSelectedIndexRef.current = null;
			};
			const handleExitManage = () => {
				setIsManageMode(false);
				setSelectedIds(/* @__PURE__ */ new Set());
				lastSelectedIndexRef.current = null;
			};
			const requestSingleDelete = (item, e) => {
				if (e) e.stopPropagation();
				setSelectedIds(/* @__PURE__ */ new Set([item.id]));
				setShowDeleteModal(true);
			};
			const hasWorkspaceFilesToDelete = (0, react.useMemo)(() => items.some((i) => selectedIds.has(i.id) && typeof i.savedTo === "string" && i.savedTo.trim().length > 0), [items, selectedIds]);
			const handleConfirmBatchDelete = async () => {
				if (selectedIds.size === 0 || isDeleting) return;
				setIsDeleting(true);
				const idsToDelete = Array.from(selectedIds);
				const itemsToDelete = items.filter((i) => selectedIds.has(i.id));
				const pathsToDelete = itemsToDelete.map((i) => i.savedTo).filter((p) => typeof p === "string" && p.trim().length > 0);
				let deletedFiles = 0;
				if (deleteWorkspaceFiles && pathsToDelete.length > 0) try {
					const res = await fetch(DELETE_ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ paths: pathsToDelete })
					});
					if (!res.ok) {
						setIsDeleting(false);
						showToast(`工作区文件删除失败 (${res.status})`);
						return;
					}
					const data = await res.json().catch(() => null);
					if (!data || data.ok === false || Array.isArray(data.failedFiles) && data.failedFiles.length > 0) {
						setIsDeleting(false);
						const reason = data?.failedFiles?.[0]?.error || "工作区文件未能删除";
						showToast(`删除失败：${reason}`);
						return;
					}
					deletedFiles = data.deletedCount ?? 0;
				} catch (err) {
					setIsDeleting(false);
					showToast(err instanceof Error ? err.message : "工作区文件删除网络异常");
					return;
				}
				try {
					await bulkDeleteGalleryItems(idsToDelete);
					for (const item of itemsToDelete) evictAttachmentCache(item.attachment.attachmentId);
				} catch (err) {
					setIsDeleting(false);
					showToast(t("deleteFailedDatabase"));
					return;
				}
				if (previewItem && selectedIds.has(previewItem.id)) handleClosePreview();
				setIsDeleting(false);
				setShowDeleteModal(false);
				if (isManageMode) handleExitManage();
				else {
					setSelectedIds(/* @__PURE__ */ new Set());
					lastSelectedIndexRef.current = null;
				}
				if (deletedFiles > 0) showToast(t("batchDeletedWithFilesToast", {
					count: String(idsToDelete.length),
					files: String(deletedFiles)
				}));
				else showToast(t("batchDeletedToast", { count: String(idsToDelete.length) }));
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-ig-gallery-page",
				"data-conversation-composer-overlay": "",
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-ig-studio-tabs-bar",
						children: [
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `dsh-ig-studio-tab-btn ${activeTab === "gallery" ? "is-active" : ""}`,
								onClick: () => setActiveTab("gallery"),
								children: [(0, react_jsx_runtime.jsx)(Image$1, { size: 15 }), (0, react_jsx_runtime.jsx)("span", { children: t("tabGallery") })]
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `dsh-ig-studio-tab-btn ${activeTab === "studio" ? "is-active" : ""}`,
								onClick: () => setActiveTab("studio"),
								children: [(0, react_jsx_runtime.jsx)(SlidersHorizontal, { size: 15 }), (0, react_jsx_runtime.jsx)("span", { children: t("tabStudio") })]
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `dsh-ig-studio-tab-btn ${activeTab === "favorites" ? "is-active" : ""}`,
								onClick: () => setActiveTab("favorites"),
								children: [(0, react_jsx_runtime.jsx)(Heart, { size: 15 }), (0, react_jsx_runtime.jsx)("span", { children: t("tabFavorites") })]
							})
						]
					}),
					(activeTab === "gallery" || activeTab === "favorites") && (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-ig-studio-toolbar",
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-studio-toolbar-left",
							children: [
								(0, react_jsx_runtime.jsxs)("select", {
									className: "dsh-ig-studio-select",
									value: selectedProvider,
									onChange: (e) => setSelectedProvider(e.target.value),
									children: [
										(0, react_jsx_runtime.jsx)("option", {
											value: "all",
											children: t("filterAllProviders")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "google",
											children: t("filterGoogle")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "openai",
											children: t("filterOpenAI")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "grok",
											children: "Grok / xAI"
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "seedream",
											children: t("filterSeedream")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "dashscope",
											children: t("filterDashScope")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "comfyui",
											children: t("filterComfyUI")
										})
									]
								}),
								(0, react_jsx_runtime.jsxs)("select", {
									className: "dsh-ig-studio-select",
									value: selectedRatio,
									onChange: (e) => setSelectedRatio(e.target.value),
									children: [
										(0, react_jsx_runtime.jsx)("option", {
											value: "all",
											children: t("filterAllRatios")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "1:1",
											children: "1:1"
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "16:9",
											children: "16:9"
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "9:16",
											children: "9:16"
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "4:3",
											children: "4:3"
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "3:4",
											children: "3:4"
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "3:2",
											children: "3:2"
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "2:3",
											children: "2:3"
										})
									]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-studio-search-wrap",
									children: [(0, react_jsx_runtime.jsx)(Search, {
										className: "dsh-ig-studio-search-icon",
										size: 14
									}), (0, react_jsx_runtime.jsx)("input", {
										type: "text",
										className: "dsh-ig-studio-search-input",
										placeholder: t("searchPlaceholder"),
										value: search,
										onChange: (e) => setSearch(e.target.value)
									})]
								}),
								(0, react_jsx_runtime.jsxs)("label", {
									className: "dsh-ig-workspace-filter-label",
									title: t("filterCurrentWorkspaceHint"),
									children: [
										(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											className: "dsh-ig-workspace-checkbox",
											checked: onlyCurrentWorkspace,
											onChange: (e) => setOnlyCurrentWorkspace(e.target.checked)
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: "dsh-ig-workspace-filter-text",
											children: t("filterCurrentWorkspace")
										}),
										(0, react_jsx_runtime.jsxs)("span", {
											className: "dsh-ig-workspace-filter-badge",
											children: [
												workspaceItemsCount,
												"/",
												items.length
											]
										})
									]
								})
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-studio-toolbar-right",
							children: [(0, react_jsx_runtime.jsxs)("select", {
								className: "dsh-ig-studio-select dsh-ig-studio-select-sort",
								value: sortBy,
								onChange: (e) => setSortBy(e.target.value),
								children: [(0, react_jsx_runtime.jsx)("option", {
									value: "newest",
									children: t("sortNewest")
								}), (0, react_jsx_runtime.jsx)("option", {
									value: "oldest",
									children: t("sortOldest")
								})]
							}), (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `dsh-ig-studio-btn dsh-ig-studio-btn-danger ${isManageMode ? "is-active" : ""}`,
								title: isManageMode ? t("exitManage") : t("manage"),
								onClick: () => {
									if (isManageMode) handleExitManage();
									else setIsManageMode(true);
								},
								children: [(0, react_jsx_runtime.jsx)(Trash2, { size: 13 }), (0, react_jsx_runtime.jsx)("span", { children: isManageMode ? t("exitManage") : t("manage") })]
							})]
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: `dsh-ig-gallery-page-body ${activeTab === "studio" ? "is-workbench" : ""}`,
						children: activeTab === "gallery" || activeTab === "favorites" ? items.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-gallery-empty",
							children: [
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-icon",
									children: "🖼️"
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-title",
									children: t("emptyTitle")
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-desc",
									children: t("emptyDesc")
								})
							]
						}) : activeTab === "favorites" && filteredItems.length === 0 && search === "" && selectedProvider === "all" && selectedRatio === "all" ? (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-gallery-empty",
							children: [
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-icon",
									children: "🤍"
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-title",
									children: t("favEmptyTitle")
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-desc",
									children: t("favEmptyDesc")
								})
							]
						}) : filteredItems.length === 0 ? (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-gallery-empty",
							children: [
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-icon",
									children: "🔍"
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-title",
									children: t("noMatchTitle")
								}),
								(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-gallery-empty-desc",
									children: t("noMatchDesc")
								})
							]
						}) : (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-ig-gallery-grid",
							children: filteredItems.map((item, idx) => (0, react_jsx_runtime.jsx)(GalleryCard, {
								item,
								index: idx,
								isManageMode,
								isSelected: selectedIds.has(item.id),
								t,
								onClick: (e, blob) => handleCardClick(item, idx, e, blob),
								onToggleSelect: (e) => handleToggleSelect(item.id, idx, e),
								onRequestDelete: () => requestSingleDelete(item),
								onPreview: (blob) => openPreviewItem(item, blob),
								onBlobLoaded: (b) => blobCache.set(item.id, b),
								onToast: showToast
							}, item.id))
						}) : (0, react_jsx_runtime.jsx)(StudioView, {
							locale,
							workspace: activeWorkspace
						})
					}),
					toast && (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-gallery-page-toast",
						children: toast
					}),
					(isManageMode || selectedIds.size > 0) && (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-ig-batch-bar",
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-batch-bar-left",
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-batch-counter",
									children: t("selectedCount", { n: String(selectedIds.size) })
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-batch-btn",
									onClick: handleSelectAll,
									children: t("selectAll")
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-batch-btn",
									onClick: handleInvertSelect,
									children: t("invertSelect")
								}),
								selectedIds.size > 0 && (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-batch-btn",
									onClick: handleClearSelect,
									children: t("clearSelect")
								})
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-batch-bar-right",
							children: [(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-ig-batch-btn dsh-ig-batch-btn-danger",
								disabled: selectedIds.size === 0,
								onClick: () => setShowDeleteModal(true),
								children: [(0, react_jsx_runtime.jsx)(Trash2, { size: 13 }), (0, react_jsx_runtime.jsxs)("span", { children: [t("batchDelete"), selectedIds.size > 0 ? ` (${selectedIds.size})` : ""] })]
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-ig-batch-btn dsh-ig-batch-btn-exit",
								onClick: handleExitManage,
								children: t("exitManage")
							})]
						})]
					}),
					showDeleteModal && (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-modal-backdrop",
						onClick: () => {
							if (!isDeleting) {
								setShowDeleteModal(false);
								if (!isManageMode) setSelectedIds(/* @__PURE__ */ new Set());
							}
						},
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-modal-box",
							onClick: (e) => e.stopPropagation(),
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-modal-header",
									children: [(0, react_jsx_runtime.jsx)("div", {
										className: "dsh-ig-modal-icon-danger",
										children: (0, react_jsx_runtime.jsx)(TriangleAlert, { size: 20 })
									}), (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-ig-modal-title",
										children: selectedIds.size === 1 ? t("batchDeleteTitleSingle") : t("batchDeleteTitle", { count: String(selectedIds.size) })
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-modal-body",
									children: [(0, react_jsx_runtime.jsx)("p", {
										className: "dsh-ig-modal-desc",
										children: t("batchDeleteDesc")
									}), hasWorkspaceFilesToDelete && (0, react_jsx_runtime.jsxs)("label", {
										className: "dsh-ig-modal-checkbox-label",
										children: [(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: deleteWorkspaceFiles,
											onChange: (e) => setDeleteWorkspaceFiles(e.target.checked),
											disabled: isDeleting
										}), (0, react_jsx_runtime.jsx)("span", { children: t("deleteWorkspaceFilesOpt") })]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-modal-footer",
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-modal-btn dsh-ig-modal-btn-cancel",
										onClick: () => {
											setShowDeleteModal(false);
											if (!isManageMode) setSelectedIds(/* @__PURE__ */ new Set());
										},
										disabled: isDeleting,
										children: t("cancel")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-modal-btn dsh-ig-modal-btn-danger",
										onClick: handleConfirmBatchDelete,
										disabled: isDeleting,
										children: isDeleting ? "..." : selectedIds.size === 1 ? t("confirmDeleteSingle") : t("confirmBatchDelete", { count: String(selectedIds.size) })
									})]
								})
							]
						})
					}),
					showRegenerateModal && previewItem && (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-modal-backdrop",
						onClick: handleCancelRegeneratePrompt,
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-modal-box dsh-ig-regenerate-modal-box",
							onClick: (e) => e.stopPropagation(),
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-modal-header",
									children: [(0, react_jsx_runtime.jsx)("div", {
										className: "dsh-ig-regenerate-modal-icon",
										children: (0, react_jsx_runtime.jsx)(Sparkles, { size: 18 })
									}), (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-ig-regenerate-modal-title-wrap",
										children: [(0, react_jsx_runtime.jsx)("div", {
											className: "dsh-ig-modal-title",
											children: t("regenerateTitle")
										}), (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-regenerate-modal-meta",
											children: [
												(0, react_jsx_runtime.jsx)("span", {
													className: "dsh-ig-tag",
													children: previewItem.provider
												}),
												previewItem.model && (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-ig-tag dsh-ig-tag-model",
													children: previewItem.model
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: "dsh-ig-tag",
													children: formatCardMeta(previewItem)
												})
											]
										})]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-modal-body",
									children: [(0, react_jsx_runtime.jsx)("p", {
										className: "dsh-ig-modal-desc",
										children: t("regenerateHint")
									}), (0, react_jsx_runtime.jsx)("textarea", {
										className: "dsh-ig-regenerate-modal-textarea",
										value: regeneratePrompt,
										onChange: (e) => setRegeneratePrompt(e.target.value),
										placeholder: t("prompt"),
										rows: 4,
										autoFocus: true
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-modal-footer",
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-modal-btn dsh-ig-modal-btn-cancel",
										onClick: handleCancelRegeneratePrompt,
										children: t("cancel")
									}), (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dsh-ig-modal-btn dsh-ig-modal-btn-primary",
										onClick: handleConfirmRegenerate,
										disabled: regeneratePrompt.trim().length === 0,
										children: [(0, react_jsx_runtime.jsx)(Sparkles, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("confirmRegenerate") })]
									})]
								})
							]
						})
					}),
					previewItem && (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-ig-lightbox-backdrop",
						onClick: handleClosePreview,
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-ig-lightbox-topbar",
								onClick: (e) => e.stopPropagation(),
								children: [(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-lightbox-meta",
									children: [
										(0, react_jsx_runtime.jsx)("span", {
											className: "dsh-ig-tag",
											children: previewItem.provider
										}),
										previewItem.model ? (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-ig-tag dsh-ig-tag-model",
											children: previewItem.model
										}) : null,
										currentPreviewIndex >= 0 && (0, react_jsx_runtime.jsxs)("span", {
											className: "dsh-ig-lightbox-counter",
											children: [
												currentPreviewIndex + 1,
												" / ",
												filteredItems.length
											]
										})
									]
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-lightbox-close-btn",
									title: t("close"),
									onClick: handleClosePreview,
									children: (0, react_jsx_runtime.jsx)(X, { size: 18 })
								})]
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-ig-lightbox-nav-btn dsh-ig-lightbox-nav-prev",
								title: t("prevImage"),
								disabled: !hasPrev,
								onClick: (e) => {
									e.stopPropagation();
									goToPrev();
								},
								children: (0, react_jsx_runtime.jsx)(ChevronLeft, { size: 24 })
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-ig-lightbox-nav-btn dsh-ig-lightbox-nav-next",
								title: t("nextImage"),
								disabled: !hasNext,
								onClick: (e) => {
									e.stopPropagation();
									goToNext();
								},
								children: (0, react_jsx_runtime.jsx)(ChevronRight, { size: 24 })
							}),
							(0, react_jsx_runtime.jsx)("div", {
								className: "dsh-ig-lightbox-img-wrap",
								onClick: (e) => e.stopPropagation(),
								children: previewLoading ? (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-lightbox-loading",
									children: (0, react_jsx_runtime.jsx)("div", { className: "dsh-ig-lightbox-spinner" })
								}) : previewUrl ? (0, react_jsx_runtime.jsx)("img", {
									className: "dsh-ig-lightbox-img",
									src: previewUrl,
									alt: previewItem.prompt
								}) : null
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-ig-lightbox-bottombar",
								onClick: (e) => e.stopPropagation(),
								children: [(0, react_jsx_runtime.jsx)("div", {
									className: "dsh-ig-lightbox-prompt-text",
									title: previewItem.prompt,
									children: previewItem.prompt
								}), (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-lightbox-actions",
									children: [
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn",
											title: t("copyPpt"),
											onClick: async () => {
												await navigator.clipboard.writeText(previewItem.prompt);
												showToast(t("copiedPrompt"));
											},
											children: [(0, react_jsx_runtime.jsx)(FileText, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("copyPpt") })]
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn",
											title: t("copyImg"),
											onClick: async () => {
												if (!previewBlob) return;
												const ok = await copyImageBlob(previewBlob);
												showToast(ok ? t("copiedImage") : t("copyFailed"));
											},
											children: [(0, react_jsx_runtime.jsx)(Copy, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("copyImg") })]
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn",
											title: t("download"),
											onClick: () => {
												if (!previewUrl) return;
												const a = document.createElement("a");
												a.href = previewUrl;
												a.download = `dsh-${previewItem.provider}-${previewItem.id}.png`;
												document.body.appendChild(a);
												a.click();
												document.body.removeChild(a);
											},
											children: [(0, react_jsx_runtime.jsx)(Download, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("download") })]
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn dsh-ig-lightbox-btn-regenerate",
											title: t("regenerate"),
											disabled: isRegenerating,
											onClick: handleOpenRegenerate,
											children: [(0, react_jsx_runtime.jsx)(Sparkles, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("regenerate") })]
										}),
										isRegenerating && (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-lightbox-generating-indicator",
											children: [
												(0, react_jsx_runtime.jsx)("div", { className: "dsh-ig-lightbox-spinner-sm" }),
												(0, react_jsx_runtime.jsx)("span", { children: t("regenerating") }),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dsh-ig-lightbox-abort-btn",
													onClick: handleAbortRegenerating,
													children: t("cancel")
												})
											]
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsh-ig-lightbox-btn dsh-ig-lightbox-btn-danger",
											title: t("delete"),
											onClick: () => {
												if (previewItem) requestSingleDelete(previewItem);
											},
											children: [(0, react_jsx_runtime.jsx)(Trash2, { size: 14 }), (0, react_jsx_runtime.jsx)("span", { children: t("delete") })]
										})
									]
								})]
							})
						]
					})
				]
			});
		};
		const GalleryCard = ({ item, index: _index, isManageMode, isSelected, t, onClick, onToggleSelect, onRequestDelete, onPreview: _onPreview, onBlobLoaded, onToast }) => {
			const [url, setUrl] = (0, react.useState)();
			const [blob, setBlob] = (0, react.useState)();
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)();
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let objectUrl;
				fetch(IMAGE_ROUTE, {
					method: "POST",
					signal: controller.signal,
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ attachment: item.attachment })
				}).then(async (response) => {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const resBlob = await response.blob();
					if (controller.signal.aborted) return;
					setBlob(resBlob);
					onBlobLoaded?.(resBlob);
					objectUrl = URL.createObjectURL(resBlob);
					setUrl(objectUrl);
					setLoading(false);
				}).catch((err) => {
					if (!controller.signal.aborted) {
						setError(err instanceof Error ? err.message : String(err));
						setLoading(false);
					}
				});
				return () => {
					controller.abort();
					if (objectUrl) URL.revokeObjectURL(objectUrl);
				};
			}, [item.attachment]);
			const copyPrompt = async (e) => {
				e.stopPropagation();
				try {
					await navigator.clipboard.writeText(item.prompt);
					onToast(t("copiedPrompt"));
				} catch {
					onToast(t("copyFailed"));
				}
			};
			const copyImage = async (e) => {
				e.stopPropagation();
				if (!blob) return;
				onToast(await copyImageBlob(blob) ? t("copiedImage") : t("copyFailed"));
			};
			const downloadImage = (e) => {
				e.stopPropagation();
				if (!url) return;
				const a = document.createElement("a");
				a.href = url;
				a.download = `dsh-${item.provider}-${item.id}.png`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
			};
			const toggleFavorite = async (e) => {
				e.stopPropagation();
				onToast(await toggleFavoriteGalleryItem(item.id) ? t("favoriteAdded") : t("favoriteRemoved"));
			};
			const badgeLabel = item.model || item.provider;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: `dsh-ig-gallery-card ${isSelected ? "is-selected" : ""} ${isManageMode ? "is-manage-mode" : ""}`,
				onClick: (e) => onClick(e, blob),
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-ig-gallery-card-media",
					children: [
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: `dsh-ig-card-checkbox ${isSelected ? "is-checked" : ""}`,
							title: isSelected ? t("clearSelect") : t("manage"),
							onClick: onToggleSelect,
							children: isSelected && (0, react_jsx_runtime.jsx)(Check, {
								size: 11,
								strokeWidth: 3
							})
						}),
						loading && (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-ig-gallery-card-loading",
							children: "..."
						}),
						error && (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-gallery-card-error",
							children: ["⚠️ ", error]
						}),
						url && (0, react_jsx_runtime.jsx)("img", {
							className: "dsh-ig-gallery-card-img",
							src: url,
							alt: item.prompt,
							loading: "lazy"
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-card-toolbar",
							children: [
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-tool-btn",
									title: t("copyImg"),
									onClick: (e) => {
										copyImage(e);
									},
									children: (0, react_jsx_runtime.jsx)(Copy, { size: 13 })
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-tool-btn",
									title: t("download"),
									onClick: downloadImage,
									children: (0, react_jsx_runtime.jsx)(Download, { size: 13 })
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-tool-btn",
									title: t("copyPpt"),
									onClick: (e) => {
										copyPrompt(e);
									},
									children: (0, react_jsx_runtime.jsx)(FileText, { size: 13 })
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-ig-tool-btn dsh-ig-tool-btn-danger",
									title: t("delete"),
									onClick: (e) => {
										e.stopPropagation();
										onRequestDelete();
									},
									children: (0, react_jsx_runtime.jsx)(Trash2, { size: 13 })
								})
							]
						})
					]
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-ig-gallery-card-meta",
					children: [
						(0, react_jsx_runtime.jsx)("div", {
							className: "dsh-ig-card-badge-row",
							children: (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-ig-card-badge",
								title: badgeLabel,
								children: badgeLabel
							})
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: "dsh-ig-gallery-card-prompt-line",
							title: item.prompt,
							children: item.prompt
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-card-footer-row",
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-ig-card-meta-text",
								children: [
									formatCardMeta(item),
									" | ",
									formatRelativeTime(item.createdAt, t)
								]
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `dsh-ig-card-fav-btn ${item.isFavorite ? "is-favorited" : ""}`,
								title: item.isFavorite ? t("favoriteRemoved") : t("favoriteAdded"),
								onClick: (e) => {
									toggleFavorite(e);
								},
								children: (0, react_jsx_runtime.jsx)(Heart, {
									size: 15,
									fill: item.isFavorite ? "currentColor" : "none"
								})
							})]
						})
					]
				})]
			});
		};
		//#endregion
		//#region lib/types/client/image-ref.js
		/**
		* Extract the verified durable image attachment from a completed tool result block.
		* Supports legacy rc.2 `resultView.content` and modern DSH `block.content`.
		*/
		function imageRef(block) {
			if (!("kind" in block)) return void 0;
			const fromResultView = block.resultView?.card === "generic" ? block.resultView.content?.find((item) => item.type === "image") : void 0;
			if (fromResultView?.type === "image") return fromResultView.attachment;
			const fromBlockContent = Array.isArray(block.content) ? block.content.find((item) => item.type === "image") : void 0;
			if (fromBlockContent?.type === "image") return fromBlockContent.attachment;
		}
		//#endregion
		//#region lib/types/client/studio-style.js
		const STUDIO_STYLE = `
.dsh-ig-gallery-page-body.is-workbench{flex:1 1 0;height:100%;min-height:0;padding:0;overflow:hidden;display:flex;flex-direction:column}
.dsh-ig-workbench{--ig-blue:#2f64f5;--ig-line:color-mix(in srgb,currentColor 11%,transparent);--ig-soft:color-mix(in srgb,currentColor 4%,transparent);position:relative;display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden;padding:10px 12px 12px;color:var(--foreground,#182033);box-sizing:border-box;background:radial-gradient(circle at 60% -20%,rgba(63,104,246,.07),transparent 30%)}
.dsh-ig-workbench *{box-sizing:border-box}.dsh-ig-workbench button,.dsh-ig-workbench select,.dsh-ig-workbench textarea{font:inherit;color:inherit}
.dsh-ig-workbench-grid{display:grid;grid-template-columns:minmax(190px,238px) minmax(0,1fr) minmax(286px,340px);grid-template-rows:minmax(0,1fr);min-height:0;height:0;flex:1 1 0;border:1px solid var(--ig-line);border-radius:12px;overflow:hidden;background:var(--background,#fff);box-shadow:0 12px 32px rgba(30,42,76,.05);transition:grid-template-columns .2s ease}
.dsh-ig-workbench-grid.is-sidebar-collapsed{grid-template-columns:minmax(0,1fr) minmax(286px,340px)}
.dsh-ig-recent-panel,.dsh-ig-generate-panel{min-width:0;min-height:0;overflow:hidden;background:color-mix(in srgb,var(--background,#fff) 96%,#f5f7fb)}.dsh-ig-recent-panel{display:flex;flex-direction:column;border-right:1px solid var(--ig-line)}
.dsh-ig-panel-title{height:48px;flex:0 0 48px;padding:0 12px 0 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ig-line);font-size:13px;font-weight:650}
.dsh-ig-count-badge{font-size:11px;min-width:22px;text-align:center;padding:2px 6px;border-radius:999px;background:var(--ig-soft);color:#7b8498;font-weight:500}
.dsh-ig-collapse-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:6px;background:transparent;color:#717b90;cursor:pointer;transition:all .15s}
.dsh-ig-collapse-btn:hover{border-color:var(--ig-line);background:var(--ig-soft);color:var(--foreground,#182033)}
.dsh-ig-recent-scroll{flex:1 1 0;height:0;padding:8px;overflow-x:hidden;overflow-y:auto;min-height:0}.dsh-ig-recent-empty{min-height:180px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;color:#929bad;text-align:center;font-size:12px}
.dsh-ig-recent-item{display:grid;grid-template-columns:70px minmax(0,1fr);gap:10px;width:100%;padding:8px;border:1px solid transparent;border-radius:9px;background:transparent;text-align:left;cursor:pointer;transition:background .16s,border-color .16s,transform .16s}.dsh-ig-recent-item:hover{background:var(--ig-soft);transform:translateY(-1px)}.dsh-ig-recent-item.is-active{border-color:#89a7ff;background:rgba(47,100,245,.075);box-shadow:inset 3px 0 0 var(--ig-blue)}.dsh-ig-recent-thumb{width:70px;height:70px;border-radius:7px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#eef1f7;color:#929bad}.dsh-ig-recent-thumb img{width:100%;height:100%;object-fit:cover}.dsh-ig-recent-item>div:last-child{min-width:0;padding:1px 0}.dsh-ig-recent-item strong{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12.5px;line-height:19px;font-weight:630}.dsh-ig-recent-item span,.dsh-ig-recent-item small{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;color:#828b9e;font-size:10.5px;line-height:16px}
.dsh-ig-load-more{width:100%;height:32px;margin:8px 0;display:flex;align-items:center;justify-content:center;border:1px dashed var(--ig-line);border-radius:7px;background:transparent;font-size:11px;color:#6b758b;cursor:pointer;transition:background .15s,color .15s}.dsh-ig-load-more:hover{background:var(--ig-soft);color:var(--ig-blue);border-color:#a2b9f6}
.dsh-ig-mini-btn{height:22px;padding:0 7px;display:inline-flex;align-items:center;gap:3px;border:1px solid var(--ig-line);border-radius:5px;background:var(--background,#fff);font-size:10.5px;font-weight:500;color:var(--foreground,#242f44);cursor:pointer;transition:all .15s}.dsh-ig-mini-btn:hover{border-color:#9bb4f5;color:var(--ig-blue);background:rgba(47,100,245,.06)}
.dsh-ig-canvas-column{min-width:0;min-height:0;height:100%;overflow:hidden;display:flex;flex-direction:column;background:color-mix(in srgb,var(--background,#fff) 97%,#e8edf7)}
.dsh-ig-canvas-toolbar{height:46px;flex:0 0 46px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 14px;border-bottom:1px solid var(--ig-line)}
.dsh-ig-canvas-toolbar-left,.dsh-ig-canvas-toolbar-right{display:flex;align-items:center;gap:6px}
.dsh-ig-canvas-toolbar button{height:30px;min-width:30px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--ig-line);border-radius:7px;background:var(--background,#fff);color:var(--foreground,#242f44);font-size:11.5px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.dsh-ig-canvas-toolbar button:hover{border-color:#9bb4f5;background:rgba(47,100,245,.05);color:var(--ig-blue)}
.dsh-ig-canvas-toolbar button.is-active{border-color:#8ba8f8;background:rgba(47,100,245,.08);color:var(--ig-blue);font-weight:550}
.dsh-ig-zoom-display{font-size:11px;min-width:38px;text-align:center;color:#64748b;user-select:none;font-variant-numeric:tabular-nums}
.dsh-ig-status-badge-wrap{position:relative;display:inline-flex;align-items:center}
.dsh-ig-status-badge{height:30px;display:inline-flex;align-items:center;gap:7px;padding:0 10px;border:1px solid var(--ig-line);border-radius:7px;background:var(--background,#fff);cursor:pointer;user-select:none;transition:border-color .15s,background .15s,box-shadow .15s}
.dsh-ig-status-badge:hover{border-color:#9bb4f5;background:rgba(47,100,245,.04)}
.dsh-ig-status-dot{width:7px;height:7px;min-width:7px;max-width:7px;border-radius:50%;flex-shrink:0;box-sizing:border-box}
.dsh-ig-status-dot.is-ready{background:#10b981;box-shadow:0 0 0 2px rgba(16,185,129,.2)}
.dsh-ig-status-dot.is-muted{background:#ef4444;box-shadow:0 0 0 2px rgba(239,68,68,.2)}
.dsh-ig-status-text{font-size:11.5px;font-weight:500;color:var(--foreground,#242f44);line-height:1}
.dsh-ig-status-arrow{color:#94a3b8;transition:transform .15s,color .15s}
.dsh-ig-status-badge-wrap:hover .dsh-ig-status-arrow{transform:rotate(180deg);color:var(--ig-blue)}
.dsh-ig-status-popover{position:absolute;left:0;top:calc(100% + 6px);width:260px;background:var(--background,#fff);border:1px solid var(--ig-line);border-radius:9px;box-shadow:0 12px 36px rgba(20,28,45,.14);padding:10px 12px;z-index:40;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .15s cubic-bezier(.16,1,.3,1),transform .15s cubic-bezier(.16,1,.3,1)}
.dsh-ig-status-badge-wrap:hover .dsh-ig-status-popover{opacity:1;pointer-events:auto;transform:translateY(0)}
.dsh-ig-status-popover-title{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:650;color:#8590a6;margin-bottom:8px;letter-spacing:.02em;text-transform:uppercase}
.dsh-ig-status-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.dsh-ig-status-list li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:6px;transition:background .12s}
.dsh-ig-status-list li.is-configured{background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.12)}
.dsh-ig-status-list li.is-missing{background:rgba(239,68,68,.04);border:1px solid rgba(239,68,68,.12);opacity:.75}
.dsh-ig-status-item-name{display:flex;flex-direction:column;min-width:0}
.dsh-ig-status-item-name strong{font-size:11.5px;font-weight:600;color:var(--foreground,#182033);line-height:16px}
.dsh-ig-status-item-name small{font-size:9.5px;color:#7c869a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:145px;line-height:14px}
.dsh-ig-status-item-tag{font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;flex-shrink:0}
.is-configured .dsh-ig-status-item-tag{color:#059669;background:rgba(16,185,129,.14)}
.is-missing .dsh-ig-status-item-tag{color:#dc2626;background:rgba(239,68,68,.14)}
.dsh-ig-canvas{position:relative;flex:1 1 0;height:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:24px;touch-action:none;user-select:none;cursor:grab;background-image:linear-gradient(45deg,rgba(114,128,156,.035) 25%,transparent 25%),linear-gradient(-45deg,rgba(114,128,156,.035) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(114,128,156,.035) 75%),linear-gradient(-45deg,transparent 75%,rgba(114,128,156,.035) 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}
.dsh-ig-canvas.is-dragging{cursor:grabbing!important}
.dsh-ig-canvas img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;border-radius:10px;box-shadow:0 14px 45px rgba(25,35,63,.18);user-select:none;-webkit-user-drag:none;pointer-events:auto}
.dsh-ig-canvas-empty,.dsh-ig-generating-state{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;color:#929bad;font-size:12px;padding:26px;cursor:default}
.dsh-ig-generating-state strong{font-size:15px;color:var(--foreground,#182033)}.dsh-ig-generating-state span{font-size:11px}.dsh-ig-generation-orbit{width:66px;height:66px;border-radius:50%;display:grid;place-items:center;color:var(--ig-blue);background:rgba(47,100,245,.09);box-shadow:0 0 0 10px rgba(47,100,245,.035);animation:dshIgPulse 1.8s ease-in-out infinite}
.dsh-ig-result-strip{flex:0 0 auto;min-height:52px;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--ig-line)}.dsh-ig-result-strip>span{font-size:12px;font-weight:650}.dsh-ig-result-strip>div,.dsh-ig-result-actions>div{display:flex;gap:7px}.dsh-ig-result-strip button,.dsh-ig-result-actions button{height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border:1px solid var(--ig-line);border-radius:7px;background:var(--background,#fff);font-size:11px;cursor:pointer}.dsh-ig-result-strip button:hover,.dsh-ig-result-actions button:hover{border-color:#9fb2ed;color:var(--ig-blue)}.dsh-ig-result-actions{flex:0 0 auto;min-height:54px;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--ig-line)}.dsh-ig-result-actions p{margin:0;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11.5px;line-height:18px;color:#596277}.dsh-ig-result-meta{flex:0 0 auto;min-height:32px;padding:6px 14px;display:flex;gap:13px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--ig-line);font-size:10px;color:#8790a3}.dsh-ig-result-meta span+span:before{content:'·';margin-right:13px}
.dsh-ig-generate-panel{height:100%;display:flex;flex-direction:column;border-left:1px solid var(--ig-line);overflow:hidden}.dsh-ig-panel-tabs{height:48px;flex:0 0 48px;display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--ig-line);padding:0 14px}.dsh-ig-panel-tabs button{position:relative;border:0;background:transparent;font-size:12px;color:#7c8598;cursor:pointer}.dsh-ig-panel-tabs button.is-active{color:var(--ig-blue);font-weight:650}.dsh-ig-panel-tabs button.is-active:after{content:'';position:absolute;left:20%;right:20%;bottom:-1px;height:2px;background:var(--ig-blue);border-radius:2px 2px 0 0}.dsh-ig-generator-form{flex:1 1 0;height:0;padding:15px;display:flex;flex-direction:column;gap:15px;overflow-x:hidden;overflow-y:auto;min-height:0}.dsh-ig-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dsh-ig-mode-switch button{height:39px;border:1px solid var(--ig-line);border-radius:8px;background:var(--background,#fff);display:flex;align-items:center;justify-content:center;gap:7px;font-size:12px;cursor:pointer}.dsh-ig-mode-switch button.is-active{border-color:#789bff;color:var(--ig-blue);background:rgba(47,100,245,.065);box-shadow:inset 0 0 0 1px rgba(47,100,245,.1)}
.dsh-ig-field{position:relative;display:flex;flex-direction:column;gap:7px}.dsh-ig-field>label,.dsh-ig-field-label label{font-size:11.5px;font-weight:630}.dsh-ig-field>label span{font-weight:400;color:#929bad}.dsh-ig-field-label{display:flex;align-items:center;justify-content:space-between}.dsh-ig-field-label b{color:#e14d4d}.dsh-ig-field-label button{border:0;background:transparent;color:#798397;font-size:10.5px;cursor:pointer}.dsh-ig-field textarea{width:100%;height:112px;padding:11px 12px 22px;resize:vertical;border:1px solid var(--ig-line);border-radius:9px;background:var(--background,#fff);font-size:12px;line-height:19px;outline:none}.dsh-ig-field textarea:focus{border-color:var(--ig-blue);box-shadow:0 0 0 3px rgba(47,100,245,.09)}.dsh-ig-field>small{position:absolute;right:9px;bottom:7px;color:#9aa2b2;font-size:9.5px}.dsh-ig-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.dsh-ig-field-select{display:flex;flex-direction:column;gap:6px;min-width:0}.dsh-ig-field-select>span{font-size:11px;font-weight:620}.dsh-ig-field-select select{width:100%;height:36px;padding:0 26px 0 9px;border:1px solid var(--ig-line);border-radius:8px;background:var(--background,#fff);font-size:11px;outline:none;text-overflow:ellipsis}.dsh-ig-field-select select:focus{border-color:var(--ig-blue)}
.dsh-ig-upload{height:92px;border:1px dashed #bcc6d9;border-radius:9px;background:rgba(255,255,255,.45);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:#7d879b;cursor:pointer}.dsh-ig-upload strong{font-size:11px;font-weight:570}.dsh-ig-upload small{font-size:9.5px}.dsh-ig-upload:hover,.dsh-ig-upload.is-dragging{border-color:var(--ig-blue);background:rgba(47,100,245,.05);color:var(--ig-blue)}
.dsh-ig-reference-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}
.dsh-ig-reference-card{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:#eef1f7;border:1px solid var(--ig-line)}
.dsh-ig-reference-card img{width:100%;height:100%;object-fit:cover}
.dsh-ig-reference-card button{position:absolute;right:4px;top:4px;width:18px;height:18px;border:0;border-radius:50%;display:grid;place-items:center;background:rgba(20,28,45,.75);color:#fff;cursor:pointer;padding:0;transition:background .15s}
.dsh-ig-reference-card button:hover{background:#ef4444}
.dsh-ig-reference-add{aspect-ratio:1;border:1px dashed #bcc6d9;border-radius:8px;background:rgba(255,255,255,.45);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#7d879b;cursor:pointer;font-size:10px;transition:border-color .15s,color .15s,background .15s}
.dsh-ig-reference-add:hover{border-color:var(--ig-blue);background:rgba(47,100,245,.05);color:var(--ig-blue)}
.dsh-ig-reference-preview{position:relative;height:108px;border-radius:9px;overflow:hidden;background:#eef1f7}.dsh-ig-reference-preview img{width:100%;height:100%;object-fit:contain}.dsh-ig-reference-preview button{position:absolute;right:7px;top:7px;width:25px;height:25px;border:0;border-radius:50%;display:grid;place-items:center;background:rgba(20,28,45,.72);color:#fff;cursor:pointer}
.dsh-ig-inline-note,.dsh-ig-form-error{padding:9px 10px;border-radius:7px;font-size:10.5px;line-height:16px}.dsh-ig-inline-note{background:#fff8e7;color:#8b671c;border:1px solid #f1dfae}.dsh-ig-form-error{background:#fff1f1;color:#b63737;border:1px solid #f2caca}.dsh-ig-form-loading{height:70px;display:grid;place-items:center;color:var(--ig-blue)}
.dsh-ig-config-error{padding:14px;display:flex;flex-direction:column;align-items:center;gap:10px;background:#fff1f1;border:1px solid #f2caca;border-radius:8px;color:#b63737;font-size:11.5px;text-align:center}.dsh-ig-config-error p{margin:0;line-height:17px}.dsh-ig-config-error button{height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border:1px solid #e0a8a8;border-radius:6px;background:#fff;color:#b63737;font-size:11.5px;font-weight:600;cursor:pointer}.dsh-ig-config-error button:hover{background:#ffebeb}
.dsh-ig-generate-button{height:42px;flex:0 0 auto;border:0;border-radius:8px;background:linear-gradient(135deg,#386cf6,#2758e7);color:#fff!important;display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;font-weight:650;cursor:pointer;box-shadow:0 8px 18px rgba(47,100,245,.22);transition:transform .16s,box-shadow .16s}.dsh-ig-generate-button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 24px rgba(47,100,245,.28)}.dsh-ig-generate-button:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
.dsh-ig-generate-button.is-cancel{background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 8px 18px rgba(239,68,68,.25)}.dsh-ig-generate-button.is-cancel:hover{background:linear-gradient(135deg,#dc2626,#b91c1c);box-shadow:0 10px 24px rgba(239,68,68,.35)}
.dsh-ig-details{padding:16px;margin:0;overflow:auto}.dsh-ig-details>div{padding:12px 0;border-bottom:1px solid var(--ig-line)}.dsh-ig-details dt{font-size:10.5px;color:#8992a4;margin-bottom:5px}.dsh-ig-details dd{margin:0;font-size:11.5px;line-height:18px;word-break:break-word}.dsh-ig-details-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:220px;padding:20px;color:#929bad;font-size:11px;text-align:center}
.dsh-ig-workbench-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(3px);z-index:999;display:grid;place-items:center;padding:16px}
.dsh-ig-workbench-modal-box{width:100%;max-width:380px;background:var(--background,#fff);border-radius:12px;padding:20px;box-shadow:0 20px 48px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:14px}
.dsh-ig-workbench-modal-header{display:flex;align-items:center;gap:10px}
.dsh-ig-workbench-modal-header strong{font-size:14px;font-weight:650;color:#b91c1c}
.dsh-ig-workbench-modal-desc{font-size:12px;line-height:18px;color:#555f77;margin:0}
.dsh-ig-workbench-modal-option{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#4b5563;cursor:pointer}
.dsh-ig-workbench-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.dsh-ig-workbench-modal-actions button{height:32px;padding:0 14px;border-radius:7px;font-size:11.5px;font-weight:600;cursor:pointer}
.dsh-ig-workbench-modal-cancel{border:1px solid var(--ig-line);background:var(--background,#fff);color:#6b7280}
.dsh-ig-workbench-modal-cancel:hover{background:#f3f4f6}
.dsh-ig-workbench-modal-danger{border:0;background:#dc2626;color:#fff}
.dsh-ig-workbench-modal-danger:hover{background:#b91c1c}
@keyframes dshIgPulse{50%{transform:scale(1.06);box-shadow:0 0 0 16px rgba(47,100,245,.025)}}
.dsh-ig-workbench-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;padding:8px 18px;border-radius:10px;font-size:12.5px;font-weight:500;box-shadow:0 12px 32px rgba(0,0,0,0.3);z-index:99999;animation:dshIgFade .15s ease-out;pointer-events:none}
@keyframes dshIgFade{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@media(max-width:1120px){.dsh-ig-workbench-grid{grid-template-columns:190px minmax(360px,1fr) 300px}.dsh-ig-result-actions button span{display:none}}
@media(max-width:900px){.dsh-ig-gallery-page-body.is-workbench{height:auto;overflow:auto}.dsh-ig-workbench{height:auto;min-height:100%;overflow:visible;padding:12px}.dsh-ig-workbench-heading{height:auto;padding-bottom:12px;align-items:center}.dsh-ig-provider-quick>span{display:none}.dsh-ig-workbench-grid{height:auto;display:flex;flex:none;flex-direction:column;overflow:visible}.dsh-ig-recent-panel{height:auto;overflow:hidden;border-right:0;border-bottom:1px solid var(--ig-line)}.dsh-ig-recent-scroll{height:auto;display:flex;overflow-x:auto;overflow-y:hidden;padding:8px}.dsh-ig-recent-item{min-width:220px}.dsh-ig-canvas-column{height:auto;min-height:560px}.dsh-ig-generate-panel{height:auto;border-left:0;border-top:1px solid var(--ig-line);min-height:560px}.dsh-ig-generator-form{height:auto;overflow:visible}.dsh-ig-canvas{height:auto;min-height:360px}}
@media(max-width:560px){.dsh-ig-workbench-heading>div{display:block}.dsh-ig-workbench-heading h1{font-size:15px}.dsh-ig-provider-quick select{min-width:128px;max-width:150px}.dsh-ig-canvas{padding:12px;min-height:300px}.dsh-ig-result-strip,.dsh-ig-result-actions{align-items:flex-start;flex-direction:column}.dsh-ig-result-strip>div,.dsh-ig-result-actions>div{width:100%}.dsh-ig-result-strip button,.dsh-ig-result-actions button{flex:1;justify-content:center}.dsh-ig-result-actions button span{display:inline}.dsh-ig-field-grid{grid-template-columns:1fr}.dsh-ig-result-meta span+span:before{display:none}}
@media(prefers-reduced-motion:reduce){.dsh-ig-workbench *{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}
.dsh-ig-workspace-filter-label{height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border:1px solid var(--ig-line,rgba(0,0,0,.1));border-radius:7px;background:var(--background,#fff);font-size:11.5px;color:var(--foreground,#242f44);cursor:pointer;user-select:none;transition:border-color .15s,background .15s}
.dsh-ig-workspace-filter-label:hover{border-color:#9bb4f5;background:rgba(47,100,245,.04)}
.dsh-ig-workspace-checkbox{cursor:pointer;accent-color:#2f64f5;width:13.5px;height:13.5px;margin:0}
.dsh-ig-workspace-filter-text{font-weight:500;white-space:nowrap}
.dsh-ig-workspace-filter-badge{font-size:10px;font-weight:600;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,currentColor 7%,transparent);color:#64748b;font-variant-numeric:tabular-nums}
`;
		//#endregion
		//#region lib/types/client/image-result-node.js
		const IMAGE_RESULT_NODE_KIND = "dsh-image-result";
		/**
		* One image result row per Turn, anchored at its own tool/result position while
		* the Turn runs, then optionally re-anchored beside the final answer once the
		* Turn closes (only needed under the folding Compact transcript view).
		*/
		function createImageResultDefinition(options = {}) {
			return {
				kind: IMAGE_RESULT_NODE_KIND,
				target: "chat",
				match: (event) => {
					const turn = eventTurn(event);
					if (turn === void 0) return null;
					if (event.type === "turn/start") return {
						id: String(turn),
						role: "start"
					};
					if (event.type === "turn/end") return {
						id: String(turn),
						role: "update"
					};
					if (event.type === "assistant/message") return {
						id: String(turn),
						role: "update"
					};
					if (event.type === "tool/result" && imageResultFromMeta(event.data.meta) !== void 0) return {
						id: String(turn),
						role: "update"
					};
					return null;
				},
				start: (_context, match) => {
					const turn = eventTurn(match.event);
					if (match.event.type !== "turn/start" || turn === void 0) throw new Error("dsh-image-result start requires turn/start");
					return {
						turn,
						results: []
					};
				},
				update: (context, match) => {
					if (match.event.type === "turn/end") return {
						...context.state,
						endSeq: match.event.seq
					};
					if (match.event.type === "assistant/message") return {
						...context.state,
						answerSeq: match.event.seq
					};
					if (match.event.type !== "tool/result") return context.state;
					const result = imageResultFromMeta(match.event.data.meta);
					if (result === void 0) return context.state;
					if (context.state.results.some((candidate) => candidate.attachment.attachmentId === result.attachment.attachmentId)) return context.state;
					return {
						...context.state,
						results: [...context.state.results, {
							...result,
							seq: match.event.seq
						}]
					};
				},
				buildViewNode: (context) => {
					const state = context.state;
					const last = state?.results.at(-1);
					if (state === void 0 || last === void 0) return null;
					const location = context.matches.at(-1)?.location ?? context.start?.location ?? { kind: "unresolved" };
					return {
						key: context.key,
						kind: IMAGE_RESULT_NODE_KIND,
						id: context.id,
						target: "chat",
						anchorSeq: state.endSeq !== void 0 && compactTranscript(options) ? state.answerSeq ?? state.endSeq ?? last.seq : last.seq,
						location,
						visibility: "visible",
						data: {
							turn: state.turn,
							results: state.results.map(({ seq: _seq, ...result }) => result)
						}
					};
				}
			};
		}
		function compactTranscript(options) {
			try {
				return options.isCompactTranscript?.() ?? true;
			} catch {
				return true;
			}
		}
		/** Parse the plugin-owned durable presentation metadata from a Tool result event. */
		function imageResultFromMeta(value) {
			const meta = record(value);
			if (meta?.kind !== "dsh-image-gen") return void 0;
			const attachment = imageAttachment(meta.attachment);
			if (attachment === void 0) return void 0;
			return {
				attachment,
				prompt: stringValue(meta.prompt, "Generated Image"),
				provider: stringValue(meta.provider, "google"),
				model: stringValue(meta.model, ""),
				output: stringValue(meta.output, ""),
				...typeof meta.savedTo === "string" ? { savedTo: meta.savedTo } : {},
				...typeof meta.seed === "number" ? { seed: meta.seed } : {}
			};
		}
		function eventTurn(event) {
			const turn = event.data.turn;
			return typeof turn === "number" && Number.isSafeInteger(turn) && turn >= 0 ? turn : void 0;
		}
		function imageAttachment(value) {
			const candidate = record(value);
			if (candidate === void 0 || typeof candidate.attachmentId !== "string" || !isImageMediaType(candidate.mediaType) || !positiveInteger(candidate.bytes) || !positiveInteger(candidate.width) || !positiveInteger(candidate.height)) return void 0;
			const original = record(candidate.originalDimensions);
			if (candidate.originalDimensions !== void 0 && (original === void 0 || !positiveInteger(original.width) || !positiveInteger(original.height))) return void 0;
			return {
				attachmentId: candidate.attachmentId,
				mediaType: candidate.mediaType,
				bytes: candidate.bytes,
				width: candidate.width,
				height: candidate.height,
				...typeof candidate.name === "string" ? { name: candidate.name } : {},
				...original === void 0 ? {} : { originalDimensions: {
					width: original.width,
					height: original.height
				} }
			};
		}
		function isImageMediaType(value) {
			return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif";
		}
		function positiveInteger(value) {
			return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
		}
		function stringValue(value, fallback) {
			return typeof value === "string" ? value : fallback;
		}
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		//#endregion
		//#region lib/types/client/conversation-image-revisions.js
		const STORAGE_PREFIX = "dsh_image_gen_conversation_revisions:";
		/** Read the locally persisted replacement history for one immutable conversation image. */
		function loadConversationImageRevisionChain(originId) {
			const empty = () => ({
				originId,
				currentIndex: 0,
				revisions: []
			});
			try {
				const raw = globalThis.localStorage?.getItem(storageKey(originId));
				if (!raw) return empty();
				const value = JSON.parse(raw);
				if (!isChain(value, originId)) return empty();
				return {
					originId,
					currentIndex: Math.min(value.currentIndex, value.revisions.length),
					revisions: value.revisions
				};
			} catch {
				return empty();
			}
		}
		/** Append a generated version and make it the version shown by the conversation card. */
		function appendConversationImageRevision(originId, revision) {
			const revisions = [...loadConversationImageRevisionChain(originId).revisions.filter((item) => item.attachment.attachmentId !== revision.attachment.attachmentId), revision].slice(-20);
			const next = {
				originId,
				currentIndex: revisions.length,
				revisions
			};
			persist(next);
			return next;
		}
		/** Select an earlier or later version without altering the underlying conversation event. */
		function selectConversationImageRevision(originId, requestedIndex) {
			const current = loadConversationImageRevisionChain(originId);
			const currentIndex = Math.max(0, Math.min(Math.trunc(requestedIndex), current.revisions.length));
			const next = {
				...current,
				currentIndex
			};
			persist(next);
			return next;
		}
		function persist(chain) {
			try {
				globalThis.localStorage?.setItem(storageKey(chain.originId), JSON.stringify(chain));
			} catch {}
		}
		function storageKey(originId) {
			return `${STORAGE_PREFIX}${originId}`;
		}
		function isChain(value, originId) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const candidate = value;
			return candidate.originId === originId && typeof candidate.currentIndex === "number" && Number.isSafeInteger(candidate.currentIndex) && candidate.currentIndex >= 0 && Array.isArray(candidate.revisions) && candidate.revisions.every(isRevision);
		}
		function isRevision(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const candidate = value;
			return isAttachment(candidate.attachment) && (candidate.provider === "google" || candidate.provider === "openai" || candidate.provider === "seedream" || candidate.provider === "dashscope") && typeof candidate.prompt === "string" && typeof candidate.model === "string" && typeof candidate.output === "string" && typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) && typeof candidate.ratio === "string" && typeof candidate.quality === "string";
		}
		function isAttachment(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const candidate = value;
			return typeof candidate.attachmentId === "string" && (candidate.mediaType === "image/png" || candidate.mediaType === "image/jpeg" || candidate.mediaType === "image/webp" || candidate.mediaType === "image/gif") && typeof candidate.bytes === "number" && typeof candidate.width === "number" && typeof candidate.height === "number";
		}
		//#endregion
		//#region lib/types/client/index.js
		const KEY_REF = {
			grok: "XAI_API_KEY",
			google: "GEMINI_API_KEY",
			openai: "OPENAI_API_KEY",
			seedream: "ARK_API_KEY",
			dashscope: "DASHSCOPE_API_KEY"
		};
		const DICT = {
			zh: {
				title: "图像生成",
				description: "选择厂商并配置生图模型。",
				provider: "Provider",
				providerGoogle: "Google Gemini",
				providerOpenAI: "OpenAI / 中转站",
				providerGrok: "Grok / xAI（文生图）",
				endpointHintGrok: "xAI 官方 /v1 根地址；当前仅支持文生图。",
				providerSeedream: "字节 Seedream",
				providerDashScope: "阿里 DashScope (通义万相 / Qwen)",
				providerComfyUI: "本地 ComfyUI",
				apiKeyLabel: "{provider} API Key",
				apiKeyPlaceholder: "留空即可保留已配置的 Key",
				apiKeyHint: "安全保存为 {key}；页面不会读回明文。",
				endpoint: "接口地址",
				reset: "重置",
				resetTitle: "重置为默认官方地址",
				endpointHintGoogle: "Google 官方地址或反代端点（全路径）。",
				endpointHintOpenAI: "中转站请填其 OpenAI 兼容的 /v1 地址。",
				endpointHintSeedream: "火山方舟兼容的 /api/v3 地址。",
				endpointHintDashScope: "阿里云百炼 DashScope 官方接口地址。",
				endpointHintComfyUI: "正在运行且 DSH Host 可以访问的 ComfyUI 地址，默认使用本机 8188 端口。",
				model: "模型",
				workflow: "API Workflow 工作流",
				workflowImport: "导入 JSON 文件",
				workflowMissing: "尚未导入工作流",
				workflowImported: "已导入 {name}",
				workflowHint: "从 ComfyUI 导出 API Format JSON，在提示词输入写入 {{prompt}}，种子可用 {{seed}}；图生图工作流在 LoadImage 的 image 输入写入 {{image}}（仅一次）。可导入多个工作流，Agent 也能在调用时按名称指定。",
				workflowTooLarge: "工作流文件不能超过 5 MB。",
				workflowActiveTitle: "设为当前使用的工作流",
				workflowRemove: "删除",
				workflowPresetPlaceholder: "预设提示词，留空则只用对话内容",
				workflowPresetTitle: "预设提示词：每次调用此工作流时自动加在用户提示词前面。",
				workflowNameRequired: "工作流名称不能为空。",
				workflowDuplicateName: "工作流名称不能重复。",
				timeout: "生成超时（秒）",
				timeoutHint: "包括提交、等待和下载图片；默认 300 秒。",
				saveToWorkspace: "保存到工作区",
				saveToWorkspaceHint: "每次生成后，把图片文件保存到当前会话工作区。",
				folder: "工作区文件夹",
				folderHint: "相对当前会话工作区的子目录；留空表示工作区根目录。",
				saving: "保存中…",
				save: "保存",
				saved: "已保存",
				savedToPath: "已保存到",
				checkingKey: "正在检查 API Key…",
				keyConfigured: "已配置 API Key",
				keyNotConfigured: "尚未配置 API Key",
				generating: "正在生成图片…",
				loading: "正在加载图片…",
				loadFailed: "图片读取失败 ({status})",
				generatedTitle: "已生成图片",
				resultShown: "图片结果已显示在对话中",
				copyImg: "复制图片",
				download: "下载图片",
				openNewTab: "新标签页打开",
				copiedImage: "已复制图片",
				copyFailed: "复制失败",
				regenerate: "重新生成",
				regenerateTitle: "重新生成图片",
				regenerateHint: "如有需要可微调提示词。生成的新图片将替代当前展示，原图依然可在版本中查看。",
				prompt: "提示词",
				cancel: "取消",
				confirmRegenerate: "确认生成",
				regenerating: "重新生成中…",
				regenerateFailed: "重新生成失败",
				versionPrevious: "上一版本",
				versionNext: "下一版本",
				versionLabel: "图片版本 {current}/{total}"
			},
			en: {
				title: "Image Generation",
				description: "Select provider and configure image generation models.",
				provider: "Provider",
				providerGoogle: "Google Gemini",
				providerOpenAI: "OpenAI / Relay",
				providerGrok: "Grok / xAI (generation)",
				endpointHintGrok: "xAI /v1 base URL; currently text-to-image only.",
				providerSeedream: "ByteDance Seedream",
				providerDashScope: "Aliyun DashScope (Wanx / Qwen)",
				providerComfyUI: "Local ComfyUI",
				apiKeyLabel: "{provider} API Key",
				apiKeyPlaceholder: "Leave empty to keep configured key",
				apiKeyHint: "Securely saved as {key}; never read back in plaintext.",
				endpoint: "Endpoint / Base URL",
				reset: "Reset",
				resetTitle: "Reset to official default URL",
				endpointHintGoogle: "Official Google endpoint or reverse proxy (full path).",
				endpointHintOpenAI: "OpenAI-compatible /v1 base URL for relays.",
				endpointHintSeedream: "Volcengine Ark compatible /api/v3 base URL.",
				endpointHintDashScope: "Official Aliyun DashScope endpoint.",
				endpointHintComfyUI: "A running ComfyUI server reachable by the DSH Host; the default points to port 8188 on this computer.",
				model: "Model",
				workflow: "API Workflows",
				workflowImport: "Import JSON file",
				workflowMissing: "No workflow imported",
				workflowImported: "Imported {name}",
				workflowHint: "Export an API Format JSON from ComfyUI and place {{prompt}} in its prompt input; {{seed}} is available for a random seed. For image editing put {{image}} (exactly once) in the LoadImage image input. Import as many workflows as you need; the Agent can also pick one by name.",
				workflowTooLarge: "Workflow files must be no larger than 5 MB.",
				workflowActiveTitle: "Make this the active workflow",
				workflowRemove: "Remove",
				workflowPresetPlaceholder: "Preset prompt (optional)",
				workflowPresetTitle: "Preset prompt: automatically prepended to the user prompt on every call of this workflow.",
				workflowNameRequired: "Workflow names cannot be empty.",
				workflowDuplicateName: "Workflow names must be unique.",
				timeout: "Generation timeout (seconds)",
				timeoutHint: "Covers submission, waiting, and image download; defaults to 300 seconds.",
				saveToWorkspace: "Save to workspace",
				saveToWorkspaceHint: "Write each generated image as a file into the session workspace.",
				folder: "Workspace folder",
				folderHint: "Subdirectory of the session workspace; empty means the workspace root.",
				saving: "Saving…",
				save: "Save",
				saved: "Saved",
				savedToPath: "Saved to",
				checkingKey: "Checking API Key…",
				keyConfigured: "API Key configured",
				keyNotConfigured: "API Key not configured",
				generating: "Generating image…",
				loading: "Loading image…",
				loadFailed: "Failed to load image ({status})",
				generatedTitle: "Generated image",
				resultShown: "Image result is shown in the conversation",
				copyImg: "Copy Image",
				download: "Download Image",
				openNewTab: "Open in new tab",
				copiedImage: "Image copied",
				copyFailed: "Copy failed",
				regenerate: "Regenerate",
				regenerateTitle: "Regenerate image",
				regenerateHint: "Edit the prompt if needed. The new image replaces this view while the original remains available.",
				prompt: "Prompt",
				cancel: "Cancel",
				confirmRegenerate: "Regenerate",
				regenerating: "Regenerating…",
				regenerateFailed: "Regeneration failed",
				versionPrevious: "Previous version",
				versionNext: "Next version",
				versionLabel: "Image version {current}/{total}"
			}
		};
		const STYLE = `
.dsh-ig-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s,background .16s;overflow:hidden}
.dsh-ig-card:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-card-open{background:var(--dsw-alias-bg-layer-2,#fff);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-ig-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:-2px}
.dsh-ig-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-ig-title{display:block;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-desc{display:block;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#7b818b)}
.dsh-ig-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#7b818b);transition:transform .16s;display:inline-flex;align-items:center}
.dsh-ig-chevron-open{transform:rotate(180deg)}
.dsh-ig-body{border-top:1px solid var(--dsw-alias-border-l2,#eee);padding:0 16px 16px}
.dsh-ig-field{display:grid;gap:6px;margin-top:14px}
.dsh-ig-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-input{box-sizing:border-box;width:100%;padding:8px 12px;font-size:13px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;background:var(--dsw-alias-bg-layer-3,transparent);color:inherit;outline:none;transition:border-color .15s}
.dsh-ig-input:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff)}
.dsh-ig-input-group{display:flex;gap:8px;align-items:center}
.dsh-ig-file-row{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-ig-file-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;clip-path:inset(50%)}
.dsh-ig-file-button{appearance:none;flex:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;padding:7px 12px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font-size:13px;cursor:pointer;transition:background .15s,border-color .15s}
.dsh-ig-file-button:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-file-button:focus-within{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}
.dsh-ig-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,inherit);font-size:12px}
.dsh-ig-workflow-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.dsh-ig-workflow-row{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:8px}
.dsh-ig-workflow-main{display:flex;align-items:center;gap:8px}
.dsh-ig-workflow-active{display:inline-flex;align-items:center;cursor:pointer;flex:none}
.dsh-ig-workflow-active input[type=radio]{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0;cursor:pointer}
.dsh-ig-workflow-name{flex:1;min-width:0}
.dsh-ig-btn-reset{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;padding:7px 12px;background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}
.dsh-ig-btn-reset:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}
.dsh-ig-hint,.dsh-ig-status{margin:0;color:var(--dsw-alias-label-tertiary,#7b818b);font-size:12px;line-height:1.4}
.dsh-ig-status-error{color:var(--dsw-alias-label-error,#d33);font-weight:500}
.dsh-ig-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,#eee)}
.dsh-ig-check-row{display:flex;align-items:center;gap:8px;cursor:pointer}
.dsh-ig-check-row input[type=checkbox]{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0}
.dsh-ig-savedto{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#7b818b);word-break:break-all}
.dsh-ig-save{appearance:none;border:0;border-radius:8px;padding:6px 16px;background:var(--dsw-alias-label-primary,#111827);color:var(--dsw-alias-bg-layer-3,#fff);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .15s}
.dsh-ig-save:disabled{opacity:.4;cursor:default}

.dsh-ig-result{display:grid;gap:10px;max-width:520px}
.dsh-ig-promoted-results{display:grid;gap:16px}
.dsh-ig-result-title{font-size:14px;font-weight:600}
.dsh-ig-container{position:relative;display:inline-block;width:fit-content;max-width:100%;justify-self:start;border-radius:12px;overflow:hidden;line-height:0;isolation:isolate}
.dsh-ig-container:hover .dsh-ig-toolbar,.dsh-ig-container:focus-within .dsh-ig-toolbar{opacity:1;pointer-events:auto}
.dsh-ig-toolbar{position:absolute;top:8px;left:8px;display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:8px;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:2;line-height:1}
.dsh-ig-tool-btn{appearance:none;border:0;background:transparent;color:#fff;padding:5px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
.dsh-ig-tool-btn:hover{background:rgba(255,255,255,0.25)}
.dsh-ig-tool-btn-danger:hover{background:rgba(239,68,68,0.75)!important;color:#fff!important}
.dsh-ig-toast{position:absolute;top:100%;left:0;margin-top:5px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,0.85);color:#fff;font-size:11px;white-space:nowrap;pointer-events:none;z-index:4}
.dsh-ig-image{display:block;max-width:100%;max-height:520px;border-radius:12px;background:#f2f3f5;cursor:pointer}
.dsh-ig-version-nav{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-size:11px;line-height:1;z-index:2}
.dsh-ig-version-nav button{appearance:none;border:0;background:transparent;color:inherit;width:25px;height:25px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:17px;line-height:1}
.dsh-ig-version-nav button:hover:not(:disabled){background:rgba(255,255,255,.2)}
.dsh-ig-version-nav button:disabled{opacity:.3;cursor:default}
.dsh-ig-version-count{min-width:34px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-ig-regenerate-overlay{position:absolute;inset:0;background:rgba(15,23,42,0.52);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;z-index:3;animation:dsh-ig-fade .18s ease-out;line-height:1.4;border-radius:12px}
.dsh-ig-regenerate-spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:dsh-ig-spin .8s linear infinite}
.dsh-ig-regenerate-overlay-text{font-size:12.5px;font-weight:550;color:#fff;letter-spacing:0.2px;text-shadow:0 1px 2px rgba(0,0,0,0.4)}
.dsh-ig-regenerate-overlay-cancel{appearance:none;border:1px solid rgba(255,255,255,0.4);border-radius:6px;background:rgba(255,255,255,0.15);color:#fff;padding:3px 12px;font-size:11.5px;cursor:pointer;transition:background .15s}
.dsh-ig-regenerate-overlay-cancel:hover{background:rgba(255,255,255,0.3)}
@keyframes dsh-ig-spin{to{transform:rotate(360deg)}}
.dsh-ig-regenerate-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(11,17,29,.6);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);animation:dsh-ig-fade .15s ease-out}
.dsh-ig-regenerate-dialog{width:min(520px,100%);border:1px solid var(--dsw-alias-border-l2,#dfe3ea);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#172033);box-shadow:0 24px 72px rgba(11,17,29,.28);padding:20px;box-sizing:border-box;line-height:1.4}
.dsh-ig-regenerate-dialog h3{margin:0;font-size:16px;font-weight:650}
.dsh-ig-regenerate-dialog p{margin:7px 0 16px;color:var(--dsw-alias-label-tertiary,#737d8f);font-size:12.5px;line-height:1.55}
.dsh-ig-regenerate-dialog label{display:grid;gap:7px;font-size:12.5px;font-weight:600}
.dsh-ig-regenerate-dialog textarea{box-sizing:border-box;width:100%;min-height:132px;resize:vertical;border:1px solid var(--dsw-alias-border-l2,#d7dce5);border-radius:9px;padding:11px 12px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font:inherit;font-size:13px;line-height:1.55;outline:none}
.dsh-ig-regenerate-dialog textarea:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff);box-shadow:0 0 0 3px rgba(76,120,255,.12)}
.dsh-ig-regenerate-error{margin-top:10px!important;color:var(--dsw-alias-label-error,#d33)!important}
.dsh-ig-regenerate-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:16px}
.dsh-ig-regenerate-actions button{height:35px;padding:0 14px;border-radius:7px;font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.dsh-ig-regenerate-cancel{border:1px solid var(--dsw-alias-border-l2,#d7dce5);background:transparent;color:inherit}
.dsh-ig-regenerate-confirm{border:1px solid var(--dsw-alias-brand-primary,#3569ed);background:var(--dsw-alias-brand-primary,#3569ed);color:#fff}
.dsh-ig-regenerate-actions button:disabled{opacity:.5;cursor:default}
@media(hover:none){.dsh-ig-container .dsh-ig-toolbar{opacity:1;pointer-events:auto}}
@keyframes dsh-ig-fade{from{opacity:0}to{opacity:1}}
.dsh-ig-error{color:var(--dsw-alias-label-error,#d33);font-size:13px}
.dsh-ig-loading{color:var(--dsw-alias-label-tertiary,#7b818b);font-size:13px}

/* Native Workspace Gallery & Studio View (Renders seamlessly inside DSH Session View) */
.dsh-ig-gallery-page{width:100%;height:100%;background:var(--dsw-alias-bg-layer-1,#ffffff);display:flex;flex-direction:column;overflow:hidden;flex:1}

/* 1. Top Navigation Tab Bar */
.dsh-ig-studio-tabs-bar{display:flex;align-items:center;gap:6px;padding:6px 24px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#ffffff);flex-shrink:0}
.dsh-ig-studio-tab-btn{appearance:none;-webkit-appearance:none;border:0;background:transparent;display:inline-flex;align-items:center;gap:7px;padding:7px 14px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary,#64748b);cursor:pointer;border-radius:6px;transition:color .15s ease,background-color .15s ease}
.dsh-ig-studio-tab-btn:hover{color:var(--dsw-alias-label-primary,#0f172a);background:var(--dsw-alias-bg-layer-2,#f1f5f9)}
.dsh-ig-studio-tab-btn.is-active{color:var(--dsw-alias-brand-primary,#2563eb);font-weight:600;background:rgba(37,99,235,0.08)}

/* 2. Secondary Filter & Search Toolbar */
.dsh-ig-studio-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 24px;background:var(--dsw-alias-bg-layer-1,#ffffff);border-bottom:1px solid var(--dsw-alias-border-l2,#f1f5f9);flex-shrink:0;flex-wrap:wrap}
.dsh-ig-studio-toolbar-left{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:0}
.dsh-ig-studio-toolbar-right{display:flex;align-items:center;gap:10px;flex-shrink:0}

/* Modern Custom Select (Removes OS default arrows & ugly borders) */
.dsh-ig-studio-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;height:32px;line-height:30px;padding:0 28px 0 12px;font-size:12.5px;color:var(--dsw-alias-label-primary,#334155);background-color:var(--dsw-alias-bg-layer-2,#ffffff);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:6px;outline:none;cursor:pointer;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
.dsh-ig-studio-select:hover{border-color:var(--dsw-alias-border-l1,#cbd5e1);background-color:var(--dsw-alias-bg-layer-1,#f8fafc)}
.dsh-ig-studio-select:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px rgba(59,130,246,0.15)}
.dsh-ig-studio-select-sort{font-weight:500}

/* Unified Search Input */
.dsh-ig-studio-search-wrap{position:relative;display:flex;align-items:center;min-width:190px;max-width:320px;flex:1}
.dsh-ig-studio-search-icon{position:absolute;left:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);pointer-events:none}
.dsh-ig-studio-search-input{width:100%;height:32px;line-height:30px;padding:0 12px 0 32px;font-size:12.5px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:6px;background-color:var(--dsw-alias-bg-layer-2,#ffffff);color:inherit;outline:none;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-ig-studio-search-input:hover{border-color:var(--dsw-alias-border-l1,#cbd5e1)}
.dsh-ig-studio-search-input:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px rgba(59,130,246,0.15)}
.dsh-ig-studio-search-input::placeholder{color:var(--dsw-alias-label-tertiary,#94a3b8)}

/* 3. Grid & Responsive Cards */
.dsh-ig-gallery-page-body{flex:1;overflow-y:auto;padding:20px 24px}
.dsh-ig-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px}
.dsh-ig-gallery-card{background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.dsh-ig-gallery-card:hover{transform:translateY(-2px);box-shadow:0 10px 20px -5px rgba(0,0,0,0.06),0 4px 6px -2px rgba(0,0,0,0.03);border-color:var(--dsw-alias-border-l1,#cbd5e1)}
.dsh-ig-gallery-card-media{position:relative;width:100%;aspect-ratio:1/1;background:#f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center}
.dsh-ig-gallery-card-img{width:100%;height:100%;object-fit:cover;transition:transform .2s ease}
.dsh-ig-gallery-card:hover .dsh-ig-gallery-card-img{transform:scale(1.03)}
.dsh-ig-gallery-card-loading{font-size:12px;color:#94a3b8}
.dsh-ig-gallery-card-error{font-size:12px;color:#ef4444;padding:8px;text-align:center}

/* Floating Action Toolbar on Card Hover */
.dsh-ig-gallery-card:hover .dsh-ig-card-toolbar{opacity:1;pointer-events:auto}
.dsh-ig-card-toolbar{position:absolute;top:6px;left:6px;display:flex;align-items:center;gap:3px;padding:3px 5px;border-radius:6px;background:rgba(15,23,42,0.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:10;line-height:1}

/* Card Bottom Metadata */
.dsh-ig-gallery-card-meta{padding:10px 12px;display:flex;flex-direction:column;gap:5px;background:var(--dsw-alias-bg-layer-2,#ffffff);flex:1}
.dsh-ig-card-badge-row{display:flex;align-items:center}
.dsh-ig-card-badge{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#f1f5f9);color:var(--dsw-alias-label-secondary,#475569);font-size:11px;font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-gallery-card-prompt-line{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary,#1e293b);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ig-card-footer-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
.dsh-ig-card-meta-text{font-size:11px;color:var(--dsw-alias-label-tertiary,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-ig-card-fav-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#94a3b8);padding:2px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:color .15s,transform .15s;flex-shrink:0}
.dsh-ig-card-fav-btn:hover{color:#ef4444;transform:scale(1.15)}
.dsh-ig-card-fav-btn.is-favorited{color:#ef4444}

/* Placeholders for Upcoming Routes */
.dsh-ig-placeholder-view{display:flex;align-items:center;justify-content:center;min-height:360px;height:100%;padding:24px}
.dsh-ig-placeholder-card{max-width:500px;width:100%;text-align:center;padding:36px 28px;background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px dashed var(--dsw-alias-border-l2,#e2e8f0);border-radius:14px;display:flex;flex-direction:column;align-items:center;gap:12px}
.dsh-ig-placeholder-icon{font-size:40px;line-height:1}
.dsh-ig-placeholder-header{display:flex;align-items:center;gap:8px;justify-content:center}
.dsh-ig-placeholder-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);margin:0}
.dsh-ig-placeholder-badge{font-size:11px;font-weight:500;background:rgba(37,99,235,0.1);color:#2563eb;padding:2px 8px;border-radius:12px}
.dsh-ig-placeholder-desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#64748b);margin:0}
.dsh-ig-placeholder-tip{margin-top:6px;padding:8px 12px;font-size:12px;background:var(--dsw-alias-bg-layer-3,#f8fafc);border-radius:8px;color:var(--dsw-alias-label-tertiary,#64748b);text-align:left}

/* Empty State */
.dsh-ig-gallery-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:360px;text-align:center;color:var(--dsw-alias-label-tertiary,#94a3b8)}
.dsh-ig-gallery-empty-icon{font-size:44px;margin-bottom:10px}
.dsh-ig-gallery-empty-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);margin-bottom:4px}
.dsh-ig-gallery-empty-desc{font-size:13px;max-width:360px;line-height:1.5}

/* Pure Centered Lightbox */
.dsh-ig-lightbox-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;cursor:zoom-out;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-lightbox-topbar{position:absolute;top:20px;left:24px;right:24px;display:flex;align-items:center;justify-content:space-between;z-index:10;pointer-events:none}
.dsh-ig-lightbox-meta{display:flex;align-items:center;gap:8px;pointer-events:auto}
.dsh-ig-tag{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#edf0f3);color:var(--dsw-alias-label-secondary,inherit);font-weight:500;text-transform:uppercase;font-size:10px}
.dsh-ig-tag-model{background:rgba(76,120,255,0.1);color:#4c78ff}
.dsh-ig-lightbox-close-btn{appearance:none;border:0;background:rgba(255,255,255,0.15);color:#fff;border-radius:50%;width:34px;height:34px;font-size:16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s;pointer-events:auto}
.dsh-ig-lightbox-close-btn:hover{background:rgba(255,255,255,0.3)}
.dsh-ig-lightbox-img-wrap{max-width:86vw;max-height:78vh;display:flex;align-items:center;justify-content:center;cursor:default}
.dsh-ig-lightbox-img{max-width:100%;max-height:78vh;object-fit:contain;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,0.7);user-select:none}
.dsh-ig-lightbox-bottombar{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(90vw,640px);background:rgba(20,22,26,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:14px;padding:10px 16px;display:flex;flex-direction:column;gap:8px;color:#fff;box-shadow:0 16px 40px rgba(0,0,0,0.5);cursor:default}
.dsh-ig-lightbox-prompt-text{font-size:13px;line-height:1.4;color:rgba(255,255,255,0.92);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.dsh-ig-lightbox-counter{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.15);color:#fff;font-size:11.5px;font-weight:500;font-variant-numeric:tabular-nums}
.dsh-ig-lightbox-nav-btn{position:fixed;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.12);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background-color .15s ease,transform .15s ease,opacity .15s ease;outline:none}
.dsh-ig-lightbox-nav-btn:hover:not(:disabled){background:rgba(255,255,255,0.28);transform:translateY(-50%) scale(1.08)}
.dsh-ig-lightbox-nav-btn:disabled{opacity:0.2;cursor:not-allowed;pointer-events:none}
.dsh-ig-lightbox-nav-prev{left:24px}
.dsh-ig-lightbox-nav-next{right:24px}
.dsh-ig-lightbox-loading{display:flex;align-items:center;justify-content:center;min-width:180px;min-height:180px}
.dsh-ig-lightbox-spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:dsh-ig-spin .8s linear infinite}
@keyframes dsh-ig-spin{to{transform:rotate(360deg)}}
.dsh-ig-lightbox-btn{appearance:none;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s,color .15s}
.dsh-ig-lightbox-btn:hover{background:rgba(255,255,255,0.22)}
.dsh-ig-lightbox-btn-danger{border-color:rgba(239,68,68,0.4);color:#fca5a5}
.dsh-ig-lightbox-btn-danger:hover{background:rgba(239,68,68,0.35)!important;color:#fff!important;border-color:rgba(239,68,68,0.7)!important}
.dsh-ig-gallery-page-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:6px 14px;border-radius:8px;font-size:13px;z-index:99999;animation:dsh-ig-fade .15s}

/* Card selection and checkbox */
.dsh-ig-gallery-card.is-selected{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#2563eb);border-color:transparent}
.dsh-ig-card-checkbox{position:absolute;top:8px;left:8px;width:22px;height:22px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.7);background:rgba(0,0,0,0.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;opacity:0;transition:opacity .15s ease,background-color .15s ease,border-color .15s ease;padding:0;outline:none}
.dsh-ig-gallery-card:hover .dsh-ig-card-checkbox,.dsh-ig-gallery-card.is-manage-mode .dsh-ig-card-checkbox,.dsh-ig-card-checkbox.is-checked{opacity:1}
.dsh-ig-card-checkbox.is-checked{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb)}

/* Studio button in toolbar */
.dsh-ig-studio-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;box-sizing:border-box;border-radius:6px;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,0.12));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit);font-size:12.5px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.dsh-ig-studio-btn:hover{background:var(--dsw-alias-bg-layer-3,#f3f4f6);border-color:var(--dsw-alias-border-default,rgba(0,0,0,0.2))}
.dsh-ig-studio-btn.is-active{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);color:#fff}
.dsh-ig-studio-btn-danger{color:#ef4444;border-color:rgba(239,68,68,0.35);background:rgba(239,68,68,0.06)}
.dsh-ig-studio-btn-danger:hover{background:rgba(239,68,68,0.14);border-color:rgba(239,68,68,0.6);color:#dc2626}
.dsh-ig-studio-btn-danger.is-active{background:#dc2626;border-color:#dc2626;color:#fff}

/* Floating Batch Action Bar */
.dsh-ig-batch-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;background:rgba(20,24,32,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.18);border-radius:40px;padding:8px 16px;box-shadow:0 16px 40px rgba(0,0,0,0.5);z-index:99990;animation:dsh-ig-slide-up .2s cubic-bezier(0.16,1,0.3,1);color:#fff}
@keyframes dsh-ig-slide-up{from{transform:translate(-50%,20px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
.dsh-ig-batch-bar-left{display:flex;align-items:center;gap:10px}
.dsh-ig-batch-bar-right{display:flex;align-items:center;gap:8px;border-left:1px solid rgba(255,255,255,0.15);padding-left:12px}
.dsh-ig-batch-counter{font-size:13px;font-weight:600;color:rgba(255,255,255,0.95);margin-right:4px}
.dsh-ig-batch-btn{appearance:none;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;border-radius:20px;padding:5px 12px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .15s,border-color .15s,color .15s}
.dsh-ig-batch-btn:hover:not(:disabled){background:rgba(255,255,255,0.2)}
.dsh-ig-batch-btn:disabled{opacity:0.4;cursor:not-allowed}
.dsh-ig-batch-btn-danger{background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.5);color:#fca5a5}
.dsh-ig-batch-btn-danger:hover:not(:disabled){background:rgba(239,68,68,0.4)!important;border-color:rgba(239,68,68,0.8)!important;color:#fff!important}
.dsh-ig-batch-btn-exit{border-color:transparent;background:transparent;color:rgba(255,255,255,0.7)}
.dsh-ig-batch-btn-exit:hover{background:rgba(255,255,255,0.1);color:#fff}

/* Batch Delete Confirmation Modal */
.dsh-ig-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:100005;display:flex;align-items:center;justify-content:center;padding:16px;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-modal-box{width:100%;max-width:440px;background:var(--dsw-alias-bg-layer-1,#1c1e24);border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.12));border-radius:12px;padding:22px;box-sizing:border-box;box-shadow:0 20px 50px rgba(0,0,0,0.45);color:var(--dsw-alias-label-primary,#fff);animation:dsh-ig-scale-up .15s ease-out}
@keyframes dsh-ig-scale-up{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
.dsh-ig-modal-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
.dsh-ig-modal-icon-danger{width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,0.12);color:#ef4444;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dsh-ig-modal-title{font-size:16px;font-weight:600;line-height:1.4}
.dsh-ig-modal-body{margin-bottom:20px;padding-left:48px}
.dsh-ig-modal-desc{font-size:13.5px;color:var(--dsw-alias-label-secondary,rgba(255,255,255,0.7));margin:0 0 14px 0;line-height:1.5}
.dsh-ig-modal-checkbox-label{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;user-select:none}
.dsh-ig-modal-checkbox-label input{margin:0;cursor:pointer;width:15px;height:15px}
.dsh-ig-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px}
.dsh-ig-modal-btn{height:34px;padding:0 14px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,color .15s;outline:none}
.dsh-ig-modal-btn-cancel{background:transparent;border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.2));color:var(--dsw-alias-label-primary,inherit)}
.dsh-ig-modal-btn-cancel:hover{background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,0.08))}
.dsh-ig-modal-btn-danger{background:#dc2626;border:1px solid #dc2626;color:#fff}
.dsh-ig-modal-btn-danger:hover{background:#b91c1c;border-color:#b91c1c}
.dsh-ig-modal-btn-primary{background:linear-gradient(135deg,#3b82f6,#2563eb);border:1px solid #2563eb;color:#fff;display:inline-flex;align-items:center;gap:6px}
.dsh-ig-modal-btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#2563eb,#1d4ed8)}
.dsh-ig-modal-btn-primary:disabled{opacity:0.5;cursor:not-allowed}
.dsh-ig-regenerate-modal-box{max-width:520px}
.dsh-ig-regenerate-modal-icon{width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.15);color:#3b82f6;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dsh-ig-regenerate-modal-title-wrap{display:flex;flex-direction:column;gap:4px}
.dsh-ig-regenerate-modal-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-ig-regenerate-modal-textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,0.25));border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,0.15));border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#fff);resize:vertical;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-ig-regenerate-modal-textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,0.2)}
.dsh-ig-lightbox-btn-regenerate:hover{color:#60a5fa!important;border-color:rgba(96,165,250,0.5)!important;background:rgba(96,165,250,0.12)!important}
.dsh-ig-lightbox-generating-indicator{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;background:rgba(37,99,235,0.2);border:1px solid rgba(59,130,246,0.5);border-radius:20px;font-size:12px;color:#93c5fd;animation:dsh-ig-fade .15s ease-out}
.dsh-ig-lightbox-spinner-sm{width:12px;height:12px;border:2px solid rgba(147,197,253,0.3);border-top-color:#93c5fd;border-radius:50%;animation:dsh-ig-spin .8s linear infinite;flex-shrink:0}
.dsh-ig-lightbox-abort-btn{appearance:none;background:transparent;border:0;color:#fca5a5;font-size:11.5px;cursor:pointer;padding:0 4px;margin-left:4px;text-decoration:underline;text-underline-offset:2px}
.dsh-ig-lightbox-abort-btn:hover{color:#ef4444}

/* Hide floating chat composer and width handles when gallery page is active */
[data-conversation-scroll]:has(.dsh-ig-gallery-page) [data-composer-seat]{display:none!important}
:has(> [data-conversation-scroll]:has(.dsh-ig-gallery-page)) > [class*="widthHandle"],
:has(.dsh-ig-gallery-page) [class*="widthHandle"],
.root:has(.dsh-ig-gallery-page) [class*="widthHandle"]{display:none!important}
`;
		/** Required browser services. */
		const inject = [
			"slots",
			"connection",
			"remote",
			"settingsScope",
			"locale"
		];
		/** Mount the settings card, generated-image card, and native conversation gallery view. */
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: IMAGE_GENERATION_NAMESPACE });
			const chatScope = ctx.settingsScope.bind({ namespace: "ui-chat" });
			const isCompactTranscript = () => chatScope.getSnapshot().value?.transcriptView !== "normal";
			const locale = ctx.get("locale");
			const promotion = { enabled: false };
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-image-gen";
				style.textContent = `${STYLE}\n${STUDIO_STYLE}`;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "dsh-image-gen: styles");
			const register = ctx.slots.register.bind(ctx.slots);
			ctx.inject(["uiConversation"], (owner) => {
				const uiConversation = asModernUiConversation(owner.get("uiConversation"));
				if (uiConversation === void 0) throw new Error("dsh-image-gen: uiConversation has an incompatible interface");
				promotion.enabled = true;
				const ownerRegister = owner.slots.register.bind(owner.slots);
				owner.effect(() => uiConversation.events.register(createImageResultDefinition({ isCompactTranscript })), "dsh-image-gen: promoted image result node");
				owner.slots.inject("conversation.chat.node", () => ownerRegister({
					name: "conversation.chat.node",
					key: IMAGE_RESULT_NODE_KIND,
					inject: () => ({ locale })
				}, PromotedImageResultNode));
			});
			const injectSettingsItem = (owner, credentials) => {
				const ownerRegister = owner.slots.register.bind(owner.slots);
				owner.slots.inject("settings.plugin.item", () => ownerRegister({
					name: "settings.plugin.item",
					key: IMAGE_GENERATION_NAMESPACE,
					inject: () => ({
						scope,
						credentials,
						locale
					})
				}, ImageGenerationSettingsCard));
			};
			const remoteCredentials = asCredentialsRemote(ctx.get("remote.credentials"));
			const legacyCredentials = credentialsFromLegacyConnection(ctx.get("connection"));
			if (remoteCredentials !== void 0) injectSettingsItem(ctx, remoteCredentials);
			else if (legacyCredentials !== void 0) injectSettingsItem(ctx, legacyCredentials);
			else ctx.inject(["remote.credentials"], (remoteCtx) => {
				const credentials = asCredentialsRemote(remoteCtx.get("remote.credentials"));
				if (credentials === void 0) throw new Error("dsh-image-gen: remote.credentials has an incompatible interface");
				injectSettingsItem(remoteCtx, credentials);
			});
			ctx.slots.inject("tool.call.toolview", () => register({
				name: "tool.call.toolview",
				key: "generate_image",
				inject: () => ({
					locale,
					promoted: promotion.enabled
				})
			}, GeneratedImageCard));
			ctx.slots.inject("tool.call.toolview", () => register({
				name: "tool.call.toolview",
				key: "edit_image",
				inject: () => ({
					locale,
					promoted: promotion.enabled
				})
			}, GeneratedImageCard));
			ctx.slots.inject("conversation.view", () => register({
				name: "conversation.view",
				id: "gallery",
				order: 20,
				label: () => {
					return (locale?.getSnapshot?.()?.active)?.startsWith("en") ? "Gallery" : "画廊";
				},
				inject: () => ({ locale })
			}, GalleryViewTab));
		}
		function asModernUiConversation(value) {
			if (value === null || typeof value !== "object") return void 0;
			const events = value.events;
			if (events === null || typeof events !== "object") return void 0;
			return typeof events.register === "function" ? value : void 0;
		}
		function asCredentialsRemote(value) {
			if (value === null || typeof value !== "object") return void 0;
			const candidate = value;
			return typeof candidate.describe === "function" && typeof candidate.set === "function" ? candidate : void 0;
		}
		function credentialsFromLegacyConnection(value) {
			if (value === null || typeof value !== "object") return void 0;
			const credentials = value.api?.credentials;
			if (credentials === void 0 || typeof credentials.describe !== "function" || typeof credentials.set !== "function") return void 0;
			const legacy = credentials;
			return {
				async describe(refs) {
					const response = await legacy.describe({ refs });
					return response.result.ok ? {
						ok: true,
						value: response.result.value.credentials
					} : { ok: false };
				},
				async set(ref, credentialValue) {
					const response = await legacy.set({
						ref,
						value: credentialValue
					});
					return response.result.ok ? { ok: true } : {
						ok: false,
						error: response.result.error
					};
				}
			};
		}
		/** Edit provider settings and its write-only API credential. */
		function ImageGenerationSettingsCard(props) {
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)(() => props.scope.getSnapshot());
			const [lang, setLang] = (0, react.useState)(() => props.locale?.getSnapshot?.()?.active?.startsWith("en") ? "en" : "zh");
			const [provider, setProvider] = (0, react.useState)("google");
			const [model, setModel] = (0, react.useState)("");
			const [baseURL, setBaseURL] = (0, react.useState)("");
			const [workflows, setWorkflows] = (0, react.useState)([]);
			const [activeWorkflow, setActiveWorkflow] = (0, react.useState)("");
			const [timeoutSeconds, setTimeoutSeconds] = (0, react.useState)(DEFAULT_COMFYUI_TIMEOUT_MS / 1e3);
			const [saveToWorkspace, setSaveToWorkspace] = (0, react.useState)(true);
			const [workspaceFolder, setWorkspaceFolder] = (0, react.useState)("dsh-image-gen");
			const [key, setKey] = (0, react.useState)("");
			const [configured, setConfigured] = (0, react.useState)();
			const [saving, setSaving] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)("");
			const [messageIsError, setMessageIsError] = (0, react.useState)(false);
			const reportMessage = (text) => {
				setMessage(text);
				setMessageIsError(false);
			};
			const reportError = (text) => {
				setMessage(text);
				setMessageIsError(true);
			};
			(0, react.useEffect)(() => props.scope.subscribe(() => {
				setSnapshot(props.scope.getSnapshot());
			}), [props.scope]);
			(0, react.useEffect)(() => {
				return props.locale?.subscribe?.(() => {
					setLang(props.locale?.getSnapshot?.()?.active?.startsWith("en") ? "en" : "zh");
				});
			}, [props.locale]);
			const t = (keyName, params) => {
				let text = (lang === "en" ? DICT.en : DICT.zh)[keyName] || DICT.zh[keyName] || keyName;
				if (params) for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, v);
				return text;
			};
			const providerLabels = {
				grok: t("providerGrok"),
				google: t("providerGoogle"),
				openai: t("providerOpenAI"),
				seedream: t("providerSeedream"),
				dashscope: t("providerDashScope"),
				comfyui: t("providerComfyUI")
			};
			(0, react.useEffect)(() => {
				const value = snapshot.value;
				const next = value?.provider ?? "google";
				setProvider(next);
				setModel(modelOf(next, value));
				setBaseURL(baseURLOf(next, value));
				setWorkflows(resolveComfyUIWorkflows(value ?? {}));
				setActiveWorkflow(activeComfyUIWorkflow(value ?? {})?.name ?? "");
				setTimeoutSeconds(Math.max(1, Math.round((value?.comfyuiTimeoutMs ?? 3e5) / 1e3)));
				setSaveToWorkspace(value?.saveToWorkspace ?? true);
				setWorkspaceFolder(value?.workspaceFolder ?? "dsh-image-gen");
			}, [snapshot]);
			(0, react.useEffect)(() => {
				const keyRef = KEY_REF[provider];
				if (keyRef === void 0) {
					setConfigured(void 0);
					return;
				}
				let active = true;
				props.credentials.describe([keyRef]).then((response) => {
					if (active) setConfigured(response.ok ? response.value?.[keyRef]?.configured ?? false : void 0);
				}).catch(() => {
					if (active) setConfigured(void 0);
				});
				return () => {
					active = false;
				};
			}, [props.credentials, provider]);
			const save = async (event) => {
				event.preventDefault();
				setSaving(true);
				setMessage("");
				try {
					await props.scope.set("provider", provider);
					if (provider === "comfyui") {
						const entries = workflows.map((entry) => ({
							name: entry.name.trim(),
							json: entry.json,
							presetPrompt: (entry.presetPrompt ?? "").trim()
						}));
						for (const entry of entries) {
							if (entry.name.length === 0) throw new Error(t("workflowNameRequired"));
							validateComfyUIWorkflowJson(entry.json);
						}
						if (new Set(entries.map((entry) => entry.name)).size !== entries.length) throw new Error(t("workflowDuplicateName"));
						const activeEntry = entries.find((entry) => entry.name === activeWorkflow) ?? entries[0];
						await props.scope.set("comfyuiBaseURL", baseURL);
						await props.scope.set("comfyuiWorkflows", entries);
						await props.scope.set("comfyuiActiveWorkflow", activeEntry === void 0 ? "" : activeEntry.name);
						await props.scope.set("comfyuiWorkflowJson", activeEntry === void 0 ? "" : activeEntry.json);
						await props.scope.set("comfyuiWorkflowName", activeEntry === void 0 ? "" : activeEntry.name);
						await props.scope.set("comfyuiTimeoutMs", Math.max(1, Math.round(timeoutSeconds)) * 1e3);
					} else {
						await props.scope.set(provider === "grok" ? "grokModel" : provider === "google" ? "googleModel" : provider === "openai" ? "openaiModel" : provider === "seedream" ? "seedreamModel" : "dashscopeModel", model);
						await props.scope.set(provider === "grok" ? "grokBaseURL" : provider === "google" ? "googleEndpoint" : provider === "openai" ? "openaiBaseURL" : provider === "seedream" ? "seedreamBaseURL" : "dashscopeEndpoint", baseURL);
					}
					await props.scope.set("saveToWorkspace", saveToWorkspace);
					await props.scope.set("workspaceFolder", workspaceFolder.trim());
					if (key.trim().length > 0) {
						const keyRef = KEY_REF[provider];
						if (keyRef === void 0) throw new Error("ComfyUI does not use an API key in this version");
						const response = await props.credentials.set(keyRef, key.trim());
						if (!response.ok) throw new Error(response.error?.message ?? "Failed to save API key");
						setKey("");
						setConfigured(true);
					}
					reportMessage(t("saved"));
				} catch (cause) {
					reportError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setSaving(false);
				}
			};
			const keyStatus = configured === void 0 ? t("checkingKey") : configured ? t("keyConfigured") : t("keyNotConfigured");
			const workflowStatus = activeWorkflow.length > 0 ? t("workflowImported", { name: activeWorkflow }) : t("workflowMissing");
			const importWorkflow = async (event) => {
				const file = event.target.files?.[0];
				event.target.value = "";
				if (file === void 0) return;
				reportMessage("");
				try {
					if (file.size > 5242880) throw new Error(t("workflowTooLarge"));
					const json = await file.text();
					validateComfyUIWorkflowJson(json);
					const name = uniqueComfyUIWorkflowName(file.name, workflows.map((entry) => entry.name));
					setWorkflows((current) => [...current, {
						name,
						json
					}]);
					setActiveWorkflow((current) => current.length > 0 ? current : name);
					reportMessage(t("workflowImported", { name }));
				} catch (cause) {
					reportError(cause instanceof Error ? cause.message : String(cause));
				}
			};
			/** Renaming the active entry keeps the active selection following its new name. */
			const renameWorkflow = (index, name) => {
				const previous = workflows[index];
				setWorkflows((current) => current.map((entry, position) => position === index ? {
					...entry,
					name
				} : entry));
				if (previous !== void 0 && previous.name === activeWorkflow) setActiveWorkflow(name);
			};
			/** Removing the active entry moves the selection to the first remaining workflow. */
			const removeWorkflow = (index) => {
				const previous = workflows[index];
				const next = workflows.filter((_entry, position) => position !== index);
				setWorkflows(next);
				if (previous !== void 0 && previous.name === activeWorkflow) setActiveWorkflow(next[0]?.name ?? "");
			};
			/** Editing one entry's preset leaves the rest of the entry untouched. */
			const setWorkflowPreset = (index, presetPrompt) => {
				setWorkflows((current) => current.map((entry, position) => position === index ? {
					...entry,
					presetPrompt
				} : entry));
			};
			return (0, react_jsx_runtime.jsxs)("li", {
				className: `dsh-ig-card ${open ? "dsh-ig-card-open" : ""}`,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsh-ig-head",
					"aria-expanded": open,
					onClick: () => {
						setOpen((value) => !value);
					},
					children: [(0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-ig-head-text",
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: "dsh-ig-title",
							children: t("title")
						}), (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-ig-desc",
							children: t("description")
						})]
					}), (0, react_jsx_runtime.jsx)("span", {
						className: `dsh-ig-chevron ${open ? "dsh-ig-chevron-open" : ""}`,
						"aria-hidden": "true",
						children: (0, react_jsx_runtime.jsx)("svg", {
							width: "14",
							height: "14",
							viewBox: "0 0 16 16",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "2",
							strokeLinecap: "round",
							strokeLinejoin: "round",
							children: (0, react_jsx_runtime.jsx)("path", { d: "M4 6l4 4 4-4" })
						})
					})]
				}), open ? (0, react_jsx_runtime.jsxs)("form", {
					className: "dsh-ig-body",
					onSubmit: (event) => {
						save(event);
					},
					children: [
						(0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-ig-field",
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-label",
									children: t("provider")
								}),
								(0, react_jsx_runtime.jsxs)("select", {
									className: "dsh-ig-input",
									value: provider,
									onChange: (event) => {
										const next = event.target.value;
										setProvider(next);
										setModel(modelOf(next, snapshot.value));
										setBaseURL(baseURLOf(next, snapshot.value));
										setKey("");
									},
									children: [
										(0, react_jsx_runtime.jsx)("option", {
											value: "google",
											children: t("providerGoogle")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "openai",
											children: t("providerOpenAI")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "grok",
											children: t("providerGrok")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "seedream",
											children: t("providerSeedream")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "dashscope",
											children: t("providerDashScope")
										}),
										(0, react_jsx_runtime.jsx)("option", {
											value: "comfyui",
											children: t("providerComfyUI")
										})
									]
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-hint",
									children: providerLabels[provider]
								})
							]
						}),
						provider !== "comfyui" ? (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-ig-field",
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-label",
									children: t("apiKeyLabel", { provider: providerLabels[provider] })
								}),
								(0, react_jsx_runtime.jsx)("input", {
									className: "dsh-ig-input",
									type: "password",
									autoComplete: "off",
									value: key,
									onChange: (event) => {
										setKey(event.target.value);
									},
									placeholder: configured ? t("apiKeyPlaceholder") : ""
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-hint",
									children: t("apiKeyHint", { key: KEY_REF[provider] ?? "" })
								})
							]
						}) : null,
						(0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-ig-field",
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-label",
									children: t("endpoint")
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-input-group",
									children: [(0, react_jsx_runtime.jsx)("input", {
										className: "dsh-ig-input",
										type: "url",
										value: baseURL,
										onChange: (event) => {
											setBaseURL(event.target.value);
										},
										required: true
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-btn-reset",
										title: t("resetTitle"),
										onClick: () => {
											setBaseURL(DEFAULT_BASE_URLS[provider]);
										},
										children: t("reset")
									})]
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-hint",
									children: provider === "grok" ? t("endpointHintGrok") : provider === "google" ? t("endpointHintGoogle") : provider === "openai" ? t("endpointHintOpenAI") : provider === "seedream" ? t("endpointHintSeedream") : provider === "dashscope" ? t("endpointHintDashScope") : t("endpointHintComfyUI")
								})
							]
						}),
						provider !== "comfyui" ? (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-ig-field",
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: "dsh-ig-label",
								children: t("model")
							}), (0, react_jsx_runtime.jsx)("input", {
								className: "dsh-ig-input",
								value: model,
								onChange: (event) => {
									setModel(event.target.value);
								},
								required: true
							})]
						}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-field",
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-label",
									children: t("workflow")
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-file-row",
									children: [(0, react_jsx_runtime.jsxs)("label", {
										className: "dsh-ig-file-button",
										children: [(0, react_jsx_runtime.jsx)("input", {
											className: "dsh-ig-file-input",
											type: "file",
											accept: ".json,application/json",
											onChange: (event) => {
												importWorkflow(event);
											}
										}), t("workflowImport")]
									}), workflows.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-ig-file-name",
										children: t("workflowMissing")
									}) : null]
								}),
								workflows.length > 0 ? (0, react_jsx_runtime.jsx)("ul", {
									className: "dsh-ig-workflow-list",
									children: workflows.map((entry, index) => (0, react_jsx_runtime.jsxs)("li", {
										className: "dsh-ig-workflow-row",
										children: [(0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-ig-workflow-main",
											children: [
												(0, react_jsx_runtime.jsx)("label", {
													className: "dsh-ig-workflow-active",
													title: t("workflowActiveTitle"),
													children: (0, react_jsx_runtime.jsx)("input", {
														type: "radio",
														name: "dsh-ig-active-workflow",
														"aria-label": t("workflowActiveTitle"),
														checked: entry.name === activeWorkflow,
														onChange: () => {
															setActiveWorkflow(entry.name);
														}
													})
												}),
												(0, react_jsx_runtime.jsx)("input", {
													className: "dsh-ig-input dsh-ig-workflow-name",
													value: entry.name,
													title: entry.name,
													onChange: (event) => {
														renameWorkflow(index, event.target.value);
													}
												}),
												(0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dsh-ig-btn-reset",
													onClick: () => {
														removeWorkflow(index);
													},
													children: t("workflowRemove")
												})
											]
										}), (0, react_jsx_runtime.jsx)("input", {
											className: "dsh-ig-input dsh-ig-workflow-preset",
											value: entry.presetPrompt ?? "",
											placeholder: t("workflowPresetPlaceholder"),
											title: t("workflowPresetTitle"),
											onChange: (event) => {
												setWorkflowPreset(index, event.target.value);
											}
										})]
									}, String(index)))
								}) : null,
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-hint",
									children: t("workflowHint")
								})
							]
						}), (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-ig-field",
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-label",
									children: t("timeout")
								}),
								(0, react_jsx_runtime.jsx)("input", {
									className: "dsh-ig-input",
									type: "number",
									min: "1",
									max: "3600",
									step: "1",
									value: timeoutSeconds,
									onChange: (event) => {
										setTimeoutSeconds(Number(event.target.value));
									},
									required: true
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-hint",
									children: t("timeoutHint")
								})
							]
						})] }),
						(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-field",
							children: [(0, react_jsx_runtime.jsxs)("label", {
								className: "dsh-ig-check-row",
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: saveToWorkspace,
									onChange: (event) => {
										setSaveToWorkspace(event.target.checked);
									}
								}), (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-label",
									children: t("saveToWorkspace")
								})]
							}), (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-ig-hint",
								children: t("saveToWorkspaceHint")
							})]
						}),
						saveToWorkspace ? (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-ig-field",
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-label",
									children: t("folder")
								}),
								(0, react_jsx_runtime.jsx)("input", {
									className: "dsh-ig-input",
									value: workspaceFolder,
									onChange: (event) => {
										setWorkspaceFolder(event.target.value);
									},
									placeholder: "dsh-image-gen"
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: "dsh-ig-hint",
									children: t("folderHint")
								})
							]
						}) : null,
						(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-actions",
							children: [(0, react_jsx_runtime.jsx)("p", {
								className: `dsh-ig-status${messageIsError ? " dsh-ig-status-error" : ""}`,
								role: "status",
								children: message || (provider === "comfyui" ? workflowStatus : keyStatus)
							}), (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-ig-save",
								type: "submit",
								disabled: saving || !snapshot.writable || provider === "comfyui" && workflows.length === 0,
								children: saving ? t("saving") : t("save")
							})]
						})
					]
				}) : null]
			});
		}
		/** Keep the legacy Tool row for old DSH and hand modern results to the independent Chat node. */
		function GeneratedImageCard(props) {
			const result = imageResultFromBlock(props.block);
			if (props.promoted && result !== void 0) return (0, react_jsx_runtime.jsx)(PromotedResultNotice, { locale: props.locale });
			return (0, react_jsx_runtime.jsx)(ImageResultCard, {
				result,
				locale: props.locale,
				sessionId: props.sessionId
			});
		}
		/** Render modern image artifacts as final conversation output instead of Tool process content. */
		function PromotedImageResultNode(props) {
			return (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-ig-promoted-results",
				children: props.node.data.results.map((result) => (0, react_jsx_runtime.jsx)(ImageResultCard, {
					result,
					locale: props.locale,
					sessionId: props.sessionId
				}, result.attachment.attachmentId))
			});
		}
		function PromotedResultNotice({ locale }) {
			const lang = usePluginLanguage(locale);
			return (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-ig-loading",
				children: DICT[lang].resultShown
			});
		}
		function ImageResultCard({ result, locale, sessionId }) {
			const attachment = result?.attachment;
			const originId = attachment?.attachmentId;
			const [revisionChain, setRevisionChain] = (0, react.useState)(() => loadConversationImageRevisionChain(String(originId ?? "")));
			const selectedRevision = revisionChain.revisions[revisionChain.currentIndex - 1];
			const activeAttachment = selectedRevision?.attachment ?? attachment;
			const activeResult = selectedRevision !== void 0 ? {
				prompt: selectedRevision.prompt,
				provider: selectedRevision.provider,
				model: selectedRevision.model,
				output: selectedRevision.output,
				createdAt: selectedRevision.createdAt
			} : result;
			const savedTo = result?.savedTo;
			const [url, setUrl] = (0, react.useState)();
			const [blob, setBlob] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			const [previewOpen, setPreviewOpen] = (0, react.useState)(false);
			const [toast, setToast] = (0, react.useState)();
			const [regenerateOpen, setRegenerateOpen] = (0, react.useState)(false);
			const [regeneratePrompt, setRegeneratePrompt] = (0, react.useState)("");
			const [regenerateError, setRegenerateError] = (0, react.useState)();
			const [isRegenerating, setIsRegenerating] = (0, react.useState)(false);
			const regenerateControllerRef = (0, react.useRef)();
			const regenerateTextareaRef = (0, react.useRef)(null);
			const lang = usePluginLanguage(locale);
			const t = (keyName, params) => {
				let text = (lang === "en" ? DICT.en : DICT.zh)[keyName] || DICT.zh[keyName] || keyName;
				if (params) for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, v);
				return text;
			};
			(0, react.useEffect)(() => {
				if (result === void 0) return;
				saveGalleryItem({
					id: result.attachment.attachmentId,
					attachment: result.attachment,
					prompt: result.prompt,
					provider: result.provider,
					model: result.model,
					output: result.output,
					...result.savedTo ? { savedTo: result.savedTo } : {},
					...result.seed !== void 0 ? { seed: result.seed } : {},
					...sessionId ? { sessionId } : {}
				});
			}, [result?.attachment.attachmentId]);
			(0, react.useEffect)(() => {
				if (!originId) return;
				regenerateControllerRef.current?.abort();
				regenerateControllerRef.current = void 0;
				setIsRegenerating(false);
				setRegenerateOpen(false);
				setRevisionChain(loadConversationImageRevisionChain(String(originId)));
			}, [originId]);
			(0, react.useEffect)(() => () => {
				regenerateControllerRef.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (!regenerateOpen || isRegenerating) return;
				const frame = requestAnimationFrame(() => {
					regenerateTextareaRef.current?.focus();
					regenerateTextareaRef.current?.select();
				});
				const onKeyDown = (event) => {
					if (event.key === "Escape") setRegenerateOpen(false);
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					cancelAnimationFrame(frame);
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [regenerateOpen, isRegenerating]);
			(0, react.useEffect)(() => {
				if (!previewOpen) return;
				const onKeyDown = (e) => {
					if (e.key === "Escape") setPreviewOpen(false);
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [previewOpen]);
			const currentUrlRef = (0, react.useRef)();
			(0, react.useEffect)(() => {
				return () => {
					if (currentUrlRef.current !== void 0) {
						URL.revokeObjectURL(currentUrlRef.current);
						currentUrlRef.current = void 0;
					}
				};
			}, []);
			(0, react.useEffect)(() => {
				if (activeAttachment === void 0) return;
				let canceled = false;
				fetchAttachmentBlob(activeAttachment).then((resBlob) => {
					if (canceled) return;
					setBlob(resBlob);
					setError(void 0);
					const nextUrl = URL.createObjectURL(resBlob);
					if (currentUrlRef.current !== void 0) URL.revokeObjectURL(currentUrlRef.current);
					currentUrlRef.current = nextUrl;
					setUrl(nextUrl);
				}).catch((cause) => {
					if (canceled) return;
					setError(cause instanceof Error ? cause.message : String(cause));
				});
				return () => {
					canceled = true;
				};
			}, [activeAttachment?.attachmentId]);
			const copy = async (e) => {
				e.stopPropagation();
				if (!blob) return;
				const ok = await copyImageBlob(blob);
				setToast(ok ? t("copiedImage") : t("copyFailed"));
				setTimeout(() => {
					setToast(void 0);
				}, 2e3);
			};
			const download = (e) => {
				e.stopPropagation();
				if (!url) return;
				const a = document.createElement("a");
				a.href = url;
				a.download = activeAttachment?.name || `dsh-image-${Date.now()}.png`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
			};
			const openNewTab = (e) => {
				e.stopPropagation();
				if (!url) return;
				window.open(url, "_blank", "noopener,noreferrer");
			};
			const openRegenerate = (event) => {
				event.stopPropagation();
				if (activeResult === void 0 || isRegenerating) return;
				setRegeneratePrompt(activeResult.prompt);
				setRegenerateError(void 0);
				setRegenerateOpen(true);
			};
			const cancelRegenerate = () => {
				regenerateControllerRef.current?.abort();
				regenerateControllerRef.current = void 0;
				setIsRegenerating(false);
				setRegenerateOpen(false);
				setRegenerateError(void 0);
			};
			const regenerate = async () => {
				if (activeResult === void 0 || !originId || isRegenerating || regeneratePrompt.trim().length === 0) return;
				setIsRegenerating(true);
				setRegenerateError(void 0);
				setRegenerateOpen(false);
				const controller = new AbortController();
				regenerateControllerRef.current = controller;
				try {
					const request = conversationRegenerateRequest(activeResult, regeneratePrompt, selectedRevision === void 0 ? void 0 : {
						ratio: selectedRevision.ratio,
						quality: selectedRevision.quality
					});
					const response = await fetch(STUDIO_ROUTE, {
						method: "POST",
						credentials: "same-origin",
						signal: controller.signal,
						headers: { "content-type": "application/json" },
						body: JSON.stringify(request)
					});
					const payload = await response.json().catch(() => null);
					if (!response.ok || payload === null || !("attachment" in payload)) throw new Error(payload && "error" in payload && payload.error ? payload.error : t("regenerateFailed"));
					const revision = {
						attachment: payload.attachment,
						prompt: payload.prompt,
						provider: payload.provider,
						model: payload.model,
						output: payload.output,
						createdAt: payload.createdAt,
						ratio: request.ratio,
						quality: request.quality
					};
					await saveGalleryItem({
						id: String(revision.attachment.attachmentId),
						attachment: revision.attachment,
						prompt: revision.prompt,
						provider: revision.provider,
						model: revision.model,
						createdAt: revision.createdAt,
						aspectRatio: revision.ratio,
						imageSize: revision.quality,
						output: revision.output,
						...savedTo ? { savedTo } : {},
						...sessionId ? { sessionId } : {}
					});
					const next = appendConversationImageRevision(String(originId), revision);
					setRevisionChain(next);
					setToast(t("regenerate"));
					setTimeout(() => {
						setToast(void 0);
					}, 2e3);
				} catch (cause) {
					if (!controller.signal.aborted) {
						const errMsg = cause instanceof Error ? cause.message : String(cause);
						setError(errMsg);
						setToast(errMsg);
						setTimeout(() => {
							setToast(void 0);
						}, 3500);
					}
				} finally {
					if (regenerateControllerRef.current === controller) {
						regenerateControllerRef.current = void 0;
						setIsRegenerating(false);
					}
				}
			};
			const selectVersion = (index) => {
				if (!originId || isRegenerating) return;
				setRevisionChain(selectConversationImageRevision(String(originId), index));
			};
			const canRegenerate = activeResult !== void 0 && CLOUD_IMAGE_PROVIDERS.includes(activeResult.provider) && activeResult.model.trim().length > 0;
			const versionTotal = revisionChain.revisions.length + 1;
			const versionCurrent = revisionChain.currentIndex + 1;
			if (attachment === void 0) return (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-ig-loading",
				children: t("generating")
			});
			return (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-ig-result",
				"aria-label": t("generatedTitle"),
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-result-title",
						children: t("generatedTitle")
					}),
					savedTo !== void 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-ig-savedto",
						children: [
							t("savedToPath"),
							": ",
							savedTo
						]
					}) : null,
					error !== void 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-error",
						children: error
					}) : null,
					url === void 0 && error === void 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-loading",
						children: t("loading")
					}) : null,
					url !== void 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-ig-container",
						children: [
							(0, react_jsx_runtime.jsx)("img", {
								className: "dsh-ig-image",
								src: url,
								alt: activeAttachment?.name ?? "Generated image",
								onClick: () => {
									if (!isRegenerating) setPreviewOpen(true);
								}
							}),
							isRegenerating ? (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-ig-regenerate-overlay",
								children: [
									(0, react_jsx_runtime.jsx)("div", { className: "dsh-ig-regenerate-spinner" }),
									(0, react_jsx_runtime.jsx)("span", {
										className: "dsh-ig-regenerate-overlay-text",
										children: t("regenerating")
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-regenerate-overlay-cancel",
										onClick: cancelRegenerate,
										children: t("cancel")
									})
								]
							}) : null,
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-ig-toolbar",
								children: [
									canRegenerate ? (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-tool-btn",
										disabled: isRegenerating,
										title: isRegenerating ? t("regenerating") : t("regenerate"),
										onClick: openRegenerate,
										children: (0, react_jsx_runtime.jsxs)("svg", {
											width: "15",
											height: "15",
											viewBox: "0 0 24 24",
											fill: "none",
											stroke: "currentColor",
											strokeWidth: "2",
											strokeLinecap: "round",
											strokeLinejoin: "round",
											children: [(0, react_jsx_runtime.jsx)("path", { d: "M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" }), (0, react_jsx_runtime.jsx)("path", { d: "M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" })]
										})
									}) : null,
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-tool-btn",
										title: t("copyImg"),
										onClick: (e) => {
											copy(e);
										},
										children: (0, react_jsx_runtime.jsxs)("svg", {
											width: "15",
											height: "15",
											viewBox: "0 0 24 24",
											fill: "none",
											stroke: "currentColor",
											strokeWidth: "2",
											strokeLinecap: "round",
											strokeLinejoin: "round",
											children: [(0, react_jsx_runtime.jsx)("rect", {
												x: "9",
												y: "9",
												width: "13",
												height: "13",
												rx: "2",
												ry: "2"
											}), (0, react_jsx_runtime.jsx)("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" })]
										})
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-tool-btn",
										title: t("download"),
										onClick: download,
										children: (0, react_jsx_runtime.jsxs)("svg", {
											width: "15",
											height: "15",
											viewBox: "0 0 24 24",
											fill: "none",
											stroke: "currentColor",
											strokeWidth: "2",
											strokeLinecap: "round",
											strokeLinejoin: "round",
											children: [
												(0, react_jsx_runtime.jsx)("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }),
												(0, react_jsx_runtime.jsx)("polyline", { points: "7 10 12 15 17 10" }),
												(0, react_jsx_runtime.jsx)("line", {
													x1: "12",
													y1: "15",
													x2: "12",
													y2: "3"
												})
											]
										})
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-tool-btn",
										title: t("openNewTab"),
										onClick: openNewTab,
										children: (0, react_jsx_runtime.jsxs)("svg", {
											width: "15",
											height: "15",
											viewBox: "0 0 24 24",
											fill: "none",
											stroke: "currentColor",
											strokeWidth: "2",
											strokeLinecap: "round",
											strokeLinejoin: "round",
											children: [
												(0, react_jsx_runtime.jsx)("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }),
												(0, react_jsx_runtime.jsx)("polyline", { points: "15 3 21 3 21 9" }),
												(0, react_jsx_runtime.jsx)("line", {
													x1: "10",
													y1: "14",
													x2: "21",
													y2: "3"
												})
											]
										})
									}),
									toast ? (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-ig-toast",
										children: toast
									}) : null
								]
							}),
							versionTotal > 1 ? (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-ig-version-nav",
								"aria-label": t("versionLabel", {
									current: String(versionCurrent),
									total: String(versionTotal)
								}),
								children: [
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: t("versionPrevious"),
										disabled: revisionChain.currentIndex === 0 || isRegenerating,
										onClick: (event) => {
											event.stopPropagation();
											selectVersion(revisionChain.currentIndex - 1);
										},
										children: "‹"
									}),
									(0, react_jsx_runtime.jsxs)("span", {
										className: "dsh-ig-version-count",
										children: [
											versionCurrent,
											"/",
											versionTotal
										]
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: t("versionNext"),
										disabled: revisionChain.currentIndex >= revisionChain.revisions.length || isRegenerating,
										onClick: (event) => {
											event.stopPropagation();
											selectVersion(revisionChain.currentIndex + 1);
										},
										children: "›"
									})
								]
							}) : null
						]
					}) : null,
					previewOpen && url !== void 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-lightbox-backdrop",
						onClick: () => {
							setPreviewOpen(false);
						},
						children: (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-ig-lightbox-img-wrap",
							onClick: (e) => {
								e.stopPropagation();
							},
							children: (0, react_jsx_runtime.jsx)("img", {
								className: "dsh-ig-lightbox-img",
								src: url,
								alt: activeAttachment?.name ?? "Generated image preview"
							})
						})
					}) : null,
					regenerateOpen && activeResult !== void 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-ig-regenerate-backdrop",
						onMouseDown: (event) => {
							if (event.target === event.currentTarget && !isRegenerating) setRegenerateOpen(false);
						},
						children: (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-ig-regenerate-dialog",
							role: "dialog",
							"aria-modal": "true",
							"aria-labelledby": `dsh-ig-regenerate-${String(originId)}`,
							children: [
								(0, react_jsx_runtime.jsx)("h3", {
									id: `dsh-ig-regenerate-${String(originId)}`,
									children: t("regenerateTitle")
								}),
								(0, react_jsx_runtime.jsx)("p", { children: t("regenerateHint") }),
								(0, react_jsx_runtime.jsxs)("label", { children: [(0, react_jsx_runtime.jsx)("span", { children: t("prompt") }), (0, react_jsx_runtime.jsx)("textarea", {
									ref: regenerateTextareaRef,
									value: regeneratePrompt,
									maxLength: 2e3,
									disabled: isRegenerating,
									onChange: (event) => setRegeneratePrompt(event.target.value),
									onKeyDown: (event) => {
										if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
											event.preventDefault();
											regenerate();
										}
									}
								})] }),
								regenerateError ? (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-ig-regenerate-error",
									role: "alert",
									children: regenerateError
								}) : null,
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-ig-regenerate-actions",
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-regenerate-cancel",
										onClick: cancelRegenerate,
										children: t("cancel")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-ig-regenerate-confirm",
										disabled: isRegenerating || regeneratePrompt.trim().length === 0,
										onClick: () => {
											regenerate();
										},
										children: t("confirmRegenerate")
									})]
								})
							]
						})
					}) : null
				]
			});
		}
		function usePluginLanguage(locale) {
			const [lang, setLang] = (0, react.useState)(() => locale?.getSnapshot?.()?.active?.startsWith("en") ? "en" : "zh");
			(0, react.useEffect)(() => locale?.subscribe?.(() => {
				setLang(locale?.getSnapshot?.()?.active?.startsWith("en") ? "en" : "zh");
			}), [locale]);
			return lang;
		}
		function imageResultFromBlock(block) {
			const attachment = imageRef(block);
			if (attachment === void 0) return void 0;
			const blockValue = block;
			const meta = blockValue.meta ?? blockValue.resultView?.meta;
			return {
				attachment,
				prompt: typeof meta?.prompt === "string" ? meta.prompt : blockValue.call?.args?.prompt ?? "Generated Image",
				provider: typeof meta?.provider === "string" ? meta.provider : "google",
				model: typeof meta?.model === "string" ? meta.model : "",
				output: typeof meta?.output === "string" ? meta.output : "",
				...typeof meta?.savedTo === "string" ? { savedTo: meta.savedTo } : {},
				...typeof meta?.seed === "number" ? { seed: meta.seed } : {}
			};
		}
		function modelOf(provider, value) {
			const stored = provider === "grok" ? value?.grokModel : provider === "google" ? value?.googleModel : provider === "openai" ? value?.openaiModel : provider === "seedream" ? value?.seedreamModel : provider === "dashscope" ? value?.dashscopeModel : activeComfyUIWorkflow(value ?? {})?.name;
			return typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_MODELS[provider];
		}
		function baseURLOf(provider, value) {
			const stored = provider === "grok" ? value?.grokBaseURL : provider === "google" ? value?.googleEndpoint : provider === "openai" ? value?.openaiBaseURL : provider === "seedream" ? value?.seedreamBaseURL : provider === "dashscope" ? value?.dashscopeEndpoint : value?.comfyuiBaseURL;
			return typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_BASE_URLS[provider];
		}
		//#endregion
		exports.GeneratedImageCard = GeneratedImageCard;
		exports.ImageGenerationSettingsCard = ImageGenerationSettingsCard;
		exports.PromotedImageResultNode = PromotedImageResultNode;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map