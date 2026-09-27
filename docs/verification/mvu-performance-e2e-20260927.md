# MVU 性能改造专项 E2E 验收

后续状态：本页记录的两项 Helper 问题已修复，原始失败记录保留；修复与复测见文末。

日期：2026-09-27。产品基线 `928f3f13`，DSH `0.1.5-rc.2`，macOS / Playwright Chromium。全部使用隔离临时 Profile、测试卡和固定模型输出；没有修改真实游戏或调用付费模型。本次只增加测试与报告，没有修改产品实现。

## 改造记录与风险对应

主要记录是 [MVU 增量结算改造](../research/mvu-incremental-settlement-20260927.md)，截至第 47 轮。Git 时间显示主体提交在 9 月 27 日凌晨 01:20–06:27，是本次所说“昨天”工作的后半段。

| 提交/改造 | 本次验收风险 |
| --- | --- |
| `197c207f`、`c2ae0c4a`：增量结算、局部草稿、原子提交 | 变量、回执、正文一致；取消后的迟到提交 |
| `3834b3e6`：索引化存储、异步快照 | 独立读档、刷新、服务重启 |
| `4fad713b`：增量刷新传入 Helper | 第二页面冷加载和实时变量更新 |
| `cec8c32c` 至 `daba5ff2`：回执、正文、历史窗口、映射定点更新 | 重生成、编辑、回退、撤销回退、重新结算 |
| `5d0077be`：事务外 message/chat/script 写入目标切片 | 历史楼与末楼分别写入、作用域隔离、重启后继续写入 |

## 完整产品 E2E

真实 DSH → Remote → 浏览器 → 官方 MVU → Journal；只有模型输出固定。通过 UI 发起结算，独立读取存档并核对 iframe 状态栏。

| 命令 | 结果 | 主要覆盖 | 本地证据目录 |
| --- | --- | --- | --- |
| `node tests/e2e/gameplay.mjs` | 通过，45.4 秒 | 正常结算、候选、重生成、编辑、回退/撤销、Guide、重新结算、导出、三次预设切换、刷新 | `output/e2e-gameplay/run-9VpUyM` |
| `node tests/e2e/gameplay.mjs --background-lifecycle` | 通过，26.8 秒 | 两次取消、迟到工具输出被拦截、换新后台会话重试、服务重启 | `output/e2e-gameplay/run-VQybAw` |
| `node tests/e2e/gameplay.mjs --card-variables` | 通过，27.2 秒 | 新增/删除变量、保留旧值、历史结构更新、再次结算、回退/撤销和刷新 | `output/e2e-gameplay/run-C7h6XA` |
| `node tests/e2e/gameplay.mjs --mvu-incremental` | 失败，发现下列两项问题 | 新增真实 Helper API、双页面、重启专项 | `output/e2e-gameplay/run-iigGwI` |

新专项中的历史楼金币 3、末楼金币 13、chat 变量 17、script 变量 23 均落盘；服务重启后值仍保留，正文不变，末楼回执仍为 updated。官方 MVU 重新结算至 40 时第二页面实时同步成功。失败不是变量未保存，而是以下读取/通知问题。

### 1. Helper 直接写入后第二页面没有实时更新

三次隔离运行均复现（另两次目录为 `run-ww1apo`、`run-uvp9CZ`）。步骤：第一页面将末楼金币改为 11 → 第二页面冷加载显示 11 → 第一页面通过 `updateVariablesWith` 改为 12。

- 独立读档：12；第一页面：12。
- 第二页面状态栏：11；该 iframe 的 `getVariables`：11。
- 首次等待 30 秒仍未更新；后续用例等待 10 秒后采证。
- 第二页面刷新后立即显示 12。
- 随后通过正式“重新结算变量”更新到 40，两页均实时显示 40。

证据：`report.json.staleViewers`、`helper-write-stale.png`、`trace.zip`。

源码线索：`index.js` 的 `patchChat` 调用 `coordinationEvents.publish`；但 `coordination-event-publisher.js` 的去重 ID 只包含任务/活动等状态，不含 Chat 存储 revision。纯变量变化可能被相同事件 ID 吞掉，而写入页有本地失效通知。这里是与现象吻合的原因线索，尚未通过修改或旧版本 A/B 完成根因验证；不能断言由这轮性能优化引入。

### 2. 状态栏 iframe 的 script 变量写入成功，但读取作用域错误

调用 `insertOrAssignVariables({e2eCompactScript:23}, {type:'script', script_id:'e2e-compact'})` 后，磁盘 `tavernHelperScriptVariables['e2e-compact']` 正确保存 23；同一个状态栏 iframe 的 `getVariables` 却读不到该字段。写入后、重新结算前后、服务重启后均复现。chat 作用域正常，磁盘 script 值始终保留。

