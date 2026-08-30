import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { compare } from 'compare-versions';

export const MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION = '4.8.4';

export function getFunctionCallingApiVersionUnsupportedMessage(): string | null {
    const version = useDataStore().versions.tavernhelper;
    if (version === '' || compare(version, MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION, '>=')) {
        return null;
    }
    return tr('runtime.functionCalling.versionUnsupported', {
        current: version,
        required: MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION,
    });
}

export function isFunctionCallingApiVersionSupported() {
    return getFunctionCallingApiVersionUnsupportedMessage() === null;
}

export function isFunctionCallingSupported() {
    if (!isFunctionCallingApiVersionSupported()) {
        return false;
    }
    if (!SillyTavern.ToolManager.isToolCallingSupported()) {
        return false;
    }
    return true;
}
