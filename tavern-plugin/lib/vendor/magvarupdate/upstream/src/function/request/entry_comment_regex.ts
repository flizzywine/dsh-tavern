import { tr } from '@/i18n';

export type EntryCommentRegexCompileResult = {
    regex?: RegExp;
    error?: string;
};

export type EntryCommentFilterSource = '用户全局配置' | '角色卡配置';

export type EntryCommentFilterResult = {
    lore: 'globalLore' | 'characterLore' | 'chatLore' | 'personaLore';
    world: string;
    comment: string;
    reason: '白名单' | '黑名单';
    sources: EntryCommentFilterSource[];
};

export const ENTRY_COMMENT_FILTER_LOG_TITLE = tr('runtime.filter.logTitle');

export function logEntryCommentFilterResult(result: EntryCommentFilterResult[]) {
    console.log(
        ENTRY_COMMENT_FILTER_LOG_TITLE,
        result.map(entry => ({ ...entry }))
    );
}

function isEscaped(value: string, index: number): boolean {
    let backslash_count = 0;
    for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) {
        backslash_count++;
    }
    return backslash_count % 2 === 1;
}

function findClosingSlash(value: string): number {
    for (let i = value.length - 1; i > 0; i--) {
        if (value[i] === '/' && !isEscaped(value, i)) {
            return i;
        }
    }
    return -1;
}

export function compileEntryCommentRegex(value: string): EntryCommentRegexCompileResult {
    const trimmed = value.trim();
    if (trimmed === '') {
        return {};
    }

    try {
        if (trimmed.startsWith('/')) {
            const closing_slash = findClosingSlash(trimmed);
            if (closing_slash <= 0) {
                throw new Error(tr('runtime.regex.jsStyleSyntax'));
            }
            return {
                regex: new RegExp(
                    trimmed.slice(1, closing_slash),
                    trimmed.slice(closing_slash + 1)
                ),
            };
        }

        return { regex: new RegExp(trimmed) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

export function testEntryCommentRegex(regex: RegExp, comment: string): boolean {
    regex.lastIndex = 0;
    return regex.test(comment);
}
