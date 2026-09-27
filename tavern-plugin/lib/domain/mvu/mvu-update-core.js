// MVU 变量应用核心（第二阶段 T1）
// 移植自 MagicalAstrogy/MagVarUpdate@0a730cd4 src/function/update_variables.ts
// 纯数据变换：无 DOM/浏览器依赖。事件经 mvu-events 派发；mathjs 为可选动态依赖。
//
// 依赖：lodash、yaml、mvu-events、mvu-schema、mvu-i18n、mvu-clone
import _ from 'lodash'
import { VARIABLE_EVENTS as variable_events } from './mvu-events.js'
import { emit as eventEmit } from './mvu-events.js'
import {
    assertVWD,
    isArraySchema,
    isObjectSchema,
    isValueWithDescriptionStatData,
} from './mvu-variable-def.js'
import { tr } from './mvu-i18n.js'
import { clone } from './mvu-clone.js'
import {
    cleanUpMetadata,
    generateSchema,
    getSchemaForPath,
    reconcileAndApplySchema,
} from './mvu-schema.js'
import { parseString } from './mvu-parse-string.js'

// mathjs 可选动态依赖：仅当 LLM 在指令里写了数学表达式（如 `_.add('好感度', 10+2)` 或 delta 表达式）时加载。
// 不可用时数学表达式按普通字符串处理（与上游“无法识别则原样返回”行为一致）。
let mathjsCache
export function setMathjs(module) {
    mathjsCache = module ?? null
}
function loadMath() {
    if (mathjsCache === undefined) {
        // 1. 相对探测（部署桩） 2. 裸包名 3. cwd 兜底——Windows 中文路径下
        // createRequire(import.meta.url) 的百分号编码解析会失败，cwd 兜底修正
        for (const candidate of ['./mvu-mathjs.js', 'mathjs']) {
            try {
                mathjsCache = nodeRequire(candidate)
                break
            } catch {
                /* 路径不存在 */
            }
        }
        if (mathjsCache === undefined) {
            try {
                const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'))
                mathjsCache = cwdRequire('mathjs')
            } catch {
                /* 保持 undefined：数学表达式按普通字符串处理 */
            }
        }
    }
    return mathjsCache
}

export function trimQuotesAndBackslashes(str) {
    if (!_.isString(str)) return str
    return str.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1')
}

/** 应用模板到值上，值的属性优先级高于模板 */
export function applyTemplate(value, template, strictArrayCast = false, arrayMergeConcat = true) {
    if (!template) return value

    const valueIsObject = _.isObject(value) && !Array.isArray(value) && !_.isDate(value)
    const valueIsArray = Array.isArray(value)
    const templateIsArray = Array.isArray(template)

    if (valueIsObject && !templateIsArray) {
        return _.merge({}, template, value)
    } else if (valueIsArray && templateIsArray) {
        if (arrayMergeConcat) return _.concat(value, template)
        return _.merge([], template, value)
    } else if (
        ((valueIsObject || valueIsArray) && templateIsArray !== valueIsArray) ||
        (!valueIsObject && !valueIsArray && _.isObject(template) && !Array.isArray(template))
    ) {
        console.error(
            `Template type mismatch: template is ${templateIsArray ? 'array' : 'object'}, but value is ${valueIsArray ? 'array' : 'object'}. Skipping template merge.`
        )
        return value
    } else if (!valueIsObject && !valueIsArray && templateIsArray) {
        if (strictArrayCast) return value
        if (arrayMergeConcat) return _.concat([value], template)
        return _.merge([], template, [value])
    } else {
        return value
    }
}

/** 值解析：JSON / 布尔 / null / 数学表达式（mathjs 可选）/ YAML / 去引号字符串 */
export function parseCommandValue(valStr) {
    if (typeof valStr !== 'string') return valStr
    const trimmed = valStr.trim()

    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (trimmed === 'null') return null
    if (trimmed === 'undefined') return undefined

    try {
        return JSON.parse(trimmed)
    } catch (e) {
        if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
            try {
                const result = new Function(`return ${trimmed};`)()
                if (_.isObject(result) || Array.isArray(result)) {
                    return result
                }
            } catch (err) {
                /* 非标准字面量，继续 */
            }
        }
    }

    try {
        const mathjs = loadMath()
        if (mathjs) {
            const scope = { Math: Math, math: mathjs }
            const result = mathjs.evaluate(trimmed, scope)
            if (mathjs.isComplex(result) || mathjs.isMatrix(result)) {
                return result.toString()
            }
            if (result === undefined && !/^[a-zA-Z_]+$/.test(trimmed)) {
                return trimmed
            }
            if (result !== undefined) {
                return parseFloat(result.toPrecision(12))
            }
        }
    } catch (err) {
        /* 非数学表达式 */
    }

    try {
        return YAML.parse(trimmed)
    } catch (e) {
        /* empty */
    }

    return trimQuotesAndBackslashes(valStr)
}

