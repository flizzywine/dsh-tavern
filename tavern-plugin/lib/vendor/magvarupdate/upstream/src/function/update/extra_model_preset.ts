import { tr } from '@/i18n';

type ExtraModelPresetSettings = {
    max_completion_tokens?: number;
    temperature?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    top_p?: number;
    min_p?: number;
    top_k?: number;
    top_a?: number;
};

type ExtraModelPresetPrompt = {
    id: string;
    enabled?: boolean;
    position?:
        | {
              type: 'relative';
              depth?: never;
              order?: never;
          }
        | { type: 'in_chat'; depth: number; order: number };
    role: 'system' | 'user' | 'assistant';
    content?: string;
};

type ExtraModelPreset = {
    settings?: ExtraModelPresetSettings;
    prompts?: ExtraModelPresetPrompt[];
};

type ExtraModelPresetGlobals = typeof globalThis & {
    getPresetNames?: () => string[];
    getPreset?: (preset_name: string) => ExtraModelPreset;
};

export type ExtraModelRequestOverrides = {
    max_tokens?: number;
    max_completion_tokens?: number;
    temperature?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    top_p?: number;
    min_p?: number;
    top_k?: number;
    top_a?: number;
};

type ExtraModelGenerateBuiltinPrompt =
    | 'world_info_before'
    | 'persona_description'
    | 'char_description'
    | 'char_personality'
    | 'scenario'
    | 'world_info_after'
    | 'dialogue_examples'
    | 'chat_history';

type ExtraModelGenerateRolePrompt = {
    role: 'system' | 'user' | 'assistant';
    content: string;
};

type GenerateRawOrderedPrompt = ExtraModelGenerateBuiltinPrompt | ExtraModelGenerateRolePrompt;

type GenerateInjectPrompt = {
    position: 'in_chat';
    depth: number;
    should_scan: boolean;
    role: 'system' | 'user' | 'assistant';
    content: string;
};

const preset_placeholder_to_builtin_prompt = {
    worldInfoBefore: 'world_info_before',
    personaDescription: 'persona_description',
    charDescription: 'char_description',
    charPersonality: 'char_personality',
    scenario: 'scenario',
    worldInfoAfter: 'world_info_after',
    dialogueExamples: 'dialogue_examples',
    chatHistory: 'chat_history',
} as const satisfies Record<string, string>;

