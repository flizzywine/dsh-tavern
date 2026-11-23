import { createPresetStore } from './lib/store.mjs';
import { inspectPreset, digest } from './lib/preset.mjs';
import { displayRegexes } from './lib/regex.mjs';
import { createTurnMemory } from './lib/turn-memory.mjs';
import { runCompiler } from './lib/worker-client.mjs';
import { createDshGeneration, selectGenerationModel } from './lib/generation.mjs';
import { listGenerationModels, readGenerationModelReasoning } from './lib/models.mjs';
import { compilerMaterials } from './lib/materials.mjs';
import { createProtocolTransport } from './lib/protocol-transport.mjs';
import { freezeGenerationConfig, restoreGenerationConfig } from './lib/generation-config.mjs';

export const name = 'dsh-tavern-STcontext';
// DSH Cordis expects service names, not the legacy required/optional shape.
export const inject = ['tavern', 'llm'];
const PREFIX = 'dsh-tavern-stcontext';
const PROVIDER = 'st-context';
export function apply(ctx) {
  const generateBody = createDshGeneration({ llm: ctx.llm, meter: ctx.get('tokenMeter'), protocolTransport: createProtocolTransport(ctx) });
  const store = createPresetStore(ctx.tavern), previews = new Map();
  const memory = createTurnMemory(ctx.tavern);
  const projectsDisplay = ctx.tavern.capabilities?.bodyProjection === 1;
  const capable = () => ctx.tavern.capabilities?.bodyGeneration === 1 && typeof ctx.tavern.bodyGenerator === 'function';
  const handle = (key, callback) => ctx.tavern.handle(PREFIX + '/' + key, callback);
  handle('config', async () => ({ ...(await store.list()), ...(await store.listHostPresets()), hostReady: capable(), generationReady: capable() }));
  handle('body-generation-defaults', ({ mode, hostRegex } = {}) => {
    if (capable() && ctx.tavern.capabilities?.bodyGenerationDefaults === 1 && typeof ctx.tavern.bodyGenerationDefaults === 'function') {
      return ctx.tavern.bodyGenerationDefaults({ name: PROVIDER, mode, hostRegex });
    }
    if (mode !== undefined || hostRegex !== undefined) throw new Error('请在「设置 → DSH Tavern → 剧情」修改正文生成设置。');
    return null;
  });
  handle('models', () => listGenerationModels(ctx.llm));
  handle('model-reasoning', input => readGenerationModelReasoning(ctx.llm, input));
  handle('upload/begin', input => store.begin(input));
  handle('upload/chunk', input => store.chunk(input));
  handle('upload/finish', input => store.finish(input));
  handle('upload/cancel', input => store.cancel(input));
  handle('preset/read', input => store.read(input));
  handle('preset/report', input => store.report(input));
  handle('select', input => store.select(input));
  handle('remove', input => store.remove(input));
  handle('export', input => store.export(input));
  handle('settings', input => store.settings(input));
  handle('request', async ({ gameId, offset = 0 }) => {
    const item = previews.get(gameId);
    if (!item) return null;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > item.json.length) throw new Error('请求预览位置无效');
    return { createdAt: item.createdAt, report: item.report, total: item.json.length, offset, text: item.json.slice(offset, offset + 60000) };
  });
  if (typeof ctx.tavern.onGameRemoved === 'function') ctx.tavern.onGameRemoved(({ gameId }) => previews.delete(gameId));
  async function prepare({ gameId, signal, reason }) {
    signal?.throwIfAborted();
    const active = await store.active({ gameId });
    signal?.throwIfAborted();
    const report = inspectPreset(active.document, { ...active.settings, trigger: reason === 'normal' ? 'normal' : 'regenerate' });
    if (report.blockers.length) throw new Error(report.blockers.join('；'));
    selectGenerationModel(active.settings.model);
    return freezeGenerationConfig(active);
  }
  async function generate({ materials, config, signal }) {
    signal?.throwIfAborted();
    const active = restoreGenerationConfig(config);
    if (!active?.document || !active?.settings) throw new Error('宿主未提供冻结的预设配置，请重新生成本轮');
    selectGenerationModel(active.settings.model);
    const input = compilerMaterials(materials);
    const memoryWarnings = await memory.restore(input, digest(active.document), signal);
    const compiled = await runCompiler('compile', { document: active.document, materials: input, settings: active.settings }, { signal });
    const report = { ...compiled.report, preset: active.name, presetDigest: compiled.presetDigest, historyMessages: compiled.historyMessages,
      operationId: materials.operationId, reason: materials.reason,
      ...(typeof materials.outputProcessing?.hostRegex === 'boolean'
        ? { outputProcessing: { hostRegex: materials.outputProcessing.hostRegex } } : {}) };
    report.warnings.push(...memoryWarnings);
    if (!projectsDisplay) report.warnings.push('宿主缺少正文双通道接口，聊天将显示未美化的消息源文。');
    if (compiled.scriptState && !memory.available) report.warnings.push('宿主缺少版本化楼层存储，当前预设的聊天脚本状态仅在本轮有效。');
    const preview = () => JSON.stringify({ report, logicalMessages: compiled.logicalMessages, request: compiled.request }, null, 2);
    previews.delete(materials.gameId);
    const entry = { json: preview(), report, createdAt: Date.now() };
    previews.set(materials.gameId, entry);
    while (previews.size > 3) previews.delete(previews.keys().next().value);
    const response = await generateBody({ request: compiled.request, reverieSystemPrompt: compiled.reverieSystemPrompt, signal });
    signal?.throwIfAborted();
    const result = await runCompiler('output', { document: active.document, response, helperState: compiled.helperState, projectDisplay: false,
      toolNames: (compiled.request.tools || []).map(tool => tool.name) }, { signal });
    signal?.throwIfAborted();
    // Keep the host's saved model layer usable as the source for future depths.
    // A rule targeting both channels is applied to the prompt later by the compiler.
    const regexScripts = projectsDisplay ? displayRegexes(active.document) : [];
    const warnings = await memory.stage(materials, compiled, result.sourceText, signal);
    if (warnings.length) {
      report.warnings.push(...warnings);
      entry.json = preview();
    }
    signal?.throwIfAborted();
    return { text: result.sourceText, ...(regexScripts.length ? { regexScripts } : {}) };
  }
  if (capable()) {
    ctx.tavern.bodyGenerator({ name: PROVIDER, title: 'STcontext', prepare, generate });
  }
}
