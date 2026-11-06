// Reuse the pinned upstream language definition without initializing its game UI.
module.exports = function (source) {
  function section(start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error('Upstream EJS editor structure changed');
    return source.slice(a, b);
  }
  let editor = source.slice(source.indexOf("const STORAGE_KEY ="));
  if (!editor.startsWith('const STORAGE_KEY =')) throw new Error('Missing upstream editor UI');
  editor = editor.replace('function saveEditorSettings(', 'export function saveEditorSettings(')
    .replace('async function showEditor(ref: string)', 'export async function mountOriginalEditor(monaco: any, value: string, mount: any)')
    .replace(/await callGenericPopup\(\s*toolbarHtml,\s*POPUP_TYPE.TEXT,\s*'',/, 'return mount(toolbarHtml,')
    .replace("value: $(`#${ref}`).val() as string ?? '',", "value, editContext: false, ariaLabel: 'EJS 模板代码',")
    .replace('            },\n            onClose:', '                return editor;\n            },\n            onClose:')
    .replace('                    $(`#${ref}`).val(editor.getValue());', '                    const model = editor.getModel();')
    .replace("                    $(`#${ref}`).trigger('input');", '                    model?.dispose();')
    // Let Monaco apply the font selected through the upstream menu.
    .replace(/        \.monaco-editor,\n[\s\S]*?font-variant-ligatures: none !important;\n        }/, '');
  if (editor.includes('$(') || editor.includes('callGenericPopup')) throw new Error('Unexpected upstream editor host dependency');
  return section('const autoComplete =', 'let monaco:')
    + '\nexport function registerEjsLanguage(monaco: any) {\n'
    + section('    // 1. Registered Language', "    eventSource.on(event_types.APP_READY")
    + '\n}\n'
    + section('function getJsSuggestions(', 'function reloadWorldInfoPage(') + '\n' + editor;
};
