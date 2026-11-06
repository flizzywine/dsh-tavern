import { registerEjsLanguage, mountOriginalEditor, saveEditorSettings } from '../upstream/src/modules/code-editor.ts?language-only'
let ready
export async function createEjsCodeEditor(container, options) {
  ready ||= import('monaco-editor').then(monaco => { registerEjsLanguage(monaco); return monaco })
  const monaco = await ready
  return mountOriginalEditor(monaco, options.value || '', (html, lifecycle) => {
    container.innerHTML = html
    const editor = lifecycle.onOpen()
    // Keep preferences even when the parent cancels and removes the frame.
    const remember = () => saveEditorSettings(editor)
    container.addEventListener('change', remember)
    container.addEventListener('input', remember)
    let disposed = false
    return { getValue: () => editor.getValue(), focus: () => editor.focus(),
      dispose() {
        if (disposed) return
        disposed = true
        container.removeEventListener('change', remember)
        container.removeEventListener('input', remember)
        lifecycle.onClose()
        container.replaceChildren()
      }
    }
  })
}
