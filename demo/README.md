# 金麦穗酒馆演示案例集

这套原创、公开、安全的案例用于演示 dsh-tavern，不依赖私人会话或受版权保护的小说文本。

## 文件

- `cards/avra-before.json`：刻意保留设定重复问题，用于演示人物卡导入和设定 Agent 修改。
- `cards/avra-after-dialogue.json`：三轮设定对话确认修改后的结果，用于核对实际写入字段。
- `cards/avra-complete.json`：包含完整字段、备选开场白、六条世界书和展示层正则美化的成品卡。
- `sources/01-avra-character.md`：人物素材。
- `sources/02-blackwheat-town.md`：世界与剧情素材，可与人物素材一起抽取。
- `scripts/the-missing-silver-bell-caravan.md`：六幕原创剧本，用于演示分块、游标、预览和剧本推荐。
- `walkthrough/product-demo.md`：逐项演示脚本与截图清单。

## 推荐路线

1. 导入 `avra-before.json`。
2. 在设定对话中先分析、不修改，再确认修改。
3. 导入两份素材，演示从素材生成另一张卡。
4. 导入 `avra-complete.json`，展示完整世界书。
5. 未绑定剧本时新开自由故事，生成与重生成候选项。
6. 绑定剧本后新开剧本故事，展示游标、预览、Guide、姿势、正文重生成与回退。
7. 使用 `avra-complete.json` 开局，展示模型原始状态文本经 `markdownOnly` 正则变成金麦穗酒馆 HTML 面板；Session 仍保留原始文本。

截图应在全新的演示数据目录中完成，避免侧栏出现真实使用记录。
