# 两款 SillyTavern 配图插件调研

日期：2026-08-31。范围：只读 README、配置、源码；未安装、未执行插件、未请求文字或图片模型。下文「已实现」只指存在相应源码路径，不代表真实出图效果、兼容性或宣传承诺已验证。没有修改 Tavern 产品代码。

## 版本与结论

| 项目 | 固定提交 | 源码定位 |
| --- | --- | --- |
| st-chatu8（智绘姬） | `2fd09a109632decde47cddeeee20e46533bdfef6` | 全功能绘图工作台；README 仍写 1.0.0，manifest 为 2.8.4，功能不能只看 README。 |
| ST-BaiBai-Image（柏宝绘） | `719d7ef876b3e04463a95de99f5c00b808e89d19` | 剧情配图助手；package 为 0.2.2，强调自动选画面、角色外貌与楼层配图。 |

版本来源：[Chatu8 manifest](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/manifest.json)、[BaiBai package](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/package.json)。

**对 Tavern 的判断：柏宝绘的产品方向更接近「独立请求理解剧情→图片附在该轮」；智绘姬更适合参考高级绘图功能。二者都不宜整体移植。当前首版应继续保持手动触发、单图、正文末尾显示、正文与变量不被绘图改写。** 这是针对本项目需求的取舍，不是上游质量排名。

## st-chatu8：功能广、可操作性强

