---
name: character-authoring
description: "在卡片工作台创建或修改配图人物与服装，保留共用库的版本检查和已有参考图。"
---

# 人物与服装资料

先与用户确定可见外貌、衣着与要保留的身份特征。人物资料应能按镜头取用，服装按上衣、下装、鞋袜、配饰、整套、背面与负面拆分，未指定的字段留空。参考 `references/design-rules.md`。

已有资料用 `read_character` 和 `read_outfit` 查询。写入前从 `GET /dsh-tavern-gen/api/state` 读取最新对象，使用 `POST /dsh-tavern-gen/api/save`。`target` 为 `characters` 或 `outfits`，`content` 包含对应数组与读到的 `revision`。保持未编辑的字段、人物卡绑定和参考图标识。

遇到 `REVISION_CONFLICT` 时重新读取、核对修改，再保存。不要删除版本号重试，不直写磁盘，不以空数组代替读取失败。保存后用查询工具确认。
