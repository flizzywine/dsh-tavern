// Settlement uses the provider's default, including during its embedded
// character-design stage. Remove inherited values as well as task overrides.
export function backgroundRequestTemperature(request, input, characterDesignStage) {
  if (input.task === 'settlement') {
    const { temperature: _temperature, ...withoutTemperature } = request
    return withoutTemperature
  }
  const temperature = characterDesignStage
    ? characterDesignStage.temperature(input.temperature)
    : input.temperature
  if (typeof temperature !== 'number' || input.selection?.provider === 'openai-codex') return request
  return { ...request, temperature }
}
