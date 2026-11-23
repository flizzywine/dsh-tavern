export const MAX_PRESET_BYTES = 10 * 1024 * 1024;
export const LEGACY_PRESET_BYTES = 2 * 1024 * 1024;
export const LEGACY_STORE_BYTES = 250 * 1024;

export function formatBytes(bytes) {
  const unit = bytes >= 1024 * 1024 ? 1024 * 1024 : 1024;
  return Number((bytes / unit).toFixed(2)) + (unit === 1024 ? ' KiB' : ' MiB');
}

export async function readStorageLimits(tavern) {
  if (typeof tavern.getPluginDataLimits !== 'function') {
    return { maxPresetBytes: LEGACY_PRESET_BYTES, maxStoreBytes: LEGACY_STORE_BYTES, legacy: true };
  }
  try {
    const value = await tavern.getPluginDataLimits();
    if (!Number.isSafeInteger(value?.maxBytes) || value.maxBytes < 1) throw new Error('宿主返回了无效额度');
    return { maxPresetBytes: MAX_PRESET_BYTES, maxStoreBytes: value.maxBytes, legacy: false };
  } catch (error) {
    throw new Error('无法读取宿主存储额度，请重试：' + (error?.message || String(error)));
  }
}
