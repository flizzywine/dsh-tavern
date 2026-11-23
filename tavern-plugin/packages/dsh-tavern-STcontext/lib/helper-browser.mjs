// Serialized into QuickJS; these inert objects cannot access the host DOM or network.
export function installHelperBrowser({ isBundled, bootstrapIds, ready, eventOn, eventRemoveListener, deny }) {
  const win = globalThis;
  if (isBundled) {
    const elements = new Map();
    const makeEl = (tag = 'div') => {
      const el = new Proxy({
        tagName: String(tag).toUpperCase(),
        id: '',
        style: {
          setProperty(key, value) { this[String(key)] = String(value); },
          getPropertyValue(key) { return typeof this[key] === 'string' ? this[key] : ''; },
          removeProperty(key) { const previous = this.getPropertyValue(key); delete this[key]; return previous; },
        },
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        children: [],
        childNodes: [],
        innerHTML: '',
        textContent: '',
        src: '',
        value: '',
        checked: false,
        appendChild(c) {
          if (c && c.id) elements.set(String(c.id), c);
          if (c && c.tagName === 'SCRIPT') {
            if (typeof c.src === 'string' && c.src) return deny('DOM / 远程脚本加载');
            if (typeof c.onerror === 'function') {
              Promise.resolve().then(() => c.onerror(new Error('inert')));
            }
          }
          return c;
        },
        append(...children) { for (const child of children) this.appendChild(child); },
        removeChild(c) { return c; },
        insertBefore(c) { return this.appendChild(c); },
        remove() { if (this.id) elements.delete(String(this.id)); },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] ?? null; },
        removeAttribute(k) { delete this[k]; },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        attachShadow() { return makeEl('shadow-root'); },
        closest() { return null; },
        getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 100 }; },
        cloneNode() { return makeEl(tag); },
        focus() {},
        blur() {},
        click() {},
      }, {
        get(t, k) { return k === 'then' ? undefined : k in t ? t[k] : () => {}; },
        set(t, k, v) {
          t[k] = v;
          if (k === 'id' && v) elements.set(String(v), el);
          return true;
        },
      });
      return el;
    };
    const document = {
      readyState: 'complete',
      body: makeEl('body'),
      head: makeEl('head'),
      documentElement: makeEl('html'),
      getElementById: id => bootstrapIds.includes(String(id)) ? { id } : (elements.get(String(id)) || null),
      createElement: tag => makeEl(tag),
      createElementNS: (_ns, tag) => makeEl(tag),
      createTextNode: txt => ({ textContent: String(txt ?? '') }),
      createDocumentFragment: () => makeEl('fragment'),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (name, fn) => { if (name === 'DOMContentLoaded' && typeof fn === 'function') ready.push(fn); },
      removeEventListener: () => {},
    };
    win.document = document;
    win.frameElement = { parentElement: document.body };
    win.addEventListener = (name, fn) => { if (name === 'pagehide' && typeof fn === 'function') eventOn('pagehide', fn); };
    win.removeEventListener = (name, fn) => { if (name === 'pagehide') eventRemoveListener('pagehide', fn); };
    win.dispatchEvent = () => true;
    win.setTimeout = () => 1;
    win.clearTimeout = () => {};
    win.setInterval = () => 1;
    win.clearInterval = () => {};
    win.requestAnimationFrame = () => 1;
    win.cancelAnimationFrame = () => {};
    win.MutationObserver = class { observe() {} disconnect() {} };
    win.ResizeObserver = class { observe() {} disconnect() {} };
    win.IntersectionObserver = class { observe() {} disconnect() {} };
    win.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
    win.Event = class { constructor(t) { this.type = t; } };
    win.HTMLElement = class {};
    win.Node = class {};
    win.Image = class { set src(_) {} };
    win.AbortController = class { constructor() { this.signal = { aborted: false, addEventListener() {}, removeEventListener() {} }; } abort() { this.signal.aborted = true; } };
    // URL inspection inside a hook does not grant network access. The only
    // actual transport remains baseFetch's single virtual generation route.
    win.URL = class {
      constructor(value, base = 'http://localhost/') {
        const parts = /^(https?):\/\/([^/?#]+)([^?#]*)/i;
        const parent = parts.exec(String(base)), url = String(value);
        if (!parent) throw new TypeError('无效 URL 基址');
        const absolute = /^[a-z][a-z\d+.-]*:/i.test(url) ? url : url.startsWith('//') ? parent[1] + ':' + url :
          parent[1] + '://' + parent[2] + (url.startsWith('/') ? url : (parent[3] || '/').replace(/[^/]*$/, '') + url);
        const path = parts.exec(absolute);
        if (!path) throw new TypeError('仅支持 HTTP URL');
        this.origin = path[1].toLowerCase() + '://' + path[2].toLowerCase();
        this.pathname = path[3] || '/';
        this.href = absolute;
      }
      static createObjectURL() { return 'blob:inert'; }
      static revokeObjectURL() {}
    };
    win.Blob = class { constructor(p) { this.parts = p; } };
    win.FileReader = class { readAsDataURL() {} readAsText() {} };
    win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    win.getComputedStyle = () => new Proxy({}, { get: () => '' });
    win.navigator = { userAgent: 'Mozilla/5.0', clipboard: { writeText: async () => {} } };
    win.location = { href: 'http://localhost/', origin: 'http://localhost' };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.DOMPurify = { sanitize: s => String(s ?? '') };
    const jq = value => {
      if (typeof value === 'function') { ready.push(value); return; }
      const chain = new Proxy({
        length: 0,
        ready(fn) { if (value === document && typeof fn === 'function') ready.push(fn); return chain; },
        on(event, fn) { if (value === win) win.addEventListener(event, fn); return chain; },
        off(event, fn) { if (value === win) win.removeEventListener(event, fn); return chain; },
        val() { return ''; },
      }, { get(t, k) { return k === 'then' ? undefined : k in t ? t[k] : () => chain; } });
      return chain;
    };
    jq.fn = {};
    win.$ = jq;
    win.jQuery = jq;
  } else {
    win.addEventListener = (name, fn) => {
      if (name !== 'pagehide') return deny('窗口事件 ' + name);
      eventOn('pagehide', fn);
    };
    win.removeEventListener = eventRemoveListener;
    // Only an explicitly identified, built-in SPreset bootstrap can be represented
    // as an already-loaded script. Arbitrary DOM injection is rejected.
    const document = { readyState: 'complete', body: { tagName: 'BODY' },
      getElementById: id => bootstrapIds.includes(String(id)) ? { id } : null,
      createElement: () => deny('DOM / 远程脚本加载'),
      addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') ready.push(fn); else deny('文档事件 ' + name); },
    };
    win.document = document; win.frameElement = { parentElement: document.body };
    const dollar = value => {
      if (typeof value === 'function') { ready.push(value); return; }
      if (value === document) {
        const chain = { ready(fn) { if (typeof fn === 'function') ready.push(fn); return chain; } };
        return chain;
      }
      if (value === win) return { on: (event, fn) => win.addEventListener(event, fn), off: win.removeEventListener };
      return deny('jQuery DOM');
    };
    win.$ = dollar;
  }
}
