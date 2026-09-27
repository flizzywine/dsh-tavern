// 深拷贝（替代 klona）：变量树是纯 JSON 数据，structuredClone 语义等价且为内置实现。
export function clone(value) {
    return structuredClone(value)
}
