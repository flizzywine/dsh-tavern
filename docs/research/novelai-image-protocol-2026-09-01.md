# NovelAI 生图协议核验（2026-09-01）

仅进行了公开文档和官方前端静态文件 GET；没有登录、使用密钥或发起付费生图。下面区分官方协议声明、官方前端实现和本项目选择，不能视为真实生成验收。

## 一手来源与版本

- [官方 Swagger 初始化数据](https://api.novelai.net/docs/swagger-ui-init.js)：读取内嵌 `swaggerDoc` JSON，而非执行远程脚本。`AiGenerateImageRequest` 模型枚举只更新到 V3，`parameters` 是无细分的 object；不能据此否定 V4/V5，也不能据此证明其完整 schema。
- [官方当前模型](https://docs.novelai.net/en/image/models/)：V5 Full/Curated 已为最新，V4.5/V4/V3 仍列出。
- [官方多角色说明](https://docs.novelai.net/en/image/multiplecharacters/)：场景放 base prompt、角色分开描述；人数标签如 `2girls` 放 base，单角色使用 `girl`。V5 最多 22 角色，V4 系最多 6；V4/V4.5 坐标限制在 5×5 网格。
- 官方 `/image` 页面当日公开构建 `6750aa2-production`：[_app bundle](https://novelai.net/_next/static/chunks/pages/_app-d4b965a7fb59e75a.js)（模型枚举、默认参数、请求发送/解包），[7416 bundle](https://novelai.net/_next/static/chunks/7416-f6ced8a5d0eb26de.js)（角色 caption 构造）。这些是可定位的一手实现证据，不是稳定公开 API 承诺。下述字段可在链接中按字段名检索。

## 请求与返回

Swagger 声明 `POST /ai/generate-image`、Bearer 认证、JSON 请求，必填 `input`、`model`、`parameters`；`action` 可为 `generate`。成功描述为 SSE / ZIP，声明 201；错误包括 400、401、402、409、500。[来源：Swagger](https://api.novelai.net/docs/swagger-ui-init.js)

官方前端的非流式路径实际指向 `https://image.novelai.net/ai/generate-image`，携带 `Authorization: Bearer <token>`；收到成功响应后按 ZIP 解包，选择 `image_` 开头的 `.png` 或 `.webp`。实现以 HTTP `ok` 判断成功，不应只接受 200。当前默认请求是 multipart（`request` 部分为 JSON Blob）；`debugLegacyImageGenRequest` 分支仍明确使用 `Content-Type: application/json` 和 JSON body。本项目采用 JSON 属于保留分支，尚未做服务端实测。[来源：官方 _app bundle](https://novelai.net/_next/static/chunks/pages/_app-d4b965a7fb59e75a.js)

不要把 `stream: "msgpack"` 当 ZIP 必需参数：官方将它用于另一条 `/ai/generate-image-stream`，逐帧读取长度前缀 MessagePack。普通 ZIP 分支未设置该参数。[来源：官方 _app bundle](https://novelai.net/_next/static/chunks/pages/_app-d4b965a7fb59e75a.js)

## 模型与固定参数

官方前端枚举与默认参数函数核实如下；这里的默认值是 UI 初始参数，发送前还会调整，并非每个字段都必填。[来源：官方 _app bundle](https://novelai.net/_next/static/chunks/pages/_app-d4b965a7fb59e75a.js)

| 系列 | 已核实 model ID | scale |
| --- | --- | --- |
| V5 | `nai-diffusion-5-full` / `nai-diffusion-5-curated` | 7 |
| V4.5 | `nai-diffusion-4-5-full` / `nai-diffusion-4-5-curated` | 5 |
| V4 | `nai-diffusion-4-full` / `nai-diffusion-4-curated-preview` | 5.5 |
| Anime V3 | `nai-diffusion-3` | 5 |

共同默认：`params_version: 4`、832×1216、`steps: 23`、`n_samples: 1`、`sampler: "k_euler_ancestral"`、`noise_schedule: "karras"`、`cfg_rescale: 0`、`dynamic_thresholding: false`、`legacy: false`、`legacy_v3_extend: false`。V4/V5 有 `use_coords: false`、`legacy_uc: false`。无 image 输入时发送前删除 strength/noise；V4/V5 删除 sm/sm_dyn。Euler ancestral 搭配非 native schedule 时发送前设 `deliberate_euler_ancestral_bug: false`、`prefer_brownian: true`；V5 发送前强制 karras。负面提示字段为 `negative_prompt`（UI 内部的 `uc` 被重命名）。[来源：官方 _app bundle](https://novelai.net/_next/static/chunks/pages/_app-d4b965a7fb59e75a.js)

尺寸证据：官方参数模块 `57863` 的生成面积上限常量是 **3,145,728** 像素（不是常见第三方代码里的 3,047,424）；校验函数 `D` 检查宽高非零、steps 不超过 50、面积不超过该值。尺寸步幅函数 `I` 返回 64，生成前按此步幅舍入。尚未确认独立的最小尺寸或 2048 单边上限；如项目添加这些限制，应标为本项目约束，不称官方硬限制。[来源：官方 1052 bundle](https://novelai.net/_next/static/chunks/1052-a3531a414d0a8b6d.js)

本项目可选择 V5 Full、单张、不自动重试、空负面词、不自动拼质量词；这些是产品取舍，不是声称官网采用相同质量/负面默认。不要凭第三方代码添加 `qualityToggle`：本次未确认其为当前官方发送契约。完整服务端必填参数集合、随机种子边界仍未通过生成调用验证。

## 多角色字段

官方构造逻辑对 V4/V4.5/V5 使用同名 `v4_prompt` / `v4_negative_prompt`。正、负 caption 的角色按同一顺序逐一对应；仅包含启用且正面提示非空的角色。V3 不采用该结构。[来源：官方 7416 bundle](https://novelai.net/_next/static/chunks/7416-f6ced8a5d0eb26de.js)

下面是独立整理的字段示意，不是复制第三方实现；中心点 0.5/0.5 作为本项目无手动定位时的选择：

```json
{
  "input": "2girls, garden",
  "model": "nai-diffusion-5-full",
  "action": "generate",
  "parameters": {
    "params_version": 4,
    "width": 832,
    "height": 1216,
    "steps": 23,
    "scale": 7,
    "n_samples": 1,
    "sampler": "k_euler_ancestral",
    "noise_schedule": "karras",
    "cfg_rescale": 0,
    "dynamic_thresholding": false,
    "deliberate_euler_ancestral_bug": false,
    "prefer_brownian": true,
    "negative_prompt": "",
    "use_coords": false,
    "legacy_uc": false,
    "v4_prompt": {
      "caption": {
        "base_caption": "2girls, garden",
        "char_captions": [
          { "char_caption": "girl, black hair", "centers": [{ "x": 0.5, "y": 0.5 }] },
          { "char_caption": "girl, blonde hair", "centers": [{ "x": 0.5, "y": 0.5 }] }
        ]
      },
      "use_coords": false,
      "use_order": true
    },
    "v4_negative_prompt": {
      "caption": {
        "base_caption": "",
        "char_captions": [
          { "char_caption": "", "centers": [{ "x": 0.5, "y": 0.5 }] },
          { "char_caption": "", "centers": [{ "x": 0.5, "y": 0.5 }] }
        ]
      },
      "legacy_uc": false
    }
  }
}
```

没有角色时 caption 数组为空。主场景文字在 `input` 与 `v4_prompt.caption.base_caption` 保持一致，负面文字也保持一致。示意省略 seed 等运行时信息，不是已经服务端接受的最小请求证明。

## 尚未证明的边界

- JSON 保留路径对当前订阅/代理是否可用、模型授权/余额、准确 MIME/ZIP 内容、实际画面与多角色遵循度，都需要用户授权后的真实请求验证。
- 第三方 ST-BaiBai-Image `nai.ts` 只作问题发现线索；未复制代码、默认画风/负面词、重试逻辑，也不把第三方注释称为官方证据。
- 不实现 image-to-image、Vibe、Precise Reference、缓存重试或流式图片；这些不是本次普通文字生图的前置条件。
