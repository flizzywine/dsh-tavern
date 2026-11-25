function tavernIsSkillReminder(source) {
    const kind = source?.kind
    const producer = kind === 'plugin' ? source.plugin : kind?.startsWith?.('plugin:') ? kind.slice(7) : ''
    return kind === 'skill-catalog' || kind === 'skill-invocation'
        || producer === '@deepseek-ai/dsh-tool-skill' || producer === 'dsh-tool-skill'
}

function tavernIsRuntimeReminder(source) {
    return source?.kind === 'runtime-context' || source?.kind === 'agent-instructions'
        || source?.kind === 'plugin:@deepseek-ai/dsh-system-prompt'
        || (source?.kind === 'plugin' && source.plugin === '@deepseek-ai/dsh-system-prompt')
}

function tavernStripSystemReminders(text) {
    return text.replace(/<system-reminder(?:\s[^>]*)?>[\s\S]*?(?:<\/system-reminder\s*>|$)/gi, '')
}

function tavernIsHostSystemReminder({ source, content }) {
    return !tavernIsSkillReminder(source) && (tavernIsRuntimeReminder(source)
        || content?.some(block => block?.type === 'text' && /<system-reminder(?:\s|>)/i.test(block.text)) === true)
}

if (typeof window === 'undefined') {
    module.exports = { tavernIsSkillReminder, tavernIsRuntimeReminder, tavernStripSystemReminders, tavernIsHostSystemReminder }
}
