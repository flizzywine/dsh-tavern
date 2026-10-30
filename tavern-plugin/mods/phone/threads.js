import resolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'

const player = {id:'$player',name:'你'}
const rowsOf = characters => characters.map(row=>({...row,actorKey:row.actorKey || row.alias}))
const fail = (path,message,choices=[],next_action='Choose a listed contact or group and retry.') => {
  throw Object.assign(new Error(message),{code:'ARG_INVALID',path,handleChoices:choices.map(row=>row.value),choiceDetails:choices,next_action:next_action+' Or omit this group definition if unsuitable; keep accepted ops and sequence/through/done.'})
}
// Resolving every figure against the whole cast is quadratic; a frozen figure index (one pack revision) is read once.
const peopleOf=new WeakMap()
export function phonePeople(characters) {
  const known=peopleOf.get(characters)
  if(known)return known
  const rows=rowsOf(characters)
  const people=rows.filter(row=>row.enabled!==false && row.name?.trim()).map(row=>{
    const found=resolution.resolveFigureName(rows,row)
    return Object.freeze({id:found.actorKey,name:found.row.name})
  }).filter((row,i,all)=>row.id && all.findIndex(other=>other.id===row.id)===i)
  if(Object.isFrozen(characters))peopleOf.set(characters,Object.freeze(people))
  return people
}
export function phoneGroup(params,characters) {
  const rows=rowsOf(characters),choices=[player,...phonePeople(characters)].map(row=>({value:row.id,label:row.name}))
  if (!params.thread?.trim() || ['__proto__','constructor','prototype'].includes(params.thread)) fail('$.thread','Use a non-empty stable group id, not a reserved property.',[], 'Choose a story-specific group id and retry.')
  if (choices.some(row=>row.value===params.thread)) fail('$.thread','Group id conflicts with a direct contact.',[], 'Choose a distinct stable group id and retry.')
  if (!params.name?.trim()) fail('$.name','Group display name is empty.',[], 'Provide the group name from the story.')
  const participants=params.participants.map(value=>{
    if(value==='$player')return value
    const found=resolution.resolveFigureName(rows,value)
    if(found.status!=='resolved' || !found.row.name?.trim())fail('$.participants','Unknown or nameless group participant.',choices,'Use listed participant handles or $player and retry the group definition.')
    return found.actorKey
  })
  if(new Set(participants).size!==participants.length || participants.length<2)fail('$.participants','A group needs at least two distinct participants.',choices,'Remove duplicate identities and include the player as $player when participating.')
  return {thread:params.thread,name:params.name.trim(),participants}
}
export function applyPhoneGroup(state,params) {
  const own=state.modState?.['dsh.phone'] || {}
  return {...state,modState:{...state.modState,'dsh.phone':{...own,threads:{...own.threads,[params.thread]:{id:params.thread,name:params.name,participants:params.participants}}}}}
}
// the chat's player name resolves (same figure resolver) to the player's own persona figure
// when a pack has one; that figure is the player, never a phone contact. The phone lists only conversations with messages.
export function phoneThreadDirectory(characters,state,{playerName}={}) {
  const rows=rowsOf(characters),own=playerName?.trim() ? resolution.resolveFigureName(rows,playerName.trim(),state?.actors || {}) : null
  const playerId=own?.status==='resolved' && own.actorKey!==player.id ? own.actorKey : null
  const all=phonePeople(characters),people=all.filter(row=>row.id!==playerId),names=new Map([...all,player].map(row=>[row.id,row.name]))
  return {...(playerId?{playerId}:{}),contacts:people,threads:[...people.filter(row=>row.id!=='$player').map(row=>({id:row.id,kind:'direct',name:row.name,participants:[player,row]})),
    ...Object.values(state?.modState?.['dsh.phone']?.threads || {}).map(row=>({...row,kind:'group',participants:row.participants.map(id=>({id,name:names.get(id) || '未知联系人'}))}))]}
}
