export const name = 'dsh-tavern-stage'
export const inject = ['tavernStageControl']

// The package owns implementation loading and its Cordis lifetime.
// The host retains only the private migration adapters until interface extraction finishes.
export async function apply(ctx) {
  const control = ctx.get('tavernStageControl')
  ctx.effect(() => () => control.uninstall(), 'dsh-tavern-stage: disable runtime')
  await control.install(() => import('./runtime.js'))
}
