// ST's synchronous local-variable facade over the authoritative Helper chat store.
function createTavernLocalVariables({ context, request, copy, currentScript, reportError }) {
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const binding = () => JSON.stringify([context().chatId, context().lifecycleRevision || 0]);
  let owner = binding(), base = copy(context().chatVariables || {}), operations = [];
  const failures = new Map();
  const tasks = new Map();
  function apply(value, operation) {
    if (operation.remove) delete value[operation.key];
    else Object.defineProperty(value, operation.key, { value: copy(operation.value), enumerable: true, writable: true, configurable: true });
  }
  function project() {
    const value = copy(base);
    for (const operation of operations) apply(value, operation);
    context().chatVariables = value;
  }
  function sync() {
    if (owner !== binding()) { owner = binding(); operations = []; failures.clear(); }
    base = copy(context().chatVariables || {});
    project();
  }
  function mutate(key, value, remove = false) {
    if (typeof key !== 'string' || !key || key === '__proto__') throw new Error('聊天变量名称无效');
    if (owner !== binding()) sync();
    const operation = { key, ...(remove ? { remove: true } : { value: copy(value) }) };
    // Reject non-JSON values before changing the synchronous view.
    if (!remove && JSON.stringify(operation.value) === undefined) throw new Error('聊天变量必须是 JSON 值');
    const captured = owner, scriptId = currentScript().id;
    operations.push(operation); project();
    const task = request('updateTavernHelperVariables', { option: { type: 'chat', localMutation: operation } }).then(result => {
      if (result?.updated !== true || result?.stale) throw new Error('聊天已变化，变量未保存');
      if (owner === captured && binding() === captured) {
        if (!result.context && !result.contextDelta) apply(base, operation);
      }
    }).catch(error => {
      if (owner === captured && binding() === captured) failures.set(scriptId, error);
      reportError(error);
      throw error;
    }).finally(() => {
      tasks.delete(task);
      if (owner === captured && binding() === captured) { operations = operations.filter(item => item !== operation); project(); }
    });
    tasks.set(task, scriptId);
    task.catch(() => {}); // ST setters return synchronously; flush propagates persistence failures.
    return value;
  }
  function get(name, args = {}) {
    const values = context().chatVariables || {}, key = args.key ?? name;
    let value = own(values, key) ? copy(values[key]) : undefined;
    if (args.index !== undefined) {
      try { value = JSON.parse(value)[args.index]; if (typeof value === 'object') value = JSON.stringify(value); } catch (_) {}
    }
    return value?.trim?.() === '' || Number.isNaN(Number(value)) ? (value || '') : Number(value);
  }
  function set(name, value, args = {}) {
    if (args.index !== undefined || args.as !== undefined) throw new Error('variables.local.set 暂不支持 index/as；请读取并更新完整变量');
    return mutate(name, value);
  }
  function add(name, value) {
    const current = get(name) || 0;
    try { const array = JSON.parse(current); if (Array.isArray(array)) { array.push(value); set(name, JSON.stringify(array)); return array; } } catch (_) {}
    const next = Number.isNaN(Number(value)) || Number.isNaN(Number(current)) ? String(current || '') + value : Number(current) + Number(value);
    if (Number.isNaN(next)) return '';
    set(name, next); return next;
  }
  return {
    api: Object.freeze({ get, set, has: name => own(context().chatVariables || {}, name), del: name => { mutate(name, undefined, true); }, add, inc: name => add(name, 1), dec: name => add(name, -1) }),
    sync,
    async flush(scriptId) {
      await Promise.allSettled([...tasks].filter(([, id]) => scriptId === undefined || id === scriptId).map(([task]) => task));
      const failed = [...failures].find(([id]) => scriptId === undefined || id === scriptId);
      if (failed) { failures.delete(failed[0]); throw failed[1]; }
    }
  };
}
