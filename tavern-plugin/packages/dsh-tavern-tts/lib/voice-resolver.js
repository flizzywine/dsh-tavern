export function sourceProvider(voice, binding) {
  return binding.source === null ? null : voice.sources[binding.source ?? voice.defaultSource].provider
}
// A source names its own service instance. An installed compatible serviceId wins; otherwise the sole compatible
// service speaks it; several without a named one is ambiguous (undefined → SERVICE_REQUIRED).
export function chooseService(source, services) {
  const compatible = services.filter(s => s.kind === source.provider)
  return compatible.find(s => s.id === source.serviceId) ?? (compatible.length === 1 ? compatible[0] : undefined)
}
// Zero-config default: when none of the listed services can speak this source, the browser speaks it.
// A browser descriptor binds nothing, so no job is queued and nothing is cached.
export const BROWSER_SERVICE = Object.freeze({serviceId:'browser',browser:Object.freeze({voice:null}),capabilities:Object.freeze({browser:true,paid:false,billing:'free'})})
export function browserFallback(source, services) {
  return services.some(s => s.kind === source.provider) ? null : {effective:structuredClone(BROWSER_SERVICE),issues:[]}
}
// every 配音来源 can be chosen before it is set up. The chosen source then
// reports what it still lacks and stays silent; nothing falls back to another source.
export function sourceUnsetIssue(source) {
  const missing = source.kind === 'reference-list' ? !source.references.length && 'MISSING_REFERENCE'
    : source.kind === 'voice-id' ? source.voiceId === undefined && 'VOICE_NOT_FOUND'
    : source.voiceName === undefined && 'VOICE_NOT_FOUND'
  return missing ? {effective:null,issues:[{code:missing}]} : null
}
// Trusted, already validated pack data. This projection never mutates the binding.
export function resolveVoiceSpec({voice, binding, mood = 'default', emotions = [], defaults = {}}) {
  if (binding.source === null) return {effective:null,issues:[]}
  const sourceId = binding.source ?? voice.defaultSource, source = voice.sources[sourceId]
  const unset = sourceUnsetIssue(source)
  if (unset) return unset
  const selectedEmotion=voice.emotions?.[emotions.find(row=>row.id===mood)?.voiceEmotion];
  const variantId = binding.emotionVariants?.[mood] ?? binding.variant ?? 'normal'
  const params = {...defaults,...voice.variants?.normal?.tuning?.[sourceId],...voice.variants?.[variantId]?.tuning?.[sourceId],...selectedEmotion?.tuning?.[sourceId]}
  const references = source.kind === 'reference-list' ? source.references : undefined
  const kind = references ? 'reference' : source.provider
  if (source.kind === 'voice-id') params.referenceId = source.voiceId
  if (source.kind === 'preset') {
    params[source.provider === 'azure' ? 'voiceName' : source.provider === 'volcengine' ? 'speaker' : 'voice'] = source.voiceName
    if (source.model) params.model = source.model
  }
  // Emotion variants have already selected a single style/instruction. The adapter must not apply legacy maps again.
  const voiceData = {schemaVersion:1,id:'voice',enabled:true,label:voice.name,kind,languages:[binding.language || voice.language],params,
    ...(references ? {references:references.map(r => ({sha256:r.media,transcript:r.text,language:r.language}))} : {})}
  return {effective:{sourceId,provider:source.provider,variantId,language:voiceData.languages[0],voice:voiceData},issues:[]}
}
export function describeVoiceCapabilities(service) {
  return service ? {id:service.id,provider:service.kind,revision:service.revision,...structuredClone(service.capabilities)} : null
}
