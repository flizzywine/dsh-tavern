import { updateVariable, updateVariables } from '@/function/update_variables';
import { exported_events, VariableData } from '@/variable_def';
import { controlledStoppableEventOn } from '@/util';

export async function handleVariablesInCallback(
    message_content: string,
    in_out_variable_info: VariableData
) {
    if (in_out_variable_info.old_variables === undefined) {
        return;
    }
    in_out_variable_info.new_variables = klona(in_out_variable_info.old_variables);
    await updateVariables(message_content, in_out_variable_info.new_variables);
    return in_out_variable_info.new_variables;
}

export function initExportedEvents() {
    const stop_list: Array<() => void> = [];

    stop_list.push(
        controlledStoppableEventOn(exported_events.INVOKE_MVU_PROCESS, handleVariablesInCallback)
    );
    stop_list.push(controlledStoppableEventOn(exported_events.UPDATE_VARIABLE, updateVariable));

    return () => {
        stop_list.forEach(stop => stop());
    };
}
