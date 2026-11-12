// The redaction mod's director side: the redact command (a text mark, mod.json textMark) and the card's 遮挡指引.
// Nothing runs when a mark is sealed: the mark is the record itself, the views project it over the words.
export const REDACTION_KINDS = ['bar', 'glitch']
const settingsOf = settings => ({kind:settings?.values?.kind === 'glitch' ? 'glitch' : 'bar', guidance:String(settings?.values?.guidance || '').trim()})

// The card's default kind rides on the command's admission, so an admitted mark records the kind it shows (stage.js admitParams).
export function configure({manifest, settings}) {
  const {kind} = settingsOf(settings)
  return {commands:manifest.commands.map(command => ({...structuredClone(command), admission:{nonblank:['quote'], kind}}))}
}
// 遮挡指引 (the card's own guidance) replaces the general line; a blank one keeps it.
export async function prepare(_input, host) {
  const {guidance} = settingsOf(await host.settings.get({}))
  return guidance ? {sections:[{id:'redact-guidance', text:'<redaction_guidance>' + guidance.replace(/\s+/g, ' ') + '</redaction_guidance>\n'}]} : null
}
export async function command() { return null }
export function dispose() {}
