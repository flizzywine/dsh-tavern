import { type SessionPhase } from './api.ts';
/**
 * 跟踪一个会话的 blank 相位。
 * @param sessionId - 当前会话（undefined 时不读取，返回 undefined）。
 * @returns 相位；尚未读到时为 undefined（调用方应视为非 blank，先不渲染备用入口）。
 */
export declare function useSessionPhase(sessionId: string | undefined): SessionPhase | undefined;
