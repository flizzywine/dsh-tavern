import { updateVariables } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { getLastValidMessageId } from '@/util';
import { MvuData } from '@/variable_def';
import { klona } from 'klona';

export async function restoreVariables() {
    const last_message_id = SillyTavern.chat.length - 1;

    const store = useDataStore();
    const { 触发恢复变量的最近楼层数 } = store.settings.自动清理变量;

    const last_10th_message_id = Math.max(1, last_message_id - 触发恢复变量的最近楼层数);
    const last_not_has_variable_message_id = SillyTavern.chat.findLastIndex(
        chat_message =>
            !_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'stat_data']) ||
            !_.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema'])
    );
    if (last_10th_message_id > last_not_has_variable_message_id) {
        // 最近 10 楼都还有楼层变量
        console.info(
            tr('runtime.cleanup.restoreNotNeededLog', {
                count: 触发恢复变量的最近楼层数,
            })
        );
        return;
    }

    const last_20th_message_id = Math.max(
        1,
        last_message_id - store.settings.自动清理变量.要保留变量的最近楼层数
    );
    const snapshot_message_id = getLastValidMessageId(last_20th_message_id);
    if (snapshot_message_id === -1) {
        // 无法恢复
        toastr.warning(
            tr('runtime.cleanup.restoreUnavailable', { floor: last_20th_message_id }),
            tr('runtime.cleanup.restoreTitle')
        );
        return;
    }
    const snapshot_chat_message = SillyTavern.chat[snapshot_message_id];

    //需要一条一条的进行重演，才能保证 start/end 事件符合预期地触发，保证 "同一轮次内最多增加10" 类逻辑能正常运行。
    let message = SillyTavern.chat[snapshot_message_id + 1].mes;
    let variables = klona(
        snapshot_chat_message.variables![snapshot_chat_message.swipe_id ?? 0] as MvuData
    );
    for (let i = snapshot_message_id + 1; i <= last_not_has_variable_message_id; i++) {
        message = SillyTavern.chat[i].mes;
        //每一层被赋值的变量状态是当前层的变量更新已处理的状态
        await updateVariables(message, variables);
        const chat_message = SillyTavern.chat[i];
        const is_valid_message =
            _.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'stat_data']) &&
            _.has(chat_message, ['variables', chat_message.swipe_id ?? 0, 'schema']);

        //如果原本当前 message_id 是一个快照，那么不对它进行变更。
        //原因是如果一切逻辑正常运行，assert这个楼层的内容应该是与重演一致的。
        //在这里不进行修改，之后如果出现问题了，可以通过传递聊天记录，来比较轻松的定位到。
        if (i >= last_20th_message_id && !is_valid_message) {
            await updateVariablesWith(
                data => {
                    data.initialized_lorebooks = variables.initialized_lorebooks;
                    data.stat_data = variables.stat_data;
                    if (variables.schema !== undefined) {
                        data.schema = variables.schema;
                    } else {
                        _.unset(data, 'schema');
                    }
                    if (variables.display_data !== undefined) {
                        _.set(data, 'display_data', variables.display_data);
                    } else {
                        _.unset(data, 'display_data');
                    }
                    if (variables.delta_data !== undefined) {
                        _.set(data, 'delta_data', variables.delta_data);
                    } else {
                        _.unset(data, 'delta_data');
                    }
                    return data;
                },
                { type: 'message', message_id: i }
            );
            //因为原本variables 里面的对象引用，已经用在对应楼层的变量中了，所以需要重新进行一次深复制。
            variables = klona(variables);
        }
        // 在没有进行 update 的场合，也就不需要重新进行深复制了
    }
}