const COMMAND_NAMES = ['set', 'insert', 'assign', 'remove', 'unset', 'delete', 'add', 'move']

function pathSegmentsToLodashPath(pathSegments) {
    return pathSegments
        .map(segment => `["${segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
        .join('')
}

function jsonPatchPathToCommandPath(path) {
    if (!path) return ''
    const pathWithoutRoot = path.startsWith('/') ? path.substring(1) : path
    const pathSegments = pathWithoutRoot
        .split('/')
        .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    return pathSegmentsToLodashPath(pathSegments)
}

function extractJsonPatch(patch) {
    const translatedCommands = []
    for (const op of patch) {
        const path = jsonPatchPathToCommandPath(op.path ?? op.to)
        switch (op.op) {
            case 'replace':
                translatedCommands.push({
                    type: 'set',
                    full_match: JSON.stringify(op),
                    args: [path, JSON.stringify(op.value)],
                    reason: 'json_patch',
                })
                break
            case 'delta':
                translatedCommands.push({
                    type: 'add',
                    full_match: JSON.stringify(op),
                    args: [path, JSON.stringify(op.value)],
                    reason: 'json_patch',
                })
                break
            case 'insert':
            case 'add': {
                const pathParts = _.toPath(path)
                const lastPart = pathParts[pathParts.length - 1]
                const containerPath = pathSegmentsToLodashPath(pathParts.slice(0, -1))
                const keyOrIndexArg = /^\d+$/.test(lastPart) ? lastPart : JSON.stringify(lastPart)
                translatedCommands.push({
                    type: 'insert',
                    full_match: JSON.stringify(op),
                    args: [containerPath, keyOrIndexArg, JSON.stringify(op.value)],
                    reason: 'json_patch',
                })
                break
            }
            case 'remove':
                translatedCommands.push({
                    type: 'delete',
                    full_match: JSON.stringify(op),
                    args: [path],
                    reason: 'json_patch',
                })
                break
            case 'move':
                translatedCommands.push({
                    type: 'move',
                    full_match: JSON.stringify(op),
                    args: [jsonPatchPathToCommandPath(op.from), path],
                    reason: 'json_patch',
                })
                break
        }
    }
    return translatedCommands
}

/** 从正文提取全部更新命令：<json_patch> 块 + _.set/_.assign/_.remove/_.add/_.unset/_.delete lodash 伪代码 */
export function extractCommands(inputText) {
    const results = _.concat(
        [
            ...inputText.matchAll(
                /<(json_?patch)>(?:\s*```.*)?((?:(?!<json_?patch>)[\s\S])*?)(?:```\s*)?<\/\1>/gim
            ),
        ]
            .map(match => ({
                index: match.index ?? 0,
                string: match[2].trim(),
            }))
            .flatMap(({ index, string }) => {
                try {
                    const patch = parseString(string)
                    if (isJsonPatch(patch)) {
                        return extractJsonPatch(patch).map(command => ({
                            $index: index,
                            ...command,
                        }))
                    }
                } catch {
                    /* ignore */
                }
                return []
            })
    )

    let i = 0
    while (i < inputText.length) {
        const setMatch = inputText
            .substring(i)
            .match(/_\.(set|insert|assign|remove|unset|delete|add)\(/)
        if (!setMatch || setMatch.index === undefined) break

        const commandType = setMatch[1]
        const setStart = i + setMatch.index
        const openParen = setStart + setMatch[0].length

        const closeParen = findMatchingCloseParen(inputText, openParen)
        if (closeParen === -1) {
            i = openParen
            continue
        }

        let endPos = closeParen + 1
        if (endPos >= inputText.length || inputText[endPos] !== ';') {
            i = closeParen + 1
            continue
        }
        endPos++

        let comment = ''
        const potentialComment = inputText.substring(endPos).match(/^\s*\/\/(.*)/)
        if (potentialComment) {
            comment = potentialComment[1].trim()
            endPos += potentialComment[0].length
        }

        const fullMatch = inputText.substring(setStart, endPos)
        const paramsString = inputText.substring(openParen, closeParen)
        const params = parseParameters(paramsString)

        let isValid = false
        if (commandType === 'set' && params.length >= 2) isValid = true
        else if (commandType === 'assign' && params.length >= 2) isValid = true
        else if (commandType === 'insert' && params.length >= 2) isValid = true
        else if (commandType === 'remove' && params.length >= 1) isValid = true
        else if (commandType === 'unset' && params.length >= 1) isValid = true
        else if (commandType === 'delete' && params.length >= 1) isValid = true
        else if (commandType === 'add' && params.length === 2) isValid = true

        if (isValid) {
            results.push({
                $index: setStart,
                type: commandType,
                full_match: fullMatch,
                args: params,
                reason: comment,
            })
        }

        i = endPos
    }

    return _(results)
        .sortBy('$index')
        .map(command => _.omit(command, '$index'))
        .value()
}

function isJsonPatch(patch) {
    return Array.isArray(patch) && patch.every(op => op && typeof op === 'object' && typeof op.op === 'string')
}

function findMatchingCloseParen(str, startPos) {
    let parenCount = 1
    let inQuote = false
    let quoteChar = ''
    for (let i = startPos; i < str.length; i++) {
        const char = str[i]
        const prevChar = i > 0 ? str[i - 1] : ''
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
            if (!inQuote) {
                inQuote = true
                quoteChar = char
            } else if (char === quoteChar) {
                inQuote = false
            }
        }
        if (!inQuote) {
            if (char === '(') parenCount++
            else if (char === ')') {
                parenCount--
                if (parenCount === 0) return i
            }
        }
    }
    return -1
}

export function parseParameters(paramsString) {
    const params = []
    let currentParam = ''
    let inQuote = false
    let quoteChar = ''
    let bracketCount = 0
    let braceCount = 0
    let parenCount = 0

    for (let i = 0; i < paramsString.length; i++) {
        const char = paramsString[i]
        if ((char === '"' || char === "'" || char === '`') && (i === 0 || paramsString[i - 1] !== '\\')) {
            if (!inQuote) {
                inQuote = true
                quoteChar = char
            } else if (char === quoteChar) {
                inQuote = false
            }
        }
        if (!inQuote) {
            if (char === '(') parenCount++
            if (char === ')') parenCount--
            if (char === '[') bracketCount++
            if (char === ']') bracketCount--
        }
        if (char === ',' && !inQuote && parenCount === 0 && bracketCount === 0 && braceCount === 0) {
            params.push(currentParam.trim())
            currentParam = ''
            continue
        }
        currentParam += char
    }
    if (currentParam.trim()) params.push(currentParam.trim())
    return params
}

