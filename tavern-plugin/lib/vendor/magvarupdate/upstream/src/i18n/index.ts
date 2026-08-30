import { commonMessages } from '@/i18n/messages/common';
import { panelMessages } from '@/i18n/messages/panel';
import { runtimeMessages } from '@/i18n/messages/runtime';
import type { AppLocale, MessageModule } from '@/i18n/messages/types';
import { createI18n, type LocaleMessageValue, useI18n } from 'vue-i18n';

const allMessages = {
    ...commonMessages,
    ...panelMessages,
    ...runtimeMessages,
};

export type MessageKey = keyof typeof allMessages;
export type TranslationParams = Record<string, unknown>;

export function resolveMvuLocale(locale: string): AppLocale {
    return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function getHostLocale(): string {
    try {
        return SillyTavern.getCurrentLocale();
    } catch {
        return document.documentElement.lang || navigator.language || 'en';
    }
}

type LocaleMessages = Record<string, LocaleMessageValue>;

function buildLocaleMessages(locale: AppLocale): LocaleMessages {
    // 消息源使用便于类型检查的扁平键，这里再展开成 vue-i18n 所需的嵌套对象。
    const result: LocaleMessages = {};
    for (const [key, translations] of Object.entries(allMessages) as [
        MessageKey,
        MessageModule[string],
    ][]) {
        const path = key.split('.');
        const leaf = path.pop()!;
        let parent = result;
        for (const segment of path) {
            const existing = parent[segment];
            if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
                parent[segment] = {};
            }
            parent = parent[segment] as LocaleMessages;
        }
        parent[leaf] = translations[locale];
    }
    return result;
}

export const i18n = createI18n<false>({
    legacy: false,
    globalInjection: false,
    locale: resolveMvuLocale(getHostLocale()),
    fallbackLocale: 'zh-CN',
    messages: {
        'zh-CN': buildLocaleMessages('zh-CN'),
        en: buildLocaleMessages('en'),
    },
    missingWarn: false,
    fallbackWarn: false,
    warnHtmlMessage: false,
});

function translate(key: MessageKey, params?: TranslationParams): string {
    return params ? i18n.global.t(key, params) : i18n.global.t(key);
}

export function tr(key: MessageKey, params?: TranslationParams): string {
    return translate(key, params);
}

export function useMvuI18n() {
    const composer = useI18n({ useScope: 'global' });
    return {
        locale: composer.locale,
        t: (key: MessageKey, params?: TranslationParams) =>
            params ? composer.t(key, params) : composer.t(key),
    };
}