- **不只是识别 tag。** 除自定义标记触发外，存在独立 LLM 正文生图流程：可填写本次要求、上传参考图，采集当前正文、最近几轮、世界书触发内容、变量、角色及服装列表，再调用独立 `image_gen` 提示词配置。正文与过去上下文分开传入。[核心处理器](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L31546-L31791)
- **手动与自动并存。** 手势入口走 `handlePromptRequest`；自动路径监听生成结束、判断消息/swipe 增长、检查开关和正文长度后再调用。自动模式甚至会开启「插入原文」配置，不能原样借进我们的只读绘图流程。[自动路径](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L83406-L83628)
- **绘图后端与深度参数多。** SD/A1111、NovelAI、ComfyUI，以及后来扩展的 Banana 路径；正负提示词、质量词、提示词预设、替换、LoRA、高清修复、角色参考与 Vibe 等。版本中的界面导航也包含 Banana、LLM、角色、资料库、词库、日志等。[README 基础能力](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/README.md#L8-L31)、[当前导航](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L83629-L83637)、[NovelAI 设置](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/html/settings/novelai.html)、[Banana 设置](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/html/settings/banana.html)。后端真实可用模型没有实测。
- **角色与服装分开。** 生图上下文分别构造角色列表、服装列表，并可收集角色/服装参考图片。这比每次只靠正文重新猜外貌更值得参考，但不能据此承诺人物脸部完全一致。[列表与图片输入](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L31637-L31752)
- **编辑和重画很便利。** README 声明长按改提示词、双击重新生成；插件保留同一提示词的多张图片及当前索引，支持客户端 IndexedDB 与服务器路径读取。手势细节在移动端有版本变化，因此值得学「可编辑重画」，不值得绑定同一套隐藏手势。[交互说明](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/README.md#L26-L31)、[多图读取](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L3378-L3428)
- **任务与重试。** 有排队/运行/完成/取消/失败状态，以及 LLM 请求控制器；LLM 重试按 429、5xx、网络问题与 400/401/403、主动取消分类。[任务记录](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L15881-L16085)、[错误分类](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L16106-L16172)。`TaskQueue` 名称本身不能证明所有后端统一限流。
- **额外云端队列。** NovelAI 有可配置第三方队列地址，入队传 key hash、用户/任务标识；不能把「不传原始 key」扩大为没有任何隐私或外部依赖。Tavern 单图按钮不需要引入该服务。[队列协议](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L64185-L64278)

它的代价是设置面广、ST DOM/事件/正则/iframe 耦合重；仓库主要实现是一份约 8.5 万行 bundle。借鉴交互和分层思想比复制整段实现合适。[上下文 DOM 路径](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L15035-L15165)

## 柏宝绘：更贴近剧情配图，但比我们的首版复杂

- **选画面和出图分两步。** 可以自动分析 AI 楼层，也可手动点「生成 tag」；配置决定只生成提示词还是继续出图。主流程允许结果为「本楼无需插图」，或规划多张。[runner](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/runner.ts#L167-L332)、[标记自动出图与插入](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/runner.ts#L392-L468)
- **独立上下文。** 按目标楼层读取近期剧情，加入人物卡、用户人设、激活世界书、柏宝书记忆及固定外貌库；文字请求可选副 API，也可跟随主 API。不是把主聊天整套工具交给生图助手。[提示词装配](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/prompt.ts#L77-L138)、[正文装配](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/prompt.ts#L260-L275)、[请求选择](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/runner.ts#L295-L325)
- **固定外貌库是亮点，但 README 已过时。** README 写「只报 @名字、机械替换，彻底杜绝漂移」。当前源码明确说从 0.1.2 起撤回为「库作参考、AI 照抄可见字段」，`@名字` 仅兜底：重复展开曾造成多个身体、tag 预算失真、脏字段放大。因此可以借鉴稳定外貌与临时状态分离，不能照搬宣传或保证一致性。[源码自述与实现](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/charAnchors.ts#L12-L69)
- **外貌按剧情时点变化。** 变化记录跟楼层/swipe 走，程序按图片位置应用变化；全局锁定角色不接受 AI 自动修改。是完整的角色档案系统，不是实现单张插图的必要前提。[时点与锁定处理](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/runner.ts#L264-L278)、[变化应用](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/runner.ts#L344-L398)
- **真正出图后端主要为 NAI 与 ComfyUI。** NAI 支持分角色提示词与 Vibe 数据；ComfyUI 有内置模板、命名工作流、AI 辅助配置。WebUI 文件虽然存在，但面板显示开发中，不能列为已完成后端。[实际分发](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/floor/Card.vue#L210-L268)、[WebUI 占位](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/pages/backend/panels/WebUIPanel.vue)、[NAI Vibe](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/backends/nai.ts#L437-L505)、[Comfy 工作流助手](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/backends/comfyWorkflowAssistant.ts)。
- **图片持久化与版本关联清楚。** 二进制先上传 ST 文件系统，楼层 `extra` 只存路径；按 swipe、promptHash、图片槽位保存生成历史，同时保留种子，可查看旧图/过期图。这比按楼层号覆盖单张图更稳健。[存储模型](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/floor/storage.ts#L6-L158)、[保存顺序](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/floor/storage.ts#L285-L327)
- **限流不是不停重试。** NAI 默认并发 1，有取消可退出的队列、最小请求间隔；429 使全局冷却，临时错误指数退避、遵守有上限的 Retry-After，配置/凭据错误不重试。ComfyUI 用服务端队列，不叠同款客户端排队。[队列](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/floor/genQueue.ts#L1-L117)、[重试策略](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/backends/naiRateLimit.ts#L1-L97)
- **生成 tag 的格式校验也纳入失败。** 不只是 HTTP 成功就记成功；解析失败可以有限重试。不过该循环再次发送相同 messages，并未把上次错误追加给模型，因此不等于我们的工具反馈自修复。[校验与重试循环](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/runner.ts#L280-L343)
- **不要直接移植正文插标签。** 它写入 `<bbi_image>`，再用显示侧正则变成卡片挂载点、提示词侧正则删掉。我们已有消息附件显示路径，应保持不污染正文和下一轮模型输入，不额外建立正则清理依赖。[双正则](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/st/imageTagRegex.ts#L6-L86)

## 值得借鉴的优先顺序（建议，不是本次实现范围）

1. **提示词可查看、编辑，再画一次。** 平时仍是一键出图；不满意时能改镜头/衣着，重画复用已生成提示词，不必重新调用文字子 Agent。
2. **稳定外貌 + 本轮动态状态分开输入。** 发色、瞳色等优先取已有人物设定；姿势、衣着、地点取本轮正文/变量。先复用已有数据，不再建第二套自动更新角色库。
3. **少量画风与画幅选择。** 风格统一注入；画幅只给横/竖/方，避免搬来模型参数大面板。不同后端需要适配 tag 或自然语言，不能把一种提示词格式当通用协议。
4. **更明确的进度与失败原因。** 区分「整理画面」「生图」「保存」；可取消，限制重试，对凭据错误直接提示。取消本地等待不应承诺供应商绝不计费。
5. **后续再加参考图。** 对角色一致性更有价值，但需要明确供应商图生图/角色参考支持、图片传输、费用；不是给任意文生图端点塞张图就自动有效。

暂不建议：自动每轮出图、多图插入正文不同位置、自动角色档案增删/回滚、图库/词库/LoRA 编辑器、工作流 AI 配置、陪玩助手、云端排队。这些把单图功能扩成另一个产品，也增加调用量和维护面。

## 许可、凭据与证据边界

- **不能把公开源码当成可随便复制。** Chatu8 放的是 AFPL v9，正文有分发限制，且仍以 Ghostscript 为适用对象，许可证套用情况值得作者澄清。BaiBai 当前树未见 LICENSE，package 也未声明许可。当前建议借鉴产品思路、自行实现；若想复制源码，先向作者确认授权。这里只报告仓库许可事实，不作法律兼容性结论。[Chatu8 LICENSE](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/LICENSE)、[BaiBai 固定树](https://github.com/baibai-git/ST-BaiBai-Image/tree/719d7ef876b3e04463a95de99f5c00b808e89d19)、[BaiBai package](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/package.json)
- **凭据要保持 DSH 的服务端保管边界。** BaiBai 将 settings 全对象写入 ST extensionSettings，包含渠道配置；NAI 请求在浏览器侧使用 key。Chatu8 的独立 LLM 也可直连或经 ST 代理传 key。不要照搬前端配置存储到 Tavern，不因 UI 隐藏密码就声称凭据隔离。[BaiBai 设置保存](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/state/settings.ts#L1888-L1899)、[NAI 请求](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/backends/nai.ts#L579-L645)、[Chatu8 直连/代理](https://github.com/damoshen123/st-chatu8/blob/2fd09a109632decde47cddeeee20e46533bdfef6/index.js#L16383-L16433)
- **不要复制无上限上下文策略。** BaiBai 世界书扫描传极大上下文预算以避免截断，再加入角色与记忆。对我们刚做完 token 优化的项目，应有明确的绘图输入边界，不能为了生图重发全部剧情设定。[世界书预算](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/autoTag/context.ts#L116-L122)
- **宣传不是验证。** 「外貌永不漂移」「取消不浪费额度」「删聊天即删图片」均不据 README 承诺。尤其文件存储源码明确允许上传后指针失败产生孤儿，本次未找到完整聊天删除的图片文件清理链；只能确认单图删除路径。[保存与单图删除](https://github.com/baibai-git/ST-BaiBai-Image/blob/719d7ef876b3e04463a95de99f5c00b808e89d19/src/floor/storage.ts#L285-L369)

源码中的测试文件本次没有运行；不把测试存在或注释所称实测当成本次运行证据。
