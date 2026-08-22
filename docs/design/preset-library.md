# 预设库设计

## 定位

预设库管理原始 SillyTavern JSON 预设，是卡片工作台的输入资源；破甲库管理用户确认后保存的 Markdown 系统提示词，是运行时能力。两者通过卡片 Agent 的分析和确认流程连接，但不共享文件或开关状态。

## 第一版能力

- 在 `data/resources/presets/` 保存工作版，在 `data/originals/presets/` 保存不可变原版。
- 导入、列出、重命名、删除和通过 `@"presets/..."` 加入卡片对话。
- 点击预设后，按 SillyTavern `prompt_order` 展示提示词顺序、角色、名称、正文摘要、启用状态和占位条目。
- 读取 `extensions.SPreset.RegexBinding.regexes`，在提示词之前单独展示正则脚本；每条可展开查看查找规则、替换内容、执行位置、运行条件和深度限制。
- 条目可展开阅读全文；启用状态只读，不在预设库中改变运行行为。
- 缺少 `prompt_order` 时按 `prompts` 原始顺序展示；合法但尚未识别的 JSON 仍完整保存并明确提示。
- 已经作为资料导入、且能明确识别为 SillyTavern 预设的 JSON 自动迁移到预设库，并同步已有对话引用。普通 JSON 不迁移。

## 模块 seam

`Preset Reading` 只暴露 `inspectPreset(text, filename)`。它隐藏 SillyTavern 字段差异，返回稳定的预设摘要、有序提示词和 SPreset 正则脚本投影；文件存储、服务端适配器和 Web 适配器都只依赖这一个 interface。解析不修改原始 JSON，也不决定哪些内容属于破甲。

## 非目标

第一版不提供条目编辑、拖拽排序、启用开关修改、宏替换、变量管理、导出或直接执行预设。这些能力只有在真实使用证明必要时再扩展。
