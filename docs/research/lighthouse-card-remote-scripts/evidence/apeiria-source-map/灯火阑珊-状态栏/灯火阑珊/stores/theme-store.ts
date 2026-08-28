import _ from 'lodash';
import { getDefaultTheme, getThemeById, themes } from '../themes';
export const useThemeStore = defineStore('theme', () => {
    const currentThemeId = ref('default');
    const currentTheme = computed(() => {
        return getThemeById(currentThemeId.value) || getDefaultTheme();
    });
    const availableThemes = computed(() => themes);
    const initTheme = () => {
        try {
            const message_id = getCurrentMessageId();
            const variables = getVariables({ type: 'message', message_id });
            const savedThemeId = _.get(variables, 'ui_theme_id', 'red');
            if (typeof savedThemeId === 'string' && getThemeById(savedThemeId)) {
                currentThemeId.value = savedThemeId;
                console.info('[主题] 加载已保存的主题:', savedThemeId);
            }
            else {
                currentThemeId.value = 'red';
                console.info('[主题] 使用默认主题');
            }
        }
        catch (e) {
            console.warn('[主题] 加载主题失败，使用默认主题', e);
            currentThemeId.value = 'red';
        }
    };
    const setTheme = (themeId) => {
        if (getThemeById(themeId)) {
            currentThemeId.value = themeId;
            try {
                const message_id = getCurrentMessageId();
                updateVariablesWith(vars => {
                    _.set(vars, 'ui_theme_id', themeId);
                    return vars;
                }, { type: 'message', message_id });
                console.info('[主题] 主题已切换并保存:', themeId);
                toastr.success(`已切换至「${currentTheme.value.name}」主题`, '踏月寻仙');
            }
            catch (e) {
                console.error('[主题] 保存主题失败', e);
                toastr.warning('主题切换成功，但保存失败', '踏月寻仙');
            }
        }
        else {
            console.warn('[主题] 无效的主题ID:', themeId);
        }
    };
    initTheme();
    return {
        currentThemeId,
        currentTheme,
        availableThemes,
        setTheme,
    };
});