源码已确认：`src/client/main.js` 的状态栏 `helperShim` 中，`getVariables` 仅分支处理 chat/character/global，其余都退到 message；`localReplace` 同样缺少 script 分支。完整脚本执行器的 Helper 实现有 script 分支，两套实现不一致。该 shim 的 Git blame 指向 9 月 16 日的 `a57a68749`，是本次测试发现的既有兼容缺口，不能归因于本轮优化。

证据：`report.json.variableScopes`。JSON 数组中的 null 对应读取返回 undefined；`diskScript` 在各阶段均为 23。

## 长历史分阶段探针

复用之前保存在 `output/playwright/mvu-settlement-probe/` 的隔离探针。真实 Chromium/Chrome、官方 MVU、执行租约、Host Adapter、Background Coordinator 和 Journal；500 个嵌套变量字段/楼，固定模型提交 hp 10 → 9。它不包含完整 DSH Remote 与 React 界面，不能称为完整产品 E2E 延迟。

| 规模/状态 | 提交至目标读回 | 结算模块 | 最终提交与目标读回 |
| --- | ---: | ---: | ---: |
| 20 楼 | 611 ms | 548 ms | 59 ms |
| 400 楼 | 648 ms | 590 ms | 55 ms |
| 800 楼，初始化与结算存在重叠 | 5,690 ms | 5,605 ms | 63 ms |
| 800 楼，初始化稳定后 | 611 ms | 546 ms | 63 ms |

800 楼约 61,192,451 字节；两次有效运行均断言 hp=9、updated 回执、一次模型调用和一次目标提交。最后一轮结算领取响应约 298 KB，事务变量/消息响应各约 533 KB。初始化阶段另有约 120 MB 的完整上下文响应，耗时约 4–5 秒；该夹具未接入生产 Adapter 的全部切片能力，因此这只是夹具阶段记录，不直接认定生产初始化也有相同流量或耗时。

原始输出：`run20-e2e-audit.txt`、`run400-e2e-audit.txt`、`run800-valid-fresh.txt`、`run800-valid-repeat.txt`。每组为单次观测，800 楼两次启动时机不同；没有受控改造前后 A/B，也没有统计置信区间，不用于宣称稳定倍率或全链路 O(1)。

夹具排错：最初 800 楼输入没有 `_storageRevision:0`，触发缓存淘汰后无法重开初始 snapshot；补齐测试输入后重跑通过。另一次连续导航批处理遇到 `2 !== 1` 夹具调用计数失败，该批次不计为有效性能样本，也未作为产品缺陷。20/400 楼早期热缓存样本不能证明冷加载正确性。

## 结论与边界

核心结算、取消恢复、回退/重生成及变量结构更新 E2E 通过；新增用例明确保持失败，保留两个可复现问题，未放宽断言。客户端生成一致性、测试脚本语法检查和 diff 检查通过。

未测真实模型延迟、所有人物卡脚本、Windows/Android、跨设备网络、长历史完整产品 UI 延迟、CAS 冲突/快照维护失败的浏览器注入场景。本次没有重复整个单元测试集，也没有证明所有改造均不存在回归。

## 两项 Helper 问题修复与复测

跨页面通知根因已通过真实 Journal → candidateTasks.sync → coordination publisher 的小型回归确认：单独修改变量，任务/活动不变时只收到初始通知。修复将 Chat ID 与 `_storageRevision` 加入协调快照和事件去重 ID；复用现有轻量状态字段，不读取历史正文/变量，不发送完整 Chat。同一个存储版本仍去重，客户端沿现有增量视图读取恢复数据。

状态栏 helperShim 补上 script 作用域的读取和本地写入分支。回归确认两个脚本相互隔离、不污染 message 变量，保存失败恢复该脚本旧值。服务端写入契约未改变。

两项新增小型回归修复前均失败，修复后相关 21 项测试全部通过。原始 `node tests/e2e/gameplay.mjs --mvu-incremental` 原断言复跑通过（约 43 秒），证据位于 `output/e2e-gameplay/run-4tEjFm`：第二页面直接写入实时同步成功，正式结算至 40 同步成功；script 值 23 与 chat 值 17 在写入后、重新结算前后、重启后均能正确读回，历史楼金币 3 与末楼最终金币 13、正文和回执校验通过。

修复后的完整 `node bin/test-tavern.mjs`：2,981 项通过、10 项跳过、0 失败（约 134 秒）。客户端已重建，生成一致性与 `git diff --check` 通过。
