const jsonrepair = jsonrepairModule.default ?? jsonrepairModule.jsonrepair ?? jsonrepairModule
const JSON5 = JSON5Module.default ?? JSON5Module

// 宽容解析链（移植自 MagVarUpdate util/common.ts parseString）：YAML(merge) → JSON5 → JSON(jsonrepair) → YAML
import YAML from 'yaml'
import * as JSON5Module from 'json5'
import * as jsonrepairModule from 'jsonrepair'

export function parseString(content) {
    const jsonFirst = /^[[{]/s.test(content.trimStart())
    try {
        if (jsonFirst) throw Error('expected error')
        return YAML.parseDocument(content, { merge: true }).toJS()
    } catch (yamlError1) {
        try {
            return JSON5.parse(content)
        } catch (json5Error) {
            try {
                return JSON.parse(jsonrepair(content))
            } catch (jsonError) {
                try {
                    if (!jsonFirst) throw Error('expected error')
                    return YAML.parseDocument(content, { merge: true }).toJS()
                } catch (yamlError2) {
                    throw new Error(
                        `无法解析内容：YAML(${yamlError2?.message}) / JSON5(${json5Error?.message}) / JSON(${jsonError?.message})`
                    )
                }
            }
        }
    }
}
