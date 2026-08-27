# Tavern Chat JSON 增量持久化改造方案

## 结论

Tavern 继续使用 JSON，不引入 SQLite，也不把存储改造成完整的事件溯源系统。

本次改造只解决一个问题：**候选、后台结算和正文处理的每个阶段都在重写整份 Tavern Chat JSON**。

目标形态是：

```text
低频不可变 snapshot + 高频 append-only JSONL journal
```

现有 `readChat`、`writeChat`、`updateChat` 调用方式尽量保留。增量计算、日志重放和 snapshot 轮换集中在 Chat Persistence module 内，调用方仍然读写普通 Chat 对象。

## 为什么要改

当前一条实机 Chat 只有 5 条消息和 2 个 checkpoint，文件已经达到约 808 KB：

| 内容 | 体积 |
| --- | ---: |
| 整份 Chat | 808 KB |
| `timeline` | 556 KB |
| `timeline.operations` | 279 KB |
| `timeline.checkpoints` | 277 KB |
| `messages` | 155 KB |

一次候选生成会经历 mailbox queued、running、generating、Story Timeline begin、候选提交和 mailbox completed 等阶段。每个阶段只改变少量字段，却会重新序列化并替换整份 Chat。

Windows 文件占用只是让问题暴露出来；根因是写入粒度等于完整 Chat。

## 范围

本方案包含：

1. Chat snapshot 与 JSONL journal 的存储格式；
2. 完整 Chat 到增量 mutation 的计算与重放；
3. journal 的低频 snapshot 轮换；
4. checkpoint 从完整 `before` 副本改为 revision cursor；
5. 旧 Chat JSON 的惰性迁移；
6. 面向调试的 mutation 来源和 revision 信息。

## 非目标

本方案明确不解决：

- 断电时绝对不丢最后一次写入；
- 多个 Tavern Plugin Host 同时写同一 Profile；
- 跨机器共享同一 Chat；
- 加密、校验和或防篡改；
- 通用数据库查询；
- 把所有调用方改造成领域事件生产者；
- 无限期压缩磁盘占用；
- 替换 DSH 自己的 Session 持久化。

如果最后一条 JSONL 在进程异常退出时不完整，启动时记录警告并忽略该行以及其后的内容即可。娱乐型本地项目接受丢失最后一次未完成 mutation，不为此增加事务协议。

## 目标文件结构

每条 Chat 使用独立目录：

```text
profile-data/tavern/data/chats/
└─ <chat-id>/
   ├─ snapshots/
   │  ├─ 000000000000.json
   │  └─ 000000000200.json
   └─ journals/
      ├─ 000000000001-000000000200.jsonl
      └─ 000000000201-open.jsonl
```

- snapshot 是某个 storage revision 的完整 Chat，写成后不再修改；
- sealed journal 是已经轮换的只读历史；
- `*-open.jsonl` 是当前追加文件；
- 文件名中的 revision 固定宽度，目录排序就是时间顺序；
- 旧的 `chats/<chat-id>.json` 只作为迁移来源和只读备份。

不增加 `current.json` 指针。读取时从文件名选择最新 snapshot 和其后的 journal，避免为了维护一个小指针又引入替换时序。

## Journal 记录格式

每次 `writeChat` 或 `updateChat` 产生一行 mutation frame：

```json
{"schemaVersion":1,"chatId":"chat-123","baseRevision":41,"revision":42,"timestamp":1787810400000,"source":"candidate.commit","requestId":"candidate-abc","changes":[{"op":"set","path":["candidates"],"value":{"items":["向左走","敲门"]}},{"op":"set","path":["timeline","operations","operation-9","status"],"value":"completed"}]}
```

支持三种 change：

```text
set     设置或替换一个路径的值
delete  删除一个对象字段
splice  在数组中追加、截断或替换连续区间
```

约束：

