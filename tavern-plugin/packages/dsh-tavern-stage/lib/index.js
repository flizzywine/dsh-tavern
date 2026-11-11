export const name = 'dsh-tavern-stage'
export const inject = ['tavernStageControl', 'llm']

// The package owns implementation loading and its Cordis lifetime.
// The host retains only the private migration adapters until interface extraction finishes.
export async function apply(ctx) {
  const control = ctx.get('tavernStageControl')
  ctx.effect(() => () => control.uninstall(), 'dsh-tavern-stage: disable runtime')
  await control.install(async () => {
    const {createStageRuntime} = await import('./runtime.js')
    // The host's bindings carry the host's context; every runtime phase runs on this plugin's own fiber instead, so the
    // services it calls (tavern, tools, tts, ...) see the stage as their caller and its effects end with this plugin.
    // Its settings sections stay in the dsh-tavern entry's config, where they are saved (settingsOwner).
    return {createStageRuntime:(core, factories) => createStageRuntime({...core, ctx, settingsOwner:core.ctx}, factories)}
  })
}
