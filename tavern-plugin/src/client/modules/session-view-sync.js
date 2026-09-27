// Cached session views are immutable, like the React views returned by getSession.
function createSessionViewReader(maxSessions = 4) {
  const sessions = new Map();
  const index = createSessionViewReader.indexApi ||= createIndexedArrayApi();
  const receiptLookup = createSessionViewReader.receiptLookup ||= createTurnLookup(index,createSessionViewReader.onReceiptLookupVisit);
  const ordered = typeof createOrderedNumericIndex === "function" ? (createSessionViewReader.receiptOrderedIndex ||= createOrderedNumericIndex()) : null;
  const turnFields = ordered ? (createSessionViewReader.turnFields ||= createTurnFieldIndex()) : null;
  const projectionLookup = createSessionViewReader.projectionLookup ||= createTurnLookup(index);
  const storyTurnLookup = createSessionViewReader.storyTurnLookup ||= createStoryTurnLookup();
  let sequence = 0;
  return function begin(sessionId) {
    const base = sessions.get(sessionId);
    const requestSequence = ++sequence;
    return {
      cursor: base && base.cursor,
      receiptSync: ordered ? 1 : undefined,
      accept(result) {
        let view = result.view, projectionChanges = null, storyChanges = null, storyKeys = null;
        if (result.viewDelta) {
          if (!base || result.viewDelta.baseCursor !== base.cursor) throw new Error("会话增量已过期，请重新读取");
          const delta = result.viewDelta;
          const unchanged = delta.set.length===0 && delta.remove.length===0
            && (!delta.receiptDelta || delta.receiptDelta.set.length===0 && delta.receiptDelta.remove.length===0);
          if (unchanged) view = base.view;
          else {
            view = Object.assign({}, base.view);
            const copied = new Set();
            const messagePath = path => path[0] === "tavernHelper" && path[1] === "messages" && path.length === 3;
            const messageEdits = result.viewDelta.set.filter(([path]) => messagePath(path));
            const messageRemovals = result.viewDelta.remove.filter(messagePath);
            const incrementalMessages = Array.isArray(base.view?.tavernHelper?.messages)
              && !result.viewDelta.set.some(([path]) => path[0] === "tavernHelper" && path.length < 3)
              && !result.viewDelta.remove.some(path => path[0] === "tavernHelper" && path.length < 3)
              && messageRemovals.every(path => typeof path[2] === "number")
              && messageEdits.every(([path]) => path[2] === "length" || Number.isSafeInteger(path[2]));

            const receiptPath = path => path[0] === "mvuReceipts" && path.length === 2;
            const receiptEdits = result.viewDelta.set.filter(([path]) => receiptPath(path));
            const receiptRemovals = result.viewDelta.remove.filter(receiptPath);
            const incrementalReceipts = !result.viewDelta.receiptDelta && !ordered?.info(base.view?.mvuReceipts) && Array.isArray(base.view?.mvuReceipts)
              && !result.viewDelta.set.some(([path]) => path[0] === "mvuReceipts" && path.length < 2)
              && !result.viewDelta.remove.some(path => path[0] === "mvuReceipts" && path.length < 2)
              && receiptRemovals.every(path => Number.isSafeInteger(path[1]))
              && receiptEdits.every(([path]) => path[1] === "length" || Number.isSafeInteger(path[1]));

            const projectionPath = path => path[0] === "replyProjections" && path.length === 2;
            const projectionEdits = result.viewDelta.set.filter(([path]) => projectionPath(path));
            const projectionRemovals = result.viewDelta.remove.filter(projectionPath);
            const incrementalProjections = Array.isArray(base.view?.replyProjections)
              && !result.viewDelta.set.some(([path]) => path[0] === "replyProjections" && path.length < 2)
              && !result.viewDelta.remove.some(path => path[0] === "replyProjections" && path.length < 2)
              && projectionRemovals.every(path => Number.isSafeInteger(path[1]))
              && projectionEdits.every(([path]) => path[1] === "length" || Number.isSafeInteger(path[1]));

            const fieldUpdates = new Map();
            for (const field of ["inputSources", "inputTemplateDisplays", "regeneratedDshTurns"]) {
              const source = base.view?.[field];
              const sets = delta.set.filter(([path]) => path[0] === field);
              const removes = delta.remove.filter(path => path[0] === field);
              if (turnFields?.has(source) && sets.every(([path]) => path.length === 2 && turnFields.validKey(path[1]))
                && removes.every(path => path.length === 2 && turnFields.validKey(path[1]))) {
                fieldUpdates.set(field, turnFields.update(source, sets.map(([path,value]) => [path[1],value]), removes.map(path => path[1])));
                if (field === "regeneratedDshTurns") storyKeys = [...new Set([...sets.map(([path]) => String(path[1])), ...removes.map(path => String(path[1]))])];
              }
            }
            function parent(path) {
              let target = view;
              for (let i = 0; i < path.length - 1; i++) {
                const key = path[i];
                const id = JSON.stringify(path.slice(0, i + 1));
                if (!copied.has(id)) {
                  const old = target[key];
                  target[key] = Array.isArray(old) ? old.slice() : (path[i + 1] === "length" || typeof path[i + 1] === "number" ? [] : Object.assign({}, old));
                  copied.add(id);
                }
                target = target[key];
              }
              return target;
            }
            // Remove old descendants before replacing a parent with null or a new object.
            for (const path of result.viewDelta.remove.slice().sort((a, b) => b.length - a.length)) {
              if (fieldUpdates.has(path[0])) continue;
              if (incrementalMessages && messagePath(path) || incrementalReceipts && receiptPath(path) || incrementalProjections && projectionPath(path)) continue;
              const target = parent(path), key = path[path.length - 1];
              if (!(Array.isArray(target) && key === "length")) delete target[key];
            }
            for (const [path, value] of result.viewDelta.set) {
              if (fieldUpdates.has(path[0])) continue;
              if (incrementalMessages && messagePath(path) || incrementalReceipts && receiptPath(path) || incrementalProjections && projectionPath(path)) continue;
              parent(path)[path[path.length - 1]] = value;
            }
            for (const [field, value] of fieldUpdates) view[field] = value;
            if (result.viewDelta.receiptDelta) {
              if (!ordered?.info(base.view?.mvuReceipts)) throw new Error("回执增量缺少基线，请重新读取");
              const delta = result.viewDelta.receiptDelta;
              view.mvuReceipts = ordered.update(base.view.mvuReceipts,[...delta.remove.map(turn=>[turn,undefined]),...delta.set.map(row=>[row.turn,row])]);
            }
            if (incrementalReceipts) {
              const old = base.view.mvuReceipts;
              const length = receiptEdits.find(([path]) => path[1] === "length")?.[1] ?? old.length;
              const entries = receiptEdits.filter(([path]) => path[1] !== "length").map(([path,value]) => [path[1],value]);
              if (receiptRemovals.some(path => path[1] < length)) throw new Error("Invalid sparse receipt delta");
              view.mvuReceipts = index.update(old,entries,length);
              receiptLookup.remember(view.mvuReceipts,old,entries);
            }
            if (incrementalProjections) {
              const old = base.view.replyProjections;
              const length = projectionEdits.find(([path]) => path[1] === "length")?.[1] ?? old.length;
              const entries = projectionEdits.filter(([path]) => path[1] !== "length").map(([path,value]) => [path[1],value]);
              if (projectionRemovals.some(path => path[1] < length)) throw new Error("Invalid sparse projection delta");
              view.replyProjections = entries.length || length!==old.length ? index.update(old,entries,length) : old;
              projectionLookup.remember(view.replyProjections,old,entries);
              const turns = new Set();
              for (const [id, row] of entries) { turns.add(Number(old[id]?.turn)); turns.add(Number(row?.turn)); }
              for (let id = length; id < old.length; id++) turns.add(Number(old[id]?.turn));
              projectionChanges = { turns: [...turns].filter(turn => !Number.isNaN(turn)),
                beforeLatest: projectionLookup.max(old), afterLatest: projectionLookup.max(view.replyProjections) };
            }
            if (incrementalMessages) {
              const old = base.view.tavernHelper.messages;
              const length = messageEdits.find(([path]) => path[2] === "length")?.[1] ?? old.length;
              const entries = messageEdits.filter(([path]) => path[2] !== "length").map(([path,value]) => [path[2],value]);
              // The protocol emits removals only for a truncated tail.
              if (messageRemovals.some(path => path[2] < length)) throw new Error("Invalid sparse message delta");
              view.tavernHelper = {...view.tavernHelper,messages:index.update(old,entries,length)};
            }
          }
        }
        if (Array.isArray(view?.tavernHelper?.messages) && !index.info(view.tavernHelper.messages)) {
          view = {...view,tavernHelper:{...view.tavernHelper,messages:index.from(view.tavernHelper.messages)}};
        }
        if (Array.isArray(view?.mvuReceipts)) {
          if (result.receiptSync===1) {
            if (!ordered) throw new Error("当前客户端不支持回执索引");
            view = {...view,mvuReceipts:ordered.from(view.mvuReceipts.map(row=>[row.turn,row]))};
          } else if (!ordered?.info(view.mvuReceipts)) {
            if (!index.info(view.mvuReceipts)) view = {...view,mvuReceipts:index.from(view.mvuReceipts)};
            receiptLookup.remember(view.mvuReceipts);
          }
        }
        if (Array.isArray(view?.replyProjections)) {
          if (!index.info(view.replyProjections)) view = {...view,replyProjections:index.from(view.replyProjections)};
          projectionLookup.remember(view.replyProjections);
        }
        if (turnFields) for (const field of ["inputSources", "inputTemplateDisplays", "regeneratedDshTurns"]) {
          const value = turnFields.from(view?.[field]);
          if (value !== view?.[field]) view = {...view, [field]: value};
        }
        storyChanges = storyTurnLookup.remember(view?.regeneratedDshTurns, base?.view?.regeneratedDshTurns, storyKeys);
        const latest = sessions.get(sessionId);
        if (!latest || latest.sequence < requestSequence) {
          sessions.delete(sessionId);
          sessions.set(sessionId, { view, cursor: result.viewCursor, sequence: requestSequence });
          while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
        }
        return Object.assign({}, result, { view, viewBase: result.viewDelta ? base.view : undefined, projectionChanges, storyChanges });
      }
    };
  };
}

