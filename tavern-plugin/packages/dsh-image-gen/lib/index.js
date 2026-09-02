import { credentialRef } from "@deepseek-ai/dsh-credentials";
import * as dshSettings from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
//#region lib/types/shared.js
/** Browser route used by the generated-image card. */
const IMAGE_ROUTE = "/plugins/dsh-image-gen/image";
/** Browser route used for deleting generated images and workspace files. */
const DELETE_ROUTE = "/plugins/dsh-image-gen/delete";
/** Same-origin route used by the browser image workbench. */
const STUDIO_ROUTE = "/plugins/dsh-image-gen/studio";
/** Namespace persisted through DSH Settings. */
const IMAGE_GENERATION_NAMESPACE = "image-generation";
/** Supported providers. */
const IMAGE_PROVIDERS = [
	"google",
	"openai",
	"seedream",
	"dashscope",
	"grok",
	"comfyui"
];
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
/**
* Combine a workflow's preset with the user prompt: preset first, user second,
* joined by one comma — never doubled when the preset already ends in a
* separator, and reduced to the non-empty side when the other is blank.
*/
function mergeComfyUIPrompt(preset, user) {
	const presetText = typeof preset === "string" ? preset.trim().replace(/[,;\s]+$/, "") : "";
	const userText = user.trim();
	if (presetText.length === 0) return userText;
	if (userText.length === 0) return presetText;
	return `${presetText}, ${userText}`;
}
//#endregion
//#region lib/types/config.js
/** User-facing configuration for supported image providers. */
/** Default workspace subfolder that receives generated image files. */
const DEFAULT_WORKSPACE_FOLDER = "dsh-image-gen";
/** Google API credential reference. */
const GOOGLE_API_KEY_ENV = "GEMINI_API_KEY";
/** OpenAI Platform or compatible relay credential reference. */
const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
/** xAI image generation credential; separate from other providers. */
const GROK_API_KEY_ENV = "XAI_API_KEY";
/** Volcengine Ark credential reference. */
const SEEDREAM_API_KEY_ENV = "ARK_API_KEY";
/** DashScope credential reference. */
const DASHSCOPE_API_KEY_ENV = "DASHSCOPE_API_KEY";
/** Google tool-level controls. */
const ASPECT_RATIOS = [
	"1:1",
	"3:2",
	"2:3",
	"4:3",
	"3:4",
	"16:9",
	"9:16"
];
const IMAGE_SIZES = [
	"1K",
	"2K",
	"4K"
];
/** Cordis configuration schema. */
const Config = z.object({
	registerAgentTools: z.boolean().default(true),
	tavernChannels: z.string().default("{}"),
	provider: z.union(IMAGE_PROVIDERS).default("google"),
	grokBaseURL: z.string().default(DEFAULT_GROK_BASE_URL),
	grokModel: z.string().default(DEFAULT_GROK_MODEL),
	googleModel: z.string().default(DEFAULT_GOOGLE_MODEL),
	googleEndpoint: z.string().default(DEFAULT_GOOGLE_ENDPOINT),
	openaiBaseURL: z.string().default(DEFAULT_OPENAI_BASE_URL),
	openaiModel: z.string().default(DEFAULT_OPENAI_MODEL),
	seedreamBaseURL: z.string().default(DEFAULT_SEEDREAM_BASE_URL),
	seedreamModel: z.string().default(DEFAULT_SEEDREAM_MODEL),
	dashscopeEndpoint: z.string().default(DEFAULT_DASHSCOPE_ENDPOINT),
	dashscopeModel: z.string().default(DEFAULT_DASHSCOPE_MODEL),
	comfyuiBaseURL: z.string().default(DEFAULT_COMFYUI_BASE_URL),
	comfyuiWorkflows: z.array(z.object({
		name: z.string(),
		json: z.string(),
		presetPrompt: z.string().default("")
	})).default([]),
	comfyuiActiveWorkflow: z.string().default(""),
	comfyuiWorkflowJson: z.string().default(""),
	comfyuiWorkflowName: z.string().default(""),
	comfyuiTimeoutMs: z.number().min(1e3).max(36e5).default(DEFAULT_COMFYUI_TIMEOUT_MS),
	saveToWorkspace: z.boolean().default(true),
	workspaceFolder: z.string().default(DEFAULT_WORKSPACE_FOLDER)
});
/** Resolve exactly one provider profile for a tool call. */
function resolveProvider(config) {
	switch (config.provider ?? "google") {
		case "grok": return {
			provider: "grok",
			apiKeyEnv: GROK_API_KEY_ENV,
			model: config.grokModel ?? "grok-imagine-image-2.0",
			baseURL: config.grokBaseURL ?? "https://api.x.ai/v1",
			imageSize: "1k"
		};
		case "openai": return {
			provider: "openai",
			apiKeyEnv: OPENAI_API_KEY_ENV,
			model: config.openaiModel ?? "gpt-image-2",
			baseURL: config.openaiBaseURL ?? "https://api.openai.com/v1",
			imageSize: "1024x1024"
		};
		case "seedream": return {
			provider: "seedream",
			apiKeyEnv: SEEDREAM_API_KEY_ENV,
			model: config.seedreamModel ?? "doubao-seedream-5-0-260128",
			baseURL: config.seedreamBaseURL ?? "https://ark.cn-beijing.volces.com/api/v3",
			imageSize: "2K"
		};
		case "dashscope": return {
			provider: "dashscope",
			apiKeyEnv: DASHSCOPE_API_KEY_ENV,
			model: config.dashscopeModel ?? "qwen-image-3.0",
			endpoint: config.dashscopeEndpoint ?? "https://dashscope.aliyuncs.com/api/v1",
			imageSize: "1024*1024"
		};
		case "comfyui": {
			const workflows = resolveComfyUIWorkflows(config);
			const workflow = activeComfyUIWorkflow(config);
			return {
				provider: "comfyui",
				baseURL: config.comfyuiBaseURL ?? "http://127.0.0.1:8188",
				workflows,
				...workflow === void 0 ? {} : { workflow },
				timeoutMs: config.comfyuiTimeoutMs ?? 3e5
			};
		}
		case "google": return {
			provider: "google",
			apiKeyEnv: GOOGLE_API_KEY_ENV,
			model: config.googleModel ?? "gemini-3.1-flash-image",
			endpoint: config.googleEndpoint ?? "https://generativelanguage.googleapis.com/v1beta/interactions",
			aspectRatio: "1:1",
			imageSize: "1K"
		};
	}
}
/** The workflow a ComfyUI call runs: the requested name when given, else the active one. */
function selectComfyUIWorkflow(active, requested) {
	if (active.workflow === void 0) throw new Error("ComfyUI image generation requires an imported workflow; import one in Settings > Plugins > Image generation.");
	if (typeof requested !== "string" || requested.trim().length === 0) return active.workflow;
	const name = requested.trim();
	const workflow = active.workflows.find((candidate) => candidate.name === name);
	if (workflow === void 0) throw new Error(`No ComfyUI workflow named "${name}" is configured. Available workflows: ${active.workflows.map((entry) => entry.name).join(", ")}.`);
	return workflow;
}
//#endregion
//#region lib/types/comfyui-workflow.js
/** Pure ComfyUI API-workflow validation and placeholder injection. */
const COMFYUI_PROMPT_PLACEHOLDER = "{{prompt}}";
const COMFYUI_SEED_PLACEHOLDER = "{{seed}}";
const COMFYUI_IMAGE_PLACEHOLDER = "{{image}}";
/** Legacy single-percent placeholders from early releases, still accepted. */
const LEGACY_PROMPT_PLACEHOLDER = "%prompt%";
const LEGACY_SEED_PLACEHOLDER = "%seed%";
const LEGACY_IMAGE_PLACEHOLDER = "%image%";
/** LoadImage-style input key that receives the uploaded source image name. */
const IMAGE_INPUT_KEY = "image";
/**
* Parse, clone, and inject one prompt plus an optional randomized seed.
*
* Prompt and seed placeholders are replaced inside any string so existing
* workflows that embed them in longer text keep working. The image
* placeholder is stricter: it only matches a dedicated `inputs.image` field
* whose value is exactly the placeholder, and at most one may exist, because
* the field must carry a single uploaded file name.
*/
function prepareComfyUIWorkflow(workflowJson, prompt, seed = randomSeed(), image) {
	const workflow = parseWorkflow(workflowJson);
	let promptReplacements = 0;
	const inject = (value) => {
		if (typeof value === "string") {
			let replaced = value;
			if (replaced.includes("{{prompt}}") || replaced.includes(LEGACY_PROMPT_PLACEHOLDER)) {
				promptReplacements += 1;
				replaced = replaced.replaceAll(COMFYUI_PROMPT_PLACEHOLDER, prompt).replaceAll(LEGACY_PROMPT_PLACEHOLDER, prompt);
			}
			if (replaced === "{{seed}}" || replaced === LEGACY_SEED_PLACEHOLDER) return seed;
			if (replaced.includes("{{seed}}") || replaced.includes(LEGACY_SEED_PLACEHOLDER)) replaced = replaced.replaceAll(COMFYUI_SEED_PLACEHOLDER, String(seed)).replaceAll(LEGACY_SEED_PLACEHOLDER, String(seed));
			return replaced;
		}
		if (Array.isArray(value)) return value.map(inject);
		if (!isRecord(value)) return value;
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inject(child)]));
	};
	let imageInputs = 0;
	const prepared = Object.fromEntries(Object.entries(workflow).map(([nodeId, value]) => {
		const node = record$5(value);
		const inputs = node === void 0 ? void 0 : record$5(node.inputs);
		if (inputs === void 0) return [nodeId, value];
		const nextInputs = inject(inputs);
		if (isImagePlaceholder(nextInputs[IMAGE_INPUT_KEY])) {
			imageInputs += 1;
			if (image !== void 0) nextInputs[IMAGE_INPUT_KEY] = image;
		}
		return [nodeId, {
			...node,
			inputs: nextInputs
		}];
	}));
	if (promptReplacements === 0) throw new Error(`ComfyUI workflow must contain ${COMFYUI_PROMPT_PLACEHOLDER} in a text input`);
	if (image === void 0) {
		if (imageInputs > 0) throw new Error(`ComfyUI workflow contains an ${COMFYUI_IMAGE_PLACEHOLDER} image input, which requires edit_image with a source image`);
		return prepared;
	}
	if (imageInputs === 0) throw new Error(`ComfyUI workflow must contain exactly one ${COMFYUI_IMAGE_PLACEHOLDER} image input to edit images`);
	if (imageInputs > 1) throw new Error(`ComfyUI workflow must contain exactly one ${COMFYUI_IMAGE_PLACEHOLDER} image input; found ${String(imageInputs)}`);
	return prepared;
}
/** Random seed in the 32-bit range ComfyUI samplers accept. */
function randomSeed() {
	return Math.floor(Math.random() * 4294967296);
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
		const inputs = record$5(node)?.inputs;
		return inputs !== void 0 && containsPromptPlaceholder(inputs);
	})) throw new Error(`ComfyUI workflow must contain ${COMFYUI_PROMPT_PLACEHOLDER} (or ${LEGACY_PROMPT_PLACEHOLDER}) in a text input`);
	return value;
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
function record$5(value) {
	return isRecord(value) ? value : void 0;
}
//#endregion
//#region lib/types/comfyui.js
const ERROR_LIMIT$3 = 4096;
const POLL_INTERVAL_MS = 500;
const MAX_HISTORY_BYTES = 16777216;
/** Run one ComfyUI text-to-image workflow and return its first final image. */
async function generateComfyUIImage(input) {
	const seed = randomSeed();
	const workflow = prepareComfyUIWorkflow(input.workflowJson, input.prompt, seed);
	return {
		...await runJob(input, async (baseURL, signal) => {
			return await downloadOutput(baseURL, await waitForOutput(baseURL, await submitWorkflow(baseURL, workflow, signal), signal), input.maxBytes, signal);
		}),
		seed
	};
}
/** Upload one source image, run the workflow, and return its first final image. */
async function editComfyUIImage(input) {
	const seed = randomSeed();
	return {
		...await runJob(input, async (baseURL, signal) => {
			const imageName = await uploadSourceImage(baseURL, input.sourceImage, signal);
			return await downloadOutput(baseURL, await waitForOutput(baseURL, await submitWorkflow(baseURL, prepareComfyUIWorkflow(input.workflowJson, input.prompt, seed, imageName), signal), signal), input.maxBytes, signal);
		}),
		seed
	};
}
/** Share abort forwarding, the single timeout, and error normalization. */
async function runJob(input, run) {
	input.signal.throwIfAborted();
	const baseURL = comfyUIBaseURL(input.baseURL);
	const controller = new AbortController();
	const forwardAbort = () => {
		controller.abort(input.signal.reason);
	};
	input.signal.addEventListener("abort", forwardAbort, { once: true });
	const timeout = setTimeout(() => {
		controller.abort(/* @__PURE__ */ new Error("ComfyUI generation timed out"));
	}, input.timeoutMs);
	try {
		return await run(baseURL, controller.signal);
	} catch (error) {
		input.signal.throwIfAborted();
		if (controller.signal.aborted) throw new Error(`ComfyUI generation timed out after ${String(input.timeoutMs)} ms`);
		if (error instanceof TypeError) throw new Error(`Could not connect to ComfyUI at ${baseURL.origin}`);
		throw error;
	} finally {
		clearTimeout(timeout);
		input.signal.removeEventListener("abort", forwardAbort);
	}
}
/** Upload the source image and return the LoadImage-compatible name ComfyUI stored it under. */
async function uploadSourceImage(baseURL, image, signal) {
	const filename = uploadFilename(image.mediaType);
	const bytes = new Uint8Array(image.data.byteLength);
	bytes.set(image.data);
	const form = new FormData();
	form.append("image", new Blob([bytes], { type: image.mediaType }), filename);
	const response = await fetch(endpoint$2(baseURL, "upload/image"), {
		method: "POST",
		redirect: "error",
		signal,
		headers: { accept: "application/json" },
		body: form
	});
	const text = await readBoundedText$3(response, ERROR_LIMIT$3);
	if (!response.ok) throw new Error(`ComfyUI image upload failed (${response.status}): ${text}`);
	const payload = parseJsonRecord(text, "ComfyUI /upload/image returned invalid JSON");
	if (typeof payload.name !== "string" || payload.name.length === 0) throw new Error(`ComfyUI /upload/image returned no name: ${text}`);
	const subfolder = typeof payload.subfolder === "string" ? payload.subfolder : "";
	return subfolder.length > 0 ? `${subfolder}/${payload.name}` : payload.name;
}
/** LoadImage-style inputs need a file name with a decodable extension. */
function uploadFilename(mediaType) {
	const extension = mediaType === "image/png" ? "png" : mediaType === "image/jpeg" ? "jpg" : mediaType === "image/webp" ? "webp" : void 0;
	if (extension === void 0) throw new Error(`ComfyUI edit_image accepts PNG, JPEG, or WebP source images; got ${mediaType}`);
	return `dsh-image-gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
}
async function submitWorkflow(baseURL, workflow, signal) {
	const response = await fetch(endpoint$2(baseURL, "prompt"), {
		method: "POST",
		redirect: "error",
		signal,
		headers: {
			"content-type": "application/json",
			accept: "application/json"
		},
		body: JSON.stringify({ prompt: workflow })
	});
	const text = await readBoundedText$3(response, ERROR_LIMIT$3);
	if (!response.ok) throw new Error(`ComfyUI rejected the workflow (${response.status}): ${text}`);
	const payload = parseJsonRecord(text, "ComfyUI /prompt returned invalid JSON");
	if (typeof payload.prompt_id !== "string" || payload.prompt_id.length === 0) throw new Error(`ComfyUI /prompt returned no prompt_id: ${text}`);
	return payload.prompt_id;
}
async function waitForOutput(baseURL, promptId, signal) {
	for (;;) {
		signal.throwIfAborted();
		const response = await fetch(endpoint$2(baseURL, `history/${encodeURIComponent(promptId)}`), {
			redirect: "error",
			signal,
			headers: { accept: "application/json" }
		});
		const text = await readBoundedText$3(response, MAX_HISTORY_BYTES);
		if (!response.ok) throw new Error(`ComfyUI history request failed (${response.status}): ${text.slice(0, ERROR_LIMIT$3)}`);
		const entry = record$4(parseJsonRecord(text, "ComfyUI history returned invalid JSON")[promptId]);
		if (entry !== void 0) {
			const status = record$4(entry.status);
			if (status?.status_str === "error") throw new Error(`ComfyUI workflow failed: ${JSON.stringify(status.messages ?? status).slice(0, ERROR_LIMIT$3)}`);
			const output = firstOutputImage(entry.outputs);
			if (output !== void 0) return output;
			if (status?.completed === true) throw new Error("ComfyUI workflow completed without an output image");
		}
		await delay(POLL_INTERVAL_MS, signal);
	}
}
function firstOutputImage(value) {
	const outputs = record$4(value);
	if (outputs === void 0) return void 0;
	for (const nodeOutput of Object.values(outputs)) {
		const images = record$4(nodeOutput)?.images;
		if (!Array.isArray(images)) continue;
		for (const image of images) {
			const item = record$4(image);
			if (typeof item?.filename !== "string" || item.filename.length === 0) continue;
			const output = {
				filename: item.filename,
				subfolder: typeof item.subfolder === "string" ? item.subfolder : "",
				type: typeof item.type === "string" ? item.type : "output"
			};
			if (output.type === "output") return output;
		}
	}
}
async function downloadOutput(baseURL, output, maxBytes, signal) {
	const url = endpoint$2(baseURL, "view");
	url.searchParams.set("filename", output.filename);
	url.searchParams.set("subfolder", output.subfolder);
	url.searchParams.set("type", output.type);
	const response = await fetch(url, {
		redirect: "error",
		signal
	});
	if (!response.ok) throw new Error(`ComfyUI image download failed (${response.status})`);
	const mediaType = imageMediaType$4(response.headers.get("content-type")) ?? imageMediaTypeFromName(output.filename);
	if (mediaType === void 0) throw new Error("ComfyUI image download returned an unsupported content type");
	return {
		data: await readBoundedBytes$2(response, maxBytes),
		mediaType
	};
}
function comfyUIBaseURL(value) {
	let url;
	try {
		url = new URL(value.endsWith("/") ? value : `${value}/`);
	} catch {
		throw new Error("ComfyUI URL must be an absolute http:// or https:// URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("ComfyUI URL must use http:// or https://");
	return url;
}
function endpoint$2(baseURL, path) {
	return new URL(path, baseURL);
}
function record$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function parseJsonRecord(text, message) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(message);
	}
	const parsed = record$4(value);
	if (parsed === void 0) throw new Error(message);
	return parsed;
}
function imageMediaType$4(value) {
	const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
	return mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp" || mediaType === "image/gif" ? mediaType : void 0;
}
function imageMediaTypeFromName(filename) {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
}
async function delay(milliseconds, signal) {
	await new Promise((resolve, reject) => {
		const timer = setTimeout(done, milliseconds);
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		function done() {
			signal.removeEventListener("abort", abort);
			resolve();
		}
		signal.addEventListener("abort", abort, { once: true });
	});
}
async function readBoundedText$3(response, maxBytes) {
	return new TextDecoder().decode(await readBoundedBytes$2(response, maxBytes));
}
async function readBoundedBytes$2(response, maxBytes) {
	if (response.body === null) return /* @__PURE__ */ new Uint8Array();
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maxBytes) throw new Error(`ComfyUI response exceeded the ${String(maxBytes)} byte limit`);
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const joined = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}
//#endregion
//#region lib/types/dashscope.js
async function generateDashScopeImage(options) {
	assertQwenImageModel(options.model);
	const formattedSize = formatSize(options.size);
	return requestQwenImage({
		...options,
		requestBody: {
			model: options.model,
			input: { messages: [{
				role: "user",
				content: [{ text: options.prompt }]
			}] },
			parameters: { ...formattedSize === void 0 ? {} : { size: formattedSize } }
		},
		operation: "generation"
	});
}
async function editDashScopeImage(options) {
	assertQwenImageModel(options.model);
	const formattedSize = formatSize(options.size);
	return requestQwenImage({
		...options,
		requestBody: {
			model: options.model,
			input: { messages: [{
				role: "user",
				content: [...options.sourceImages.map((sourceImage) => ({ image: toDataUrl$1(sourceImage) })), { text: options.prompt }]
			}] },
			parameters: {
				prompt_extend: true,
				...formattedSize === void 0 ? {} : { size: formattedSize }
			}
		},
		operation: "editing"
	});
}
function assertQwenImageModel(model) {
	if (!model.toLowerCase().startsWith("qwen-image")) throw new Error(`Unsupported DashScope image model ${model}. Configure a qwen-image model.`);
}
function formatSize(size) {
	if (size === void 0 || size.length === 0) return void 0;
	return size.replace("x", "*");
}
function toDataUrl$1(image) {
	return `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`;
}
async function requestQwenImage(options) {
	const base = options.endpoint.replace(/\/+$/, "");
	const response = await fetch(`${base}/services/aigc/multimodal-generation/generation`, {
		method: "POST",
		...options.signal ? { signal: options.signal } : {},
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${options.apiKey}`
		},
		body: JSON.stringify(options.requestBody)
	});
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`DashScope image ${options.operation} failed (${String(response.status)}): ${errorText}`);
	}
	const payload = await response.json();
	const imageUrl = extractImageUrl(payload);
	if (imageUrl === void 0) throw new Error(`DashScope image ${options.operation} returned no image URL: ${payload.message ?? JSON.stringify(payload)}`);
	return downloadImageBlob(imageUrl, options);
}
function extractImageUrl(response) {
	const contents = response.output?.choices?.[0]?.message?.content;
	if (!Array.isArray(contents)) return void 0;
	for (const item of contents) {
		if (item.image !== void 0 && item.image.length > 0) return item.image;
		if (item.image_url !== void 0 && item.image_url.length > 0) return item.image_url;
		if (item.url !== void 0 && item.url.length > 0) return item.url;
	}
}
async function downloadImageBlob(imageUrl, options) {
	const imageResponse = await fetch(imageUrl, { ...options.signal ? { signal: options.signal } : {} });
	if (!imageResponse.ok) throw new Error(`Failed to fetch DashScope image from URL (${String(imageResponse.status)})`);
	const buffer = await imageResponse.arrayBuffer();
	if (buffer.byteLength > options.maxBytes) throw new Error(`DashScope generated image (${String(buffer.byteLength)} bytes) exceeds the ${String(options.maxBytes)} byte limit`);
	const contentType = imageResponse.headers.get("content-type");
	const mediaType = contentType?.includes("png") ? "image/png" : contentType?.includes("webp") ? "image/webp" : "image/jpeg";
	return {
		data: new Uint8Array(buffer),
		mediaType
	};
}
//#endregion
//#region lib/types/google.js
const ERROR_LIMIT$2 = 4096;
const REQUESTED_MEDIA_TYPE = "image/jpeg";
/** Send one native Google text-to-image request. */
function generateGoogleImage(input) {
	return requestGoogleImage({
		...input,
		operation: "generation",
		interactionInput: input.prompt
	});
}
/** Send one native Google image-editing request using already-resolved bytes. */
function editGoogleImage(input) {
	const interactionInput = input.sourceImages.length === 1 ? [{
		type: "image",
		mime_type: input.sourceImages[0].mediaType,
		data: Buffer.from(input.sourceImages[0].data).toString("base64")
	}, {
		type: "text",
		text: input.prompt
	}] : [...input.sourceImages.flatMap((sourceImage, index) => [{
		type: "text",
		text: `图 ${index + 1} (Image ${index + 1}):`
	}, {
		type: "image",
		mime_type: sourceImage.mediaType,
		data: Buffer.from(sourceImage.data).toString("base64")
	}]), {
		type: "text",
		text: input.prompt
	}];
	return requestGoogleImage({
		...input,
		operation: "editing",
		interactionInput
	});
}
/** Shared Google request, response parsing, decoding, and size enforcement. */
async function requestGoogleImage(input) {
	const label = `Google image ${input.operation}`;
	const response = await fetch(input.endpoint, {
		method: "POST",
		redirect: "error",
		signal: input.signal,
		headers: {
			"content-type": "application/json",
			"x-goog-api-key": input.apiKey
		},
		body: JSON.stringify({
			model: input.model,
			input: input.interactionInput,
			response_format: {
				type: "image",
				mime_type: REQUESTED_MEDIA_TYPE,
				aspect_ratio: input.aspectRatio,
				image_size: input.imageSize
			}
		})
	});
	const text = await readBoundedText$2(response, Math.ceil(input.maxBytes * 1.4) + ERROR_LIMIT$2, label);
	if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, ERROR_LIMIT$2)}`);
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
	const image = outputImage(payload);
	if (image === void 0) throw new Error(`${label} returned no image: ${text.slice(0, ERROR_LIMIT$2)}`);
	const mediaType = mediaTypeOf(image.mime_type ?? REQUESTED_MEDIA_TYPE);
	if (mediaType === void 0) throw new Error(`${label} returned unsupported media type ${JSON.stringify(image.mime_type)}`);
	const data = decodeBase64$2(image.data, label);
	if (data.byteLength > input.maxBytes) throw new Error(`${label} exceeded the ${String(input.maxBytes)} byte image limit`);
	return {
		data,
		mediaType
	};
}
function outputImage(value) {
	const interaction = record$3(value);
	if (interaction === void 0) return void 0;
	const direct = imageContent(interaction.output_image, false);
	if (direct !== void 0) return direct;
	if (!Array.isArray(interaction.steps)) return void 0;
	for (const step of interaction.steps) {
		const modelOutput = record$3(step);
		if (modelOutput?.type !== "model_output" || !Array.isArray(modelOutput.content)) continue;
		for (const content of modelOutput.content) {
			const image = imageContent(content, true);
			if (image !== void 0) return image;
		}
	}
}
function imageContent(value, requiresImageType) {
	const image = record$3(value);
	if (image === void 0 || requiresImageType && image.type !== "image" || typeof image.data !== "string") return void 0;
	return {
		data: image.data,
		mime_type: image.mime_type
	};
}
function record$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function mediaTypeOf(value) {
	return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif" ? value : void 0;
}
function decodeBase64$2(data, label) {
	const clean = data.replace(/\s+/g, "");
	if (clean.length === 0) throw new Error(`${label} returned invalid base64 image data`);
	const decoded = Buffer.from(clean, "base64");
	if (decoded.length === 0) throw new Error(`${label} returned invalid base64 image data`);
	return new Uint8Array(decoded);
}
async function readBoundedText$2(response, maxBytes, label) {
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maxBytes) throw new Error(`${label} response exceeded the ${String(maxBytes)} byte limit`);
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const joined = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(joined);
}
//#endregion
//#region lib/types/reference-image.js
/** Latest-DSH compatibility boundary for resolving conversation image references. */
/**
* Resolve one or more edit references while keeping every DSH-specific detail
* behind this compatibility boundary. Explicit selectors preserve caller order;
* without selectors, all images in the newest image-bearing message are used.
*/
async function resolveReferenceImages(input) {
	const sourceAttachmentIds = mergeSelectors({
		single: input.sourceAttachmentId,
		multiple: input.sourceAttachmentIds,
		singleName: "source_attachment_id",
		multipleName: "source_attachment_ids",
		equal: attachmentIdsEqual
	});
	const sourcePaths = mergeSelectors({
		single: input.sourcePath,
		multiple: input.sourcePaths,
		singleName: "source_path",
		multipleName: "source_paths",
		equal: (left, right) => left.trim() === right.trim()
	});
	if (sourceAttachmentIds !== void 0 && sourcePaths !== void 0) throw new Error("edit_image accepts only one of source_attachment_id, source_attachment_ids, source_path, or source_paths");
	if (sourcePaths !== void 0) return Promise.all(sourcePaths.map((sourcePath) => readWorkspaceReferenceImage({
		sourcePath,
		...input.agent?.session.header?.cwd === void 0 ? {} : { workspaceRoot: input.agent.session.header.cwd },
		...input.maxBytes === void 0 ? {} : { maxBytes: input.maxBytes },
		signal: input.signal
	})));
	if (input.agent === void 0) throw new Error("edit_image requires an active DSH agent session to resolve a reference image");
	const refs = findReferenceImages(input.agent.session.deriveMessages(), sourceAttachmentIds);
	if (refs.length === 0) {
		if (sourceAttachmentIds !== void 0) throw new Error(`edit_image could not find image attachment ${sourceAttachmentIds[0]} in the current conversation`);
		throw new Error("edit_image requires an image in the current conversation; upload or generate an image first");
	}
	if (sourceAttachmentIds !== void 0 && refs.length !== sourceAttachmentIds.length) {
		const missing = sourceAttachmentIds.find((id) => !refs.some((ref) => attachmentIdsEqual(String(ref.attachmentId), id)));
		throw new Error(`edit_image could not find image attachment ${missing ?? "unknown"} in the current conversation`);
	}
	return Promise.all(refs.map(async (ref) => {
		const stored = await input.attachments.readImage(ref, input.signal);
		if (input.maxBytes !== void 0 && stored.data.byteLength > input.maxBytes) throw new Error(`edit_image source image is too large (${stored.data.byteLength} bytes; maximum ${input.maxBytes})`);
		return {
			data: stored.data,
			mediaType: stored.ref.mediaType
		};
	}));
}
/** Find images in caller order, or every image in the newest image-bearing message. */
function findReferenceImages(messages, sourceAttachmentIds) {
	if (sourceAttachmentIds !== void 0) return sourceAttachmentIds.flatMap((id) => {
		const ref = findReferenceImage(messages, id);
		return ref === void 0 ? [] : [ref];
	});
	const latestHumanMessage = [...messages].reverse().find((message) => message.source?.kind === "user");
	if (latestHumanMessage !== void 0) {
		const refs = collectInBlocks(latestHumanMessage.content);
		if (refs.length > 0) return refs;
	}
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const refs = collectInBlocks(messages[index]?.content ?? []);
		if (refs.length > 0) return refs;
	}
	return [];
}
/**
* Read an explicitly named workspace image without exposing filesystem or DSH
* details to provider adapters. Both lexical and real-path containment are
* enforced so absolute paths, parent traversal, and symlink escapes fail.
*/
async function readWorkspaceReferenceImage(input) {
	const requested = input.sourcePath.trim();
	if (requested.length === 0) throw new Error("edit_image source_path must not be empty");
	if (input.workspaceRoot === void 0) throw new Error("edit_image source_path requires an active DSH session workspace");
	const root = resolve(input.workspaceRoot);
	const candidate = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
	if (!containsPath$1(root, candidate)) throw new Error("edit_image source_path must stay inside the session workspace: " + requested);
	let realRoot;
	let realCandidate;
	try {
		[realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
	} catch (error) {
		if (error.code === "ENOENT") throw new Error("edit_image could not find workspace image: " + requested);
		throw error;
	}
	if (!containsPath$1(realRoot, realCandidate)) throw new Error("edit_image source_path resolves outside the session workspace: " + requested);
	const file = await stat(realCandidate);
	if (!file.isFile()) throw new Error("edit_image source_path is not a file: " + requested);
	if (input.maxBytes !== void 0 && file.size > input.maxBytes) throw new Error("edit_image source image is too large (" + file.size + " bytes; maximum " + input.maxBytes + ")");
	const data = await readFile(realCandidate, { signal: input.signal });
	const mediaType = detectImageMediaType(data);
	if (mediaType === void 0) throw new Error("edit_image source_path is not a supported PNG, JPEG, WebP, or GIF image: " + requested);
	return {
		data: new Uint8Array(data),
		mediaType
	};
}
/** Find the newest matching image in the effective, replacement-aware history. */
function findReferenceImage(messages, sourceAttachmentId) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const found = findInBlocks(messages[index]?.content ?? [], sourceAttachmentId);
		if (found !== void 0) return found;
	}
}
/** Validate an untrusted serialized image reference at an HTTP/UI boundary. */
function parseImageAttachmentRef(value) {
	const ref = record$2(value);
	if (ref === void 0) return void 0;
	if (typeof ref.attachmentId !== "string" || !imageMediaType$3(ref.mediaType)) return void 0;
	if (!nonNegativeInteger(ref.bytes) || !positiveInteger(ref.width) || !positiveInteger(ref.height)) return void 0;
	if (ref.name !== void 0 && typeof ref.name !== "string") return void 0;
	const originalDimensions = ref.originalDimensions === void 0 ? void 0 : parseDimensions(ref.originalDimensions);
	if (ref.originalDimensions !== void 0 && originalDimensions === void 0) return void 0;
	return {
		attachmentId: ref.attachmentId,
		mediaType: ref.mediaType,
		bytes: ref.bytes,
		width: ref.width,
		height: ref.height,
		...typeof ref.name === "string" ? { name: ref.name } : {},
		...originalDimensions === void 0 ? {} : { originalDimensions }
	};
}
function findInBlocks(blocks, sourceAttachmentId) {
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const block = blocks[index];
		if (block === void 0) continue;
		if (block.type === "image") {
			if (sourceAttachmentId === void 0 || attachmentIdsEqual(String(block.attachment.attachmentId), sourceAttachmentId)) return block.attachment;
			continue;
		}
		if (block.type === "tool-result") {
			const nested = findInBlocks(block.content, sourceAttachmentId);
			if (nested !== void 0) return nested;
		}
	}
}
function parseDimensions(value) {
	const dimensions = record$2(value);
	if (dimensions === void 0 || !positiveInteger(dimensions.width) || !positiveInteger(dimensions.height)) return void 0;
	return {
		width: dimensions.width,
		height: dimensions.height
	};
}
function imageMediaType$3(value) {
	return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif";
}
function collectInBlocks(blocks) {
	const refs = [];
	for (const block of blocks) {
		if (block.type === "image") refs.push(block.attachment);
		if (block.type === "tool-result") refs.push(...collectInBlocks(block.content));
	}
	return refs;
}
function attachmentIdsEqual(actual, requested) {
	if (actual === requested) return true;
	const actualDigest = sha256Digest(actual);
	const requestedDigest = sha256Digest(requested);
	return actualDigest !== void 0 && actualDigest === requestedDigest;
}
function sha256Digest(value) {
	return /^(?:sha256:)?([0-9a-f]{64})$/i.exec(value.trim())?.[1]?.toLowerCase();
}
function mergeSelectors(input) {
	if (input.multiple === void 0) return input.single === void 0 ? void 0 : [input.single];
	if (input.multiple.length === 0) {
		if (input.single !== void 0) return [input.single];
		throw new Error(`edit_image ${input.multipleName} must not be empty`);
	}
	const single = input.single;
	if (single !== void 0 && !input.multiple.some((value) => input.equal(single, value))) throw new Error(`edit_image ${input.singleName} must also appear in ${input.multipleName} when both are provided`);
	return input.multiple;
}
function detectImageMediaType(data) {
	if (startsWith(data, [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	])) return "image/png";
	if (startsWith(data, [
		255,
		216,
		255
	])) return "image/jpeg";
	if (ascii(data, 0, 6) === "GIF87a" || ascii(data, 0, 6) === "GIF89a") return "image/gif";
	if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") return "image/webp";
}
function startsWith(data, signature) {
	return signature.every((byte, index) => data[index] === byte);
}
function ascii(data, offset, length) {
	return String.fromCharCode(...data.subarray(offset, offset + length));
}
function containsPath$1(parent, child) {
	const rel = relative(parent, child);
	return rel === "" || rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
function positiveInteger(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function nonNegativeInteger(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function record$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
//#endregion
//#region lib/types/image-route.js
const MAX_BODY_BYTES = 65536;
/** Serve one verified durable image reference to a same-origin browser request. */
async function serveImage(req, res, deps) {
	if (req.method !== "POST") return jsonError$1(res, 405, "method-not-allowed");
	if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return jsonError$1(res, 415, "json-required");
	const origin = req.headers.origin;
	const host = req.headers.host;
	if (origin !== void 0 && host !== void 0 && origin !== `http://${host}` && origin !== `https://${host}`) return jsonError$1(res, 403, "origin-rejected");
	let body;
	try {
		body = JSON.parse(await readBody$1(req));
	} catch {
		return jsonError$1(res, 400, "invalid-request");
	}
	const attachment = attachmentFromRequest(body);
	if (attachment === void 0) return jsonError$1(res, 400, "invalid-attachment");
	try {
		const stored = await deps.readImage(attachment);
		res.writeHead(200, {
			"content-type": stored.ref.mediaType,
			"content-length": String(stored.data.byteLength),
			"cache-control": "private, no-store",
			"x-content-type-options": "nosniff"
		});
		res.end(stored.data);
	} catch {
		jsonError$1(res, 404, "image-unavailable");
	}
}
/** Safely delete one or more generated image files from the workspace disk. */
async function serveDelete(req, res, deps) {
	if (req.method !== "POST") return jsonError$1(res, 405, "method-not-allowed");
	if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return jsonError$1(res, 415, "json-required");
	const origin = req.headers.origin;
	const host = req.headers.host;
	if (origin !== void 0 && host !== void 0 && origin !== `http://${host}` && origin !== `https://${host}`) return jsonError$1(res, 403, "origin-rejected");
	let body;
	try {
		body = JSON.parse(await readBody$1(req));
	} catch {
		return jsonError$1(res, 400, "invalid-request");
	}
	const rawPaths = typeof body === "object" && body !== null && "paths" in body && Array.isArray(body.paths) ? body.paths : [];
	const deletedFiles = [];
	const failedFiles = [];
	for (const p of rawPaths) if (typeof p === "string" && p.trim()) try {
		if (await deps.deleteWorkspaceImage(p)) deletedFiles.push(p);
		else failedFiles.push({
			path: p,
			error: "File not found or rejected by safety checks"
		});
	} catch (err) {
		failedFiles.push({
			path: p,
			error: err instanceof Error ? err.message : String(err)
		});
	}
	res.writeHead(200, {
		"content-type": "application/json",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify({
		ok: failedFiles.length === 0,
		deletedCount: deletedFiles.length,
		deletedFiles,
		failedFiles
	}));
}
/** Validate the persisted reference carried by a tool presentation. */
function imageAttachmentFromMeta(meta) {
	const value = record$1(meta);
	if (value?.kind !== "dsh-image-gen") return void 0;
	return parseImageAttachmentRef(value.attachment);
}
function attachmentFromRequest(value) {
	return parseImageAttachmentRef(record$1(value)?.attachment);
}
function record$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
async function readBody$1(req) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > MAX_BODY_BYTES) throw new Error("request too large");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
function jsonError$1(res, status, code) {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify({ error: code }));
}
//#endregion
//#region lib/types/openai-compatible.js
const ERROR_LIMIT$1 = 4096;
async function generateOpenAICompatibleImage(input) {
	return parseImageResponse(await fetch(imageEndpoint$1(input.baseURL, "generations"), {
		method: "POST",
		redirect: "error",
		signal: input.signal,
		headers: {
			authorization: `Bearer ${input.apiKey}`,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			model: input.model,
			prompt: input.prompt,
			size: input.size,
			...input.provider === "seedream" ? { response_format: "url" } : {}
		})
	}), input.provider, input);
}
async function editOpenAICompatibleImage(input) {
	const form = new FormData();
	const imageField = input.sourceImages.length > 1 ? "image[]" : "image";
	input.sourceImages.forEach((sourceImage, index) => {
		const uploadBytes = new Uint8Array(sourceImage.data);
		const blob = new Blob([uploadBytes], { type: sourceImage.mediaType });
		const filename = `reference-${index + 1}.${extensionOf(sourceImage.mediaType)}`;
		form.append(imageField, blob, filename);
	});
	form.append("prompt", input.prompt);
	form.append("model", input.model);
	if (input.size !== void 0 && input.size.length > 0) form.append("size", input.size);
	return parseImageResponse(await fetch(imageEndpoint$1(input.baseURL, "edits"), {
		method: "POST",
		redirect: "error",
		signal: input.signal,
		headers: { authorization: `Bearer ${input.apiKey}` },
		body: form
	}), "openai", input);
}
async function parseImageResponse(response, provider, input) {
	const text = await readBoundedText$1(response, Math.ceil(input.maxBytes * 1.4) + ERROR_LIMIT$1);
	if (!response.ok) throw new Error(`${provider} image request failed (${response.status}): ${text.slice(0, ERROR_LIMIT$1)}`);
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error(`${provider} image request returned invalid JSON`);
	}
	const image = firstImage$1(payload);
	if (image === void 0) throw new Error(`${provider} image request returned no image: ${text.slice(0, ERROR_LIMIT$1)}`);
	if (image.b64_json !== void 0) return {
		data: decodeBase64$1(image.b64_json, provider),
		mediaType: imageMediaType$2(image.mime_type) ?? "image/png"
	};
	return downloadImage$1(image.url, provider, input);
}
function imageEndpoint$1(baseURL, operation) {
	try {
		return new URL(`images/${operation}`, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
	} catch {
		throw new Error("Image endpoint must be an absolute URL");
	}
}
function firstImage$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	const data = Array.isArray(record.data) ? record.data : Array.isArray(record.images) ? record.images : Array.isArray(record.output) ? record.output : void 0;
	if (data === void 0 || data.length === 0) return void 0;
	const candidate = data[0];
	if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return void 0;
	const item = candidate;
	const mime = typeof item.mime_type === "string" ? item.mime_type : typeof item.mime === "string" ? item.mime : void 0;
	return typeof item.b64_json === "string" ? {
		b64_json: item.b64_json,
		...mime === void 0 ? {} : { mime_type: mime }
	} : typeof item.url === "string" ? {
		url: item.url,
		...mime === void 0 ? {} : { mime_type: mime }
	} : void 0;
}
async function downloadImage$1(url, provider, input) {
	if (url === void 0) throw new Error(`${provider} image request returned no image data`);
	if (url.startsWith("data:")) {
		const parsed = parseDataUrl(url);
		if (parsed === void 0) throw new Error(`${provider} image request returned invalid data URL`);
		return {
			data: decodeBase64$1(parsed.base64, provider),
			mediaType: imageMediaType$2(parsed.mediaType) ?? "image/png"
		};
	}
	const response = await fetch(url, {
		redirect: "follow",
		signal: input.signal,
		...input.apiKey === void 0 ? {} : { headers: { authorization: `Bearer ${input.apiKey}` } }
	});
	if (!response.ok) throw new Error(`${provider} image download failed (${response.status})`);
	const mediaType = imageMediaType$2(response.headers.get("content-type"));
	if (mediaType === void 0) throw new Error(`${provider} image download returned unsupported content type`);
	return {
		data: await readBoundedBytes$1(response, input.maxBytes),
		mediaType
	};
}
function parseDataUrl(value) {
	const match = /^data:([^;,]+);base64,(.*)$/s.exec(value.trim());
	return match?.[1] !== void 0 && match[2] !== void 0 ? {
		mediaType: match[1],
		base64: match[2]
	} : void 0;
}
function extensionOf(mediaType) {
	switch (mediaType) {
		case "image/jpeg": return "jpg";
		case "image/webp": return "webp";
		case "image/gif": return "gif";
		case "image/png": return "png";
	}
}
function decodeBase64$1(value, provider) {
	const clean = (parseDataUrl(value)?.base64 ?? value).replace(/\s+/g, "");
	if (clean.length === 0) throw new Error(`${provider} image request returned invalid base64 image data`);
	const decoded = Buffer.from(clean, "base64");
	if (decoded.length === 0) throw new Error(`${provider} image request returned invalid base64 image data`);
	return new Uint8Array(decoded);
}
function imageMediaType$2(value) {
	const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
	return mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp" || mediaType === "image/gif" ? mediaType : void 0;
}
async function readBoundedText$1(response, maxBytes) {
	return new TextDecoder().decode(await readBoundedBytes$1(response, maxBytes));
}
async function readBoundedBytes$1(response, maxBytes) {
	if (response.body === null) return /* @__PURE__ */ new Uint8Array();
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maxBytes) throw new Error(`Image response exceeded the ${String(maxBytes)} byte limit`);
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const joined = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}
//#endregion
//#region lib/types/seedream.js
const ERROR_LIMIT = 4096;
/** Edit one image through Ark ImageGenerations using a data-URL reference. */
async function editSeedreamImage(input) {
	const response = await fetch(imageEndpoint(input.baseURL), {
		method: "POST",
		redirect: "error",
		signal: input.signal,
		headers: {
			authorization: `Bearer ${input.apiKey}`,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			model: input.model,
			prompt: input.prompt,
			image: input.sourceImages.map(toDataUrl),
			...input.size === void 0 || input.size.length === 0 ? {} : { size: input.size },
			response_format: "b64_json"
		})
	});
	const text = await readBoundedText(response, Math.ceil(input.maxBytes * 1.4) + ERROR_LIMIT);
	if (!response.ok) throw new Error(`seedream image editing failed (${response.status}): ${text.slice(0, ERROR_LIMIT)}`);
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error("seedream image editing returned invalid JSON");
	}
	const image = firstImage(payload);
	if (image === void 0) throw new Error(`seedream image editing returned no image: ${text.slice(0, ERROR_LIMIT)}`);
	if (image.b64_json !== void 0) return {
		data: decodeBase64(image.b64_json),
		mediaType: imageMediaType$1(image.mime_type) ?? "image/png"
	};
	return downloadImage(image.url, input);
}
function imageEndpoint(baseURL) {
	try {
		return new URL("images/generations", baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
	} catch {
		throw new Error("Seedream image endpoint must be an absolute URL");
	}
}
function toDataUrl(image) {
	return `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`;
}
function firstImage(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	const data = Array.isArray(record.data) ? record.data : Array.isArray(record.images) ? record.images : Array.isArray(record.output) ? record.output : void 0;
	if (data === void 0 || data.length === 0) return void 0;
	const candidate = data[0];
	if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return void 0;
	const item = candidate;
	const mime = typeof item.mime_type === "string" ? item.mime_type : typeof item.mime === "string" ? item.mime : void 0;
	return typeof item.b64_json === "string" ? {
		b64_json: item.b64_json,
		...mime === void 0 ? {} : { mime_type: mime }
	} : typeof item.url === "string" ? {
		url: item.url,
		...mime === void 0 ? {} : { mime_type: mime }
	} : void 0;
}
async function downloadImage(url, input) {
	if (url === void 0) throw new Error("seedream image editing returned no image data");
	const response = await fetch(url, {
		redirect: "follow",
		signal: input.signal
	});
	if (!response.ok) throw new Error(`seedream image download failed (${response.status})`);
	const mediaType = imageMediaType$1(response.headers.get("content-type"));
	if (mediaType === void 0) throw new Error("seedream image download returned unsupported content type");
	return {
		data: await readBoundedBytes(response, input.maxBytes),
		mediaType
	};
}
function decodeBase64(value) {
	const clean = value.replace(/\s+/g, "");
	if (clean.length === 0) throw new Error("seedream image editing returned invalid base64 image data");
	const decoded = Buffer.from(clean, "base64");
	if (decoded.length === 0) throw new Error("seedream image editing returned invalid base64 image data");
	return new Uint8Array(decoded);
}
function imageMediaType$1(value) {
	const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
	return mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp" || mediaType === "image/gif" ? mediaType : void 0;
}
async function readBoundedText(response, maxBytes) {
	return new TextDecoder().decode(await readBoundedBytes(response, maxBytes));
}
async function readBoundedBytes(response, maxBytes) {
	if (response.body === null) return /* @__PURE__ */ new Uint8Array();
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > maxBytes) throw new Error(`Image response exceeded the ${String(maxBytes)} byte limit`);
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const joined = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}
//#endregion
//#region lib/types/grok.js
const GROK_RATIOS = [
	"1:1",
	"3:2",
	"2:3",
	"4:3",
	"3:4",
	"16:9",
	"9:16"
];
const GROK_RESOLUTIONS = ["1k", "2k"];
async function generateGrokImage(input) {
	const base = new URL(input.baseURL);
	if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Grok API 根地址必须是无账号、查询参数或片段的 HTTP(S) 地址");
	if (!input.apiKey.trim() || /[\r\n]/.test(input.apiKey)) throw new Error("请配置有效的 XAI_API_KEY");
	if (!input.model.trim() || !input.prompt.trim()) throw new Error("Grok 模型和提示词不能为空");
	const resolution = (input.resolution ?? "1k").toLowerCase();
	const aspectRatio = input.aspectRatio ?? "1:1";
	if (!GROK_RESOLUTIONS.includes(resolution)) throw new Error("Grok 分辨率仅支持 1k 或 2k");
	if (!GROK_RATIOS.includes(aspectRatio)) throw new Error("不支持的 Grok 画面比例");
	const response = await fetch(base.href.replace(/\/+$/, "") + "/images/generations", {
		method: "POST",
		redirect: "error",
		signal: input.signal,
		headers: {
			authorization: `Bearer ${input.apiKey}`,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			model: input.model,
			prompt: input.prompt,
			n: 1,
			aspect_ratio: aspectRatio,
			resolution,
			response_format: "b64_json"
		})
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Grok 生图请求失败（HTTP ${response.status}）；未自动重试`);
	}
	const limit = Math.ceil(input.maxBytes * 4 / 3) + 65536;
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Grok 未返回图片");
	const chunks = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) throw new Error("Grok 图片响应过大");
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	let payload;
	try {
		payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error("Grok 未返回有效的图片 JSON");
	}
	const encoded = payload?.data?.[0]?.b64_json;
	if (typeof encoded !== "string" || !encoded.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Grok 未返回内嵌图片；该接口必须支持 response_format=b64_json");
	const data = Buffer.from(encoded, "base64");
	if (!data.length || data.length > input.maxBytes) throw new Error("Grok 图片为空或超过大小限制");
	let mediaType;
	if (data.subarray(0, 8).equals(Buffer.from([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]))) mediaType = "image/png";
	else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mediaType = "image/jpeg";
	else if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") mediaType = "image/webp";
	else throw new Error("Grok 返回了不支持的图片格式");
	return {
		data,
		mediaType
	};
}
//#endregion
//#region lib/types/workspace-save.js
/** Persist one generated image as a file under the session workspace. */
/** File extension for each supported image media type. */
const EXTENSION = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif"
};
/**
* Build the deterministic file name for a generated image:
* `image-<digest-prefix>.<ext>`. The digest prefix comes from the
* content-addressed attachment id, so the same image bytes always map to the
* same file name regardless of when they were generated, and re-saving simply
* overwrites the previous copy in place.
* @param attachmentId - durable attachment id (`sha256:<hex>`).
* @param mediaType - verified image media type.
* @returns the file name (no directory).
*/
function workspaceImageName(attachmentId, mediaType) {
	return `image-${(attachmentId.startsWith("sha256:") ? attachmentId.slice(7) : attachmentId).slice(0, 8).padEnd(8, "0")}.${EXTENSION[mediaType]}`;
}
/**
* Resolve the configured image folder inside the session workspace. The
* folder may nest, but must stay inside the workspace: absolute paths and
* parent-traversal segments are rejected for both separator styles.
*
* This lexical pass is necessary but not sufficient: `saveImageToWorkspace`
* additionally verifies the on-disk resolution so symlinked folders cannot
* escape the workspace.
* @param workspaceRoot - the session workspace directory.
* @param folder - configured subfolder; empty/blank means the workspace root.
* @returns the absolute image directory.
* @throws when the folder would escape the workspace root.
*/
function workspaceImageDir(workspaceRoot, folder) {
	const trimmed = (folder ?? "").trim();
	const root = resolve(workspaceRoot);
	const dir = trimmed === "" ? root : resolve(root, trimmed);
	if (!containsPath(root, dir)) throw new Error(`image workspace folder '${folder}' must stay inside the session workspace`);
	return dir;
}
/** True when `child` equals `parent` or lives underneath it (lexically). */
function containsPath(parent, child) {
	const rel = relative(parent, child);
	return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
/**
* Real path of the closest existing ancestor of `dir` (inclusive). Walking up
* lets us validate symlinked folder segments before creating anything under
* them.
*/
async function nearestExistingRealPath(dir) {
	let probe = dir;
	for (;;) try {
		return await realpath(probe);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		const parent = dirname(probe);
		if (parent === probe) throw error;
		probe = parent;
	}
}
/** Reject a directory whose on-disk resolution lands outside the workspace. */
function assertInsideWorkspace(realRoot, candidate, folder) {
	if (containsPath(realRoot, candidate)) return;
	throw new Error(`image workspace folder '${folder ?? ""}' must stay inside the session workspace (${candidate} resolves outside ${realRoot})`);
}
/**
* Write one generated image durably under the session workspace.
*
* Containment is enforced twice: lexically by `workspaceImageDir`, then
* against real paths, so a configured folder (or any intermediate segment)
* that is a symlink pointing outside the workspace is rejected before and
* after anything is created.
*
* The bytes are written to a same-directory staging file and renamed onto the
* target, so a crash never leaves a half-written image under its final name.
* Re-saving identical bytes rewrites the same file (the name is content-
* addressed), which keeps repeated generations idempotent. A cancellation is
* honoured up to and including the final rename: an aborted save never
* resolves successfully and never leaves the image behind under its final
* name.
* @param options - workspace root, configured folder, attachment identity, and image bytes.
* @returns the absolute path of the written file.
*/
async function saveImageToWorkspace(options) {
	const dir = workspaceImageDir(options.workspaceRoot, options.folder);
	options.signal?.throwIfAborted();
	const realRoot = await realpath(resolve(options.workspaceRoot));
	assertInsideWorkspace(realRoot, await nearestExistingRealPath(dir), options.folder);
	const name = workspaceImageName(options.attachmentId, options.mediaType);
	const target = join(dir, name);
	const staging = join(dir, `.${name}.${process.pid}-${randomUUID()}.tmp`);
	await mkdir(dir, { recursive: true });
	assertInsideWorkspace(realRoot, await realpath(dir), options.folder);
	try {
		await writeFile(staging, options.data, {
			flag: "wx",
			signal: options.signal
		});
		options.signal?.throwIfAborted();
		await rename(staging, target);
	} catch (error) {
		await unlink(staging).catch(() => {});
		throw error;
	}
	try {
		options.signal?.throwIfAborted();
	} catch (error) {
		await unlink(target).catch(() => {});
		throw error;
	}
	return target;
}
/** Regex pattern strictly matching generated image file names (e.g. image-01234567.png). */
const GENERATED_IMAGE_NAME_REGEX = /^image-[0-9a-f]{8,}\.(png|jpg|jpeg|webp|gif)$/i;
/** Discover detailed workspace records from DSH workspace.json storage. */
async function getDshWorkspacesFull() {
	const list = [];
	try {
		const home = process.env.USERPROFILE || process.env.HOME || "";
		if (home) {
			const workspaceJsonPath = join(home, ".dsh", "storages", "workspace.json");
			const content = await readFile(workspaceJsonPath, "utf8");
			const workspaces = JSON.parse(content)?.tables?.workspaces;
			if (workspaces && typeof workspaces === "object") for (const [id, ws] of Object.entries(workspaces)) {
				const raw = ws;
				if (raw && typeof raw.path === "string") {
					const p = raw.path.trim();
					if (!p) continue;
					const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : basename(p);
					const rawSessions = raw.sessionIds;
					const sessionIds = Array.isArray(rawSessions) ? rawSessions.filter((s) => typeof s === "string") : [];
					list.push({
						workspaceId: id,
						path: p,
						title,
						sessionIds
					});
				}
			}
		}
	} catch {}
	return list;
}
/**
* Safely delete a generated image file from workspace disk by its path.
* Enforces strict safety gates:
* 1. Base name must match generated image pattern (`image-<hex>.<ext>`) to avoid touching user files.
* 2. Path must be a regular file and NOT a symbolic link.
* 3. Real canonical path's basename must also match the pattern.
* 4. Real canonical path must reside within an allowed workspace root (or process.cwd()).
*/
async function deleteImageFromWorkspace(filePath, allowedWorkspaceRoots) {
	const resolved = resolve(filePath);
	const base = resolved.split(/[/\\]/).pop() ?? "";
	if (!GENERATED_IMAGE_NAME_REGEX.test(base)) return false;
	try {
		const fileLstat = await lstat(resolved);
		if (fileLstat.isSymbolicLink() || !fileLstat.isFile()) return false;
	} catch (err) {
		if (err?.code === "ENOENT") return true;
		throw err;
	}
	try {
		const realFile = await realpath(resolved);
		const realBase = realFile.split(/[/\\]/).pop() ?? "";
		if (!GENERATED_IMAGE_NAME_REGEX.test(realBase)) return false;
		const rootsToCheck = /* @__PURE__ */ new Set();
		if (allowedWorkspaceRoots) {
			for (const r of allowedWorkspaceRoots) if (typeof r === "string" && r.trim()) rootsToCheck.add(resolve(r));
		}
		rootsToCheck.add(resolve(process.cwd()));
		let withinAllowed = false;
		for (const root of rootsToCheck) try {
			if (containsPath(await realpath(root), realFile)) {
				withinAllowed = true;
				break;
			}
		} catch {}
		if (!withinAllowed) return false;
		await unlink(realFile);
		return true;
	} catch (err) {
		if (err?.code === "ENOENT") return true;
		throw err;
	}
}
//#endregion
//#region lib/types/studio.js
const PROVIDER_LABELS = {
	grok: "Grok (xAI)",
	google: "Google",
	openai: "OpenAI",
	seedream: "Seedream",
	dashscope: "DashScope"
};
const CREDENTIALS = {
	grok: GROK_API_KEY_ENV,
	google: GOOGLE_API_KEY_ENV,
	openai: OPENAI_API_KEY_ENV,
	seedream: SEEDREAM_API_KEY_ENV,
	dashscope: DASHSCOPE_API_KEY_ENV
};
const RATIO_LABELS = {
	auto: "自动",
	"1:1": "1:1 方形",
	"3:2": "3:2 横向",
	"2:3": "2:3 肖像",
	"4:3": "4:3 横向",
	"3:4": "3:4 竖向",
	"16:9": "16:9 宽屏",
	"9:16": "9:16 竖屏"
};
/** Return only browser-safe capability data. */
async function describeStudio(ctx, config) {
	const configuredEntries = await Promise.all(CLOUD_IMAGE_PROVIDERS.map(async (provider) => {
		const credential = await ctx.credentials.resolve(credentialRef(CREDENTIALS[provider]));
		return [provider, credential !== void 0 && credential.value.trim().length > 0];
	}));
	const configured = Object.fromEntries(configuredEntries);
	const profiles = CLOUD_IMAGE_PROVIDERS.map((provider) => studioProfile(config, provider, configured[provider]));
	const preferred = config.provider;
	return {
		providers: profiles,
		activeProvider: preferred !== void 0 && cloudProvider$1(preferred) ? preferred : profiles.find((profile) => profile.configured)?.provider ?? "google"
	};
}
/** Capture endpoint and credential under the caller's short configuration lock.
* The returned operation performs attachment IO and HTTP only after release. */
async function prepareStudioGeneration(ctx, config, input, signal, fallbackWorkspaceRoot) {
	signal.throwIfAborted();
	config = structuredClone(config);
	input = structuredClone(input);
	assertAllowed(studioProfile(config, input.provider, true), input);
	const active = resolveProvider(providerConfig(config, input.provider, input.model));
	if (active.provider === "comfyui") throw new Error("ComfyUI 暂未接入工作台");
	const credential = structuredClone(await ctx.credentials.resolve(credentialRef(active.apiKeyEnv)));
	if (credential === void 0 || credential.value.trim().length === 0) throw new Error(`${PROVIDER_LABELS[input.provider]} 尚未配置 API Key，请先到设置中配置`);
	return async () => {
		signal.throwIfAborted();
		const rawRefs = input.references ?? (input.reference ? [input.reference] : []);
		if (input.mode === "edit" && rawRefs.length === 0) throw new Error("图生图需要至少一张参考图");
		const sourceImages = input.mode === "edit" ? await Promise.all(rawRefs.map((ref) => readStudioReference(ctx, ref, signal))) : [];
		const startedAt = Date.now();
		let generated;
		let output;
		if (active.provider === "grok") {
			generated = await generateGrokImage({
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: input.prompt,
				aspectRatio: input.ratio,
				resolution: input.quality,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			});
			output = `${input.ratio}, ${input.quality}`;
		} else if (active.provider === "google") {
			const aspectRatio = input.ratio;
			const imageSize = input.quality;
			generated = input.mode === "edit" ? await editGoogleImage({
				apiKey: credential.value,
				endpoint: active.endpoint,
				model: active.model,
				prompt: input.prompt,
				sourceImages,
				aspectRatio,
				imageSize,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			}) : await generateGoogleImage({
				apiKey: credential.value,
				endpoint: active.endpoint,
				model: active.model,
				prompt: input.prompt,
				aspectRatio,
				imageSize,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			});
			output = `${aspectRatio}, ${imageSize}`;
		} else if (active.provider === "openai") {
			const size = openAISize(input.ratio);
			generated = input.mode === "edit" ? await editOpenAICompatibleImage({
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: input.prompt,
				sourceImages,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			}) : await generateOpenAICompatibleImage({
				provider: "openai",
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: input.prompt,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			});
			output = size;
		} else if (active.provider === "seedream") {
			const size = input.quality;
			generated = input.mode === "edit" ? await editSeedreamImage({
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: input.prompt,
				sourceImages,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			}) : await generateOpenAICompatibleImage({
				provider: "seedream",
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: input.prompt,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			});
			output = size;
		} else {
			if (input.mode === "edit" && sourceImages.length > 3) throw new Error("DashScope (通义万相) 图生图目前最多支持 3 张参考图，请精简后重试");
			const size = dashScopeSize(input.ratio);
			generated = input.mode === "edit" ? await editDashScopeImage({
				apiKey: credential.value,
				endpoint: active.endpoint,
				model: active.model,
				prompt: input.prompt,
				sourceImages,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			}) : await generateDashScopeImage({
				apiKey: credential.value,
				endpoint: active.endpoint,
				model: active.model,
				prompt: input.prompt,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal
			});
			output = size;
		}
		if (!ctx.attachments.imageLimits.mediaTypes.includes(generated.mediaType)) throw new Error(`当前 DSH 不支持保存 ${generated.mediaType} 图片`);
		const attachment = await ctx.attachments.saveImage({
			data: generated.data,
			mediaType: generated.mediaType,
			name: "studio-image"
		});
		let savedTo;
		const targetRoot = input.workspaceRoot || fallbackWorkspaceRoot;
		if (config.saveToWorkspace !== false && targetRoot) try {
			savedTo = await saveImageToWorkspace({
				workspaceRoot: targetRoot,
				folder: config.workspaceFolder,
				attachmentId: attachment.attachmentId,
				mediaType: generated.mediaType,
				data: generated.data,
				signal
			});
		} catch (saveError) {
			ctx.logger.warn(`dsh-image-gen: studio failed to save image to workspace: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
		}
		return {
			attachment,
			provider: input.provider,
			model: input.model,
			prompt: input.prompt,
			output,
			createdAt: Date.now(),
			elapsedMs: Date.now() - startedAt,
			...savedTo ? { savedTo } : {}
		};
	};
}
function studioProfile(config, provider, configured) {
	const active = resolveProvider(providerConfig(config, provider));
	if (active.provider === "comfyui") throw new Error("Invalid cloud provider profile");
	const model = active.model;
	if (provider === "grok") return {
		...profile(provider, model, configured, GROK_RATIOS.map(option), GROK_RESOLUTIONS.map((value) => ({
			value,
			label: value
		})), "1:1", "1k"),
		supportsEditing: false
	};
	if (provider === "google") return profile(provider, model, configured, ASPECT_RATIOS.map(option), IMAGE_SIZES.map((value) => ({
		value,
		label: value
	})), "1:1", "1K");
	if (provider === "openai") return profile(provider, model, configured, [
		"1:1",
		"3:2",
		"2:3"
	].map(option), [{
		value: "standard",
		label: "标准（推荐）"
	}], "1:1", "standard");
	if (provider === "seedream") return profile(provider, model, configured, [{
		value: "auto",
		label: "模型自动"
	}], [
		"1K",
		"2K",
		"4K"
	].map((value) => ({
		value,
		label: value
	})), "auto", "2K");
	return profile(provider, model, configured, [
		"1:1",
		"3:2",
		"2:3",
		"16:9",
		"9:16"
	].map(option), [{
		value: "standard",
		label: "标准（推荐）"
	}], "1:1", "standard");
}
function profile(provider, model, configured, ratioOptions, qualityOptions, defaultRatio, defaultQuality) {
	return {
		provider,
		label: PROVIDER_LABELS[provider],
		model,
		configured,
		supportsEditing: true,
		ratioOptions,
		qualityOptions,
		defaultRatio,
		defaultQuality
	};
}
function option(value) {
	return {
		value,
		label: RATIO_LABELS[value] ?? value
	};
}
function providerConfig(config, provider, model) {
	if (model === void 0) return {
		...config,
		provider
	};
	switch (provider) {
		case "grok": return {
			...config,
			provider,
			grokModel: model
		};
		case "google": return {
			...config,
			provider,
			googleModel: model
		};
		case "openai": return {
			...config,
			provider,
			openaiModel: model
		};
		case "seedream": return {
			...config,
			provider,
			seedreamModel: model
		};
		case "dashscope": return {
			...config,
			provider,
			dashscopeModel: model
		};
	}
}
function assertAllowed(profile, input) {
	if (input.model !== profile.model) throw new Error("模型配置已变化，请刷新工作台后重试");
	if (!profile.ratioOptions.some((option) => option.value === input.ratio)) throw new Error("该 Provider 不支持所选比例");
	if (!profile.qualityOptions.some((option) => option.value === input.quality)) throw new Error("该 Provider 不支持所选清晰度");
	if (input.mode === "edit" && !profile.supportsEditing) throw new Error("该 Provider 暂不支持图生图");
}
async function readStudioReference(ctx, reference, signal) {
	if (reference === void 0) throw new Error("图生图需要至少一张参考图");
	if ("attachment" in reference) {
		const stored = await ctx.attachments.readImage(reference.attachment, signal);
		return {
			data: stored.data,
			mediaType: stored.ref.mediaType
		};
	}
	const data = decodeCanonicalBase64(reference.data);
	if (data.byteLength > ctx.attachments.imageLimits.maxImageBytes) throw new Error("参考图超过当前 DSH 的大小限制");
	await ctx.attachments.validateImage({
		data,
		mediaType: reference.mediaType,
		...reference.name === void 0 ? {} : { name: reference.name }
	});
	return {
		data,
		mediaType: reference.mediaType
	};
}
function decodeCanonicalBase64(value) {
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("参考图编码无效");
	const data = Buffer.from(value, "base64");
	if (data.byteLength === 0 || data.toString("base64") !== value) throw new Error("参考图编码无效");
	return new Uint8Array(data);
}
function openAISize(ratio) {
	if (ratio === "3:2") return "1536x1024";
	if (ratio === "2:3") return "1024x1536";
	return "1024x1024";
}
function dashScopeSize(ratio) {
	return {
		"1:1": "1024*1024",
		"3:2": "1536*1024",
		"2:3": "1024*1536",
		"16:9": "1664*928",
		"9:16": "928*1664"
	}[ratio] ?? "1024*1024";
}
function cloudProvider$1(value) {
	return CLOUD_IMAGE_PROVIDERS.includes(value);
}
//#endregion
//#region lib/types/tavern/scene-image-novelai.js
const models = {
	"nai-diffusion-5-full": {
		guidance: 7,
		characters: 22
	},
	"nai-diffusion-5-curated": {
		guidance: 7,
		characters: 22
	},
	"nai-diffusion-4-5-full": {
		guidance: 5,
		characters: 6
	},
	"nai-diffusion-4-5-curated": {
		guidance: 5,
		characters: 6
	},
	"nai-diffusion-4-full": {
		guidance: 5.5,
		characters: 6
	},
	"nai-diffusion-4-curated-preview": {
		guidance: 5.5,
		characters: 6
	},
	"nai-diffusion-3": {
		guidance: 5,
		characters: 0
	}
};
const NOVELAI_MODELS = Object.freeze(Object.keys(models));
function novelaiSettings(config) {
	if (!Object.hasOwn(models, config.model)) throw new Error("NovelAI 请选择已接入的 V5、V4.5、V4 或 Anime V3 模型");
	const dimensions = config.size.match(/^(\d+)x(\d+)$/);
	if (!dimensions || dimensions.slice(1).some((value) => Number(value) < 64 || Number(value) > 2048 || Number(value) % 64)) throw new Error("NovelAI 尺寸须为宽x高；本插件支持每边 64–2048 且为 64 的倍数");
	const [width, height] = dimensions.slice(1).map(Number);
	if (width * height > 3145728) throw new Error("NovelAI 图片面积不能超过 3145728 像素");
	return {
		...models[config.model],
		width,
		height
	};
}
/** Compile frozen per-person blocks, not current game variables. Image-local
* adjustments live in blocks; stale person.fields must not override them.
* Names identify records but aren't repeated as invented visual subjects. */
function novelaiPrompts(input) {
	const plan = input.plan;
	if (!plan || !Array.isArray(plan.blocks)) {
		if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 16e3) throw new Error("NovelAI 画面提示词为空或过长");
		return {
			base: input.prompt,
			characters: []
		};
	}
	const people = plan.people || [], ids = new Set(people.map((person) => person.id));
	if (ids.size !== people.length || plan.blocks.some((block) => block.owner !== "scene" && !ids.has(block.owner))) throw new Error("NovelAI 人物方案包含重复或未知人物");
	const characters = people.map((person) => ({
		id: person.id,
		caption: plan.blocks.filter((block) => block.owner === person.id && block.tags).map((block) => block.tags).join(", ")
	}));
	if (characters.some((person) => !person.caption)) throw new Error("NovelAI 人物方案缺少人物描述");
	const style = plan.styleOverride?.tags ?? plan.style?.tags ?? "";
	const base = [...plan.blocks.filter((block) => block.owner === "scene" && block.tags).map((block) => block.tags), style].filter(Boolean).join(", ");
	if (!base.trim() && !characters.length) throw new Error("NovelAI 画面提示词为空");
	if (base.length + characters.reduce((sum, person) => sum + person.caption.length, 0) > 16e3) throw new Error("NovelAI 组合提示词过长");
	return {
		base: base || characters.length + " people",
		characters
	};
}
function novelaiRequest(input, config) {
	const { width, height, guidance, characters: limit } = novelaiSettings(config);
	const prompt = novelaiPrompts(input);
	if (limit && prompt.characters.length > limit) throw new Error("当前 NovelAI 模型最多支持 " + limit + " 人，请选择 V5 或调整画面");
	const seed = randomInt(0, 4294967296);
	const captions = prompt.characters.map((person) => ({
		char_caption: person.caption,
		centers: [{
			x: .5,
			y: .5
		}]
	}));
	return {
		input: limit ? prompt.base : [prompt.base, ...prompt.characters.map((person) => person.caption)].filter(Boolean).join("\n"),
		model: config.model,
		action: "generate",
		parameters: {
			params_version: 4,
			width,
			height,
			scale: guidance,
			steps: 23,
			sampler: "k_euler_ancestral",
			noise_schedule: "karras",
			n_samples: 1,
			seed,
			negative_prompt: "",
			cfg_rescale: 0,
			dynamic_thresholding: false,
			legacy: false,
			legacy_v3_extend: false,
			deliberate_euler_ancestral_bug: false,
			prefer_brownian: true,
			...limit ? {
				use_coords: false,
				legacy_uc: false,
				v4_prompt: {
					caption: {
						base_caption: prompt.base,
						char_captions: captions
					},
					use_coords: false,
					use_order: true
				},
				v4_negative_prompt: {
					caption: {
						base_caption: "",
						char_captions: captions.map(() => ({
							char_caption: "",
							centers: [{
								x: .5,
								y: .5
							}]
						}))
					},
					legacy_uc: false
				}
			} : {
				sm: false,
				sm_dyn: false
			}
		}
	};
}
//#endregion
//#region lib/types/tavern/scene-image-comfy-workflow.js
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const safeKey = (value) => typeof value === "string" && /^[\w.:-]{1,120}$/.test(value) && ![
	"__proto__",
	"constructor",
	"prototype"
].includes(value);
const fail$1 = (message) => {
	throw new Error("ComfyUI 工作流：" + message);
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Import an API graph or a maintainer-prepared mapping. This never loads code,
* probes a server, or guesses an arbitrary node's input semantics. */
function comfyWorkflow(value) {
	if (value == null) return null;
	if (!object(value) || Buffer.byteLength(JSON.stringify(value)) > 512e3) fail$1("须为不超过 500 KB 的 API 格式 JSON");
	const wrapped = value.format === "dsh-tavern-comfy-v1";
	const graph = wrapped ? value.prompt : value;
	if (!object(graph) || Array.isArray(graph.nodes)) fail$1("请导出 API 格式，不能使用画布格式；复杂工作流需维护者提供映射文件");
	const entries = Object.entries(graph);
	if (!entries.length || entries.length > 200) fail$1("节点数须为 1–200");
	const prompt = Object.create(null);
	function check(value, depth = 0) {
		if (depth > 16) fail$1("嵌套过深");
		if (Array.isArray(value)) {
			for (const item of value) check(item, depth + 1);
			return;
		}
		if (object(value)) for (const [key, item] of Object.entries(value)) {
			if (!safeKey(key) || /^(?:api_?key|token|password|secret|authorization)$/i.test(key)) fail$1("不能在工作流中保存凭据或危险字段；请由服务器配置认证");
			check(item, depth + 1);
		}
		else if (![
			"string",
			"number",
			"boolean"
		].includes(typeof value) && value !== null) fail$1("参数须为 JSON 值");
	}
	for (const [id, node] of entries) {
		if (!safeKey(id) || !object(node) || typeof node.class_type !== "string" || !node.class_type || node.class_type.length > 200 || !object(node.inputs)) fail$1("节点结构无效");
		check(node.inputs);
		prompt[id] = {
			class_type: node.class_type,
			inputs: structuredClone(node.inputs)
		};
	}
	let outputNode = wrapped ? value.outputNode : void 0;
	if (!wrapped) {
		const outputs = entries.filter(([, node]) => node.class_type === "SaveImage");
		if (outputs.length !== 1) fail$1("无法确定唯一图片输出，请维护者提供映射文件");
		outputNode = outputs[0][0];
	}
	if (!safeKey(outputNode) || !prompt[outputNode]) fail$1("指定的图片输出节点不存在");
	const reachable = /* @__PURE__ */ new Set(), visiting = /* @__PURE__ */ new Set();
	function visit(id) {
		if (visiting.has(id)) fail$1("节点之间存在循环");
		if (reachable.has(id)) return;
		visiting.add(id);
		for (const value of Object.values(prompt[id].inputs)) if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1])) {
			if (!prompt[value[0]] || value[1] < 0) fail$1("节点连接无效");
			visit(value[0]);
		}
		visiting.delete(id);
		reachable.add(id);
	}
	visit(outputNode);
	let bindings = wrapped ? value.bindings : void 0;
	if (!wrapped) {
		const samplers = [...reachable].filter((id) => ["KSampler", "KSamplerAdvanced"].includes(prompt[id].class_type));
		if (samplers.length !== 1) fail$1("无法自动识别采样节点，请维护者提供映射文件");
		const id = samplers[0], node = prompt[id], positive = node.inputs.positive, negative = node.inputs.negative;
		if (!Array.isArray(positive) || prompt[positive[0]]?.class_type !== "CLIPTextEncode" || typeof prompt[positive[0]].inputs.text !== "string" || positive[0] === negative?.[0]) fail$1("无法区分正负提示词，请维护者提供映射文件");
		bindings = {
			positive: [{
				node: positive[0],
				input: "text"
			}],
			seed: [{
				node: id,
				input: node.class_type === "KSampler" ? "seed" : "noise_seed"
			}],
			batch: []
		};
	}
	if (!object(bindings) || Object.keys(bindings).some((key) => ![
		"positive",
		"seed",
		"batch"
	].includes(key))) fail$1("映射只能包含 positive、seed、batch");
	const normalized = {}, used = /* @__PURE__ */ new Set();
	for (const key of [
		"positive",
		"seed",
		"batch"
	]) {
		const items = bindings[key] || [];
		if (!Array.isArray(items) || items.length > 32 || key === "positive" && !items.length) fail$1("正向提示词映射不能为空，单项最多 32 个");
		normalized[key] = items.map((item) => {
			if (!object(item) || Object.keys(item).some((key) => !["node", "input"].includes(key)) || !safeKey(item.node) || !safeKey(item.input) || !reachable.has(item.node)) fail$1("映射指向无效或未连接到输出的节点");
			const value = prompt[item.node].inputs[item.input], slot = item.node + "/" + item.input;
			if (used.has(slot) || typeof value !== (key === "positive" ? "string" : "number") || key !== "positive" && !Number.isSafeInteger(value)) fail$1("映射字段重复或类型错误");
			used.add(slot);
			return {
				node: item.node,
				input: item.input
			};
		});
	}
	const selected = Object.fromEntries([...reachable].sort().map((id) => [id, prompt[id]]));
	const result = {
		format: "dsh-tavern-comfy-v1",
		name: wrapped && typeof value.name === "string" ? value.name.trim().slice(0, 120) : "已导入工作流",
		prompt: selected,
		bindings: normalized,
		outputNode
	};
	return {
		...result,
		digest: hash(result)
	};
}
function compileComfyWorkflow(workflow, text) {
	const config = comfyWorkflow(workflow);
	if (!config) fail$1("请先导入工作流");
	if (typeof text !== "string" || !text.trim() || text.length > 16e3) fail$1("画面提示词为空或过长");
	const prompt = structuredClone(config.prompt), seed = randomInt(0, 2 ** 47);
	for (const item of config.bindings.positive) prompt[item.node].inputs[item.input] = text;
	for (const item of config.bindings.seed) prompt[item.node].inputs[item.input] = seed;
	for (const item of config.bindings.batch) prompt[item.node].inputs[item.input] = 1;
	for (const node of Object.values(prompt)) if (Object.hasOwn(node.inputs, "batch_size")) {
		if (typeof node.inputs.batch_size !== "number") fail$1("批量数量由其他节点控制，请维护者改为单张模板");
		node.inputs.batch_size = 1;
	}
	return {
		prompt,
		outputNode: config.outputNode,
		digest: config.digest,
		...config.bindings.seed.length ? { seed } : {}
	};
}
//#endregion
//#region lib/types/tavern/scene-image-reference.js
const modes = /* @__PURE__ */ new Set([
	"gemini-3.1-flash-image",
	"gemini-3-pro-image",
	"gemini-2.5-flash-image"
]);
function imageReferenceCapability(config) {
	const supported = config.provider === "gemini" && modes.has(config.model);
	const service = [
		config.provider,
		config.baseURL,
		config.model
	].join(" · ");
	return {
		supported,
		service,
		gateway: createHash("sha256").update(service).digest("hex"),
		maxImages: supported ? 4 : 0,
		reason: supported ? "" : "当前渠道/模型尚未接入造型参考，仅使用文字外貌。"
	};
}
//#endregion
//#region lib/types/tavern/scene-image-channels.js
const channels = [
	{
		id: "dsh-image-gen",
		label: "dsh-image-gen（内置插件）",
		model: "",
		pluginProvider: "",
		aspectRatio: "",
		size: "",
		fields: [
			"model",
			"pluginProvider",
			"aspectRatio",
			"size"
		],
		hint: "随 Tavern 安装，无需另装插件。请到设置 → 插件 → Image generation 配置渠道、模型和 Key；此处无需重复填写。目前 Tavern 接入文生图，不含 ComfyUI 或参考图。"
	},
	{
		id: "comfyui",
		label: "ComfyUI",
		baseURL: "",
		authType: "none",
		username: "",
		fields: [
			"baseURL",
			"authType",
			"username"
		],
		hint: "使用维护者已部署的服务与工作流。导入 API 工作流或维护者准备的映射文件；不会安装模型、节点或清空共享队列。本机地址指 Tavern 服务器。"
	},
	{
		id: "novelai",
		label: "NovelAI / 同协议第三方",
		baseURL: "https://image.novelai.net",
		model: "nai-diffusion-5-full",
		size: "832x1216",
		fields: [
			"baseURL",
			"model",
			"size"
		],
		hint: "默认使用官方 V5 Full。第三方必须支持相同的 /ai/generate-image 协议与 ZIP 图片响应，不是 OpenAI 兼容地址。"
	},
	{
		id: "openai",
		label: "OpenAI / Images 兼容中转",
		baseURL: "https://api.openai.com/v1",
		model: "gpt-image-2",
		size: "1024x1024",
		fields: [
			"baseURL",
			"model",
			"size"
		],
		hint: "官方可使用默认地址与模型；兼容中转请填写自己的地址和模型。"
	},
	{
		id: "gemini",
		label: "Google Gemini 原生",
		baseURL: "https://generativelanguage.googleapis.com/v1beta",
		model: "gemini-3.1-flash-image",
		size: "1K",
		aspectRatio: "1:1",
		fields: [
			"baseURL",
			"model",
			"size",
			"aspectRatio"
		],
		hint: "使用 Interactions API，不是聊天兼容地址。"
	},
	{
		id: "banana",
		label: "Banana / Gemini 聊天兼容中转",
		baseURL: "",
		model: "",
		size: "1K",
		fields: [
			"baseURL",
			"model",
			"size"
		],
		hint: "填写支持 chat/completions 生图的中转地址与模型；不自动猜测接口。"
	},
	{
		id: "grok",
		label: "Grok Images",
		baseURL: "https://api.x.ai/v1",
		model: "grok-imagine-image-2.0",
		size: "1k",
		aspectRatio: "1:1",
		fields: [
			"baseURL",
			"model",
			"size",
			"aspectRatio"
		],
		hint: "使用 Images 接口；图片分辨率为 1k 或 2k。"
	},
	{
		id: "seedream",
		label: "Seedream / 火山方舟",
		baseURL: "https://ark.cn-beijing.volces.com/api/v3",
		model: "doubao-seedream-5-0-260128",
		size: "2K",
		fields: [
			"baseURL",
			"model",
			"size"
		],
		hint: "可填账号可用的模型或接入点；关闭组图，每次只请求一张。"
	},
	{
		id: "qwen",
		label: "百炼 Qwen-Image",
		baseURL: "https://dashscope.aliyuncs.com/api/v1",
		model: "qwen-image-3.0",
		size: "1024*1024",
		fields: [
			"baseURL",
			"model",
			"size"
		],
		hint: "默认北京地址。其他地域或工作空间请填写控制台提供的 API 根地址，密钥须属于相同地域。"
	},
	{
		id: "webui",
		label: "SD WebUI / Forge",
		baseURL: "",
		size: "512x512",
		authType: "none",
		username: "",
		fields: [
			"baseURL",
			"size",
			"authType",
			"username"
		],
		hint: "使用已开启 API 的 WebUI / Forge 服务，沿用服务端模型与默认采样参数。本机地址指 Tavern 服务器，不是访问页面的手机；不会安装模型或修改服务端全局设置。"
	}
];
const SCENE_IMAGE_CHANNELS = channels.filter((channel) => channel.id !== "dsh-image-gen").map(({ id, label, fields, hint, model }) => ({
	id,
	label,
	fields,
	hint,
	models: id === "novelai" ? NOVELAI_MODELS : model ? [model] : [],
	canListModels: [
		"openai",
		"banana",
		"gemini",
		"grok",
		"seedream"
	].includes(id)
}));
function sceneImageChannel(id = "openai") {
	const channel = channels.find((item) => item.id === id);
	if (!channel) throw new Error("未知或尚未接入的生图渠道");
	return channel;
}
function channelSettings(value = {}, id = value.provider || "openai") {
	const defaults = sceneImageChannel(id);
	const result = { provider: id };
	for (const field of defaults.fields) {
		if (value[field] !== void 0 && typeof value[field] !== "string") throw new Error("渠道配置须为文本");
		result[field] = (value[field] ?? defaults[field] ?? "").trim();
		if (result[field].length > (field === "baseURL" ? 2e3 : 200)) throw new Error("渠道配置过长");
	}
	if (result.baseURL) {
		const url = new URL(result.baseURL);
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("生图地址须为不含密钥、查询参数的 HTTP(S) API 根地址");
	}
	if (["webui", "comfyui"].includes(id)) {
		result.model = "";
		if (![
			"none",
			"basic",
			"bearer"
		].includes(result.authType)) throw new Error("请选择有效的自建服务鉴权方式");
		if (/[:\r\n]/.test(result.username)) throw new Error("鉴权用户名不能包含冒号或换行");
	}
	if (id === "webui") {
		const dimensions = result.size.match(/^(\d+)x(\d+)$/);
		if (!dimensions || dimensions.slice(1).some((value) => Number(value) < 64 || Number(value) > 2048 || Number(value) % 8)) throw new Error("WebUI 尺寸须为宽x高，每边 64–2048 且为 8 的倍数");
	}
	if (id === "novelai") novelaiSettings(result);
	if (id === "comfyui") result.workflow = comfyWorkflow(value.workflow);
	return result;
}
function imageCredentialRef(provider = "openai", authType) {
	sceneImageChannel(provider);
	if (["webui", "comfyui"].includes(provider) && authType === "basic") return "DSH_TAVERN_IMAGE_" + provider.toUpperCase() + "_PASSWORD";
	return provider === "openai" ? "DSH_TAVERN_IMAGE_API_KEY" : "DSH_TAVERN_IMAGE_" + provider.toUpperCase() + "_API_KEY";
}
function channelNeedsKey(config) {
	return config.provider !== "dsh-image-gen" && (!["webui", "comfyui"].includes(config.provider) || config.authType !== "none");
}
function channelReady(config, hasKey) {
	if (config.provider === "dsh-image-gen") return config.pluginReady === true;
	return Boolean(config.baseURL && (config.provider === "comfyui" ? config.workflow : config.provider === "webui" || config.model) && (!channelNeedsKey(config) || hasKey) && (config.authType !== "basic" || config.username));
}
function imageChannelRequest(input) {
	const config = channelSettings(input);
	const references = input.referenceImages || [];
	const capability = imageReferenceCapability(config);
	if (!Array.isArray(references) || references.length && (!capability.supported || references.length > capability.maxImages)) throw new Error("当前渠道不支持所选参考图，未发送请求");
	if (config.provider === "comfyui") throw new Error("ComfyUI 须通过任务提交与查询流程调用");
	if (!channelReady(config, input.apiKey)) throw new Error("请先配置生图渠道地址、模型与密钥");
	const headers = {
		"content-type": "application/json",
		authorization: "Bearer " + input.apiKey
	};
	const prompt = input.prompt;
	let path = "images/generations", body;
	if (config.provider === "novelai") {
		path = "ai/generate-image";
		body = novelaiRequest(input, config);
	} else if (config.provider === "webui") {
		path = "sdapi/v1/txt2img";
		if (config.authType === "none") delete headers.authorization;
		else if (config.authType === "basic") headers.authorization = "Basic " + Buffer.from(config.username + ":" + input.apiKey, "utf8").toString("base64");
		const [width, height] = config.size.split("x").map(Number);
		body = {
			prompt,
			width,
			height,
			batch_size: 1,
			n_iter: 1,
			seed: -1,
			send_images: true,
			save_images: false
		};
	} else if (config.provider === "gemini") {
		path = "interactions";
		delete headers.authorization;
		headers["x-goog-api-key"] = input.apiKey;
		body = {
			model: config.model,
			input: [{
				type: "text",
				text: prompt
			}],
			response_format: {
				type: "image",
				mime_type: "image/png",
				aspect_ratio: config.aspectRatio,
				image_size: config.size
			}
		};
		for (const image of references) {
			if (!Buffer.isBuffer(image.data) || !image.data.length || image.data.length > 8388608 || ![
				"image/png",
				"image/jpeg",
				"image/webp"
			].includes(image.mediaType)) throw new Error("参考图数据不合法");
			body.input.push({
				type: "text",
				text: "Identity reference for " + image.name + " (identity " + image.personId + "). " + (image.description ? "Identify this person in the reference using these source-image cues: " + image.description + ". " : "") + "Use only this selected person, not other people in the reference. Use only identity/appearance cues. Follow the written scene for clothing, pose, expression, placement and background; do not copy the old composition or outfit."
			}, {
				type: "image",
				mime_type: image.mediaType,
				data: image.data.toString("base64")
			});
		}
	} else if (config.provider === "banana") {
		path = "chat/completions";
		body = {
			model: config.model,
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text: prompt
				}]
			}],
			size: config.size,
			stream: false
		};
	} else if (config.provider === "qwen") {
		if (!config.model.startsWith("qwen-image")) throw new Error("百炼渠道当前只接入 Qwen-Image，不支持其他万相模型");
		path = "services/aigc/multimodal-generation/generation";
		body = {
			model: config.model,
			input: { messages: [{
				role: "user",
				content: [{ text: prompt }]
			}] },
			parameters: {
				size: config.size,
				n: 1,
				prompt_extend: false
			}
		};
	} else if (config.provider === "grok") {
		if (!["1k", "2k"].includes(config.size)) throw new Error("Grok 分辨率须为 1k 或 2k");
		body = {
			model: config.model,
			prompt,
			n: 1,
			aspect_ratio: config.aspectRatio,
			resolution: config.size
		};
	} else if (config.provider === "seedream") body = {
		model: config.model,
		prompt,
		size: config.size,
		sequential_image_generation: "disabled",
		stream: false,
		response_format: "url"
	};
	else body = {
		model: config.model,
		prompt,
		size: config.size,
		n: 1
	};
	return {
		url: new URL(path, config.baseURL.replace(/\/+$/, "") + "/").href,
		headers,
		body
	};
}
/** Only image-bearing fields count as results, never a thought or arbitrary link. */
function channelImageResult(provider = "openai", payload) {
	if (provider === "webui") {
		const data = payload?.images?.[0];
		return typeof data === "string" ? data.startsWith("data:") ? { url: data } : { b64_json: data } : void 0;
	}
	if (provider === "gemini") {
		const direct = payload?.output_image;
		const parts = (Array.isArray(payload?.steps) ? payload.steps : []).filter((step) => step?.type === "model_output").flatMap((step) => Array.isArray(step.content) ? step.content : []);
		const image = typeof direct?.data === "string" ? direct : parts.find((part) => part?.type === "image" && typeof part.data === "string");
		return image ? { b64_json: image.data } : void 0;
	}
	if (provider === "qwen") {
		if (payload?.code) throw new Error("百炼未生成图片，请检查模型、地域和账号配置");
		const parts = payload?.output?.choices?.[0]?.message?.content;
		const image = Array.isArray(parts) ? parts.find((part) => typeof part?.image === "string") : void 0;
		return image ? { url: image.image } : void 0;
	}
	if (provider === "banana") {
		const message = payload?.choices?.[0]?.message;
		const image = [
			message?.content,
			message?.images,
			message?.reasoning_details?.images
		].filter(Array.isArray).flat().find((part) => part?.type === "image_url" && part.image_url);
		if (image) return { url: typeof image.image_url === "string" ? image.image_url : image.image_url.url };
		if (typeof message?.content === "string") {
			const url = message.content.match(/!\[[^\]]*\]\(((?:https?:\/\/|data:image\/[^;]+;base64,)[^\s)]+)\)/)?.[1];
			if (url) return { url };
		}
		return;
	}
	const images = payload?.data || payload?.images || payload?.output;
	return Array.isArray(images) ? images[0] : void 0;
}
//#endregion
//#region lib/types/tavern/scene-image-auth.js
function sceneImageAuthProbe(provider, baseURL, canListModels) {
	if (provider === "grok" && baseURL === "https://api.x.ai/v1") return {
		path: "/api-key",
		kind: "xai-key",
		trusted: true
	};
	if (!canListModels) return null;
	return {
		path: "/models",
		kind: provider === "gemini" ? "gemini-models" : "models",
		trusted: provider === "openai" && baseURL === "https://api.openai.com/v1" || provider === "gemini" && baseURL === "https://generativelanguage.googleapis.com/v1beta"
	};
}
async function verifySceneImageKey({ probe, baseURL, headers, fetchImpl, signal, readJson }) {
	const url = baseURL + probe.path;
	let httpStatus;
	const unknown = (message) => ({
		status: "reachable",
		apiKeyStatus: "unverified",
		httpStatus,
		probePath: probe.path,
		message
	});
	let response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers,
			redirect: "manual",
			signal
		});
		httpStatus = response.status;
		if ([401, 403].includes(httpStatus) || httpStatus === 400 && (probe.kind === "xai-key" || probe.trusted && probe.kind === "gemini-models")) return {
			status: "auth_failed",
			apiKeyStatus: "rejected",
			httpStatus,
			probePath: probe.path,
			message: "连接成功，但 Key 验证请求被拒绝。请检查 API Key、访问权限或服务地址。"
		};
		if (!response.ok) return unknown("连接成功，但服务暂时无法完成 Key 验证。可展开连接诊断查看状态。");
		const payload = await readJson(response);
		if (probe.kind === "xai-key") {
			const flags = [
				"api_key_disabled",
				"api_key_blocked",
				"team_blocked"
			];
			if (flags.some((field) => payload?.[field] === true)) return {
				status: "auth_failed",
				apiKeyStatus: "rejected",
				httpStatus,
				probePath: probe.path,
				message: "连接成功，但 API Key 已被禁用、封锁，或所属团队被封锁。"
			};
			if (!flags.every((field) => payload?.[field] === false)) return unknown("连接成功，但 Key 状态返回不完整，无法确认有效性。");
		} else {
			const models = probe.kind === "gemini-models" ? payload?.models : payload?.data;
			if (!Array.isArray(models) || !models.every((item) => typeof (probe.kind === "gemini-models" ? item?.name : item?.id) === "string")) return unknown("连接成功，但验证接口没有返回有效模型列表，无法确认 Key 有效性。");
		}
		if (!probe.trusted) {
			const control = await fetchImpl(url, {
				method: "GET",
				headers: { accept: "application/json" },
				redirect: "manual",
				signal
			});
			try {
				if (![401, 403].includes(control.status)) return unknown("连接成功，但此中转的只读接口未明确要求鉴权，无法确认 API Key 有效性。");
			} finally {
				await control.body?.cancel().catch(() => {});
			}
		}
		return {
			status: "connected",
			apiKeyStatus: "verified",
			httpStatus,
			probePath: probe.path,
			message: "连接成功，API Key 验证通过。未进行生图，不保证余额或图片模型权限。"
		};
	} catch (error) {
		if (signal.aborted || !response) throw error;
		return unknown("连接成功，但验证响应无法读取，未确认 API Key 有效性。");
	} finally {
		await response?.body?.cancel().catch(() => {});
	}
}
//#endregion
//#region lib/types/tavern/scene-image-connection.js
const MAX_BYTES = 262144;
function endpoint$1(value) {
	if (typeof value !== "string" || value.length > 2e3) throw new Error("请填写 API 根地址");
	let url;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("请填写有效的 HTTP(S) API 根地址");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("API 根地址不能包含密钥、查询参数或账号密码");
	return url.href.replace(/\/+$/, "");
}
async function limitedJson(response) {
	if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("模型列表过大，请手动填写模型");
	const reader = response.body?.getReader();
	if (!reader) throw new Error("服务没有返回模型列表，请手动填写模型");
	let size = 0;
	const chunks = [];
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BYTES) throw new Error("模型列表过大，请手动填写模型");
			chunks.push(Buffer.from(value));
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			throw new Error("服务未返回有效模型列表，请手动填写模型");
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
}
/** Read-only setup checks. No generation, settings writes, or redirect following. */
function createSceneImageConnection({ settings, credentials, fetchImpl = fetch, timeoutMs = 5e3 }) {
	async function request(input = {}, listModels = false) {
		if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("连接配置必须是对象");
		const channel = sceneImageChannel(input.provider);
		const current = await settings(channel.id);
		const baseURL = endpoint$1(input.baseURL ?? current.baseURL);
		const authType = ["webui", "comfyui"].includes(channel.id) ? input.authType ?? current.authType : "bearer";
		if (![
			"none",
			"basic",
			"bearer"
		].includes(authType)) throw new Error("请选择有效的鉴权方式");
		if (input.apiKey !== void 0 && typeof input.apiKey !== "string") throw new Error("API Key 必须是文本");
		let apiKey = authType === "basic" ? input.apiKey || "" : input.apiKey?.trim() || "";
		const username = String(input.username ?? current.username ?? "");
		const sameEndpoint = current.baseURL && baseURL === endpoint$1(current.baseURL);
		if (!apiKey && authType !== "none" && sameEndpoint && authType === (current.authType || "bearer") && username === (current.username || "")) apiKey = (await credentials()?.resolve(imageCredentialRef(channel.id, authType)))?.value || "";
		if (!apiKey && authType !== "none" && current.hasKey && !sameEndpoint) throw new Error("地址已修改，请重新填写 API Key 后测试，旧密钥不会发送到新地址");
		if (/[\r\n]/.test(apiKey) || /[:\r\n]/.test(username)) throw new Error("鉴权信息格式不正确");
		if (listModels && !SCENE_IMAGE_CHANNELS.find((item) => item.id === channel.id).canListModels) return {
			models: [],
			message: "此渠道暂不支持自动获取模型，请使用预设或手动填写。"
		};
		const headers = { accept: "application/json" };
		if (apiKey && authType !== "none") {
			if (authType === "basic") headers.authorization = "Basic " + Buffer.from(username + ":" + apiKey).toString("base64");
			else if (channel.id === "gemini") headers["x-goog-api-key"] = apiKey;
			else headers.authorization = "Bearer " + apiKey;
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response;
		try {
			const probe = sceneImageAuthProbe(channel.id, baseURL, SCENE_IMAGE_CHANNELS.find((item) => item.id === channel.id).canListModels);
			if (!listModels && apiKey && authType !== "none" && probe) return await verifySceneImageKey({
				probe,
				baseURL,
				headers,
				fetchImpl,
				signal: controller.signal,
				readJson: limitedJson
			});
			response = await fetchImpl(listModels ? baseURL + "/models" : baseURL + "/", {
				method: listModels ? "GET" : "HEAD",
				headers,
				redirect: "manual",
				signal: controller.signal
			});
			const httpStatus = response.status;
			if ([401, 403].includes(httpStatus)) return {
				status: "auth_failed",
				apiKeyStatus: "rejected",
				httpStatus,
				probePath: listModels ? "/models" : "/",
				models: [],
				message: "服务已响应，但鉴权被拒绝，请检查 API Key 或访问权限。"
			};
			if (!listModels) return {
				status: response.ok && authType === "none" ? "connected" : "reachable",
				httpStatus,
				apiKeyStatus: authType === "none" ? "not_required" : apiKey ? "unsupported" : "missing",
				probePath: "/",
				message: authType === "none" ? response.ok ? "连接成功。当前配置无需鉴权，未进行生图。" : "网络可达，但服务未返回成功状态。当前配置无需鉴权，未进行生图。" : apiKey ? "无法验证 API Key：此渠道暂不支持只读鉴权检查。网络可达，未进行生图。" : "尚未验证 API Key：请填写 Key 后重试。网络可达，未进行生图。"
			};
			if (!response.ok) return {
				models: [],
				httpStatus,
				message: `模型列表获取失败（HTTP ${httpStatus}），可手动填写模型。`
			};
			const payload = await limitedJson(response);
			const entries = channel.id === "gemini" ? payload.models : payload.data;
			if (!Array.isArray(entries)) throw new Error("服务未返回有效模型列表，请手动填写模型");
			const models = [...new Set(entries.map((item) => channel.id === "gemini" ? item?.name?.replace(/^models\//, "") : item?.id).filter((id) => typeof id === "string" && id.trim() && id.length <= 200 && !/[\u0000-\u001f]/.test(id) && (!apiKey || !id.includes(apiKey))))].slice(0, 500);
			return {
				models,
				message: models.length ? "已获取模型列表。列表不保证每个模型支持生图，请选择图片模型。" : "没有获取到模型，可手动填写。"
			};
		} catch (error) {
			if (controller.signal.aborted) return {
				status: "failed",
				models: [],
				message: "连接超时（5 秒），请检查地址或网络。"
			};
			return {
				status: "failed",
				models: [],
				message: response ? "模型列表读取失败，可手动填写模型。" : "连接失败，请检查地址、网络或 HTTPS 证书。"
			};
		} finally {
			clearTimeout(timer);
			await response?.body?.cancel().catch(() => {});
		}
	}
	return {
		test: (input) => request(input),
		models: (input) => request(input, true)
	};
}
[
	{
		id: "default",
		label: "默认",
		tags: ""
	},
	{
		id: "anime",
		label: "日系插画",
		tags: "Japanese illustration, clean linework, cel shading"
	},
	{
		id: "photo",
		label: "写实摄影",
		tags: "photorealistic photography, lifelike textures"
	},
	{
		id: "watercolor",
		label: "水彩",
		tags: "watercolor painting, translucent pigments, paper texture"
	},
	{
		id: "ink",
		label: "水墨",
		tags: "Chinese ink wash painting, expressive brushwork, ink on paper"
	},
	{
		id: "custom",
		label: "自定义",
		tags: ""
	}
].map(({ id, label }) => ({
	id,
	label
}));
//#endregion
//#region lib/types/tavern/scene-image-zip.js
const fail = () => {
	throw new Error("NovelAI 返回的图片 ZIP 无效或超过大小限制");
};
function crc32(bytes) {
	let value = 4294967295;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 3988292384 : 0);
	}
	return (value ^ 4294967295) >>> 0;
}
/** Read one raster image in memory. Never extract provider filenames to disk.
* Only stored/deflate, single-volume ZIPs are accepted; directory sizes alone
* are not trusted as a decompression bound. The attachment service subsequently
* decodes the image itself. ZIP metadata is not imported into game state. */
function sceneImageFromZip(input, maxBytes) {
	const zip = Buffer.from(input);
	if (zip.length < 22 || zip.length > maxBytes + 65536) fail();
	let end = -1;
	for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65557); offset--) if (zip.readUInt32LE(offset) === 101010256 && offset + 22 + zip.readUInt16LE(offset + 20) === zip.length) {
		end = offset;
		break;
	}
	if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) fail();
	const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), start = zip.readUInt32LE(end + 16);
	if (!count || count > 32 || zip.readUInt16LE(end + 8) !== count || start + size !== end) fail();
	let offset = start, expanded = 0, image;
	const names = /* @__PURE__ */ new Set(), ranges = [];
	for (let index = 0; index < count; index++) {
		if (offset + 46 > end || zip.readUInt32LE(offset) !== 33639248) fail();
		const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10);
		const crc = zip.readUInt32LE(offset + 16), compressed = zip.readUInt32LE(offset + 20), length = zip.readUInt32LE(offset + 24);
		const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
		const local = zip.readUInt32LE(offset + 42), nameStart = offset + 46, next = nameStart + nameLength + extraLength + commentLength;
		if (next > end || flags & -2063 || ![0, 8].includes(method) || method === 0 && flags & 6 || zip.readUInt16LE(offset + 34)) fail();
		const nameBytes = zip.subarray(nameStart, nameStart + nameLength), name = nameBytes.toString("utf8");
		if (!name || name.includes("\0") || /^(?:\/|\\|[a-z]:)/i.test(name) || name.split(/[\\/]/).includes("..") || names.has(name)) fail();
		names.add(name);
		expanded += length;
		if (expanded > maxBytes + 65536 || compressed > maxBytes + 65536 || local + 30 > start || zip.readUInt32LE(local) !== 67324752) fail();
		const localNameLength = zip.readUInt16LE(local + 26), localExtraLength = zip.readUInt16LE(local + 28);
		const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
		if (dataEnd > start || zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== method || !zip.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) fail();
		if (!(flags & 8) && (zip.readUInt32LE(local + 14) !== crc || zip.readUInt32LE(local + 18) !== compressed || zip.readUInt32LE(local + 22) !== length)) fail();
		if (ranges.some(([begin, stop]) => local < stop && dataEnd > begin)) fail();
		ranges.push([local, dataEnd]);
		if (/\.(?:png|jpe?g|webp)$/i.test(name)) {
			if (image || !length || length > maxBytes) fail();
			const bytes = zip.subarray(dataStart, dataEnd);
			try {
				image = method === 0 ? Buffer.from(bytes) : inflateRawSync(bytes, { maxOutputLength: Math.min(maxBytes, length) });
			} catch {
				fail();
			}
			if (image.length !== length || crc32(image) !== crc) fail();
		}
		offset = next;
	}
	if (offset !== end || !image) fail();
	return image;
}
//#endregion
//#region lib/types/tavern/scene-image-comfy.js
const uuid = (value) => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const opaqueId = (value) => typeof value === "string" && /^[\w-]{1,128}$/.test(value) && ![
	"__proto__",
	"constructor",
	"prototype"
].includes(value);
/** One submitted job, then read-only reconciliation. Persist before dispatch:
* ComfyUI accepts client IDs but does not promise idempotent POST /prompt. */
async function generateComfyImage(input, deps) {
	const config = channelSettings(input);
	if (!channelReady(config, input.apiKey)) throw new Error("请先配置 ComfyUI 地址、工作流与必要认证");
	const request = deps.fetch || fetch, maxBytes = input.maxBytes || 20971520;
	const headers = {};
	if (config.authType === "basic") headers.authorization = "Basic " + Buffer.from(config.username + ":" + input.apiKey).toString("base64");
	if (config.authType === "bearer") headers.authorization = "Bearer " + input.apiKey;
	const endpoint = (path) => new URL(path, config.baseURL.replace(/\/+$/, "") + "/").href;
	async function json(path, body) {
		const response = await request(endpoint(path), {
			method: body ? "POST" : "GET",
			redirect: "error",
			signal: input.signal,
			headers: {
				...headers,
				...body ? { "content-type": "application/json" } : {}
			},
			...body ? { body: JSON.stringify(body) } : {}
		});
		if (!response.ok) {
			await response.body?.cancel();
			const error = /* @__PURE__ */ new Error("ComfyUI 请求失败（HTTP " + response.status + "）");
			error.status = response.status;
			throw error;
		}
		const bytes = await deps.readBytes(response, 2097152);
		try {
			return JSON.parse(bytes.toString("utf8"));
		} catch {
			throw new Error("ComfyUI 未返回有效 JSON");
		}
	}
	let task = input.providerTask;
	const saveTask = async (update) => {
		task = {
			...task,
			...update
		};
		await input.onProviderTask?.(structuredClone(task));
	};
	if (task) {
		if (task.provider !== "comfyui" || !opaqueId(task.promptId) || task.baseURL !== config.baseURL || task.workflowDigest !== config.workflow.digest || task.outputNode !== config.workflow.outputNode) throw new Error("原 ComfyUI 任务与当前配置不匹配，请恢复原配置后查询");
	} else {
		const compiled = compileComfyWorkflow(config.workflow, input.prompt);
		task = {
			provider: "comfyui",
			promptId: randomUUID(),
			clientId: randomUUID(),
			baseURL: config.baseURL,
			workflowDigest: compiled.digest,
			outputNode: compiled.outputNode,
			state: "submitting",
			...compiled.seed === void 0 ? {} : { seed: compiled.seed }
		};
		await saveTask({});
		let response;
		try {
			response = await json("prompt", {
				prompt: compiled.prompt,
				prompt_id: task.promptId,
				client_id: task.clientId
			});
		} catch (error) {
			if ([
				400,
				401,
				402,
				403,
				404,
				422
			].includes(error.status)) await saveTask({ state: "rejected" });
			throw error;
		}
		if (response?.error || !opaqueId(response?.prompt_id)) {
			if (response?.error) await saveTask({ state: "rejected" });
			throw new Error("ComfyUI 未确认任务，请检查工作流节点与服务配置；不会自动重新提交");
		}
		await saveTask({
			promptId: response.prompt_id,
			state: "pending"
		});
	}
	for (;;) {
		input.signal?.throwIfAborted();
		const result = (await json("history/" + encodeURIComponent(task.promptId)))?.[task.promptId];
		if (result) {
			if (result.status?.status_str === "error") {
				await saveTask({ state: "failed" });
				throw new Error("ComfyUI 执行失败或被中止，请检查工作流与服务器日志");
			}
			if (result.status?.completed === true || result.status?.status_str === "success") {
				const images = result.outputs?.[task.outputNode]?.images;
				if (!Array.isArray(images) || images.length !== 1) {
					await saveTask({ state: "failed" });
					throw new Error("ComfyUI 工作流未在指定输出返回唯一图片，请使用单图模板");
				}
				const image = images[0];
				if (typeof image.filename !== "string" || image.filename.length > 256 || /[\\/\0]/.test(image.filename) || !image.filename || !["output", "temp"].includes(image.type) || typeof image.subfolder !== "string" || image.subfolder.length > 1024 || /[\\\0]/.test(image.subfolder) || image.subfolder.startsWith("/") || image.subfolder.split("/").includes("..")) throw new Error("ComfyUI 图片位置不合法");
				const response = await request(endpoint("view?" + new URLSearchParams({
					filename: image.filename,
					subfolder: image.subfolder,
					type: image.type
				})), {
					headers,
					signal: input.signal,
					redirect: "error"
				});
				if (!response.ok) {
					await response.body?.cancel();
					throw new Error("ComfyUI 图片读取失败（HTTP " + response.status + "）");
				}
				const imageData = deps.decodeImage(await deps.readBytes(response, maxBytes), maxBytes);
				await saveTask({
					state: "succeeded",
					image: {
						filename: image.filename,
						subfolder: image.subfolder,
						type: image.type
					}
				});
				return {
					...imageData,
					metadata: {
						promptId: task.promptId,
						workflowDigest: task.workflowDigest,
						...task.seed === void 0 ? {} : { seed: task.seed }
					}
				};
			}
		}
		if (task.state === "submitting" && uuid(task.promptId)) {
			const queue = await json("queue");
			const entry = [...Array.isArray(queue?.queue_running) ? queue.queue_running : [], ...Array.isArray(queue?.queue_pending) ? queue.queue_pending : []].find((item) => Array.isArray(item) && (item[1] === task.promptId || item[3]?.client_id === task.clientId));
			if (entry && opaqueId(entry[1])) await saveTask({
				promptId: entry[1],
				state: "pending"
			});
			else throw new Error("ComfyUI 原任务结果未确认，服务可能已接单；不会重新提交，请稍后查询或检查服务器历史");
		}
		await (deps.wait || ((ms) => setTimeout$1(ms, void 0, { signal: input.signal })))(1e3);
	}
}
//#endregion
//#region lib/types/tavern/redact.js
const secretKey = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret)$/i;
function redactDiagnostic(value, depth = 0) {
	if (depth > 24) return "[depth limit]";
	if (typeof value === "string") return value.replace(/https?:\/\/[^\s"'<>]+/gi, (address) => {
		try {
			const url = new URL(address);
			url.username = "";
			url.password = "";
			url.search = "";
			url.hash = "";
			return url.href;
		} catch {
			return "[URL redacted]";
		}
	}).replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, "[REDACTED]").replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]").replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@").replace(/([?&](?:token|key|api_key|apiKey|access_token|auth|secret|password)=)[^\s&#"'<>]*/gi, "$1[REDACTED]").replace(/((?:api[-_]?key|access[-_]?token|password|secret|authorization)["']?\s*[=:]\s*["']?)[^\s,;"'<>]+/gi, "$1[REDACTED]");
	if (Array.isArray(value)) return value.map((item) => redactDiagnostic(item, depth + 1));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[REDACTED]" : redactDiagnostic(item, depth + 1)]));
	return value;
}
function redactSceneDiagnostic(value, secrets = [], depth = 0) {
	if (depth > 24) return "[depth limit]";
	if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[image bytes omitted]";
	if (typeof value === "string") {
		for (const secret of secrets.filter((item) => typeof item === "string" && item)) value = value.replaceAll(secret, "[REDACTED]");
		return redactDiagnostic(value.replace(/data:image\/[^\s"']+/gi, "[image bytes omitted]"));
	}
	if (Array.isArray(value)) return value.map((item) => redactSceneDiagnostic(item, secrets, depth + 1));
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:base64|b64_json|image_data|image_bytes|image_base64)$/i.test(key) || value.type === "image" && key === "data" ? "[image bytes omitted]" : /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|client[-_]?secret)$/i.test(key) ? "[REDACTED]" : redactSceneDiagnostic(item, secrets, depth + 1)]));
	return value;
}
//#endregion
//#region lib/types/tavern/scene-image-provider.js
async function boundedBytes(response, limit) {
	if (Number(response.headers.get("content-length")) > limit) {
		await response.body?.cancel();
		throw new Error("生图响应过大");
	}
	const chunks = [];
	let length = 0;
	if (response.body) for await (const chunk of response.body) {
		length += chunk.length;
		if (length > limit) throw new Error("生图响应过大");
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}
function imageBytes(data, maxBytes) {
	if (!data.length || data.length > maxBytes) throw new Error("图片为空或超过大小限制");
	let mediaType;
	if (data.subarray(0, 8).equals(Buffer.from([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]))) mediaType = "image/png";
	else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mediaType = "image/jpeg";
	else if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) mediaType = "image/gif";
	else if (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") mediaType = "image/webp";
	if (!mediaType) throw new Error("服务没有返回支持的图片格式");
	return {
		data,
		mediaType
	};
}
function privateAddress(address) {
	if (isIP(address) !== 4) return true;
	const [a, b] = address.split(".").map(Number);
	return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
}
/** Never send generation credentials to a provider-returned image URL. */
async function validateImageDownload(url, baseURL) {
	const target = new URL(url);
	if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new Error("图片下载地址不合法");
	if (target.origin === new URL(baseURL).origin) return target.href;
	if (target.protocol !== "https:") throw new Error("第三方图片下载地址必须使用 HTTPS");
	const addresses = await lookup(target.hostname, { all: true });
	if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw new Error("拒绝第三方图片的内网下载地址");
	return target.href;
}
function downloadPublicImage(url, signal) {
	return new Promise((resolve, reject) => {
		const request$1 = request(url, {
			signal,
			lookup(host, options, callback) {
				lookup(host, { all: true }).then((addresses) => {
					if (!addresses.length || addresses.some((item) => privateAddress(item.address))) return callback(/* @__PURE__ */ new Error("拒绝第三方图片的内网下载地址"));
					const first = addresses[0];
					if (options.all) callback(null, [first]);
					else callback(null, first.address, first.family);
				}, callback);
			}
		}, (response) => {
			if (response.statusCode !== 200) {
				response.resume();
				reject(/* @__PURE__ */ new Error("图片下载失败（HTTP " + response.statusCode + "）"));
				return;
			}
			const headers = new Headers();
			for (const [key, value] of Object.entries(response.headers)) if (value !== void 0) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
			resolve(new Response(Readable.toWeb(response), {
				status: 200,
				headers
			}));
		});
		request$1.on("error", reject);
		request$1.end();
	});
}
async function generateSceneImage(input, deps = {}) {
	let outcome = "not_requested";
	const request = deps.fetch || fetch;
	let sequence = 0;
	async function emit(event) {
		try {
			await input.onProviderRequest?.(redactSceneDiagnostic(event, [input.apiKey]));
		} catch {}
	}
	async function observedRequest(url, init, send = request) {
		const requestId = ++sequence, method = init?.method || "GET";
		let body;
		if (typeof init?.body === "string") try {
			body = JSON.parse(init.body);
		} catch {
			body = "[non-JSON request omitted]";
		}
		await emit({
			requestId,
			at: Date.now(),
			phase: "dispatch",
			method,
			url: String(url),
			...body ? { body } : {}
		});
		if (method === "POST") outcome = "unconfirmed";
		const began = Date.now();
		try {
			const response = await send(url, init);
			await emit({
				requestId,
				at: Date.now(),
				phase: "response",
				method,
				status: response.status,
				durationMs: Date.now() - began,
				providerRequestId: response.headers?.get?.("x-request-id") || response.headers?.get?.("request-id") || null
			});
			return response;
		} catch (error) {
			await emit({
				requestId,
				at: Date.now(),
				phase: "transport-error",
				method,
				durationMs: Date.now() - began,
				error: String(error.message || error)
			});
			throw error;
		}
	}
	try {
		return await requestSceneImage(input, {
			...deps,
			fetch: observedRequest,
			publicDownload: (url, signal) => observedRequest(url, { signal }, (address, options) => downloadPublicImage(address, options.signal)),
			usePublicDownload: !deps.fetch
		});
	} catch (error) {
		error.imageOutcome ||= outcome;
		throw error;
	}
}
async function requestSceneImage(input, deps) {
	if (input.provider === "comfyui") return generateComfyImage(input, {
		...deps,
		readBytes: boundedBytes,
		decodeImage: imageBytes
	});
	const request = deps.fetch || fetch;
	const maxBytes = input.maxBytes || 20971520;
	const spec = imageChannelRequest(input);
	const response = await request(spec.url, {
		method: "POST",
		redirect: "error",
		signal: input.signal,
		headers: spec.headers,
		body: JSON.stringify(spec.body)
	});
	if (!response.ok) {
		await response.body?.cancel();
		const error = /* @__PURE__ */ new Error("生图服务请求失败（HTTP " + response.status + "）");
		if ([
			400,
			401,
			402,
			403,
			404,
			422
		].includes(response.status)) error.imageOutcome = "rejected";
		throw error;
	}
	if (input.provider === "novelai") return {
		...imageBytes(sceneImageFromZip(await boundedBytes(response, maxBytes + 65536), maxBytes), maxBytes),
		metadata: {
			seed: spec.body.parameters.seed,
			model: spec.body.model,
			request: spec.body
		}
	};
	let payload;
	try {
		payload = JSON.parse((await boundedBytes(response, Math.ceil(maxBytes * 1.4) + 4096)).toString("utf8"));
	} catch (error) {
		if (error.message === "生图响应过大") throw error;
		throw new Error("生图服务返回的不是有效 JSON");
	}
	const item = channelImageResult(input.provider, payload);
	if (!item || typeof item !== "object") throw new Error("生图服务没有返回图片");
	let metadata;
	if (input.provider === "webui") try {
		const info = typeof payload.info === "string" ? JSON.parse(payload.info) : payload.info;
		const values = {};
		if (Number.isSafeInteger(info?.seed) && info.seed >= 0) values.seed = info.seed;
		if (typeof info?.sd_model_name === "string" && info.sd_model_name.length <= 200) values.model = info.sd_model_name;
		if (typeof info?.sd_model_hash === "string" && /^[a-f0-9]{8,64}$/i.test(info.sd_model_hash)) values.modelHash = info.sd_model_hash;
		if (Object.keys(values).length) metadata = values;
	} catch {}
	const finish = (data) => ({
		...imageBytes(data, maxBytes),
		...metadata ? { metadata } : {}
	});
	const inline = typeof item.b64_json === "string" ? item.b64_json : /^data:image\/[\w.+-]+;base64,/i.test(item.url || "") ? item.url.split(",")[1] : null;
	if (inline !== null) {
		const clean = inline.replace(/\s+/g, "");
		if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error("图片 base64 数据不合法");
		return finish(Buffer.from(clean, "base64"));
	}
	if (typeof item.url !== "string") throw new Error("生图服务没有返回图片数据");
	const baseURL = channelSettings(input).baseURL;
	const url = await (deps.validateDownload || validateImageDownload)(item.url, baseURL);
	const downloaded = deps.usePublicDownload && new URL(url).origin !== new URL(baseURL).origin ? await deps.publicDownload(url, input.signal) : await request(url, {
		redirect: "error",
		signal: input.signal
	});
	if (!downloaded.ok) {
		await downloaded.body?.cancel();
		throw new Error("图片下载失败（HTTP " + downloaded.status + "）");
	}
	return finish(await boundedBytes(downloaded, maxBytes));
}
//#endregion
//#region lib/types/configuration.js
const mapped = {
	openai: [
		"openai",
		"openaiBaseURL",
		"openaiModel",
		"OPENAI_API_KEY",
		""
	],
	grok: [
		"grok",
		"grokBaseURL",
		"grokModel",
		"XAI_API_KEY",
		""
	],
	gemini: [
		"google",
		"googleEndpoint",
		"googleModel",
		"GEMINI_API_KEY",
		"/interactions"
	],
	seedream: [
		"seedream",
		"seedreamBaseURL",
		"seedreamModel",
		"ARK_API_KEY",
		""
	],
	qwen: [
		"dashscope",
		"dashscopeEndpoint",
		"dashscopeModel",
		"DASHSCOPE_API_KEY",
		""
	]
};
const configurationServiceName = "tavernImageConfiguration";
const ids = new Set(SCENE_IMAGE_CHANNELS.filter((x) => x.id !== "dsh-image-gen").map((x) => x.id));
function providerId(id) {
	if (!ids.has(id)) throw new Error("未知生图提供商");
	return id;
}
function extras(value) {
	try {
		const data = JSON.parse(value.tavernChannels || "{}");
		return data && typeof data === "object" && !Array.isArray(data) ? data : {};
	} catch {
		throw new Error("插件渠道配置损坏，请检查设置");
	}
}
function ref(id, authType) {
	return mapped[id]?.[3] || imageCredentialRef(id, authType);
}
function endpoint(value) {
	return value?.replace(/\/+$/, "") || "";
}
function readChannel(value, id) {
	providerId(id);
	const data = { ...extras(value)[id] };
	const map = mapped[id];
	if (map) {
		if (value[map[1]] !== void 0) data.baseURL = map[4] && value[map[1]].endsWith(map[4]) ? value[map[1]].slice(0, -map[4].length) : value[map[1]];
		if (value[map[2]] !== void 0) data.model = value[map[2]];
	}
	return channelSettings(data, id);
}
/** A private in-process interface: secrets never cross the Studio HTTP route. */
function createImageConfiguration({ read, write, restore = void 0, credentials, attachments, fetchImpl = fetch, generateImpl = generateSceneImage }) {
	let pending = Promise.resolve();
	/** @template T @param {() => T | Promise<T>} fn @returns {Promise<T>} */
	function serial(fn) {
		const result = pending.then(fn);
		pending = result.catch(() => {});
		return result;
	}
	async function inspect(id, resolveKey = true) {
		const value = await read();
		if (!id || id === "dsh-image-gen") id = Object.keys(mapped).find((id) => mapped[id][0] === value.provider) || "openai";
		const config = readChannel(value, id);
		const key = resolveKey && channelNeedsKey(config) ? await credentials.resolve(ref(id, config.authType)) : void 0;
		return {
			...config,
			backend: "dsh-image-gen",
			hasKey: Boolean(key?.value),
			ready: channelReady(config, key?.value),
			configured: Object.hasOwn(extras(value), id) || Boolean(key?.value),
			channels: SCENE_IMAGE_CHANNELS.filter((x) => ids.has(x.id))
		};
	}
	async function save(input) {
		const id = providerId(input.provider), before = await read(), current = readChannel(before, id);
		const next = channelSettings({
			...current,
			...input
		}, id);
		if (input.apiKey !== void 0 && typeof input.apiKey !== "string") throw new Error("API Key 必须是文本");
		const supplied = next.authType === "basic" ? input.apiKey : input.apiKey?.trim();
		if (supplied && /[\r\n]/.test(supplied)) throw new Error("鉴权信息格式不正确");
		const keyRef = ref(id, next.authType), previousKey = await credentials.resolve(keyRef);
		const identityChanged = endpoint(next.baseURL) !== endpoint(current.baseURL) || next.authType !== current.authType || next.username !== current.username;
		if (channelNeedsKey(next) && previousKey?.value && identityChanged && !supplied) throw new Error("地址或鉴权身份已修改，请重新填写 API Key；旧密钥不会发送到新地址");
		const writeKey = Boolean(supplied && channelNeedsKey(next) && supplied !== previousKey?.value);
		if (writeKey) {
			const info = await credentials.describe?.(keyRef);
			if (previousKey?.source === "env" || info?.source === "env") throw new Error(`API Key 与只读环境变量 ${keyRef} 中的密钥不同；请在启动 DSH 的环境中修改或移除该变量后重启。未保存配置。`);
			if (info?.writable === false) throw new Error("API Key 与当前只读凭据冲突；请在凭据来源处修改后再保存。未保存配置。");
		}
		const additional = { ...next };
		delete additional.provider;
		const patch = { tavernChannels: "" }, map = mapped[id];
		if (map) {
			patch.provider = map[0];
			patch[map[1]] = endpoint(next.baseURL) + map[4];
			patch[map[2]] = next.model;
			delete additional.baseURL;
			delete additional.model;
		}
		patch.tavernChannels = JSON.stringify({
			...extras(before),
			[id]: additional
		});
		await write(patch);
		try {
			if (writeKey) await credentials.set(keyRef, supplied);
		} catch (error) {
			if (restore) await restore(before);
			else await write(Object.fromEntries(Object.keys(patch).map((key) => [key, before[key] ?? (key === "tavernChannels" ? "{}" : "")])));
			throw new Error("密钥保存失败，配置已回滚；请检查 DSH 凭据存储是否可写，再保存设置。");
		}
		return inspect(id);
	}
	const connection = createSceneImageConnection({
		settings: inspect,
		credentials: () => ({ resolve: (oldRef) => {
			const id = [...ids].find((id) => imageCredentialRef(id) === oldRef);
			return credentials.resolve(id && mapped[id] ? mapped[id][3] : oldRef);
		} }),
		fetchImpl
	});
	return {
		serial,
		inspect: (id) => serial(() => inspect(id)),
		describe: (id) => serial(() => inspect(id, false)),
		configure: (input) => serial(() => save(input)),
		capture: (id) => serial(async () => {
			const active = await inspect(id);
			return {
				active,
				apiKey: (channelNeedsKey(active) ? await credentials.resolve(ref(active.provider, active.authType)) : void 0)?.value || ""
			};
		}),
		test: (input) => serial(() => connection.test(input)),
		models: (input) => serial(() => connection.models(input)),
		generate: async (input) => {
			const request = await serial(async () => {
				input.signal?.throwIfAborted();
				const current = await inspect(input.provider);
				if ([
					"baseURL",
					"model",
					"size",
					"aspectRatio",
					"authType",
					"username"
				].some((key) => current[key] !== input[key]) || current.workflow?.digest !== input.workflow?.digest) throw Object.assign(/* @__PURE__ */ new Error("生图配置已变化，请重新整理画面；未请求生图"), { imageOutcome: "not_requested" });
				if (!channelReady(input, input.apiKey)) throw Object.assign(/* @__PURE__ */ new Error("请先完成生图配置"), { imageOutcome: "not_requested" });
				return {
					...input,
					...structuredClone(channelSettings(input))
				};
			});
			request.signal?.throwIfAborted();
			const generated = await generateImpl(request, fetchImpl === globalThis.fetch ? {} : { fetch: fetchImpl });
			if (!attachments) return generated;
			try {
				const attachment = await attachments.saveImage({
					data: generated.data,
					mediaType: generated.mediaType,
					name: "scene-image"
				});
				return {
					...generated,
					attachment
				};
			} catch {
				return generated;
			}
		}
	};
}
//#endregion
//#region lib/types/studio-route.js
/** Serve workbench capabilities and generation requests without exposing provider credentials. */
async function serveStudio(req, res, deps) {
	if (!sameOrigin(req)) return jsonError(res, 403, "origin-rejected");
	if (req.method === "GET") try {
		return json(res, 200, await deps.describe());
	} catch (error) {
		return jsonError(res, 500, errorMessage(error, "studio-unavailable"));
	}
	if (req.method !== "POST") return jsonError(res, 405, "method-not-allowed");
	if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return jsonError(res, 415, "json-required");
	const controller = new AbortController();
	const onConnectionClose = () => {
		if (!res.writableEnded) controller.abort(/* @__PURE__ */ new Error("The browser closed the image generation request."));
	};
	const onReqAborted = () => {
		controller.abort(/* @__PURE__ */ new Error("The browser closed the image generation request."));
	};
	res.once("close", onConnectionClose);
	req.once("aborted", onReqAborted);
	try {
		let input;
		try {
			input = parseStudioGenerateRequest(JSON.parse(await readBody(req, deps.maxBodyBytes)));
		} catch (error) {
			return jsonError(res, 400, errorMessage(error, "invalid-request"));
		}
		const output = await deps.generate(input, controller.signal);
		if (!res.headersSent && !res.writableEnded && !res.destroyed) json(res, 200, output);
	} catch (error) {
		if (res.headersSent || res.writableEnded || res.destroyed) return;
		jsonError(res, controller.signal.aborted ? 499 : 502, errorMessage(error, "generation-failed"));
	} finally {
		res.off("close", onConnectionClose);
		req.off("aborted", onReqAborted);
	}
}
/** Strictly validate the small untrusted workbench wire contract. */
function parseStudioGenerateRequest(value) {
	const input = record(value);
	if (input === void 0) throw new Error("请求格式无效");
	if (input.mode !== "generate" && input.mode !== "edit") throw new Error("请选择生成类型");
	if (!cloudProvider(input.provider)) throw new Error("不支持该图像 Provider");
	const prompt = requiredText(input.prompt, "请输入提示词", 2e3);
	const model = requiredText(input.model, "请选择模型", 200);
	const ratio = requiredText(input.ratio, "请选择比例", 32);
	const quality = requiredText(input.quality, "请选择清晰度", 32);
	const references = (Array.isArray(input.references) ? input.references : input.reference !== void 0 ? [input.reference] : []).map(parseReference);
	if (input.mode === "edit" && references.length === 0) throw new Error("图生图需要至少一张参考图");
	if (references.length > 5) throw new Error("最多支持上传 5 张参考图");
	const workspaceRoot = typeof input.workspaceRoot === "string" && input.workspaceRoot.trim().length > 0 ? input.workspaceRoot.trim() : void 0;
	return {
		mode: input.mode,
		provider: input.provider,
		model,
		prompt,
		ratio,
		quality,
		...references.length > 0 ? {
			references,
			reference: references[0]
		} : {},
		...workspaceRoot !== void 0 ? { workspaceRoot } : {}
	};
}
function parseReference(value) {
	const reference = record(value);
	if (reference === void 0) throw new Error("参考图格式无效");
	if ("attachment" in reference) {
		const attachment = parseImageAttachmentRef(reference.attachment);
		if (attachment === void 0) throw new Error("参考图附件无效");
		return { attachment };
	}
	if (!imageMediaType(reference.mediaType) || typeof reference.data !== "string") throw new Error("参考图格式无效");
	if (reference.data.length === 0) throw new Error("参考图内容为空");
	if (reference.name !== void 0 && typeof reference.name !== "string") throw new Error("参考图名称无效");
	return {
		mediaType: reference.mediaType,
		data: reference.data,
		...typeof reference.name === "string" ? { name: reference.name.slice(0, 240) } : {}
	};
}
function requiredText(value, message, maxLength) {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(message);
	const text = value.trim();
	if (text.length > maxLength) throw new Error(`${message}（最多 ${String(maxLength)} 个字符）`);
	return text;
}
function cloudProvider(value) {
	return typeof value === "string" && CLOUD_IMAGE_PROVIDERS.includes(value);
}
function imageMediaType(value) {
	return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif";
}
function sameOrigin(req) {
	const origin = req.headers.origin;
	const host = req.headers.host;
	return origin === void 0 || host === void 0 || origin === `http://${host}` || origin === `https://${host}`;
}
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
async function readBody(req, maxBytes) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > maxBytes) throw new Error("参考图过大，请压缩后重试");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
function errorMessage(error, fallback) {
	return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
function json(res, status, value) {
	if (res.headersSent || res.writableEnded || res.destroyed) return;
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(value));
}
function jsonError(res, status, message) {
	if (res.headersSent || res.writableEnded || res.destroyed) return;
	json(res, status, { error: message });
}
//#endregion
//#region lib/types/index.js
const name = "dsh-image-gen";
const inject = [
	"tools",
	"attachments",
	"credentials",
	"webServer"
];
function apply(ctx, config = {}) {
	let current = () => config;
	const knownWorkspaceRoots = /* @__PURE__ */ new Set();
	installImageSettings(ctx, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	const configuration = createImageConfiguration({
		read: () => current(),
		write: async (patch) => {
			const settings = ctx.get("settings");
			if (typeof settings?.update !== "function") throw new Error("当前 DSH 不支持统一插件设置写入，请更新 DSH；未保存配置或密钥");
			await settings.update(IMAGE_GENERATION_NAMESPACE, patch);
		},
		credentials: ctx.credentials,
		attachments: ctx.attachments
	});
	if (typeof ctx.provide === "function") ctx.provide(configurationServiceName, configuration);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: IMAGE_ROUTE,
		handler: (req, res) => serveImage(req, res, { readImage: (ref) => ctx.attachments.readImage(ref) })
	}), "dsh-image-gen: image route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: DELETE_ROUTE,
		handler: (req, res) => serveDelete(req, res, { deleteWorkspaceImage: (filePath) => deleteImageFromWorkspace(filePath, knownWorkspaceRoots) })
	}), "dsh-image-gen: delete route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: STUDIO_ROUTE,
		handler: (req, res) => serveStudio(req, res, {
			describe: async () => {
				const base = await configuration.serial(() => describeStudio(ctx, structuredClone(current())));
				const workspaces = await getDshWorkspacesFull().catch(() => []);
				const activeRoot = Array.from(knownWorkspaceRoots)[0] || workspaces[0]?.path || process.cwd();
				return {
					...base,
					workspaceRoot: activeRoot,
					workspaces
				};
			},
			generate: async (input, signal) => {
				const fallbackRoot = Array.from(knownWorkspaceRoots)[0] || process.cwd();
				return (await configuration.serial(() => prepareStudioGeneration(ctx, current(), input, signal, fallbackRoot)))();
			},
			maxBodyBytes: Math.ceil(ctx.attachments.imageLimits.maxImageBytes * 1.4 * 5) + 262144
		})
	}), "dsh-image-gen: studio route");
	if (config.registerAgentTools === false) return;
	ctx.tools.register(defineTool({
		name: "generate_image",
		description: "Generate a new image with the configured provider. Use when the user asks to create or draw a new image; use edit_image instead when they want to change an existing image. Give a complete visual prompt including subject, composition, style, lighting, and any exact text that should appear. A successful image is attached directly to the conversation and may also be saved under the session workspace. Do not call read, glob, or other tools to locate or verify the image.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "Complete description of the image to generate."
			},
			aspect_ratio: {
				type: "string",
				enum: [
					"1:1",
					"3:2",
					"2:3",
					"4:3",
					"3:4",
					"16:9",
					"9:16"
				],
				description: "Optional output aspect ratio for Google Gemini or Grok."
			},
			resolution: {
				type: "string",
				enum: ["1k", "2k"],
				description: "Optional Grok output resolution; defaults to 1k."
			},
			image_size: {
				type: "string",
				enum: [
					"1K",
					"2K",
					"4K"
				],
				description: "Optional output resolution for Google Gemini."
			},
			size: {
				type: "string",
				description: "Optional dimensions or size tier for OpenAI, Seedream, or DashScope."
			},
			workflow: {
				type: "string",
				description: "Optional name of the ComfyUI workflow to run; omit to use the active workflow from settings. Only meaningful when the ComfyUI provider is selected."
			}
		},
		output: imageOutput("Generated"),
		async execute(args, exec) {
			const active = resolveProvider(current());
			if (active.provider === "comfyui") {
				const workflow = selectComfyUIWorkflow(active, args.workflow);
				return saveGenerated(ctx, await generateComfyUIImage({
					baseURL: active.baseURL,
					workflowJson: workflow.json,
					prompt: mergeComfyUIPrompt(workflow.presetPrompt, args.prompt),
					timeoutMs: active.timeoutMs,
					maxBytes: ctx.attachments.imageLimits.maxImageBytes,
					signal: exec.signal
				}), active.provider, workflow.name, "API workflow", current(), exec, knownWorkspaceRoots);
			}
			const credential = await ctx.credentials.resolve(credentialRef(active.apiKeyEnv));
			if (credential === void 0 || credential.value.length === 0) throw new Error(`generate_image requires the ${active.apiKeyEnv} credential; configure it in Settings > Plugins > Image generation.`);
			if (active.provider === "grok") {
				const aspectRatio = args.aspect_ratio ?? "1:1";
				const resolution = args.resolution ?? active.imageSize;
				return saveGenerated(ctx, await generateGrokImage({
					apiKey: credential.value,
					baseURL: active.baseURL,
					model: active.model,
					prompt: args.prompt,
					aspectRatio,
					resolution,
					maxBytes: ctx.attachments.imageLimits.maxImageBytes,
					signal: exec.signal
				}), active.provider, active.model, `${aspectRatio}, ${resolution}`, current(), exec, knownWorkspaceRoots);
			}
			if (active.provider === "google") {
				const aspectRatio = args.aspect_ratio ?? active.aspectRatio;
				const imageSize = args.image_size ?? active.imageSize;
				return saveGenerated(ctx, await generateGoogleImage({
					apiKey: credential.value,
					endpoint: active.endpoint,
					model: active.model,
					prompt: args.prompt,
					aspectRatio,
					imageSize,
					maxBytes: ctx.attachments.imageLimits.maxImageBytes,
					signal: exec.signal
				}), active.provider, active.model, `${aspectRatio}, ${imageSize}`, current(), exec, knownWorkspaceRoots);
			}
			if (active.provider === "dashscope") {
				const size = args.size ?? active.imageSize;
				return saveGenerated(ctx, await generateDashScopeImage({
					apiKey: credential.value,
					endpoint: active.endpoint,
					model: active.model,
					prompt: args.prompt,
					size,
					maxBytes: ctx.attachments.imageLimits.maxImageBytes,
					signal: exec.signal
				}), active.provider, active.model, size, current(), exec, knownWorkspaceRoots);
			}
			const size = args.size ?? active.imageSize;
			return saveGenerated(ctx, await generateOpenAICompatibleImage({
				provider: active.provider,
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: args.prompt,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal: exec.signal
			}), active.provider, active.model, size, current(), exec, knownWorkspaceRoots);
		},
		presentResult: (_args, result) => imagePresentation(result)
	}));
	ctx.tools.register(defineTool({
		name: "edit_image",
		description: "Edit, combine, or restyle existing images with the configured provider. Images attached inline to the latest human message are already readable DSH attachments even when no workspace file exists. In that case, call edit_image immediately with prompt only; NEVER call read_image, glob, or shell to locate them, and NEVER invent @ paths. All inline images will be used in upload order. For specific older conversation images use source_attachment_id or source_attachment_ids; both canonical sha256: IDs and full bare SHA-256 digests are accepted. For files the user explicitly names in the workspace use source_path or source_paths. Provide exactly one selector field. Without a selector, images from the latest human message take priority; only when that message has no images does editing fall back to the newest conversation image.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "Describe the changes to make while preserving everything else that should remain."
			},
			source_attachment_id: {
				type: "string",
				description: "Optional attachment id of a specific image already present in the current conversation."
			},
			source_attachment_ids: {
				type: "array",
				items: { type: "string" },
				description: "Optional ordered attachment ids of multiple images already present in the current conversation. Prompt references such as image 1 and image 2 follow this order."
			},
			source_path: {
				type: "string",
				description: "Optional absolute or workspace-relative path of a specific image file inside the active session workspace. Prefer this when the user names a saved file."
			},
			source_paths: {
				type: "array",
				items: { type: "string" },
				description: "Optional ordered absolute or workspace-relative paths of multiple image files inside the active session workspace."
			},
			aspect_ratio: {
				type: "string",
				enum: [
					"1:1",
					"3:2",
					"2:3",
					"4:3",
					"3:4",
					"16:9",
					"9:16"
				],
				description: "Optional output aspect ratio for Google Gemini."
			},
			image_size: {
				type: "string",
				enum: [
					"1K",
					"2K",
					"4K"
				],
				description: "Optional output resolution for Google Gemini."
			},
			size: {
				type: "string",
				description: "Optional output size for OpenAI, Seedream, or DashScope."
			},
			workflow: {
				type: "string",
				description: "Optional name of the ComfyUI workflow to run; omit to use the active workflow from settings. Only meaningful when the ComfyUI provider is selected."
			}
		},
		output: imageOutput("Edited"),
		async execute(args, exec) {
			const active = resolveProvider(current());
			if (active.provider === "grok") throw new Error("Grok 当前仅支持文生图，暂不支持 edit_image；未请求生图");
			const sourceImages = await resolveReferenceImages({
				...exec.agent === void 0 ? {} : { agent: exec.agent },
				attachments: ctx.attachments,
				...typeof args.source_attachment_id === "string" ? { sourceAttachmentId: args.source_attachment_id } : {},
				...Array.isArray(args.source_attachment_ids) ? { sourceAttachmentIds: args.source_attachment_ids } : {},
				...typeof args.source_path === "string" ? { sourcePath: args.source_path } : {},
				...Array.isArray(args.source_paths) ? { sourcePaths: args.source_paths } : {},
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal: exec.signal
			});
			if (active.provider === "comfyui") {
				if (sourceImages.length > 1) throw new Error(`ComfyUI edit_image supports exactly one source image per call; this call resolved ${String(sourceImages.length)} images. Call edit_image again with source_attachment_id set to the single attachment ID of the image to edit.`);
				const sourceImage = sourceImages[0];
				if (sourceImage === void 0) throw new Error("edit_image requires a reference image");
				const workflow = selectComfyUIWorkflow(active, args.workflow);
				return saveGenerated(ctx, await editComfyUIImage({
					baseURL: active.baseURL,
					workflowJson: workflow.json,
					prompt: mergeComfyUIPrompt(workflow.presetPrompt, args.prompt),
					sourceImage: {
						data: sourceImage.data,
						mediaType: sourceImage.mediaType
					},
					timeoutMs: active.timeoutMs,
					maxBytes: ctx.attachments.imageLimits.maxImageBytes,
					signal: exec.signal
				}), active.provider, workflow.name, "API workflow", current(), exec, knownWorkspaceRoots);
			}
			const credential = await ctx.credentials.resolve(credentialRef(active.apiKeyEnv));
			if (credential === void 0 || credential.value.length === 0) throw new Error(`edit_image requires the ${active.apiKeyEnv} credential; configure it in Settings > Plugins > Image generation.`);
			if (active.provider === "google") {
				const aspectRatio = args.aspect_ratio ?? active.aspectRatio;
				const imageSize = args.image_size ?? active.imageSize;
				return saveGenerated(ctx, await editGoogleImage({
					apiKey: credential.value,
					endpoint: active.endpoint,
					model: active.model,
					prompt: args.prompt,
					sourceImages,
					aspectRatio,
					imageSize,
					maxBytes: ctx.attachments.imageLimits.maxImageBytes,
					signal: exec.signal
				}), active.provider, active.model, `${aspectRatio}, ${imageSize}`, current(), exec, knownWorkspaceRoots);
			}
			const size = args.size ?? active.imageSize;
			if (active.provider === "openai") return saveGenerated(ctx, await editOpenAICompatibleImage({
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: args.prompt,
				sourceImages,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal: exec.signal
			}), active.provider, active.model, size, current(), exec, knownWorkspaceRoots);
			if (active.provider === "seedream") return saveGenerated(ctx, await editSeedreamImage({
				apiKey: credential.value,
				baseURL: active.baseURL,
				model: active.model,
				prompt: args.prompt,
				sourceImages,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal: exec.signal
			}), active.provider, active.model, size, current(), exec, knownWorkspaceRoots);
			return saveGenerated(ctx, await editDashScopeImage({
				apiKey: credential.value,
				endpoint: active.endpoint,
				model: active.model,
				prompt: args.prompt,
				sourceImages,
				size,
				maxBytes: ctx.attachments.imageLimits.maxImageBytes,
				signal: exec.signal
			}), active.provider, active.model, size, current(), exec, knownWorkspaceRoots);
		},
		presentResult: (_args, result) => imagePresentation(result)
	}));
}
function imageOutput(verb) {
	return {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				attachment: {
					type: "object",
					required: true,
					additionalProperties: false,
					properties: {
						attachmentId: {
							type: "string",
							required: true
						},
						mediaType: {
							type: "string",
							required: true
						},
						bytes: {
							type: "integer",
							required: true
						},
						width: {
							type: "integer",
							required: true
						},
						height: {
							type: "integer",
							required: true
						},
						name: { type: "string" },
						originalDimensions: {
							type: "object",
							additionalProperties: false,
							properties: {
								width: {
									type: "integer",
									required: true
								},
								height: {
									type: "integer",
									required: true
								}
							}
						}
					}
				},
				provider: {
					type: "string",
					required: true
				},
				model: {
					type: "string",
					required: true
				},
				output: {
					type: "string",
					required: true
				},
				savedTo: { type: "string" },
				saveError: { type: "string" }
			}
		},
		render: (_args, value) => {
			const saved = typeof value.savedTo === "string" ? ` It was also saved to the workspace as ${value.savedTo}.` : typeof value.saveError === "string" ? ` Saving it to the workspace failed: ${value.saveError}.` : " It has no local file path.";
			const action = verb === "Generated" ? "It is already attached to the conversation." : "The edited image is attached to the conversation.";
			return [{
				type: "text",
				text: `${verb} one image with ${value.provider}/${value.model} (${value.output}). Attachment ID: ${String(value.attachment.attachmentId)}. ${action}${saved} Respond to the user without reading or searching for the image.`
			}, {
				type: "image",
				attachment: value.attachment
			}];
		},
		presentationMeta: (args, value) => ({
			kind: "dsh-image-gen",
			attachment: attachmentMeta(value.attachment),
			provider: value.provider,
			model: value.model,
			output: value.output,
			...verb === "Edited" ? { operation: "edit" } : {},
			...typeof value.savedTo === "string" ? { savedTo: value.savedTo } : {},
			...typeof value.seed === "number" ? { seed: value.seed } : {},
			prompt: args.prompt
		})
	};
}
function attachmentMeta(ref) {
	return {
		attachmentId: String(ref.attachmentId),
		mediaType: ref.mediaType,
		bytes: ref.bytes,
		width: ref.width,
		height: ref.height,
		...ref.name === void 0 ? {} : { name: ref.name },
		...ref.originalDimensions === void 0 ? {} : { originalDimensions: {
			width: ref.originalDimensions.width,
			height: ref.originalDimensions.height
		} }
	};
}
async function saveGenerated(ctx, generated, provider, model, output, config, exec, knownRoots) {
	if (!ctx.attachments.imageLimits.mediaTypes.includes(generated.mediaType)) throw new Error(`This DSH deployment does not accept ${generated.mediaType} generated images`);
	const attachment = await ctx.attachments.saveImage({
		data: generated.data,
		mediaType: generated.mediaType,
		name: "generated-image"
	});
	const value = {
		attachment,
		provider,
		model,
		output,
		...typeof generated.seed === "number" ? { seed: generated.seed } : {}
	};
	if (config.saveToWorkspace === false) return value;
	const workspaceRoot = exec.agent?.session.header.cwd;
	if (workspaceRoot === void 0) return value;
	knownRoots?.add(workspaceRoot);
	try {
		value.savedTo = await saveImageToWorkspace({
			workspaceRoot,
			folder: config.workspaceFolder,
			attachmentId: attachment.attachmentId,
			mediaType: generated.mediaType,
			data: generated.data,
			signal: exec.signal
		});
	} catch (error) {
		exec.signal.throwIfAborted();
		ctx.logger.warn(`dsh-image-gen: failed to save image to workspace: ${error instanceof Error ? error.message : String(error)}`);
		value.saveError = error instanceof Error ? error.message : String(error);
	}
	return value;
}
function imagePresentation(result) {
	const attachment = imageAttachmentFromMeta(result.meta);
	return attachment === void 0 ? void 0 : {
		card: "generic",
		title: "Generated image",
		content: [{
			type: "image",
			attachment
		}]
	};
}
/**
* Wire the settings namespace across both dsh-settings API generations.
* A namespace import keeps module loading safe on either version; the branch
* picks the service method (0.1.2+) or the legacy top-level relay (<= rc.2),
* and falls back to the composition entry with a warning when neither exists
* so an incompatible host degrades the settings UI instead of failing boot.
*/
function installImageSettings(ctx, config, hooks) {
	const namespace = dshSettings;
	if (typeof namespace.SettingsProvider?.prototype?.installSection === "function") {
		ctx.inject(["settings"], (settingsCtx) => {
			settingsCtx.settings.installSection(ctx, IMAGE_GENERATION_NAMESPACE, Config, config, hooks);
		});
		return;
	}
	const legacyInstall = namespace.installSettingsSection;
	const legacyNamespace = namespace.settingsNamespace;
	if (typeof legacyInstall === "function" && typeof legacyNamespace === "function") {
		legacyInstall(ctx, legacyNamespace(IMAGE_GENERATION_NAMESPACE), Config, config, hooks);
		return;
	}
	ctx.logger.warn("dsh-image-gen: this DSH exposes neither settings API generation; settings UI stays on the composition entry");
}
//#endregion
export { Config, DELETE_ROUTE, IMAGE_ROUTE, STUDIO_ROUTE, apply, imageAttachmentFromMeta, inject, name };
