import { defineComponent as _defineComponent } from 'vue';
import { unref as _unref, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, createCommentVNode as _createCommentVNode, normalizeStyle as _normalizeStyle, normalizeClass as _normalizeClass, createTextVNode as _createTextVNode } from "vue";
const _hoisted_1 = { class: "panel companions-panel" };
const _hoisted_2 = { class: "companions-list" };
const _hoisted_3 = ["onClick"];
const _hoisted_4 = { class: "header-main" };
const _hoisted_5 = { class: "companion-name" };
const _hoisted_6 = { class: "companion-badges" };
const _hoisted_7 = { class: "relation-badge" };
const _hoisted_8 = {
    key: 0,
    class: "context-badge"
};
const _hoisted_9 = { class: "header-side" };
const _hoisted_10 = { class: "companion-favor" };
const _hoisted_11 = { class: "favor-bar" };
const _hoisted_12 = {
    key: 0,
    class: "context-section"
};
const _hoisted_13 = { class: "context-label" };
const _hoisted_14 = { class: "context-value" };
const _hoisted_15 = {
    key: 1,
    class: "context-empty"
};
const _hoisted_16 = {
    key: 1,
    class: "portrait-section"
};
const _hoisted_17 = { class: "portrait-grid" };
const _hoisted_18 = { class: "portrait-slot" };
const _hoisted_19 = { class: "portrait-preview" };
const _hoisted_20 = ["src", "alt"];
const _hoisted_21 = {
    key: 1,
    class: "portrait-empty"
};
const _hoisted_22 = { class: "portrait-actions" };
const _hoisted_23 = ["for"];
const _hoisted_24 = ["onClick"];
const _hoisted_25 = ["id", "onChange"];
const _hoisted_26 = { class: "portrait-slot" };
const _hoisted_27 = { class: "portrait-preview" };
const _hoisted_28 = ["src", "alt"];
const _hoisted_29 = {
    key: 1,
    class: "portrait-empty"
};
const _hoisted_30 = { class: "portrait-actions" };
const _hoisted_31 = ["for"];
const _hoisted_32 = ["onClick"];
const _hoisted_33 = ["id", "onChange"];
const _hoisted_34 = {
    key: 0,
    class: "empty-hint"
};
import { REALM_NAMES, REALM_STAGES, getRealmColor } from '../schema';
import { useDataStore } from '../store';

