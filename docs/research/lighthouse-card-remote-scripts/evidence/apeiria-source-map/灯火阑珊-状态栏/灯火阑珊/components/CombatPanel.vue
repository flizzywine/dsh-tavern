import { defineComponent as _defineComponent } from 'vue';
import { createCommentVNode as _createCommentVNode, openBlock as _openBlock, createBlock as _createBlock, createVNode as _createVNode, Fragment as _Fragment, createElementBlock as _createElementBlock } from "vue";
import { computed } from 'vue';
import BattlePanel from './BattlePanel.vue';
import { isEnemyActive } from './combat-utils';
import PeacePanel from './PeacePanel.vue';
import TribulationPanel from './TribulationPanel.vue';
export default /*@__PURE__*/ _defineComponent({
    __name: 'CombatPanel',
    props: {
        combatState: {},
        currentEnemies: {},
        tribulationState: {},
        playerLevel: {}
    },
    setup(__props) {
        const props = __props;
        // 是否正在渡劫：显式标志优先。只有标志缺失时才兼容极少量旧数据。
        const isInTribulation = computed(() => {
            if (props.tribulationState?.正在渡劫 === true)
                return true;
            if (props.tribulationState?.正在渡劫 === false)
                return false;
            if (props.tribulationState?.上次渡劫结果 && props.tribulationState.上次渡劫结果 !== '无')
                return false;
            // 回退检测：仅在缺失显式标志时，允许旧数据依靠进度字段显示渡劫面板
            if (props.tribulationState?.劫种 &&
                props.tribulationState.劫种 !== '无' &&
                (props.tribulationState?.当前阶段 ?? 0) > 0) {
                return true;
            }
            return false;
        });
        const isInCombat = computed(() => {
            if (props.combatState?.正在战斗)
                return true;
            if (['对峙', '试探', '交锋', '决胜', '脱战'].includes(props.combatState?.阶段 ?? ''))
                return true;
            return Object.values(props.currentEnemies ?? {}).some(isEnemyActive) && (props.combatState?.交锋轮次 ?? 0) > 0;
        });
        // 是否处于战后恢复状态
        const isInRecovery = computed(() => {
            if (isInTribulation.value || isInCombat.value)
                return false;
            const burdens = props.combatState?.负荷;
            const burdened = burdens?.真元 !== '充盈' || burdens?.神识 !== '澄明' || burdens?.肉身 !== '无恙';
            const battleAftermath = props.combatState?.阶段 === '余波';
            const tribAftermath = (props.tribulationState?.劫力承受 ?? 100) < 100;
            const usedProtection = (props.tribulationState?.已用护道?.length ?? 0) > 0;
            const recentTribResult = props.tribulationState?.上次渡劫结果 != null && props.tribulationState.上次渡劫结果 !== '无';
            const hasActiveEnemies = Object.values(props.currentEnemies ?? {}).some(isEnemyActive);
            return !!(burdened || battleAftermath || tribAftermath || usedProtection || recentTribResult || hasActiveEnemies);
        });
        return (_ctx, _cache) => {
            return (_openBlock(), _createElementBlock(_Fragment, null, [
                _createCommentVNode(" 渡劫状态 "),
                (isInTribulation.value)
                    ? (_openBlock(), _createBlock(TribulationPanel, {
                        key: 0,
                        "tribulation-state": __props.tribulationState
                    }, null, 8 /* PROPS */, ["tribulation-state"]))
                    : (isInCombat.value)
                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                            _createCommentVNode(" 战斗状态 "),
                            _createVNode(BattlePanel, {
                                "combat-state": __props.combatState,
                                "current-enemies": __props.currentEnemies,
                                "player-level": __props.playerLevel
                            }, null, 8 /* PROPS */, ["combat-state", "current-enemies", "player-level"])
                        ], 2112 /* STABLE_FRAGMENT, DEV_ROOT_FRAGMENT */))
                        : (_openBlock(), _createElementBlock(_Fragment, { key: 2 }, [
                            _createCommentVNode(" 和平/恢复状态 "),
                            _createVNode(PeacePanel, {
                                "combat-state": __props.combatState,
                                "current-enemies": __props.currentEnemies,
                                "tribulation-state": __props.tribulationState,
                                "is-in-recovery": isInRecovery.value
                            }, null, 8 /* PROPS */, ["combat-state", "current-enemies", "tribulation-state", "is-in-recovery"])
                        ], 2112 /* STABLE_FRAGMENT, DEV_ROOT_FRAGMENT */))
            ], 2112 /* STABLE_FRAGMENT, DEV_ROOT_FRAGMENT */));
        };
    }
});
