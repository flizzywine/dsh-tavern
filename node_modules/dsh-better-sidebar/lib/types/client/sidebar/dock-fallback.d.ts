/**
 * 空白会话专用的底部工作台开关（issue #698 / #623）。
 *
 * blank 会话里宿主不渲染会话头，本插件挂在 `header.utilities` 的入口随之不可达；
 * 这里把同一个开关以 `position: fixed` 放到宿主「Open right sidebar」按钮的**左侧紧邻**
 * （按该按钮的 rect 对齐，随窗口 resize 与 500ms 周期重对齐）。
 *
 * **重对齐的周期表只在入口真的渲染时存在**（v0.25 的稳态开销治理）：正常会话里本组件
 * 返回 `null`，而 `measure()` 的让位走查要做命中测试——表挂在早退之前时，一个看不见的
 * 入口会一直烧着这些测量。窗口 resize 监听则是常驻的（见下面的两个 effect）。
 *
 * **相位不足以判定互斥**：相位是每 1s 轮询来的，而会话头的入口由宿主在它认为合适的
 * 时机渲染，两者之间必然有窗口；相位读取失败时还会按「非 blank」降级，一个从未成功
 * 读到的会话可能一直停在 blank。而两套入口在版面上是**同一个位置**——真同时在场就是
 * 精确重叠成一团。所以除了相位，再加一条与相位无关的兜底：**会话头那套入口只要真的
 * 在 DOM 里，备用入口就让位**（`data-dsh-bottom-toggle` 不在 `[data-dsh-dock-fallback]`
 * 内的那个）。
 */
import { type ReactNode } from 'react';
import type { SidebarStore } from '../state.ts';
export declare function DockFallback({ store }: {
    store: SidebarStore;
}): ReactNode;
