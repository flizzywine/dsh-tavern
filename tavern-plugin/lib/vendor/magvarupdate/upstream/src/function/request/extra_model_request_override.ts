import type { ExtraModelRequestOverrides } from '@/function/update/extra_model_preset';

let current_request_overrides: ExtraModelRequestOverrides | null = null;

export function setExtraModelRequestOverrides(
    overrides: ExtraModelRequestOverrides | null | undefined
) {
    current_request_overrides =
        overrides && Object.keys(overrides).length > 0 ? { ...overrides } : null;
}

export function clearExtraModelRequestOverrides() {
    current_request_overrides = null;
}

export function applyExtraModelRequestOverrides(generate_data: Record<string, any>) {
    const overrides = current_request_overrides;
    if (!overrides) {
        return;
    }

    if (overrides.max_tokens !== undefined) {
        generate_data.max_tokens = overrides.max_tokens;
        generate_data.max_completion_tokens =
            overrides.max_completion_tokens ?? overrides.max_tokens;
    }

    const override_keys = [
        'temperature',
        'frequency_penalty',
        'presence_penalty',
        'repetition_penalty',
        'top_p',
        'min_p',
        'top_k',
        'top_a',
    ] as const;

    for (const key of override_keys) {
        if (overrides[key] !== undefined) {
            generate_data[key] = overrides[key];
        }
    }
}
