import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const hash = text => createHash('sha256').update(text).digest('hex');
const validTurn = turn => Number.isSafeInteger(turn) && turn > 0;
const key = 'stcontextPending';
const backupKey = 'stcontextVersionBackups';
const maxRecord = 64 * 1024, maxExpanded = 8 * 1024 * 1024;
const maxBackupBytes = 2 * 1024 * 1024;
const backupWarning = '楼层状态已使用本局的版本化备用存储。';
const backupLimitWarning = '备用存储只保留最近 64 条、总计 2 MiB 以内的记录，更早的超额状态可能无法还原。';
const damagedWarning = '部分楼层状态格式过旧或数据损坏，已跳过这些记录。';
const rows = value => Array.isArray(value) ? value : [];
const digestOfBody = text => typeof text === 'string' ? hash(text.trim()) : null;
function validCandidate(candidate) {
  return candidate && Number.isSafeInteger(candidate.afterTurn) && candidate.afterTurn >= 0 &&
    Array.isArray(candidate.inputs) && typeof candidate.bodyHash === 'string' && candidate.record?.bodyHash === candidate.bodyHash;
}
function backup(game, entry) {
  if (Buffer.byteLength(JSON.stringify(entry)) + 2 > maxBackupBytes) {
    game.stcontextBackupsTrimmed = true;
    return;
  }
  const saved = rows(game[backupKey]).filter(item => item?.turn !== entry.turn || item.textVersion !== entry.textVersion);
  saved.push(entry);
  let bytes = 0, start = saved.length;
  while (start > 0 && saved.length - start < 64) {
    bytes += Buffer.byteLength(JSON.stringify(saved[start - 1])) + 1;
    if (bytes + 2 > maxBackupBytes) break;
    start--;
  }
  if (start) game.stcontextBackupsTrimmed = true;
  game[backupKey] = saved.slice(start);
}

