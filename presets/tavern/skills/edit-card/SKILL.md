---
name: edit-card
description: "局部修改已有的人物卡：设定、开场、文风、世界书、正则美化、MVU 变量与面板。普通卡转 MVU 使用 card-to-mvu，游玩故障诊断使用 debug-card。"
---

# 修改人物卡

完成指定变更，保留未涉及内容。目标明确就读取相关字段；目标不明只询问缺失信息。阶段变化时简短说明正在读取、修改或保存什么。

## 编辑入口

- 内容位置不明或涉及多处时，用 `tavern_search_card` 一次搜索标准字段、开场、世界书、正则与脚本，按返回位置局部读取。
- 同一文字需统一修改时，用 `tavern_replace_card_text` 批量替换；只改部分位置用 `pointers` 限定，检查结果中的修改位置和剩余处数。
- 标准字段用 `tavern_update_card.fields`；扩展字段用 `rawOperations` 按 JSON Pointer 修改或删除。
- 世界书用 `tavern_update_worldbook` 的条目级 operations，字段包括 `comment`、`content`、`primaryKeys`、`enabled`、`constant`。拆分或合并条目时，一条要值得它的触发：重要人物单独成条，只有一两句的小地点、小配角并入所属条目，例如虚拟世界里的各个小地点合成一条，每处一行。
- 读取用 `tavern_read_card`、`tavern_read_card_raw`、`tavern_read_worldbook`，按目标局部读取。大段修改可直接编辑目标 JSON，卡片字段在 `{kind, version, raw: {spec, data: {...}}, meta}` 的 `raw.data` 下。
- `tavern_update_card`、`tavern_update_worldbook` 和批量替换的保存结果已附带校验；只有直接编辑人物卡、预设或世界书文件后才调用 `tavern_validate_card`，指定实际文件路径。修正 errors，判断 warnings 的影响。

## MVU 变量与面板

用 `tavern_read_skill_reference` 读取 `card-to-mvu` 的 `references/mvu-format.md`。按实际卡片定位初值、更新规则、约束脚本与面板，不假定外部 MVU 卡已采用同一种布局。

采用当前格式的卡：初值在各开场 `<initvar>`，规则在世界书 `[mvu_update]`，面板在 `extensions.regex_scripts` 的状态视图 `replaceString`。增删或移动字段时一起改每个开场、规则与面板；改开场正文保留末尾 `<initvar>` 和 `<mvu-status/>`。外部约束脚本无法可靠同步时报告具体缺口，不强行重新转换。

## 世界书归属

确认目标实际用的是内置 `cards/...` 还是独立 `worldbooks/...`。仅当前会话绑定卡就是目标时可省略 path；其他目标先查实际绑定。

独立书可能多卡共享；检查相关绑定元数据，不遍历无关卡正文。只改当前卡时优先隔离副本并重绑；共享关系或安全隔离能力不明时，说明具体影响并询问是否改共享资源，其余独立修改可先完成。

## 校验与交付

版本冲突先重新读取目标，按具体字段修正，不盲目重放旧修改。报告实际改动的卡片、世界书与校验结果。保存资源不会自动更新正在进行的游戏；字段改名、类型变化不能承诺保留存档旧值。静态校验不等于真实游玩验证，只有用户授权时另做。
