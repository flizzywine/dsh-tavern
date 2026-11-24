function tavernIsWritingInjection(message) {
    return message?.source?.kind === 'plugin:dsh-tavern-pure-writer' && message.source.form === 'inject'
}

// Legacy injections stored several receipts as one block, separated by blank lines.
function tavernWritingReceiptSections(text) {
    const headings = [...text.matchAll(/(^|\r?\n\r?\n)【(世界书|写作指引|写作 Skill|剧情记忆|当前变量)(?: · [^】\r\n]+)?】(?=\r?\n|$)/g)]
    if (!headings.length) return [{ kind: '', text }]
    const sections = headings.map((heading, index) => ({
        kind: heading[2],
        text: text.slice(heading.index + heading[1].length, headings[index + 1]?.index)
    }))
    if (headings[0].index > 0) sections.unshift({ kind: '', text: text.slice(0, headings[0].index) })
    return sections
}

function tavernWithoutInjectedSkills(message) {
    if (!tavernIsWritingInjection(message) || !Array.isArray(message.content)) return message
    let changed = false
    const content = message.content.flatMap(block => {
        if (block?.type !== 'text' || typeof block.text !== 'string') return [block]
        const sections = tavernWritingReceiptSections(block.text)
        const kept = sections.filter(({ kind }) => kind !== '写作指引' && kind !== '写作 Skill')
        if (kept.length === sections.length) return [block]
        changed = true
        const text = kept.map(section => section.text).join('\n\n')
        return text.trim() ? [{ ...block, text }] : []
    })
    if (!changed) return message
    return content.length ? { ...message, content } : null
}

if (typeof window === 'undefined') {
    module.exports = { tavernIsWritingInjection, tavernWritingReceiptSections, tavernWithoutInjectedSkills }
}
