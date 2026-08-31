# ComfyUI 自托管生图协议核验（2026-09-01）

仅读取官方文档和公开源码，未安装、未读取用户配置/凭据、未提交工作流或付费任务。以下为静态协议证据和本项目建议，不是用户实例的运行验收；Comfy Cloud 不是本次协议对象。

## 版本与证据

核验时官方仓库 `master` 为 **95d755cd8107a72258d452b5d3657273d571f07d**，提交时间 2026-08-31 03:19:14 UTC。[固定提交](https://github.com/comfyanonymous/ComfyUI/commit/95d755cd8107a72258d452b5d3657273d571f07d)

官方文档将 `/prompt`、`/history/{prompt_id}`、`/queue`、`/view` 列为自托管服务路由，并指向 `server.py` 和 `execution.py`；下文细节以固定源码为准。浏览器检索缓存中的 `master` 内容与固定提交有差异，不使用移动分支的行号作为证据。[官方路由文档](https://docs.comfy.org/development/comfyui-server/comms_routes)

## 提交与校验

`POST /prompt` 使用 JSON，`prompt` 是 API 格式的节点字典（节点 ID → `class_type` / `inputs`），不是直接提交画布 UI 的 nodes/links 文件。官方示例包含 `client_id`、客户端生成的 `prompt_id`；节点输入连接用 `[nodeId, outputIndex]` 表示。[官方示例](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/script_examples/websockets_api_example.py#L13-L17)、[节点示例](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/script_examples/websockets_api_example.py#L59-L99)

- 成功为 HTTP 200 JSON：`{prompt_id, number, node_errors}`；这是已入队，不是图片完成。`number` 是排序键，可由请求指定或由服务器生成，不宜显示为可靠的“前面还有 N 人”。
- 缺少 prompt、UUID 不合法、输出校验全部失败等，返回 HTTP 400：`{error, node_errors}`；`error` 有 `type/message/details/extra_info`。
- **成功也可能有非空 node_errors**：至少一个输出分支有效就可以入队，失败分支被忽略。不能将非空 node_errors 一律解释为未提交；应明确验证产品所需输出节点是否有效，避免提交成功后自动重复提交。

[提交实现](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L1072-L1144)、[部分输出校验](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1176-L1247)

当前支持请求中的自定义 `prompt_id`；省略或 null 时服务器生成 UUID。自定义值必须是小写、带连字符的 canonical UUID 字符串，否则 400 `invalid_prompt_id`。`client_id` 仅进入 extra_data，不能替代任务 ID。[提交 ID](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L1088-L1118)、[UUID 校验](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/comfy_execution/jobs.py#L34-L50)

**自定义 ID 不是幂等键**：提交成功路径直接 `put`，`put` 直接推入队列，没有同 ID 去重；历史又以 ID 为 key 写入。因此复用 ID 重发可能执行两次、覆盖历史。不得把“同 UUID 重试”当成安全恢复。[入队](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L1124-L1133)、[队列与历史](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1262-L1305)

## 历史、状态和图片

`GET /history/{id}` 返回 HTTP 200，找到时为 `{ "<id>": { prompt, outputs, status, ... } }`，未找到为 `{}`，不是 404，也不是直接的 job 对象。`outputs` 按节点 ID 分组；正常历史条目在 `task_done` 时写入，而不是排队时生成。[路由](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L1059-L1062)、[历史写入](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1281-L1305)、[未找到结果](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1364-L1389)

标准 worker 写入 `status: {status_str: "success" | "error", completed: boolean, messages: [...]}`，其中 **completed = 执行成功与否，不是“是否已到终态”**。错误/中断历史可为 `completed:false`，不能继续等待它变 true。messages 实际由 `[event, data]` 对组成，包含 `execution_error` 或 `execution_interrupted` 等；解析时不能按字符串列表处理。[worker 状态](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/main.py#L397-L405)、[状态事件](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L677-L712)

标准 SaveImage 的输出为 `outputs[nodeId].images[]`，每项有 `filename/subfolder/type`；PreviewImage 使用 `type:"temp"`。官方客户端把这三个字段 URL 编码后请求 `GET /view` 取得图片 bytes。应选定预期的输出节点，不把任意预览节点当最终图；执行 success 但没有预期图片，应报告“无可用图片”，不是生成成功。[图片节点](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/nodes.py#L1692-L1725)、[官方取图示例](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/script_examples/websockets_api_example.py#L19-L55)

`/view` 的 `filename` 必填，`type` 默认 output，`subfolder` 可选；另有 preview/channel 转码选项。下载原图只发送上述 descriptor 三字段，不附加 preview/channel。服务端检查路径越界，但客户端仍应只接受 descriptor 字符串、固定 base URL、允许的 type，并校验响应 MIME、字节上限和实际图像格式，不能将远端文件名作为本地写入路径。[view 实现](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L516-L575)；客户端限制为本项目安全建议。

## 取消：共享服务器不能被误伤

`GET /queue` 返回 `{queue_running: [...], queue_pending: [...]}`；条目为数组，索引 1 是 prompt_id。`POST /queue {"delete":[id]}` 只操作 pending 队列，返回空 HTTP 200，**不证明找到任务或成功停止执行**。任务可能已转 running；删除 pending 不写取消历史。`{"clear":true}` 清空全部 pending，禁止用于单任务取消。[队列路由](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L1064-L1070)、[删除路由](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L1146-L1158)、[实际删除](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1346-L1362)

旧接口 `/interrupt` 不带 ID 会全局中断；带 ID 的实现仍然是先读 running 快照、再发全局中断信号，中间没有持有队列锁。由此推断存在快照失效后误伤下一任务的竞态，不能仅因为支持 prompt_id 就宣称共享实例安全。[interrupt 实现](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L1160-L1190)

本次固定版本另有 `POST /api/jobs/{id}/cancel`：pending 删除，running 使用锁内 `interrupt_if_running(id)`；terminal/unknown 为 no-op，返回 `{cancelled:false}`。它显式处理 pending→running 竞态，较旧 interrupt 更安全。但不能假定用户旧版本具备此接口，更不能 404 后退回全局 interrupt。[新取消路由](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/server.py#L944-L987)、[锁内中断](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1323-L1340)、[竞态处理](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/comfy_execution/jobs.py#L505-L550)

本项目保守默认建议：仅对本任务 ID 做 pending delete；正在执行时停止本地等待/阻止结果挂回对话，提示“本地已取消，远端可能继续运行”。不调用任何 interrupt，不清空队列、不删除他人历史。是否支持新原子取消接口应单独确认版本和验收。

## 持久化恢复建议（非上游保证）

1. POST 前持久化本地 job、base URL/配置引用、canonical UUID、固定的请求快照及哈希，记录 submitting；网络请求不得先于记录落盘。UUID 只用于关联，不能自动重发。
2. 收到 200 后校验 JSON 和实际返回 prompt_id，立即持久化再进入 polling。若返回 ID 与请求 ID 不同，说明自定义 ID 未被该实例保留，使用真实返回 ID并记兼容性异常；旧版本能力不能由本次源码替用户实例背书。
3. HTTP 响应丢失时，用预先记录的 ID 查 history，再查 queue，必要时重新查 history 以跨过 running→history 的时间窗。找到则恢复查询，**不重新 POST**；均未找到则保持 unknown/需人工决定，而不是断言未提交。未确认自定义 ID 支持的实例，响应丢失尤其无法保证恢复。
4. history 是进程内字典，有容量淘汰，也可被清空/删除；空历史可能表示排队、运行、未接受、已删除、实例重启等，不能证明“从未生成”。[存储与容量](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1249-L1291)、[清理历史](https://github.com/comfyanonymous/ComfyUI/blob/95d755cd8107a72258d452b5d3657273d571f07d/execution.py#L1391-L1397)
5. 结果 descriptor、下载中的状态和已保存产物分别持久化。网络中断后可以重试 GET history/view；不能把取图失败升级成再次生成。最终成功必须是状态成功、预期输出存在且图片 bytes 已校验并安全落盘；本地取消任务即使远端稍后完成，也不得自动插回已取消目标。

建议合同测试覆盖：400 校验错误；200 非空 node_errors；POST 响应丢失但任务已入队；同 ID 禁止二次 POST；history error + completed:false；空 history 与 running/pending；未知任务；错误图片 descriptor/非图响应；pending 删除竞态；重启只恢复 GET；本地取消后远端完成不发布。
