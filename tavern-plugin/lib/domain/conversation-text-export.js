function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function stripLegacyPresentationSuffix(value) {
  const text = str(value)
  const style = text.search(/(?:^|\n)\s*<style\b/i)
  return style < 0 ? text : text.slice(0, style)
}

function cleanMessageText(value) {
  return str(value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

const SECTION_DIVIDER = '------------------------------------------------------------'

function safeFilename(value) {
  const name = str(value)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100)
  return (name || '对话记录') + '.txt'
}

export function createConversationTextExport(chat, options = {}) {
  const source = chat !== null && typeof chat === 'object' ? chat : {}
  const sections = []

  for (const message of Array.isArray(source.messages) ? source.messages : []) {
    if (message === null || typeof message !== 'object') continue
    let text
    if (message.role === 'user') {
      text = cleanMessageText(message.text)
    } else if (message.role === 'assistant') {
      text = cleanMessageText(stripLegacyPresentationSuffix(message.text))
    } else {
      continue
    }
    if (text === '') continue
    sections.push(text)
  }

  return {
    filename: safeFilename(options.title || source.title || (source.cardName ? source.cardName + '的对话' : '对话记录')),
    text: sections.join('\n\n' + SECTION_DIVIDER + '\n\n') + (sections.length > 0 ? '\n' : ''),
    messageCount: sections.length
  }
}
