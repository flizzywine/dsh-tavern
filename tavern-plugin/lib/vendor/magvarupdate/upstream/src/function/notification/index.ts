import { tr } from '@/i18n';
import { useDataStore } from '@/store';

function notify(title: string, message: string) {
    toastr.success(message, title, { timeOut: 10000 });
}

export function initNotification() {
    const store = useDataStore();

    if (store.settings.internal.已提醒更新了配置界面 === false) {
        notify(
            tr('runtime.notification.settingsUiUpdatedTitle'),
            tr('runtime.notification.settingsUiUpdatedBody')
        );
        store.settings.internal.已提醒更新了配置界面 = true;
    }
    if (store.settings.internal.已提醒自动清理旧变量功能 === false) {
        notify(
            tr('runtime.notification.autoCleanupFeatureTitle'),
            tr('runtime.notification.autoCleanupFeatureBody')
        );
        store.settings.internal.已提醒自动清理旧变量功能 = true;
    }
    if (store.settings.internal.已提醒更新了API温度等配置 === false) {
        notify(
            tr('runtime.notification.customApiOptionsTitle'),
            tr('runtime.notification.customApiOptionsBody')
        );
        store.settings.internal.已提醒更新了API温度等配置 = true;
    }

    if (store.settings.internal.已默认开启自动清理旧变量功能 === false) {
        notify(
            tr('runtime.notification.cleanupDefaultTitle'),
            tr('runtime.notification.cleanupDefaultBody')
        );
        store.settings.internal.已默认开启自动清理旧变量功能 = true;
        store.settings.自动清理变量.启用 = true;
    }

    if (store.settings.internal.已提醒内置破限 === false) {
        notify(
            tr('runtime.notification.builtinJailbreakTitle'),
            tr('runtime.notification.builtinJailbreakBody')
        );
        store.settings.internal.已提醒内置破限 = true;
    }

    if (store.settings.internal.已提醒额外模型同时请求 === false) {
        notify(
            tr('runtime.notification.concurrentRequestsTitle'),
            tr('runtime.notification.concurrentRequestsBody')
        );
        store.settings.internal.已提醒额外模型同时请求 = true;
    }

    if (store.settings.通知.MVU框架加载成功) {
        toastr.info(
            tr('runtime.notification.buildInfo', {
                date: __BUILD_DATE__ ?? tr('runtime.common.unknown'),
                commit: __COMMIT_ID__ ?? tr('runtime.common.unknown'),
            }),
            tr('runtime.notification.scriptLoadedTitle')
        );
    }

    return () => {};
}
