import { loadInitVarData } from '@/function/initvar/variable_init';
import { updateVariable, updateVariables } from '@/function/update_variables';
import { isValueWithDescription, MvuData, variable_events } from '@/variable_def';
import { watch } from 'vue';
import { useDataStore } from '../../store';

function createMvu() {
    const mvu = {
        events: variable_events,

        /**
         * 获取变量表, 并将其视为包含 mvu 数据的 MvuData
         *
         * @param  可选选项
         *   - `type?:'message'|'chat'|'character'|'global'`: 对某一楼层的聊天变量 (`message`)、聊天变量表 (`'chat'`)、角色卡变量 (`'character'`) 或全局变量表 (`'global'`) 进行操作, 默认为 `'chat'`
         *   - `message_id?:number|'latest'`: 当 `type` 为 `'message'` 时, 该参数指定要获取的消息楼层号, 如果为负数则为深度索引, 例如 `-1` 表示获取最新的消息楼层; 默认为 `'latest'`
         *   - `script_id?:string`: 当 `type` 为 `'script'` 时, 该参数指定要获取的脚本 ID; 如果在脚本内调用, 则你可以用 `getScriptId()` 获取该脚本 ID
         *
         * @returns MvuData 数据表
         *
         * @example
         * // 获取最新消息楼层的 mvu 数据
         * const message_data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
         *
         * // 在消息楼层 iframe 内获取该 iframe 所在楼层的 mvu 数据
         * const message_data = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
         */
        getMvuData: function (options: VariableOption): MvuData {
            return getVariables(options) as MvuData;
        },

        /**
         * 完全替换变量表为包含 mvu 数据的 `mvu_data` (但如果没用 parseMessages 自行处理变量, 则更建议监听 mvu 事件来修改 mvu 数据!)
         *
         * @param variables 要用于替换的变量表
         * @param option 可选选项
         *   - `type?:'message'|'chat'|'character'|'global'`: 对某一楼层的聊天变量 (`message`)、聊天变量表 (`'chat'`)、角色卡变量 (`'character'`) 或全局变量表 (`'global'`) 进行操作, 默认为 `'chat'`
         *   - `message_id?:number|'latest'`: 当 `type` 为 `'message'` 时, 该参数指定要获取的消息楼层号, 如果为负数则为深度索引, 例如 `-1` 表示获取最新的消息楼层; 默认为 `'latest'`
         *   - `script_id?:string`: 当 `type` 为 `'script'` 时, 该参数指定要获取的脚本 ID; 如果在脚本内调用, 则你可以用 `getScriptId()` 获取该脚本 ID
         *
         * @example
         * // 修改络络好感度为 30
         * const mvu_data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
         * _.set(mvu_data, 'stat_data.角色.络络.好感度', 30);
         * await Mvu.replaceMvuData(mvu_data, { type: 'message', message_id: 'latest' });
         */
        replaceMvuData: function (mvu_data: MvuData, options: VariableOption) {
            /** 旧酒馆助手的 replaceVariables 是异步函数, 因此需要返回 Promise */
            return replaceVariables(mvu_data, options);
        },

        /**
         * 解析包含变量更新命令 (`_.set`) 的消息 `message`, 根据它更新 `old_data` 中的 mvu 变量数据
         *
         * @param message 包含 _.set() 命令的消息字符串
         * @param old_data 当前的 MvuData 数据
         *
         * @returns 如果有变量被更新则返回新的 MvuData, 否则返回 `undefined`
         *
         * @example
         * // 修改络络好感度为 30
         * const old_data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
         * const new_data = await Mvu.parseMessage("_.set('角色.络络.好感度', 30); // 强制修改", old_data);
         * await Mvu.replaceMvuData(new_data, { type: 'message', message_id: 'latest' });
         */
        parseMessage: async function (
            message: string,
            old_data: MvuData
        ): Promise<MvuData | undefined> {
            const result = klona(old_data);
            await updateVariables(message, result);
            return result;
        },

        /** @deprecated */
        getCurrentMvuData: function (): MvuData {
            const variables = getVariables({ type: 'message', message_id: getCurrentMessageId() });
            return variables as MvuData;
        },

        /** @deprecated */
        replaceCurrentMvuData: async function (mvu_data: MvuData): Promise<void> {
            await replaceVariables(mvu_data, {
                type: 'message',
                message_id: getCurrentMessageId(),
            });
        },

        /** @deprecated */
        reloadInitVar: async function (mvu_data: MvuData): Promise<boolean> {
            return await loadInitVarData(mvu_data);
        },

        /** @deprecated */
        setMvuVariable: async function (
            mvu_data: MvuData,
            path: string,
            new_value: any,
            { reason = '', is_recursive = false }: { reason?: string; is_recursive?: boolean } = {}
        ): Promise<boolean> {
            return await updateVariable(mvu_data.stat_data, path, new_value, reason, is_recursive);
        },

        /** @deprecated */
        getMvuVariable: function (
            mvu_data: MvuData,
            path: string,
            {
                category = 'stat',
                default_value = undefined,
            }: { category?: 'stat' | 'display' | 'delta'; default_value?: any } = {}
        ): any {
            let data: Record<string, any>;
            switch (category) {
                case 'stat':
                    data = mvu_data.stat_data;
                    break;
                case 'display':
                    data = mvu_data.display_data!;
                    break;
                case 'delta':
                    data = mvu_data.delta_data!;
                    break;
            }

            const value = _.get(data, path, default_value);

            /* 如果是 VWD，取第一个元素 */
            if (isValueWithDescription(value)) {
                return value[0];
            }

            /* 否则直接返回值本身 */
            return value;
        },

        /** @deprecated */
        getRecordFromMvuData: function (
            mvu_data: MvuData,
            category: 'stat' | 'display' | 'delta'
        ): Record<string, any> {
            let data: Record<string, any> | undefined = undefined;
            switch (category) {
                case 'stat':
                    data = mvu_data.stat_data;
                    break;
                case 'display':
                    data = mvu_data.display_data!;
                    break;
                case 'delta':
                    data = mvu_data.delta_data!;
                    break;
            }
            return data;
        },

        /**
         * @brief 返回当前轮次是否属于额外模型解析轮次。
         */
        isDuringExtraAnalysis: () => useDataStore().runtimes.is_during_extra_analysis,
    };
    return mvu;
}

export function initGlobals() {
    const mvu = createMvu();
    const store = useDataStore();
    const stop = watch(
        () => store.should_enable,
        should_enabled => {
            if (should_enabled) {
                _.set(window.parent, 'Mvu', mvu);
                eventEmit('global_Mvu_initialized');
            }
        },
        { immediate: true }
    );

    return () => {
        if (store.should_enable && _.get(window.parent, 'Mvu') === mvu) {
            deleteVariable('extra_analysis', { type: 'global' });
            _.unset(window.parent, 'Mvu');
        }
        stop();
    };
}
