import { defineComponent as _defineComponent } from 'vue';
import { openBlock as _openBlock, createBlock as _createBlock } from "vue";
import SharedPeacePanel from '../../灯火通明/components/PeacePanel.vue';
export default /*@__PURE__*/ _defineComponent({
    __name: 'PeacePanel',
    props: {
        combatState: {},
        currentEnemies: {},
        tribulationState: {},
        isInRecovery: { type: Boolean }
    },
    setup(__props) {
        return (_ctx, _cache) => {
            return (_openBlock(), _createBlock(SharedPeacePanel, {
                "combat-state": __props.combatState,
                "current-enemies": __props.currentEnemies,
                "tribulation-state": __props.tribulationState,
                "is-in-recovery": __props.isInRecovery
            }, null, 8 /* PROPS */, ["combat-state", "current-enemies", "tribulation-state", "is-in-recovery"]));
        };
    }
});
