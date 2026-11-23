import { encodePreset, decodePreset } from './store.mjs';
import { parsePreset, digest } from './preset.mjs';

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

// The host persists this snapshot for retries. Keep all preset bytes in it,
// independent of later edits, deletion, or a change of selected preset/model.
export function freezeGenerationConfig(active) {
  const text = JSON.stringify(active.document);
  const config = { snapshotVersion: 1, documentGzip: encodePreset(text), documentDigest: digest(text),
    settings: structuredClone(active.settings), name: active.name, digest: active.digest };
  if (Buffer.byteLength(JSON.stringify(config)) > MAX_CONFIG_BYTES) {
    throw new Error('预设可以保存，但压缩后的生成配置超过宿主 2 MiB 上限，请精简预设内容后再生成');
  }
  return config;
}

export function restoreGenerationConfig(config) {
  if (config?.snapshotVersion === 1) {
    const text = decodePreset(config.documentGzip);
    if (digest(text) !== config.documentDigest) throw new Error('冻结的预设配置校验失败，请重新生成本轮');
    return { document: parsePreset(text), settings: config.settings, name: config.name, digest: config.digest };
  }
  // Existing host snapshots contain the expanded document.
  if (config?.snapshotVersion === undefined && config?.document && config?.settings) return config;
  throw new Error('宿主未提供冻结的预设配置，请重新生成本轮');
}
