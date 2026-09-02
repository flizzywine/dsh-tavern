# flizzywine 维护版本

上游：[shanliuling/dsh-image-gen](https://github.com/shanliuling/dsh-image-gen)。
本分支从 `7b72d40b2f88fc312d3b425b8554382cfa8f2514` 开始维护，保留 MIT 许可与原作者署名。

## 分工

- 本插件负责供应商协议、凭据、配置、实际出图和 DSH 附件。
- DSH Tavern 通过本机 Studio 接口调用整个插件，负责画面设计、剧情轮次绑定及重试控制。
- 保留 upstream remote，独立功能提交，合并上游时运行完整测试，不覆盖我们的供应商实现。

## Grok 首批接入

- 在插件设置选择 Grok / xAI，配置自己的 `XAI_API_KEY`、根地址与模型。
- 默认根地址 `https://api.x.ai/v1`，模型 `grok-imagine-image-2.0`，可修改模型。
- `generate_image` 与 Studio 均支持单张文生图，比例为常用七种，分辨率 1k/2k。
- 使用 xAI `aspect_ratio`、`resolution` 与 `response_format=b64_json`；不把 OpenAI 的 `size` 参数套到 xAI 上。
- 按图片内容区分 PNG/JPEG/WebP，附件由 DSH 再验证和保存；不下载临时 URL，不转发 Key，不自动重试收费请求。
- 暂不支持 Grok 图生图/参考图；Studio 的能力查询明确报告 `supportsEditing=false`。
- 不自动读取或搬迁 Tavern 的 Grok Key；原 Tavern 配置与旧图片不变。
- 本次不增加免费鉴权按钮；插件原有“Key 已配置”只表示凭据存在，不能当作鉴权通过。Tavern 内置 Grok 的只读鉴权仍保留，后续可独立迁入插件。

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
- 生图仍默认关闭；不会迁移 Tavern 旧渠道的 Key，也不会自动调用收费接口。此次未修改用户当前运行 Profile。
- 内置 bundle 设置 `registerAgentTools: false`，不向 Agent 直接暴露 `generate_image` / `edit_image`，避免绕过 Tavern 的手动生图与轮次绑定。完整实现仍保留，Studio 接口及插件界面不受影响；插件工作台的手动操作仍遵循其自身配置。