- 一次 Chat 写入只追加一行；
- 同一行可以包含多个 change；
- `baseRevision` 必须等于当前已物化 revision；
- `revision` 每次加一；
- path 使用数组，不使用容易转义出错的字符串表达式；
- JSONL 使用单行紧凑 JSON，便于文本搜索和逐行解析；
- `source`、`requestId`、`operationId` 仅用于调试，不决定领域正确性。

## 增量计算

Chat Persistence 保留上一次物化 Chat，并对 `before` 与 `desired` 做递归比较：

### 对象

- 新字段生成 `set`；
- 删除字段生成 `delete`；
- 两边都存在的字段继续递归。

### 数组

- 只在尾部新增时生成一次 `splice` append；
- 只缩短尾部时生成一次 `splice` truncate；
- 长度相同时逐项递归，允许只修改最后一条消息的某个字段；
- 中间插入或大范围替换时生成局部 `splice`；
- 无法可靠缩小时允许对该数组生成 `set`，但不能退化成设置整个 Chat root。

### 原始值

- 值不同就生成 `set`；
- 值相同不记录。

第一版不追求最短 diff。优先保证 mutation 可读、重放结果正确，并确保候选状态变化不会携带完整 `messages` 或完整 `timeline`。

## 写入流程

```text
调用 writeChat(desired)
  → 取得当前物化 Chat 与 storage revision
  → 计算 changes
  → changes 为空则直接返回
  → 追加一行 mutation frame
  → 更新内存中的物化 Chat 与 revision
  → 达到轮换阈值时异步准备新 snapshot
```

保留现有进程内按 Chat 排队的 mutation 机制，不新增跨进程 lease 或复杂写锁。运行约束仍是正常情况下一个 Tavern Plugin Host 写一个 Profile。

如果 append 失败：

- 本次 `writeChat` 抛出明确错误；
- 不伪装成保存成功；
- 不创建 pending mutation 协议；
- 调用方可以沿用现在的候选“已经生成，但保存失败”阶段错误。

## 读取流程

```text
选择 revision 最大的 snapshot
  → 读取并 normalize
  → 按 revision 顺序读取后续 sealed/open journal
  → 逐行应用 changes
  → 返回普通 Chat 对象
```

读取规则：

- revision 不连续时停止并记录具体文件、行号、期望 revision 和实际 revision；
- JSONL 行无法解析时停止读取该行及后续行，保留此前成功结果；
- change path 无法应用时明确报错，不静默跳过；
- normalize 只在 snapshot 读取后和最终物化后运行，不能把 normalize 产生的默认值写回 journal；
- 开发日志输出 snapshot revision、重放帧数、耗时和最后 revision。

## Snapshot 轮换

建议第一版使用两个简单阈值，任一满足就轮换：

- open journal 达到 200 条 mutation frame；或
- open journal 达到 1 MB。

轮换过程：

1. 把当前物化 Chat 写成新的、带 revision 文件名的 snapshot；
2. 把 open journal 改名为带起止 revision 的 sealed journal；
3. 下一次写入创建新的 open journal。

snapshot 仍可复用现有 durable file promotion 的临时写入方式，但目标文件是新的 revision 文件，不替换旧 snapshot。

为了调试和回退，第一版不自动删除旧 snapshot 与 sealed journal。删除 Chat 时统一删除整个 Chat 目录。后续只有在实际出现磁盘压力时，才增加明确的手动清理能力。

## Checkpoint 改造

仅仅引入 journal 还不够。当前 Story Timeline 会把完整 `before`：

1. 保存进 running body operation；
2. 正文提交后再复制进 checkpoint。

这会让 journal 本身快速膨胀。因此 snapshot journal 与 revision cursor 必须一起发布。

### 新表示

```json
{
  "id": "checkpoint-123",
  "turn": 18,
  "beforeRevision": 417,
  "committedAt": 1787810400000
}
```

body operation 同样只保存 `beforeRevision`，checkpoint 直接复用该 revision，不再复制 `before`。

### 回退

