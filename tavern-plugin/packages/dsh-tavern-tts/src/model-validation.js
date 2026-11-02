// Provider listings are discovery hints, not proof that a model/voice is unavailable.
// Keep only confirmed synthesis failures for the exact configured provider/model/voice.
export function createModelValidation({limit = 256} = {}) {
  const failures = new Map()
  const key = ({serviceId,revision,model,voiceName}) => JSON.stringify([serviceId,revision,model,voiceName])
  const fields = {QWEN_MODEL_NOT_FOUND:'model',QWEN_VOICE_UNSUPPORTED:'voice'}
  return {
    record(identity, error) {
      const id = key(identity)
      if (!error) { failures.delete(id); return }
      const field = fields[error.code]
      if (!field) return
      failures.delete(id)
      failures.set(id, {code:error.code,field,model:identity.model,voiceName:identity.voiceName})
      while (failures.size > limit) failures.delete(failures.keys().next().value)
    },
    get(identity) {
      const issue = failures.get(key(identity))
      return {issues:issue ? [{...issue}] : []}
    },
    clear() { failures.clear() },
  }
}
