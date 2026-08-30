import { saveChatDebounced } from '@/util';

/** 清理 `[start_message_id, end_message_id]` 内, 楼层号不为 `snap_interval` 倍数的楼层变量 */
export function cleanupMessageVariables(
    start_message_id: number,
    end_message_id: number,
    snap_interval: number
) {
    let counter = 0;
    SillyTavern.chat
        .slice(start_message_id, end_message_id + 1)
        .forEach((chat_message, msg_index) => {
            if (chat_message.variables === undefined) {
                return;
            }
            //每个楼层只在counter 中统计一次。
            let chat_flag = false;
            chat_message.variables = _.range(0, chat_message.swipes?.length ?? 1).map(i => {
                if (chat_message?.variables?.[i] === undefined) {
                    return {};
                }
                if (_.get(chat_message?.variables?.[i], 'snapshot') === true) {
                    return chat_message.variables[i];
                }
                if ((start_message_id + msg_index) % snap_interval === 0) {
                    //需要对已经忽略的snapshot 楼层进行标记
                    //原因是考虑到用户会修改楼层间隔，比如从 50-> 70 ，因为最小公倍数的原因，会导致之前的楼层实质上 350 层一个快照，有较大风险
                    _.set(chat_message, ['variables', i, 'snapshot'], true);
                    return chat_message.variables[i];
                }
                if (!chat_flag) {
                    chat_flag = true;
                    ++counter;
                }
                return _.omit(
                    chat_message.variables[i],
                    `initialized_lorebooks`,
                    `stat_data`,
                    `display_data`,
                    `delta_data`,
                    `schema`
                );
            });
        });
    saveChatDebounced();
    return counter;
}