```text
读取 checkpoint.beforeRevision
  → 从最近的不晚于该 revision 的 snapshot 开始重放
  → 得到当时完整 Chat
  → 恢复 Story Timeline 允许回退的字段
  → 保留当前 operation 审计信息并取消 running operation
  → 创建新 branch 和更大的 revision
  → 追加一条 rollback mutation frame
```

Story Timeline 的领域规则不变：

- revision 只增不减；
- 回退创建新 branch；
- 迟到候选与 settlement 仍因 basedOn 不一致而作废；
- DSH Session Surface 仍按 ADR-0003 回退或重建；
- Background Activity 仍然只是 Projection。

“完整 checkpoint”改为“能够从 snapshot + journal 完整重建”，不再表示内嵌一份完整 Chat clone。

## 旧数据迁移

采用惰性、单 Chat 迁移，避免安装或启动时扫描所有历史对话。

### 读取旧 Chat

如果 `chats/<chat-id>/` 不存在，但 `chats/<chat-id>.json` 存在：

- 继续按旧格式读取；
- 暂时不改磁盘。

### 第一次写入旧 Chat

1. 读取并 normalize 旧 JSON；
2. 把它写成 revision 0 snapshot；
3. 创建第一条 journal mutation；
4. 目录格式开始成为当前读取来源；
5. 原 `<chat-id>.json` 改名为带时间戳的 `.legacy-backup.json`，不再参与读取。

如果迁移中途失败，保留原 JSON，下次写入重新尝试。这里不增加双写，也不要求一次迁移整个 Profile。

## 调试性设计

每条 mutation frame 应尽量携带来源：

```text
foreground.prepare
foreground.commit
candidate.mailbox.queued
candidate.begin
candidate.commit
candidate.mailbox.completed
settlement.begin
settlement.commit
compaction.prepare
compaction.complete
rollback
```

第一阶段允许未改造的调用点使用 `unknown`。候选、settlement、正文和 compaction 等高价值路径应逐步补齐来源。

排查时可以直接回答：

- 哪一个阶段修改了 Chat；
- 修改基于哪个 revision；
- 实际改了哪些字段；
- 某个候选是模型失败还是保存失败；
- 回退前后 branch/revision 如何变化；
- 当前 Chat 是由哪个 snapshot 和多少条 mutation 重放得到。

## Module seam

外部尽量保留当前 Chat Persistence interface：

```text
read(chatId)
write(chat)
update(chatId, mutation)
remove(chatId)
```

为 Story Timeline rollback 增加按 storage revision 物化历史 Chat 的能力。该能力只提供给回退编排，不向普通候选、settlement 或界面调用点暴露。

Profile Data adapter 继续负责普通资源 JSON；Chat snapshot/journal 的目录、追加和重放细节全部隐藏在 Chat Persistence implementation 内。

删除这个 module 会迫使 snapshot 选择、journal 重放、diff、revision、迁移和轮换规则重新散回所有调用点，因此该 seam 具有足够 depth。

## 实施顺序

### 阶段 1：JSON mutation engine

- 实现递归 diff；
- 实现 `set`、`delete`、`splice` 重放；
- 增加 round-trip 测试；
- 覆盖消息 append、最后消息修改、operation 状态修改和 checkpoint 截断。

### 阶段 2：Snapshot Journal Store

- 实现目录发现和 revision 排序；
- 实现 snapshot + journal 物化；
- 实现 journal append；
- 实现阈值轮换；
- 实现旧 JSON 惰性迁移。

### 阶段 3：接入 Chat Persistence

- 保留现有 interface；
- 用 journal append 替代 Profile Data 的整 Chat `updateJson`；
- 保留现有 optimistic conflict 错误语义；
- 给关键调用链增加 mutation source；
- 确认候选的各阶段不再改变 snapshot 文件时间。

### 阶段 4：Checkpoint cursor

