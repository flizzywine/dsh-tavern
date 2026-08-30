import {
    ArraySchemaNode,
    isArraySchema,
    isObjectSchema,
    MvuData,
    ObjectSchemaNode,
    RootAdditionalProps,
    SchemaNode,
    StatData,
    TemplateType,
} from '@/variable_def';
import { klona } from 'klona';

// 定义魔法字符串为常量，便于管理和引用
export const EXTENSIBLE_MARKER = '$__META_EXTENSIBLE__$';

// 模式生成函数
/**
 * 递归地为数据对象生成一个模式。
 * @param data - 要为其生成模式的数据对象 (stat_data)。
 * @param oldSchemaNode - (可选) 来自旧 Schema 的对应节点，用于继承元数据。
 * @param parentRecursiveExtensible - (可选) 父节点的 recursiveExtensible 状态，默认为 false。
 * @returns - 生成的模式对象。
 */
export function generateSchema(
    data: any,
    oldSchemaNode?: SchemaNode,
    parentRecursiveExtensible: boolean = false
): SchemaNode {
    // @ts-expect-error hack for mvu zod
    if (oldSchemaNode === '没有用别管这个') {
        return { type: 'any' };
    }

    if (Array.isArray(data)) {
        let isExtensible = false;
        let isRecursiveExtensible = parentRecursiveExtensible;
        let oldElementType: SchemaNode | undefined;
        let template: TemplateType | undefined;

        // 使用类型守卫检查 oldSchemaNode 是否为 ArraySchemaNode
        if (oldSchemaNode) {
            if (isArraySchema(oldSchemaNode)) {
                isExtensible = oldSchemaNode.extensible === true;
                isRecursiveExtensible =
                    oldSchemaNode.recursiveExtensible === true || parentRecursiveExtensible;
                oldElementType = oldSchemaNode.elementType;
                template = oldSchemaNode.template;
            } else {
                console.error(
                    `Type mismatch: expected array schema but got ${oldSchemaNode.type} at path`
                );
            }
        }

        // 检查是否有只包含 $meta 的元素
        const metaElementIndex = data.findIndex(
            item =>
                _.isObject(item) &&
                !_.isDate(item) &&
                '$arrayMeta' in item &&
                '$meta' in item &&
                item['$arrayMeta'] === true
        );

        if (metaElementIndex !== -1) {
            const metaElement = data[metaElementIndex] as { $meta: any };
            // 从 $meta 中提取数组的元数据
            if (metaElement.$meta.extensible !== undefined) {
                isExtensible = metaElement.$meta.extensible;
            }
            if (metaElement.$meta.template !== undefined) {
                template = metaElement.$meta.template;
            }
            // 从数组中移除这个元数据元素
            data.splice(metaElementIndex, 1);
            console.log(`Array metadata element found and processed.`);
        }

        // 检查并处理魔法字符串
        const markerIndex = data.indexOf(EXTENSIBLE_MARKER);
        if (markerIndex > -1) {
            isExtensible = true;
            // 从数组中移除标记，以免影响后续的类型推断
            data.splice(markerIndex, 1);
            console.log(`Extensible marker found and removed from an array.`);
        }

        const schema_node: ArraySchemaNode = {
            type: 'array',
            extensible: isExtensible || parentRecursiveExtensible,
            recursiveExtensible: isRecursiveExtensible,
            elementType:
                data.length > 0
                    ? generateSchema(data[0], oldElementType, isRecursiveExtensible)
                    : { type: 'any' },
        };

        if (template !== undefined) {
            schema_node.template = template;
        }

        return schema_node;
    }
    if (_.isObject(data) && !_.isDate(data)) {
        const typedData = data as StatData; // 类型断言

        // 使用类型守卫检查 oldSchemaNode 是否为 ObjectSchemaNode
        let oldExtensible = false;
        let oldRecursiveExtensible = parentRecursiveExtensible;
        let oldProperties: ObjectSchemaNode['properties'] | undefined;

        if (oldSchemaNode) {
            if (isObjectSchema(oldSchemaNode)) {
                oldExtensible = oldSchemaNode.extensible === true;
                oldRecursiveExtensible =
                    oldSchemaNode.recursiveExtensible === true || parentRecursiveExtensible;
                oldProperties = oldSchemaNode.properties;
            } else {
                console.error(
                    `Type mismatch: expected object schema but got ${oldSchemaNode.type} at path`
                );
            }
        }

        const schemaNode: ObjectSchemaNode = {
            type: 'object',
            properties: {},
            // 默认不可扩展，但检查旧 schema、$meta.extensible 或 parentRecursiveExtensible
            extensible:
                oldExtensible ||
                typedData.$meta?.extensible === true ||
                typedData.$meta?.recursiveExtensible === true ||
                parentRecursiveExtensible,
            recursiveExtensible:
                oldRecursiveExtensible || typedData.$meta?.recursiveExtensible === true,
        };

        // 处理 template
        if (typedData.$meta?.template !== undefined) {
            schemaNode.template = typedData.$meta.template;
        } else if (oldSchemaNode && isObjectSchema(oldSchemaNode) && oldSchemaNode.template) {
            schemaNode.template = oldSchemaNode.template;
        }

        // 暂存父节点的 $meta，以便在循环中使用
        const parentMeta = typedData.$meta;

        // 从 $meta 中读取信息后，将其从数据中移除，避免污染
        if (typedData.$meta) {
            delete typedData.$meta;
        }

        for (const key in data) {
            const oldChildNode = oldProperties?.[key];
            // 传递当前节点的 recursiveExtensible（如果存在）或父节点的 recursiveExtensible
            // 但如果当前节点明确设置 extensible: false, 则停止递归扩展
            const childRecursiveExtensible =
                schemaNode.extensible !== false && schemaNode.recursiveExtensible;
            const childSchema = generateSchema(
                typedData[key],
                oldChildNode,
                childRecursiveExtensible
            );

            // 一个属性是否必需？

            // 1. 默认值: 如果父节点可扩展，子节点默认为可选；否则为必需。
            let isRequired = !schemaNode.extensible;

            // 2. 覆盖规则: 检查父元数据中的 'required' 数组。
            //    如果父节点的 $meta.required 是一个数组，并且当前 key 在这个数组里，
            //    则无论默认值是什么，都强制覆盖为必需。
            if (Array.isArray(parentMeta?.required) && parentMeta.required.includes(key)) {
                isRequired = true;
            }

            // 3. 检查旧 schema 的设置，作为最后的参考
            if (oldChildNode?.required === false) {
                // 如果旧 schema 明确说这个是可选的，那么以这个为准
                isRequired = false;
            } else if (oldChildNode?.required === true) {
                isRequired = true;
            }

            schemaNode.properties[key] = {
                ...childSchema,
                required: isRequired,
            };
        }
        return schemaNode;
    }
    // 处理原始类型
    const dataType = typeof data;
    if (dataType === 'string' || dataType === 'number' || dataType === 'boolean') {
        return { type: dataType };
    }
    // 对于其他类型（function, symbol, bigint, undefined 等），默认返回 'any'
    return { type: 'any' };
}

