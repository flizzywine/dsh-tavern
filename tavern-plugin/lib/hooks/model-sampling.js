// Apply at the shared LLM boundary, including prepared calls and child agents.
export function registerModelSamplingHook(ctx) {
  ctx.on('llm/stream', (request, next) => {
    if (request.temperature === undefined && request.topP === undefined && request.top_p === undefined) return next()
    const section = ctx.get('settings')?.describe().find(item => item.ns === 'llm-pi-ai')
    const provider = section?.value?.providers?.[request.provider]
    const model = provider?.models?.find(item => item.id === request.model)
    const compat = { ...provider?.compat, ...model?.compat }
    if ((model?.api ?? provider?.api) === 'anthropic-messages' &&
        (compat.forceAdaptiveThinking === true || compat.supportsTemperature === false)) {
      // Prepared calls bind their config; re-prepare the changed request rather
      // than mutating it and violating the host's INVALID_PREPARED_CALL check.
      const { temperature, topP, top_p, ...adapted } = request
      return ctx.llm.stream(adapted)
    }
    return next()
  }, { global: true })
}
