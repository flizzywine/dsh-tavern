import { tr } from '@/i18n';
import { PLOT_REGEX, UPDATE_REGEX } from '@/variable_def';

export async function isExtraModelSupported(): Promise<boolean> {
    try {
        const lorebook_name = getCurrentCharPrimaryLorebook();
        if (!lorebook_name) {
            return false;
        }
        return await getLorebookEntries(lorebook_name).then(entries =>
            entries.some(
                entry => UPDATE_REGEX.test(entry.comment) || PLOT_REGEX.test(entry.comment)
            )
        );
    } catch {
        console.warn(tr('runtime.extraModel.characterLorebookUnavailableLog'));
        return false;
    }
}