/**
 * 辅助函数：为数据路径获取对应的 Schema 规则。
 * 能够处理数组索引，将其转换为 .elementType 来查询 Schema。
 * @param schema - 完整的 Schema 对象
 * @param path - 要查询的数据路径
 * @returns 对应路径的 Schema 节点，如果找不到则返回 null。
 */
export function getSchemaForPath(
    schema: SchemaNode | null | undefined,
    path: string
): SchemaNode | null {
    if (!path || !schema) {
        return schema || null;
    }
    // 将 lodash 路径字符串转换为段数组，例如 'a.b[0].c' -> ['a', 'b', '0', 'c']
    const pathSegments = _.toPath(path);
    let currentSchema: SchemaNode | null = schema;

    for (const segment of pathSegments) {
        if (!currentSchema) return null;

        // 如果 segment 是数字（数组索引），则移动到 elementType
        if (/^\d+$/.test(segment)) {
            if (isArraySchema(currentSchema)) {
                currentSchema = currentSchema.elementType;
            } else {
                return null; // 路径试图索引一个非数组或无 elementType 的 schema
            }
        } else if (isObjectSchema(currentSchema) && currentSchema.properties[segment]) {
            // 否则，作为对象属性访问
            const property = currentSchema.properties[segment];
            currentSchema = property as SchemaNode;
        } else {
            return null; // 路径中的键在 schema 中不存在
        }
    }
    return currentSchema;
}

