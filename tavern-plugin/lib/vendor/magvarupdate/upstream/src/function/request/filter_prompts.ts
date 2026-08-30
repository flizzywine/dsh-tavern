import { useDataStore } from '@/store';

export function filterPrompts({ messages }: { messages: SillyTavern.SendingMessage[] }) {
    const store = useDataStore();

    const text_messages = messages.filter(message => typeof message.content === 'string') as {
        role: string;
        content: string;
    }[];

    if (
        store.effective_settings.更新方式 === '额外模型解析' &&
        !store.runtimes.is_during_extra_analysis
    ) {
        text_messages
            .filter(message => message.content.includes('<UpdateVariable>'))
            .forEach(
                message =>
                    (message.content = message.content.replaceAll(
                        /\n<(update(?:variable)?|variableupdate)>(?:(?!<\1>).)*<\/\1?>/gis,
                        ''
                    ))
            );
    }
    text_messages
        .filter(message => message.content.includes('<StatusPlaceHolderImpl/>'))
        .forEach(
            message =>
                (message.content = message.content.replaceAll('\n<StatusPlaceHolderImpl/>', ''))
        );
}
