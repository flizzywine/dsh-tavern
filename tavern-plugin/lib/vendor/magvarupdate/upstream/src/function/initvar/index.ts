import { initCheck } from '@/function/initvar/variable_init';
import { useDataStore } from '@/store';
import { controlledStoppableEventOn } from '@/util';

export async function initInitvar() {
    const stop_list: Array<() => void> = [];

    const store = useDataStore();
    if (store.should_enable) {
        await initCheck();
    }
    stop_list.push(controlledStoppableEventOn(tavern_events.GENERATION_STARTED, initCheck));
    stop_list.push(controlledStoppableEventOn(tavern_events.MESSAGE_SENT, initCheck));

    return () => {
        stop_list.forEach(stop => stop());
    };
}