// Weak array-version keys preserve concurrent/older views without retaining them.
function createTurnLookup(index,onVisit = () => {}) {
  const versions = new WeakMap();
  // Number-to-string has bounded length for IEEE-754 turns, including infinities.
  // A character trie avoids history-sized Map copies while retaining old roots.
  const turnKey = value => { const turn=Number(value); return Number.isNaN(turn) ? null : String(turn); };
  function get(root,key) {
    let node=root;
    for (const character of key) { onVisit(); node=node?.[character]; }
    return node?.$;
  }
  function put(root,key,value,offset=0) {
    onVisit();
    const next={...root}, character=offset===key.length ? "$" : key[offset];
    const child=offset===key.length ? value : put(root?.[character],key,value,offset+1);
    if (child===undefined) delete next[character]; else next[character]=child;
    let maximum=0,children=0;
    for (const name of Object.keys(next)) if (name!=="_max") {
      children++; maximum=Math.max(maximum,name==="$" ? Number(next[name].turn)||0 : next[name]._max||0);
    }
    if (!children) return undefined;
    next._max=maximum;
    return next;
  }
  function change(root,key,id,row) {
    if (key===null) return root;
    const old=get(root,key);
    let next;
    if (old?.rows) {
      const rows=index.update(old.rows,[[id,row]],Math.max(old.rows.length,id+1));
      const count=index.info(rows).eligible;
      if (count>1) next={rows};
      else if (count===1) { const last=index.previous(rows,rows.length); next={id:last,row:rows[last]}; }
    } else if (row!==undefined) {
      next=old && old.id!==id
        ? {rows:index.update([],[[old.id,old.row],[id,row]],Math.max(old.id,id)+1)} : {id,row};
    } else if (old?.id!==id) next=old;
    return put(root,key,next ? {...next,turn:Number(key)} : undefined);
  }
  function remember(rows,before,entries) {
    if (versions.has(rows)) return;
    let root;
    if (before && versions.has(before)) {
      root=versions.get(before);
      const changed=new Map(entries);
      // Clear all old owners first, so swaps and duplicate-turn promotion work.
      for (const [id] of changed) if (id<before.length) root=change(root,turnKey(before[id]?.turn),id,undefined);
      for (let id=rows.length;id<before.length;id++) if (!changed.has(id)) root=change(root,turnKey(before[id]?.turn),id,undefined);
      for (const [id,row] of changed) if (id<rows.length) root=change(root,turnKey(row?.turn),id,row);
    } else {
      for (let id=0;id<rows.length;id++) { const row=rows[id]; root=change(root,turnKey(row?.turn),id,row); }
    }
    versions.set(rows,root);
  }
  function row(rows,turn) {
    const key=turnKey(turn);
    if (key===null) return null;
    const bucket=get(versions.get(rows),key);
    const row=bucket?.rows ? bucket.rows[index.previous(bucket.rows,bucket.rows.length)] : bucket?.row;
    return row || null;
  }
  return {remember,row,read:(rows,turn)=>row(rows,turn)?.receipt || null,max:rows=>versions.get(rows)?._max || 0,has:rows=>versions.has(rows)};
}

