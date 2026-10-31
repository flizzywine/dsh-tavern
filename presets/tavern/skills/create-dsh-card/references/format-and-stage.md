# DSH 人物卡格式与舞台声明

本文记录当前接口事实；不把讨论中的新协议字段当成可用能力。遇到工具或导入器明确报告的版本限制，以运行时结果为准。

## 版本分层

| 位置 | 含义 | 当前建卡规则 |
| --- | --- | --- |
| card.json 的 spec / spec_version | 通用人物卡格式 | 新建优先 chara_card_v3 / "3.0"；修改旧卡保留可支持的格式，迁移时同时转换数据结构 |
| data.character_version | 作者作品版本 | 作者自行维护的字符串，与格式、酒馆发行版本分别记录 |
| dsh.json 的 format / formatVersion | .dshcard 卡包格式 | 普通导入器当前接受 format: "dshcard"、formatVersion: 1；不要套用内部模组 archive v2 Schema |
| extensions.dsh_tavern.schemaVersion | DSH 卡片扩展结构 | 当前为整数 1；不使用酒馆版本号 3.2 替代 |
| 素材包 manifest.json 的 schemaVersion / contentHash | 素材结构与内容指纹 | 由素材库导出与校验，保持文件和清单一致 |

另有 `dsh-tavern-card-bundle` 卡包，结构与 `.dshcard` 的 `dsh.json` 不同，当前对应 schemaVersion 1。采用宿主提供的导出结果，不混用两种清单。

`dsh.json.card.version` 是包内作品版本。导出时与人物卡作品版本保持一致。格式升级必须匹配真实结构；仅修改版本数字不构成迁移。旧 `requires.tavernApi` 不能单独证明新舞台接口兼容。

## 规范声明位置

对 v2/v3 原始人物卡，使用 `/data/extensions/dsh_tavern`；无 data 包装的旧格式使用 `/extensions/dsh_tavern`。先读取原始格式再选择 JSON Pointer。酒馆资源文件内部的 raw 包装不属于作者卡片格式。

完整舞台的扩展示例：

```json
{
  "schemaVersion": 1,
  "assetBindings": {
    "boundPackIds": ["0f5613a4-ae7a-40e2-ba4a-17b4e7e9ce42"]
  },
  "stage": {
    "dialogue": true,
    "stage": true
  }
}
```

这是扩展对象示例；UUID 必须替换为用户实际安装、可使用的素材包 ID，不照抄示例制造空绑定。

| 声明 | 有效模式 |
| --- | --- |
| 两个开关缺省或 false | 普通对话 |
| dialogue: true，stage 缺省或 false | 气泡对话 |
| dialogue: true，stage: true | 完整舞台 |
| dialogue 缺省或 false，stage: true | 不满足前置条件，实际舞台关闭；修正声明 |

布尔值必须是 true/false。仅有素材包、皮肤、openings、widgets、@bubble 或名称含 galgame 的插件，不等于声明完整舞台。

现有 `.dshcard` 导入器还接受 `dsh.json.defaults.stage: true`，将它转换为卡片的 dialogue/stage 声明并补入包 ID。规范化后的卡片字段才是后续判定依据。新增卡优先显式填写卡片字段，避免作者意图依赖导入时的副作用。

stage.defaultSkin 是作者默认皮肤；stage.skinChoice 属于玩家本地选择，不作为作者默认导出。widgets 与 modSystem 另管模组配置，不替代舞台声明。玩家密钥、静音和权限不能由卡包覆盖。

## 素材与迁移

绑定不等于安装成功。检查主包是否存在、角色是否可解析、头像是否存在、开场引用是否能解析。缺包时不要通过替换为不相关全局素材来宣称原卡已恢复。

内容文件、manifest.files 与 contentHash 必须由同一份最终内容生成。修改人物、清单或媒体后重新经素材库导出。哈希失败时保留原包并报告，不跳过检查或手改指纹来宣称兼容。

旧插件的 registerStageView 已停用。将展示数据迁入卡片声明、开场配置与素材包，独立剧情逻辑再按公开插件接口处理；只删除旧调用、重命名插件或降低格式版本都不构成完整迁移。

## 卡包与验收

`.dshcard` 是卡包，至少区分 card.json 与 dsh.json；有素材和插件时清单路径与实际目录一一对应。优先使用宿主导出，保留授权和署名资料。作品名和插件包名分别处理，避免新卡继续沿用无关样例的插件身份。

交付状态分别报告：

1. 人物卡：字段、格式与扩展通过静态校验。
2. 素材：包已安装且引用可解析；失败说明包名和错误码。
3. 导出：真实文件存在且可重新读取；只有工具实际生成的下载信息才能提供给用户。
4. 试玩：仅实际运行后报告，包括开局正文、角色头像、舞台进入退出和声音停止。未试玩写明未验证。

舞台模块可用、卡片声明舞台、资源就绪与用户正在展示舞台，是四种不同状态。普通卡不运行本卡舞台任务；舞台卡可能在普通聊天视图准备导演数据，不承诺“没打开舞台就绝无模型调用”。未知协议版本和素材失败的完整降级能力仍需运行时验证，不能作为已实现承诺写给用户。
