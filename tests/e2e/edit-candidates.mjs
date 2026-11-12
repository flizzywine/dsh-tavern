import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Issue #394: after a body edit, what do the background settlement and the
// candidate request actually receive? Plays three rounds, edits the last body,
// generates candidates, and writes every background request after the edit.
export async function editCandidatesChecks({ page, step, savedChat, output, report }) {
  const composer = () => page.getByRole('textbox', { name: /发消息|Message/ })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const settled = () => page.getByText('后台结算已完成').last().waitFor({ timeout: 60000 }).catch(() => {})
  const storyRounds = chat => chat.messages.filter(row => row.role === 'assistant' && !row.greeting).length
  const dumpFile = join(output, 'background-requests.jsonl')
  const dump = async () => (await readFile(dumpFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  async function send(text) {
    const before = storyRounds(await savedChat())
    await composer().fill(text); await composer().press('Enter')
    for (let i = 0; i < 120 && storyRounds(await savedChat()) <= before; i++) await pause(500)
    await settled()
  }
  const textOf = message => typeof message.content === 'string' ? message.content
    : (message.content || []).map(block => block.type === 'text' ? block.text : block.type === 'tool-call' ? '[tool-call ' + block.name + ' ' + (typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments)) + ']' : block.type === 'tool-result' ? '[tool-result]' : '').join('')
  report.editCandidates = {}
  let beforeEdit = 0
  await step('玩三轮', async () => {
    await send('E2E_R1 领取任务奖励')
    await send('E2E_R2 再次领取奖励')
    await send('E2E_R3 第三次领取奖励')
    for (let i = 0; i < 40 && (await savedChat()).settleStatus !== 'done'; i++) await pause(500)
    beforeEdit = (await dump()).length
    report.editCandidates.beforeEdit = { requests: beforeEdit, posture: (await savedChat()).posture }
  })
  await step('改最后一轮正文', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑正文', exact: true }).click()
    await page.getByRole('textbox', { name: /正文文本 1/ }).fill('E2E_394_EDITED 你把奖励放进了背包，走到窗边坐下。')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    for (let i = 0; i < 40 && !/E2E_394_EDITED/.test((await savedChat()).messages.at(-1).text); i++) await pause(500)
    await pause(3000)
    const chat = await savedChat()
    report.editCandidates.afterEdit = { posture: chat.posture, settleStatus: chat.settleStatus, requests: (await dump()).length - beforeEdit }
  })
  await step('生成候选项', async () => {
    await page.getByRole('button', { name: '生成候选项', exact: true }).click()
    await page.getByText('5 个', { exact: true }).waitFor({ timeout: 60000 })
    await pause(1000)
    const chat = await savedChat()
    const requests = (await dump()).slice(beforeEdit)
    report.editCandidates.afterCandidates = { posture: chat.posture, settleStatus: chat.settleStatus }
    report.editCandidates.requests = requests.map(request => ({
      tools: request.tools,
      messageCount: request.messages.length,
      sawEdited: JSON.stringify(request.messages).includes('E2E_394_EDITED'),
      sawRounds: ['E2E_R1', 'E2E_R2', 'E2E_R3'].filter(marker => JSON.stringify(request.messages).includes(marker)),
      systemHasPosture: /现场 · 主要人物状态/.test(JSON.stringify(request.system || '')),
      tail: request.messages.slice(-3).map(message => ({ role: message.role, text: textOf(message).slice(0, 600) }))
    }))
    await writeFile(join(output, 'edit-candidates-requests.json'), JSON.stringify(requests, null, 2))
    const candidate = report.editCandidates.requests.findLast(request => request.tools.includes('candidate_submit_choices') && JSON.stringify(request.tail).includes('任务类型：候选生成'))
    if (!candidate?.sawEdited) throw new Error('改正文后的候选请求必须带上改过的正文（#394）')
  })
}