export function pathFix(path) {
    if (!path) return path

    const fixedBrackets = path.replace(/\[([^\]]*)\]/g, (_match, rawInner) => {
        let inner = rawInner.trim()
        if (!inner) return '[]'
        let wasQuoted = false
        const first = inner[0]
        const last = inner[inner.length - 1]
        if (inner.length >= 2 && (first === '"' || first === "'") && first === last) {
            wasQuoted = true
            inner = inner.slice(1, -1)
        }
        const isPureDigits = /^\d+$/.test(inner)
        const hasWhitespace = /\s/.test(inner)
        if (isPureDigits) {
            if (!wasQuoted) return `[${inner}]`
            const escaped = inner.replace(/"/g, '\\"')
            return `["${escaped}"]`
        }
        if (hasWhitespace) {
            const escaped = inner.replace(/"/g, '\\"')
            return `["${escaped}"]`
        }
        return `[${inner}]`
    })

    const fixedDots = fixedBrackets.replace(
        /(^|\.)(["'])([^"']*)\2(?=\.|\[|$)/g,
        (_match, prefix, _quote, name) => {
            const hasWhitespace = /\s/.test(name)
            const hasSpecial = /[.[\]]/.test(name)
            if (!hasWhitespace && !hasSpecial) {
                return prefix + name
            }
            const escaped = name.replace(/"/g, '\\"')
            if (prefix === '.') return `["${escaped}"]`
            return `${prefix}["${escaped}"]`
        }
    )

    return fixedDots
}

function isNullOrWhiteSpace(str) {
    return str == null || str.trim().length === 0
}

/** 单楼变量更新（更新 display_data/delta_data 镜像） */
export async function updateVariable(
    statData,
    path,
    newValue,
    reason = '',
    isRecursive = false
) {
    const displayData = statData.$internal?.display_data
    const deltaData = statData.$internal?.delta_data
    if (_.has(statData, path)) {
        const currentValue = _.get(statData, path)
        if (Array.isArray(currentValue) && currentValue.length === 2) {
            const oldValue = clone(currentValue[0])
            currentValue[0] = newValue
            _.set(statData, path, currentValue)
            const reasonStr = reason ? `(${reason})` : ''
            const displayStr = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(newValue))} ${reasonStr}`
            if (displayData) _.set(displayData, path, displayStr)
            if (deltaData) _.set(deltaData, path, displayStr)
            if (isRecursive) await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, statData, path, oldValue, newValue)
            return true
        } else {
            const oldValue = clone(currentValue)
            _.set(statData, path, newValue)
            const reasonStr = reason ? `(${reason})` : ''
            const stringNewValue = trimQuotesAndBackslashes(JSON.stringify(newValue))
            const displayStr = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${stringNewValue} ${reasonStr}`
            if (displayData) _.set(displayData, path, displayStr)
            if (deltaData) _.set(deltaData, path, displayStr)
            console.info(`Set '${path}' to '${stringNewValue}' ${reasonStr}`)
            if (isRecursive) await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, statData, path, oldValue, newValue)
            return true
        }
    }
    return false
}

function pathFixPass(_data, commands, _content) {
    for (const command of commands) {
        if (command.reason === 'json_patch') continue
        command.args[0] = pathFix(trimQuotesAndBackslashes(command.args[0]))
    }
}

/**
 * 变量更新主入口：解析正文中的更新命令并应用到变量树。
 * @returns 是否有变量被修改（is_modified）
 */
export async function updateVariables(currentMessageContent, variables) {
    const variablesBeforeUpdate = clone(variables)
    const outStatus = clone(variables)
    const deltaStatus = { stat_data: {} }

    const processedMessageContent = currentMessageContent

    const commands = extractCommands(processedMessageContent)

    _.set(variables.stat_data, '$internal', {
        display_data: outStatus.stat_data,
        delta_data: deltaStatus.stat_data || {},
    })
    await eventEmit(variable_events.VARIABLE_UPDATE_STARTED, variables)

    let errorInfo
    let currentCommand
    const outError = function (content) {
        const command = currentCommand?.full_match ?? tr('runtime.variableUpdate.unknownCommand')
        errorInfo = { command, content }
        console.warn(`${tr('runtime.variableUpdate.errorTitle', { command })}\n${content}`)
    }

    const schema = variables.schema
    const strictTemplate = schema?.strictTemplate ?? false
    const concatTemplateArray = schema?.concatTemplateArray ?? true
    const strictSet = schema?.strictSet ?? false

    for (const cmd of commands) {
        if (cmd.type === 'remove') {
            cmd.type = 'delete'
        } else if (cmd.type === 'assign') {
            cmd.type = 'insert'
        } else if (cmd.type === 'unset') {
            cmd.type = 'delete'
        }
    }

    await eventEmit(variable_events.COMMAND_PARSED, variables, commands, currentMessageContent)
    await eventEmit(variable_events.COMMAND_PARSED + '_for_zod', variables, commands, currentMessageContent)
    await eventEmit(variable_events.COMMAND_PARSED + '_ended_for_zod', variables, commands, currentMessageContent)

    pathFixPass(variables, commands, currentMessageContent)

    for (const command of commands) {
        const path = command.args[0]
        const reasonStr = command.reason ? `(${command.reason})` : ''
        let displayStr = ''
        currentCommand = command

        switch (command.type) {
            case 'set': {
                if (path !== '' && !_.has(variables.stat_data, path)) {
                    outError(tr('runtime.variableUpdate.setPathMissing', { path, reason: reasonStr }))
                    continue
                }

                let oldValue = path === '' ? clone(variables.stat_data) : _.get(variables.stat_data, path)
                let newValue = parseCommandValue(command.args.at(-1))

                if (newValue instanceof Date) newValue = newValue.toISOString()
                let isPathVWD = false

                if (
                    !strictSet &&
                    Array.isArray(oldValue) &&
                    oldValue.length === 2 &&
                    typeof oldValue[1] === 'string' &&
                    !Array.isArray(oldValue[0])
                ) {
                    const oldValueCopy = clone(oldValue[0])
                    oldValue[0] =
                        typeof oldValue[0] === 'number' && newValue !== null ? Number(newValue) : newValue
                    oldValue = oldValueCopy
                    isPathVWD = true
                } else if (typeof oldValue === 'number' && newValue !== null && typeof newValue === 'string') {
                    _.set(variables.stat_data, path, Number(newValue))
                } else if (path) {
                    _.set(variables.stat_data, path, newValue)
                } else {
                    variables.stat_data = newValue
                }

                let finalNewValue = path === '' ? variables.stat_data : _.get(variables.stat_data, path)
                assertVWD(isPathVWD, finalNewValue)
                if (isPathVWD) finalNewValue = finalNewValue[0]

                const isStrict = !strictSet
                if (isStrict && isValueWithDescriptionStatData(oldValue) && Array.isArray(finalNewValue)) {
                    displayStr = `${trimQuotesAndBackslashes(JSON.stringify(oldValue[0]))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue[0]))} ${reasonStr}`
                } else {
                    displayStr = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue))} ${reasonStr}`
                }

                console.info(`Set '${path}' to '${JSON.stringify(finalNewValue)}' ${reasonStr}`)
                await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, oldValue, finalNewValue)
                break
            }

            case 'insert':
            case 'assign': {
                const targetPath = path
                const existingValue =
                    targetPath === '' ? variables.stat_data : _.get(variables.stat_data, targetPath)
                const targetSchema = getSchemaForPath(schema, targetPath)

                if (existingValue !== null && !Array.isArray(existingValue) && !_.isObject(existingValue)) {
                    outError(
                        tr('runtime.variableUpdate.assignPrimitive', {
                            path: targetPath,
                            type: typeof existingValue,
                            reason: reasonStr,
                        })
                    )
                    continue
                }

                if (targetSchema) {
                    if (targetSchema.type === 'object' && targetSchema.extensible === false) {
                        if (command.args.length === 2) {
                            outError(
                                tr('runtime.variableUpdate.mergeNonExtensibleObject', {
                                    path: targetPath,
                                    reason: reasonStr,
                                })
                            )
                            continue
                        }
                        if (command.args.length >= 3) {
                            const newKey = String(parseCommandValue(command.args[1]))
                            if (!_.has(targetSchema.properties, newKey)) {
                                outError(
                                    tr('runtime.variableUpdate.assignUnknownKey', {
                                        key: newKey,
                                        path: targetPath,
                                        reason: reasonStr,
                                    })
                                )
                                continue
                            }
                        }
                    } else if (
                        targetSchema.type === 'array' &&
                        (targetSchema.extensible === false || targetSchema.extensible === undefined)
                    ) {
                        outError(
                            tr('runtime.variableUpdate.assignNonExtensibleArray', {
                                path: targetPath,
                                reason: reasonStr,
                            })
                        )
                        continue
                    }
                } else if (
                    targetPath !== '' &&
                    !_.get(variables.stat_data, pathSegmentsToLodashPath(_.toPath(targetPath).slice(0, -1)))
                ) {
                    outError(
                        tr('runtime.variableUpdate.assignMissingParent', {
                            path: targetPath,
                            reason: reasonStr,
                        })
                    )
                    continue
                }

                const oldValue = clone(existingValue)
                let successful = false

                if (command.args.length === 2) {
                    let valueToAssign = parseCommandValue(command.args[1])
                    if (valueToAssign instanceof Date) valueToAssign = valueToAssign.toISOString()
                    else if (Array.isArray(valueToAssign))
                        valueToAssign = valueToAssign.map(item => (item instanceof Date ? item.toISOString() : item))

                    let collection = targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path)

                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        collection = Array.isArray(valueToAssign) ? [] : {}
                        _.set(variables.stat_data, path, collection)
                    }

                    if (Array.isArray(collection)) {
                        const template =
                            targetSchema && isArraySchema(targetSchema) ? targetSchema.template : undefined
                        valueToAssign = applyTemplate(valueToAssign, template, strictTemplate, concatTemplateArray)
                        collection.push(valueToAssign)
                        displayStr = `ASSIGNED ${JSON.stringify(valueToAssign)} into array '${path}' ${reasonStr}`
                        successful = true
                    } else if (_.isObject(collection)) {
                        if (_.isObject(valueToAssign) && !Array.isArray(valueToAssign)) {
                            _.merge(collection, valueToAssign)
                            displayStr = `MERGED object ${JSON.stringify(valueToAssign)} into object '${path}' ${reasonStr}`
                            successful = true
                        } else {
                            outError(
                                tr(
                                    Array.isArray(valueToAssign)
                                        ? 'runtime.variableUpdate.mergeArrayIntoObject'
                                        : 'runtime.variableUpdate.mergeNonObjectIntoObject',
                                    { path }
                                )
                            )
                            continue
                        }
                    }
                } else if (command.args.length >= 3) {
                    let valueToAssign = parseCommandValue(command.args[2])
                    const keyOrIndex = parseCommandValue(command.args[1])

                    if (valueToAssign instanceof Date) valueToAssign = valueToAssign.toISOString()
                    else if (Array.isArray(valueToAssign))
                        valueToAssign = valueToAssign.map(item => (item instanceof Date ? item.toISOString() : item))

                    let collection = targetPath === '' ? variables.stat_data : _.get(variables.stat_data, path)

                    const template =
                        targetSchema && (isArraySchema(targetSchema) || isObjectSchema(targetSchema))
                            ? targetSchema.template
                            : undefined

                    if (Array.isArray(collection) && (typeof keyOrIndex === 'number' || keyOrIndex === '-')) {
                        const insertIndex = keyOrIndex === '-' ? collection.length : keyOrIndex
                        const positionLabel = keyOrIndex === '-' || keyOrIndex === -1 ? 'tail' : keyOrIndex
                        valueToAssign = applyTemplate(valueToAssign, template, strictTemplate, concatTemplateArray)
                        collection.splice(insertIndex, 0, valueToAssign)
                        displayStr = `ASSIGNED ${JSON.stringify(valueToAssign)} into '${path}' at index ${positionLabel} ${reasonStr}`
                        successful = true
                    } else if (_.isObject(collection)) {
                        valueToAssign = applyTemplate(valueToAssign, template, strictTemplate, concatTemplateArray)
                        collection[String(keyOrIndex)] = valueToAssign
                        displayStr = `ASSIGNED key '${keyOrIndex}' with value ${JSON.stringify(valueToAssign)} into object '${path}' ${reasonStr}`
                        successful = true
                    } else {
                        collection = {}
                        _.set(variables.stat_data, path, collection)
                        valueToAssign = applyTemplate(valueToAssign, template, strictTemplate, concatTemplateArray)
                        collection[String(keyOrIndex)] = valueToAssign
                        displayStr = `CREATED object at '${path}' and ASSIGNED key '${keyOrIndex}' ${reasonStr}`
                        successful = true
                    }
                }

                if (successful) {
                    const newValue = isNullOrWhiteSpace(path)
                        ? variables.stat_data
                        : _.get(variables.stat_data, path)
                    console.info(displayStr)
                    await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, oldValue, newValue)
                    try {
                        const currentDataClone = clone(newValue)
                        const newSchema = generateSchema(currentDataClone, targetSchema)
                        _.merge(targetSchema, newSchema)
                        cleanUpMetadata(newValue)
                    } catch (error) {
                        outError(
                            tr('runtime.variableUpdate.templateResolutionFailed', {
                                path,
                                cause: error instanceof Error ? error.message : String(error),
                            })
                        )
                    }
                } else {
                    outError(tr('runtime.variableUpdate.assignInvalidArguments', { path }))
                    continue
                }
                break
            }

            case 'unset':
            case 'delete':
            case 'remove': {
                const pathParts = _.toPath(path)
                const lastPart = pathParts[pathParts.length - 1]
                const isArrayElementPath = /^\d+$/.test(lastPart)

                if (command.args.length === 1 && isArrayElementPath) {
                    const containerPath = pathSegmentsToLodashPath(pathParts.slice(0, -1))
                    const container = _.get(variables.stat_data, containerPath)
                    const indexToRemove = parseInt(lastPart, 10)

                    if (Array.isArray(container) && indexToRemove < container.length) {
                        const originalArray = clone(container)
                        container.splice(indexToRemove, 1)
                        displayStr = `REMOVED item from '${containerPath}' at index ${indexToRemove} ${reasonStr}`
                        console.info(displayStr)
                        await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, containerPath, originalArray, container)
                        continue
                    }
                }

                if (!_.has(variables.stat_data, path)) {
                    outError(tr('runtime.variableUpdate.removePathUndefined', { path }))
                    continue
                }

                let containerPath = path
                let keyOrIndexToRemove

                if (command.args.length > 1) {
                    keyOrIndexToRemove = parseCommandValue(command.args[1])
                    if (typeof keyOrIndexToRemove === 'string') {
                        keyOrIndexToRemove = trimQuotesAndBackslashes(keyOrIndexToRemove)
                    }
                } else {
                    const pathPartsLocal = _.toPath(path)
                    const last = pathPartsLocal.pop()
                    if (last) {
                        keyOrIndexToRemove = /^\d+$/.test(last) ? Number(last) : last
                        containerPath = pathSegmentsToLodashPath(pathPartsLocal)
                    }
                }

                if (keyOrIndexToRemove === undefined) {
                    outError(
                        tr('runtime.variableUpdate.deleteTargetUndetermined', { path, reason: reasonStr })
                    )
                    continue
                }
                if (containerPath !== '' && !_.has(variables.stat_data, containerPath)) {
                    outError(tr('runtime.variableUpdate.removePathMissing', { path: containerPath, reason: reasonStr }))
                    continue
                }

                const containerSchema = getSchemaForPath(schema, containerPath)

                if (containerSchema) {
                    if (containerSchema.type === 'array') {
                        if (containerSchema.extensible !== true) {
                            outError(
                                tr('runtime.variableUpdate.removeNonExtensibleArray', {
                                    path: containerPath,
                                    reason: reasonStr,
                                })
                            )
                            continue
                        }
                    } else if (containerSchema.type === 'object') {
                        const keyString = String(keyOrIndexToRemove)
                        if (
                            _.has(containerSchema.properties, keyString) &&
                            containerSchema.properties[keyString].required === true
                        ) {
                            outError(
                                tr('runtime.variableUpdate.removeRequiredKey', {
                                    key: keyString,
                                    path: containerPath,
                                    reason: reasonStr,
                                })
                            )
                            continue
                        }
                    }
                }

                const targetToRemove =
                    command.args.length > 1 ? parseCommandValue(command.args[1]) : undefined
                let itemRemoved = false

                if (targetToRemove === undefined) {
                    const oldValue = _.get(variables.stat_data, path)
                    _.unset(variables.stat_data, path)
                    displayStr = `REMOVED path '${path}' ${reasonStr}`
                    itemRemoved = true
                    await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, oldValue, undefined)
                } else {
                    const collection = _.get(variables.stat_data, path)

                    if (!Array.isArray(collection) && !_.isObject(collection)) {
                        outError(tr('runtime.variableUpdate.removeNonCollection', { path, reason: reasonStr }))
                        continue
                    }

                    if (Array.isArray(collection)) {
                        const originalArray = clone(collection)
                        let indexToRemove = -1
                        if (typeof targetToRemove === 'number') {
                            indexToRemove = targetToRemove
                        } else {
                            indexToRemove = collection.findIndex(item => _.isEqual(item, targetToRemove))
                        }
                        if (indexToRemove >= 0 && indexToRemove < collection.length) {
                            collection.splice(indexToRemove, 1)
                            itemRemoved = true
                            displayStr = `REMOVED item from '${path}' ${reasonStr}`
                            await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, originalArray, collection)
                        }
                    } else if (_.isObject(collection)) {
                        if (typeof targetToRemove === 'number') {
                            const keys = Object.keys(collection)
                            const index = targetToRemove
                            if (index >= 0 && index < keys.length) {
                                const keyToRemove = keys[index]
                                _.unset(collection, keyToRemove)
                                itemRemoved = true
                                displayStr = `REMOVED ${index + 1}th entry ('${keyToRemove}') from object '${path}' ${reasonStr}`
                            }
                        } else {
                            const keyToRemove = String(targetToRemove)
                            if (_.has(collection, keyToRemove)) {
                                delete collection[keyToRemove]
                                itemRemoved = true
                                displayStr = `REMOVED key '${keyToRemove}' from object '${path}' ${reasonStr}`
                            }
                        }
                    }
                }

                if (itemRemoved) {
                    console.info(displayStr)
                } else {
                    outError(tr('runtime.variableUpdate.removeExecutionFailed', { path }))
                    continue
                }
                break
            }

            case 'add': {
                if (!_.has(variables.stat_data, path)) {
                    outError(tr('runtime.variableUpdate.addPathMissing', { path, reason: reasonStr }))
                    continue
                }
                const initialValue = clone(_.get(variables.stat_data, path))
                const oldValue = _.get(variables.stat_data, path)
                let valueToAdd = oldValue
                const isVWD = isValueWithDescriptionStatData(oldValue) && typeof oldValue[0] !== 'object'

                if (isVWD) {
                    assertVWD(isVWD, oldValue)
                    valueToAdd = oldValue[0]
                }

                let potentialDate = null
                if (valueToAdd instanceof Date) {
                    potentialDate = valueToAdd
                } else if (typeof valueToAdd === 'string') {
                    const parsedDate = new Date(valueToAdd)
                    if (!isNaN(parsedDate.getTime()) && isNaN(Number(valueToAdd))) {
                        potentialDate = parsedDate
                    }
                }

                if (command.args.length === 2) {
                    const delta = parseCommandValue(command.args[1])

                    if (potentialDate) {
                        if (typeof delta !== 'number') {
                            outError(
                                tr('runtime.variableUpdate.dateDeltaNotNumber', { delta: command.args[1], reason: reasonStr })
                            )
                            continue
                        }
                        const newDate = new Date(potentialDate.getTime() + delta)
                        const finalValueToSet = newDate.toISOString()

                        if (isVWD) {
                            assertVWD(isVWD, oldValue)
                            oldValue[0] = finalValueToSet
                            _.set(variables.stat_data, path, oldValue)
                        } else {
                            _.set(variables.stat_data, path, finalValueToSet)
                        }

                        const finalNewValue = _.get(variables.stat_data, path)
                        if (isVWD) {
                            displayStr = `${JSON.stringify(initialValue[0])}->${JSON.stringify(finalNewValue[0])} ${reasonStr}`
                        } else {
                            displayStr = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reasonStr}`
                        }
                        console.info(`ADDED date '${path}' from '${potentialDate.toISOString()}' to '${newDate.toISOString()}' by delta '${delta}'ms ${reasonStr}`)
                        await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, initialValue, finalNewValue)
                    } else if (typeof valueToAdd === 'number') {
                        if (typeof delta !== 'number') {
                            outError(tr('runtime.variableUpdate.deltaNotNumber', { delta: command.args[1], reason: reasonStr }))
                            continue
                        }
                        let newValue = valueToAdd + delta
                        newValue = parseFloat(newValue.toPrecision(12))
                        if (isVWD) {
                            oldValue[0] = newValue
                            _.set(variables.stat_data, path, oldValue)
                        } else {
                            _.set(variables.stat_data, path, newValue)
                        }
                        const finalNewValue = _.get(variables.stat_data, path)
                        if (isVWD) {
                            displayStr = `${JSON.stringify(initialValue[0])}->${JSON.stringify(finalNewValue[0])} ${reasonStr}`
                        } else {
                            displayStr = `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reasonStr}`
                        }
                        console.info(`ADDED number '${path}' from '${valueToAdd}' to '${newValue}' by delta '${delta}' ${reasonStr}`)
                        await eventEmit(variable_events.SINGLE_VARIABLE_UPDATED, variables.stat_data, path, initialValue, finalNewValue)
                    } else {
                        outError(tr('runtime.variableUpdate.addUnsupportedValue', { path, reason: reasonStr }))
                        continue
                    }
                } else {
                    outError(tr('runtime.variableUpdate.addInvalidArguments', { path, reason: reasonStr }))
                    continue
                }
                break
            }
        }

        if (displayStr) {
            _.set(outStatus.stat_data, path, displayStr)
            _.set(deltaStatus.stat_data, path, displayStr)
        }
    }

    variables.display_data = outStatus.stat_data
    variables.delta_data = deltaStatus.stat_data
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED, variables, variablesBeforeUpdate)
    _.unset(variables.stat_data, '$internal')

    const isModified = !_.isEqual(variables.stat_data, variablesBeforeUpdate.stat_data)
    if (isModified) {
        reconcileAndApplySchema(variables)
    }
    await eventEmit(variable_events.VARIABLE_UPDATE_ENDED + '_for_zod', variables, variablesBeforeUpdate)
    if (errorInfo && errorNotifyEnabled()) {
        console.warn(
            `${tr('runtime.variableUpdate.errorTitle', { command: _.escape(errorInfo.command) })}\n${tr('runtime.variableUpdate.errorDetail', { detail: _.escape(errorInfo.content) })}`
        )
    }

    return isModified
}

function errorNotifyEnabled() {
    return errorNotifyFlag
}
let errorNotifyFlag = false
export function setErrorNotify(enabled) {
    errorNotifyFlag = enabled === true
}

// mathjs 动态加载辅助（由部署环境注入搜索路径；找不到则数学表达式按普通字符串处理）
import { createRequire } from 'node:module'
