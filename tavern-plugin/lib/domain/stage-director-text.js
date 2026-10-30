import { parseBubbles, stripBubbleCodeQuote } from '../../src/client/bubble-line.cjs'
import { projectDisplayParts } from './reply-presentation.js'

// Clean after numbering: even an empty result must retain its original paragraph slot.
export function cleanDirectorText(value) {
  const source = String(value || '').replace(/<(think|thinking|analysis|updatevariable|initvar|variable-update|status)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
  const text = projectDisplayParts(source).parts.filter(part => part.kind === 'markdown').map(part => part.text || '').join('\n')
  const plain = value => value.replace(/\*\*|__|~~/g, '').replace(/(^|[^\w])([*_])(?=\S)(.+?\S|\S)\2(?!\w)/g, '$1$3').trim()
  return text.split(/\r?\n/).map(line => {
    const bubble = parseBubbles(line, false).find(segment => segment.kind === 'bubble')
    if (!bubble) return plain(line)
    const { name, mood, text: body, thought } = bubble
    // Director digests retain source spelling even though display aliases are normalized.
    const alias = stripBubbleCodeQuote(line).split(/[|｜]/, 1)[0].replace(/^\s*@bubble(?:-voice)?\s*[:：]\s*/, '').trim()
    return (name.trim() || alias.trim()) + '\u3014' + alias.trim() + '\u3015' +
      (mood.trim() ? '\uff08' + mood.trim() + '\uff09' : '') + '\uff1a' + (thought ? '\uff08\u5fc3\u58f0\uff09' : '') + plain(body)
  }).filter(Boolean).join('\n')
}

export function cleanDirectorUnits(units) {
  return units.map(unit => ({ ...unit, text: cleanDirectorText(unit.text) }))
}
