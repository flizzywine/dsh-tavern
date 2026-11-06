# 插件开发：后台任务与任务表

后台任务由一张**任务表**统一编排，写法仿照 GitHub Actions：每个任务是一条声明，写明它在哪个成员上跑、哪个剧情时刻启动它、什么条件下运行、要等谁、下一轮要不要等它。内置任务和插件任务用同一种结构，调度、等待和「后台任务」页的展示都从这张表来。

本页先讲机制，再讲插件怎样接入。接口的完整参数见 [接口：正文、结算与任务](plugin-api-prompt.md)。

## 设计理念

核心只有一句话：**任务怎么跑，写在声明里，不写在流程代码里**。下面七条都从这句来。

1. **一张表是唯一的真相**。任务何时跑、在哪跑、等谁，全写在声明里；调度、等待、后台任务页都读这张表，不在别处另接线、另写说明。
2. **程序编排，不让模型派活**。先后顺序由声明决定，可预测、省成本、能随剧情回退。这是和对话式多 Agent（bot 之间用 @ 派活）的根本区别。
3. **成员决定分工和并发**。同一成员共用一个会话和缓存、一次跑一个任务；不同成员并行；临时 Agent 用完即弃。
4. **时刻和产出是任务之间唯一的接口**。任务只认「什么时刻」和「上游返回了什么」，不调别的任务的内部；插件之间也一样，所以互相不必知道对方怎么实现。
5. **一切跟剧情时间线走**。产出按轮存，回退到哪一轮就作废到哪一轮；Tavern 自己的写入（精修写回、编辑正文）不算新的一轮。
6. **看得见**。没开的功能显示「跳过」，失败记在任务名下；后台任务页是开发者的观察窗。
7. **内置和插件同构，接口只加不改**。插件声明的任务和内置任务是同一种结构，进同一张表、同一个页面。

