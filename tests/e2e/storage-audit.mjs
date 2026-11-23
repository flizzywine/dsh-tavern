import assert from 'node:assert/strict'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Where does a save's disk space go? Play many rounds through the real UI with a
// fixed model, reroll and roll back repeatedly, and measure every data folder and
// the live save's fields. Only the model output is fixed.
// Disk usage; hard-linked record packs count once.
async function folderBytes(target, seen = new Set()) {
  const info = await stat(target).catch(() => null)
  if (!info) return { bytes: 0, files: 0 }
  if (!info.isDirectory()) {
    const key = info.dev + ':' + info.ino
    if (seen.has(key)) return { bytes: 0, files: 0 }
    seen.add(key)
    return { bytes: info.blocks * 512, files: 1 }
  }
  let bytes = 0, files = 0
  for (const name of await readdir(target)) {
    const child = await folderBytes(join(target, name), seen)
    bytes += child.bytes; files += child.files
  }
  return { bytes, files }
}

const len = value => value === undefined ? 0 : JSON.stringify(value).length

export function liveSaveBreakdown(chat) {
  const fields = {}
  const add = (key, bytes) => { fields[key] = (fields[key] || 0) + bytes }
  for (const message of chat.messages || []) {
    for (const [key, value] of Object.entries(message)) {
      if (key !== 'variables') { add('message.' + key, len(value)); continue }
      for (const snapshot of Array.isArray(value) ? value : [value]) {
        if (!snapshot) continue
        add('message.variables.stat_data', len(snapshot.stat_data))
        add('message.variables.schema', len(snapshot.schema))
        add('message.variables.other', len(snapshot) - len(snapshot.stat_data) - len(snapshot.schema))
      }
    }
  }
  for (const [key, value] of Object.entries(chat)) if (key !== 'messages') add('chat.' + key, len(value))
  return Object.fromEntries(Object.entries(fields).sort((a, b) => b[1] - a[1]))
}

export async function storageAuditChecks({ page, step, savedChat, data, root, output, report }) {
  const rounds = Number(process.env.TAVERN_AUDIT_ROUNDS || 30)
  const regenEvery = Number(process.env.TAVERN_AUDIT_REGEN_EVERY || 3)
  const regenTimes = Number(process.env.TAVERN_AUDIT_REGEN_TIMES || 2)
  const rollbackEvery = Number(process.env.TAVERN_AUDIT_ROLLBACK_EVERY || 5)
  const timeout = Number(process.env.TAVERN_E2E_TIMEOUT_MS || 60000)
  let control = 0
  const audit = report.storageAudit = { rounds, regenEvery, regenTimes, rollbackEvery, actions: { send: 0, regenerate: 0, rollback: 0 }, samples: [] }
  const replies = chat => chat.messages.filter(message => message.role === 'assistant' && !message.greeting)
  // Each model call gets a fresh tool-call id so the persistent background agent always settles.
  const nextModel = gold => writeFile(join(output, 'performance-control.json'), JSON.stringify({ gold, id: 'audit-' + (++control) }))
  async function settled(count, previousId) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const chat = await savedChat().catch(() => null)
      const last = chat && replies(chat).at(-1)
      if (chat && replies(chat).length === count && !chat.regenInProgress && last?.mvu && !last.mvu.pending
        && ['updated', 'unchanged'].includes(last.mvu.receipt?.status) && last.mvu.receipt?.diagnosticId !== previousId) return chat
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    throw new Error('等待结算超时：第 ' + count + ' 轮')
  }
  const lastReceipt = async () => replies(await savedChat()).at(-1)?.mvu?.receipt?.diagnosticId
  async function send(round) {
    await nextModel(round * 10)
    const composer = page.getByRole('textbox', { name: /下一步行动|Next action|发消息|Message/ })
    await composer.fill('第' + round + '轮：继续领取任务奖励')
    await composer.press('Enter')
    await settled(round)
    audit.actions.send++
  }
  async function regenerate(round, time) {
    const before = await lastReceipt()
    await nextModel(round * 10 + time)
    await page.getByRole('button', { name: '重新生成正文', exact: true }).filter({ visible: true }).last().click()
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
    await settled(round, before)
    audit.actions.regenerate++
  }
  async function rollback(round) {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).click()
    const deadline = Date.now() + timeout
    while (replies(await savedChat()).length !== round - 1) {
      assert.ok(Date.now() < deadline, '回退超时')
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    audit.actions.rollback++
  }
  async function sample(label) {
    const folders = {}
    for (const name of await readdir(data)) folders[name] = await folderBytes(join(data, name))
    folders['../sessions'] = await folderBytes(join(root, 'profile-data/tavern/sessions'))
    const chat = await savedChat()
    const revision = Number(chat._storageRevision) || 0
    audit.samples.push({ label, revision, replies: replies(chat).length,
      folders: Object.fromEntries(Object.entries(folders).filter(([, value]) => value.bytes > 0).sort((a, b) => b[1].bytes - a[1].bytes)) })
  }
  await step('存档空间审计：' + rounds + ' 轮游玩，反复重新生成与回退', async () => {
    await sample('opening')
    for (let round = 1; round <= rounds; round++) {
      await send(round)
      if (round % regenEvery === 0) for (let time = 1; time <= regenTimes; time++) await regenerate(round, time)
      if (round % rollbackEvery === 0) { await rollback(round); await send(round) }
      if (round % 10 === 0) await sample('round-' + round)
    }
    await sample('final')
    audit.liveSave = liveSaveBreakdown(await savedChat())
    console.log(JSON.stringify({ actions: audit.actions, final: audit.samples.at(-1) }, null, 1).slice(0, 4000))
  })
}
