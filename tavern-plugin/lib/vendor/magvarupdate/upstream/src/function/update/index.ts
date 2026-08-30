import { is_jest_environment } from '@/jest';

import { onMessageReceived } from '@/function/update/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
import { controlledStoppableEventOn } from '@/util';

export function initResponse() {
    const stop_list: Array<() => void> = [];
    stop_list.push(
        controlledStoppableEventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage)
    );
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.MESSAGE_RECEIVED,
            is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)
        )
    );
    return () => {
        stop_list.forEach(stop => stop());
    };
}
