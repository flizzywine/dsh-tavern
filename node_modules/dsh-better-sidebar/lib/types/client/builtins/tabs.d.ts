import type { Context } from '../../context-types.ts';
import type { TabDescriptor } from '../service.ts';
/** The 6 built-in tab descriptors (the host owns the right-Sidebar terminal and browser). */
export declare function builtinTabs(ctx: Context): readonly TabDescriptor[];
