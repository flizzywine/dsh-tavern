import { initButtons } from '@/button';
import { watchPreferredChatSync } from '@/function/chat_lifecycle';
import { initCleanup } from '@/function/cleanup';
import { initCharacterSettingsOverride } from '@/function/character_override';
import { initExportedEvents } from '@/function/exported_events';
import { initGlobals } from '@/function/global';
import { initInitvar } from '@/function/initvar';
import { initNotification } from '@/function/notification';
import { initRequest } from '@/function/request';
import { initResponse } from '@/function/update';
import { tr } from '@/i18n';
import { initPanel } from '@/panel';
import { useDataStore } from '@/store';
import { controlledStoppableEventOn } from '@/util';
import { checkMinimumVersion } from '@util/common';
import { registerAsUniqueScript } from '@util/script';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';

type Stop = () => void | Promise<void>;

setActivePinia(getActivePinia() ?? createPinia());

$(async () => {
    const minimum_tavern_helper_version = '3.4.17';
    await checkMinimumVersion(minimum_tavern_helper_version, {
        message: tr('runtime.main.minimumVersionRequired', {
            version: minimum_tavern_helper_version,
        }),
        title: tr('runtime.main.versionIncompatibleTitle'),
    });

    const store = useDataStore();
    await store._wait_init();

    const stop_list: Stop[] = [];

    stop_list.push(initPanel());
    stop_list.push(initButtons());
    stop_list.push(initGlobals());

    let chat_level_stop_list: Stop[] = [];
    let current_chat_id = SillyTavern.getCurrentChatId();
    let chat_level_generation = 0;
    let chat_level_transition = Promise.resolve();

    // 串行销毁和初始化聊天级模块，并用代次号淘汰快速切换聊天时产生的过期任务。
    const transitionToChat = (chat_id: string, force = false): Promise<void> => {
        if (!force && current_chat_id === chat_id) {
            return chat_level_transition;
        }

        current_chat_id = chat_id;
        const generation = ++chat_level_generation;
        chat_level_transition = chat_level_transition
            .then(async () => {
                if (generation !== chat_level_generation) {
                    return;
                }

                const previous_stop_list = chat_level_stop_list;
                chat_level_stop_list = [];
                await stopAll(previous_stop_list);
                if (
                    generation !== chat_level_generation ||
                    SillyTavern.getCurrentChatId() !== chat_id
                ) {
                    return;
                }

                const next_stop_list = await initChatLevel(
                    () =>
                        generation === chat_level_generation &&
                        SillyTavern.getCurrentChatId() === chat_id
                );
                if (
                    generation === chat_level_generation &&
                    SillyTavern.getCurrentChatId() === chat_id
                ) {
                    chat_level_stop_list = next_stop_list;
                } else {
                    await stopAll(next_stop_list);
                }
            })
            .catch(error => {
                console.error(tr('runtime.main.chatReinitializeFailedLog'), error);
                toastr.error(
                    tr('runtime.common.errorCause', { cause: _.escape(String(error)) }),
                    tr('runtime.main.reinitializeFailedTitle'),
                    { timeOut: 5000 }
                );
            });
        return chat_level_transition;
    };

    stop_list.push(
        controlledStoppableEventOn(tavern_events.CHAT_CHANGED, (chat_id: string) =>
            transitionToChat(chat_id)
        )
    );
    stop_list.push(watchPreferredChatSync(() => store.should_enable, transitionToChat));
    await transitionToChat(current_chat_id, true);

    stop_list.push(initNotification());

    $(window).on('pagehide', async () => {
        chat_level_generation++;
        await chat_level_transition;
        await stopAll(chat_level_stop_list);
        await stopAll(stop_list);
        registerAsUniqueScript('MVU变量框架').unregister();
    });
});

async function stopAll(stop_list: Stop[]): Promise<void> {
    // 单个模块清理失败不应阻止其他模块释放监听器和未完成任务。
    await Promise.allSettled(
        stop_list.map(async stop => {
            await stop();
        })
    );
}

async function initChatLevel(is_current: () => boolean = () => true): Promise<Stop[]> {
    const stop_list: Stop[] = [];
    try {
        if (!is_current()) {
            return stop_list;
        }

        // 初始化步骤之间都检查聊天是否仍然有效，防止慢请求把旧聊天重新挂载回来。
        const stop_character_settings = await initCharacterSettingsOverride();
        if (!is_current()) {
            await stop_character_settings();
            return stop_list;
        }
        stop_list.push(stop_character_settings);

        const stop_initvar = await initInitvar();
        if (!is_current()) {
            await stop_initvar();
            await stopAll(stop_list);
            return [];
        }
        stop_list.push(stop_initvar);

        stop_list.push(initRequest());
        stop_list.push(initResponse());
        stop_list.push(initCleanup());
        stop_list.push(initExportedEvents());
        return stop_list;
    } catch (error) {
        await stopAll(stop_list);
        throw error;
    }
}
