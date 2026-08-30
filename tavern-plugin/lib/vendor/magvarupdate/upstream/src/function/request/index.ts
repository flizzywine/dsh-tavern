import { applyExtraModelRequestOverrides } from '@/function/request/extra_model_request_override';
import { overrideToolRequest, registerFunction } from '@/function/function_call';
import { filterEntries } from '@/function/request/filter_entries';
import { filterPrompts } from '@/function/request/filter_prompts';
import { controlledStoppableEventOn } from '@/util';

export function initRequest() {
    const stop_list: Array<() => void> = [];
    stop_list.push(registerFunction());

    stop_list.push(controlledStoppableEventOn('worldinfo_entries_loaded', filterEntries));
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.CHAT_COMPLETION_SETTINGS_READY,
            applyExtraModelRequestOverrides
        )
    );
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.CHAT_COMPLETION_SETTINGS_READY,
            overrideToolRequest
        )
    );
    stop_list.push(
        controlledStoppableEventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, filterPrompts)
    );

    return () => {
        stop_list.forEach(stop => stop());
    };
}
