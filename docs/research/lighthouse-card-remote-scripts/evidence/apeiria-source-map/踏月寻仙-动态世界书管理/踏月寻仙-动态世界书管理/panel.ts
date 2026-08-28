import { createScriptIdDiv, destroyScriptIdDiv, deteleportStyle, teleportStyle } from '@/util/script';
import 设置界面 from './设置界面.vue';
const pinia = createPinia();
const panelApp = createApp(设置界面).use(pinia);
let mounted = false;
export function mountDynamicWorldbookPanel() {
    if (mounted)
        return;
    const $app = createScriptIdDiv();
    $('#extensions_settings2').append($app);
    teleportStyle();
    panelApp.mount($app[0]);
    mounted = true;
}
export function unmountDynamicWorldbookPanel() {
    if (!mounted)
        return;
    panelApp.unmount();
    deteleportStyle();
    destroyScriptIdDiv();
    mounted = false;
}
