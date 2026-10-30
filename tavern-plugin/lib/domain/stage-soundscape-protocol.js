// Shared sound field contract for the director and runtime tag validation.
import { soundscapeTags } from '../../packages/dsh-presentation-protocol/src/stage-soundscape.cjs'

export const SOUNDSCAPE_RULES = '\u73af\u5883\u97f3\u968f\u573a\u666f\u4e0e\u5929\u6c14\u81ea\u52a8\u64ad\u653e\uff0c\u65e0\u9700\u9009\u58f0\u97f3\u7d20\u6750\u3002\u53ea\u6709\u6b63\u6587\u660e\u786e\u504f\u79bb\u573a\u666f\u9ed8\u8ba4\u65f6\uff0c\u586b\u5199 sound \u6807\u7b7e\uff1aempty \u65e0\u80cc\u666f\u4eba\u7fa4\uff0copen \u4e0e\u5916\u754c\u655e\u901a\uff0csheltered \u4f4d\u4e8e\u906e\u853d\u5904\uff0csealed \u4e0e\u5916\u754c\u9694\u97f3\u3002\u6bcf\u6b21\u586b\u5199\u5b8c\u6574\u6807\u7b7e\u96c6\u5408\uff0c[] \u6062\u590d\u9ed8\u8ba4\uff1b\u65e0\u53d8\u5316\u5219\u7701\u7565\u3002open/sheltered/sealed \u53ea\u80fd\u9009\u4e00\u4e2a\uff1b\u6362\u573a\u81ea\u52a8\u6062\u590d\u9ed8\u8ba4\u3002'

export function buildSoundscapeFieldSchema() {
  return {
    type: 'array',
    items: { type: 'string', enum: ['empty', 'open', 'sheltered', 'sealed'] },
    maxItems: 2,
    description: 'Optional complete sound tag array. Omit to preserve; [] restores scene defaults. empty removes background human crowd only. Choose at most one exposure: open, sheltered, sealed. Scene changes reset tags; weather remains independent.'
  }
}

export function validateSoundTags(raw) {
  return soundscapeTags(raw)
}
