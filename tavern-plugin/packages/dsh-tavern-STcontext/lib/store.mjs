import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { parsePreset, inspectPreset, MAX_PRESET_BYTES, digest } from './preset.mjs';
import { normalizeModelSelection } from './models.mjs';
import { parseEditedPreset } from './preset-edit.mjs';
import { readStorageLimits, formatBytes } from './limits.mjs';

const CHUNK_CHARS = 50000;
const MAX_READ_CACHE_BYTES = 32 * 1024 * 1024;
export function encodePreset(source) { return gzipSync(Buffer.from(source, 'utf8')).toString('base64'); }
export function decodePreset(data) {
  return gunzipSync(Buffer.from(data, 'base64'), { maxOutputLength: MAX_PRESET_BYTES }).toString('utf8');
}
export function createPresetStore(tavern, now = Date.now) {
  let tail = Promise.resolve();
  const uploads = new Map();
  const reads = new Map();
  const sharedPresetsAvailable = tavern.capabilities?.generationPresets === 1
    && typeof tavern.listGenerationPresets === 'function' && typeof tavern.readGenerationPreset === 'function';
  async function sharedPreset(selection, gameId) {
    if (!sharedPresetsAvailable) throw new Error('当前宿主不支持共享预设，请更新 DSH Tavern 或选择插件预设');
    const record = await tavern.readGenerationPreset(selection === 'current' ? { gameId } : { id: selection });
    return { document: parsePreset(record.text), name: record.name, digest: record.revision };
  }
  function part(token, offset) {
    const entry = reads.get(token);
    if (!entry || now() - entry.at > 60000) { reads.delete(token); throw new Error('分块读取已失效，请重试'); }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.text.length) throw new Error('预设读取位置无效');
    entry.at = now();
    const result = { ...entry.info, token, offset, total: entry.text.length, text: entry.text.slice(offset, offset + CHUNK_CHARS) };
    if (offset + result.text.length >= result.total) reads.delete(token);
    return result;
  }
  function startRead(text, info, kind, offset = 0) {
    for (const [key, value] of reads) if (now() - value.at > 60000) reads.delete(key);
    // Account for UTF-16 storage and bound concurrent abandoned readers.
    const bytes = text.length * 2;
    if (bytes > MAX_READ_CACHE_BYTES) throw new Error('预设或兼容报告过大，无法读取');
    let used = [...reads.values()].reduce((sum, entry) => sum + entry.text.length * 2, 0);
    while (reads.size && (reads.size >= 4 || used + bytes > MAX_READ_CACHE_BYTES)) {
      const key = reads.keys().next().value;
      used -= reads.get(key).text.length * 2; reads.delete(key);
    }
    const token = randomUUID();
    reads.set(token, { text, info, kind, at: now() });
    return part(token, offset);
  }
  async function read() {
    const saved = await tavern.readPluginData();
    if (!saved) return { schemaVersion: 1, activeId: null, presets: [], settings: {} };
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.presets)) throw new Error('插件配置格式无法读取');
    // Legacy slots cannot identify an independent route. Require a new choice.
    saved.settings = { ...saved.settings };
    // The unified compiler selects extensions from the preset itself.
    delete saved.settings.adapter;
    if (['foreground', 'background'].includes(saved.settings.model)) delete saved.settings.model;
    return saved;
  }
  const write = work => {
    const next = tail.then(async () => {
      const state = await read();
      await work(state);
      const limits = await readStorageLimits(tavern), bytes = Buffer.byteLength(JSON.stringify(state));
      if (bytes > limits.maxStoreBytes) throw new Error(`全部预设和配置超过插件存储上限（${formatBytes(bytes)} / ${formatBytes(limits.maxStoreBytes)}），请移除不再使用的预设或精简内容`);
      await tavern.savePluginData({ data: state });
      return list(state, limits, bytes);
    });
    tail = next.catch(() => {});
    return next;
  };
  async function list(state, limits, usedBytes) {
    state ||= await read();
    let limitsError = '';
    if (!limits) try { limits = await readStorageLimits(tavern); } catch (error) { limitsError = error.message; }
    usedBytes ??= Buffer.byteLength(JSON.stringify(state));
    return { activeId: state.activeId, hostPreset: state.hostPreset || null, settings: state.settings || {}, limits: limits || null, limitsError,
      storage: { usedBytes, remainingBytes: limits ? Math.max(0, limits.maxStoreBytes - usedBytes) : null },
      presets: state.presets.map(({ data, report, ...record }) => ({ ...record, summary: {
        enabledPrompts: report?.enabledPrompts || 0, regexCount: report?.regexCount || 0,
        blockers: report?.blockers?.length || 0, warnings: report?.warnings?.length || 0,
      } })) };
  }
  async function begin({ name, size, operation = 'import', presetId, revision }) {
    const limits = await readStorageLimits(tavern);
    for (const [id, upload] of uploads) if (now() - upload.at > 300000) uploads.delete(id);
    if (uploads.size >= 4) throw new Error('已有预设正在上传，请稍后重试');
    if (typeof name !== 'string' || !name.trim() || name.length > 160) throw new Error('预设文件名无效');
    if (!Number.isSafeInteger(size) || size < 1 || size > limits.maxPresetBytes) throw new Error('预设文件大小无效，最大 ' + formatBytes(limits.maxPresetBytes));
    if (!['import', 'replace', 'copy', 'validate'].includes(operation)) throw new Error('预设保存操作无效');
    if (operation !== 'import' && (typeof presetId !== 'string' || !presetId || typeof revision !== 'string' || !revision)) throw new Error('缺少预设编辑版本，请重新打开编辑器');
    const id = randomUUID();
    uploads.set(id, { name, size, operation, presetId, revision, maxBytes: limits.maxPresetBytes, chunks: [], length: 0, at: now() });
    return { id };
  }
  function chunk({ id, index, text }) {
    const upload = uploads.get(id);
    if (!upload || now() - upload.at > 300000) throw new Error('上传已失效，请重新导入');
    if (typeof text !== 'string' || text.length > 60000 || index !== upload.chunks.length || upload.length + text.length > upload.size) throw new Error('上传分块无效');
    upload.chunks.push(text); upload.length += text.length; upload.at = now();
    return { received: upload.length };
  }
  async function finish({ id }) {
    const upload = uploads.get(id);
    uploads.delete(id);
    if (!upload || upload.length !== upload.size) throw new Error('预设上传不完整');
    if (now() - upload.at > 300000) throw new Error('上传已失效，请重新导入或保存');
    const source = upload.chunks.join('');
    const limits = await readStorageLimits(tavern), maxBytes = Math.min(upload.maxBytes, limits.maxPresetBytes);
    if (Buffer.byteLength(source) > maxBytes) throw new Error('预设文件不能超过 ' + formatBytes(maxBytes) + '（按 UTF-8 字节计算）');
    const doc = (upload.operation === 'import' ? parsePreset : parseEditedPreset)(source), hash = digest(source), report = inspectPreset(doc);
    if (upload.operation === 'validate') return { reportPart: startRead(JSON.stringify(report), { id: upload.presetId, revision: upload.revision }, 'report') };
    const record = { id: hash, name: upload.name.trim(), bytes: Buffer.byteLength(source), importedAt: now(), digest: hash, revision: randomUUID(), data: encodePreset(source), report };
    return write(state => {
      if (upload.operation === 'replace' || upload.operation === 'copy') {
        const old = state.presets.findIndex(item => item.id === upload.presetId);
        if (old < 0) throw new Error('原预设已被移除；请导出草稿后重新导入');
        const previous = state.presets[old];
        if (upload.operation === 'replace' && (previous.revision || previous.digest) !== upload.revision) throw new Error('预设已在其他窗口修改；请另存为副本，或导出草稿后重新打开');
        if (upload.operation === 'replace') {
          state.presets[old] = { ...previous, ...record, id: previous.id, importedAt: previous.importedAt, updatedAt: now() };
        } else {
          record.id = randomUUID(); state.presets.push(record); state.activeId = record.id;
          delete state.hostPreset;
        }
        return;
      }
      // An edited record keeps its ID. Reimporting its original bytes must not
      // overwrite the edited content just because that ID was once a digest.
      const old = state.presets.findIndex(item => item.digest === hash);
      if (old >= 0) record.id = state.presets[old].id;
      else if (state.presets.some(item => item.id === hash)) record.id = randomUUID();
      if (old >= 0) state.presets[old] = record;
      else state.presets.push(record);
      state.activeId = record.id;
      delete state.hostPreset;
    });
  }
  async function active({ gameId } = {}) {
    const state = await read();
    if (state.hostPreset) return { ...await sharedPreset(state.hostPreset, gameId), settings: state.settings || {} };
    const record = state.presets.find(item => item.id === state.activeId);
    if (!record) throw new Error(sharedPresetsAvailable ? '请先在 STcontext 面板选择宿主预设或导入预设 JSON' : '请先在 STcontext 面板导入并选择预设 JSON');
    return { document: parsePreset(decodePreset(record.data)), settings: state.settings || {}, name: record.name, digest: record.digest };
  }
  async function readPreset({ id, offset = 0, revision, token }, kind) {
    if (token !== undefined) {
      const entry = reads.get(token);
      if (!entry || entry.kind !== kind || entry.info.id !== id || (revision !== undefined && revision !== entry.info.revision)) throw new Error('分块读取已失效，请重试');
      return part(token, offset);
    }
    const state = await read(), record = state.presets.find(item => item.id === id);
    if (!record) throw new Error('预设不存在');
    const currentRevision = record.revision || record.digest;
    if (revision !== undefined && revision !== currentRevision) throw new Error('预设已修改，请重新打开编辑器');
    const source = decodePreset(record.data);
    const text = kind === 'report' ? JSON.stringify(inspectPreset(parsePreset(source), state.settings || {})) : source;
    return startRead(text, { id, name: record.name, digest: record.digest, revision: currentRevision }, kind, offset);
  }
  return {
    list, begin, chunk, finish, active,
    async listHostPresets() {
      if (!sharedPresetsAvailable) return { sharedPresets: null };
      try { return { sharedPresets: await tavern.listGenerationPresets() }; }
      catch (error) { return { sharedPresets: [], sharedPresetsError: String(error?.message || error) }; }
    },
    cancel({ id }) { uploads.delete(id); return { cancelled: true }; },
    read: input => readPreset(input, 'source'),
    report: input => readPreset(input, 'report'),
    async select({ id, hostPreset }) {
      if (hostPreset !== undefined) {
        if (typeof hostPreset !== 'string' || !hostPreset.trim()) throw new Error('共享预设标识无效');
        if (!sharedPresetsAvailable) throw new Error('当前宿主不支持共享预设');
        if (hostPreset !== 'current') await sharedPreset(hostPreset);
        return write(state => { state.hostPreset = hostPreset; });
      }
      return write(state => {
        if (!state.presets.some(item => item.id === id)) throw new Error('预设不存在');
        state.activeId = id;
        delete state.hostPreset;
      });
    },
    async remove({ id }) { return write(state => { state.presets = state.presets.filter(item => item.id !== id); if (state.activeId === id) state.activeId = state.presets[0]?.id || null; }); },
    async export({ id }) { const state = await read(), record = state.presets.find(item => item.id === id); if (!record) throw new Error('预设不存在'); return { name: record.name, text: decodePreset(record.data) }; },
    async settings(input) {
      return write(state => {
        const next = { ...state.settings };
        // Ignore this removed field from stale clients, including when saving.
        delete next.adapter;
        if (Object.hasOwn(input, 'model')) {
          const model = normalizeModelSelection(input.model);
          if (model) next.model = model;
          else delete next.model;
        }
        if (Object.hasOwn(input, 'personaDescription')) {
          if (input.personaDescription !== null && typeof input.personaDescription !== 'string') throw new Error('玩家设定必须是文本');
          if (input.personaDescription?.trim()) next.personaDescription = input.personaDescription;
          else delete next.personaDescription;
        }
        for (const key of ['maxTokens', 'contextLimit', 'temperature']) if (Object.hasOwn(input, key)) {
          if (input[key] === '' || input[key] === null) delete next[key];
          else { const n = Number(input[key]); if (!Number.isFinite(n) || (key === 'temperature' ? n < 0 || n > 2 : !Number.isSafeInteger(n) || n <= 0)) throw new Error(key + ' 无效'); next[key] = n; }
        }
        state.settings = next;
      });
    },
  };
}
