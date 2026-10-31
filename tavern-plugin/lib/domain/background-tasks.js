// 任务表: every background task Tavern runs, each declared once, like a job in a GitHub
// Actions workflow. One entry says what the task is (name, does, reads, writes), where it
// runs (`member`: a resident member of background-members.js; none = a fresh Agent), what
// starts it (`on`, `enabled`, `condition`, `flow`; `manual` for the player's or a flow's own
// starts), what it waits for (`needs`, `idleForeground`, `lock`), what waits for it
// (`blocksNextTurn`, `wait`), what stops it (`cancelOn`, `cancel`) and what it does (`run`).
// The scheduler (workflow.js), the 后台任务 page and the members' slots all read this table;
// a new task is added here and nowhere else.
//
// `run`, `enabled`, `cancel` and `wait` take Tavern's services through `deps` (index.js hands
// them over once, registerBackgroundTasks); the rest is plain data.
// `agent: false`: upkeep a moment starts that runs no background Agent (对局标题, 存档整理…):
// in the table for its trigger, left out of the task catalog and the page.
// `key` is the runner's `task` name (backgroundAgentRunner.run({ task })); entries without an
// Agent use it as their id only.

const settingOn = (deps, name) => async () => (await deps.readTavernSettings())[name] === true

function definitions(deps) {
  return [
    { key: 'settlement', name: '变量结算', member: 'background',
      does: '按本轮正文更新变量（MVU 状态栏）和人物姿势；开启后台人物设计时，顺带为新出场的人物写档案。',
      reads: '本轮正文、上一轮变量', writes: '本轮回复上的变量（MVU）、人物姿势、结算状态',
      // The reply and regeneration flows queue it themselves, since they wait for its outcome
      // (and skip it while a regeneration's temporary turn is open): declared, not run here.
      on: 'reply-committed', flow: true, condition: '有待结算的回复时',
      manual: ['重新生成正文后（流程启动）', '失败后在酒馆状态里点重试'],
      blocksNextTurn: true, lock: true,
      // The settlement its timeline says is due runs now (or is joined), then whatever
      // settlement job is still running ends.
      wait: async chat => {
        const activity = deps.backgroundTasks.activity(chat)
        if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) await deps.queueSettlement(chat.id)
        await deps.settlementJobs.pending(chat.id)
      } },
    { key: 'candidate', name: '生成选项', member: 'background',
      does: '为下一轮生成几条可选的行动或对白。',
      reads: '结算后的变量、最近剧情', writes: '候选项（对应当前这条回复）',
      manual: ['点「生成候选项」', '开启自动生成时，回合结束后自动提交'],
      needs: ['settlement'], lock: true },
    // The review reads the reply as written; settlement never waits for it. One start: a
    // regenerated reply is 正文写完 again, and starting twice for the same text is a no-op.
    { key: 'polish', name: '正文精修', member: 'polish',
      does: '审读刚写完的正文并改进措辞；开启自动精修时，本轮结算完成后直接写回正文（不改剧情事实，不让结算和选项失效）。',
      reads: '刚写完的正文', writes: '本轮正文的措辞（自动精修）与精修对比记录',
      on: 'reply-committed', condition: '开启自动精修时',
      enabled: settingOn(deps, 'polishPrereview'), run: ({ gameId }) => deps.polishPrereview.start(gameId),
      manual: ['点「精修」'], note: '审稿不等其他任务；写回正文要等本轮结算等后台任务结束' },
    { key: 'ledger', name: '手动记账', member: 'background',
      does: '按玩家要求整理变量台账，修正结算遗漏或错误的数值。',
      reads: '变量与剧情历史', writes: '台账；下一轮正文读一次',
      manual: ['在酒馆状态里发起'], idleForeground: true, lock: true },
    { key: 'character-design', name: '人物设计', member: 'background',
      does: '为指定人物写人物档案，发布到这局的人物世界书。',
      reads: '人物世界书、最近剧情', writes: '人物档案、人物世界书；下一轮开始前同步进前台',
      manual: ['点「设计人物」'], idleForeground: true, lock: true },
    { key: 'plugin', name: '插件任务',
      does: '插件发起的一次性后台任务，提示词和工具由插件提供。',
      reads: '插件给的提示词与工具', writes: '插件数据（按回合）、插件变量',
      manual: ['插件调用 runTask'], idleForeground: true, blocksNextTurn: true, lock: true,
      // A plugin task of the last turn (or one the player started) runs to its end.
      wait: chat => deps.settlementRun.pluginTaskJob(chat.id) },

    // Upkeep: no background Agent.
    // Its dialogue bubbles came with the text; plugins read them with the settled turn.
    { key: 'cast-bubbles', name: '台词气泡', agent: false, on: 'turn-settled', condition: '开启对话气泡时',
      run: ({ gameId }) => deps.announceCast(gameId) },
    { key: 'game-title', name: '对局标题', agent: false, on: 'turn-settled',
      run: ({ gameId, latest }) => deps.gameTitles.afterTurn(gameId, latest.cardName) },
    { key: 'save-maintenance', name: '存档整理', agent: false, on: 'turn-settled',
      run: ({ chatId, latest }) => { deps.saveMaintenance.noteWrite(chatId, Number(latest._storageRevision)) } },
    { key: 'plugin-turn', name: '插件轮次通知', agent: false, on: 'turn-settled', run: ({ gameId }) => deps.pluginApi.turnSettled(gameId) },
    { key: 'candidate-worldbook', name: '选项世界书预热', agent: false, on: 'turn-settled',
      run: ({ gameId }) => deps.candidateWorldbookPreparation.warm(gameId) }
  ]
}

