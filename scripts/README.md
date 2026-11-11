# 开发与实验脚本

- `termux/termux-tavern.sh` 提供 Termux 下的酒馆管理入口。
- `patch-harness-perf.mjs` 对指定 Harness 安装里的会话读写常量做本地调整。用 `--check` 查看，`--revert` 恢复。
- `repro-dsh-015-session.mjs` 在指定的 DSH 0.1.5 运行时里复现会话替换和迁移行为，参数是宿主的 `node_modules/@deepseek-ai` 目录。

生产启动、安装、升级和构建入口仍在 [`bin/`](../bin/)；浏览器验证与性能基准分别在 [`tests/browser/`](../tests/browser/) 和 [`tests/performance/`](../tests/performance/)。