/**
 * 调和函数：比较数据和旧 Schema，生成并应用一个与当前数据状态完全同步的新 Schema。
 * @param variables - 包含 stat_data 和旧 schema 的变量对象。
 */
export function reconcileAndApplySchema(variables: MvuData) {
    console.log('Reconciling schema with current data state...');

    // 1. 深拷贝数据，以防 generateSchema 修改原始数据（例如删除 $meta）
    const currentDataClone = klona(variables.stat_data);

    // 2. 使用改进后的 generateSchema 生成一个与当前数据完全匹配的新 Schema，
    //    并在此过程中从旧 Schema 继承元数据。
    const newSchema = generateSchema(currentDataClone, variables.schema);

    // 3. 直接用新 Schema 替换旧 Schema
    // stat_data 的根节点应该始终是对象，所以生成的 schema 也应该是 ObjectSchemaNode
    if (!isObjectSchema(newSchema)) {
        return;
    }

    // 保留 RootAdditionalProps
    const newSchemaWithProps = newSchema as ObjectSchemaNode & RootAdditionalProps;
    if (variables.schema?.strictTemplate !== undefined) {
        newSchemaWithProps.strictTemplate = variables.schema.strictTemplate;
    }
    if (variables.schema?.strictSet !== undefined) {
        newSchemaWithProps.strictSet = variables.schema.strictSet;
    }
    if (variables.schema?.concatTemplateArray !== undefined) {
        newSchemaWithProps.concatTemplateArray = variables.schema.concatTemplateArray;
    }
    if (_.has(variables.stat_data, '$meta.strictTemplate'))
        newSchemaWithProps.strictTemplate = variables.stat_data['$meta']?.strictTemplate as boolean;
    if (_.has(variables.stat_data, '$meta.strictSet'))
        newSchemaWithProps.strictSet = variables.stat_data['$meta']?.strictSet as boolean;
    if (_.has(variables.stat_data, '$meta.concatTemplateArray'))
        newSchemaWithProps.concatTemplateArray = variables.stat_data['$meta']
            ?.concatTemplateArray as boolean;

    variables.schema = newSchemaWithProps;

    console.log('Schema reconciliation complete.');
}

function isMetaCarrier(value: unknown): value is Record<string, unknown> & { $meta?: unknown } {
    return _.isObject(value) && !_.isDate(value);
}

/**
 * 递归清理数据中的元数据标记
 * - 从数组中移除 EXTENSIBLE_MARKER
 * - 从对象中删除 $meta 属性
 * @param data 需要清理的数据
 */
export function cleanUpMetadata(data: any): void {
    // 如果是数组，移除魔法字符串和只包含 $meta 的元素，并递归
    if (Array.isArray(data)) {
        let i = data.length;
        while (i--) {
            if (data[i] === EXTENSIBLE_MARKER) {
                data.splice(i, 1);
            } else if (
                _.isObject(data[i]) &&
                !_.isDate(data[i]) &&
                '$arrayMeta' in data[i] &&
                '$meta' in data[i] &&
                data[i]['$arrayMeta'] === true
            ) {
                // 移除只包含 $meta & $arrayMeta 的元素
                data.splice(i, 1);
            } else {
                // 对数组中的其他元素（可能是对象或数组）进行递归清理
                cleanUpMetadata(data[i]);
            }
        }
    }
    // 如果是对象，移除 $meta 并递归
    else if (isMetaCarrier(data)) {
        // 清除自身 $meta
        delete data.$meta;

        // 递归
        for (const key in data) {
            cleanUpMetadata(data[key]);
        }
    }
}
