import { cleanupMessageVariables } from '@/function/cleanup/cleanup_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';

export async function checkAndCleanupLegacyChat() {
    const store = useDataStore();
    if (
        !store.settings.自动清理变量.启用 ||
        SillyTavern.chat.length <= store.settings.自动清理变量.要保留变量的最近楼层数 + 5 ||
        !_.has(SillyTavern.chat, [1, 'variables', 0, 'stat_data']) ||
        _.has(SillyTavern.chat, [1, 'variables', 0, 'ignore_cleanup'])
    ) {
        return;
    }

    const result = await SillyTavern.callGenericPopup(
        tr('runtime.cleanup.legacyPrompt'),
        SillyTavern.POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: tr('runtime.cleanup.cleanOnlyButton'),
            cancelButton: tr('runtime.cleanup.doNotRemindButton'),
            customButtons: [tr('runtime.cleanup.backupAndCleanButton')],
        }
    );

    if (
        result === SillyTavern.POPUP_RESULT.CANCELLED ||
        result === SillyTavern.POPUP_RESULT.NEGATIVE
    ) {
        _.set(SillyTavern.chat, [1, 'variables', 0, 'ignore_cleanup'], true);
        return;
    }
    toastr.info(
        tr(
            result === SillyTavern.POPUP_RESULT.CUSTOM1
                ? 'runtime.cleanup.startingWithBackup'
                : 'runtime.cleanup.starting'
        ),
        tr('runtime.cleanup.title')
    );

    if (result === SillyTavern.POPUP_RESULT.CUSTOM1 || result === 2) {
        try {
            const body = {
                is_group: false,
                avatar_url: SillyTavern.characters[Number(SillyTavern.characterId)]?.avatar,
                file: `${SillyTavern.getCurrentChatId()}.jsonl`,
                exportfilename: `${SillyTavern.getCurrentChatId()}.jsonl`,
                format: 'jsonl',
            };

            const response = await fetch('/api/chats/export', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: SillyTavern.getRequestHeaders(),
            });
            const data = await response.json();
            if (!response.ok) {
                toastr.error(
                    tr('runtime.cleanup.exportFailed', {
                        cause: _.escape(String(data.message)),
                    }),
                    tr('runtime.cleanup.title')
                );
                return;
            }
            toastr.success(
                tr('runtime.cleanup.exportSucceeded', {
                    message: _.escape(String(data.message)),
                }),
                tr('runtime.cleanup.title')
            );
            const serialized = data.result;
            const blob = new Blob([serialized], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = body.exportfilename;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            toastr.error(
                tr('runtime.cleanup.exportFailed', {
                    cause: _.escape(String(error)),
                }),
                tr('runtime.cleanup.title')
            );
            return;
        }
    }

    const counter = cleanupMessageVariables(
        1, //0 层永不清理，以保证始终有快照能力。
        SillyTavern.chat.length - 1 - store.settings.自动清理变量.要保留变量的最近楼层数,
        store.settings.自动清理变量.快照保留间隔
    );
    if (counter > 0) {
        toastr.info(
            tr('runtime.cleanup.cleanedMessages', { count: counter }),
            tr('runtime.cleanup.title'),
            {
                timeOut: 1000,
            }
        );
    }
}
