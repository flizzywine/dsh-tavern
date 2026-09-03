# dsh-image-gen 直接复用核对

日期：2026-09-02。依据上游固定提交 `7b72d40b2f88fc312d3b425b8554382cfa8f2514`（本地只读副本与远端已核对）。仅源码研究；未安装、未读取用户凭据、未调用付费生图，尚未完成真实出图验收。

## 结论

**可以把现成插件作为 Tavern 的生图执行后端，不需要重写各云厂商适配；但“安装插件”不等于“后台 Agent 自动获得工具、结果自动挂到前台轮次”。** 对已有 Tavern 场景插图流程，优先复用 Studio HTTP 接口，保留 Tavern 的画面方案、参考图授权、轮次归属与重试控制。插件没有这些 Tavern 业务概念。[工具注册与返回](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/index.ts#L77-L219)、[Studio 契约](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/shared.ts#L70-L93)

主代理本次另行核实：Tavern 已有 `createSceneImagePlugin` Studio adapter；当前运行 Profile 未安装该插件、Studio 返回 404；生图后台 Agent 的工具白名单不包含 `generate_image` / `edit_image`。这些属于当前本机状态，不是上游能力缺失。

## 两条接入路径

| 项目 | 注册工具 | Studio HTTP |
| --- | --- | --- |
| 入口 | `generate_image` / `edit_image` | `GET` / `POST /plugins/dsh-image-gen/studio` |
| Provider | 当前插件设置；参数不接受逐次指定 provider/model | 请求指定云 provider；model 必须与当前配置一致 |
| 支持范围 | Google、OpenAI-compatible、Seedream、DashScope、ComfyUI | 前四种云 Provider，不含 ComfyUI |
| 参考图 | 当前执行 Session 内附件，或该 Session 工作区内文件 | 显式附件完整引用，或 base64；不依赖 Agent Session |
| 结果归属 | 返回 image block 与 presentation meta，进入调用方的工具结果链 | 返回附件 JSON；调用方自己登记到 Tavern 轮次 |

证据：[工具实现](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/index.ts#L77-L219)、[参考图解析](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/reference-image.ts#L55-L114)、[Studio 实现](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio.ts#L73-L161)、[配置校验](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio.ts#L216-L236)。

工具路径需特别注意：`edit_image` 的附件 ID 不是“附件库中存在即可”，必须能在 `exec.agent.session.deriveMessages()` 找到；不指定时优先最新用户消息中的图片，再回退到最近带图片的消息。后台独立 Session 不会因此自动获得前台图片。工作区路径还检查真实路径，拒绝越界/符号链接逃逸。[解析与路径边界](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/reference-image.ts#L83-L190)

## Studio 不能忽略的限制

- prompt 最多 2,000 字符；最多 5 张参考图，DashScope 编辑最多 3 张；比例/清晰度须在 GET 返回的选项内，不能随意透传任意尺寸。[请求校验](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio-route.ts#L72-L101)、[DashScope 限制](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio.ts#L120-L127)、[选项定义](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio.ts#L164-L220)
- HTTP 请求等待完成才返回，断连触发取消；没有该接口的持久任务 ID、进度事件或幂等键。超时/断连不能直接推断厂商未产生费用，Tavern 重试必须自己控制。[请求生命周期](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio-route.ts#L20-L68)
- 保存附件不等于挂载前台 Session。Studio 只返回附件与可选 `savedTo`；插件 Studio UI 随后写入浏览器 IndexedDB 图库，没有在这一条路径追加对话。Tavern 调用 HTTP 也不会自动进入插件图库。[服务端返回](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio.ts#L131-L161)、[UI 登记图库](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/client/studio-view.tsx#L461-L484)、[图库存储](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/client/gallery-store.ts#L35-L59)
- 应显式传正确 `workspaceRoot`，不能依赖插件的已知工作区首项或进程目录回退。附件成功但工作区文件保存失败时，Studio 只记日志、仍返回成功且无 `savedTo`。[默认目录选择](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/index.ts#L56-L74)、[保存失败行为](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio.ts#L134-L161)

## 值得直接复用

1. 云厂商生图/改图、服务端凭据解析、配置能力查询、图片格式/大小验证与 DSH 附件存储。[Studio 调度](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/studio.ts#L58-L161)
2. 工作区安全保存与附件预览接口；不要把可选本地文件路径当成生图成功的必要条件。[安全保存](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/workspace-save.ts#L90-L140)、[预览注册](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/index.ts#L46-L49)
3. 若以后需要 ComfyUI，可评估工具执行入口；当前工具支持工作流选择、预设提示词、seed 返回，编辑限单图，不能声称 Studio 已支持它。[ComfyUI 工具分支](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/index.ts#L88-L100)、[编辑限制](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/index.ts#L150-L166)、[seed 元数据](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/src/index.ts#L212-L218)

部署应加入实际运行 Tavern 的同一 DSH Profile，并验证宿主依赖与 route 就绪。上游给出的安装方式为 `dsh plugin --profile web add dsh-image-gen@latest`，但 `web` 只是其示例；本次固定提交也不等于未来 `latest` 内容。[官方安装说明](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/README.zh-CN.md#L63-L87)、[依赖和 bundle 声明](https://github.com/shanliuling/dsh-image-gen/blob/7b72d40b2f88fc312d3b425b8554382cfa8f2514/package.json)
