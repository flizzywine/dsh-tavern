# 本地源码参考

这里存放用于核对兼容语义的第三方源码。源码目录不纳入 dsh-tavern 的 Git 历史；本文件只记录来源和查阅基线。

## 当前基线（2026-08-28）

| 项目 | 本地目录 | 分支 | 提交 |
| --- | --- | --- | --- |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | `references/SillyTavern` | `release` | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` |
| [酒馆助手 / JS-Slash-Runner](https://github.com/N0VI028/JS-Slash-Runner) | `references/JS-Slash-Runner` | `main` | `4dd4b873f191accb5dd933089ddf36b846458585` |
| [ST Prompt Template](https://github.com/zonde306/ST-Prompt-Template) | `references/ST-Prompt-Template` | `master` | `9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d` |

## 重新取得源码

```bash
git clone --depth 1 --branch release https://github.com/SillyTavern/SillyTavern.git references/SillyTavern
git clone --depth 1 --branch main https://github.com/N0VI028/JS-Slash-Runner.git references/JS-Slash-Runner
git clone https://github.com/zonde306/ST-Prompt-Template.git references/ST-Prompt-Template
git -C references/ST-Prompt-Template checkout 9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d
```

若要核对本文记录时的精确版本，可在相应目录中获取完整历史后检出上表提交。升级参考版本时，应同时更新提交号和相关研究文档，不能把新版源码与旧结论混用。
