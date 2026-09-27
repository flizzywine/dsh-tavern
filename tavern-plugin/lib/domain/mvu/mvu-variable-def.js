// MVU 变量定义守卫（移植自 MagVarUpdate src/variable_def.ts，剥离 TS 类型）
export function isArraySchema(value) {
    return value != null && typeof value === 'object' && value.type === 'array'
}

export function isObjectSchema(value) {
    return value != null && typeof value === 'object' && value.type === 'object'
}

export function isValueWithDescription(value) {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string'
}

export function isValueWithDescriptionStatData(value) {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string'
}

export function assertVWD(_flag, _value) {
    // asserts 类型守卫：运行时无操作（与上游一致）
}
