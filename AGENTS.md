# DSH Tavern

## Issue 处理

- 查看 issue 时，遇到原因明确、能直接修复的小问题，直接修复并完成后续流程，无需另行征求意见；需求不清楚或涉及较大取舍时再向用户确认。
- 处理流程：定位并修复 → 跑相关测试 → 单独提交 → 按下文流程推送 → 在 issue 评论修复内容、提交和验证结果 → 关闭已解决的 issue。问题仍未解决时保留开启并说明阻碍。

## 提交

每完成一个比较大的功能点或修复，立即单独提交一次；提交只包含该功能点或修复，避免混入无关改动。如果只是很琐碎的改动，比如调整一下文本、按钮位置，则不必自动提交。

## 文档

本地写的 docs（研究记录、实验笔记、临时调研）**不提交、不推送**，只留在工作区或仓库外。有价值的结论写进提交说明或已有的功能文档，不要新增 docs 文件入库。

## 推送

用户说「推送」/「push」/「推一下」时，**默认就是 `origin` = `https://github.com/flizzywine/dsh-tavern.git`**，不必再确认远程。只有用户明确点名别的远程（例如「推到 fork」「推 bigmalove」）才换目标。

仓库里同时存在 `fork` = `https://github.com/bigmalove/dsh-tavern`，那是另一条血统（与本地 `main` 分叉数百个补丁不等价的提交）。**没有明确要求时不对它 rebase、不强推**；真要同步只能 `git merge fork/main`，或经用户明确同意后强推。

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

main 的安装入口和备用更新清单从 jsDelivr 的 `@runtime-archive-main` 读取；该分发分支只放安装脚本、清单和 `runtime.zip`，源码仍在 main。清单固定引用不可变提交中的压缩包。分支地址最长缓存 12 小时，安装入口与清单必须来自同一次发布。

每次推送后，Publish runtime manifest 工作流会核对 CDN 压缩包及四个安装入口的大小、SHA-256，只刷新内容不一致的入口。刷新接口的 HTTP 200 / `status: finished` 仍可能包含路径级 `throttled: true`；必须读取 `throttlingReset` 等待后再发请求，不能把顶层状态当成刷新成功。工作流最多等待 15 分钟，始终以实际下载内容匹配为成功条件。需要手动复核时，在已同步发布清单的干净源码副本运行：

```sh
node .github/scripts/refresh-cdn-publication.mjs flizzywine/dsh-tavern main
```

下面的单文件请求仅发送刷新操作；必须检查返回体里的路径级限流信息，并核对实际下载内容，不能仅凭命令退出码判断成功：

```sh
b=runtime-archive-main
for f in install.ps1 install.sh android/setup.sh dsh-tavern-runtime.json; do curl -s "https://purge.jsdelivr.net/gh/flizzywine/dsh-tavern@$b/$f" >/dev/null; done
curl -s https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@$b/dsh-tavern-runtime.json | grep revision
```

### CDN 体积注意事项

- 新增字体、vendor 资源或修改打包流程时，核对源码归档、运行清单和压缩包的体积。jsDelivr 曾返回 `Package size exceeded the configured limit of 50 MB`；遇到此错误先检查分发体积，不能只当作缓存滞后处理。
- `.gitattributes` 的 `export-ignore` 控制 Git 归档，运行清单的排除规则控制安装内容；两者都不能直接视为 jsDelivr 的缓存排除配置，须实际验证 CDN 能返回目标文件和最新清单。
- 优先排除测试、文档、构建专用源码和已支持按需下载的字体二进制；保留许可证、共享运行模块和 vendor 运行构建，排除前核对运行时引用及旧安装器兼容性。
- 分发分支只发布安装入口、清单和 `runtime.zip`，发布前验证安装脚本与压缩包的字节数、SHA-256 均匹配清单。保持运行压缩包小于 20,000,000 字节、分发树小于 50,000,000 字节。修改入口时同步检查安装脚本、应用内更新和缓存刷新流程；旧版仍读取 `@main` 时可通过新版安装脚本迁移，刷新旧地址不能解决源码分支超限。

## 测试

测试已有几千条，全量跑一次约 3 分钟。除非做版本发布，否则不要跑全量 `node bin/test-tavern.mjs`；只跑与改动相关的测试文件：
`node bin/test-tavern.mjs tests/<相关>.test.mjs [更多文件…]`
