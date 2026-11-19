import assert from 'node:assert/strict'
import test from 'node:test'
import { recoverRuntimeHistory } from '../tavern-plugin/lib/domain/runtime-history-recovery.js'

const chats = [{ id: 'compat', sessionId: 'compat-session', requestMode: 'sillytavern' }, { id: 'native', sessionId: 'native-session', requestMode: 'dsh' }]

test('启动恢复包含兼容与普通会话', async () => {
  const calls = []
  const recovery = []
  await recoverRuntimeHistory({ chats }, {
    recoverRegeneration: async () => {},
    readSlice: async id => ({ chat: { ...chats.find(chat => chat.id === id), bypassPlanId: 'plan' } }),
    readChat: async id => chats.find(chat => chat.id === id),
    restoreChat: async chat => { calls.push(chat.id); return false },
    syncSummary: async () => {},
    recoverHandoff: async ids => { recovery.push(['foreground', ...ids]) },
    recoverCandidates: async ids => { recovery.push(['background', ...ids]) },
    scanSettlement: () => { recovery.push(['settlement']) }
  })
  assert.deepEqual(calls, ['compat', 'native'])
  assert.deepEqual(recovery, [['foreground', 'compat', 'native'], ['background', 'compat', 'native'], ['settlement']])
})
