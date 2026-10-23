# 人物卡命令兼容范围

正式游戏消息页面和人物卡脚本的 `triggerSlash()` 当前支持：

- `/setinput 文本`：填入草稿，不发送；后面的内容按文本处理。
- `/send 文本 | /trigger`：发送文本并生成回复。
- `/trigger`：基于当前已保存的消息生成回复。
- `/pass 文本`（别名 `/return`）：返回文本。
- `/findentry file="世界书名称" field=key 关键词`（别名 `/findlore`、`/findwi`）：查找本局世界书中的条目 UID；未匹配时返回空字符串。
- `/ejs`、`/ejs-refresh`：交给完整提示词模板运行时。
- 其他单条命令：交给当前宿主已注册的命令。

正式游戏目前不支持通用 SillyTavern 命令管道和 `/cut` 删除楼层。例如 `/send 创建结果 | /cut 0 | /trigger` 会在修改草稿或发送前明确报错，不会把 `/cut 0` 当成正文，也不会跳过删除后继续生成。

已创建游戏的楼层删除必须同步处理剧情记录、会话投影与回退存档，不能通过只删除界面元素或忽略命令模拟成功。准备页的开局管道在写入正式会话前处理，范围见下文。

## 只读命令与返回值

`/pass` 和 `/findentry` 可以组成只读管道，后续参数中的 `{{pipe}}` 替换为上一步结果，例如：

```text
/pass 本局世界书 | /findentry file="{{pipe}}" field=comment 角色档案 | /pass UID={{pipe}}
```

整条管道会先校验，再执行。只读命令不能与 `/send`、`/trigger`、`/cut` 或未知命令混合；这些组合会在提交消息之前明确报错。字面管道符使用 `\|`，或放在完整引号内，例如 `/pass "a|b"`。管道替换后的文本不会再次解析成命令。这里的 `/pass` 是文本返回能力，不实现 STScript 闭包、通用宏或变量表达式求值。

`/findentry` 的范围与 `getWorldbook()` 一致：只访问本局绑定的世界书快照，可用其名称或 `file=current`，不能任意访问资料库中的其他书。支持字段 `key`（默认）、`keysecondary`、`comment`、`name`、`content`、`uid`。命名参数放在查询文本前；含空格的书名需要引号。匹配先选不区分大小写的完整相等值，再选子字符串；不实现 SillyTavern 的 Fuse 模糊相似度匹配，不能保证拼写近似词得到相同结果。

只读命令返回字符串，UID `0` 保留为 `"0"`。生成命令保留原有 `{ submitted: true }` 返回约定。人物卡事件内触发生成时，在提交成功后返回，避免等待生成所需的同一事件队列；其他生成调用继续等待本轮结束。脚本切换至后台、存档版本变化或事件已结束后，旧命令会被拒绝。

正式消息 iframe 和共享脚本沙箱都通过经过来源校验的桥接调用命令；不支持的 Helper 方法会返回明确错误，不再留下永久挂起的 Promise。

语义参考：[SillyTavern `/pass`](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/slash-commands.js) 与 [`/findentry`](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/world-info.js)；以上范围是 DSH 当前实现的明确子集。

## 开局准备页

准备页现在也提供 `triggerSlash` 和 `TavernHelper.triggerSlash`：

- `/send 文本 | /trigger`：按填写内容开始游戏并提交首轮输入。
- `/sys 文本 | /trigger`：保存系统设定，再开始生成。
- `/sys 文本 | /cut 0 | /trigger`：在创建会话前移除当前准备页开场，保留其 MVU 变量，保存系统设定并开始生成。
- `/send 文本`、`/sys 文本`（单独一条，不带 `/trigger`）：只把内容记进准备草稿，不开局；卡在这两步之间保存自己的数据时页面仍然挂着，等到随后的 `/trigger` 才真正开始。卡始终不发 `/trigger` 时，页面安静 2 秒后仍按记下的内容开局，与 SillyTavern 里 `/send` 直接生成的行为一致。
- `/trigger`：开始游戏并继续生成；之前记下的 `/send` 文本成为首轮输入，记下的 `/sys` 文本成为开局系统楼层。

系统设定以系统消息保存在本局，并通过首轮 Frame 的系统角色提示进入模型上下文；不会冒充角色回复。管道先整体校验，非法命令不修改准备草稿。`/cut 0` 仅限上述准备页管道，不用于已创建的游戏历史，也不支持其他楼层。字面管道符可写为 `\|`。重复提交会合并；准备阶段失败后，即使卡已清空表单，程序仍显示错误和“重试开局”按钮。