- body operation 保存 `beforeRevision`；
- checkpoint 复用该 revision；
- rollback 按 revision 物化历史 Chat；
- 删除新的完整 `before` 写入；
- 保留旧 checkpoint 的兼容读取与首次转换。

### 阶段 5：实机验证

- 使用现有 Windows Chat 做惰性迁移；
- 连续完成正文、settlement、候选和候选选择；
- 执行回退、重新生成和压缩；
- 检查 snapshot 写入频率和 journal 内容；
- 模拟最后一行 JSONL 截断并验证可诊断降级。

## 测试要求

### Mutation engine

- 任意受支持 Chat 变化都满足 `apply(before, diff(before, after)) = after`；
- 相同对象不产生 frame；
- 数组尾部 append 不携带已有元素；
- 修改最后一条消息不携带完整 messages；
- operation 状态变化不携带完整 timeline。

### Store

- snapshot + 多条 journal 重放等于预期 Chat；
- 重新创建 Store 后结果一致；
- journal revision 缺口可定位；
- 损坏尾行不会破坏此前 revision；
- 达到阈值后创建新 snapshot 并继续追加；
- 删除 Chat 会清理目录和 legacy backup。

### Story Timeline

- body begin 不再保存完整 `before`；
- checkpoint 只保存 `beforeRevision`；
- 连续回退仍创建新 branch 和更大 revision；
- settlement/candidate 迟到结果仍为 stale；
- compact 后回退仍遵守 ADR-0003。

### 回归

- 候选生成与保存；
- 后台 settlement；
- 前台与后台联合压缩；
- 正文重新生成；
- 世界书 Projection；
- 资源重命名对 Chat 引用的更新；
- Session 与 Chat 映射；
- Chat 删除。

## 验收标准

改造完成需要同时满足：

1. 候选生成的 queued、running、generating、completed 阶段不会重写完整 snapshot；
2. settlement begin/complete 不会重写完整 snapshot；
3. 普通正文提交只追加 mutation frame；
4. mutation frame 不包含未变化的 `messages`、checkpoint 或 operation；
5. 新 checkpoint 不再包含完整 `before`；
6. 旧 Chat 首次写入后能够从新目录格式重新加载；
7. 回退和重新生成结果与当前 Story Timeline 语义一致；
8. snapshot 只在初始化或达到轮换阈值时生成；
9. 日志能够显示每次写入来源、base revision、revision 和 changes；
10. 现有 Windows pending snapshot 修复保留给其他完整 JSON 资源，不作为 Chat 热写路径。

## 风险与控制

### Generic diff 实现错误

这是本方案最大的新增风险。通过独立 mutation engine、round-trip 测试和真实 Chat fixture 控制。第一版宁可对一个局部数组使用较大的 `set`，也不能生成无法正确重放的短 diff。

### Journal 读取随时间增长

通过 200 frame / 1 MB snapshot 阈值控制当前启动重放长度。历史 sealed journal 保留给回退和调试，普通读取只使用最新 snapshot 之后的记录。

### 旧 checkpoint 兼容

旧 checkpoint 继续识别内嵌 `before`；新正文只产生 `beforeRevision`。旧 checkpoint 被实际回退或下次 snapshot 轮换后可以转换，但不做全量启动迁移。

### Snapshot 与 journal 轮换中断

本项目接受最后一次 mutation 丢失，但不能静默返回结构损坏的 Chat。读取器必须明确记录选择了哪个 snapshot、忽略了哪个不完整 journal，并允许用户直接查看文件修复。

## 最终取舍

本方案刻意选择：

- JSON 可读性优先于数据库查询能力；
- 渐进接入优先于重写所有调用方；
- 可诊断失败优先于复杂的无损恢复；
- 低频完整 snapshot 优先于永不写大文件；
- revision cursor 优先于重复保存完整 checkpoint；
- 保留历史文件优先于自动清理磁盘。

它不试图成为数据库，只把“每次改一点却重写全部”改成“平时追加变化，偶尔保存全貌”。
