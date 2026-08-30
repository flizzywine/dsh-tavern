export const APP_LOCALES = ['zh-CN', 'en'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export type MessageTranslations = Record<AppLocale, string>;

export type MessageModule = Record<string, MessageTranslations>;

export function defineMessages<const T extends MessageModule>(messages: T): T {
    return messages;
}