import { ref, watch } from 'vue';
export default /*@__PURE__*/ _defineComponent({
    __name: 'CompanionsPanel',
    setup(__props) {
        const store = useDataStore();
        const expandedName = ref('');
        const uploadStates = ref({});
        const CONTEXT_LABELS = {
            态度缘由: '此念所起',
            关系诉求: '心中所求',
            相处禁忌: '所忌',
            未了约定: '未竟之约',
        };
        watch(() => Object.keys(store.红颜), names => {
            if (names.length === 0) {
                expandedName.value = '';
                return;
            }
            if (!expandedName.value || !names.includes(expandedName.value)) {
                expandedName.value = names[0] ?? '';
            }
        }, { immediate: true });
        function getRealmDescription(levelRaw, fallbackRaw) {
            const fallback = String(fallbackRaw ?? '').trim();
            const level = Number(levelRaw);
            const maxLevel = REALM_NAMES.length * REALM_STAGES.length;
            if (!Number.isFinite(level) || level < 1) {
                return fallback || '练气初期';
            }
            const normalizedLevel = Math.min(Math.floor(level), maxLevel);
            const majorIdx = Math.floor((normalizedLevel - 1) / REALM_STAGES.length);
            const minorIdx = (normalizedLevel - 1) % REALM_STAGES.length;
            const major = REALM_NAMES[majorIdx];
            const minor = REALM_STAGES[minorIdx];
            if (!major || !minor) {
                return fallback || '练气初期';
            }
            return `${major}${minor}`;
        }
        function isExpanded(name) {
            return expandedName.value === name;
        }
        function toggleExpanded(name) {
            expandedName.value = expandedName.value === name ? '' : name;
        }
        function getContextEntries(companion) {
            const context = companion.关系上下文 ?? {};
            return Object.entries(CONTEXT_LABELS)
                .map(([key, label]) => ({
                label,
                value: String(context[key] ?? '').trim(),
            }))
                .filter(entry => entry.value);
        }
        function isCustomCompanion(name) {
            return !store.isBuiltinCompanionName(name);
        }
        function getCustomPortrait(name) {
            const portraitConfig = store.红颜角色库?.[name]?.自定义立绘 ?? {};
            return {
                front: String(portraitConfig?.正面 ?? '').trim(),
                back: String(portraitConfig?.背面 ?? '').trim(),
            };
        }
        function ensureUploadState(name) {
            if (!uploadStates.value[name]) {
                uploadStates.value[name] = { 正面: false, 背面: false };
            }
            return uploadStates.value[name];
        }
        function isUploading(name, side) {
            return ensureUploadState(name)[side];
        }
        function readFileAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result ?? ''));
                reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
                reader.readAsDataURL(file);
            });
        }
        async function onPortraitSelected(name, side, event) {
            const input = event.target;
            const file = input?.files?.[0];
            if (!file)
                return;
            const uploadState = ensureUploadState(name);
            uploadState[side] = true;
            try {
                const dataUrl = await readFileAsDataUrl(file);
                const saved = await store.updateCustomCompanionPortrait(name, side, dataUrl);
                if (saved) {
                    toastr.success(`${name}的${side}立绘已保存`, '自定义立绘');
                }
            }
            catch (error) {
                console.error('[踏月寻仙] 读取自定义立绘失败', error);
                toastr.error(`读取${side}立绘失败`, '自定义立绘');
            }
            finally {
                uploadState[side] = false;
                if (input) {
                    input.value = '';
                }
            }
        }
        async function clearPortrait(name, side) {
            const cleared = await store.clearCustomCompanionPortrait(name, side);
            if (cleared) {
                toastr.success(`${name}的${side}立绘已清除`, '自定义立绘');
            }
        }
        return (_ctx, _cache) => {
            return (_openBlock(), _createElementBlock("div", _hoisted_1, [
                _createElementVNode("div", _hoisted_2, [
                    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(store).红颜, (companion, name) => {
                        return (_openBlock(), _createElementBlock("div", {
                            key: name,
                            class: _normalizeClass(["companion-card", { expanded: isExpanded(name) }])
                        }, [
                            _createElementVNode("button", {
                                class: "companion-header",
                                type: "button",
                                onClick: ($event) => (toggleExpanded(name))
                            }, [
                                _createElementVNode("div", _hoisted_4, [
                                    _createElementVNode("span", _hoisted_5, _toDisplayString(name), 1 /* TEXT */),
                                    _createElementVNode("div", _hoisted_6, [
                                        _createElementVNode("span", _hoisted_7, _toDisplayString(companion.关系), 1 /* TEXT */),
                                        (companion.关系上下文?.当前情绪)
                                            ? (_openBlock(), _createElementBlock("span", _hoisted_8, _toDisplayString(companion.关系上下文.当前情绪), 1 /* TEXT */))
                                            : _createCommentVNode("v-if", true)
                                    ])
                                ]),
                                _createElementVNode("div", _hoisted_9, [
                                    _createElementVNode("span", {
                                        class: "companion-realm",
                                        style: _normalizeStyle({ color: _unref(getRealmColor)(companion.等级) })
                                    }, _toDisplayString(getRealmDescription(companion.等级, companion.境界描述)), 5 /* TEXT, STYLE */),
                                    _createElementVNode("i", {
                                        class: _normalizeClass(["fa-solid", isExpanded(name) ? 'fa-chevron-up' : 'fa-chevron-down'])
                                    }, null, 2 /* CLASS */)
                                ])
                            ], 8 /* PROPS */, _hoisted_3),
                            _createElementVNode("div", _hoisted_10, [
                                _cache[0] || (_cache[0] = _createElementVNode("div", { class: "favor-label" }, [
                                    _createElementVNode("i", {
                                        class: "fa-solid fa-heart",
                                        style: { "font-size": "10px", "margin-right": "4px", "opacity": "0.8" }
                                    }),
                                    _createTextVNode("好感")
                                ], -1 /* CACHED */)),
                                _createElementVNode("div", _hoisted_11, [
                                    _createElementVNode("div", {
                                        class: _normalizeClass(["favor-fill", { 'is-negative': companion.好感度 < 0 }]),
                                        style: _normalizeStyle({ width: `${Math.min(Math.abs(companion.好感度) / 2, 100)}%` })
                                    }, null, 6 /* CLASS, STYLE */)
                                ]),
                                _createElementVNode("div", {
                                    class: _normalizeClass(["favor-value", { 'is-negative': companion.好感度 < 0 }])
                                }, _toDisplayString(companion.好感度), 3 /* TEXT, CLASS */)
                            ]),
                            (isExpanded(name))
                                ? (_openBlock(), _createElementBlock("div", _hoisted_12, [
                                    _cache[1] || (_cache[1] = _createElementVNode("div", { class: "context-title" }, [
                                        _createElementVNode("i", { class: "fa-solid fa-feather-pointed" }),
                                        _createElementVNode("span", null, "心迹微澜")
                                    ], -1 /* CACHED */)),
                                    (getContextEntries(companion).length > 0)
                                        ? (_openBlock(), _createElementBlock("div", {
                                            key: 0,
                                            class: _normalizeClass(["context-list", { 'context-list--triple': getContextEntries(companion).length === 3 }])
                                        }, [
                                            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(getContextEntries(companion), (entry) => {
                                                return (_openBlock(), _createElementBlock("div", {
                                                    key: entry.label,
                                                    class: "context-item"
                                                }, [
                                                    _createElementVNode("div", _hoisted_13, _toDisplayString(entry.label), 1 /* TEXT */),
                                                    _createElementVNode("div", _hoisted_14, _toDisplayString(entry.value), 1 /* TEXT */)
                                                ]));
                                            }), 128 /* KEYED_FRAGMENT */))
                                        ], 2 /* CLASS */))
                                        : (_openBlock(), _createElementBlock("div", _hoisted_15, " 眼下尚无可书之绪。待相与日深，此间自会渐记其心念、所求、所忌与未竟之约。 "))
                                ]))
                                : _createCommentVNode("v-if", true),
                            (isExpanded(name) && isCustomCompanion(name))
                                ? (_openBlock(), _createElementBlock("div", _hoisted_16, [
                                    _cache[4] || (_cache[4] = _createElementVNode("div", { class: "portrait-title" }, [
                                        _createElementVNode("i", { class: "fa-solid fa-image-portrait" }),
                                        _createElementVNode("span", null, "自定义立绘")
                                    ], -1 /* CACHED */)),
                                    _cache[5] || (_cache[5] = _createElementVNode("div", { class: "portrait-hint" }, " 此角色不在预设红颜库中，可自行上传立绘。若只上传正面，图鉴背面会优先沿用正面图。 ", -1 /* CACHED */)),
                                    _createElementVNode("div", _hoisted_17, [
                                        _createElementVNode("div", _hoisted_18, [
                                            _cache[2] || (_cache[2] = _createElementVNode("div", { class: "portrait-label" }, "正面立绘", -1 /* CACHED */)),
                                            _createElementVNode("div", _hoisted_19, [
                                                (getCustomPortrait(name).front)
                                                    ? (_openBlock(), _createElementBlock("img", {
                                                        key: 0,
                                                        src: getCustomPortrait(name).front,
                                                        alt: `${name}正面立绘`
                                                    }, null, 8 /* PROPS */, _hoisted_20))
                                                    : (_openBlock(), _createElementBlock("div", _hoisted_21, "未上传"))
                                            ]),
                                            _createElementVNode("div", _hoisted_22, [
                                                _createElementVNode("label", {
                                                    class: "portrait-button",
                                                    for: `portrait-front-${name}`
                                                }, _toDisplayString(isUploading(name, '正面') ? '上传中...' : '上传正面'), 9 /* TEXT, PROPS */, _hoisted_23),
                                                (getCustomPortrait(name).front)
                                                    ? (_openBlock(), _createElementBlock("button", {
                                                        key: 0,
                                                        class: "portrait-button portrait-button--ghost",
                                                        type: "button",
                                                        onClick: ($event) => (clearPortrait(name, '正面'))
                                                    }, " 清除 ", 8 /* PROPS */, _hoisted_24))
                                                    : _createCommentVNode("v-if", true)
                                            ]),
                                            _createElementVNode("input", {
                                                id: `portrait-front-${name}`,
                                                class: "portrait-input",
                                                type: "file",
                                                accept: "image/*",
                                                onChange: ($event) => (onPortraitSelected(name, '正面', $event))
                                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_25)
                                        ]),
                                        _createElementVNode("div", _hoisted_26, [
                                            _cache[3] || (_cache[3] = _createElementVNode("div", { class: "portrait-label" }, "背面立绘", -1 /* CACHED */)),
                                            _createElementVNode("div", _hoisted_27, [
                                                (getCustomPortrait(name).back)
                                                    ? (_openBlock(), _createElementBlock("img", {
                                                        key: 0,
                                                        src: getCustomPortrait(name).back,
                                                        alt: `${name}背面立绘`
                                                    }, null, 8 /* PROPS */, _hoisted_28))
                                                    : (_openBlock(), _createElementBlock("div", _hoisted_29, "未上传"))
                                            ]),
                                            _createElementVNode("div", _hoisted_30, [
                                                _createElementVNode("label", {
                                                    class: "portrait-button",
                                                    for: `portrait-back-${name}`
                                                }, _toDisplayString(isUploading(name, '背面') ? '上传中...' : '上传背面'), 9 /* TEXT, PROPS */, _hoisted_31),
                                                (getCustomPortrait(name).back)
                                                    ? (_openBlock(), _createElementBlock("button", {
                                                        key: 0,
                                                        class: "portrait-button portrait-button--ghost",
                                                        type: "button",
                                                        onClick: ($event) => (clearPortrait(name, '背面'))
                                                    }, " 清除 ", 8 /* PROPS */, _hoisted_32))
                                                    : _createCommentVNode("v-if", true)
                                            ]),
                                            _createElementVNode("input", {
                                                id: `portrait-back-${name}`,
                                                class: "portrait-input",
                                                type: "file",
                                                accept: "image/*",
                                                onChange: ($event) => (onPortraitSelected(name, '背面', $event))
                                            }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_33)
                                        ])
                                    ])
                                ]))
                                : _createCommentVNode("v-if", true)
                        ], 2 /* CLASS */));
                    }), 128 /* KEYED_FRAGMENT */)),
                    (Object.keys(_unref(store).红颜).length === 0)
                        ? (_openBlock(), _createElementBlock("div", _hoisted_34, "孑然一身，尚无红颜知己"))
                        : _createCommentVNode("v-if", true)
                ])
            ]));
        };
    }
});