![后台任务的结构：每个框对应一个文件](https://raw.githubusercontent.com/wiki/flizzywine/dsh-tavern/images/background-architecture.png)

剧情到了某个时刻，任务表按声明启动任务；任务在成员上跑完的返回值成为产出，再通过 needs 交给下游。后台任务页只读，不参与调度。

## 核心概念

| 字段 | 含义 | 对应 Actions |
|---|---|---|
| `on` | 启动它的剧情时刻（事件） | `on` |
| `needs` | 同一轮里要等哪些任务做完才跑；写了 `needs` 可以不写 `on` | `needs` |
| `if` | 过滤条件：不满足就当没发生，不记录 | `if` |
| `enabled` | 功能开关：没开就记为「跳过」，页面上灰显（内置任务用） | — |
| `member` | 在哪个成员（常驻 Agent）的会话里跑；不写就开临时 Agent | `runs-on` |
| 锁 | 同一成员的任务一次只跑一个 | `concurrency` |
| `cancelOn` | 哪些时刻要取消它（内置任务用） | `cancel-in-progress` |
| 下一轮等它 | 玩家下一轮发送前要等它做完（内置任务用） | — |
| 产出 | `run` 的返回值就是它本轮的产出，`needs` 它的任务能读到 | `outputs` |

**剧情时刻**（内置事件）：

| 事件 | 名称 |
|---|---|
| `turn-started` | 玩家发送 |
| `reply-started` | 正文开始 |
| `reply-committed` | 正文写完 |
| `turn-settled` | 本轮结算完（带 `turn`；结算结果已写进存档，要读结算后的局面就挂这里） |
| `turn-discarded` | 回合作废 |
| `story-rewound` | 剧情回退或改写（回退、重新生成、编辑正文、精修写回） |
| `task-finished` | 任务完成（带 `task`、`member`、`status`、`turn`；变量结算的这一刻结果还没写进存档，读局面请用本轮结算完） |

插件还能发出自己的事件，名字是 `插件名:事件名`。

**成员**：每局常驻的后台 Agent，各有自己的会话和缓存。内置两个：**书记**（变量结算、生成选项、记账、人物设计；会话随剧情回退）和**润色师**（正文精修）。不同成员可以同时跑。插件可以注册自己的成员。

**产出与回退**：产出按「局 + 轮」存在内存里。剧情回退到哪一轮，那一轮及之后的产出就作废，重玩那一轮时任务会重新跑。要在重启后还读得到，用 `publishOutput` 存进存档。

## 内置任务

| 任务 | 成员 | 启动 | 需要 | 下一轮等它 |
|---|---|---|---|---|
| 变量结算 | 书记（占锁） | 正文写完，由流程直接启动；重新生成后；失败后手动重试 | — | 是 |
| 生成选项 | 书记（占锁） | 点「生成候选项」；开启自动生成时回合结束后 | 变量结算 | 否 |
| 正文精修 | 润色师 | 正文写完（开启自动精修时）；点「精修」 | —（写回正文要等本轮后台任务结束） | 否 |
| 舞台导演 | 临时 Agent | 正文写完（开启对话气泡与舞台模式时）；回合作废时取消 | — | 否 |
| 手动记账 | 书记（占锁） | 在酒馆状态里发起；前台不在生成时；书记在忙时排队 | — | 否 |
| 人物设计 | 书记（占锁） | 点「设计人物」；前台不在生成时；书记在忙时排队 | — | 否 |
| 插件一次性任务 | 临时 Agent（占书记的锁） | 插件调用 `runTask`；前台不在生成时 | — | 是 |

对局标题、存档整理、插件轮次通知、选项世界书预热、台词气泡也在任务表里，但不开后台 Agent，页面上不展示。

### 任务表在代码里长什么样

每个任务只在一个地方声明：`tavern-plugin/lib/domain/background-tasks.js`，一个任务一段，所有字段写在一起。调度器、成员的锁、后台任务页都从这里读。

```js
{ key: 'polish', name: '正文精修', member: 'polish',
  does: '审读刚写完的正文并改进措辞…', reads: '刚写完的正文', writes: '本轮正文的措辞…',
  on: 'reply-committed', condition: '开启自动精修时',
  enabled: settingOn(deps, 'polishPrereview'), run: ({ gameId }) => deps.polishPrereview.start(gameId),
  manual: ['点「精修」'] },

{ key: 'candidate', name: '生成选项', member: 'background',
  manual: ['点「生成候选项」', '开启自动生成时，回合结束后自动提交'],
  needs: ['settlement'], lock: true, … },

{ key: 'plugin', name: '插件任务', …, blocksNextTurn: true, lock: true,
  wait: chat => deps.settlementRun.pluginTaskJob(chat.id) },

// 不开后台 Agent 的收尾处理，只用它的触发
{ key: 'game-title', name: '对局标题', agent: false, on: 'turn-settled', run: … }
```

| 字段 | 管什么 |
|---|---|
| `key`、`name`、`does`、`reads`、`writes` | 它是什么；`key` 就是调用运行器时的 `task` 名 |
| `member` | 在哪个成员上；不写 = 临时 Agent |
| `on`、`condition`、`enabled`、`run`、`flow` | 哪个时刻启动、开关是什么、做什么；`flow: true` = 由回复流程自己启动，只登记 |
| `manual` | 其他启动入口（玩家点按钮等） |
| `needs`、`idleForeground`、`lock` | 它等什么 |
| `blocksNextTurn`、`wait` | 谁等它，以及怎么等 |
| `cancelOn`、`cancel` | 什么时候取消 |
| `agent: false` | 不开后台 Agent 的收尾处理，不进任务目录和页面 |

`run`、`enabled`、`wait` 用到的服务（结算队列、精修、舞台…）从 `deps` 拿，`index.js` 只在一处调用 `registerBackgroundTasks(workflow, deps)` 把它们交进来。

### 新增一个内置任务

1. 在 `background-tasks.js` 里加一段，`key` 用它调用后台运行器时传的 `task` 名（`backgroundAgentRunner.run({ task: '…' })`）。
2. 用到新的服务，就把它加进 `index.js` 里 `registerBackgroundTasks` 的 deps。
3. 跑 `tests/background-tasks.test.mjs`：它会检查代码里用到的每个 `task` 名都在表里。

成员、页面、等待关系都会自动跟上，不用改别处。

## 一轮里发生什么

![一轮里的后台任务（第 25 轮实测）](https://raw.githubusercontent.com/wiki/flizzywine/dsh-tavern/images/background-turn-timeline.png)

1. **玩家发送**：先等上一轮「下一轮要等」的任务（变量结算、插件一次性任务）做完，再开始写正文。
2. **正文写完**：变量结算（书记）、自动精修审稿（润色师）、舞台导演（临时 Agent）同时启动。
3. **本轮结算完**：结算完成发出「任务完成」，接在它后面的插件任务开始跑；生成选项的 `needs` 满足。
4. **写回正文**：精修审稿要等本轮后台任务结束才写回。写回记为「剧情回退或改写」，不算新的一轮。

## 后台任务页

入口：酒馆状态 → 后台任务 → 打开。这是开发用的辅助页，数据只在内存，重启服务后清空。

| 部分 | 回答什么 | 怎么读 |
|---|---|---|
| 每轮流程 | 这一轮谁先谁后 | 按时刻从上到下；缩进的任务在上一项做完后才开始；✓ 完成 ● 运行中 … 排队 ✕ 失败 – 跳过；点任务名看定义 |
| 时序（每轮里点开） | 谁和谁同时跑、谁在排队 | 一个成员一行，竖线是剧情时刻，斜纹是排队，✕ 是被锁挡回 |
| 成员 | 谁负责什么 | 每个成员的任务和当前状态；点任务跳到定义 |
| 全部任务 | 每个任务的完整定义 | 成员、启动（带 if）、其他入口、需要、被需要、下一轮、前台、取消、做什么、读、写 |

插件声明的任务和成员会自动出现在这四部分里，名字前带「插件「xxx」」。

## 插件怎样接入

推荐用 `tavern.job()` 声明任务：它和内置任务同一种结构，会自动出现在后台任务页，出错记在你的插件名下。

| 接口 | 用途 |
|---|---|
| `tavern.member({ name, title, system, tools })` | 注册一个常驻成员：每局一个，有自己的会话和缓存，不随剧情回退。带 `system` 时它有**自己的前缀**：这段系统提示词和 `tools`（写法同 `runTask`），每个任务都相同，能命中缓存；不带时沿用 Tavern 的后台前缀（人物卡、世界书） |
| `tavern.job({ name, title, on, needs, if, member, run })` | 声明任务；`run` 的返回值就是本轮产出 |
| `tavern.runTask({ gameId, prompt, tools, member })` | 在 `run` 里调模型；带 `member` 进该成员会话排队，不带就开临时 Agent；返回 `{ text }`。成员有自己的前缀时，`prompt` 就是送给它的一张工单（需要的正文自己用 `getTurn` 取来放进去），不能再带 `tools`；没有时 Tavern 会自动附上最近两段正文 |
| `tavern.on(event, handler)` | 只观察一个时刻，不算任务（写日志、更新界面） |
| `tavern.emit(name, { gameId, data })` | 发自己的事件 `插件名:name`；data ≤ 8 KB，每局 10 秒内 ≤ 60 次 |
| `tavern.publishOutput({ gameId, turn, name, value })` / `tavern.readOutput({ gameId, turn, plugin, name })` | 把结果存进存档（≤ 64 KB），重启后也读得到；绑定到这一轮和它的正文版本 |

### `job` 的字段

- `name`：任务名，小写字母、数字、`.`、`_`、`-`；全名是 `插件名:name`。
- `on`：启动它的时刻，内置事件或别的插件的 `插件名:事件名`；可以是数组。
- `needs`：要等的别的插件任务 `插件名:任务名`。它们同一轮都做完才跑，每轮只跑一次。`on` 和 `needs` 至少写一个。
- `if(heard)`：返回假就当这次没发生；可以是 async。`condition` 用一句话写出它，显示在页面上。
- `run(heard)`：`heard` 里有 `event`、`gameId`、`turn`，以及时刻带的 `task`、`status`、`member`、`from`、`data`；由 `needs` 启动时还有 `needs['插件名:任务名']`，即那个任务的返回值。
- `member`：用 `tavern.member()` 注册过的成员名，用于页面展示；实际在哪里跑由 `runTask` 的 `member` 决定。
- `description`：一句话说它做什么。

### 选哪个

- 要在某个时刻做一件有结果的事 → `job` + `on`。
- 要用别的插件的结果 → `job` + `needs`，从 `needs[...]` 读。
- 结果要在重启后、或不在同一轮里被读 → 再用 `publishOutput`。
- 只要通知一声、不带结果 → `emit` + 对方的 `on`。

### 成员的前缀和工单

一个常驻成员 = 一份固定的**前缀**（系统提示词 + 工具 + 这局的历史），任务 = 送进去的一张**工单**（一段提示词）。前缀每个任务都一样，模型的缓存才能命中；所以成员自己的工具写在 `member()` 里，任务里不再传。模型要交结构化结果，就让它调成员的工具，工具的 `execute` 把结果存下来，`run` 再读出来返回（见下面的地图示例）。

插件的 `package.json` 必须有非空的 `version`，否则不会加载。

## 完整示例：地图 → 手机

地图插件每轮结算完，让有自己前缀的成员「测绘员」推断主角位置和信号、用工具交卷；手机插件接在它后面，没信号就打不通。代码在仓库 `examples/tavern-plugin-map` 与 `examples/tavern-plugin-phone-call`。

上游，地图：

```js
export const name = 'tavern-plugin-map'
export const inject = ['tavern']

export function apply(ctx) {
  const tavern = ctx.tavern
  const reported = new Map()   // 工具交来的结果，按局存
  // 测绘员有自己的前缀：系统提示词和交卷工具固定在成员上
  tavern.member({ name: 'surveyor', title: '测绘员',
    system: '你是地图测绘员。每次会收到一段故事正文，判断主角所在地点和手机信号强度（0–4），调用 report_location 交卷。',
    tools: [{ name: 'report_location', description: '报告主角的位置和手机信号',
      parameters: { type: 'object', properties: { gameId: { type: 'string' }, place: { type: 'string' }, signal: { type: 'integer' } }, required: ['gameId', 'place', 'signal'] },
      execute: async ({ gameId, place, signal }) => { reported.set(gameId, { place, signal: Number(signal) || 0 }); return { ok: true } } }] })
  // 本轮结算完再动手：结算结果已写进存档
  tavern.job({ name: 'locate', title: '定位', member: 'surveyor', on: 'turn-settled',
    if: ({ turn }) => Boolean(turn),
    run: async ({ gameId, turn }) => {
      const latest = await tavern.getTurn({ gameId, turn })
      reported.delete(gameId)
      await tavern.runTask({ gameId, member: 'surveyor', prompt: '本局 gameId：' + gameId + '\n\n【本轮正文】\n' + latest.text })
      return reported.get(gameId)   // 本轮产出
    } })
}
```

下游，手机：

```js
export const name = 'tavern-plugin-phone-call'
export const inject = ['tavern']

export function apply(ctx) {
  const tavern = ctx.tavern
  tavern.job({ name: 'call', title: '来电', needs: 'tavern-plugin-map:locate',
    run: async ({ turn, needs }) => {
      const { place, signal } = needs['tavern-plugin-map:locate']
      console.info(signal === 0 ? '第 ' + turn + ' 轮：在「' + place + '」打不通' : '第 ' + turn + ' 轮：接到一通电话')
    } })
}
```

手机插件不用知道地图怎么算，只认任务名和产出的形状；地图没装时它从不运行。在后台任务页上，「定位」缩进挂在「变量结算」下，「来电」又挂在「定位」下。

## 代码在哪

路径都相对仓库根目录，`lib/` 指 `tavern-plugin/lib/`。

| 概念 | 文件 | 对应测试 |
|---|---|---|
| 任务表本身：每个任务的全部声明，以及页面文字 | `lib/domain/background-tasks.js` | `tests/background-tasks.test.mjs` |
| 调度器（on、needs、if、enabled、产出、运行记录、等待） | `lib/domain/workflow.js` | `tests/workflow.test.mjs` |
| 把服务交给任务表（`registerBackgroundTasks`，`// 任务表` 一节） | `lib/index.js` | — |
| 剧情时刻（事件表、自定义事件） | `lib/domain/story-events.js` | `tests/story-events.test.mjs` |
| 成员（书记、润色师、插件成员；任务归哪个成员由任务表的 member 定） | `lib/domain/background-members.js` | — |
| 后台 Agent 运行器（常驻会话、排队、任务完成事件） | `lib/background-agent-sessions.js` | — |
| 成员的锁 | `lib/domain/background-task-coordinator.js` | `tests/background-task-coordinator.test.mjs` |
| 下一轮开始前的等待、正文写完的宣告 | `lib/domain/foreground-handoff.js` | `tests/foreground-handoff.test.mjs` |
| Tavern 自己写入时开的编辑回合（不算玩家发送） | `lib/domain/session-events.js`、`lib/hooks/turn-lifecycle.js` | `tests/surface-edit-turn.test.mjs` |
| 每轮流程的组装 | `lib/domain/background-run-tree.js` | `tests/background-run-tree.test.mjs` |
| 页面取数（`getBackgroundRuns`） | `lib/rpc/play.js` | — |
| 后台任务页 | `tavern-plugin/src/client/modules/background-wait.js`（改完要跑 `node bin/build-tavern-client.mjs`） | `tests/background-wait-browser.test.mjs` |
| 插件接口（`job`、`member`、`on`、`emit`、`publishOutput`） | `lib/plugin-api.js` | `tests/plugin-api.test.mjs` |
| 示例插件 | `examples/tavern-plugin-map`、`examples/tavern-plugin-phone-call` | — |
| 插件设计文档 | `docs/plugin-design.md` 第 6 节 | — |

## 限制与暂缓的设计

- 任务产出和后台任务页的记录都只在内存里，重启服务后清空；要长久保存用 `publishOutput`。
- `needs` 只能写插件任务，还不能直接写内置任务；要接在变量结算后面，用 `on: 'turn-settled'`（见上面的示例）。
- 变量结算只在表里登记，仍由回复流程直接启动；插件可以用 `replaceSettlement` 替换结算本身。
- 精修写回和手动改正文都算「剧情回退或改写」，不再触发「正文写完」；手动改过的正文不会自动精修。
- 暂缓：并发上限、低优先级可打断的任务、统一的上下文组装、动态成员（如每个 NPC 一个成员）。
