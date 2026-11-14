import { createVoicePilot } from './fish-voice-design.js'

// Creator tools of the voice plugin: Fish voice design and batch reading trials. Loaded on first use behind creator.enabled.
// getProvider(id) returns the saved service record; resolveKey(id) its key (never sent to a client); budgetRoot is the
// host's stable plugin data directory, home of the cumulative trial budget and receipts.
export function createCreator({getProvider, resolveKey, fetch, budgetRoot}) {
  const pilot = createVoicePilot({fetch, budgetRoot})
  return {
    async run(args) {
      const provider = getProvider(args.serviceId)
      return pilot(args, provider, () => resolveKey(provider.id))
    },
  }
}
