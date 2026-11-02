// Provider-owned verified billing data. Unknown identifiers are never classified as free.
export const FISH_DEFAULT_MODEL = 's2.1-pro-free'
export const FISH_MODELS = Object.freeze([
  {id:'s2.1-pro-free',label:'S2.1 Pro Free',billing:'free'},
  {id:'s2.1-pro',label:'S2.1 Pro',billing:'paid'},
  // `label` names the model alone (the paid-preview dialog says it); `hint` follows it in settings.
  {id:'drama-3',label:'Drama 3',hint:'支持方括号内自然语言指示',billing:'paid',voiceDirections:true},
])
export const isFishCloud = config => (config?.url || 'https://api.fish.audio').replace(/\/+$/, '') === 'https://api.fish.audio'
export const fishModel = id => FISH_MODELS.find(model => model.id === id) || {id,label:id,billing:'unknown'}
export function fishModelId(value = FISH_DEFAULT_MODEL) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) throw new Error('Invalid Fish model identifier')
  return value
}