const DESCRIPTION = ['name', 'member', 'does', 'reads', 'writes', 'manual', 'needs', 'blocksNextTurn', 'idleForeground', 'lock', 'note']

// Every kind of background Agent run, by its runner `task` name, as plain data: what it does,
// which member runs it, what it waits for. The 后台任务 page lists it and names runs from it.
// `lane`: resident (a member's Session) or ephemeral (a fresh Agent).
export const BACKGROUND_TASK_CATALOG = Object.freeze(definitions({}).filter(entry => entry.agent !== false).map(entry => {
  const item = { task: entry.key, lane: entry.member ? 'resident' : 'ephemeral', member: entry.member || '' }
  for (const field of DESCRIPTION) if (entry[field] !== undefined && field !== 'member') item[field] = entry[field]
  return Object.freeze(item)
}))

/** The member whose Session and slot a task uses, '' for a fresh Agent or an unknown task. */
export function taskMember(task) {
  return BACKGROUND_TASK_CATALOG.find(item => item.task === task)?.member || ''
}

/** Hand the table to the scheduler: each task's triggers, and how to wait for the tasks others wait on. */
export function registerBackgroundTasks(workflow, deps) {
  const stops = []
  for (const entry of definitions(deps)) {
    if (entry.on) {
      const { key, name, on, flow, condition, enabled, run, cancelOn, cancel } = entry
      stops.push(workflow.job({ id: key, name, task: entry.agent === false ? '' : key, on, flow, condition, enabled, run, cancelOn, cancel }))
    }
    if (entry.wait) stops.push(workflow.waiter(entry.key, entry.wait))
  }
  return () => { for (const stop of stops) stop() }
}

// Each task's definition as the page shows it, like a GitHub Actions job: its member, the
// moments (and tasks) that start it with their condition, its other starts, what it needs,
// what needs it, whether the next turn waits for it, what cancels it. All of it is read from
// the declarations: the catalog entry and the scheduler's jobs naming it (`task`). `trigger`
// and `waits` say the same in one line each; an entry that brings its own (a plugin's
// settlement and manual tasks) keeps them.
export function describeTasks(catalog, jobs = [], momentName = event => event) {
  const names = new Map(catalog.map(item => [item.task, item.name]))
  const nameOf = task => names.get(task) || task
  return catalog.map(item => {
    const starts = jobs.filter(job => job.task === item.task)
    const on = starts.map(job => ({ moments: job.on.map(momentName), needs: (job.needs || []).map(nameOf), condition: job.condition || '', flow: Boolean(job.flow) }))
    const manual = Array.isArray(item.manual) ? item.manual : item.manual ? [item.manual] : item.trigger && !starts.length ? [item.trigger] : []
    const needs = (item.needs || []).map(nameOf)
    const neededBy = catalog.filter(other => (other.needs || []).includes(item.task)).map(other => other.name)
    const cancelOn = starts.flatMap(job => job.cancelOn).map(momentName)
    const trigger = item.trigger || [
      ...on.map(start => [start.moments.join('、') + (start.flow ? '，由流程直接启动并等它的结果' : ''), start.needs.length ? start.needs.join('、') + '完成后' : '']
        .filter(Boolean).join('，') + (start.condition ? '（' + start.condition + '）' : '')),
      ...manual
    ].filter(Boolean).join('；')
    const waits = item.waits || [
      needs.length ? '等' + needs.join('、') + '完成' : '',
      item.idleForeground ? '前台不在生成时才能开始' : '',
      item.blocksNextTurn ? '下一轮开始前要等它' : '',
      neededBy.length ? neededBy.join('、') + '要等它完成' : '',
      cancelOn.length ? cancelOn.join('、') + '时取消' : '',
      item.note || ''
    ].filter(Boolean).join('；') || '不等其他任务'
    return { ...item, manual, trigger, waits, spec: { on, manual, needs, neededBy, cancelOn,
      blocksNextTurn: Boolean(item.blocksNextTurn), idleForeground: Boolean(item.idleForeground), lock: Boolean(item.lock), note: item.note || '' } }
  })
}
