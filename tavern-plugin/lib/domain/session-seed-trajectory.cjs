function tavernIsLegacySeedTrajectory(message) {
    const source = message?.source
    if (source?.form === 'synthetic-trajectory') {
        return source.kind === 'plugin:dsh-tavern' || (source.kind === 'plugin' && source.plugin === 'dsh-tavern')
    }
    return source?.kind === 'model' && source.provider === 'dsh-tavern' && source.model === 'synthetic-trajectory'
        && /^tavern-seed-trajectory:v1:.+:2$/.test(message.id ?? message.messageId)
}

if (typeof window === 'undefined') module.exports = { tavernIsLegacySeedTrajectory }
