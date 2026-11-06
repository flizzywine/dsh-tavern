import { marked } from 'marked'
import { displaySourceSegments } from '../../../domain/display-source.js'
import { chat, getRegexedString, name1, name2 } from './host.js'

function escapeHTML(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function formatTemplateSource(text) {
  const source = String(text ?? '')
  // Keep expressions opaque to both the Markdown lexer and the HTML parser.
  // Restore exactly one entity layer for upstream's escaped EJS delimiters.
  let prefix = '\uE000DSH_TEMPLATE_EXPRESSION_'
  while (source.includes(prefix)) prefix += '_'
  const expressions = []
  const protectedSource = source.replace(/<%([\s\S]*?)%>/g, (_match, body) => {
    const token = prefix + expressions.length + '\uE001'
    expressions.push({token, text:'&lt;%' + escapeHTML(body) + '%&gt;'})
    return token
  })
  const template = document.createElement('template')
  template.innerHTML = displaySourceSegments(protectedSource, {editing:true}).map(segment => {
    if (segment.kind === 'marker') return segment.text
    if (segment.kind !== 'html') return marked.parse(segment.text, {gfm:true})
    if (!segment.fenced) return segment.content
    const pre = document.createElement('pre'), code = document.createElement('code')
    code.className = 'language-html'
    code.textContent = segment.content
    pre.append(code)
    return pre.outerHTML + '\n'
  }).join('')
  let html = template.innerHTML
  for (const {token, text} of expressions) html = html.replaceAll(token, text)
  return html
}

function formatDisplayText(text, isSystem, isUser, index, statusBoundaries = true) {
  const source = isSystem ? text : getRegexedString(String(text ?? ''), isUser ? 1 : 2,
    { isMarkdown: true, depth: Math.max(0, chat.length - index - 1), statusBoundaries })
  return String(source ?? '').replace(/\{\{\s*(user|char)\s*\}\}/gi, (token, name) => name.toLowerCase() === 'user' ? name1 || '你' : name2 || token)
}

export function formatTemplateMessage(text, _name, isSystem = false, isUser = false, index = chat.length - 1) {
  // Upstream evaluates HTML-escaped delimiters, including in script/style text.
  return formatTemplateSource(formatDisplayText(text, isSystem, isUser, index))
}

export function captureTemplateDisplay(message, index) {
  const html = templateMessageHTML(document.querySelector(`.mes[mesid="${index}"] .mes_text`))
  if (html === formatTemplateSource(message.mes)) return undefined
  const parsed = document.createElement('template'); parsed.innerHTML = html
  const root = parsed.content
  // Host decorations are not template output. Compare against ordinary display
  // formatting, not raw Markdown (which excludes display regexes and macros).
  for (const button of root.querySelectorAll('button[data-template-copy]')) button.remove()
  const formattingText = formatDisplayText(message.mes, message.is_system, message.is_user, index)
  const formatted = formatTemplateMessage(message.mes, message.name, message.is_system, message.is_user, index)
  if (parsed.innerHTML === formatted) {
    if (formattingText === message.mes) return undefined
    // Freeze ordinary formatting too, without making the whole reply an HTML frame.
    return {source:message.mes,swipe:message.swipe_id || 0,html:formatted,formattingText:formatDisplayText(message.mes,message.is_system,message.is_user,index,false)}
  }
  // Preserve decorations in real template output.
  parsed.innerHTML = html
  const parts = []
  const append = content => { if (content.trim()) parts.push({kind:'html',content}) }
  // Keep declared status panels and fenced HTML separate from surrounding prose.
  for (;;) {
    const element = root.querySelector('[data-dsh-template-status], pre > code.language-html, pre > code.language-htm')
    if (!element) break
    const status = element.hasAttribute('data-dsh-template-status')
    const target = status ? element : element.parentElement
    const range = document.createRange(); range.setStart(root,0); range.setEndBefore(target)
    const prefix = document.createElement('template'); prefix.content.append(range.extractContents()); append(prefix.innerHTML)
    if (status) parts.push({kind:'html',content:element.innerHTML,statusRule:Number(element.getAttribute('data-dsh-template-status')),
      statusKey: element.hasAttribute('data-dsh-status-key') ? decodeURIComponent(element.getAttribute('data-dsh-status-key')) : undefined})
    else append(element.textContent)
    target.remove()
  }
  append(parsed.innerHTML)
  return {source:message.mes,swipe:message.swipe_id || 0,html,parts}
}

// The mirror is only for upstream formatting. Card HTML executes in its visible DSH frame.
function inertMarkup(html) {
  const template = document.createElement('template'); template.innerHTML = html
  for (const element of template.content.querySelectorAll('*')) {
    const removed = [...element.attributes].filter(attr => /^on/i.test(attr.name) || (element.tagName === 'IFRAME' && ['src','srcdoc'].includes(attr.name)))
    if (!removed.length) continue
    element.setAttribute('data-template-inert-attributes', JSON.stringify(removed.map(attr => [attr.name,attr.value])))
    for (const attr of removed) element.removeAttribute(attr.name)
  }
  return template.innerHTML
}

export function templateMessageHTML(element) {
  if (!element) return ''
  const template = document.createElement('template'); template.innerHTML = element.innerHTML
  const clone = template.content
  for (const child of clone.querySelectorAll('[data-template-inert-attributes]')) {
    const attributes = JSON.parse(child.getAttribute('data-template-inert-attributes'))
    child.removeAttribute('data-template-inert-attributes')
    for (const [name,value] of attributes) child.setAttribute(name,value)
  }
  return template.innerHTML
}

function installMirrorFormatting() {
  const original = window.$.fn.html
  if (original.templateMirror) return
  function html(value) {
    if (typeof value === 'string' && this.length && this.toArray().every(element => element.closest?.('#chat'))) {
      return this.each(function () { this.innerHTML = inertMarkup(value) })
    }
    const result = original.apply(this,arguments)
    // The DOM decodes entities in attributes (including inert handler JSON).
    // Upstream reads this mirror using escaped EJS delimiters; encode those
    // delimiters again without double-escaping the already serialized body.
    if (!arguments.length && typeof result === 'string' && this[0]?.closest?.('#chat')) {
      return result.replace(/<%([\s\S]*?)%>/g, (_match, body) => '&lt;%' + body + '%&gt;')
    }
    return result
  }
  html.templateMirror = true; window.$.fn.html = html
}

export function mountTemplateMessages({renderIndices = new Set()} = {}) {
  let root = document.getElementById('chat')
  if (!root) { root = document.createElement('div'); root.id = 'chat'; root.hidden = true; document.body.append(root) }
  // Like the visible chat, the formatting mirror is a window over full chat data.
  // Historical batches explicitly add their targets; never format every archived
  // message just to evaluate one new input or eight display rows.
  const visible = new Set(renderIndices)
  for (let index = Math.max(0, chat.length - 200); index < chat.length; index++) visible.add(index)
  const rows = new Map()
  for (const row of Array.from(root.children)) {
    const index = Number(row.getAttribute('mesid'))
    if (visible.has(index) && index < chat.length) rows.set(index, row)
    else row.remove()
  }
  const tail = document.createDocumentFragment()
  for (const index of [...visible].filter(index => Number.isInteger(index) && index >= 0 && index < chat.length).sort((a,b) => a-b)) {
    const message = chat[index]
    const display = message.template_display
    const saved = display?.source === message.mes && display.swipe === (message.swipe_id || 0) ? display.html : undefined
    const source = saved ?? message.mes
    let row = rows.get(index)
    if (!row) {
      row = document.createElement('div'); row.className = 'mes'; row.setAttribute('mesid', String(index))
      const content = document.createElement('div'); content.className = 'mes_text'; row.append(content)
    }
    tail.append(row)
    if (!renderIndices.has(index) && row.templateSource === source && row.templateSwipe === (message.swipe_id || 0)) continue
    row.firstElementChild.innerHTML = inertMarkup(!renderIndices.has(index) && saved !== undefined ? saved : formatTemplateMessage(message.mes, message.name, message.is_system, message.is_user, index))
    row.templateSource = source; row.templateSwipe = message.swipe_id || 0
  }
  root.append(tail)
}

export function createTemplateDOMServices() {
  installMirrorFormatting()
  return {
    messageFormatting: formatTemplateMessage,
    updateMessageBlock(index, message) {
      if (Array.isArray(message.swipes)) message.swipes[message.swipe_id || 0] = message.mes
      const element = document.querySelector(`.mes[mesid="${Number(index)}"] .mes_text`)
      if (element) element.innerHTML = inertMarkup(formatTemplateMessage(message.mes, message.name, message.is_system, message.is_user, index))
    },
    addCopyToCodeBlocks(parent) {
      for (const pre of parent[0]?.querySelectorAll('pre') || []) {
        if (pre.querySelector('[data-template-copy]')) continue
        const button = document.createElement('button'); button.dataset.templateCopy = ''; button.textContent = '复制'
        button.setAttribute('onclick', "navigator.clipboard.writeText(this.parentElement.querySelector('code')?.textContent || '')")
        pre.append(button)
      }
    },
    appendMediaToMessage(message, parent) {
      for (const media of message.extra?.media || []) {
        if (!media.url || parent[0]?.querySelector('[data-template-media="' + CSS.escape(media.url) + '"]')) continue
        const element = document.createElement(media.type === 'video' ? 'video' : media.type === 'audio' ? 'audio' : 'img')
        element.src = media.url; element.dataset.templateMedia = media.url
        if (element.tagName !== 'IMG') element.controls = true
        parent[0]?.append(element)
      }
    },
    updateReasoningUI(parent) {
      for (const block of parent[0]?.querySelectorAll('.mes_reasoning') || []) {
        block.hidden = !block.textContent.trim()
        block.setAttribute('aria-label', '推理内容')
      }
    },
    async callGenericPopup(html, _type, _input, options = {}) {
      const dialog = document.createElement('dialog'); dialog.className = 'template-popup'; dialog.innerHTML = String(html)
      const controls = document.createElement('footer'), save = document.createElement('button'), cancel = document.createElement('button')
      save.textContent = options.okButton || '保存'; cancel.textContent = '取消'; controls.append(save, cancel); dialog.append(controls)
      document.body.append(dialog); dialog.showModal(); await options.onOpen?.()
      return new Promise(resolve => {
        const close = async accepted => {
          const values = [...document.querySelectorAll('textarea')].filter(item => !dialog.contains(item)).map(item => [item, item.value])
          await options.onClose?.()
          if (!accepted) for (const [item, value] of values) { item.value = value; item.dispatchEvent(new Event('input', { bubbles: true })) }
          dialog.close(); dialog.remove(); resolve(accepted ? 1 : 0)
        }
        save.onclick = () => close(true); cancel.onclick = () => close(false)
        dialog.oncancel = event => { event.preventDefault(); void close(false) }
      })
    }
  }
}
