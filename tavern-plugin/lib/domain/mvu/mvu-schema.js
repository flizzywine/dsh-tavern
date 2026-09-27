// MVU schema 节点树（移植自 MagVarUpdate src/function/schema.ts）
// 纯数据变换：schema 是 JSON 节点树（object/array/primitive），非 zod schema。

import { clone } from './mvu-clone.js'

export const EXTENSIBLE_MARKER = '$__META_EXTENSIBLE__$'

export function isArraySchema(value) {
    return value != null && typeof value === 'object' && value.type === 'array'
}

export function isObjectSchema(value) {
    return value != null && typeof value === 'object' && value.type === 'object'
}

/**
 * 递归为数据对象生成 schema，从旧 schema 节点继承元数据（extensible/required/template）。
 * 过程中会消费并移除数据里的 $meta / EXTENSIBLE_MARKER 标记（与上游行为一致）。
 */
export function generateSchema(data, oldSchemaNode, parentRecursiveExtensible = false) {
    if (oldSchemaNode === '没有用别管这个') {
        return { type: 'any' }
    }

    if (Array.isArray(data)) {
        let isExtensible = false
        let isRecursiveExtensible = parentRecursiveExtensible
        let oldElementType
        let template

        if (oldSchemaNode) {
            if (isArraySchema(oldSchemaNode)) {
                isExtensible = oldSchemaNode.extensible === true
                isRecursiveExtensible =
                    oldSchemaNode.recursiveExtensible === true || parentRecursiveExtensible
                oldElementType = oldSchemaNode.elementType
                template = oldSchemaNode.template
            } else {
                console.error(
                    `Type mismatch: expected array schema but got ${oldSchemaNode.type} at path`
                )
            }
        }

        const metaElementIndex = data.findIndex(
            item =>
                item !== null && typeof item === 'object' && !Array.isArray(item) &&
                '$arrayMeta' in item && '$meta' in item && item['$arrayMeta'] === true
        )

        if (metaElementIndex !== -1) {
            const metaElement = data[metaElementIndex]
            if (metaElement.$meta.extensible !== undefined) isExtensible = metaElement.$meta.extensible
            if (metaElement.$meta.template !== undefined) template = metaElement.$meta.template
            data.splice(metaElementIndex, 1)
        }

        const markerIndex = data.indexOf(EXTENSIBLE_MARKER)
        if (markerIndex > -1) {
            isExtensible = true
            data.splice(markerIndex, 1)
        }

        const schemaNode = {
            type: 'array',
            extensible: isExtensible || parentRecursiveExtensible,
            recursiveExtensible: isRecursiveExtensible,
            elementType:
                data.length > 0
                    ? generateSchema(data[0], oldElementType, isRecursiveExtensible)
                    : { type: 'any' },
        }
        if (template !== undefined) schemaNode.template = template
        return schemaNode
    }

    if (data !== null && typeof data === 'object') {
        let oldExtensible = false
        let oldRecursiveExtensible = parentRecursiveExtensible
        let oldProperties

        if (oldSchemaNode) {
            if (isObjectSchema(oldSchemaNode)) {
                oldExtensible = oldSchemaNode.extensible === true
                oldRecursiveExtensible =
                    oldSchemaNode.recursiveExtensible === true || parentRecursiveExtensible
                oldProperties = oldSchemaNode.properties
            } else {
                console.error(
                    `Type mismatch: expected object schema but got ${oldSchemaNode.type} at path`
                )
            }
        }

        const schemaNode = {
            type: 'object',
            properties: {},
            extensible:
                oldExtensible ||
                data.$meta?.extensible === true ||
                data.$meta?.recursiveExtensible === true ||
                parentRecursiveExtensible,
            recursiveExtensible:
                oldRecursiveExtensible || data.$meta?.recursiveExtensible === true,
        }

        if (data.$meta?.template !== undefined) {
            schemaNode.template = data.$meta.template
        } else if (oldSchemaNode && isObjectSchema(oldSchemaNode) && oldSchemaNode.template) {
            schemaNode.template = oldSchemaNode.template
        }

        const parentMeta = data.$meta
        if (data.$meta) delete data.$meta

        for (const key in data) {
            const oldChildNode = oldProperties?.[key]
            const childRecursiveExtensible =
                schemaNode.extensible !== false && schemaNode.recursiveExtensible
            const childSchema = generateSchema(data[key], oldChildNode, childRecursiveExtensible)

            let isRequired = !schemaNode.extensible
            if (Array.isArray(parentMeta?.required) && parentMeta.required.includes(key)) {
                isRequired = true
            }
            if (oldChildNode?.required === false) {
                isRequired = false
            } else if (oldChildNode?.required === true) {
                isRequired = true
            }

            schemaNode.properties[key] = { ...childSchema, required: isRequired }
        }
        return schemaNode
    }

    const dataType = typeof data
    if (dataType === 'string' || dataType === 'number' || dataType === 'boolean') {
        return { type: dataType }
    }
    return { type: 'any' }
}

