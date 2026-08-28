import { defineComponent as _defineComponent } from 'vue';
import { openBlock as _openBlock, createBlock as _createBlock } from "vue";
import SharedPresetPanel from '../../灯火通明/components/PresetPanel.vue';
export default /*@__PURE__*/ _defineComponent({
    __name: 'PresetPanel',
    setup(__props) {
        return (_ctx, _cache) => {
            return (_openBlock(), _createBlock(SharedPresetPanel));
        };
    }
});
