window.__ModuleLoader__.load({
  id: 'dsh-tavern-STcontext',
  factory: require => {
    const React = require('react'), h = React.createElement;
    return {
      name: 'dsh-tavern-STcontext',
      inject: ['tavernUi', 'slots'],
      apply(ctx) {
        const ui = ctx.tavernUi, call = (name, args = {}) => ui.callHost('dsh-tavern-stcontext/' + name, args);
        const editableSettings = value => ({ model: value?.model || null, personaDescription: value?.personaDescription || '' });
        const formatBytes = bytes => {
          const unit = bytes >= 1024 * 1024 ? 1024 * 1024 : 1024;
          return Number((bytes / unit).toFixed(2)) + (unit === 1024 ? ' KiB' : ' MiB');
        };
        const drafts = new Map();
        const clone = value => JSON.parse(JSON.stringify(value));
        const markerIds = new Set(['worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'dialogueExamples', 'chatHistory']);
        const orderOf = doc => doc.prompt_order.find(group => Number(group.character_id) === 100001) || (doc.prompt_order.length === 1 ? doc.prompt_order[0] : null);
        function helperRows(items, path = [], parents = [], disabled = false) {
          if (!Array.isArray(items)) return [];
          return items.flatMap((item, index) => {
            if (!item || typeof item !== 'object') return [];
            const folder = item.type === 'folder' && Array.isArray(item.scripts);
            const name = String(item.name || item.id || (folder ? '文件夹 ' : '脚本 ') + (index + 1));
            const entryPath = [...path, index], names = [...parents, name];
            const children = folder ? helperRows(item.scripts, [...entryPath, 'scripts'], names, disabled || item.enabled === false) : [];
            const bytes = folder ? children.filter(row => !row.folder).reduce((sum, row) => sum + row.bytes, 0)
              : new TextEncoder().encode(String(item.content || '')).byteLength;
            return [{ path: entryPath, name: names.join(' / '), folder, disabled, bytes,
              enabled: folder ? item.enabled !== false : item.enabled === true }, ...children];
          });
        }
        function editorDocument(text) {
          const doc = JSON.parse(text);
          if (!doc || !Array.isArray(doc.prompts) || !doc.prompts.length || !Array.isArray(doc.prompt_order) || doc.prompt_order.some(group => !group || !Array.isArray(group.order))
            || !Array.isArray(orderOf(doc)?.order) || doc.prompts.some(item => !item || typeof item.identifier !== 'string')
            || orderOf(doc).order.some(item => !item || !doc.prompts.some(prompt => prompt.identifier === item.identifier))) throw new Error('JSON 缺少有效的 prompts 或当前 prompt_order');
          if (doc.prompts.some(item => item.injection_trigger !== undefined && (!Array.isArray(item.injection_trigger) || item.injection_trigger.some(value => typeof value !== 'string')))) throw new Error('injection_trigger 必须是字符串数组');
          if (doc.extensions !== undefined && (!doc.extensions || typeof doc.extensions !== 'object' || Array.isArray(doc.extensions))) throw new Error('extensions 必须是对象');
          const rules = doc.extensions?.regex_scripts;
          if (rules !== undefined && (!Array.isArray(rules) || rules.some(rule => !rule || typeof rule !== 'object' ||
            (rule.disabled !== true && rule.enabled !== false && rule.placement !== undefined && !Array.isArray(rule.placement))))) throw new Error('regex_scripts 格式无效');
          return doc;
        }
        function editorSnapshot(text) {
          try { return { document: editorDocument(text), tab: 'prompts', error: '' }; }
          catch (err) { return { document: null, tab: 'json', error: '请在完整 JSON 中修复后切换表单：' + err.message }; }
        }
        const css = `
.stc-scroll{box-sizing:border-box;flex:1 1 auto;width:100%;height:100%;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain}
.stc-panel{--stc-surface:var(--dsw-specific-input-major,#fff);--stc-border:var(--dsw-alias-border-l2,#e3e4eb);--stc-muted:var(--dsw-alias-label-secondary,#717583);--stc-accent:var(--dsh-tavern-accent,#5956c9);--stc-soft:var(--dsh-tavern-accent-soft,#eeedf9);--stc-highlight:var(--stc-accent);box-sizing:border-box;width:100%;max-width:1020px;min-width:0;margin:0 auto;padding:24px;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:1.6;container:stcontext / inline-size}
body[data-ds-dark-theme] .stc-panel{--stc-surface:var(--dsw-specific-input-major,#24252d);--stc-border:var(--dsw-alias-border-l2,#3d3e48);--stc-muted:var(--dsw-alias-label-secondary,#afb2c0);--stc-soft:var(--dsh-tavern-accent-soft,#303047);--stc-highlight:#bbb7ff}
.stc-panel *{box-sizing:border-box}
.stc-panel h2,.stc-panel h3,.stc-panel p{margin:0}
.stc-panel h2{font-size:23px;font-weight:650;letter-spacing:-.6px;line-height:1.3}
.stc-panel h3{font-size:15px;font-weight:650}
.stc-panel button,.stc-panel select{font:inherit}
.stc-panel .stc-muted{color:var(--stc-muted);font-size:12px}
.stc-panel .stc-heading{display:flex;align-items:center;gap:12px;min-width:0}
.stc-panel .stc-brand{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:13px;background:var(--stc-soft);color:var(--stc-highlight);font-size:16px;font-weight:750;letter-spacing:-1px}
.stc-panel .stc-header{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:22px}
.stc-panel .stc-subtitle{color:var(--stc-muted);font-size:12px;margin-top:4px}
.stc-panel .stc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.stc-panel .stc-between{justify-content:space-between}
.stc-panel .stc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;margin-bottom:16px}
.stc-panel .stc-card{min-width:0;border:1px solid var(--stc-border);border-radius:14px;background:var(--stc-surface);padding:20px}
.stc-panel .stc-config-card{display:flex;flex-direction:column;gap:16px}
.stc-panel .stc-card-title{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.stc-panel .stc-field{display:flex;flex-direction:column;gap:7px;min-width:0;font-size:12px;font-weight:600}
.stc-panel .stc-select{display:block;width:100%;min-width:0;min-height:40px;padding:8px 10px;border:1px solid var(--stc-border);border-radius:8px;color:inherit;background:var(--stc-surface);font-weight:400;text-overflow:ellipsis}
.stc-panel .stc-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;max-width:100%;padding:7px 12px;border:1px solid var(--stc-border);border-radius:8px;color:inherit;background:transparent;line-height:1.4;cursor:pointer;transition:background .15s,border-color .15s}
.stc-panel .stc-button:hover:not(:disabled){border-color:var(--stc-accent);background:var(--stc-soft)}
.stc-panel .stc-button:disabled,.stc-panel .stc-select:disabled{opacity:.45;cursor:not-allowed}
.stc-panel .stc-button:focus-visible,.stc-panel .stc-select:focus-visible,.stc-panel summary:focus-visible{outline:2px solid var(--stc-accent);outline-offset:3px}
.stc-panel .stc-primary{background:var(--stc-accent);border-color:var(--stc-accent);color:#fff;font-weight:600;min-height:42px;padding:10px 18px}
.stc-panel .stc-primary:hover:not(:disabled){background:var(--stc-accent);filter:brightness(1.1)}
.stc-panel .stc-quiet{border-color:transparent;font-size:12px;color:var(--stc-muted);padding:5px 8px;min-height:30px}
.stc-panel .stc-danger{color:var(--dsh-tavern-accent-error,#c54f4f)}
.stc-panel .stc-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:6px;background:var(--stc-soft);color:var(--stc-highlight);font-size:11px;white-space:nowrap}
.stc-panel .stc-badge-neutral{background:rgba(128,128,144,.09);color:var(--stc-muted)}
.stc-panel .stc-badge-error{background:rgba(197,79,79,.1);color:var(--dsh-tavern-accent-error,#c54f4f)}
.stc-panel .stc-dot{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
.stc-panel .stc-empty{border:1px dashed var(--stc-border);border-radius:10px;padding:22px 14px;text-align:center}
.stc-panel .stc-empty p+p{margin-top:5px}
.stc-panel .stc-card-footer{margin-top:auto;padding-top:14px;border-top:1px solid var(--stc-border)}
.stc-panel .stc-message{border-radius:9px;padding:10px 13px;font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}
.stc-panel .stc-notice{background:var(--stc-soft)}
.stc-panel .stc-error{background:rgba(197,79,79,.09);border-left:3px solid var(--dsh-tavern-accent-error,#c54f4f)}
.stc-panel .stc-feedback{display:grid;gap:8px;margin-bottom:16px}
.stc-panel .stc-feedback:empty{display:none}
.stc-panel .stc-generation{display:grid;gap:16px;margin-bottom:16px;border-top:3px solid var(--stc-accent)}
.stc-panel .stc-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.stc-panel .stc-details{border-top:1px solid var(--stc-border);padding-top:12px}
.stc-panel summary{cursor:pointer;font-size:12px;color:var(--stc-muted);border-radius:4px;overflow-wrap:anywhere}
.stc-panel details[open]>summary{margin-bottom:12px}
.stc-panel .stc-details-body{display:grid;gap:12px;min-width:0}
.stc-panel .stc-report{margin-bottom:16px;padding:14px 20px}
.stc-panel .stc-report>summary{color:inherit;font-size:13px}
.stc-panel .stc-report>summary .stc-badge{margin-left:10px}
.stc-panel .stc-meta{font-family:ui-monospace,monospace;font-size:11px;color:var(--stc-muted);overflow-wrap:anywhere}
.stc-panel .stc-report ul{margin:0;padding-left:20px;font-size:12px;color:var(--stc-muted)}
.stc-panel .stc-request{display:grid;gap:14px}
.stc-panel .stc-request pre{margin:0;padding:14px;border:1px solid var(--stc-border);border-radius:9px;background:rgba(128,128,144,.05);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:440px;overflow:auto}
.stc-panel .stc-request-name{font-size:12px;color:var(--stc-muted)}
.stc-panel input,.stc-panel textarea{font:inherit}
.stc-panel textarea.stc-select{resize:vertical;line-height:1.65;min-height:120px}
.stc-panel .stc-editor{display:grid;gap:16px;margin-bottom:16px;border-top:3px solid var(--stc-accent)}
.stc-panel .stc-editor fieldset{border:0;padding:0;margin:0;min-width:0}
.stc-panel .stc-editor-layout{display:grid;grid-template-columns:minmax(200px,1fr) minmax(0,1.8fr);gap:18px;align-items:start}
.stc-panel .stc-editor-form{display:grid;gap:14px;min-width:0}
.stc-panel .stc-editor-list{display:grid;gap:6px;max-height:460px;overflow:auto;overscroll-behavior:contain;padding:3px}
.stc-panel .stc-prompt-row{display:flex;align-items:center;gap:4px;padding:6px;border:1px solid var(--stc-border);border-radius:8px;min-width:0}
.stc-panel .stc-prompt-row[data-selected=true]{background:var(--stc-soft);border-color:var(--stc-accent)}
.stc-panel .stc-prompt-name{flex:1;text-align:left;justify-content:flex-start;min-width:0;overflow-wrap:anywhere}
.stc-panel .stc-check{display:flex;gap:7px;align-items:center;font-size:12px;font-weight:400}
.stc-panel input[type=checkbox]{accent-color:var(--stc-accent);flex:none}
.stc-panel .stc-editor-tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--stc-border);padding-bottom:12px}
.stc-panel [role=tab][aria-selected=true]{color:var(--stc-highlight);background:var(--stc-soft);border-color:var(--stc-accent)}
.stc-panel .stc-code{font-family:ui-monospace,monospace;font-size:12px;tab-size:2;min-height:360px!important}
.stc-panel .stc-confirm{display:grid;gap:10px;margin-bottom:16px;border:1px solid var(--stc-accent);padding:14px;border-radius:9px;background:var(--stc-soft)}
.stc-panel .stc-editor-footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;border-top:1px solid var(--stc-border);padding-top:14px}
@container stcontext (max-width:650px){.stc-panel .stc-editor-layout{grid-template-columns:1fr}.stc-panel .stc-editor-list{max-height:260px}}
@container stcontext (max-width:480px){.stc-panel .stc-header{align-items:flex-start}
.stc-panel .stc-card{padding:16px}
.stc-panel .stc-actions{align-items:stretch}
.stc-panel .stc-actions>.stc-row{width:100%}
.stc-panel .stc-actions .stc-primary{flex:1}
.stc-panel .stc-header-status{display:none}
.stc-panel .stc-brand{width:36px;height:36px}
.stc-panel h2{font-size:20px}}
@media(max-width:480px){.stc-panel{padding:16px}}
@media(prefers-reduced-motion:reduce){.stc-panel .stc-button{transition:none}}
`;
        function download(name, text) {
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
          const a = document.createElement('a'); a.href = url; a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        function Panel({ gameId, close, settingsPage = false, manageDefaults = false, visible = true }) {
          const [config, setConfig] = React.useState(null);
          const [bodyDefaults, setBodyDefaults] = React.useState(undefined);
          const [error, setError] = React.useState(''), [notice, setNotice] = React.useState(''), [working, setWorking] = React.useState(false);
          const [settings, setSettings] = React.useState({}), [report, setReport] = React.useState(null);
          const [presetReport, setPresetReport] = React.useState({ key: '', value: null, error: '' });
          const [catalog, setCatalog] = React.useState([]), [modelsLoading, setModelsLoading] = React.useState(false), [modelError, setModelError] = React.useState('');
          const [reasoning, setReasoning] = React.useState({ key: '', efforts: [], loading: false, error: '' });
          const [request, setRequest] = React.useState(''), [requestShown, setRequestShown] = React.useState(false);
          const draftKey = settingsPage ? 'settings' : (close ? 'overlay:' : 'panel:') + (gameId || '');
          const [editor, setEditor] = React.useState(drafts.get(draftKey) || null), [confirmation, setConfirmation] = React.useState(null);
          const editorRef = React.useRef(editor);
          const editorElement = React.useRef(null);
          const confirmationElement = React.useRef(null);
          editorRef.current = editor;
          const file = React.useRef(null), alive = React.useRef(true);
          const busy = working || !!confirmation;
          React.useEffect(() => {
            if (editor) { editorElement.current?.scrollIntoView?.({ block: 'start' }); editorElement.current?.focus?.({ preventScroll: true }); }
          }, [!!editor]);
          React.useEffect(() => {
            if (confirmation) { confirmationElement.current?.scrollIntoView?.({ block: 'center' }); confirmationElement.current?.focus?.({ preventScroll: true }); }
          }, [!!confirmation]);
          React.useEffect(() => {
            const beforeUnload = event => { if (editorRef.current?.dirty) { event.preventDefault(); event.returnValue = ''; } };
            window.addEventListener?.('beforeunload', beforeUnload);
            return () => {
              window.removeEventListener?.('beforeunload', beforeUnload);
              if (editorRef.current?.dirty) drafts.set(draftKey, editorRef.current);
              else drafts.delete(draftKey);
            };
          }, []);
          function discardThen(run) {
            if (editor?.dirty) setConfirmation({ run });
            else { clearEditor(); run(); }
          }
          function clearEditor() { editorRef.current = null; setEditor(null); drafts.delete(draftKey); }
          async function refresh(resetSettings = true) {
            const value = await call('config');
            if (alive.current) { setConfig(value); if (resetSettings) setSettings(editableSettings(value.settings)); }
          }
          async function saveSettings() {
            const value = await call('settings', editableSettings(settings));
            if (alive.current) { setConfig(current => ({ ...current, ...value })); setSettings(editableSettings(value.settings)); }
          }
          async function refreshModels() {
            setModelsLoading(true); setModelError('');
            try {
              const value = await call('models');
              if (alive.current) setCatalog(value.groups || []);
            } catch (err) { if (alive.current) setModelError(err.message || String(err)); }
            finally { if (alive.current) setModelsLoading(false); }
          }
          React.useEffect(() => {
            alive.current = true;
            refresh().catch(err => { if (alive.current) setError(err.message || String(err)); });
            refreshModels();
            return () => { alive.current = false; };
          }, []);
          React.useEffect(() => {
            if (!manageDefaults || !visible) return;
            let active = true;
            setBodyDefaults(undefined);
            call('body-generation-defaults').then(value => { if (active) setBodyDefaults(value); }, err => {
              if (active) setError(err.message || String(err));
            });
            return () => { active = false; };
          }, [manageDefaults, visible]);
          async function act(work) {
            setWorking(true); setError(''); setNotice('');
            try { await work(); } catch (err) { if (alive.current) setError(err.message || String(err)); }
            finally { if (alive.current) setWorking(false); }
          }
          function saveBodyDefaults(patch) {
            return act(async () => {
              const value = await call('body-generation-defaults', patch);
              if (alive.current) { setBodyDefaults(value); setNotice('正文生成默认设置已保存'); }
            });
          }
          async function importFile(selected) {
            if (!selected) return;
            await act(async () => {
              checkPresetSize(selected.size);
              await uploadText(await selected.text(), { name: selected.name });
              await refresh(false); setReport(null); setNotice('预设已导入');
            });
          }
          async function uploadText(text, options) {
            checkPresetSize(new Blob([text]).size);
            const upload = await call('upload/begin', { ...options, size: text.length });
            try {
              for (let index = 0, offset = 0; offset < text.length; index++, offset += 50000) {
                await call('upload/chunk', { id: upload.id, index, text: text.slice(offset, offset + 50000) });
              }
              return await call('upload/finish', { id: upload.id });
            } catch (error) { await call('upload/cancel', { id: upload.id }).catch(() => {}); throw error; }
          }
          function checkPresetSize(bytes) {
            if (!config?.limits) throw new Error(config?.limitsError || '尚未读取存储额度，请刷新后重试');
            if (bytes > config.limits.maxPresetBytes) throw new Error('预设文件不能超过 ' + formatBytes(config.limits.maxPresetBytes) + '（按 UTF-8 字节计算）');
          }
          async function readChunks(route, args, firstPart) {
            let info, offset = 0; const chunks = [];
            do {
              const part = firstPart || await call(route, { ...args, offset, ...(info ? { revision: info.revision, token: info.token } : {}) });
              firstPart = null;
              if (part.offset !== offset || typeof part.text !== 'string' || !Number.isSafeInteger(part.total) || part.total < offset + part.text.length
                || (info && (part.revision !== info.revision || part.total !== info.total || part.token !== info.token))
                || (!part.text.length && offset < part.total)) throw new Error('预设读取不完整，请重试');
              info = part; chunks.push(part.text); offset += part.text.length;
            } while (offset < info.total);
            return { ...info, text: chunks.join('') };
          }
          async function openEditor(id) {
            const info = await readChunks('preset/read', { id });
            const text = info.text, snapshot = editorSnapshot(text), doc = snapshot.document;
            if (alive.current) setEditor({ id, revision: info.revision, name: info.name, text, ...snapshot, dirty: false,
              promptId: doc ? orderOf(doc).order[0]?.identifier || doc.prompts[0].identifier : '', search: '', regexIndex: 0 });
          }
          function changeDocument(work) {
            setEditor(current => {
              const doc = clone(current.document); work(doc);
              return { ...current, document: doc, text: JSON.stringify(doc, null, 2), dirty: true, report: null, error: '' };
            });
          }
          function changeTab(tab) {
            try {
              const doc = editor.tab === 'json' ? editorDocument(editor.text) : editor.document;
              const promptId = doc.prompts.some(item => item.identifier === editor.promptId) ? editor.promptId : orderOf(doc).order[0]?.identifier || doc.prompts[0].identifier;
              setEditor({ ...editor, document: doc, promptId, tab, error: '' });
            } catch (err) { setEditor({ ...editor, error: '无法切换：' + err.message }); }
          }
          async function saveEditor(operation) {
            setWorking(true); setError(''); setNotice('');
            const draft = editor;
            try {
              const value = await uploadText(draft.text, { name: operation === 'copy' ? draft.name.replace(/\.json$/i, '').slice(0, 148) + ' 副本.json' : draft.name,
                operation, presetId: draft.id, revision: draft.revision });
              if (!alive.current) return;
              if (operation === 'validate') {
                const result = await readChunks('preset/report', { id: draft.id }, value.reportPart);
                if (alive.current) setEditor(current => ({ ...current, report: JSON.parse(result.text), error: '' }));
              }
              else {
                const id = operation === 'copy' ? value.activeId : draft.id;
                const record = value.presets.find(item => item.id === id);
                setConfig(current => ({ ...current, ...value })); setReport(null);
                const snapshot = editorSnapshot(draft.text);
                setEditor({ ...draft, ...snapshot, tab: snapshot.document ? draft.tab : 'json', id, revision: record.revision, name: record.name, dirty: false, report: null });
                drafts.delete(draftKey); setNotice(operation === 'copy' ? '已另存为副本并选用' : '预设已保存，下次生成生效');
              }
            } catch (err) { if (alive.current) setEditor(current => ({ ...current, error: err.message || String(err) })); }
            finally { if (alive.current) setWorking(false); }
          }
          function renderEditor() {
            if (!editor) return null;
            const doc = editor.document || { prompts: [], prompt_order: [{ character_id: 100001, order: [] }] }, order = orderOf(doc).order;
            const prompt = doc.prompts.find(item => item.identifier === editor.promptId);
            const isMarker = prompt && (prompt.marker === true || markerIds.has(prompt.identifier));
            const inOrder = prompt && order.find(item => item.identifier === prompt.identifier);
            const regexes = Array.isArray(doc.extensions?.regex_scripts) ? doc.extensions.regex_scripts : [];
            const rule = regexes[editor.regexIndex];
            const placements = Array.isArray(rule?.placement) ? rule.placement : [];
            const scripts = editor.tab === 'scripts' ? helperRows(doc.extensions?.tavern_helper?.scripts) : [];
            const button = (label, onClick, disabled = false, extra = {}) => h('button', { type: 'button', className: 'stc-button', disabled: busy || disabled, onClick, ...extra }, label);
            const field = (label, value, onChange, options = {}) => h('label', { className: 'stc-field' }, label,
              h(options.multiline ? 'textarea' : 'input', { className: 'stc-select' + (options.code ? ' stc-code' : ''), 'aria-label': label,
                value: value ?? '', onChange: event => onChange(event.target.value), spellCheck: !options.code,
                ...Object.fromEntries(Object.entries(options).filter(([key]) => !['multiline', 'code'].includes(key))) }));
            const check = (label, checked, onChange, disabled = false) => h('label', { className: 'stc-check' },
              h('input', { type: 'checkbox', 'aria-label': label, checked, disabled, onChange: event => onChange(event.target.checked) }), label);
            const select = (label, value, options, onChange, disabled = false) => h('label', { className: 'stc-field' }, label,
              h('select', { className: 'stc-select', 'aria-label': label, value, disabled, onChange: event => onChange(event.target.value) },
                ...options.map(([id, name]) => h('option', { key: id, value: id }, name))));
            const patchPrompt = (key, value) => changeDocument(next => { const item = next.prompts.find(item => item.identifier === prompt.identifier); if (value === undefined) delete item[key]; else item[key] = value; });
            const numberValue = value => value === '' ? undefined : Number(value);
            const enablePrompt = (id, enabled) => changeDocument(next => {
              const entries = orderOf(next).order, entry = entries.find(item => item.identifier === id);
              if (entry) entry.enabled = enabled; else entries.push({ identifier: id, enabled });
            });
            const movePrompt = (id, target) => changeDocument(next => {
              const entries = orderOf(next).order, from = entries.findIndex(item => item.identifier === id), to = entries.findIndex(item => item.identifier === target);
              if (from >= 0 && to >= 0) entries.splice(to, 0, entries.splice(from, 1)[0]);
            });
            const addPrompt = duplicate => {
              let id; do { id = 'stcontext-' + Math.random().toString(36).slice(2); } while (doc.prompts.some(item => item.identifier === id));
              changeDocument(next => {
                const item = duplicate ? { ...clone(prompt), identifier: id, name: (prompt.name || prompt.identifier) + ' 副本', system_prompt: false }
                  : { identifier: id, name: '新提示词', role: 'system', content: '', injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [] };
                next.prompts.push(item); orderOf(next).order.push({ identifier: id, enabled: true });
              });
              setEditor(current => ({ ...current, promptId: id, search: '' }));
            };
            const patchRule = (key, value) => changeDocument(next => { const item = next.extensions.regex_scripts[editor.regexIndex]; if (value === undefined) delete item[key]; else item[key] = value; });
            const displayed = [...order.map(entry => doc.prompts.find(item => item.identifier === entry.identifier)), ...doc.prompts.filter(item => !order.some(entry => entry.identifier === item.identifier))]
              .filter(item => item && [item.name, item.identifier, item.content].join('\n').toLowerCase().includes(editor.search.toLowerCase()));
            return h('section', { ref: editorElement, tabIndex: -1, className: 'stc-card stc-editor', 'aria-label': '预设编辑器' },
              h('div', { className: 'stc-card-title' }, h('div', null, h('h3', null, '编辑预设'), h('p', { className: 'stc-muted', role: 'status' }, editor.dirty ? '草稿有未保存的修改' : '与已保存预设一致')),
                h('div', { className: 'stc-row' }, button('重新加载预设', () => discardThen(() => act(() => openEditor(editor.id)))), button('关闭编辑器', () => discardThen(() => {})))),
              h('fieldset', { disabled: busy, className: 'stc-editor-form' },
                field('预设名称', editor.name, name => setEditor({ ...editor, name, dirty: true, error: '' }), { maxLength: 160 }),
                h('div', { className: 'stc-editor-tabs', role: 'tablist', 'aria-label': '预设编辑分类' },
                  ...[['prompts', '提示词'], ['regex', '正则规则'], ['scripts', '助手脚本'], ['json', '完整 JSON']].map(([id, label]) =>
                    button(label, () => changeTab(id), false, { key: id, role: 'tab', 'aria-selected': editor.tab === id }))),
                h('div', { role: 'tabpanel', className: 'stc-editor-form', 'aria-label': '预设编辑内容' },
                editor.tab === 'prompts' && h('div', { className: 'stc-editor-layout' },
                  h('div', { className: 'stc-editor-form' },
                    h('div', { className: 'stc-row stc-between' }, h('span', { className: 'stc-muted' }, '顺序 ' + orderOf(doc).character_id + ' · ' + doc.prompts.length + ' 项'), button('新增提示词', () => addPrompt(false))),
                    field('搜索提示词', editor.search, search => setEditor({ ...editor, search }), { type: 'search', placeholder: '名称、标识或内容' }),
                    check('合并相邻系统消息', !!doc.squash_system_messages, value => changeDocument(next => { next.squash_system_messages = value; })),
                    h('div', { className: 'stc-editor-list', 'aria-label': '提示词列表' }, ...displayed.map(item => {
                      const index = order.findIndex(entry => entry.identifier === item.identifier), entry = order[index], title = item.name || item.identifier;
                      return h('div', { key: item.identifier, className: 'stc-prompt-row', 'data-selected': item.identifier === editor.promptId,
                        draggable: !busy && index >= 0, onDragStart: event => event.dataTransfer.setData('text/plain', item.identifier),
                        onDragOver: event => event.preventDefault(), onDrop: event => { event.preventDefault(); if (!busy) movePrompt(event.dataTransfer.getData('text/plain'), item.identifier); } },
                        h('input', { type: 'checkbox', checked: !!entry && entry.enabled !== false, 'aria-label': '启用 ' + title, onChange: event => enablePrompt(item.identifier, event.target.checked) }),
                        button(title + (index < 0 ? ' · 未加入顺序' : ''), () => setEditor({ ...editor, promptId: item.identifier }), false, { className: 'stc-button stc-quiet stc-prompt-name', 'aria-pressed': item.identifier === editor.promptId }),
                        button('↑', () => movePrompt(item.identifier, order[index - 1].identifier), index <= 0, { className: 'stc-button stc-quiet', 'aria-label': '上移 ' + title }),
                        button('↓', () => movePrompt(item.identifier, order[index + 1].identifier), index < 0 || index === order.length - 1, { className: 'stc-button stc-quiet', 'aria-label': '下移 ' + title }));
                    }), !displayed.length && h('p', { className: 'stc-muted' }, '没有匹配的提示词'))),
                  prompt ? h('div', { className: 'stc-editor-form' },
                    h('p', { className: 'stc-meta' }, prompt.identifier),
                    field('条目名称', prompt.name, value => patchPrompt('name', value)),
                    check('启用此提示词', !!inOrder && inOrder.enabled !== false, value => enablePrompt(prompt.identifier, value)),
                    select('消息角色', prompt.role || 'system', [['system', 'System · 系统'], ['user', 'User · 用户'], ['assistant', 'Assistant · 助手'],
                      ...(prompt.role === 'model' ? [['model', 'Model · 助手（兼容）']] : [])], value => patchPrompt('role', value)),
                    isMarker ? h('p', { className: 'stc-message stc-notice' }, '材料占位项：内容来自宿主材料或插件设置中的“玩家设定”。完整历史与必要材料始终保留，关闭占位项只会改变其插入位置。')
                      : field('提示词内容', prompt.content, value => patchPrompt('content', value), { multiline: true, rows: 10 }),
                    !isMarker && select('注入位置', String(prompt.injection_position ?? 0), [['0', '相对位置 · 按列表顺序'], ['1', '聊天内 · 指定深度']], value => patchPrompt('injection_position', Number(value))),
                    !isMarker && Number(prompt.injection_position) === 1 && h('div', { className: 'stc-grid' },
                      field('注入深度', prompt.injection_depth ?? 0, value => patchPrompt('injection_depth', numberValue(value)), { type: 'number', min: 0, step: 1 }),
                      field('同深度顺序', prompt.injection_order ?? 0, value => patchPrompt('injection_order', numberValue(value)), { type: 'number', step: 1 })),
                    h('div', { className: 'stc-row' }, button('复制条目', () => addPrompt(true), isMarker),
                      button('从当前顺序移除', () => changeDocument(next => { orderOf(next).order = orderOf(next).order.filter(item => item.identifier !== prompt.identifier); }), !inOrder)),
                    h('p', { className: 'stc-muted' }, '移出顺序后仍保留条目及扩展引用；勾选可重新加入。永久删除或编辑扩展请使用完整 JSON。'))
                    : h('p', { className: 'stc-muted' }, '选择左侧条目，或新增提示词。')),
                editor.tab === 'regex' && h('div', { className: 'stc-editor-form' },
                  h('p', { className: 'stc-muted' }, '编辑原生 extensions.regex_scripts。规则按列表顺序执行，历史发送规则按当前楼层深度应用。范围、深度和 SPreset 绑定可在完整 JSON 中编辑。'),
                  h('div', { className: 'stc-row' }, button('新增正则', () => {
                    changeDocument(next => { next.extensions ||= {}; next.extensions.regex_scripts ||= []; next.extensions.regex_scripts.push({ id: 'stcontext-' + Math.random().toString(36).slice(2), scriptName: '新正则', findRegex: '/(?:)/g', replaceString: '', disabled: true, placement: [2], trimStrings: [] }); });
                    setEditor(current => ({ ...current, regexIndex: regexes.length }));
                  })),
                  select('正则条目', rule ? String(editor.regexIndex) : '', [['', '选择规则'], ...regexes.map((item, index) => [String(index), (index + 1) + '. ' + (item.scriptName || item.name || '未命名')])], value => setEditor({ ...editor, regexIndex: value === '' ? -1 : Number(value) })),
                  rule && h('div', { className: 'stc-editor-form' },
                    field('规则名称', rule.scriptName, value => patchRule('scriptName', value)),
                    check('启用此正则', rule.disabled !== true && rule.enabled !== false, value => changeDocument(next => { const item = next.extensions.regex_scripts[editor.regexIndex]; item.disabled = !value; if (Object.hasOwn(item, 'enabled')) item.enabled = value; })),
                    field('查找正则', rule.findRegex, value => patchRule('findRegex', value), { multiline: true, rows: 3, spellCheck: false }),
                    field('替换文本', rule.replaceString, value => patchRule('replaceString', value), { multiline: true, rows: 4 }),
                    h('div', { className: 'stc-row' }, ...[[1, '用户输入'], [2, '模型输出']].map(([value, label]) => h('span', { key: value }, check(label, placements.map(Number).includes(value),
                      enabled => patchRule('placement', enabled ? [...placements, value] : placements.filter(item => Number(item) !== value)))))),
                    h('div', { className: 'stc-row' }, ...[[-1, '上移正则'], [1, '下移正则']].map(([delta, label]) => button(label, () => {
                      changeDocument(next => { const items = next.extensions.regex_scripts; items.splice(editor.regexIndex + delta, 0, items.splice(editor.regexIndex, 1)[0]); });
                      setEditor(current => ({ ...current, regexIndex: current.regexIndex + delta }));
                    }, editor.regexIndex + delta < 0 || editor.regexIndex + delta >= regexes.length, { key: delta })),
                    button('删除正则', () => { changeDocument(next => { next.extensions.regex_scripts.splice(editor.regexIndex, 1); }); setEditor(current => ({ ...current, regexIndex: Math.max(0, current.regexIndex - 1) })); })))),
                editor.tab === 'scripts' && h('div', { className: 'stc-editor-form' },
                  h('p', { className: 'stc-muted' }, '管理 extensions.tavern_helper.scripts 中的内嵌助手脚本。启用的脚本将在 QuickJS 受限沙箱中执行生成期事件、ToolManager 工具注册与回复后处理。'),
                  ...(scripts.length
                    ? scripts.map(item => h('div', { key: item.path.join('.'), className: 'stc-prompt-row' },
                      check('启用 ' + item.name, item.enabled, value => changeDocument(next => {
                        const target = item.path.reduce((value, key) => value[key], next.extensions.tavern_helper.scripts);
                        target.enabled = value;
                      }), item.disabled),
                      h('span', { className: 'stc-muted' }, (item.folder ? '文件夹 · ' : '') + formatBytes(item.bytes))))
                    : [h('p', { key: 'empty', className: 'stc-muted' }, '当前预设未包含内嵌酒馆助手脚本。')])),
                editor.tab === 'json' && h('div', { className: 'stc-editor-form' },
                  h('p', { className: 'stc-muted' }, '编辑完整预设，包括 SPreset、助手脚本和未映射字段。切换回表单时解析 JSON；校验和保存只做静态检查，不执行脚本或调用模型。'),
                  field('预设 JSON', editor.text, text => setEditor({ ...editor, text, dirty: true, report: null, error: '' }), { multiline: true, code: true, rows: 22 })))),
              editor.error && h('p', { className: 'stc-message stc-error', role: 'alert' }, editor.error),
              editor.report && h('details', { className: 'stc-details', open: true }, h('summary', null, '草稿校验报告'),
                h('p', { className: 'stc-muted' }, editor.report.blockers?.length ? '结构有效，可保存；以下问题会阻止生成。' : '结构校验通过；实际生成前仍会检查材料与模型预算。'),
                ...(editor.report.blockers || []).map((text, index) => h('p', { key: index, className: 'stc-message stc-error' }, text)),
                h('ul', null, ...(editor.report.warnings || []).map((text, index) => h('li', { key: index, className: 'stc-muted' }, text)))),
              h('div', { className: 'stc-editor-footer' }, h('div', { className: 'stc-row' }, button('校验草稿', () => saveEditor('validate')),
                button('导出草稿', () => download(editor.name.replace(/\.json$/i, '') + '.json', editor.text))),
                h('div', { className: 'stc-row' }, button('另存为副本', () => saveEditor('copy')),
                  button(working ? '处理中…' : '保存预设', () => saveEditor('replace'), !editor.dirty, { className: 'stc-button stc-primary' }))));
          }
          async function readRequest() {
            let offset = 0, chunks = [], info;
            do {
              const part = await call('request', { gameId, offset });
              if (!part) throw new Error('本次会话还没有已编译请求，请先生成正文');
              if (info && info.createdAt !== part.createdAt) throw new Error('请求已更新，请重新打开预览');
              info = part; chunks.push(part.text); offset += part.text.length;
            } while (offset < info.total);
            const text = chunks.join('');
            setReport(info.report); setRequest(text); setRequestShown(true);
          }
          const hostPreset = config?.hostPreset;
          const sharedPresets = config?.sharedPresets || [];
          const sharedAvailable = Array.isArray(config?.sharedPresets);
          const missingSharedPreset = hostPreset && (hostPreset === 'current' ? !sharedAvailable : !sharedPresets.some(item => item.id === hostPreset));
          const selected = hostPreset ? null : config?.presets.find(item => item.id === config.activeId);
          const reportKey = selected ? selected.id + ':' + (selected.revision || selected.digest) : '';
          React.useEffect(() => {
            let active = true;
            setPresetReport({ key: reportKey, value: null, error: '' });
            if (selected) readChunks('preset/report', { id: selected.id, revision: selected.revision || selected.digest }).then(result => {
              if (active) setPresetReport({ key: reportKey, value: JSON.parse(result.text), error: '' });
            }).catch(err => { if (active) setPresetReport({ key: reportKey, value: null, error: err.message || String(err) }); });
            return () => { active = false; };
          }, [reportKey, config?.settings]);
          const activeReport = report || (presetReport.key === reportKey ? presetReport.value : null);
          const modelKey = settings.model?.provider && settings.model?.model
            ? JSON.stringify({ provider: settings.model.provider, model: settings.model.model }) : '';
          const modelOptions = catalog.flatMap(group => group.models.map(model => ({
            key: JSON.stringify({ provider: group.provider, model: model.id }),
            label: group.providerName + ' · ' + model.name, efforts: model.efforts || [],
          })));
          const selectedModel = modelOptions.find(model => model.key === modelKey);
          React.useEffect(() => {
            let active = true;
            if (modelKey) {
              setReasoning({ key: modelKey, efforts: [], loading: true, error: '' });
              call('model-reasoning', JSON.parse(modelKey)).then(value => {
                if (!active) return;
                const efforts = value.efforts || [];
                setReasoning({ key: modelKey, efforts, loading: false, error: '' });
                // A confirmed lack of levels must not keep a stale saved override.
                if (!efforts.length) setSettings(current => {
                  if (!current.model?.reasoningEffort || JSON.stringify({ provider: current.model.provider, model: current.model.model }) !== modelKey) return current;
                  const { reasoningEffort, ...model } = current.model;
                  return { ...current, model };
                });
              }, err => {
                if (active) setReasoning({ key: modelKey, efforts: [], loading: false, error: err.message || String(err) });
              });
            }
            return () => { active = false; };
          }, [modelKey, catalog]);
          const efforts = reasoning.key === modelKey ? reasoning.efforts : [];
          const reasoningLoading = !!modelKey && (modelsLoading || reasoning.key !== modelKey || reasoning.loading);
          const reasoningError = reasoning.key === modelKey ? reasoning.error : '';
          const settingsDirty = config && JSON.stringify(editableSettings(settings)) !== JSON.stringify(editableSettings(config.settings));
          const ready = !!(config?.hostReady && (selected || hostPreset && !missingSharedPreset) && modelKey && !reasoningLoading);
          const message = (text, kind = 'notice', role = 'status') => h('p', { className: 'stc-message stc-' + kind, role }, text);
          const badge = (text, tone = '') => h('span', { className: 'stc-badge' + (tone ? ' stc-badge-' + tone : '') }, text);
          // Sidebar tabs and overlays have a bounded host area; settings already owns its scroll area.
          return h('div', { className: settingsPage ? 'stc-settings' : 'stc-scroll' },
            h('style', null, css),
            h('div', { className: 'stc-panel' },
            h('header', { className: 'stc-header' },
              h('div', { className: 'stc-heading' }, h('span', { className: 'stc-brand', 'aria-hidden': true }, 'ST'),
                h('div', null, h('h2', null, 'STcontext'), h('p', { className: 'stc-subtitle' }, '完整可见历史 · 独立模型生成'))),
              h('div', { className: 'stc-row' }, h('span', { className: 'stc-header-status' }, badge(!config ? '加载中' : ready ? '配置就绪' : '待配置', ready ? '' : 'neutral')),
                close && h('button', { className: 'stc-button stc-quiet', disabled: busy, onClick: () => discardThen(close) }, '关闭'))),
            h('div', { className: 'stc-feedback' }, error && message(error, 'error', 'alert'), notice && message(notice),
              config?.limitsError && message(config.limitsError, 'error', 'alert'),
              config?.sharedPresetsError && message(config.sharedPresetsError, 'error', 'alert'),
              presetReport.key === reportKey && presetReport.error && message('兼容报告读取失败：' + presetReport.error, 'error', 'alert'),
              config?.hostReady === false && message('宿主尚未提供插件正文生成接口，请更新上游 DSH Tavern。预设仍可导入保存。', 'error', 'alert')),
            confirmation && h('div', { ref: confirmationElement, tabIndex: -1, className: 'stc-confirm', role: 'alertdialog', 'aria-label': '未保存的预设更改' },
              h('p', null, '当前预设草稿尚未保存，继续会放弃这些修改。'),
              h('div', { className: 'stc-row' },
                h('button', { className: 'stc-button', onClick: () => { setConfirmation(null); editorElement.current?.focus?.(); } }, '继续编辑'),
                h('button', { className: 'stc-button stc-danger', onClick: () => { const run = confirmation.run; setConfirmation(null); clearEditor(); run(); } }, '放弃更改并继续'))),
            h('div', { className: 'stc-grid' },
            h('section', { className: 'stc-card stc-config-card', 'aria-label': '预设管理' },
              h('div', { className: 'stc-card-title' }, h('div', null, h('h3', null, '预设'), h('p', { className: 'stc-muted' }, '管理叙事规则与上下文组织方式')),
                h('button', { className: 'stc-button', disabled: busy || !config?.limits, onClick: () => file.current?.click() }, '导入 JSON')),
              h('input', { ref: file, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: event => { const selectedFile = event.target.files?.[0]; event.target.value = ''; if (selectedFile) discardThen(() => importFile(selectedFile)); } }),
              !selected && !hostPreset && h('div', { className: 'stc-empty' }, h('p', null, config ? '还没有选定预设' : '正在读取预设…'), h('p', { className: 'stc-muted' }, sharedAvailable ? '可直接选择宿主预设，也可导入 SillyTavern 预设 JSON。' : '导入 SillyTavern 预设 JSON，即可开始配置。')),
              h('label', { className: 'stc-field' }, '当前预设',
                h('select', { className: 'stc-select', 'aria-label': '当前预设', value: hostPreset ? 'host:' + hostPreset : config?.activeId || '', disabled: busy || !sharedAvailable && !config?.presets.length,
                  onChange: event => {
                    const value = event.target.value;
                    const selection = value.startsWith('host:') ? { hostPreset: value.slice(5) } : { id: value };
                    discardThen(() => act(async () => { await call('select', selection); setReport(null); await refresh(false); }));
                  } },
                  h('option', { value: '', disabled: true }, sharedAvailable ? '请选择预设' : '请选择导入的预设'),
                  ...(config?.presets || []).map(item => h('option', { key: item.id, value: item.id }, item.name)),
                  sharedAvailable && h('optgroup', { label: 'DSH Tavern 预设库' },
                    h('option', { value: 'host:current' }, '跟随本局宿主预设'),
                    ...sharedPresets.map(item => h('option', { key: item.id, value: 'host:' + item.id }, item.name))),
                  missingSharedPreset && h('option', { value: 'host:' + hostPreset, disabled: true }, '已选宿主预设不可用'))),
              hostPreset && h('p', { className: 'stc-muted' }, '宿主预设在 DSH Tavern 预设库中编辑，修改从下一次生成或重生成开始生效。'),
              selected && h('div', { className: 'stc-row' }, badge((selected.summary?.enabledPrompts || 0) + ' 项提示词', 'neutral'), badge((selected.summary?.regexCount || 0) + ' 条正则', 'neutral')),
              config?.limits && h('p', { className: 'stc-muted', role: 'status' }, '存储已用 ' + formatBytes(config.storage.usedBytes) + ' / ' + formatBytes(config.limits.maxStoreBytes) + '，剩余 ' + formatBytes(config.storage.remainingBytes) + '（压缩后的预设与配置合计）'),
              config?.limits?.legacy && h('p', { className: 'stc-muted' }, '当前宿主未提供容量查询接口，使用旧版限制；升级宿主可导入更大的预设。'),
              h('button', { className: 'stc-button stc-quiet', disabled: busy, onClick: () => act(() => refresh(false)) }, '刷新预设与容量'),
              h('button', { className: 'stc-button', disabled: !selected || busy || !!editor, onClick: () => act(() => openEditor(selected.id)) }, '编辑预设'),
              h('div', { className: 'stc-card-footer stc-row stc-between' }, h('span', { className: 'stc-muted' }, config?.limits ? 'JSON · 最大 ' + formatBytes(config.limits.maxPresetBytes) : '正在读取容量'),
                h('div', { className: 'stc-row' },
                  h('button', { className: 'stc-button stc-quiet', disabled: !selected || working, onClick: () => act(async () => { const value = await readChunks('preset/read', { id: selected.id }); download(value.name.replace(/\.json$/i, '') + '.json', value.text); }) }, '导出预设'),
                  h('button', { className: 'stc-button stc-quiet stc-danger', disabled: !selected || busy, onClick: () => discardThen(() => act(async () => { await call('remove', { id: selected.id }); await refresh(false); setReport(null); })) }, '移除')))),
            h('section', { className: 'stc-card stc-config-card', 'aria-label': '生成设置' },
              h('div', { className: 'stc-card-title' }, h('div', null, h('h3', null, '生成设置'), h('p', { className: 'stc-muted' }, '用于正文生成与重生成')), badge('独立配置')),
              h('label', { className: 'stc-field' }, '插件正文模型',
                h('select', { 'aria-label': '插件正文模型', className: 'stc-select', value: modelKey, disabled: busy || !config || modelsLoading,
                  onChange: event => setSettings({ ...settings, model: event.target.value ? JSON.parse(event.target.value) : null }) },
                  h('option', { value: '' }, '请选择模型'),
                  modelKey && !selectedModel && h('option', { value: modelKey }, settings.model.provider + ' · ' + settings.model.model + '（未在列表中找到）'),
                  ...modelOptions.map(model => h('option', { key: model.key, value: model.key }, model.label)))),
              h('label', { className: 'stc-field' }, '推理等级',
                h('select', { 'aria-label': '推理等级', className: 'stc-select', value: settings.model?.reasoningEffort || '', disabled: busy || !modelKey || reasoningLoading || !!reasoningError || !efforts.length,
                  onChange: event => { const model = { ...settings.model }; if (event.target.value) model.reasoningEffort = event.target.value; else delete model.reasoningEffort; setSettings({ ...settings, model }); } },
                  h('option', { value: '' }, '模型默认'),
                  settings.model?.reasoningEffort && !efforts.some(item => item.id === settings.model.reasoningEffort)
                    && h('option', { value: settings.model.reasoningEffort }, settings.model.reasoningEffort + '（未在列表中找到）'),
                  ...efforts.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
              h('p', { className: 'stc-muted', role: 'status' }, !modelKey ? '选择模型后显示其支持的推理等级。' : reasoningLoading ? '正在读取推理等级…'
                : reasoningError ? '暂时无法确认该模型的推理等级，已保留当前设置。'
                : efforts.length ? '仅列出该模型支持的等级；模型默认不指定推理等级。' : '该模型未提供可选推理等级，使用模型默认。'),
              reasoningError && message(reasoningError, 'error', 'alert'),
              h('div', { className: 'stc-row stc-between' }, h('p', { className: 'stc-muted' }, '沿用 DSH 已配置的服务商'),
                h('button', { className: 'stc-button stc-quiet', disabled: busy || modelsLoading, onClick: refreshModels }, modelsLoading ? '正在读取模型…' : '刷新模型列表')),
              !modelKey && message('请先选择插件正文模型。旧版前台/后台跟随设置需重新选择。'),
              !modelsLoading && !modelOptions.length && message('暂无可选文本模型，请先在 DSH 配置模型服务商，再刷新列表。'),
              modelError && message(modelError, 'error', 'alert'),
              ...catalog.filter(group => group.error).map(group => h('p', { key: group.provider, className: 'stc-message stc-error', role: 'alert' }, group.providerName + '：' + group.error)),
              h('label', { className: 'stc-field' }, '玩家设定',
                h('textarea', { 'aria-label': '玩家设定', className: 'stc-select', rows: 5, value: settings.personaDescription || '', disabled: busy || !config,
                  placeholder: '填写你扮演的玩家的身份、外貌、性格、背景等',
                  onChange: event => setSettings({ ...settings, personaDescription: event.target.value }) })),
              h('p', { className: 'stc-muted' }, '保存后按原文填入 Persona Description；留空不额外添加。预设未启用该占位项时会自动补入，宿主原有玩家材料仍保留。'),
              h('div', { className: 'stc-card-footer stc-row stc-between' }, h('span', { className: 'stc-muted', role: 'status' }, settingsDirty ? '有未保存的更改' : '设置对所有会话生效'),
                h('button', { className: 'stc-button', disabled: busy || !config || reasoningLoading, onClick: () => act(async () => { await saveSettings(); setNotice('设置已保存'); }) }, '保存设置')))),
            manageDefaults && h('section', { className: 'stc-card stc-config-card stc-generation', 'aria-label': '正文生成默认设置' },
              h('h3', null, '正文生成默认设置'),
              bodyDefaults === null ? h('p', { className: 'stc-muted' }, '当前宿主请在「设置 → DSH Tavern → 剧情」选择 STcontext、生成方式和宿主正则。')
                : bodyDefaults === undefined ? null : h(React.Fragment, null,
                  h('label', { className: 'stc-field' }, '默认正文生成方式',
                    h('select', { 'aria-label': '默认正文生成方式', className: 'stc-select', value: bodyDefaults.mode, disabled: busy,
                      onChange: event => saveBodyDefaults({ mode: event.target.value }) },
                      h('option', { value: 'host' }, '默认不使用 STcontext'),
                      h('option', { value: 'plugin-direct' }, '由 STcontext 直接生成'),
                      h('option', { value: 'plugin-tool-call' }, '前台检索后由 STcontext 生成'))),
                  h('label', { className: 'stc-row' },
                    h('input', { type: 'checkbox', 'aria-label': '追加宿主正则', checked: bodyDefaults.hostRegex, disabled: busy || bodyDefaults.mode === 'host',
                      onChange: event => saveBodyDefaults({ hostRegex: event.target.checked }) }), '追加宿主正则'),
                  h('p', { className: 'stc-muted' }, '选择由 STcontext 生成会将它设为默认生成器。更改立即保存，并在跟随全局的会话中从下一次生成开始生效。'))),
            renderEditor(),
            h('section', { className: 'stc-card stc-generation', 'aria-label': '使用说明' },
              h('h3', null, '正文生成'),
              h('p', { className: 'stc-muted' }, '先保存预设与模型设置，再从侧栏「＋ → 插件 → STcontext」设置默认生成方式。本局设置可以覆盖默认值。'),
              h('p', { className: 'stc-muted' }, '使用宿主的发送、重生成、失败重试和停止按钮。生成进度及错误由宿主显示；提交后结算失败时，在宿主中重试结算。'),
              h('p', { className: 'stc-muted' }, '预设、模型与玩家设定在操作开始时冻结；生成途中保存更改只影响下一次操作。'),
              gameId ? h('div', { className: 'stc-actions' },
                h('button', { className: 'stc-button stc-quiet', disabled: working, onClick: () => act(readRequest) }, '查看本次请求'))
                : h('p', { className: 'stc-muted' }, '打开游戏后，通过侧栏「＋ → STcontext」或输入框上方的「STcontext」查看本次请求。')),
            activeReport && h('details', { className: 'stc-card stc-report', key: (selected?.id || '') + (activeReport.blockers?.length ? '-blocked' : ''), open: activeReport.blockers?.length ? true : undefined },
              h('summary', null, '兼容报告', badge(activeReport.blockers?.length ? activeReport.blockers.length + ' 项待处理' : activeReport.warnings?.length ? activeReport.warnings.length + ' 项提示' : '检查通过', activeReport.blockers?.length ? 'error' : 'neutral')),
              h('div', { className: 'stc-details-body' },
                h('p', { className: 'stc-meta' }, '顺序 ' + activeReport.order + ' · ' + activeReport.protocol),
                h('p', { className: 'stc-muted' }, '导入报告为静态检查；脚本结果、完整材料和模型预算仍会在发送前校验。'),
                activeReport.hooks?.length > 0 && h('p', { className: 'stc-meta' }, '处理阶段：' + activeReport.hooks.join(' → ')),
                ...(activeReport.blockers || []).map((text, index) => h('p', { key: 'b' + index, className: 'stc-message stc-error', role: 'alert' }, text)),
                h('ul', null, ...(activeReport.warnings || []).map((text, index) => h('li', { key: index }, text))),
                activeReport.historyRules?.length > 0 && h('details', null, h('summary', null, '按本轮深度应用的历史发送规则'), h('ul', null, ...activeReport.historyRules.map(rule => h('li', { key: rule.index }, rule.name)))),
                selected && h('p', { className: 'stc-meta' }, 'SHA-256：' + selected.digest))),
            requestShown && h('section', { className: 'stc-card stc-request', 'aria-label': '请求预览' },
              h('div', { className: 'stc-card-title' }, h('div', null, h('h3', null, '请求预览'), h('p', { className: 'stc-request-name' }, 'stcontext-request.json')),
                h('div', { className: 'stc-row' }, h('button', { className: 'stc-button', onClick: () => download('stcontext-request.json', request) }, '下载完整请求'), h('button', { className: 'stc-button stc-quiet', onClick: () => setRequestShown(false) }, '收起'))),
              typeof report?.outputProcessing?.hostRegex === 'boolean' && h('p', { className: 'stc-muted' },
                report.outputProcessing.hostRegex
                  ? '宿主额外正则已开启，会继续处理模型历史和聊天显示。两边启用相同规则时可能重复替换。'
                  : '本轮由预设分别处理聊天显示和发送历史。'),
              h('pre', null, request))));
        }
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-tavern-stcontext', order: 115, label: () => 'STcontext',
        }, () => h(Panel, { settingsPage: true }))), 'STcontext: settings section');
        ui.registerPanel({ id: 'st-context', title: 'STcontext', render: ({ gameId, visible }) => h(Panel, { gameId, visible, manageDefaults: true }) });
        ui.registerComposerAction({
          id: 'regenerate', label: 'STcontext',
          run: async ({ gameId }) => {
            ui.openOverlay({ gameId, render: ({ close }) => h(Panel, { gameId, close }) });
          },
        });
      },
    };
  },
});
