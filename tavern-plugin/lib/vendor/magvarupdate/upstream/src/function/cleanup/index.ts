import { checkAndRemoveChatVariables } from '@/function/cleanup/chat_variables';
import { cleanupMessageVariables } from '@/function/cleanup/cleanup_variables';
import { checkAndCleanupLegacyChat } from '@/function/cleanup/legacy_chat';
import { restoreVariables } from '@/function/cleanup/restore_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { controlledStoppableEventOn } from '@/util';

export function initCleanup() {
    const store = useDataStore();
    if (store.should_enable) {
        checkAndRemoveChatVariables();
        checkAndCleanupLegacyChat();
    }

    const stop_list: Array<() => void> = [];
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.MESSAGE_DELETED,
            _.debounce(restoreVariables, 2000)
        )
    );
    stop_list.push(
        controlledStoppableEventOn(tavern_events.MESSAGE_RECEIVED, message_id => {
            const store = useDataStore();
            if (!store.settings.自动清理变量.启用) {
                return;
            }
            if (SillyTavern.chat.length % 5 !== 0) {
                return; // 每 5 层执行一次清理。
            }
            const old_message_id = message_id - store.settings.自动清理变量.要保留变量的最近楼层数; //排除对应楼层为user楼层的场合
            if (old_message_id > 0) {
                const counter = cleanupMessageVariables(
                    //考虑到部分情况下会 消息楼层会是 user，所以需要 * 2，寻找更远范围的。
                    Math.max(
                        1,
                        old_message_id - 2 - store.settings.自动清理变量.要保留变量的最近楼层数 * 2
                    ), // 因为没有监听 MESSAGE_SENT
                    old_message_id,
                    store.settings.自动清理变量.快照保留间隔
                );
                console.log(tr('runtime.cleanup.cleanedFloorsLog', { count: counter }));
            }
        })
    );

    return () => {
        stop_list.forEach(stop => stop());
    };
}
