import { watch, type WatchStopHandle } from 'vue';

type TransitionToChat = (chat_id: string, force?: boolean) => Promise<void>;

export function watchPreferredChatSync(
    get_should_enable: () => boolean,
    transition_to_chat: TransitionToChat,
    get_current_chat_id: () => string = () => SillyTavern.getCurrentChatId()
): WatchStopHandle {
    return watch(get_should_enable, (should_enable, was_enabled) => {
        if (should_enable && !was_enabled) {
            void transition_to_chat(get_current_chat_id(), true);
        }
    });
}
