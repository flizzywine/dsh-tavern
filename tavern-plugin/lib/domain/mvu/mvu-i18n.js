// MVU 服务端 i18n（中文文案，移植自 MagVarUpdate src/i18n/messages/runtime.ts）

const MESSAGES = {
    'runtime.variableUpdate.unknownCommand': '未知命令',
    'runtime.variableUpdate.errorTitle': '[MVU]发生变量更新错误，可能需要重 Roll：{command}',
    'runtime.variableUpdate.errorDetail': '错误详情：{detail}',
    'runtime.variableUpdate.setPathMissing':
        'stat_data 中不存在路径“{path}”，已跳过 set 命令。{reason}',
    'runtime.variableUpdate.assignPrimitive':
        '路径“{path}”保存的是原始值（{type}），无法向其中 assign；已跳过操作。{reason}',
    'runtime.variableUpdate.mergeNonExtensibleObject':
        'SCHEMA 违规：无法向路径“{path}”处不可扩展的对象合并数据。{reason}',
    'runtime.variableUpdate.assignUnknownKey':
        'SCHEMA 违规：无法向路径“{path}”处不可扩展的对象写入新键“{key}”。{reason}',
    'runtime.variableUpdate.assignNonExtensibleArray':
        'SCHEMA 违规：无法向路径“{path}”处不可扩展的数组写入元素。{reason}',
    'runtime.variableUpdate.assignMissingParent':
        '路径“{path}”不存在，且其父级不可扩展，无法向其中 assign。{reason}',
    'runtime.variableUpdate.mergeArrayIntoObject': '无法将数组合并到路径“{path}”处的对象中。',
    'runtime.variableUpdate.mergeNonObjectIntoObject': '无法将非对象值合并到路径“{path}”处的对象中。',
    'runtime.variableUpdate.templateResolutionFailed':
        '解析路径“{path}”处的模板元数据失败：{cause}',
    'runtime.variableUpdate.assignInvalidArguments': '路径“{path}”上的 _.assign 参数无效。',
    'runtime.variableUpdate.removePathUndefined': '_.remove 命令中的路径“{path}”未定义。',
    'runtime.variableUpdate.deleteTargetUndetermined':
        '无法确定路径“{path}”上的命令要删除的目标。{reason}',
    'runtime.variableUpdate.removePathMissing': '无法从不存在的路径“{path}”中删除内容。{reason}',
    'runtime.variableUpdate.removeNonExtensibleArray':
        'SCHEMA 违规：无法从路径“{path}”处不可扩展的数组中删除元素。{reason}',
    'runtime.variableUpdate.removeRequiredKey':
        'SCHEMA 违规：无法从路径“{path}”中删除必需键“{key}”。{reason}',
    'runtime.variableUpdate.removeNonCollection':
        '路径“{path}”处的值不是数组或对象，无法从中删除内容；已跳过命令。{reason}',
    'runtime.variableUpdate.removeExecutionFailed': '无法在路径“{path}”上执行 remove。',
    'runtime.variableUpdate.addPathMissing':
        'stat_data 中不存在路径“{path}”，已跳过 add 命令。{reason}',
    'runtime.variableUpdate.dateDeltaNotNumber':
        '日期操作的增量“{delta}”不是数字，已跳过 add 命令。{reason}',
    'runtime.variableUpdate.deltaNotNumber': '增量“{delta}”不是数字，已跳过 add 命令。{reason}',
    'runtime.variableUpdate.addUnsupportedValue':
        '路径“{path}”处的值不是日期或数字，已跳过 add 命令。{reason}',
    'runtime.variableUpdate.addInvalidArguments': '路径“{path}”上的 _.add 参数数量无效。{reason}',
}

export function tr(key, params = {}) {
    let text = MESSAGES[key] ?? key
    for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll('{' + name + '}', String(value ?? ''))
    }
    return text
}
