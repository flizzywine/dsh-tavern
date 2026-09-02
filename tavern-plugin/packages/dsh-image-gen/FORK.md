# flizzywine 维护版本

上游：[shanliuling/dsh-image-gen](https://github.com/shanliuling/dsh-image-gen)。
本分支从 `7b72d40b2f88fc312d3b425b8554382cfa8f2514` 开始维护，保留 MIT 许可与原作者署名。

## 分工

- Tavern 运行入口为 `src/module.js`，负责供应商协议、配置、鉴权、模型列表和实际出图。
- Tavern 直接传入存储和凭据能力，独占画面设计、轮次绑定、图片保存、恢复及展示。不通过 `tavernImageConfiguration` 注册，也不通过 Studio 转发请求。
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

- Tavern 安装器不再将本目录注册为独立 bundle，也不再为它安装宿主依赖链接。升级安装会移除上次由 Tavern 管理的该 bundle；用户自行安装的其他插件不受影响。
- `lib/index.js`、`lib/client.js` 与客户端 source map 随源码提交及发行。普通用户不需要 TypeScript、构建工具或单独运行插件安装命令。
- 维护者在本目录运行 `pnpm install --frozen-lockfile`，然后在 Tavern 根目录运行 `pnpm run build:image-gen`、`pnpm run test:image-gen`。修改源码必须一并提交构建产物；CI 检查二者同步。
- 内置模块仅使用 Node 内置能力；DSH 凭据由 Tavern 注入，不导入 Cordis 或 DSH 插件入口。保留的独立插件开发依赖仅用于维护者构建测试。
- 保留完整源码、测试、上游文档、MIT 许可证和作者信息。上游 README 的 npm 安装说明仅供独立插件参考，不是 Tavern 的安装方式。
- 测试分支新旧配置均默认开启；升级保存为 v4 后保留后续手动关闭状态。配置待迁移只影响可用性，不关闭功能开关。旧渠道配置在明确保存时迁移，不自动调用收费接口。
- Tavern 不加载本目录的独立插件入口、客户端设置卡片、Studio 或工具注册。相关源码和构建产物保留供上游对照及独立插件测试；`tests/fixtures/upstream-image-plugin.mjs` 仅是测试用旧 Studio 桥接，不随 Tavern 运行。

## 统一 Tavern 设置

`src/module.js` 为模块接口，内部复用 `src/configuration.js` 的配置和请求管理。`src/tavern/` 集中九种渠道实现，保留授权参考图、ComfyUI 任务恢复和安全下载。Tavern 原路径仅兼容导出，新增供应商在本目录维护。

配置保存在 Tavern 数据目录的 `scene-images/providers.json`，缺失时通过宿主提供的只读接口读取旧 `image-generation` 设置，首次保存才迁移非敏感字段。原始 YAML 不改动，已有凭据名不变。Key 只进 DSH 凭据库。配置保存、捕获与请求前校验共用短时串行边界；图片 HTTP 在锁外执行。已发请求不混用后来的配置，地址变更不复用旧 Key。模块返回字节，由 Tavern 负责持久保存恢复，附件失败不触发重复生成。

测试：Tavern 根目录 `node --test tests/scene-image*.test.mjs`；`tests/fixtures/scene-image-unified-ui.mjs` 使用真实模块与 Tavern 设置组件做模拟浏览器验证，不加载独立插件、不请求真实供应商。界面测试不能替代真实出图验收。
