import { createHash } from 'node:crypto';
import { createMacroEnvironment, renderMacros, inspectMacros } from './macros.mjs';
import { nativeRegexes, applyRegexOnce } from './regex.mjs';
import { inspectHelpers, formatHelperOutput } from './helper.mjs';
import { inspectNative } from './diagnostics.mjs';
import { inspectSpreset, transformSpresetRequest, formatSpresetOutput } from './spreset.mjs';
import { executeScript } from './sandbox.mjs';
import { validateRequestProtocol, assertMaterialsPreserved } from './request.mjs';
import { generationError, outputStage } from './errors.mjs';
import { createMaterialProtection } from './material-protection.mjs';
import { createPromptTemplates } from './prompt-template.mjs';
import { MAX_PRESET_BYTES, formatBytes } from './limits.mjs';
import { createReverieShortMacros, reverieLiteralTags, reverieMacros } from './reverie.mjs';

export { MAX_PRESET_BYTES } from './limits.mjs';
const ROLES = new Set(['system', 'user', 'assistant', 'model']);
const MARKERS = new Set(['worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'dialogueExamples', 'chatHistory']);
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function parsePreset(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_PRESET_BYTES) throw new Error('预设文件必须是不超过 ' + formatBytes(MAX_PRESET_BYTES) + ' 的 JSON');
  let doc;
  try { doc = JSON.parse(source); } catch (error) { throw new Error('预设 JSON 无效：' + error.message); }
  if (!object(doc) || !Array.isArray(doc.prompts) || !doc.prompts.length) throw new Error('预设缺少 prompts 数组');
  if (doc.prompts.length > 2000) throw new Error('预设提示词条目过多');
  const ids = new Set();
  for (const item of doc.prompts) {
    if (!object(item) || typeof item.identifier !== 'string' || !item.identifier) throw new Error('预设条目缺少 identifier');
    if (ids.has(item.identifier)) throw new Error('重复的提示词标识：' + item.identifier);
    ids.add(item.identifier);
    if (item.role !== undefined && !ROLES.has(item.role)) throw new Error('不支持的消息角色：' + item.role);
    if (item.content !== undefined && typeof item.content !== 'string') throw new Error('提示词 content 必须是字符串');
    if (item.injection_trigger !== undefined && !Array.isArray(item.injection_trigger)) throw new Error('提示词 injection_trigger 必须是数组');
  }
  if (!Array.isArray(doc.prompt_order) || !doc.prompt_order.length) throw new Error('预设缺少 prompt_order');
  const group = selectOrder(doc);
  if (!Array.isArray(group.order)) throw new Error('预设顺序不是数组');
  if (group.order.some(item => !object(item) || typeof item.identifier !== 'string' || (item.enabled !== undefined && typeof item.enabled !== 'boolean'))) throw new Error('预设顺序条目缺少标识或启用状态无效');
  if (new Set(group.order.map(entry => entry.identifier)).size !== group.order.length) throw new Error('同一提示词在顺序中重复出现');
  for (const item of group.order) if (!ids.has(item.identifier)) throw new Error('顺序引用了不存在的条目：' + item.identifier);
  for (const rule of nativeRegexes(doc)) {
    if (!object(rule)) throw new Error('预设正则规则必须是对象');
  }
  return doc;
}
function selectOrder(doc) {
  const matches = doc.prompt_order.filter(group => Number(group.character_id) === 100001);
  if (matches.length > 1) throw new Error('预设有多个 100001 顺序，无法确定当前顺序');
  if (matches.length) return matches[0];
  if (doc.prompt_order.length === 1) return doc.prompt_order[0];
  throw new Error('预设没有 100001 顺序，且存在多套候选顺序');
}
export function inspectPreset(doc, settings = {}) {
  return buildReport(doc, settings.trigger, inspectHelpers(doc));
}
function buildReport(doc, trigger, helper) {
  const group = selectOrder(doc);
  const reverie = helper.scripts.find(script => script.reverie)?.reverie;
  const warnings = [], blockers = [];
  const protocol = 'spreset';
  if (doc.extensions?.SPreset?.RegexBinding) warnings.push('只采用 extensions.regex_scripts；SPreset RegexBinding 作为原始数据保存，不重复执行。');
  const historyRules = nativeRegexes(doc).flatMap((rule, index) =>
    !rule.disabled && rule.enabled !== false && Array.isArray(rule.placement) && rule.placement.some(value => [1, 2].includes(Number(value))) && rule.promptOnly === true
      ? [{ index, name: String(rule.scriptName || index), reason: '每轮按照当前消息角色和深度处理发送副本' }] : []);
  const skipped = [];
  for (const [key, value] of Object.entries(doc)) if (['top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'seed', 'min_p', 'repetition_penalty'].includes(key) && value !== undefined) skipped.push(key);
  if (skipped.length) warnings.push('当前宿主未映射的采样项：' + skipped.join('、'));
  const extensionReport = inspectSpreset(doc, { trigger });
  const deferredMacros = helper.executable.length > 0 || doc.extensions?.SPreset?.FinalRequestProcessing?.enabled === true;
  const diagnostics = [...inspectNative(doc, group, { allowScript: deferredMacros, trigger, dynamicMacros: reverie && reverieMacros }), ...extensionReport.diagnostics, ...helper.diagnostics];
  if (reverie?.noiseEnabled) diagnostics.push({ severity: 'error', stage: 'helper', path: 'Reverie.noise_padding',
    message: '当前适配支持关闭输入噪声的剧情生成，请关闭助手设置中的输入噪声。' });
  for (const item of diagnostics) (item.severity === 'error' ? blockers : warnings).push(item.path + '：' + item.message);
  return { diagnostics, hooks: [...extensionReport.hooks, ...helper.executable.map(script => 'TavernHelper: ' + script.name)], validation: 'static', order: Number(group.character_id), enabledPrompts: group.order.filter(x => x.enabled !== false).length, regexCount: nativeRegexes(doc).length,
    protocol, deferredMacros, scripts: helper.reports,
    historyRules, warnings, blockers };
}
function materialMessages(materials) {
  if (materials?.schemaVersion !== 1 || materials.completeness?.history !== 'all-visible') throw new Error('宿主未提供完整可见历史材料');
  if (!Array.isArray(materials.history)) throw new Error('宿主历史材料无效');
  for (const row of materials.history) {
    if (!['user', 'assistant'].includes(row.role) || typeof row.text !== 'string' || row.is_hidden || row.hidden || row.tavernHidden) throw new Error('宿主历史含不可用或隐藏消息');
  }
  if (typeof materials.input?.projected !== 'string') throw new Error('宿主缺少本轮输入');
  return materials.history;
}
function squash(messages) {
  const result = [];
  for (const message of messages) {
    const last = result.at(-1);
    // Keep provenance boundaries until the script adapter has consumed them.
    if (last?.role === 'system' && message.role === 'system' && last.source === message.source) last.content += '\n\n' + message.content;
    else result.push({ ...message });
  }
  return result;
}
export function compilePreset(doc, materials, settings = {}) {
  const trigger = materials.trigger ?? (materials.target?.kind === 'generate' ? 'normal' : 'regenerate');
  if (!['normal', 'regenerate', 'continue'].includes(trigger)) throw new Error('不支持的正文生成触发类型：' + trigger);
  const helper = inspectHelpers(doc);
  const report = buildReport(doc, trigger, helper);
  if (report.blockers.length) throw new Error(report.blockers.join('；'));
  const reverie = helper.scripts.find(script => script.reverie)?.reverie;
  const rows = materialMessages(materials), rules = nativeRegexes(doc);
  // The public host history contains frozen prose. For STcontext turns the
  // caller can also recover the exact ST source, including the selected swipe.
  const sourceFor = row => {
    if (typeof row.sourceText === 'string') return row.sourceText;
    if (row.role === 'assistant') return row.text;
    return applyRegexOnce(row.text, rules, { placement: 1, channel: 'write' }).text;
  };
  const sourceHistory = rows.map(row => ({ ...row, text: sourceFor(row) }));
  const inputSourceText = sourceFor({ role: 'user', text: materials.input.projected, sourceText: materials.input.sourceText });
  const historyProjections = [];
  const project = (role, source, sourceText, depth) => {
    const placement = role === 'user' ? 1 : 2;
    const projection = applyRegexOnce(sourceText, rules, { placement, channel: 'prompt', depth });
    if (projection.applied.length) historyProjections.push({ role, source, depth, beforeLength: sourceText.length,
      afterLength: projection.text.length, rules: projection.applied.map(({ id, name }) => ({ id, name })) });
    // Reverie's history rule emits this sentinel to omit an old player row.
    // Only a rule-produced sentinel has that meaning; a player can quote it.
    const omitted = reverie && role === 'user' && projection.text === '<|placeholder|>'
      && projection.applied.some(rule => rules[rule.index].replaceString === '<|placeholder|>');
    return { role, source, content: omitted ? '' : projection.text };
  };
  const inputDepth = trigger === 'continue' ? -1 : 0;
  const history = sourceHistory.map((row, index) => project(row.role, 'history', row.text, rows.length - index + inputDepth));
  const input = project('user', 'input', inputSourceText, inputDepth);
  const protection = createMaterialProtection(reverie ? reverieLiteralTags : undefined);
  const env = createMacroEnvironment({ userName: materials.persona?.name || '你', charName: materials.card?.name || '',
    history: sourceHistory, input: inputSourceText, dynamicMacros: reverie && reverieMacros });
  // The adapter renders the story branch using the exported 3.18.1 settings.
  if (reverie) env.local['本轮场外讨论'] = '0';
  const shortMacros = reverie && createReverieShortMacros(reverie, env, protection.tokenFor);
  // Message metadata and the canonical message text belong to the same floor.
  env.chat = [...sourceHistory, { role: 'user', text: inputSourceText }];
  const pendingMacros = new Set();
  const renderNative = value => {
    const template = value.replace(/<(user|char)>/gi, '{{$1}}');
    for (const macro of inspectMacros(template, { dynamicMacros: env.dynamicMacros }).unknown) pendingMacros.add(macro);
    const text = renderMacros(template, env, { allowScript: report.deferredMacros, opaque: protection.tokenFor });
    if (!shortMacros) return text;
    if (text.includes('<|命定_工具输出|>')) throw new Error('Reverie 工具尾部需要配套工具交付协议，请选择非工具尾部。');
    for (const [marker] of text.matchAll(/<\|命定_[^|>\r\n]+\|>/gu)) pendingMacros.add(marker);
    return shortMacros(text);
  };
  const templates = createPromptTemplates({ renderNative, env, materials, trigger, opaque: protection.tokenFor });
  const rendered = templates.prepare;
  const card = materials.card || {};
  // The captured cardContext includes constant lore/persona and is already
  // expanded. Never execute the old turn's macros/EJS again.
  const capturedCard = typeof materials.cardContext === 'string' && materials.cardContext.length > 0;
  if (capturedCard) report.warnings.push('人物与固定设定使用宿主已解析的原轮上下文；不再次执行卡片宏、EJS 或人物卡提示词覆盖。');
  const description = capturedCard ? materials.cardContext : String(card.description || '');
  if (!capturedCard && /<%|\{\{/.test([card.description, card.personality, card.scenario, card.mes_example].join(''))) throw new Error('人物材料尚未解析，请使用宿主原轮完整材料快照');
  const markers = {
    worldInfoBefore: '',
    worldInfoAfter: materials.worldbook?.constantContext || '',
    // User-authored persona is literal material, protected like the host context.
    personaDescription: settings.personaDescription?.trim() ? settings.personaDescription : capturedCard ? '' : materials.persona?.description || '',
    charDescription: description,
    charPersonality: capturedCard ? '' : card.personality || '',
    scenario: capturedCard ? '' : card.scenario || '',
    dialogueExamples: capturedCard ? '' : card.mes_example || '',
  };
  const requirements = (materials.writingRequirements || []).map(item => item.text).filter(Boolean);
  const state = materials.beforeState || {};
  const hasState = Object.values(state).some(value => value != null && value !== '' &&
    (typeof value !== 'object' || Object.keys(value).length > 0));
  // Keep dynamic host context after the stable visible history. Most providers
  // can preserve its position as a labelled user message. Reverie's processor
  // expects system injections here and moves them into its rules section.
  const turnRole = reverie ? 'system' : 'user';
  const turnMaterial = (title, text) => ({ role: turnRole, content: title + '\n' + text, rawContent: text, source: 'materials', turnMaterial: true });
  const turnMaterials = [
    ...(materials.worldbook?.context ? [turnMaterial('【本轮世界书参考资料】', materials.worldbook.context)] : []),
    ...(requirements.length ? [turnMaterial('【本轮写作要求与指导】', requirements.join('\n\n'))] : []),
    ...(hasState ? [{ role: turnRole, content: '【正文生成前的权威状态】\n' + JSON.stringify(state), source: 'materials', turnMaterial: true }] : []),
  ];
  const historyBlock = [...history, input], used = new Set(), normal = [], depth = [];
  const group = selectOrder(doc), definitions = new Map(doc.prompts.map(item => [item.identifier, item]));
  for (const order of group.order) {
    if (order.enabled === false) continue;
    const entry = definitions.get(order.identifier);
    if (Array.isArray(entry.injection_trigger) && entry.injection_trigger.length && !entry.injection_trigger.includes(trigger)) continue;
    const identifier = entry.identifier, role = entry.role === 'model' ? 'assistant' : ROLES.has(entry.role) ? entry.role : 'system';
    if (Number(entry.injection_position) === 1 && !MARKERS.has(identifier)) {
      depth.push({ role, content: rendered(entry.content || ''), source: 'preset', depth: Math.max(0, Number(entry.injection_depth) || 0), order: Number(entry.injection_order) || 0 }); continue;
    }
    if (identifier === 'chatHistory') { normal.push({ history: true }); used.add(identifier); }
    else if (Object.hasOwn(markers, identifier)) {
      used.add(identifier);
      if (markers[identifier]) normal.push({ role, content: markers[identifier], source: 'materials' });
    } else {
      const content = rendered(entry.content || '');
      if (content.trim()) normal.push({ role, content, source: 'preset' });
    }
  }
  // Apply fixed depth against the original history length, not repeated splice positions.
  depth.sort((a, b) => b.depth - a.depth || a.order - b.order);
  let added = 0;
  for (const { depth: d, order: _order, ...message } of depth) {
    if (!message.content.trim()) continue;
    historyBlock.splice(Math.max(0, history.length + 1 - d) + added++, 0, message);
  }
  // Inject after resolving chat depths so material messages never count as
  // historical floors. Depth 0 remains after input; depth 1 precedes materials.
  historyBlock.splice(historyBlock.indexOf(input), 0, ...turnMaterials);
  if (!used.has('chatHistory')) { normal.push({ history: true }); report.warnings.push('预设未启用 chatHistory；插件已补入完整历史与本轮输入。'); }
  const missing = Object.entries(markers).filter(([key, value]) => value && !used.has(key));
  normal.unshift(...missing.map(([, content]) => ({ role: 'system', content, source: 'materials' })));
  if (missing.length) report.warnings.push('预设缺少材料占位项，已补入：' + missing.map(([key]) => key).join('、'));
  // ST computes depth using all visible floors, then omits empty text
  // messages from the outgoing Chat Completion collection.
  let messages = normal.flatMap(item => item.history ? historyBlock : [item]).filter(message => message.content !== '');
  if (doc.squash_system_messages) messages = squash(messages);
  const rawMessages = messages.map(message => ({ ...message, content: protection.restoreText(message.content) }));
  const logicalMessages = rawMessages.map(({ role, content }) => ({ role, content }));
  let plan = { messages: logicalMessages };
  const parameter = (override, preset, fallback) => override === '' || override === undefined || override === null ? preset ?? fallback : Number(override);
  plan.temperature = parameter(settings.temperature, doc.temperature, undefined);
  plan.maxTokens = parameter(settings.maxTokens, doc.openai_max_tokens ?? doc.max_tokens, 8192);
  plan.contextLimit = parameter(settings.contextLimit, undefined, undefined);
  if (settings.model) plan.model = structuredClone(settings.model);
  for (const key of ['temperature', 'contextLimit']) if (plan[key] === undefined) delete plan[key];
  if (!Number.isSafeInteger(plan.maxTokens) || plan.maxTokens <= 0) throw new Error('输出 token 上限必须是正整数');
  if (plan.contextLimit !== undefined && (!Number.isSafeInteger(plan.contextLimit) || plan.contextLimit <= plan.maxTokens)) throw new Error('上下文上限必须大于输出 token 上限');
  if (plan.temperature !== undefined && (!Number.isFinite(plan.temperature) || plan.temperature < 0 || plan.temperature > 2)) throw new Error('温度必须在 0–2 之间');
  const transformed = transformSpresetRequest(doc, protection.protectMessages(messages), plan, {
    execute: executeScript, env, trigger, protection, pendingMacros: [...pendingMacros], scriptState: materials.scriptState, templates,
    materials: { ...materials, history: sourceHistory, input: { ...materials.input, projected: inputSourceText } },
    temperatureOverride: settings.temperature !== undefined && settings.temperature !== null && settings.temperature !== '',
  });
  plan = transformed.plan;
  validateRequestProtocol(plan);
  // An explicit request transform may intentionally fold, rewrite or remove
  // material. The authoritative host snapshot is independent of this request.
  const post = doc.extensions?.SPreset?.ChatSquash;
  if (!report.deferredMacros && !post?.enabled) assertMaterialsPreserved(rawMessages, plan);
  report.warnings.push(...(transformed.notes || []));
  return { request: plan, ...(reverie && doc.use_sysprompt === true && { reverieSystemPrompt: true }),
    logicalMessages, helperState: transformed.helperState, scriptState: transformed.scriptState, inputSourceText,
    report: { ...report, trigger, historyProjections }, presetDigest: digest(doc), historyMessages: history.length };
}
export function processOutput({ document, response, helperState, toolNames = [], projectDisplay = true }) {
  if (!response || typeof response !== 'object') throw generationError('EMPTY_RESPONSE', '模型未返回结果，服务商未提供具体原因', 'response');
  const check = value => { for (const call of value.toolCalls || []) {
    if (!toolNames.includes(call.name)) throw new Error('模型返回了未声明的工具调用');
    const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
    if (!object(args)) throw new Error('工具正文参数必须是完整 JSON 对象');
  } };
  // Track where content disappeared, but allow later configured stages to
  // produce text from an empty intermediate value as they did before.
  let emptyStage;
  const observe = (stage, present) => { if (present) emptyStage = undefined; else emptyStage ??= stage; };
  const present = value => !!value.text?.trim() || !!value.toolCalls?.length;
  observe('response', present(response));
  outputStage('tool-validation', '模型工具结果校验', () => check(response));
  const formatted = outputStage('helper-output', '助手输出处理', () => formatHelperOutput(document, response, helperState));
  observe('helper-output', present(formatted));
  outputStage('helper-output', '助手工具结果校验', () => check(formatted));
  const decoded = formatSpresetOutput(document, formatted, executeScript, (stage, text) => observe(stage, !!text.trim()));
  const rules = nativeRegexes(document);
  const source = outputStage('output-regex', '预设写入正则处理', () => applyRegexOnce(decoded, rules, { placement: 2, channel: 'write' }));
  observe('output-regex', !!source.text.trim());
  if (!source.text.trim()) {
    const labels = { response: '模型未返回有效正文，服务商未提供具体原因', 'helper-output': '助手输出处理后正文为空',
      'tool-formatter': '工具正文格式化后正文为空，请检查模型工具结果和预设格式化规则',
      'output-script': '预设输出脚本处理后正文为空', 'output-regex': '预设正则处理后正文为空' };
    throw generationError('OUTPUT_EMPTY', labels[emptyStage] + '，未替换宿主正文', emptyStage);
  }
  const result = projectDisplay
    ? outputStage('output-regex', '预设显示正则处理', () => applyRegexOnce(source.text, rules, { placement: 2, depth: 0, channel: 'display' }))
    : { text: source.text, applied: [] };
  return { text: result.text, displayText: result.text, sourceText: source.text, scriptState: formatted.scriptState,
    metadata: { presetDigest: digest(document), appliedRegex: { write: source.applied, display: result.applied } } };
}
