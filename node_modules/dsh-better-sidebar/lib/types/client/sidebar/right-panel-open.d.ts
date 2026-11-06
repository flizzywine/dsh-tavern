/**
 * 跟踪宿主右侧面板的展开态。
 * @returns 展开时为 true（首帧同步读取，之后由模块级共享 poller 每 500ms 复核；
 *  订阅者归零即停表，页面隐藏期间不起表）。
 */
export declare function useRightPanelOpen(): boolean;
