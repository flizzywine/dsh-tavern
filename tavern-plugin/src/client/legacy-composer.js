// Legacy DOM IDs are adapters onto the shared frame lifetime and sender.
function installLegacyTavernComposer() {
  const existing = window.__dshTavernComposerRuntime;
  if (existing) { existing.refresh(); return existing.ready; }
  const lifetime = createTavernFrameLifecycle(window, document);
  let releaseSender = () => {}, controls, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  function report(prefix, error) {
    if (!document.body) return;
    const notice = document.createElement('div');
    notice.setAttribute('role', 'alert');
    notice.textContent = prefix + String(error && error.message || error);
    document.body.append(notice);
  }
  const mounted = lifetime.maintain(function () {
    if (document.getElementById('send_textarea') || document.getElementById('send_but')) { resolveReady(); return; }
    releaseSender();
    controls = document.createElement('div'); controls.hidden = true;
    const area = document.createElement('textarea'), button = document.createElement('button');
    area.id = 'send_textarea'; button.id = 'send_but'; button.type = 'button';
    controls.append(area, button); document.body.append(controls);
    const owner = controls;
    const sender = lifetime.sender({
      valid: () => owner.isConnected !== false,
      busy: value => { button.disabled = value; },
      submit: text => {
        if (typeof window.submitTavernInput === 'function') return window.submitTavernInput(text);
        if (typeof window.triggerSlash === 'function') return window.triggerSlash('/send ' + text + '|/trigger');
        throw new Error('当前对话发送入口尚未就绪');
      }
    });
    releaseSender = sender.dispose;
    function fillInput() {
      if (typeof window.submitTavernInput === 'function') return;
      Promise.resolve().then(() => {
        if (owner.isConnected === false) return;
        if (typeof window.triggerSlash !== 'function') throw new Error('当前对话输入框尚未就绪');
        return window.triggerSlash('/setinput ' + String(area.value || ''));
      }).catch(error => report('开场文字填入失败：', error));
    }
    area.addEventListener('input', fillInput);
    area.addEventListener('change', fillInput);
    button.addEventListener('click', function () {
      const text = String(area.value || '').trim();
      if (!text || button.disabled) return;
      sender.send(text).then(() => { if (area.value.trim() === text) area.value = ''; }, error => report('开局消息发送失败：', error));
    });
    resolveReady();
  }, rejectReady);
  window.__dshTavernComposerRuntime = { ready, refresh: mounted.refresh };
  window.addEventListener?.('pagehide', () => { lifetime.dispose(); delete window.__dshTavernComposerRuntime; }, { once: true });
  return ready;
}

// Preparation pages address the parent DOM. Own these controls only while that
// preview is mounted; they must never forward a submission to the current chat.
function installOpeningHostComposer(hostDocument, submit, report) {
  if (hostDocument.getElementById('send_textarea') || hostDocument.getElementById('send_but')) return function () {};
  const controls = hostDocument.createElement('div');
  controls.hidden = true;
  const area = hostDocument.createElement('textarea');
  area.id = 'send_textarea';
  const button = hostDocument.createElement('button');
  button.id = 'send_but'; button.type = 'button';
  controls.append(area, button);
  hostDocument.body.append(controls);
  const sender = createTavernFrameLifecycle(hostDocument.defaultView || {}, hostDocument).sender({
    once: true, submit, busy: value => { button.disabled = value; }
  });
  let active = true;
  button.addEventListener('click', function () {
    if (!active || button.disabled || !String(area.value || '').trim()) return;
    sender.send(area.value).then(() => { area.value = ''; }, report);
  });
  return function () { active = false; sender.dispose(); controls.remove(); };
}

