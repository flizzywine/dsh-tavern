import { defineMessages } from '@/i18n/messages/types';

export const runtimeMessages = defineMessages({
    'runtime.common.mvuTitle': {
        'zh-CN': '[MVU]',
        en: '[MVU]',
    },
    'runtime.common.errorCause': {
        'zh-CN': '错误详情：{cause}',
        en: 'Error details: {cause}',
    },
    'runtime.common.unknown': {
        'zh-CN': '未知',
        en: 'Unknown',
    },

    'runtime.main.chatReinitializeFailedLog': {
        'zh-CN': '[MVU]切换聊天后重新初始化失败',
        en: '[MVU] Failed to reinitialize after switching chats',
    },
    'runtime.main.reinitializeFailedTitle': {
        'zh-CN': '[MVU]重新初始化失败',
        en: '[MVU] Reinitialization failed',
    },
    'runtime.main.minimumVersionRequired': {
        'zh-CN': 'MVU 变量框架需要酒馆助手版本不低于 {version}',
        en: 'MVU Variable Framework requires Tavern Helper {version} or later',
    },
    'runtime.main.versionIncompatibleTitle': {
        'zh-CN': '版本不兼容',
        en: 'Incompatible version',
    },

    'runtime.parseString.invalidFormat': {
        'zh-CN': '要解析的字符串不是有效的 YAML/JSON/JSON5 格式',
        en: 'The input is not valid YAML, JSON, or JSON5',
    },
    'runtime.parseString.content': {
        'zh-CN': '字符串内容',
        en: 'Input',
    },
    'runtime.parseString.yamlError': {
        'zh-CN': 'YAML 错误信息',
        en: 'YAML error',
    },
    'runtime.parseString.json5Error': {
        'zh-CN': 'JSON5 错误信息',
        en: 'JSON5 error',
    },
    'runtime.parseString.jsonError': {
        'zh-CN': 'JSON 错误信息',
        en: 'JSON error',
    },

    'runtime.button.initVarDataNotFound': {
        'zh-CN': '没有找到 InitVar 数据',
        en: 'No InitVar data was found',
    },
    'runtime.button.initVarDataLoadFailed': {
        'zh-CN': '加载 InitVar 数据失败:',
        en: 'Failed to load InitVar data',
    },
    'runtime.button.messageNotFound': {
        'zh-CN': '没有找到消息',
        en: 'No message was found',
    },
    'runtime.button.initVarDescriptionsUpdated': {
        'zh-CN': 'InitVar描述已更新',
        en: 'InitVar descriptions updated',
    },
    'runtime.button.snapshotPrompt': {
        'zh-CN':
            '<h4>设置快照楼层可以避免指定的楼层在清理操作中被移除变量信息</h4>请填写要保留变量信息的楼层（如 10 为第 10 层）<br><strong>后续楼层的重演将可以从这一层开始</strong>',
        en: '<h4>Marking a floor as a snapshot prevents its variable data from being removed during cleanup.</h4>Enter the floor whose variable data should be retained (for example, 10 for floor 10).<br><strong>Later floors can then be replayed starting from this floor.</strong>',
    },
    'runtime.button.invalidFloorInput': {
        'zh-CN': '请输入有效的楼层数，你输入的是“{value}”',
        en: 'Enter a valid floor number. You entered “{value}”.',
    },
    'runtime.button.invalidFloor': {
        'zh-CN': '无效的楼层“{value}”',
        en: 'Invalid floor “{value}”.',
    },
    'runtime.button.snapshotConfigureFailedTitle': {
        'zh-CN': '[MVU]配置楼层快照失败',
        en: '[MVU] Failed to configure floor snapshot',
    },
    'runtime.button.snapshotConfigureTitle': {
        'zh-CN': '[MVU]配置楼层快照',
        en: '[MVU] Configure floor snapshot',
    },
    'runtime.button.snapshotConfigured': {
        'zh-CN': '已将 {floor} 层配置为快照楼层',
        en: 'Floor {floor} is now a snapshot floor',
    },
    'runtime.button.replayPrompt': {
        'zh-CN':
            '<h4>当变量更新出现 required/extensible 相关问题时，可以尝试从过去的楼层重演</h4>请填写要进行重演的楼层（如 10 为第 10 层，-1 为最新楼层）<br><strong>也就是出现问题的楼层</strong>',
        en: '<h4>If variable updates have required/extensible issues, replaying from an earlier floor may help.</h4>Enter the floor to replay (for example, 10 for floor 10, or -1 for the latest floor).<br><strong>This should be the floor where the problem occurred.</strong>',
    },
    'runtime.button.replayFailedTitle': {
        'zh-CN': '[MVU]楼层重演失败',
        en: '[MVU] Floor replay failed',
    },
    'runtime.button.replayNoAvailableFloor': {
        'zh-CN': '无法找到可以进行重演的楼层',
        en: 'No floor with replayable variable data was found',
    },
    'runtime.button.replayStartPrompt': {
        'zh-CN': '请填写从哪个楼层开始重演，找到最近的支持重演楼层为 [{floor}]',
        en: 'Enter the floor from which to start replaying. The nearest replayable floor is [{floor}].',
    },
    'runtime.button.replayNeedsVariables': {
        'zh-CN': '请输入含变量信息的楼层，你输入的是“{value}”',
        en: 'Enter a floor that contains variable data. You entered “{value}”.',
    },
    'runtime.button.replayProgress': {
        'zh-CN': '处理变量中（{processed} / {total}）',
        en: 'Processing variables ({processed} / {total})',
    },
    'runtime.button.replayingFloorLog': {
        'zh-CN': '正在重演 {index}，内容：{content}',
        en: 'Replaying {index}. Content: {content}',
    },
    'runtime.button.replayTitle': {
        'zh-CN': '[MVU]楼层重演',
        en: '[MVU] Floor replay',
    },
    'runtime.button.replayCompleted': {
        'zh-CN': '已将 {floor} 层变量状态重演完毕，共重演 {count} 楼',
        en: 'Variable state replay for floor {floor} is complete ({count} floors replayed)',
    },
    'runtime.button.extraModelNotEnabled': {
        'zh-CN': '当前配置没有启用额外模型解析，不需要进行此操作',
        en: 'Extra-model parsing is not enabled by the current configuration',
    },
    'runtime.button.extraModelToolCallingUnsupported': {
        'zh-CN': '当前 TavernHelper 版本或配置指定的 LLM 不支持工具调用，请调整额外模型解析设置',
        en: 'The current TavernHelper version or configured LLM does not support tool calling. Adjust the extra-model parsing settings.',
    },
    'runtime.button.extraModelUnsupportedByCard': {
        'zh-CN': '当前角色卡不支持额外模型解析，无法进行此操作',
        en: 'The current character card does not support extra-model parsing',
    },
    'runtime.button.extraModelRetryTitle': {
        'zh-CN': '[MVU]重试额外模型解析',
        en: '[MVU] Retry extra-model parsing',
    },
    'runtime.button.extraModelParsingCompleted': {
        'zh-CN': '解析完成',
        en: 'Parsing completed',
    },
    'runtime.button.cleanupPrompt': {
        'zh-CN':
            '<h4>清除旧楼层变量信息以减小聊天文件大小，避免手机崩溃</h4>请填写要保留变量信息的楼层数（如 10 为保留最后 10 层，每 [{interval}] 层保留一层作为快照）<br><strong>注意：你需要通过重演才能回退游玩到未保留变量信息的楼层</strong>',
        en: '<h4>Remove variable data from old floors to reduce chat file size and help prevent mobile crashes.</h4>Enter how many recent floors to retain (for example, 10 retains the latest 10 floors, with one snapshot every [{interval}] floors).<br><strong>Note: you must replay variables before returning to floors whose variable data was removed.</strong>',
    },
    'runtime.button.cleanupFailedTitle': {
        'zh-CN': '[MVU]清理旧楼层变量失败',
        en: '[MVU] Failed to clean old floor variables',
    },
    'runtime.button.cleanupSucceededTitle': {
        'zh-CN': '[MVU]清理旧楼层变量成功',
        en: '[MVU] Old floor variables cleaned',
    },
    'runtime.button.cleanupCompleted': {
        'zh-CN': '已清理旧变量，保留了最后 {depth} 层的变量',
        en: 'Old variables were cleaned; variables for the latest {depth} floors were retained',
    },
    'runtime.button.snapshotMarkedLog': {
        'zh-CN': '将 [{floor}] 层作为快照楼层',
        en: 'Marked floor [{floor}] as a snapshot floor',
    },

    'runtime.characterOverride.worldbookReadFailed': {
        'zh-CN': '无法读取角色世界书“{worldbook}”',
        en: 'Unable to read character lorebook “{worldbook}”',
    },
    'runtime.characterOverride.contentMustBeObject': {
        'zh-CN': '配置正文必须是 JSON 对象',
        en: 'The settings content must be a JSON object',
    },
    'runtime.characterOverride.conflictPrompt': {
        'zh-CN':
            '角色世界书“{worldbook}”中的 {entry} 已被其他来源修改。是否使用待保存的角色卡配置覆盖它？',
        en: '{entry} in character lorebook “{worldbook}” was modified by another source. Overwrite it with the pending character-card configuration?',
    },
    'runtime.characterOverride.overwriteButton': {
        'zh-CN': '覆盖',
        en: 'Overwrite',
    },
    'runtime.characterOverride.loadLatestButton': {
        'zh-CN': '加载最新配置',
        en: 'Load latest configuration',
    },
    'runtime.characterOverride.bindingReadFailedLog': {
        'zh-CN': '[MVU]读取角色世界书绑定失败',
        en: '[MVU] Failed to read the character lorebook binding',
    },
    'runtime.characterOverride.readFailedLog': {
        'zh-CN': '[MVU]读取角色卡配置失败',
        en: '[MVU] Failed to read the character-card configuration',
    },
    'runtime.characterOverride.readFailedTitle': {
        'zh-CN': '[MVU]读取角色卡配置失败',
        en: '[MVU] Failed to read character-card configuration',
    },
    'runtime.characterOverride.stopWithUnsavedChangesLog': {
        'zh-CN': '[MVU]停止角色卡配置控制器时仍未能保存“{worldbook}”中的修改',
        en: '[MVU] Changes in “{worldbook}” were still unsaved when the character-card configuration controller stopped',
    },
    'runtime.characterOverride.reloadFailedLog': {
        'zh-CN': '[MVU]重新读取角色卡配置失败',
        en: '[MVU] Failed to reload the character-card configuration',
    },
    'runtime.characterOverride.reloadFailedTitle': {
        'zh-CN': '[MVU]重新读取角色卡配置失败',
        en: '[MVU] Failed to reload character-card configuration',
    },
    'runtime.characterOverride.duplicateEntries': {
        'zh-CN':
            '角色世界书“{worldbook}”中存在 {count} 个关闭的 {entry} 条目，仅使用扫描到的第一个。',
        en: 'Character lorebook “{worldbook}” contains {count} disabled {entry} entries. Only the first scanned entry will be used.',
    },
    'runtime.characterOverride.duplicateEntriesTitle': {
        'zh-CN': '[MVU]角色卡配置重复',
        en: '[MVU] Duplicate character-card configuration',
    },
    'runtime.characterOverride.invalidWorldbookData': {
        'zh-CN': '角色世界书“{worldbook}”的数据格式无效',
        en: 'Character lorebook “{worldbook}” has an invalid data format',
    },
    'runtime.characterOverride.invalidConfigurationLog': {
        'zh-CN': '[MVU]角色世界书“{worldbook}”的 {entry} 配置无效',
        en: '[MVU] The {entry} configuration in character lorebook “{worldbook}” is invalid',
    },
    'runtime.characterOverride.invalidConfiguration': {
        'zh-CN': '角色世界书“{worldbook}”中的配置无效，已按不存在处理：{cause}',
        en: 'The configuration in character lorebook “{worldbook}” is invalid and will be treated as absent: {cause}',
    },
    'runtime.characterOverride.invalidConfigurationTitle': {
        'zh-CN': '[MVU]角色卡配置无效',
        en: '[MVU] Invalid character-card configuration',
    },
    'runtime.characterOverride.saveFailedLog': {
        'zh-CN': '[MVU]保存角色卡配置失败',
        en: '[MVU] Failed to save the character-card configuration',
    },
    'runtime.characterOverride.saveFailedTitle': {
        'zh-CN': '[MVU]保存角色卡配置失败',
        en: '[MVU] Failed to save character-card configuration',
    },

    'runtime.cleanup.title': {
        'zh-CN': '[MVU]自动清理',
        en: '[MVU] Automatic cleanup',
    },
    'runtime.cleanup.legacyPrompt': {
        'zh-CN':
            '检测到可以清理本聊天文件中的旧变量以减小文件体积，是否清理？（备份会消耗较多内存，手机上建议关闭其他后台应用后进行，或在计算机上备份）',
        en: 'Old variables can be removed from this chat to reduce its file size. Clean them now? (Creating a backup uses considerable memory; on mobile, close other background apps first or create the backup on a computer.)',
    },
    'runtime.cleanup.cleanOnlyButton': {
        'zh-CN': '仅清理',
        en: 'Clean only',
    },
    'runtime.cleanup.doNotRemindButton': {
        'zh-CN': '不再提醒',
        en: 'Do not remind me again',
    },
    'runtime.cleanup.backupAndCleanButton': {
        'zh-CN': '备份并清理',
        en: 'Back up and clean',
    },
    'runtime.cleanup.starting': {
        'zh-CN': '即将开始清理旧聊天记录中的变量…',
        en: 'Cleaning variables from old chat messages…',
    },
    'runtime.cleanup.startingWithBackup': {
        'zh-CN': '即将开始清理旧聊天记录中的变量，并自动生成备份…',
        en: 'Creating a backup, then cleaning variables from old chat messages…',
    },
    'runtime.cleanup.exportFailed': {
        'zh-CN': '聊天记录导出失败，放弃清理：{cause}',
        en: 'Chat export failed; cleanup was cancelled: {cause}',
    },
    'runtime.cleanup.exportSucceeded': {
        'zh-CN': '聊天记录导出成功：{message}',
        en: 'Chat exported successfully: {message}',
    },
    'runtime.cleanup.cleanedMessages': {
        'zh-CN': '已清理旧聊天记录中的 {count} 条消息',
        en: 'Cleaned {count} messages from the old chat history',
    },
    'runtime.cleanup.cleanedFloorsLog': {
        'zh-CN': '[MVU]已清理 {count} 层的消息',
        en: '[MVU] Cleaned messages on {count} floors',
    },
    'runtime.cleanup.restoreNotNeededLog': {
        'zh-CN': '最近 {count} 层都包含变量数据，不需要进行恢复。',
        en: 'All of the latest {count} floors contain variable data; restoration is not needed.',
    },
    'runtime.cleanup.restoreUnavailable': {
        'zh-CN': '在 0～{floor} 层找不到有效的变量信息，无法进行楼层变量恢复',
        en: 'No valid variable data was found between floors 0 and {floor}; floor variables cannot be restored',
    },
    'runtime.cleanup.restoreTitle': {
        'zh-CN': '[MVU]恢复旧楼层变量',
        en: '[MVU] Restore old floor variables',
    },

    'runtime.initvar.noMessagesLog': {
        'zh-CN': '不存在任何一条消息，退出',
        en: 'No messages exist; initialization stopped',
    },
    'runtime.initvar.greetingRequired': {
        'zh-CN': '需要有开场白才能初始化变量',
        en: 'A greeting message is required to initialize variables',
    },
    'runtime.initvar.initializationFailedTitle': {
        'zh-CN': '[MVU]变量初始化失败',
        en: '[MVU] Variable initialization failed',
    },
    'runtime.initvar.oldLorebookFormatLog': {
        'zh-CN': '检测到旧的 initialized_lorebooks 数组格式，正在迁移到新的对象格式。',
        en: 'Old initialized_lorebooks array format detected. Migrating to the new object format.',
    },
    'runtime.initvar.chatVariablesInitializedLog': {
        'zh-CN': '聊天变量已初始化。',
        en: 'Chat variables initialized.',
    },
    'runtime.initvar.blockParseFailedLog': {
        'zh-CN': '解析 initvar 块失败：{cause}',
        en: 'Failed to parse initvar block: {cause}',
    },
    'runtime.initvar.initializationCompletedLog': {
        'zh-CN': '变量初始化完成',
        en: 'Variable initialization completed',
    },
    'runtime.initvar.initializationSucceeded': {
        'zh-CN': '已加载新的世界书初始化变量，当前使用世界书：<br>{books}',
        en: 'New lorebook initialization variables were loaded. Active lorebooks:<br>{books}',
    },
    'runtime.initvar.initializationSucceededTitle': {
        'zh-CN': '[MVU]变量初始化成功',
        en: '[MVU] Variable initialization succeeded',
    },
    'runtime.initvar.primaryLorebookReadFailedLog': {
        'zh-CN': '获取角色主 lorebook 失败，已忽略',
        en: 'Failed to obtain the primary character lorebook; ignoring it',
    },
    'runtime.initvar.entryParseFailedLog': {
        'zh-CN': '解析世界书条目“{comment}”失败：{cause}',
        en: 'Failed to parse lorebook entry “{comment}”: {cause}',
    },
    'runtime.initvar.entryParseFailedTitle': {
        'zh-CN': '[MVU]解析世界书条目“{comment}”失败',
        en: '[MVU] Failed to parse lorebook entry “{comment}”',
    },
    'runtime.initvar.noMessages': {
        'zh-CN': '不存在任何一条消息',
        en: 'No messages exist',
    },

    'runtime.notification.settingsUiUpdatedTitle': {
        'zh-CN': '[MVU]已更新独立配置界面',
        en: '[MVU] Dedicated settings panel updated',
    },
    'runtime.notification.settingsUiUpdatedBody': {
        'zh-CN': '配置界面位于酒馆扩展界面中的“正则”下方，请点开了解新功能或自定义配置',
        en: 'The settings panel is located below “Regex” in SillyTavern Extensions. Open it to review new features or customize MVU.',
    },
    'runtime.notification.autoCleanupFeatureTitle': {
        'zh-CN': '[MVU]已更新自动清理旧变量功能',
        en: '[MVU] Automatic cleanup updated',
    },
    'runtime.notification.autoCleanupFeatureBody': {
        'zh-CN':
            'MVU 现在可以自动清理旧变量来减少聊天文件大小；这不会影响你回退游玩以前的楼层。可在设置中开启“变量自动清理”。',
        en: 'MVU can now automatically remove old variable data to reduce chat file size without preventing you from returning to earlier floors. Enable Automatic Variable Cleanup in settings.',
    },
    'runtime.notification.customApiOptionsTitle': {
        'zh-CN': '[MVU]已更新更多自定义 API 配置',
        en: '[MVU] More custom API options added',
    },
    'runtime.notification.customApiOptionsBody': {
        'zh-CN':
            'MVU 现在可以自定义 API 的温度、频率惩罚、存在惩罚和最大回复 token 数；需要酒馆助手版本 >= 4.0.14。',
        en: 'MVU now supports custom API temperature, frequency penalty, presence penalty, and maximum response tokens. TavernHelper >= 4.0.14 is required.',
    },
    'runtime.notification.cleanupDefaultTitle': {
        'zh-CN': '[MVU]已更新自动清理配置',
        en: '[MVU] Automatic cleanup settings updated',
    },
    'runtime.notification.cleanupDefaultBody': {
        'zh-CN': 'MVU 现在会自动清理较老楼层上的变量信息，以降低聊天文件大小。',
        en: 'MVU now automatically removes variable data from older floors to reduce chat file size.',
    },
    'runtime.notification.builtinJailbreakTitle': {
        'zh-CN': '[MVU]已内置破限',
        en: '[MVU] Built-in jailbreak prompt added',
    },
    'runtime.notification.builtinJailbreakBody': {
        'zh-CN':
            '现在，额外模型解析如果取消“发送预设”，则会使用内置的破限提示词——既避免写作任务又避免道歉。',
        en: 'When Send Preset is disabled, extra-model parsing now uses a built-in jailbreak prompt designed to avoid both writing tasks and refusals.',
    },
    'runtime.notification.concurrentRequestsTitle': {
        'zh-CN': '[MVU]已支持同时多次请求变量更新',
        en: '[MVU] Concurrent variable-update requests added',
    },
    'runtime.notification.concurrentRequestsBody': {
        'zh-CN':
            '现在，你可以在“变量更新方式 → 请求策略 → 请求方式”中选择并发请求，提高额外模型解析成功率并节省时间。',
        en: 'You can now choose concurrent requests under Variable Update Method → Request Strategy → Request Method to improve extra-model parsing success rates and save time.',
    },
    'runtime.notification.buildInfo': {
        'zh-CN': '构建信息：{date}（{commit}）',
        en: 'Build: {date} ({commit})',
    },
    'runtime.notification.scriptLoadedTitle': {
        'zh-CN': '[MVU]脚本加载成功',
        en: '[MVU] Script loaded',
    },

    'runtime.filter.toolCallingUnsupported': {
        'zh-CN': '当前 TavernHelper 版本或预设/API 不支持工具调用，已退化回 `随AI输出`',
        en: 'The current TavernHelper version or preset/API does not support tool calling. Falling back to Follow AI Output.',
    },
    'runtime.filter.toolCallingUnsupportedTitle': {
        'zh-CN': '[MVU]无法使用工具调用',
        en: '[MVU] Tool calling unavailable',
    },
    'runtime.filter.globalSettingsSource': {
        'zh-CN': '用户全局配置',
        en: 'global user settings',
    },
    'runtime.filter.characterSettingsSource': {
        'zh-CN': '角色卡配置',
        en: 'character-card settings',
    },
    'runtime.filter.whitelistRegexLabel': {
        'zh-CN': '白名单正则',
        en: 'whitelist regex',
    },
    'runtime.filter.blacklistRegexLabel': {
        'zh-CN': '黑名单正则',
        en: 'blacklist regex',
    },
    'runtime.filter.invalidRegex': {
        'zh-CN': '{source}的{label}无效，已在本轮世界书条目过滤中忽略：{cause}',
        en: 'The {label} from {source} is invalid and was ignored for this lorebook filtering pass: {cause}',
    },
    'runtime.filter.invalidRegexTitle': {
        'zh-CN': '[MVU]世界书条目过滤正则无效',
        en: '[MVU] Invalid lorebook entry filter regex',
    },
    'runtime.filter.logTitle': {
        'zh-CN': '[MVU]世界书条目黑/白名单筛选结果',
        en: '[MVU] Lorebook entry allowlist/blocklist filtering results',
    },
    'runtime.regex.jsStyleSyntax': {
        'zh-CN': 'JS 风格正则需要以 /pattern/flags 形式书写',
        en: 'JavaScript-style regular expressions must use the /pattern/flags form',
    },

    'runtime.functionCalling.versionUnsupported': {
        'zh-CN': '当前酒馆助手版本为 {current}，工具调用需要酒馆助手 {required} 或更高版本',
        en: 'The current TavernHelper version is {current}. Tool calling requires TavernHelper {required} or later.',
    },
    'runtime.extraModel.characterLorebookUnavailableLog': {
        'zh-CN': '无法找到角色世界书，在多人聊天下不支持额外模型解析。',
        en: 'The character lorebook could not be found. Extra-model parsing is unavailable in group chats.',
    },
    'runtime.extraModel.v4RequiresCustomSource': {
        'zh-CN': '[MVU额外模型解析]格式化输出(v4兼容)需要额外模型来源为自定义，不能与插头相同。',
        en: '[MVU extra-model parsing] Formatted Output (v4 Compatible) requires a Custom model source and cannot use Same as Primary Connection.',
    },
    'runtime.extraModel.customIncludeBodyInvalid': {
        'zh-CN': '[MVU额外模型解析]custom_include_body 不是 YAML object，无法合并配置。',
        en: '[MVU extra-model parsing] custom_include_body is not a YAML object, so the configuration cannot be merged.',
    },
    'runtime.extraModel.saveSettingsUnavailable': {
        'zh-CN': '[MVU额外模型解析]无法获取 SillyTavern saveSettings，不能临时更新配置。',
        en: '[MVU extra-model parsing] SillyTavern saveSettings is unavailable; settings cannot be updated temporarily.',
    },
    'runtime.extraModel.openAiSettingsUnavailable': {
        'zh-CN': '[MVU额外模型解析]无法获取 SillyTavern OpenAI 设置。',
        en: '[MVU extra-model parsing] SillyTavern OpenAI settings are unavailable.',
    },
    'runtime.extraModel.openAiSettingsRestoreUnavailable': {
        'zh-CN': '[MVU额外模型解析]无法获取 SillyTavern OpenAI 设置，不能恢复配置。',
        en: '[MVU extra-model parsing] SillyTavern OpenAI settings are unavailable; the configuration cannot be restored.',
    },
    'runtime.extraModel.requesting': {
        'zh-CN': '正在请求 AI 回复…',
        en: 'Requesting an AI response…',
    },
    'runtime.extraModel.retrying': {
        'zh-CN': '正在重试（{attempt} / {total}）…',
        en: 'Retrying ({attempt} / {total})…',
    },
    'runtime.extraModel.updateInProgressTitle': {
        'zh-CN': '[MVU额外模型解析]变量更新中',
        en: '[MVU extra-model parsing] Updating variables',
    },
    'runtime.extraModel.concurrentRequests': {
        'zh-CN': '将同时请求 {count} 次 AI 回复以提高成功率…',
        en: 'Requesting {count} AI responses concurrently to improve the success rate…',
    },
    'runtime.extraModel.firstRequest': {
        'zh-CN': '将先请求一次，尝试是否能成功…',
        en: 'Trying one request first…',
    },
    'runtime.extraModel.firstRequestFailed': {
        'zh-CN': '首次请求失败，将同时请求 {count} 次 AI 回复以提高成功率…',
        en: 'The first request failed. Requesting {count} AI responses concurrently to improve the success rate…',
    },
    'runtime.extraModel.updateTagMissing': {
        'zh-CN': '[MVU额外模型解析]没有能从回复中找到<UpdateVariable>标签',
        en: '[MVU extra-model parsing] No <UpdateVariable> tag was found in the response',
    },
    'runtime.extraModel.updateCommandsInvalid': {
        'zh-CN': '[MVU额外模型解析]从回复找到了<UpdateVariable>标签，但其内的更新命令无效',
        en: '[MVU extra-model parsing] An <UpdateVariable> tag was found, but its update commands are invalid',
    },
    'runtime.extraModel.firstFloorSkippedLog': {
        'zh-CN': '[MVU]对第一层永不进行额外模型解析',
        en: '[MVU] Extra-model parsing is never performed on the first floor',
    },
    'runtime.extraModel.autoRequestDisabledLog': {
        'zh-CN': '[MVU]不自动触发额外模型解析',
        en: '[MVU] Automatic extra-model parsing is disabled',
    },
    'runtime.extraModel.updateFailed': {
        'zh-CN': '建议调整变量更新方式；可在“输入框左下角魔棒 → 日志查看器”查看具体情况',
        en: 'Try adjusting the variable update method. Open Magic Wand → Log Viewer at the lower-left of the input box for details.',
    },
    'runtime.extraModel.updateFailedTitle': {
        'zh-CN': '[MVU额外模型解析]变量更新失败',
        en: '[MVU extra-model parsing] Variable update failed',
    },

    'runtime.variableUpdate.unknownCommand': {
        'zh-CN': '未知命令',
        en: 'unknown command',
    },
    'runtime.variableUpdate.errorTitle': {
        'zh-CN': '[MVU]发生变量更新错误，可能需要重 Roll：{command}',
        en: '[MVU] Variable update error; rerolling may help: {command}',
    },
    'runtime.variableUpdate.errorDetail': {
        'zh-CN': '错误详情：{detail}',
        en: 'Error details: {detail}',
    },
    'runtime.variableUpdate.setPathMissing': {
        'zh-CN': 'stat_data 中不存在路径“{path}”，已跳过 set 命令。{reason}',
        en: "Path '{path}' does not exist in stat_data; the set command was skipped. {reason}",
    },
    'runtime.variableUpdate.assignPrimitive': {
        'zh-CN': '路径“{path}”保存的是原始值（{type}），无法向其中 assign；已跳过操作。{reason}',
        en: "Cannot assign into path '{path}' because it holds a primitive value ({type}). The operation was skipped. {reason}",
    },
    'runtime.variableUpdate.mergeNonExtensibleObject': {
        'zh-CN': 'SCHEMA 违规：无法向路径“{path}”处不可扩展的对象合并数据。{reason}',
        en: "SCHEMA VIOLATION: Cannot merge data into the non-extensible object at path '{path}'. {reason}",
    },
    'runtime.variableUpdate.assignUnknownKey': {
        'zh-CN': 'SCHEMA 违规：无法向路径“{path}”处不可扩展的对象写入新键“{key}”。{reason}',
        en: "SCHEMA VIOLATION: Cannot assign the new key '{key}' into the non-extensible object at path '{path}'. {reason}",
    },
    'runtime.variableUpdate.assignNonExtensibleArray': {
        'zh-CN': 'SCHEMA 违规：无法向路径“{path}”处不可扩展的数组写入元素。{reason}',
        en: "SCHEMA VIOLATION: Cannot assign elements into the non-extensible array at path '{path}'. {reason}",
    },
    'runtime.variableUpdate.assignMissingParent': {
        'zh-CN': '路径“{path}”不存在，且其父级不可扩展，无法向其中 assign。{reason}',
        en: "Cannot assign into the non-existent path '{path}' without an extensible parent. {reason}",
    },
    'runtime.variableUpdate.mergeArrayIntoObject': {
        'zh-CN': '无法将数组合并到路径“{path}”处的对象中。',
        en: "Cannot merge an array into the object at '{path}'.",
    },
    'runtime.variableUpdate.mergeNonObjectIntoObject': {
        'zh-CN': '无法将非对象值合并到路径“{path}”处的对象中。',
        en: "Cannot merge a non-object value into the object at '{path}'.",
    },
    'runtime.variableUpdate.templateResolutionFailed': {
        'zh-CN': '解析路径“{path}”处的模板元数据失败：{cause}',
        en: "Failed to resolve template metadata at '{path}': {cause}",
    },
    'runtime.variableUpdate.assignInvalidArguments': {
        'zh-CN': '路径“{path}”上的 _.assign 参数无效。',
        en: "Invalid arguments for _.assign at path '{path}'.",
    },
    'runtime.variableUpdate.removePathUndefined': {
        'zh-CN': '_.remove 命令中的路径“{path}”未定义。',
        en: "Path '{path}' is undefined in the _.remove command.",
    },
    'runtime.variableUpdate.deleteTargetUndetermined': {
        'zh-CN': '无法确定路径“{path}”上的命令要删除的目标。{reason}',
        en: "Could not determine the deletion target for the command at path '{path}'. {reason}",
    },
    'runtime.variableUpdate.removePathMissing': {
        'zh-CN': '无法从不存在的路径“{path}”中删除内容。{reason}',
        en: "Cannot remove from the non-existent path '{path}'. {reason}",
    },
    'runtime.variableUpdate.removeNonExtensibleArray': {
        'zh-CN': 'SCHEMA 违规：无法从路径“{path}”处不可扩展的数组中删除元素。{reason}',
        en: "SCHEMA VIOLATION: Cannot remove an element from the non-extensible array at path '{path}'. {reason}",
    },
    'runtime.variableUpdate.removeRequiredKey': {
        'zh-CN': 'SCHEMA 违规：无法从路径“{path}”中删除必需键“{key}”。{reason}',
        en: "SCHEMA VIOLATION: Cannot remove the required key '{key}' from path '{path}'. {reason}",
    },
    'runtime.variableUpdate.removeNonCollection': {
        'zh-CN': '路径“{path}”处的值不是数组或对象，无法从中删除内容；已跳过命令。{reason}',
        en: "Cannot remove from path '{path}' because it is not an array or object. The command was skipped. {reason}",
    },
    'runtime.variableUpdate.removeExecutionFailed': {
        'zh-CN': '无法在路径“{path}”上执行 remove。',
        en: "Failed to execute remove at path '{path}'.",
    },
    'runtime.variableUpdate.addPathMissing': {
        'zh-CN': 'stat_data 中不存在路径“{path}”，已跳过 add 命令。{reason}',
        en: "Path '{path}' does not exist in stat_data; the add command was skipped. {reason}",
    },
    'runtime.variableUpdate.dateDeltaNotNumber': {
        'zh-CN': '日期操作的增量“{delta}”不是数字，已跳过 add 命令。{reason}',
        en: "Delta '{delta}' for the date operation is not a number; the add command was skipped. {reason}",
    },
    'runtime.variableUpdate.deltaNotNumber': {
        'zh-CN': '增量“{delta}”不是数字，已跳过 add 命令。{reason}',
        en: "Delta '{delta}' is not a number; the add command was skipped. {reason}",
    },
    'runtime.variableUpdate.addUnsupportedValue': {
        'zh-CN': '路径“{path}”处的值不是日期或数字，已跳过 add 命令。{reason}',
        en: "The value at path '{path}' is not a date or number; the add command was skipped. {reason}",
    },
    'runtime.variableUpdate.addInvalidArguments': {
        'zh-CN': '路径“{path}”上的 _.add 参数数量无效。{reason}',
        en: "Invalid number of arguments for _.add at path '{path}'. {reason}",
    },

    'runtime.apiProfile.nameRequired': {
        'zh-CN': 'API 方案名称不能为空',
        en: 'API profile name cannot be empty',
    },
    'runtime.apiProfile.notFound': {
        'zh-CN': '未找到 API 方案：{name}',
        en: 'API profile not found: {name}',
    },
    'runtime.apiProfile.selectOrEnterName': {
        'zh-CN': '请先输入或选择一个 API 方案名称',
        en: 'Enter or select an API profile name first',
    },
    'runtime.apiProfile.alreadyExists': {
        'zh-CN': 'API 方案「{name}」已存在',
        en: 'API profile “{name}” already exists',
    },
    'runtime.apiProfile.enterNewName': {
        'zh-CN': '请先输入新方案名称',
        en: 'Enter a name for the new API profile first',
    },
    'runtime.preset.notSelected': {
        'zh-CN': '未选择额外模型预设',
        en: 'No extra-model preset was selected',
    },
    'runtime.preset.apiUnavailable': {
        'zh-CN': '当前环境未提供 getPreset 接口',
        en: 'The getPreset API is unavailable in the current environment',
    },
    'runtime.preset.readFailed': {
        'zh-CN': '无法读取预设“{name}”',
        en: 'Unable to read preset “{name}”',
    },

    'runtime.functionCall.invalidJsonPatch': {
        'zh-CN': '不是有效的 json patch',
        en: 'Invalid JSON Patch',
    },
    'runtime.functionCall.updateBlockParseFailedLog': {
        'zh-CN': '[MVU额外模型解析]无法解析变量更新块。内容：{content}；错误：{cause}',
        en: '[MVU extra-model parsing] Failed to parse the variable update block. Content: {content}; error: {cause}',
    },
    'runtime.functionCall.resultParseFailedLog': {
        'zh-CN': '[MVU额外模型解析]函数调用结果解析失败：{cause}',
        en: '[MVU extra-model parsing] Failed to parse the function-call result: {cause}',
    },
    'runtime.functionCall.formattedOutputParseFailedLog': {
        'zh-CN': '[MVU额外模型解析]格式化输出解析失败。内容：{content}；错误：{cause}',
        en: '[MVU extra-model parsing] Failed to parse formatted output. Content: {content}; error: {cause}',
    },
});
