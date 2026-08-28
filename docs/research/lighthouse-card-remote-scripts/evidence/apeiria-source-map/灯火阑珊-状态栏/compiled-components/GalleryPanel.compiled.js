import { defineComponent as _defineComponent } from 'vue';
import { unref as _unref, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode, Transition as _Transition, withCtx as _withCtx, createVNode as _createVNode, toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, withModifiers as _withModifiers, normalizeClass as _normalizeClass, Teleport as _Teleport, createBlock as _createBlock } from "vue";
const _hoisted_1 = { class: "panel gallery-panel" };
const _hoisted_2 = {
    key: 0,
    class: "gallery-container"
};
const _hoisted_3 = ["onClick"];
const _hoisted_4 = { class: "card-inner" };
const _hoisted_5 = { class: "card-face card-front" };
const _hoisted_6 = ["src", "alt"];
const _hoisted_7 = { class: "card-name-bar" };
const _hoisted_8 = { class: "card-face card-back" };
const _hoisted_9 = { class: "back-content" };
const _hoisted_10 = ["src", "alt"];
const _hoisted_11 = { class: "back-info-panel" };
const _hoisted_12 = { class: "back-name" };
const _hoisted_13 = { class: "back-text" };
const _hoisted_14 = ["onClick"];
const _hoisted_15 = ["onClick"];
const _hoisted_16 = ["onClick"];
const _hoisted_17 = ["onClick"];
const _hoisted_18 = {
    key: 1,
    class: "empty-hint"
};
const _hoisted_19 = { class: "preview-header" };
const _hoisted_20 = { class: "preview-identity" };
const _hoisted_21 = {
    key: 0,
    class: "preview-character-tabs",
    "aria-label": "切换在场角色"
};
const _hoisted_22 = ["onClick"];
const _hoisted_23 = { class: "preview-media" };
const _hoisted_24 = ["src", "alt"];
const _hoisted_25 = {
    key: 0,
    class: "preview-thought"
};
const _hoisted_26 = { class: "preview-actions" };
import { useDataStore } from '../store';

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
export default /*@__PURE__*/ _defineComponent({
    __name: 'GalleryPanel',
    setup(__props) {
        const store = useDataStore();
        const previewCardIndex = ref(null);
        let bodyOverflowBeforePreview = '';
        let isBodyScrollLocked = false;
        const getCardDisplayName = (card) => {
            return card.isFlipped ? card.backName || card.name : card.frontName || card.name;
        };
        const getVisiblePool = (card) => {
            return card.isFlipped ? card.backCandidates : card.frontCandidates;
        };
        const getVisibleImage = (card) => {
            return card.isFlipped ? card.back : card.front;
        };
        const previewCard = computed(() => {
            if (previewCardIndex.value === null)
                return null;
            return store.galleryCards[previewCardIndex.value] ?? null;
        });
        const browseCard = (index, direction) => {
            store.changeGalleryCardImage(index, direction);
        };
        const browsePreview = (direction) => {
            if (previewCardIndex.value === null)
                return;
            browseCard(previewCardIndex.value, direction);
        };
        const openPreview = (index) => {
            if (!store.galleryCards[index])
                return;
            previewCardIndex.value = index;
        };
        const selectPreviewCard = (index) => {
            if (!store.galleryCards[index])
                return;
            previewCardIndex.value = index;
        };
        const togglePreviewFlip = () => {
            if (previewCardIndex.value === null)
                return;
            store.toggleCardFlip(previewCardIndex.value);
        };
        const closePreview = () => {
            previewCardIndex.value = null;
        };
        const onWindowKeydown = (event) => {
            if (event.key === 'Escape') {
                closePreview();
            }
            else if (previewCard.value && event.key === 'ArrowLeft') {
                event.preventDefault();
                browsePreview(-1);
            }
            else if (previewCard.value && event.key === 'ArrowRight') {
                event.preventDefault();
                browsePreview(1);
            }
        };
        onMounted(() => {
            window.addEventListener('keydown', onWindowKeydown);
        });
        onBeforeUnmount(() => {
            window.removeEventListener('keydown', onWindowKeydown);
            if (isBodyScrollLocked) {
                document.body.style.overflow = bodyOverflowBeforePreview;
            }
        });
        watch(() => previewCard.value !== null, isOpen => {
            if (isOpen) {
                bodyOverflowBeforePreview = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                isBodyScrollLocked = true;
                return;
            }
            if (isBodyScrollLocked) {
                document.body.style.overflow = bodyOverflowBeforePreview;
                isBodyScrollLocked = false;
            }
        });
        watch(() => store.galleryCards.length, length => {
            if (length <= 0) {
                closePreview();
                return;
            }
            if (previewCardIndex.value !== null && previewCardIndex.value >= length) {
                closePreview();
            }
        }, { immediate: true });
        return (_ctx, _cache) => {
            return (_openBlock(), _createElementBlock("div", _hoisted_1, [
                (_unref(store).hasGalleryCards)
                    ? (_openBlock(), _createElementBlock("div", _hoisted_2, [
                        (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(store).galleryCards, (card, index) => {
                            return (_openBlock(), _createElementBlock("div", {
                                key: index,
                                class: _normalizeClass(["gallery-card", { flipped: card.isFlipped }]),
                                onClick: ($event) => (_unref(store).toggleCardFlip(index))
                            }, [
                                _createElementVNode("div", _hoisted_4, [
                                    _createCommentVNode(" 正面 "),
                                    _createElementVNode("div", _hoisted_5, [
                                        _createVNode(_Transition, { name: "portrait-fade" }, {
                                            default: _withCtx(() => [
                                                (_openBlock(), _createElementBlock("img", {
                                                    key: card.front,
                                                    src: card.front,
                                                    alt: card.frontName || card.name
                                                }, null, 8 /* PROPS */, _hoisted_6))
                                            ]),
                                            _: 2 /* DYNAMIC */
                                        }, 1024 /* DYNAMIC_SLOTS */),
                                        _createElementVNode("div", _hoisted_7, _toDisplayString(card.frontName || card.name), 1 /* TEXT */)
                                    ]),
                                    _createCommentVNode(" 背面 "),
                                    _createElementVNode("div", _hoisted_8, [
                                        _createElementVNode("div", _hoisted_9, [
                                            _createVNode(_Transition, { name: "portrait-fade" }, {
                                                default: _withCtx(() => [
                                                    (_openBlock(), _createElementBlock("img", {
                                                        key: card.back,
                                                        src: card.back,
                                                        alt: card.backName || card.name,
                                                        class: "back-image"
                                                    }, null, 8 /* PROPS */, _hoisted_10))
                                                ]),
                                                _: 2 /* DYNAMIC */
                                            }, 1024 /* DYNAMIC_SLOTS */),
                                            _createElementVNode("div", _hoisted_11, [
                                                _createElementVNode("div", _hoisted_12, _toDisplayString(card.backName || card.name), 1 /* TEXT */),
                                                _createElementVNode("div", _hoisted_13, "「" + _toDisplayString(card.backText) + "」", 1 /* TEXT */)
                                            ])
                                        ])
                                    ])
                                ]),
                                _createElementVNode("div", {
                                    class: "card-image-controls",
                                    onClick: _cache[0] || (_cache[0] = _withModifiers(() => { }, ["stop"]))
                                }, [
                                    (getVisiblePool(card).length > 1)
                                        ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                                            _createElementVNode("button", {
                                                type: "button",
                                                "aria-label": "上一张立绘",
                                                title: "上一张",
                                                onClick: ($event) => (browseCard(index, -1))
                                            }, [...(_cache[5] || (_cache[5] = [
                                                    _createElementVNode("i", { class: "fa-solid fa-chevron-left" }, null, -1 /* CACHED */)
                                                ]))], 8 /* PROPS */, _hoisted_14),
                                            _createElementVNode("button", {
                                                type: "button",
                                                "aria-label": "随机更换立绘",
                                                title: "随机更换",
                                                onClick: ($event) => (browseCard(index, 'random'))
                                            }, [...(_cache[6] || (_cache[6] = [
                                                    _createElementVNode("i", { class: "fa-solid fa-shuffle" }, null, -1 /* CACHED */)
                                                ]))], 8 /* PROPS */, _hoisted_15),
                                            _createElementVNode("button", {
                                                type: "button",
                                                "aria-label": "下一张立绘",
                                                title: "下一张",
                                                onClick: ($event) => (browseCard(index, 1))
                                            }, [...(_cache[7] || (_cache[7] = [
                                                    _createElementVNode("i", { class: "fa-solid fa-chevron-right" }, null, -1 /* CACHED */)
                                                ]))], 8 /* PROPS */, _hoisted_16)
                                        ], 64 /* STABLE_FRAGMENT */))
                                        : _createCommentVNode("v-if", true),
                                    _createElementVNode("button", {
                                        type: "button",
                                        "aria-label": "放大查看立绘",
                                        title: "查看大图",
                                        onClick: ($event) => (openPreview(index))
                                    }, [...(_cache[8] || (_cache[8] = [
                                            _createElementVNode("i", { class: "fa-solid fa-magnifying-glass-plus" }, null, -1 /* CACHED */)
                                        ]))], 8 /* PROPS */, _hoisted_17)
                                ])
                            ], 10 /* CLASS, PROPS */, _hoisted_3));
                        }), 128 /* KEYED_FRAGMENT */))
                    ]))
                    : (_openBlock(), _createElementBlock("div", _hoisted_18, "当前场景暂无角色卡片")),
                (_openBlock(), _createBlock(_Teleport, { to: "body" }, [
                    _createVNode(_Transition, { name: "preview-fade" }, {
                        default: _withCtx(() => [
                            (_unref(previewCard))
                                ? (_openBlock(), _createElementBlock("div", {
                                    key: 0,
                                    class: "preview-overlay",
                                    role: "dialog",
                                    "aria-modal": "true",
                                    onClick: closePreview
                                }, [
                                    _createElementVNode("div", {
                                        class: "preview-dialog",
                                        onClick: _cache[4] || (_cache[4] = _withModifiers(() => { }, ["stop"]))
                                    }, [
                                        _createElementVNode("header", _hoisted_19, [
                                            _createElementVNode("div", _hoisted_20, [
                                                _createElementVNode("strong", null, _toDisplayString(getCardDisplayName(_unref(previewCard))), 1 /* TEXT */),
                                                _createElementVNode("span", null, _toDisplayString(_unref(previewCard).isFlipped ? '背面立绘' : '正面立绘'), 1 /* TEXT */)
                                            ]),
                                            _createElementVNode("button", {
                                                type: "button",
                                                class: "preview-close",
                                                "aria-label": "关闭大图预览",
                                                title: "关闭",
                                                onClick: closePreview
                                            }, [...(_cache[9] || (_cache[9] = [
                                                    _createElementVNode("i", { class: "fa-solid fa-xmark" }, null, -1 /* CACHED */)
                                                ]))])
                                        ]),
                                        (_unref(store).galleryCards.length > 1)
                                            ? (_openBlock(), _createElementBlock("nav", _hoisted_21, [
                                                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(store).galleryCards, (card, index) => {
                                                    return (_openBlock(), _createElementBlock("button", {
                                                        key: `${card.name}-${index}`,
                                                        type: "button",
                                                        class: _normalizeClass({ active: _unref(previewCardIndex) === index }),
                                                        onClick: ($event) => (selectPreviewCard(index))
                                                    }, _toDisplayString(card.frontName || card.name), 11 /* TEXT, CLASS, PROPS */, _hoisted_22));
                                                }), 128 /* KEYED_FRAGMENT */))
                                            ]))
                                            : _createCommentVNode("v-if", true),
                                        _createElementVNode("div", _hoisted_23, [
                                            _createVNode(_Transition, {
                                                name: "preview-portrait",
                                                mode: "out-in"
                                            }, {
                                                default: _withCtx(() => [
                                                    (_openBlock(), _createElementBlock("img", {
                                                        key: `${_unref(previewCard).isFlipped ? 'back' : 'front'}:${getVisibleImage(_unref(previewCard))}`,
                                                        src: getVisibleImage(_unref(previewCard)),
                                                        alt: getCardDisplayName(_unref(previewCard)),
                                                        class: "preview-image"
                                                    }, null, 8 /* PROPS */, _hoisted_24))
                                                ]),
                                                _: 1 /* STABLE */
                                            }),
                                            (_unref(previewCard).isFlipped && _unref(previewCard).backText)
                                                ? (_openBlock(), _createElementBlock("div", _hoisted_25, " 「" + _toDisplayString(_unref(previewCard).backText) + "」 ", 1 /* TEXT */))
                                                : _createCommentVNode("v-if", true)
                                        ]),
                                        _createElementVNode("footer", _hoisted_26, [
                                            (getVisiblePool(_unref(previewCard)).length > 1)
                                                ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                                                    _createElementVNode("button", {
                                                        type: "button",
                                                        "aria-label": "上一张立绘",
                                                        title: "上一张",
                                                        onClick: _cache[1] || (_cache[1] = ($event) => (browsePreview(-1)))
                                                    }, [...(_cache[10] || (_cache[10] = [
                                                            _createElementVNode("i", { class: "fa-solid fa-chevron-left" }, null, -1 /* CACHED */)
                                                        ]))]),
                                                    _createElementVNode("button", {
                                                        type: "button",
                                                        "aria-label": "随机更换立绘",
                                                        title: "随机更换",
                                                        onClick: _cache[2] || (_cache[2] = ($event) => (browsePreview('random')))
                                                    }, [...(_cache[11] || (_cache[11] = [
                                                            _createElementVNode("i", { class: "fa-solid fa-shuffle" }, null, -1 /* CACHED */)
                                                        ]))]),
                                                    _createElementVNode("button", {
                                                        type: "button",
                                                        "aria-label": "下一张立绘",
                                                        title: "下一张",
                                                        onClick: _cache[3] || (_cache[3] = ($event) => (browsePreview(1)))
                                                    }, [...(_cache[12] || (_cache[12] = [
                                                            _createElementVNode("i", { class: "fa-solid fa-chevron-right" }, null, -1 /* CACHED */)
                                                        ]))])
                                                ], 64 /* STABLE_FRAGMENT */))
                                                : _createCommentVNode("v-if", true),
                                            _createElementVNode("button", {
                                                type: "button",
                                                "aria-label": "翻转立绘",
                                                title: "翻转正反面",
                                                onClick: togglePreviewFlip
                                            }, [...(_cache[13] || (_cache[13] = [
                                                    _createElementVNode("i", { class: "fa-solid fa-rotate" }, null, -1 /* CACHED */)
                                                ]))])
                                        ])
                                    ])
                                ]))
                                : _createCommentVNode("v-if", true)
                        ]),
                        _: 1 /* STABLE */
                    })
                ]))
            ]));
        };
    }
});
