import {createWorkbenchHost} from './host.js'
import {registerWorkbenchTools} from './tools.js'
import {WORKBENCH_SKILLS, WORKBENCH_TOOL_NAMES} from './schema.js'

// The stage's card-workbench management tools (asset packs, media, stage and mod settings,
// figure voices, asset generation). They show only in the card workbench, and each only after one of its
// Skills is loaded (tavern.toolModes / tavern.toolSkills). Calls go through the stage's own
// requests with its workbench authority. Returns the cleanup that ends every registration.
export function registerStageWorkbench({ctx, deps, call}) {
  const host = createWorkbenchHost({chatForSession:deps.chatForSession, readChat:deps.readChat, rpc:call,
    getLibrary:() => ctx.get('assetLibrary'), getPackSettings:() => ctx.get('assetPackSettings'), getTtsControl:() => ctx.get('ttsControl'), approval:() => ctx.get('approval'),
    cardIdentity:async cardPath => (await deps.readCardWorkspace(cardPath))?.meta.id})
  const tools = ctx.get('tools'), service = ctx.get('tavern'), cleanups = []
  if (tools && service) {
    // The stage runs inside the host's composition, so it declares under its own package name. Cordis hands every
    // method of its service proxy the caller's ctx as this, so the stage calls them with its own owner instead.
    const owner = {ctx:{fiber:{name:'dsh-tavern-stage'}}}
    registerWorkbenchTools({tools:{register:tool => cleanups.push(tools.register(tool))}, host})
    for (const name of WORKBENCH_TOOL_NAMES) {
      cleanups.push(service.toolModes.call(owner, {name, modes:['card']}))
      cleanups.push(service.toolSkills.call(owner, {name, skills:Object.keys(WORKBENCH_SKILLS).filter(skill => WORKBENCH_SKILLS[skill].includes(name))}))
    }
  }
  return async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    host.dispose()
  }
}
