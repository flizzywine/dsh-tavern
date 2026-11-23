import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { LATEST_GOOGLE_VERTEX_MODELS, PI_AI_VERTEX_STREAM_MARKER, VERTEX_REGIONS, normalizeVertexLocation, vertexBaseUrlForLocation, vertexDisabledThinkingConfig, vertexLocationFromBaseUrl, vertexResolveThinkingLevel, vertexUsesThinkingLevel, createVertexToolCallStreamer, patchPiAiGoogleSharedSource, patchPiAiGoogleVertexModelsJson, patchPiAiGoogleVertexSource, supportsVertexStreamFunctionCallArguments } from '../tavern-plugin/lib/domain/pi-ai-vertex-stream.js'
import { discoverVertexProject, patchPiAiVertexStream, repairVertexRouteBaseUrl, vertexApiKeyFrom } from '../bin/pi-ai-vertex-stream-patch.mjs'

function makeStreamFixture() {
  const events = []
  const output = { role: 'assistant', content: [], stopReason: 'pending', usage: {} }
  const stream = { push: event => events.push(event) }
  let counter = 0
  const streamer = createVertexToolCallStreamer({
    output,
    stream,
    nextToolCallId: name => `${name}_1_${++counter}`,
    retainThoughtSignature: (existing, incoming) => (typeof incoming === 'string' && incoming.length > 0 ? incoming : existing),
  })
  return { events, output, streamer }
}

test('Vertex partialArgs 状态机：嵌套对象/数组/转义字符、乱序安全兜底与非流式 args 兼容', () => {
  // 嵌套对象与数组 + 转义字符
  const nested = makeStreamFixture()
  nested.streamer.handlePart({
    functionCall: {
      name: 'save',
      partialArgs: [
        { jsonPath: '$.location.latitude', numberValue: 31.2 },
        { jsonPath: '$.location.longitude', numberValue: 121.5 },
        { jsonPath: '$.items[0].name', stringValue: '第一行\n"引号"', willContinue: true },
        { jsonPath: '$.items[1].name', stringValue: '第二项', willContinue: false },
        { jsonPath: '$.ok', boolValue: true },
        { jsonPath: '$.extra', nullValue: 'NULL_VALUE' },
      ],
      willContinue: false,
    },
  })
  const expected = {
    location: { latitude: 31.2, longitude: 121.5 },
    items: [{ name: '第一行\n"引号"' }, { name: '第二项' }],
    ok: true,
    extra: null,
  }
  const nestedDeltas = nested.events.filter(e => e.type === 'toolcall_delta').map(e => e.delta).join('')
  assert.equal(nestedDeltas, JSON.stringify(expected))
  assert.deepEqual(nested.output.content[0].arguments, expected)

  // 乱序回写同一路径时不吐坏 JSON，最终 toolCall.arguments 仍完整准确
  const outOfOrder = makeStreamFixture()
  outOfOrder.streamer.handlePart({
    functionCall: {
      name: 'edit',
      partialArgs: [
        { jsonPath: '$.a.x', numberValue: 1 },
        { jsonPath: '$.b', numberValue: 2 },
        { jsonPath: '$.a.y', numberValue: 3 },
      ],
      willContinue: false,
    },
  })
  assert.deepEqual(outOfOrder.output.content[0].arguments, { a: { x: 1, y: 3 }, b: 2 })
  const partialText = outOfOrder.events.filter(e => e.type === 'toolcall_delta').map(e => e.delta).join('')
  assert.doesNotThrow(() => JSON.parse(partialText))

  // 老格式整块 args 兜底
  const legacy = makeStreamFixture()
  legacy.streamer.handlePart({ functionCall: { id: 'legacy-1', name: 'ping', args: { host: 'local' } } })
  assert.equal(legacy.events.map(e => e.type).join(','), 'toolcall_start,toolcall_delta,toolcall_end')
  assert.equal(legacy.events[1].delta, '{"host":"local"}')
})

