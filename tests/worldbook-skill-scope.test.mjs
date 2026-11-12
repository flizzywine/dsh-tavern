import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWorldbookSkillChat } from '../tavern-plugin/lib/domain/worldbook-skill-scope.js'

test('active background lease inherits only its parent library; idle and isolated tasks cannot', async () => {
  const chat = { sessionId:'parent', mode:'story', worldbookStrategy:'native-skills' }
  let request={parentSessionId:'parent',task:'settlement'}
  const deps={background:{owns:id=>id==='worker',activeRequestContext:id=>id==='worker'?request:null},readChat:async id=>id==='parent'?chat:null}
  const agent={session:{id:'worker'}}
  for(const task of ['settlement','candidate','character-design']) {
    request.task=task
    assert.deepEqual(await resolveWorldbookSkillChat(agent,deps),{chat,authorizedSessionId:'worker'})
  }
  request.task='stage-director'; assert.equal(await resolveWorldbookSkillChat(agent,deps),null)
  request={parentSessionId:'other',task:'candidate'}; assert.equal(await resolveWorldbookSkillChat(agent,deps),null)
  request=null; assert.equal(await resolveWorldbookSkillChat(agent,deps),null)
  assert.deepEqual(await resolveWorldbookSkillChat({session:{id:'parent'}},deps),{chat,authorizedSessionId:'parent'})
  chat.worldbookStrategy='legacy'; assert.deepEqual(await resolveWorldbookSkillChat({session:{id:'parent'}},deps),{chat,authorizedSessionId:'parent'})
})