function createStoryTurnLookup() {
  const versions = new WeakMap();
  const ordered = typeof createOrderedNumericIndex === "function" ? createOrderedNumericIndex({visit: () => createSessionViewReader.onStoryLookupVisit?.()}) : null;
  const validKey = key => /^(0|[1-9]\d*)$/.test(key) && Number(key) < 0xffffffff;
  function remember(source, before, keys) {
    if (!source || typeof source !== "object") return null;
    if (versions.has(source)) return source === before ? [] : null;
    const previous = versions.get(before);
    if (ordered && previous?.root && Array.isArray(keys) && keys.every(validKey)) {
      let root = previous.root;
      const hosts = new Set();
      function change(host, story, remove) {
        if (Number.isNaN(host)) return;
        hosts.add(host);
        let rows = ordered.get(root, host) || ordered.from([]);
        rows = ordered.update(rows, [[Number(story), remove ? undefined : Number(story)]]);
        root = ordered.update(root, [[host, rows.length ? rows : undefined]]);
      }
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(before, key)) change(Number(before[key]), key, true);
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(source, key)) change(Number(source[key]), key, false);
      versions.set(source, { root });
      return [...hosts];
    }
    const names = Object.keys(source);
    if (ordered && names.every(validKey)) {
      const hosts = new Map();
      for (const story of names) {
        const host = Number(source[story]);
        if (Number.isNaN(host)) continue;
        if (!hosts.has(host)) hosts.set(host, []);
        hosts.get(host).push([Number(story), Number(story)]);
      }
      versions.set(source, { root: ordered.from([...hosts].map(([host, rows]) => [host, ordered.from(rows)])) });
    } else {
      const turns = new Map();
      for (const story of names) {
        const turn = Number(source[story]);
        if (!Number.isNaN(turn) && !turns.has(turn)) turns.set(turn, Number(story));
      }
      versions.set(source, { turns });
    }
    return null;
  }
  return { remember, has: source => versions.has(source), read(source, turn) {
    const key = Number(turn), version = versions.get(source);
    if (version?.root && !Number.isNaN(key)) return ordered.get(version.root, key)?.[0] ?? key;
    return version?.turns?.has(key) ? version.turns.get(key) : key;
  } };
}