test('pi-ai Vertex 安装补丁：兼容 1.1.0/1.5.2 源码，可真实执行且更新最新模型清单', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'pi-ai-vertex-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const sdkDirectory = path.join(root, 'pi-ai')
  await mkdir(path.join(sdkDirectory, 'dist', 'api'), { recursive: true })
  await mkdir(path.join(sdkDirectory, 'dist', 'providers', 'data'), { recursive: true })
  await mkdir(path.join(sdkDirectory, 'dist', 'utils'), { recursive: true })

  await writeFile(path.join(sdkDirectory, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai', type: 'module' }))

  // Stub minimal local modules imported by google-vertex.js so we can import() & execute the patched module.
  const stubDir = path.join(sdkDirectory, 'node_modules', '@google', 'genai')
  await mkdir(stubDir, { recursive: true })
  await writeFile(path.join(stubDir, 'package.json'), JSON.stringify({ name: '@google/genai', type: 'module', main: './index.js' }))
  await writeFile(
    path.join(stubDir, 'index.js'),
    `export const ResourceScope = { COLLECTION: 'collection' };
export class GoogleGenAI {
  constructor() {
    this.models = {
      generateContentStream: async (params) => {
        globalThis.__capturedVertexParams.push(params);
        return globalThis.__mockVertexChunks;
      }
    };
  }
}
`,
  )
  await writeFile(
    path.join(sdkDirectory, 'dist', 'models.js'),
    `export function calculateCost() {}
export function clampThinkingLevel(_m, l) { return l; }
`,
  )
  await writeFile(
    path.join(sdkDirectory, 'dist', 'utils', 'error-body.js'),
    `export function formatProviderError(e) { return String(e); }
export function normalizeProviderError(e) { return e; }
`,
  )
  await writeFile(
    path.join(sdkDirectory, 'dist', 'utils', 'event-stream.js'),
    `export class AssistantMessageEventStream {
  constructor() { this.events = []; }
  push(e) { this.events.push(e); }
  end() {}
  [Symbol.asyncIterator]() { return this.events.values(); }
}
`,
  )
  await writeFile(path.join(sdkDirectory, 'dist', 'utils', 'headers.js'), `export function providerHeadersToRecord() { return undefined; }\n`)
  await writeFile(path.join(sdkDirectory, 'dist', 'utils', 'identity.js'), `export function getIdentityHeaders() { return undefined; }\n`)
  await writeFile(path.join(sdkDirectory, 'dist', 'utils', 'provider-env.js'), `export function getProviderEnvValue() { return undefined; }\n`)
  await writeFile(path.join(sdkDirectory, 'dist', 'utils', 'sanitize-unicode.js'), `export function sanitizeSurrogates(s) { return s; }\n`)
  await writeFile(path.join(sdkDirectory, 'dist', 'utils', 'text.js'), `export function getSystemMessageText() { return ""; }\n`)
  await writeFile(path.join(sdkDirectory, 'dist', 'utils', 'transcript.js'), `export function collapseSystemMessages(c) { return c; } export function getCurrentTools(m) { return m.tools || []; } export function getInitialSystemMessage() { return undefined; }\n`)
  await writeFile(path.join(sdkDirectory, 'dist', 'api', 'simple-options.js'), `export function buildBaseOptions() { return {}; }\n`)
  await writeFile(
    path.join(sdkDirectory, 'dist', 'api', 'google-shared.js'),
    `export function convertMessages() { return []; }
export function convertTools(t) { return t; }
export function getDisabledGoogleThinkingConfig() { return {}; }
export function isThinkingPart(p) { return p.thought === true; }
export function mapStopReason() { return "stop"; }
export function resolveGoogleFunctionCallingMode(_t, choice) { return choice === "none" ? "NONE" : undefined; }
export function resolveGoogleThinkingLevel(_m, l) { return l; }
export function retainThoughtSignature(a, b) { return b || a; }
export function retryGoogleRequest(fn) { return fn(); }
export function supportsGoogleStrictToolSampling() { return true; }
export function toGoogleSdkThinkingLevel(l) { return l; }
export function toGoogleThinkingLevel(l) { return l; }
export function usesGoogleThinkingLevel(model) {
    const id = model.id.toLowerCase();
    return (
    /gemini-3(?:\\.\\d+)?-(?:pro|flash)/.test(id) ||
        id === "gemini-flash-latest" ||
        id === "gemini-flash-lite-latest" ||
        /gemma-?4/.test(id));
}
`,
  )

  const vertexFixture = `import { GoogleGenAI, ResourceScope } from "@google/genai";
import { calculateCost, clampThinkingLevel } from "../models.js";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { providerHeadersToRecord } from "../utils/headers.js";
import { getIdentityHeaders } from "../utils/identity.js";
import { getProviderEnvValue } from "../utils/provider-env.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { getSystemMessageText } from "../utils/text.js";
import { collapseSystemMessages, getCurrentTools, getInitialSystemMessage } from "../utils/transcript.js";
import { convertMessages, convertTools, getDisabledGoogleThinkingConfig, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, resolveGoogleThinkingLevel, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, toGoogleSdkThinkingLevel, toGoogleThinkingLevel, usesGoogleThinkingLevel } from "./google-shared.js";
import { buildBaseOptions } from "./simple-options.js";
const API_VERSION = "v1";
const GCP_VERTEX_CREDENTIALS_MARKER = "gcp-vertex-credentials";
let toolCallCounter = 0;
export const stream = (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    const normalizedContext = collapseSystemMessages(context);
    (async () => {
        const output = { role: "assistant", content: [], api: "google-vertex", provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "pending", timestamp: Date.now() };
        try {
            const client = new GoogleGenAI({ vertexai: true, apiKey: options?.apiKey || "k", apiVersion: API_VERSION });
            let params = buildParams(model, normalizedContext, options);
            const googleStream = await retryGoogleRequest(() => client.models.generateContentStream(params), options);
            stream.push({ type: "start", partial: output });
            let currentBlock = null;
            const blocks = output.content;
            const blockIndex = () => blocks.length - 1;
            for await (const chunk of googleStream) {
                const candidate = chunk.candidates?.[0];
                if (candidate?.content?.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.text !== undefined) {
                            currentBlock = { type: "text", text: part.text };
                            output.content.push(currentBlock);
                        }
                        if (part.functionCall) {
                            if (currentBlock) {
                                currentBlock = null;
                            }
                            const providedId = part.functionCall.id;
                            const needsNewId = !providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
                            const toolCallId = needsNewId
                                ? \`\${part.functionCall.name}_\${Date.now()}_\${++toolCallCounter}\`
                                : providedId;
                            const toolCall = {
                                type: "toolCall",
                                id: toolCallId,
                                name: part.functionCall.name || "",
                                arguments: part.functionCall.args ?? {},
                                ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
                            };
                            output.content.push(toolCall);
                            stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
                            stream.push({
                                type: "toolcall_delta",
                                contentIndex: blockIndex(),
                                delta: JSON.stringify(toolCall.arguments),
                                partial: output,
                            });
                            stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
                        }
                    }
                }
                if (candidate?.finishReason) {
                    output.rawStopReason = candidate.finishReason;
                    output.stopReason = mapStopReason(candidate.finishReason);
                    if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
                        output.stopReason = "toolUse";
                    }
                }
            }
            if (currentBlock) {
                stream.push({ type: "text_end", contentIndex: blockIndex(), content: currentBlock.text, partial: output });
            }
            stream.push({ type: "done", reason: output.stopReason, message: output });
            stream.end();
        } catch (error) {
            output.stopReason = "error";
            output.errorMessage = String(error);
            stream.push({ type: "error", reason: "error", error: output });
            stream.end();
        }
    })();
    return stream;
};
function buildParams(model, context, options = {}) {
    const contents = convertMessages(model, context);
    const currentTools = getCurrentTools(context.messages);
    const supportsStrictMode = supportsGoogleStrictToolSampling(model.id);
    const functionCallingMode = currentTools.length > 0
        ? resolveGoogleFunctionCallingMode(currentTools, options.toolChoice, supportsStrictMode)
        : undefined;
    const config = {
        ...(currentTools.length > 0 && {
            tools: convertTools(currentTools, false, supportsStrictMode),
        }),
        ...(functionCallingMode !== undefined && {
            toolConfig: { functionCallingConfig: { mode: functionCallingMode } },
        }),
    };
    return { model: model.id, contents, config };
}
`
  const vertexFile = path.join(sdkDirectory, 'dist', 'api', 'google-vertex.js')
  const sharedFile = path.join(sdkDirectory, 'dist', 'api', 'google-shared.js')
  const modelsFile = path.join(sdkDirectory, 'dist', 'providers', 'data', 'google-vertex.json')

  await writeFile(vertexFile, vertexFixture)
  await writeFile(modelsFile, JSON.stringify({ 'google-vertex': { 'chat:gemini-2.5-flash': LATEST_GOOGLE_VERTEX_MODELS['chat:gemini-2.5-flash'] } }))

  assert.equal(patchPiAiVertexStream({ sdkDirectory }), true)
  assert.equal(patchPiAiVertexStream({ sdkDirectory }), false)

  // 验证 google-shared.js 已兼容 Gemini 4 thinkingLevel，google-vertex.json 已包含最新模型
  const sharedAfter = await readFile(sharedFile, 'utf8')
  const { usesGoogleThinkingLevel } = await import(pathToFileURL(sharedFile).href + '?v=1')
  assert.equal(usesGoogleThinkingLevel({ id: 'gemini-4-carbon' }), true)
  assert.match(sharedAfter, /gemini-\(\?:/)

  // thinking 判定不再依赖 google-shared.js 的正则：适配器自带（旧版 pi-ai 会把
  // gemini-4 判成 budget 型，Vertex 回 400 "Thinking budget is not supported"）。
  const vertexAfterPatch = await readFile(vertexFile, 'utf8')
  assert.ok(vertexAfterPatch.includes('function vertexUsesThinkingLevel'))
  assert.ok(vertexAfterPatch.includes('function vertexDisabledThinkingConfig'))
  assert.ok(vertexAfterPatch.includes('function vertexResolveThinkingLevel'))

  const modelsAfter = JSON.parse(await readFile(modelsFile, 'utf8'))['google-vertex']
  for (const key of ['chat:gemini-4-argon', 'chat:gemini-4-carbon', 'chat:gemini-4-hydrogen', 'chat:gemini-4-neon', 'chat:gemini-3.5-flash-lite', 'chat:gemini-3.1-flash-lite-image']) {
    assert.ok(modelsAfter[key], `模型目录应包含 ${key}`)
  }

  // 动态执行补丁后的 google-vertex.js，验证请求参数与增量输出
  const mod = await import(pathToFileURL(vertexFile).href)
  globalThis.__capturedVertexParams = []
  globalThis.__mockVertexChunks = (async function* () {
    yield { candidates: [{ content: { parts: [{ functionCall: { name: 'submit_story', partialArgs: [{ jsonPath: '$.think', stringValue: '想', willContinue: true }], willContinue: true } }] } }] }
    yield { candidates: [{ content: { parts: [{ functionCall: { partialArgs: [{ jsonPath: '$.content', stringValue: '写', willContinue: true }], willContinue: true } }] } }] }
    yield { candidates: [{ content: { parts: [{ functionCall: { partialArgs: [{ jsonPath: '$.content', stringValue: '完' }] } }] }, finishReason: 'STOP' }] }
  })()

  const s1 = mod.stream(
    { id: 'gemini-4-carbon', provider: 'google-vertex', baseUrl: '' },
    { messages: Object.assign([], { tools: [{ name: 'submit_story' }] }) },
    { apiKey: 'test-key' },
  )
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(globalThis.__capturedVertexParams[0].config.toolConfig.functionCallingConfig.streamFunctionCallArguments, true)
  assert.equal(globalThis.__capturedVertexParams[0].config.automaticFunctionCalling.disable, true)
  const deltas1 = s1.events.filter(e => e.type === 'toolcall_delta').map(e => e.delta).join('')
  assert.equal(deltas1, JSON.stringify({ think: '想', content: '写完' }))
  assert.equal(s1.events.at(-1).reason, 'toolUse')

  // 不支持模型（gemini-3.1-flash-lite / gemini-2.5-pro）或 toolChoice === 'none' 不传 streamFunctionCallArguments
  globalThis.__mockVertexChunks = (async function* () {
    yield { candidates: [{ content: { parts: [{ functionCall: { name: 'ping', args: {} } }] }, finishReason: 'STOP' }] }
  })()
  mod.stream({ id: 'gemini-3.1-flash-lite', provider: 'google-vertex', baseUrl: '' }, { messages: Object.assign([], { tools: [{ name: 'ping' }] }) }, { apiKey: 'k' })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(globalThis.__capturedVertexParams[1].config.toolConfig, undefined)
  assert.equal(globalThis.__capturedVertexParams[1].config.automaticFunctionCalling, undefined)

  // 漂移保护：锚点不匹配时不改写任何文件
  const drifted = vertexFixture.replace('toolConfig: { functionCallingConfig: { mode: functionCallingMode } }', 'toolConfig: changed')
  await writeFile(vertexFile, drifted)
  assert.equal(patchPiAiVertexStream({ sdkDirectory }), null)
  assert.equal(await readFile(vertexFile, 'utf8'), drifted)
  assert.equal(patchPiAiGoogleVertexSource('unknown').status, 'unmatched')
  assert.equal(patchPiAiGoogleSharedSource('unknown').status, 'unmatched')
  assert.equal(patchPiAiGoogleVertexModelsJson('{bad').status, 'unmatched')

  // 模型 JSON 键顺序不同但语义一致时不重复重写
  const reordered = {}
  for (const [k, v] of Object.entries(LATEST_GOOGLE_VERTEX_MODELS)) {
    const { thinkingLevelMap, ...rest } = v
    reordered[k] = thinkingLevelMap ? { id: rest.id, thinkingLevelMap, ...rest } : v
  }
  assert.equal(patchPiAiGoogleVertexModelsJson(JSON.stringify({ 'google-vertex': reordered })).status, 'patched')
})

test('Vertex 无 project 的安装：从 API key 的 404 里解析 project，并把 profile 路由指向 global', async () => {
  const blockStyle = 'refs:\n  GOOGLE_VERTEX_API_KEY: AQ.Ab8RN6J7lX3KYbfr9lkIuo31\n'
  const flowStyle = 'refs:\n  {\n    REAPI_API_KEY: k1,\n    GOOGLE_VERTEX_API_KEY: AQ.Ab8RN6J7lX3KYbfr9lkIuo31,\n  }\n'
  assert.equal(vertexApiKeyFrom({ credentialsText: blockStyle, env: {} }), 'AQ.Ab8RN6J7lX3KYbfr9lkIuo31')
  assert.equal(vertexApiKeyFrom({ credentialsText: flowStyle, env: {} }), 'AQ.Ab8RN6J7lX3KYbfr9lkIuo31')
  assert.equal(vertexApiKeyFrom({ env: { GOOGLE_CLOUD_API_KEY: 'env-key' } }), 'env-key')
  assert.equal(vertexApiKeyFrom({ credentialsText: 'nothing here', env: {} }), null)

  const notFound = '{"error":{"code":404,"message":"Publisher model `projects/379270002840/locations/asia-southeast1/publishers/google/models/gemini-4-carbon` was not found"}}'
  const seen = []
  const fake = body => async (url, init) => {
    seen.push({ url, init })
    return { status: body === '' ? 200 : 404, text: async () => body }
  }
  assert.equal(await discoverVertexProject({ apiKey: 'k'.repeat(20), request: fake(notFound) }), '379270002840')
  assert.match(seen[0].url, /\/v1\/publishers\/google\/models\/gemini-4-carbon:generateContent$/)
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'k'.repeat(20))
  assert.equal(await discoverVertexProject({ apiKey: 'k'.repeat(20), request: fake('{"candidates":[]}') }), null)
  assert.equal(await discoverVertexProject({ apiKey: 'k'.repeat(20), request: async () => { throw new Error('offline') } }), null)
  assert.equal(await discoverVertexProject({ apiKey: '   ', request: fake(notFound) }), null)

  const global = 'https://aiplatform.googleapis.com/v1/projects/379270002840/locations/global'
  const regional = 'x:\n      google-vertex:\n        displayName: Google Vertex AI\n        baseURL: https://asia-southeast1-aiplatform.googleapis.com/v1/projects/379270002840/locations/asia-southeast1\n'
  const regionRepair = repairVertexRouteBaseUrl({ profileText: regional, project: '379270002840' })
  assert.equal(regionRepair.status, 'repaired')
  assert.ok(regionRepair.text.includes(`baseURL: ${global}`))
  assert.equal(repairVertexRouteBaseUrl({ profileText: regionRepair.text, project: '379270002840' }).status, 'current')

  const missing = 'x:\n      google-vertex:\n        displayName: Google Vertex AI\n        apiKeyEnv: GOOGLE_VERTEX_API_KEY\n'
  const missingRepair = repairVertexRouteBaseUrl({ profileText: missing, project: '379270002840' })
  assert.equal(missingRepair.status, 'repaired')
  assert.ok(missingRepair.text.includes(`        baseURL: ${global}`))

  // 折叠/多行标量不改写，避免写坏 YAML
  const folded = 'x:\n      google-vertex:\n        baseURL: "https://aiplatform.googleapis.com/v1/projects/379270002840/locations/\\\n          global"\n'
  assert.equal(repairVertexRouteBaseUrl({ profileText: folded, project: '379270002840' }).status, 'unsafe')
  assert.equal(repairVertexRouteBaseUrl({ profileText: 'a: 1', project: '379270002840' }).status, 'absent')
  assert.equal(repairVertexRouteBaseUrl({ profileText: regional, project: '' }).status, 'project-less')
})

test('Vertex thinking：Gemini 4 只发 thinkingLevel，旧补丁的运行时也能被升级', () => {
  // 上游 1.3.x 的 usesGoogleThinkingLevel 只认 gemini-3，gemini-4 落进 budget 分支 → 400。
  const levelMap = { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null }
  assert.equal(vertexUsesThinkingLevel({ id: 'gemini-4-carbon' }), true)
  assert.equal(vertexUsesThinkingLevel({ id: 'gemini-4-hydrogen' }), true)
  assert.equal(vertexUsesThinkingLevel({ id: 'gemini-3.8-flash' }), true)
  assert.equal(vertexUsesThinkingLevel({ id: 'gemini-2.5-pro' }), false)
  assert.deepEqual(vertexDisabledThinkingConfig({ id: 'gemini-4-carbon', thinkingLevelMap: levelMap }), { thinkingLevel: 'LOW' })
  assert.deepEqual(vertexDisabledThinkingConfig({ id: 'gemini-2.5-pro' }), { thinkingBudget: 0 })
  assert.equal(vertexResolveThinkingLevel({ id: 'gemini-4-carbon', thinkingLevelMap: levelMap }, 'low'), 'low')
  assert.equal(vertexResolveThinkingLevel({ id: 'gemini-4-carbon', thinkingLevelMap: levelMap }, 'xhigh'), 'high')
  // 目录里没有该档位也不能抛错中断整轮
  assert.equal(vertexResolveThinkingLevel({ id: 'gemini-4-carbon' }, 'medium'), 'medium')

  // 旧版补丁留下的运行时（有 marker、没有 thinking 助手）必须能原地升级。
  const legacy = `${PI_AI_VERTEX_STREAM_MARKER}\nfunction supportsVertexStreamFunctionCallArguments(modelId) { return true }\nfunction createVertexToolCallStreamer() { return {} }\nexport const stream = (model, context, options) => {\n`
  const upgraded = patchPiAiGoogleVertexSource(legacy)
  assert.equal(upgraded.status, 'applied')
  assert.equal((upgraded.text.match(/function vertexUsesThinkingLevel/g) ?? []).length, 1)
  assert.equal(patchPiAiGoogleVertexSource(upgraded.text).status, 'patched')
})

test('Vertex 地区 (Region)：规范化、从 baseURL 提取与按地区生成端点地址', () => {
  assert.equal(normalizeVertexLocation(' Asia-Southeast1 '), 'asia-southeast1')
  assert.equal(normalizeVertexLocation('GLOBAL'), 'global')
  assert.equal(normalizeVertexLocation(''), null)
  assert.equal(normalizeVertexLocation('bad region!'), null)

  assert.equal(
    vertexBaseUrlForLocation('my-proj-123', 'global'),
    'https://aiplatform.googleapis.com/v1/projects/my-proj-123/locations/global',
  )
  assert.equal(
    vertexBaseUrlForLocation('my-proj-123', 'asia-southeast1'),
    'https://asia-southeast1-aiplatform.googleapis.com/v1/projects/my-proj-123/locations/asia-southeast1',
  )
  assert.equal(vertexBaseUrlForLocation('', 'asia-southeast1'), null)
  assert.equal(vertexBaseUrlForLocation('my-proj-123', '???'), null)

  assert.equal(
    vertexLocationFromBaseUrl('https://aiplatform.googleapis.com/v1/projects/379270002840/locations/global'),
    'global',
  )
  assert.equal(
    vertexLocationFromBaseUrl('https://asia-northeast1-aiplatform.googleapis.com/v1/projects/379270002840/locations/asia-northeast1'),
    'asia-northeast1',
  )
  assert.equal(
    vertexLocationFromBaseUrl('https://asia-east2-aiplatform.googleapis.com'),
    'asia-east2',
  )
  assert.equal(vertexLocationFromBaseUrl('https://{location}-aiplatform.googleapis.com'), null)

  const ids = new Set(VERTEX_REGIONS.map(item => item.id))
  for (const expected of ['global', 'asia-east2', 'asia-northeast1', 'asia-northeast3', 'asia-south1', 'asia-southeast1', 'asia-southeast2', 'australia-southeast1']) {
    assert.ok(ids.has(expected), `预设地区列表应包含 ${expected}`)
  }

  // 目录已写入 global 端点后，后续启动若临时未拿到 project，不应把目录退回 {location} 模板
  const withGlobal = patchPiAiGoogleVertexModelsJson(
    JSON.stringify({ 'google-vertex': { 'chat:gemini-2.5-flash': LATEST_GOOGLE_VERTEX_MODELS['chat:gemini-2.5-flash'] } }),
    { project: '379270002840' },
  )
  assert.equal(withGlobal.status, 'applied')
  const afterTransientMiss = patchPiAiGoogleVertexModelsJson(withGlobal.text, { project: null })
  assert.equal(afterTransientMiss.status, 'patched')
  assert.equal(
    JSON.parse(afterTransientMiss.text)['google-vertex']['chat:gemini-4-hydrogen'].baseUrl,
    'https://aiplatform.googleapis.com/v1/projects/379270002840/locations/global',
  )
})