// generate() returns before the host commits the body. Keep a candidate separate
// until a selected version has the expected source, player input and preceding turn.
export function createTurnMemory(tavern) {
  const available = ['readGameData', 'saveGameData', 'saveTurnData', 'readTurnData',
    'getTurn', 'getHistory', 'onTurnSettled'].every(method => typeof tavern[method] === 'function');
  const queues = new Map();
  function serialize(gameId, work) {
    const next = (queues.get(gameId) || Promise.resolve()).catch(() => {}).then(work);
    queues.set(gameId, next);
    const release = () => { if (queues.get(gameId) === next) queues.delete(gameId); };
    next.then(release, release);
    return next;
  }
  async function savePending(gameId, current, candidates) {
    const data = { ...current };
    if (candidates.length) data[key] = candidates;
    else delete data[key];
    await tavern.saveGameData({ gameId, data });
  }
  async function commit(gameId, game, candidate, version, confirmed = false) {
    const { bodyHash, inputs, parent } = candidate;
    const turn = version?.turn;
    if (!validTurn(turn) || turn <= candidate.afterTurn || digestOfBody(version.rawText) !== bodyHash || !version.textVersion) return false;
    // A regeneration returning identical prose may keep the old textVersion.
    // Only a host commit notification can distinguish that from an abandoned retry.
    if (!confirmed && version.textVersion === candidate.replacedVersion && candidate.confirmedVersion !== version.textVersion) return false;
    const [floor] = await tavern.getHistory({ gameId, from: turn, to: turn });
    if (floor?.turn !== turn || digestOfBody(floor.rawText) !== bodyHash || typeof floor.input !== 'string' || !inputs.includes(hash(floor.input))) return false;
    if (parent) {
      const previous = await tavern.getTurn({ gameId, turn: parent.turn });
      if (previous?.textVersion !== parent.textVersion) return false;
    }
    if (Buffer.byteLength(JSON.stringify(candidate.record)) <= maxRecord) {
      try {
        await tavern.saveTurnData({ gameId, turn, textVersion: version.textVersion, data: candidate.record });
        // A same-text regeneration can supersede a previous backup for this version.
        if (Array.isArray(game[backupKey])) game[backupKey] = game[backupKey].filter(entry => entry?.turn !== turn || entry.textVersion !== version.textVersion);
        return true;
      } catch (error) {
        if (['TAVERN_PLUGIN_STALE_VERSION', 'TAVERN_PLUGIN_TURN_UNAVAILABLE'].includes(error?.code)) return false;
        if (error?.code !== 'TAVERN_PLUGIN_INVALID' || !/超过|上限/.test(error.message)) throw error;
      }
    }
    backup(game, { gameId, turn, textVersion: version.textVersion, data: candidate.record });
    return true;
  }
  if (available) {
    tavern.onTurnSettled(event => serialize(event.gameId, async () => {
      const current = await tavern.readGameData({ gameId: event.gameId });
      const candidates = rows(current?.[key]).filter(validCandidate);
      const candidate = candidates.findLast(item => item.gameId === event.gameId && item.afterTurn < event.turn);
      if (candidate && await commit(event.gameId, current, candidate, event, true)) {
        await savePending(event.gameId, current, candidates.filter(item => item !== candidate));
      }
    }));
    tavern.onTimelineChanged?.(({ gameId, kind, turn, textVersion }) => {
      if (!['edit', 'rollback', 'undo-rollback', 'fork', 'regenerate'].includes(kind)) return;
      return serialize(gameId, async () => {
        const current = await tavern.readGameData({ gameId });
        const candidates = rows(current?.[key]).filter(validCandidate);
        if (!candidates.length) return;
        if (kind === 'regenerate') {
          const candidate = candidates.findLast(item => item.gameId === gameId && item.afterTurn < turn);
          if (candidate && textVersion) {
            candidate.confirmedVersion = textVersion;
            await savePending(gameId, current, candidates);
          }
        } else await savePending(gameId, current, []);
      });
    });
  }

  return {
    available,
    async restore(materials, presetDigest, signal) {
      if (!available) return [];
      const { gameId, history } = materials;
      const floors = new Map(), warnings = new Set(), restored = new Set();
      history.forEach((row, i) => {
        if (row.role === 'assistant' && validTurn(row.turn)) floors.set(row.turn, { row, user: history[i - 1] });
      });
      const last = [...floors.keys()].at(-1);
      let newestState = 0;
      function attach(turn, record) {
        const floor = floors.get(turn);
        if (restored.has(turn) || floor?.user?.role !== 'user') return;
        try {
          if (record?.format !== 1 || typeof record.payload !== 'string') throw Error();
          const data = JSON.parse(gunzipSync(Buffer.from(record.payload, 'base64'), { maxOutputLength: maxExpanded }).toString('utf8'));
          if (!Array.isArray(data?.inputs) || typeof data.presetDigest !== 'string') throw Error();
          const state = data.scriptState;
          if (state !== undefined && [state?.chatMetadata, state?.currentInputExtra].some(value => !value || typeof value !== 'object' || Array.isArray(value))) throw Error();
          if (!data.inputs.includes(hash(floor.user.text))) return;
          if (typeof data.inputSourceText === 'string') floor.user.sourceText = data.inputSourceText;
          restored.add(turn);
          if (data.presetDigest !== presetDigest || !data.scriptState) return;
          floor.user.extra = data.scriptState.currentInputExtra;
          if (turn > newestState) {
            materials.scriptState = { chatMetadata: data.scriptState.chatMetadata };
            newestState = turn;
          }
        } catch {
          warnings.add(damagedWarning);
        }
      }
      async function attachSelected({ turn, data, textVersion }, requireVersion = false) {
        const floor = floors.get(turn);
        if (!floor || restored.has(turn)) return;
        if (data?.format !== 1 || typeof data.bodyHash !== 'string' || typeof data.payload !== 'string') {
          warnings.add(damagedWarning);
          return;
        }
        // Host prompt rules may change the frozen DTO text; verify the selected
        // source instead. Backups also require an exact current version.
        const sameBody = data?.bodyHash === digestOfBody(floor.row.text);
        if (!sameBody && !data?.hostRegex) return;
        if (requireVersion || !sameBody) {
          const selected = await tavern.getTurn({ gameId, turn });
          if (!selected || selected.textVersion !== textVersion || digestOfBody(selected.rawText) !== data?.bodyHash) return;
        }
        attach(turn, data);
      }
      await serialize(gameId, async () => {
        const current = (await tavern.readGameData({ gameId })) || {};
        const candidates = rows(current[key]);
        const keep = [];
        for (const candidate of candidates) {
          signal?.throwIfAborted();
          // An abandoned candidate for this generation target must never
          // acquire a later edit or an identical regenerated body.
          if (!validCandidate(candidate)) { warnings.add(damagedWarning); continue; }
          if (candidate.gameId !== gameId || (candidate.afterTurn && !floors.has(candidate.afterTurn))) continue;
          const following = [...floors.keys()].find(turn => turn > candidate.afterTurn);
          if (!following) continue;
          const version = await tavern.getTurn({ gameId, turn: following });
          if (version) {
            if (version.textVersion === candidate.replacedVersion && candidate.confirmedVersion !== version.textVersion &&
                digestOfBody(version.rawText) === candidate.bodyHash && floors.get(following).user?.role === 'user' &&
                candidate.inputs.includes(hash(floors.get(following).user.text))) keep.push(candidate);
            else await commit(gameId, current, candidate, version);
          } else {
            // The next generation may already include this saved floor while
            // the host still withholds getTurn() until settlement. Use only
            // a version attested by the host, without marking it committed.
            const selected = await tavern.getTurnState?.({ gameId });
            const floor = floors.get(following);
            if (!candidate.record.hostRegex && digestOfBody(floor.row.text) !== candidate.bodyHash ||
                floor.user?.role !== 'user' || !candidate.inputs.includes(hash(floor.user.text))) continue;
            keep.push(candidate);
            if (selected?.turn !== following || !selected.textVersion || digestOfBody(floor.row.text) !== candidate.bodyHash ||
                selected.textVersion === candidate.replacedVersion && selected.textVersion !== candidate.confirmedVersion) continue;
            if (candidate.parent && (await tavern.getTurn({ gameId, turn: candidate.parent.turn }))?.textVersion !== candidate.parent.textVersion) continue;
            attach(following, candidate.record);
          }
        }
        if (keep.length !== candidates.length) await savePending(gameId, current, keep);
        const allBackups = rows(current[backupKey]);
        const backups = allBackups.filter(entry => entry?.gameId === gameId);
        for (const entry of backups) {
          signal?.throwIfAborted();
          await attachSelected(entry, true);
        }
        if (backups.length) warnings.add(backupWarning);
        if (backups.length !== allBackups.length) warnings.add('其他存档分支的备用状态未能确认版本，已跳过。');
        if (current.stcontextBackupsTrimmed) warnings.add(backupLimitWarning);
      });
      // readTurnData returns the nearest selected record at or below the cursor.
      // Skip gaps in one read, and attach extras only to their exact player floor.
      let cursor = last;
      while (validTurn(cursor)) {
        signal?.throwIfAborted();
        const entry = await tavern.readTurnData({ gameId, turn: cursor });
        if (!entry || !validTurn(entry.turn) || entry.turn > cursor) break;
        cursor = entry.turn - 1;
        await attachSelected(entry);
      }
      return [...warnings];
    },
    async stage(materials, compiled, sourceText, signal) {
      if (!available) return [];
      const inputSourceText = compiled.inputSourceText === materials.input.text ? undefined : compiled.inputSourceText;
      if (!compiled.scriptState && inputSourceText === undefined) return [];
      const { gameId } = materials;
      const inputs = [...new Set([hash(materials.input.text), hash(materials.input.raw)])];
      const body = JSON.stringify({ presetDigest: compiled.presetDigest, inputs, inputSourceText, scriptState: compiled.scriptState });
      if (Buffer.byteLength(body) > maxExpanded) return ['本轮楼层状态超过 8 MiB，还原范围将限于之前已保存的状态。'];
      const bodyHash = hash(sourceText.trim());
      const record = { format: 1, bodyHash, hostRegex: materials.outputProcessing?.hostRegex === true, payload: gzipSync(body).toString('base64') };
      const recordBytes = Buffer.byteLength(JSON.stringify(record));
      if (recordBytes > maxBackupBytes) return ['本轮楼层状态超过 2 MiB 备用容量，还原范围将限于之前已保存的状态。'];
      const prior = materials.history.findLast(row => row.role === 'assistant' && validTurn(row.turn))?.turn;
      await serialize(gameId, async () => {
        signal?.throwIfAborted();
        const parent = prior && await tavern.getTurn({ gameId, turn: prior });
        const before = materials.reason === 'normal' ? null : await tavern.getTurnState?.({ gameId });
        const current = await tavern.readGameData({ gameId });
        const afterTurn = prior ?? 0;
        const candidates = rows(current?.[key]).filter(item => validCandidate(item) && item.gameId === gameId && item.afterTurn < afterTurn);
        candidates.push({ gameId, afterTurn, inputs, bodyHash, record,
          replacedVersion: before?.turn > afterTurn ? before.textVersion : undefined,
          ...(parent && { parent: { turn: prior, textVersion: parent.textVersion } }) });
        signal?.throwIfAborted();
        await savePending(gameId, current, candidates);
      });
      return recordBytes > maxRecord ? ['本轮状态超过单轮 64 KiB，将在结算后写入本局版本化备用存储。'] : [];
    },
  };
}
