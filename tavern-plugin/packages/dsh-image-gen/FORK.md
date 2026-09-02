# flizzywine 维护版本

上游：[shanliuling/dsh-image-gen](https://github.com/shanliuling/dsh-image-gen)。
本分支从 `7b72d40b2f88fc312d3b425b8554382cfa8f2514` 开始维护，保留 MIT 许可与原作者署名。

## 分工

- 本插件负责供应商协议、凭据、配置、实际出图和 DSH 附件。
- DSH Tavern 通过同进程私有服务 `tavernImageConfiguration` 调用整个插件，负责画面设计、剧情轮次绑定及重试控制；Studio 接口保留供独立工作台使用。
- 保留 upstream remote，独立功能提交，合并上游时运行完整测试，不覆盖我们的供应商实现。

## Grok 首批接入

- 在插件设置选择 Grok / xAI，配置自己的 `XAI_API_KEY`、根地址与模型。
- 默认根地址 `https://api.x.ai/v1`，模型 `grok-imagine-image-2.0`，可修改模型。
- `generate_image` 与 Studio 均支持单张文生图，比例为常用七种，分辨率 1k/2k。
- 使用 xAI `aspect_ratio`、`resolution` 与 `response_format=b64_json`；不把 OpenAI 的 `size` 参数套到 xAI 上。
- 按图片内容区分 PNG/JPEG/WebP，附件由 DSH 再验证和保存；不下载临时 URL，不转发 Key，不自动重试收费请求。
- 暂不支持 Grok 图生图/参考图；Studio 的能力查询明确报告 `supportsEditing=false`。
- 不自动搬迁 Tavern 的 Grok Key；旧配置需用户在统一设置中点击保存后才迁移，旧图片不变。
- 统一设置的免费鉴权与模型列表已迁入本插件。Grok 官方用只读 `/api-key` 验证；凭据存在不等于鉴权通过，鉴权通过不保证图片权限或余额。

协议依据：[xAI 官方文档](https://docs.x.ai/developers/model-capabilities/images/generation)。测试使用模拟供应商，不代表真实出图或画质验收；未发布 npm 包。

## 开发与安装

本地开发目录：`dsh-image-gen`。运行 `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm test`、`pnpm run build`。

## Tavern 内置发行

本目录完整导入自 `flizzywine/dsh-image-gen` 的 `b577840`，上游基线保持不变。后续以 Tavern 内的本目录为维护主线，GitHub fork 保留来源用途，不双向维护，也不从 npm 下载同名原版。

- Tavern 安装器将本目录作为同一 Profile 的独立 bundle 加载；包名与客户端模块 ID 保持 `dsh-image-gen`，不重复安装原版。
- `lib/index.js`、`lib/client.js` 与客户端 source map 随源码提交及发行。普通用户不需要 TypeScript、构建工具或单独运行插件安装命令。
- 维护者在本目录运行 `pnpm install --frozen-lockfile`，然后在 Tavern 根目录运行 `pnpm run build:image-gen`、`pnpm run test:image-gen`。修改源码必须一并提交构建产物；CI 检查二者同步。
- 安装时服务端外部依赖全部链接到当前 DSH 宿主；不会另装一套 Cordis 或 DSH。开发依赖仅用于维护者构建测试。
- 保留完整源码、测试、上游文档、MIT 许可证和作者信息。上游 README 的 npm 安装说明仅供独立插件参考，不是 Tavern 的安装方式。
- 生图仍默认关闭；旧渠道配置在明确保存时迁移，不自动调用收费接口。
- 内置 bundle 设置 `registerAgentTools: false`，不向 Agent 直接暴露 `generate_image` / `edit_image`，并隐藏重复的插件设置卡片。Studio 接口和工作台保留；插件工作台手动操作仍遵循其自身配置。

## 统一 Tavern 设置

`src/configuration.js` 是私有配置/鉴权/模型/生图服务。`src/tavern/` 接收原 Tavern 九种渠道实现，保留授权参考图、ComfyUI 任务恢复和安全下载，不重写供应商行为。Tavern 原路径仅兼容导出，新增供应商在本插件维护。

云端设置与凭据复用原插件字段；补充参数及其他渠道存为不含 Key 的 `tavernChannels` JSON。Key 只进 DSH 凭据库。保存、捕获和生成共用串行边界，Studio 同样遵守；地址变更不复用旧 Key。返回已收到的字节供 Tavern 做持久保存恢复，附件失败不触发重复生成。统一接口不额外写入工作区副本。

测试：Tavern 根目录 `node --test tests/scene-image*.test.mjs`；`tests/fixtures/scene-image-unified-ui.mjs` 可用实际构建的插件与 Tavern 设置组件做模拟浏览器验证，不请求真实供应商。界面测试不能替代真实出图验收。
