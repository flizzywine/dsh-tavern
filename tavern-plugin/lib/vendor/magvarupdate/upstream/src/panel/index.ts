import { i18n } from '@/i18n';
import Panel from '@/panel/Panel.vue';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

export function initPanel() {
    const app = createApp(Panel)
        .use(getActivePinia() ?? createPinia())
        .use(i18n);

    const $app = createScriptIdDiv();
    $('#extensions_settings2').append($app);
    app.mount($app[0]);

    const { destroy: destroyStyle } = teleportStyle();

    return () => {
        app.unmount();
        $app.remove();
        destroyStyle();
    };
}
