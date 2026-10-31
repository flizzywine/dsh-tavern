export const name = 'dsh-tavern-stage'
export const inject = ['tavernStageControl']

// The independent Cordis lifetime owns activation. Runtime implementation migration
// follows this entry; no private core objects are exposed through the control service.
export async function apply(ctx) {
  const control = ctx.get('tavernStageControl')
  ctx.effect(() => () => control.disable(), 'dsh-tavern-stage: disable runtime')
  await control.enable()
}
