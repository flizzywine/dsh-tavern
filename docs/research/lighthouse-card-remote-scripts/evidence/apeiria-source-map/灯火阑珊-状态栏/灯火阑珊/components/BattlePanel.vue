import { defineComponent as _defineComponent } from 'vue';
import { openBlock as _openBlock, createBlock as _createBlock } from "vue";
import SharedBattlePanel from '../../灯火通明/components/BattlePanel.vue';
export default /*@__PURE__*/ _defineComponent({
    __name: 'BattlePanel',
    props: {
        combatState: {},
        currentEnemies: {},
        playerLevel: {}
    },
    setup(__props) {
        return (_ctx, _cache) => {
            return (_openBlock(), _createBlock(SharedBattlePanel, {
                "combat-state": __props.combatState,
                "current-enemies": __props.currentEnemies,
                "player-level": __props.playerLevel
            }, null, 8 /* PROPS */, ["combat-state", "current-enemies", "player-level"]));
        };
    }
});
