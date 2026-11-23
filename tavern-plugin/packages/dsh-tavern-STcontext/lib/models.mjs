const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const reasoningEfforts = model => (model?.reasoning?.efforts || [])
  .map(effort => ({ id: effort.id, name: effort.name || effort.id }));

export function normalizeModelSelection(value) {
  if (value === null || value === undefined) return null;
  if (!object(value) || !text(value.provider) || !text(value.model)
    || Object.keys(value).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))
    || (value.reasoningEffort !== undefined && !text(value.reasoningEffort))) {
    throw new Error('模型选择无效，请在 STcontext 面板重新选择模型');
  }
  return { provider: value.provider.trim(), model: value.model.trim(),
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort.trim() }) };
}

/** Expose only model labels/capabilities, never provider connection settings. */
export async function listGenerationModels(llm) {
  const providers = await llm.listProviders();
  const groups = await Promise.all(providers.map(async provider => {
    const group = { provider: provider.id, providerName: provider.name || provider.id };
    try {
      const models = await llm.listModels(provider.id);
      return { ...group, models: models.filter(model => !Array.isArray(model.inputModalities) || model.inputModalities.includes('text'))
        .map(model => ({ id: model.id, name: model.name || model.id,
          efforts: reasoningEfforts(model) })) };
    } catch {
      return { ...group, models: [], error: '模型列表读取失败，请刷新重试' };
    }
  }));
  return { groups };
}

/** Lists may omit capabilities; resolve only the selected model's full metadata. */
export async function readGenerationModelReasoning(llm, input) {
  const selection = normalizeModelSelection(input);
  if (!selection) throw new Error('请先选择插件正文模型');
  try {
    const model = typeof llm.resolveModelInfo === 'function'
      ? await llm.resolveModelInfo(selection.provider, selection.model)
      : (await llm.listModels(selection.provider)).find(model => model.id === selection.model);
    if (!model) throw new Error('Model unavailable');
    return { efforts: reasoningEfforts(model) };
  } catch {
    throw new Error('推理等级读取失败，请刷新模型列表重试');
  }
}
