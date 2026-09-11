# CHAT_CHANGED includes 异常排查（2026-09-11）

## 结论

报错显示“搜索面板发送”，但原卡中该脚本只有按钮注册及发送命令，不监听 CHAT_CHANGED，也没有 includes 调用。实际触发来自卡片导入的 StageDog“自动开启角色卡局部正则”脚本：读取 `SillyTavern.extensionSettings.character_allowed_regex` 后直接调用 `includes(avatar)`。

诊断包中世界书读取成功，并不能说明紧接着的异常发生在世界书处理中。把原始自动开启脚本放入生产 Helper 宿主测试环境，派发 CHAT_CHANGED，稳定复现 `Cannot read properties of undefined (reading 'includes')`。

同时，jQuery 的 ready 回调在模块加载后延迟执行，原宿主此时已切换到其他脚本，导致事件归属登记错误。两处缺陷均先建立失败测试再修复。

## 修复

- 兼容读取返回当前人物卡的局部正则许可。Tavern 原本就执行人物卡中启用的正则，无需 SillyTavern 的按头像授权；该字段反映已有行为，不改变单条正则的启停。
- 许可随当前人物卡上下文变化，保留已有配置的其他值；运行时派生的许可不写入持久化设置。
- jQuery ready 在注册时捕获所属脚本，执行时恢复该归属，事件及错误不再借用最后加载的脚本名。

没有把字段简单补成空数组：那会让脚本继续调用本链路不需要的 builtin.saveSettings 和 reloadCurrentChat。此次不声称这两个 API 已实现；通过如实提供宿主已启用状态，原脚本无需执行该分支。

## 验证

修复前两个回归测试失败：一处为原始 includes 异常，另一处为事件错误归属。修复后两处通过，下载的原始自动开启脚本在生产 Helper 宿主中处理 CHAT_CHANGED 成功。

```sh
node --test tests/helper-*.test.mjs tests/tavern-helper-*.test.mjs tests/card-runtime-lifecycle.test.mjs tests/extract-flow.test.mjs
```

211 项全部通过；已重新生成客户端产物。本次是原脚本与生产宿主的确定性复现，未在群友的 Windows 环境执行整张卡。导入脚本、人物卡及诊断包未加入仓库。