function getPresetGlobals(): ExtraModelPresetGlobals {
    return globalThis as ExtraModelPresetGlobals;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function substitutePresetMacros(content: string): string {
    if (typeof substitudeMacros !== 'function') {
        return content;
    }
    return substitudeMacros(content);
}

function toPositiveInteger(value: unknown): number | undefined {
    if (!isFiniteNumber(value) || value <= 0) {
        return undefined;
    }
    const integer_value = Math.floor(value);
    return integer_value > 0 ? integer_value : undefined;
}

function toInChatPresetInject(prompt: ExtraModelPresetPrompt): GenerateInjectPrompt | null {
    if (prompt.position?.type !== 'in_chat' || !isNonEmptyString(prompt.content)) {
        return null;
    }

    const content = substitutePresetMacros(prompt.content);
    if (!isNonEmptyString(content)) {
        return null;
    }

    return {
        position: 'in_chat',
        depth: prompt.position.depth,
        should_scan: false,
        role: prompt.role,
        content,
    };
}

function toOrderedPrompt(prompt: ExtraModelPresetPrompt): GenerateRawOrderedPrompt | null {
    const builtin_prompt =
        preset_placeholder_to_builtin_prompt[
            prompt.id as keyof typeof preset_placeholder_to_builtin_prompt
        ];
    if (builtin_prompt) {
        return builtin_prompt;
    }
    if (!isNonEmptyString(prompt.content)) {
        return null;
    }
    const content = substitutePresetMacros(prompt.content);
    if (!isNonEmptyString(content)) {
        return null;
    }
    return {
        role: prompt.role,
        content,
    };
}

function getDefaultTaskInjects(task: string): GenerateInjectPrompt[] {
    return [
        {
            position: 'in_chat',
            depth: 0,
            should_scan: false,
            role: 'system',
            content: task,
        },
        {
            position: 'in_chat',
            depth: 2,
            should_scan: false,
            role: 'system',
            content: '<past_observe>',
        },
        {
            position: 'in_chat',
            depth: 1,
            should_scan: false,
            role: 'system',
            content: '</past_observe>',
        },
    ];
}

export function getAvailableExtraModelPresetNames(): string[] {
    const preset_names = getPresetGlobals().getPresetNames?.();
    if (!Array.isArray(preset_names)) {
        return [];
    }
    return preset_names.filter(name => isNonEmptyString(name) && name !== 'in_use');
}

export function getExtraModelPreset(preset_name: string): ExtraModelPreset {
    if (!isNonEmptyString(preset_name)) {
        throw new Error(tr('runtime.preset.notSelected'));
    }

    const getPreset = getPresetGlobals().getPreset;
    if (typeof getPreset !== 'function') {
        throw new Error(tr('runtime.preset.apiUnavailable'));
    }

    const preset = getPreset(preset_name);
    if (!preset || !Array.isArray(preset.prompts)) {
        throw new Error(
            tr('runtime.preset.readFailed', {
                name: preset_name,
            })
        );
    }

    return preset;
}

export function buildOtherPresetGenerateConfig(
    preset: ExtraModelPreset,
    task: string
): {
    ordered_prompts: GenerateRawOrderedPrompt[];
    injects: GenerateInjectPrompt[];
    request_overrides: ExtraModelRequestOverrides;
} {
    const ordered_prompts: GenerateRawOrderedPrompt[] = [];
    const in_chat_prompts = (preset.prompts ?? [])
        .map((prompt, index) => ({ prompt, index }))
        .filter(({ prompt }) => prompt.enabled !== false)
        .sort((lhs, rhs) => {
            const lhs_depth =
                lhs.prompt.position?.type === 'in_chat' ? lhs.prompt.position.depth : -1;
            const rhs_depth =
                rhs.prompt.position?.type === 'in_chat' ? rhs.prompt.position.depth : -1;
            if (lhs_depth !== rhs_depth) {
                return lhs_depth - rhs_depth;
            }
            const lhs_order =
                lhs.prompt.position?.type === 'in_chat' ? lhs.prompt.position.order : -1;
            const rhs_order =
                rhs.prompt.position?.type === 'in_chat' ? rhs.prompt.position.order : -1;
            if (lhs_order !== rhs_order) {
                return lhs_order - rhs_order;
            }
            return lhs.index - rhs.index;
        });

    const preset_in_chat_injects: GenerateInjectPrompt[] = [];

    for (const { prompt } of in_chat_prompts) {
        if (prompt.position?.type === 'in_chat') {
            const inject = toInChatPresetInject(prompt);
            if (inject !== null) {
                preset_in_chat_injects.push(inject);
            }
            continue;
        }

        const ordered_prompt = toOrderedPrompt(prompt);
        if (ordered_prompt !== null) {
            ordered_prompts.push(ordered_prompt);
        }
    }

    const injects: GenerateInjectPrompt[] = [
        ...getDefaultTaskInjects(task),
        ...preset_in_chat_injects,
    ];

    const settings = preset.settings ?? {};
    const max_completion_tokens = toPositiveInteger(settings.max_completion_tokens);

    return {
        ordered_prompts,
        injects,
        request_overrides: {
            ...(max_completion_tokens === undefined
                ? {}
                : {
                      max_tokens: max_completion_tokens,
                      max_completion_tokens,
                  }),
            ...(isFiniteNumber(settings.temperature) ? { temperature: settings.temperature } : {}),
            ...(isFiniteNumber(settings.frequency_penalty)
                ? { frequency_penalty: settings.frequency_penalty }
                : {}),
            ...(isFiniteNumber(settings.presence_penalty)
                ? { presence_penalty: settings.presence_penalty }
                : {}),
            ...(isFiniteNumber(settings.repetition_penalty)
                ? { repetition_penalty: settings.repetition_penalty }
                : {}),
            ...(isFiniteNumber(settings.top_p) ? { top_p: settings.top_p } : {}),
            ...(isFiniteNumber(settings.min_p) ? { min_p: settings.min_p } : {}),
            ...(isFiniteNumber(settings.top_k) ? { top_k: settings.top_k } : {}),
            ...(isFiniteNumber(settings.top_a) ? { top_a: settings.top_a } : {}),
        },
    };
}
