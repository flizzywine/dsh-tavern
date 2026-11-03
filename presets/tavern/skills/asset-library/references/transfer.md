# 安装、更新与导出素材包

下面的动作都属于 `tavern_assets_transfer`，另有注明的除外。检查、下载和导出不收费，也不会授予模组执行权限。

## 从 ZIP 或链接安装

1. 本地 ZIP：`inspect {kind:'pack', file}`，文件放在工作台目录里。链接：`download {url}` 开始下载，用 `status {jobId}` 查询进度，完成后按返回的结果继续检查；暂停、继续、取消用 `control`。
2. 把检查结果用人话告诉用户：包名、包含哪些素材、来自非官方来源时的风险提示、含模组时的提醒、与已安装包的冲突。
3. 按用户的选择 `apply-pack`（宿主会弹出导入确认），`decision` 为 `install`（新装）、`update`（替换同一个包）、`keep-both`（另存一份）、`noop` 或 `cancel`。集合包的每个子包分别应用。

检查结果有时效；收到 `EXPIRED` 时重新检查，不要复用旧的 inspectionId。脚本风险等确认项由宿主弹窗向用户确认，不要替用户默认接受。

## 更新和"另存一份"的区别

- **更新**替换整个包：用户开关过的条目和触发设置会保留，其他改动（改过的名字、备注等）换成作者的版本；作者删掉的条目会消失。所有用这个包的卡都会看到新内容。
- **另存一份**生成一个新包，原包不变；新包之后不会再收到更新，需要的话再绑定到卡。

更新前若检查结果列出"会消失的、你改过的内容"，先告诉用户再应用。

## 素材目录

`tavern_assets_read catalogue` 读取目录来源、加速镜像和 revision；目录里的包用 `refresh {sourceId}` 取得，`updates {packIds}` 检查已装包有没有新版本。这些只返回候选，不会自动安装。修改目录来源或加速镜像用 `tavern_assets_patch catalogue-settings {expectedRevision, sources, preferredDownloadId?, mirrorPrefix?}`，这是全局设置，先说明会影响所有卡再写入。

## 导出

`export-pack {packs:[{packId, expectedRevision}], output}` 把一个或多个包导出为工作台里的 ZIP。`output` 指向一个还不存在的文件，已存在会被拒绝。全局启用状态和执行授权不会导出。

## 完成标准

安装或更新：回执成功，再用 `tavern_assets_read list` 能看到该包和新 revision；需要的话继续绑定到卡。导出：报告 ZIP 路径、大小和包含的包。下载失败或文件指纹不符时报告原因，不强制安装。