// Canonical array-index keys retain ordinary object enumeration order. Legacy
// non-turn keys use the original object path instead of changing its semantics.
function createTurnFieldIndex() {
  const index = createOrderedNumericIndex({visit: () => createSessionViewReader.onTurnFieldVisit?.()});
  const states = new WeakMap();
  const validKey = key => /^(0|[1-9]\d*)$/.test(String(key)) && Number(key) < 0xffffffff;
  function wrap(rows) {
    const target = {};
    const lookup = key => validKey(key) ? index.get(rows, Number(key)) : undefined;
    const value = new Proxy(target, {
      get: (object,key,receiver) => { const row = lookup(key); return row ? row.value : Reflect.get(object,key,receiver); },
      has: (object,key) => Boolean(lookup(key)) || Reflect.has(object,key),
      ownKeys: () => rows.map(row => row.key),
      getOwnPropertyDescriptor: (object,key) => {
        const row = lookup(key);
        return row ? {value:row.value,enumerable:true,configurable:true,writable:false} : Reflect.getOwnPropertyDescriptor(object,key);
      },
      set() { throw new Error("Turn fields are immutable"); },
      defineProperty() { throw new Error("Turn fields are immutable"); },
      deleteProperty() { throw new Error("Turn fields are immutable"); }
    });
    states.set(value,rows);return value;
  }
  function from(source) {
    if (!source || typeof source !== "object" || Array.isArray(source) || states.has(source)) return source;
    const keys = Reflect.ownKeys(source);
    if (!keys.every(key => typeof key === "string" && validKey(key))) return source;
    return wrap(index.from(keys.map(key => [Number(key),{key,value:source[key]}])));
  }
  function update(source,sets,removes) {
    if (!sets.length && !removes.length) return source;
    const entries = removes.map(key => [Number(key),undefined]);
    for (const [key,value] of sets) entries.push([Number(key),{key:String(key),value}]);
    return wrap(index.update(states.get(source),entries));
  }
  return {from,update,validKey,has:source => states.has(source)};
}