// Parent DOM IDs are shared, but the focused iframe identifies the sender even
// after document.write replaces its document. Never fall back to the active chat.
const tavernHostComposers = new WeakMap();
function installFrameHostComposer(doc, ownsFrame, submit, report, fill, read) {
  let state = tavernHostComposers.get(doc);
  function resolveOwner(allowFallback) {
    const owners = Array.from(state.owners);
    if (!owners.length) throw new Error('卡片页面尚未就绪，请稍后再试');
    const focused = owners.filter(function (owner) { return owner.ownsFrame(doc.activeElement); });
    if (focused.length === 1) { state.lastOwner = focused[0]; return focused[0]; }
    if (state.lastOwner && state.owners.has(state.lastOwner)) return state.lastOwner;
    if (owners.length === 1) { state.lastOwner = owners[0]; return owners[0]; }
    if (allowFallback) {
      // Native regexes focus the offscreen textarea before the host observes the
      // iframe focus. Draft sync is conversation-wide, so any mounted owner can
      // read or fill it; sending still requires an unambiguous focused frame.
      state.lastOwner = owners[owners.length - 1];
      return state.lastOwner;
    }
    throw new Error('无法确定输入框所属的卡片，请重新点击卡片内的选项');
  }
  function sync() {
    if (!state.area) return;
    let owner;
    try { owner = resolveOwner(true); } catch (_) { return; }
    if (typeof owner.read !== 'function') return;
    try {
      const value = owner.read();
      if (typeof value === 'string' && state.area.value !== value) state.area.value = value;
    } catch (_) {}
  }
  function commit() {
    if (!state.area) return;
    let owner;
    try { owner = resolveOwner(true); } catch (error) { report(error); return; }
    if (typeof owner.fill !== 'function') return;
    try { Promise.resolve(owner.fill(String(state.area.value || ''))).catch(owner.report); }
    catch (error) { owner.report(error); }
  }
  if (!state) {
    if (doc.getElementById('send_textarea') || doc.getElementById('send_but')) return function () {};
    const controls = doc.createElement('div');
    // Native regexes call focus() before reading #send_textarea.value. A
    // hidden element cannot take focus, so park the controls offscreen
    // instead of using the hidden attribute.
    controls.setAttribute('aria-hidden', 'true');
    controls.setAttribute('style', 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;');
    const area = doc.createElement('textarea'), button = doc.createElement('button');
    // Card scripts focus() this field programmatically; on phones that would pop
    // the soft keyboard for an invisible box, so ask for no virtual keyboard.
    area.id = 'send_textarea'; area.tabIndex = -1; area.setAttribute('inputmode', 'none'); button.id = 'send_but'; button.type = 'button';
    controls.append(area, button); doc.body.append(controls);
    state = { controls, area, owners: new Set(), lastOwner: null };
    tavernHostComposers.set(doc, state);
    // Native tavern regexes focus #send_textarea, read its value, append their
    // option text and fire input. Mirror the live draft on focus so append mode
    // keeps whatever the player already typed; input writes it back.
    area.addEventListener('focus', sync);
    area.addEventListener('input', commit);
    area.addEventListener('change', commit);
    function noteFrameFocus(event) {
      for (const owner of state.owners) if (owner.ownsFrame(event.target)) state.lastOwner = owner;
    }
    doc.addEventListener('focusin', noteFrameFocus);
    // focusout fires on the iframe before focus reaches the offscreen textarea.
    doc.addEventListener('focusout', noteFrameFocus);
    state.cleanup = function () {
      doc.removeEventListener('focusin', noteFrameFocus);
      doc.removeEventListener('focusout', noteFrameFocus);
    };
    button.addEventListener('click', function () {
      let owner;
      try { owner = resolveOwner(); } catch (error) { report(error); return; }
      const text = String(area.value || '').trim();
      if (!text) return;
      owner.sender.send(text).then(function () { if (area.value === text) area.value = ''; }, owner.report);
    });
  }
  const owner = { ownsFrame, report, fill, read };
  owner.sender = createTavernFrameLifecycle(doc.defaultView || {}, doc).sender({ submit, valid: () => state.owners.has(owner) });
  state.owners.add(owner);
  return function () {
    owner.sender.dispose();
    state.owners.delete(owner);
    if (state.lastOwner === owner) state.lastOwner = null;
    if (!state.owners.size) {
      if (typeof state.cleanup === 'function') state.cleanup();
      state.controls.remove();
      tavernHostComposers.delete(doc);
    }
  };
}

// Chrome rejects compatibility proxies in WebIDL arguments ("parameter 1 is not
// of type 'Node'"), which used to abort whole card scripts when they observed a
// host node. Proxies publish their real node on this symbol; unwrap it, and turn
// any unusable target into the document root instead of throwing.
function installTavernNodeCompatibility(window) {
  const doc = window && window.document;
  if (!doc) return;
  const NODE = Symbol.for('dsh-tavern.hostNode');
  function unwrap(value) {
    if (!value || typeof value !== 'object') return null;
    const target = value[NODE];
    if (target && typeof target === 'object' && typeof target.nodeType === 'number') return target;
    if (typeof value.nodeType === 'number') return value;
    return null;
  }
  function readTargets(value) {
    if (Array.isArray(value)) return value.map(unwrap).filter(Boolean);
    if (value && typeof value.toArray === 'function') return Array.from(value.toArray() || []).map(unwrap).filter(Boolean);
    const single = unwrap(value);
    return single ? [single] : [];
  }
  for (const name of ['MutationObserver', 'IntersectionObserver', 'ResizeObserver']) {
    const Native = window[name];
    if (typeof Native !== 'function' || Native.__dshTavernNodeCompatible === true) continue;
    function CompatibleObserver(callback, ...rest) {
      const observer = new Native(callback, ...rest);
      const observe = observer.observe.bind(observer);
      observer.observe = function (target, options) {
        const targets = readTargets(target);
        if (!targets.length) return observe(doc.documentElement, options);
        for (const node of targets) observe(node, options);
      };
      return observer;
    }
    CompatibleObserver.prototype = Native.prototype;
    CompatibleObserver.__dshTavernNodeCompatible = true;
    window[name] = CompatibleObserver;
  }
}

// Give each module a view of the host DOM whose standard ST composer controls
// belong to that module's sandbox. Never install a shared, focus-routed sender.
function createTavernComposerWindow(frame, host = frame.parent) {
  const ids = new Set(['send_textarea', 'send_but']);
  const HOST_NODE = Symbol.for('dsh-tavern.hostNode');
  const documents = new WeakMap(), windows = new WeakMap();
  const roots = new WeakMap(), nativeRoots = new WeakMap();
  const unwrap = value => nativeRoots.get(value) || value;
  function rootView(root) {
    if (!root) return root;
    if (roots.has(root)) return roots.get(root);
    const mutations = new Set(['insertAdjacentHTML', 'append', 'prepend', 'appendChild', 'insertBefore', 'replaceChildren']);
    const proxy = new Proxy(root, {
      get(target, key) {
        // Observers and other WebIDL APIs need the node this proxy stands for.
        if (key === HOST_NODE) return target;
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        return function (...args) {
          const run = () => value.apply(target, args.map(unwrap));
          const artifacts = frame.frameElement?.__dshTavernHostArtifacts;
          return mutations.has(key) && artifacts ? artifacts.mutateRoot(target, run) : run();
        };
      },
      set(target, key, value) {
        const run = () => Reflect.set(target, key, value, target);
        const artifacts = frame.frameElement?.__dshTavernHostArtifacts;
        return key === 'innerHTML' && artifacts ? artifacts.mutateRoot(target, run) : run();
      }
    });
    roots.set(root, proxy); nativeRoots.set(proxy, root);
    return proxy;
  }
  // A card may also build its observer from the host window
  // (window.parent.MutationObserver, as 小手机v9 does) and hand it a host node.
  // That constructor lives in the host realm, so it never meets the sandbox
  // patch; wrap it here so the proxy is unwrapped on the way in too.
  const OBSERVERS = new Set(['MutationObserver', 'IntersectionObserver', 'ResizeObserver']);
  function compatibleObserver(Native, fallbackDocument) {
    if (typeof Native !== 'function' || Native.__dshTavernNodeCompatible === true) return Native;
    function CompatibleObserver(callback, ...rest) {
      const observer = new Native(callback, ...rest);
      const observe = observer.observe.bind(observer);
      observer.observe = function (target, options) {
        const nodes = (Array.isArray(target) ? target : [target]).map(unwrap)
          .filter(node => node && typeof node === 'object' && typeof node.nodeType === 'number');
        // An unusable target keeps the script alive: observe the document root
        // instead of letting the native call throw.
        if (!nodes.length) return observe(fallbackDocument && fallbackDocument.documentElement || host.document.documentElement, options);
        for (const node of nodes) observe(node, options);
      };
      return observer;
    }
    CompatibleObserver.prototype = Native.prototype;
    CompatibleObserver.__dshTavernNodeCompatible = true;
    return CompatibleObserver;
  }
  const jq = frame.jQuery;
  const anchors = new Map();
  let observedViewport = null;
  function notifyLayout() {
    const rect = observedViewport?.getBoundingClientRect();
    if (!rect) return;
    // Legacy scripts observe their layout anchor's style/class changes.
    for (const node of anchors.values()) {
      const value = `--dsh-layout:${rect.left},${rect.top},${rect.width},${rect.height}`;
      if (node.getAttribute('style') !== value) node.setAttribute('style', value);
    }
  }
  const layoutObserver = host?.ResizeObserver ? new host.ResizeObserver(notifyLayout) : null;
  let layoutFrame = null;
  function onLayoutScroll() {
    if (layoutFrame !== null) return;
    layoutFrame = host.requestAnimationFrame(function () { layoutFrame = null; notifyLayout(); });
  }
  if (layoutObserver) {
    host.addEventListener('scroll', onLayoutScroll, true);
    frame.addEventListener?.('pagehide', function () {
      layoutObserver.disconnect();
      host.removeEventListener('scroll', onLayoutScroll, true);
      if (layoutFrame !== null) host.cancelAnimationFrame(layoutFrame);
    }, {once:true});
  }
  function layoutAnchor(id) {
    if (!['sheld', 'top-settings-holder'].includes(id)) return null;
    const doc = host.document;
    function viewport() {
      let node = doc.querySelector('.dsh-tavern-assistant');
      for (; node && node !== doc.body; node = node.parentElement) {
        const style = host.getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY) && node.getBoundingClientRect().height > 0) {
          if (layoutObserver && observedViewport !== node) {
            layoutObserver.disconnect(); observedViewport = node; layoutObserver.observe(node);
          }
          return node;
        }
      }
      return null;
    }
    if (!viewport()) return null;
    if (!anchors.has(id)) {
      const node = doc.createElement('div');
      node.id = id;
      node.getBoundingClientRect = function () {
        const rect = viewport()?.getBoundingClientRect();
        if (!rect) return new host.DOMRect();
        return id === 'sheld' ? rect : new host.DOMRect(rect.left, 0, rect.width, rect.top);
      };
      anchors.set(id, node);
    }
    return anchors.get(id);
  }
  // A card panel mounts inside its own message frame, so an ID the card looks up
  // from the host document only exists there. Stay inside this session: frames
  // of other sessions, and frames silenced by display filtering, are invisible.
  function messageFrameDocuments() {
    const sessionId = frame.frameElement?.__dshTavernSessionId || '';
    const hostDocument = host && host.document;
    if (!sessionId || !hostDocument?.querySelectorAll) return [];
    const found = [];
    for (const node of hostDocument.querySelectorAll('iframe.dsh-tavern-message-frame')) {
      if (node.__dshTavernSessionId !== sessionId || node.getAttribute('aria-hidden') === 'true') continue;
      let content = null;
      try { content = node.contentDocument; } catch (_) { content = null; }
      if (content) found.push(content);
    }
    return found;
  }
  function frameQuery(selector) {
    const nodes = [];
    for (const frameDocument of messageFrameDocuments()) {
      // An invalid selector stays a host-only miss instead of breaking the page.
      try { nodes.push(...frameDocument.querySelectorAll(selector)); } catch (_) { /* ignore */ }
    }
    return nodes;
  }
  const frameIdQuery = id => '#' + String(id).replace(/([^\w-])/g, '\\$1');
  function lookup(doc, id) {
    if (ids.has(id)) return frame.document.getElementById(id);
    const artifacts = frame.frameElement?.__dshTavernHostArtifacts;
    const found = artifacts ? artifacts.findElementById(id) : doc.getElementById(id);
    if (found) return found;
    const [inFrame] = frameQuery(frameIdQuery(id));
    return inFrame || layoutAnchor(id);
  }

  function documentView(doc) {
    if (documents.has(doc)) return documents.get(doc);
    const proxy = new Proxy({}, { get(_, key) {
      if (key === 'body' || key === 'head') return rootView(doc[key]);
      if (key === 'createElement' || key === 'createElementNS') return function (...args) {
        const node = doc[key](...args);
        frame.frameElement?.__dshTavernHostArtifacts?.trackNode(node);
        return node;
      };
      if (key === 'getElementById') return id => lookup(doc, id);
      if (key === 'querySelector' || key === 'querySelectorAll') return selector => {
        if (/^#(?:sheld|top-settings-holder)$/.test(selector) && !doc.querySelector(selector)) {
          const anchor = layoutAnchor(selector.slice(1));
          return key === 'querySelector' ? anchor : [anchor].filter(Boolean);
        }
        if (/^#(?:send_textarea|send_but)$/.test(selector)) return frame.document[key](selector);
        // The host document owns the page; message frames are only a fallback.
        const hostNodes = Array.from(doc.querySelectorAll(selector));
        if (hostNodes.length) return key === 'querySelector' ? hostNodes[0] : hostNodes;
        const frameNodes = frameQuery(selector);
        return key === 'querySelector' ? (frameNodes[0] || null) : frameNodes;
      };
      if (key === 'defaultView') return windowView(doc.defaultView);
      const value = doc[key];
      return typeof value === 'function' ? (...args) => value.apply(doc, args.map(unwrap)) : value;
    }, set(_, key, value) { doc[key] = value; return true; } });
    documents.set(doc, proxy);
    return proxy;
  }
  function jquery(selector, context) {
    if (typeof selector === 'string' && /^#(?:send_textarea|send_but)$/.test(selector)) return jq(frame.document.querySelector(selector));
    if (typeof selector === 'string' && /^#(?:sheld|top-settings-holder)$/.test(selector) && !host.document.querySelector(selector)) return jq(layoutAnchor(selector.slice(1)));
    if (context === documentView(host.document)) context = host.document;
    if (selector === documentView(host.document)) {
      const result = jq(host.document);
      const find = result.find;
      result.find = function (selector) {
        return /^#(?:send_textarea|send_but)$/.test(selector) ? jq(frame.document.querySelector(selector)) : find.call(this, selector);
      };
      return result;
    }
    return jq(unwrap(selector), unwrap(context));
  }
  function windowView(target) {
    if (windows.has(target)) return windows.get(target);
    const proxy = new Proxy({}, { get(_, key) {
      if (key === 'window' || key === 'self' || key === 'globalThis') return proxy;
      if (key === 'parent' || key === 'top') return windowView(host);
      if (key === 'document') return target === frame ? frame.document : documentView(target.document);
      if ((key === '$' || key === 'jQuery') && jq) return new Proxy(jq, {apply(_, receiver, args) { return jquery(...args); }});
      if (OBSERVERS.has(key)) return compatibleObserver(target[key], target.document);
      const value = target[key];
      return typeof value === 'function' && !value.prototype ? (...args) => value.apply(target, args.map(unwrap)) : value;
    }, set(_, key, value) { target[key] = value; return true; } });
    windows.set(target, proxy);
    return proxy;
  }
  return windowView(frame);
}