/** lodash 路径字符串 → schema 节点查询（数字段走 array.elementType）。 */
export function getSchemaForPath(schema, path) {
    if (!path || !schema) return schema || null
    const pathSegments = toPath(path)
    let currentSchema = schema
    for (const segment of pathSegments) {
        if (!currentSchema) return null
        if (/^\d+$/.test(segment)) {
            if (isArraySchema(currentSchema)) {
                currentSchema = currentSchema.elementType
            } else {
                return null
            }
        } else if (isObjectSchema(currentSchema) && currentSchema.properties[segment]) {
            currentSchema = currentSchema.properties[segment]
        } else {
            return null
        }
    }
    return currentSchema
}

/** 调和：按当前数据状态重建 schema 并应用（保留 strictTemplate/strictSet/concatTemplateArray 根选项）。 */
export function reconcileAndApplySchema(variables) {
    console.log('Reconciling schema with current data state...')
    const currentDataClone = clone(variables.stat_data)
    const newSchema = generateSchema(currentDataClone, variables.schema)
    if (!isObjectSchema(newSchema)) return

    if (variables.schema?.strictTemplate !== undefined) {
        newSchema.strictTemplate = variables.schema.strictTemplate
    }
    if (variables.schema?.strictSet !== undefined) {
        newSchema.strictSet = variables.schema.strictSet
    }
    if (variables.schema?.concatTemplateArray !== undefined) {
        newSchema.concatTemplateArray = variables.schema.concatTemplateArray
    }
    if (Object.prototype.hasOwnProperty.call(variables.stat_data || {}, '$meta.strictTemplate'))
        newSchema.strictTemplate = variables.stat_data['$meta']?.strictTemplate
    if (Object.prototype.hasOwnProperty.call(variables.stat_data || {}, '$meta.strictSet'))
        newSchema.strictSet = variables.stat_data['$meta']?.strictSet
    if (Object.prototype.hasOwnProperty.call(variables.stat_data || {}, '$meta.concatTemplateArray'))
        newSchema.concatTemplateArray = variables.stat_data['$meta']?.concatTemplateArray

    variables.schema = newSchema
}

export function cleanUpMetadata(data) {
    if (Array.isArray(data)) {
        let i = data.length
        while (i--) {
            if (data[i] === EXTENSIBLE_MARKER) {
                data.splice(i, 1)
            } else if (
                data[i] !== null && typeof data[i] === 'object' && !Array.isArray(data[i]) &&
                '$arrayMeta' in data[i] && '$meta' in data[i] && data[i]['$arrayMeta'] === true
            ) {
                data.splice(i, 1)
            } else {
                cleanUpMetadata(data[i])
            }
        }
    } else if (data !== null && typeof data === 'object') {
        delete data.$meta
        for (const key in data) cleanUpMetadata(data[key])
    }
}

// —— lodash 兼容的 toPath 简版（depath 语义：a.b[0]["c d"] -> ['a','b','0','c d']）——
// 供 getSchemaForPath 使用；实现参考 lodash.toPath 的字符串解析。
function toPath(path) {
    const result = []
    if (typeof path !== 'string') return result
    // 先统一把 [x] 转成 .x 的简单情形无法处理带点键——这里手写解析
    let index = 0
    while (index < path.length) {
        const char = path[index]
        if (char === '.') { index++; continue }
        if (char === '[') {
            const end = path.indexOf(']', index)
            if (end === -1) { result.push(path.slice(index + 1)); break }
            let inner = path.slice(index + 1, end)
            const quote = inner[0]
            if ((quote === '"' || quote === "'") && inner.endsWith(quote)) inner = inner.slice(1, -1)
            result.push(inner)
            index = end + 1
            continue
        }
        let dot = path.indexOf('.', index)
        const bracket = path.indexOf('[', index)
        let end
        if (dot === -1 && bracket === -1) end = path.length
        else if (dot === -1 || (bracket !== -1 && bracket < dot)) end = bracket
        else end = dot
        result.push(path.slice(index, end))
        index = end
    }
    return result.filter((segment, i) => !(i > 0 && segment === ''))
}
