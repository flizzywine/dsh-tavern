# DSH Tavern

## 提交

每完成一个比较大的功能点或修复，立即单独提交一次；提交只包含该功能点或修复，避免混入无关改动。如果只是很琐碎的改动，比如调整一下文本、按钮位置，则不必自动提交。

## 文档

本地写的 docs（研究记录、实验笔记、临时调研）**不提交、不推送**，只留在工作区或仓库外。有价值的结论写进提交说明或已有的功能文档，不要新增 docs 文件入库。

## 推送

## 分支

- `main`：当前版本，适配 DSH 0.2.1。日常开发在这里。
- `stable`：旧稳定版，适配 DSH 0.1.5，**已停止更新**：修复只进 main，不再 cherry-pick 到 stable。两条分支的安装脚本与应用内更新各自跟随自己的分支，不要互相合并。

GitHub Actions 会频繁向 `origin/main`（以及 `origin/stable`）推送 `chore: publish runtime manifest [skip ci]`（只改 `dsh-tavern-runtime.json`），导致本地推送被拒。推送流程：

1. `git fetch origin`
2. `git log --oneline HEAD..origin/main`，确认远程只多了 manifest 提交；有其他提交先告知用户
3. `git rebase origin/main`
4. `git push origin main`

推送 `stable` 时同样操作，把 `main` 换成 `stable`。

### CDN 缓存

安装入口从 jsDelivr 的 `@main` / `@stable` 读取 `install.ps1` / `install.sh` / `dsh-tavern-runtime.json`（最长缓存 12 小时），代码文件却按清单里的提交号下载；旧安装脚本配新代码会报“安装文件不完整，缺少……”。

每次推送后，Publish runtime manifest 工作流会在发布新清单后自动刷新这三个文件的缓存，并等到 CDN 返回新清单。工作流出现 “jsDelivr still serves a stale manifest” 警告时，手动刷新：

```sh
b=main  # 或 stable
for f in install.ps1 install.sh dsh-tavern-runtime.json; do curl -s "https://purge.jsdelivr.net/gh/flizzywine/dsh-tavern@$b/$f" >/dev/null; done
curl -s https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@$b/dsh-tavern-runtime.json | grep revision
```

## 测试

测试已有几千条，全量跑一次约 3 分钟。除非做版本发布，否则不要跑全量 `node bin/test-tavern.mjs`；只跑与改动相关的测试文件：
`node bin/test-tavern.mjs tests/<相关>.test.mjs [更多文件…]`
