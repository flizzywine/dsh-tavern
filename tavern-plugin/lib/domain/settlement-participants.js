// Optional renderers (the stage) keep their own records of a reply in step with its settlement: they may add to the
// settlement's own commit and hear when it is saved. A participant's failure is reported and dropped; the settlement,
// its commit and the save stand as the core made them.
export function createSettlementParticipants({warn = () => {}} = {}) {
  const entries = new Map()
  const report = (owner, phase, error) => {try {warn({owner, phase, error})} catch {}}
  function each(phase, run) {
    for (const [owner, hooks] of entries) {
      if (typeof hooks[phase] !== 'function') continue
      try {run(hooks[phase], owner)} catch (error) {report(owner, phase, error)}
    }
  }
  return Object.freeze({
    register(owner, hooks) {
      if (!owner || entries.has(owner)) throw Error('Duplicate or invalid settlement participant')
      entries.set(owner, hooks)
      return () => {if (entries.get(owner) === hooks) entries.delete(owner)}
    },
    // Before the commit: each participant returns its synchronous addition to the commit's draft, or nothing.
    async capture(snapshot, target, result) {
      const additions = await Promise.all([...entries].map(([owner, hooks]) => typeof hooks.capture !== 'function' ? null
        : Promise.resolve().then(() => hooks.capture(snapshot, target, result)).then(add => typeof add === 'function' ? [owner, add] : null,
          error => {report(owner, 'capture', error);return null})))
      const ready = additions.filter(Boolean)
      return draft => {for (const [owner, add] of ready) try {add(draft)} catch (error) {report(owner, 'capture', error)}}
    },
    // After the commit; never awaited by the settlement.
    settled(snapshot, chat, target, result) {
      for (const [owner, hooks] of entries) if (typeof hooks.settled === 'function')
        void Promise.resolve().then(() => hooks.settled(snapshot, chat, target, result)).catch(error => report(owner, 'settled', error))
    },
    // Inside the core's own write: a failed settlement closed this reply's variables.
    closed(chat, messageId) {each('closed', hook => hook(chat, messageId))},
    // Inside the core's own write: this reply's variables restart from their baseline.
    retrying(message) {each('retrying', hook => hook(message))},
  })
}
