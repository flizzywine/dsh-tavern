import { tr } from '@/i18n';

export type ExtraModelApiProfile = {
    [key: string]: unknown;
    名称: string;
    api地址: string;
    密钥: string;
    模型名称: string;
};

export type ExtraModelApiProfileFields = {
    api地址: string;
    密钥: string;
    模型名称: string;
    api方案列表: ExtraModelApiProfile[];
    当前api方案: string;
};

export const DEFAULT_EXTRA_MODEL_API_PROFILE_NAME = '默认';

export function extractExtraModelApiProfileFields(
    config: ExtraModelApiProfileFields
): ExtraModelApiProfile {
    return {
        名称: config.当前api方案 || DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
        api地址: config.api地址,
        密钥: config.密钥,
        模型名称: config.模型名称,
    };
}

export function applyExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile: ExtraModelApiProfile
): ExtraModelApiProfileFields {
    return {
        ...config,
        api地址: profile.api地址,
        密钥: profile.密钥,
        模型名称: profile.模型名称,
        当前api方案: profile.名称,
    };
}

export function upsertExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile: ExtraModelApiProfile
): ExtraModelApiProfile[] {
    const normalized_name = profile.名称.trim();
    if (!normalized_name) {
        throw new Error(tr('runtime.apiProfile.nameRequired'));
    }

    const next_profile = {
        ...profile,
        名称: normalized_name,
    };
    const existing_index = profiles.findIndex(item => item.名称 === normalized_name);
    if (existing_index === -1) {
        return [...profiles, next_profile];
    }

    const next_profiles = [...profiles];
    next_profiles[existing_index] = {
        ...profiles[existing_index],
        ...next_profile,
    };
    return next_profiles;
}

export function removeExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile_name: string
): ExtraModelApiProfile[] {
    return profiles.filter(profile => profile.名称 !== profile_name);
}

export function hasExtraModelApiProfile(
    profiles: ExtraModelApiProfile[],
    profile_name: string
): boolean {
    return profiles.some(profile => profile.名称 === profile_name.trim());
}

export function isActiveExtraModelApiProfileDirty(config: ExtraModelApiProfileFields): boolean {
    const active_name = config.当前api方案.trim();
    if (!active_name) {
        return false;
    }

    const profile = config.api方案列表.find(item => item.名称 === active_name);
    if (!profile) {
        return false;
    }

    return (
        profile.api地址 !== config.api地址 ||
        profile.密钥 !== config.密钥 ||
        profile.模型名称 !== config.模型名称
    );
}

export function clearUnboundExtraModelApiProfileFields(
    config: ExtraModelApiProfileFields
): ExtraModelApiProfileFields {
    return {
        ...config,
        当前api方案: '',
        api地址: '',
        密钥: '',
        模型名称: '',
    };
}

export function reconcileExtraModelApiProfileSelection<T extends ExtraModelApiProfileFields>(
    config: T
): T {
    const active_name = config.当前api方案.trim();
    if (!active_name) {
        return config;
    }

    if (hasExtraModelApiProfile(config.api方案列表, active_name)) {
        return config;
    }

    if (config.api方案列表.length === 0) {
        return {
            ...config,
            当前api方案: '',
        };
    }

    return applyExtraModelApiProfile(
        {
            ...config,
            api方案列表: config.api方案列表,
        },
        config.api方案列表[0]
    ) as T;
}

export function deleteActiveExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name: string
): ExtraModelApiProfileFields {
    const remaining = removeExtraModelApiProfile(config.api方案列表, profile_name);
    if (remaining.length === 0) {
        return {
            ...config,
            api方案列表: [],
            当前api方案: '',
            api地址: '',
            密钥: '',
            模型名称: '',
        };
    }

    return applyExtraModelApiProfile(
        {
            ...config,
            api方案列表: remaining,
        },
        remaining[0]
    );
}

export type ExtraModelApiProfileDeletionConfirmation = 'discard_unsaved_changes' | 'delete_profile';

export async function deleteActiveExtraModelApiProfileWithConfirmation(
    config: ExtraModelApiProfileFields,
    profile_name: string,
    confirm: (confirmation: ExtraModelApiProfileDeletionConfirmation) => Promise<boolean>
): Promise<ExtraModelApiProfileFields | null> {
    if (isActiveExtraModelApiProfileDirty(config) && !(await confirm('discard_unsaved_changes'))) {
        return null;
    }

    if (!(await confirm('delete_profile'))) {
        return null;
    }

    return deleteActiveExtraModelApiProfile(config, profile_name);
}

export function migrateExtraModelApiProfiles<T extends ExtraModelApiProfileFields>(config: T): T {
    let migrated = config;

    if (migrated.api方案列表.length === 0) {
        const has_legacy_custom_api =
            migrated.api地址.trim().length > 0 ||
            migrated.密钥.trim().length > 0 ||
            migrated.模型名称.trim().length > 0;
        if (has_legacy_custom_api) {
            migrated = {
                ...migrated,
                api方案列表: [
                    {
                        名称: DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
                        api地址: migrated.api地址,
                        密钥: migrated.密钥,
                        模型名称: migrated.模型名称,
                    },
                ],
                当前api方案: migrated.当前api方案 || DEFAULT_EXTRA_MODEL_API_PROFILE_NAME,
            };
        }
    }

    return reconcileExtraModelApiProfileSelection(migrated);
}

export function selectExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name: string
): ExtraModelApiProfileFields {
    const profile = config.api方案列表.find(item => item.名称 === profile_name);
    if (!profile) {
        throw new Error(
            tr('runtime.apiProfile.notFound', {
                name: profile_name,
            })
        );
    }
    return applyExtraModelApiProfile(config, profile);
}

export function saveCurrentExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name?: string
): ExtraModelApiProfileFields {
    const target_name = (profile_name ?? config.当前api方案).trim();
    if (!target_name) {
        throw new Error(tr('runtime.apiProfile.selectOrEnterName'));
    }

    if (
        hasExtraModelApiProfile(config.api方案列表, target_name) &&
        config.当前api方案.trim() !== target_name
    ) {
        throw new Error(
            tr('runtime.apiProfile.alreadyExists', {
                name: target_name,
            })
        );
    }

    const source_profile = config.api方案列表.find(item => item.名称 === config.当前api方案.trim());
    const profile = {
        ...source_profile,
        ...extractExtraModelApiProfileFields(config),
        名称: target_name,
    };
    return {
        ...config,
        当前api方案: target_name,
        api方案列表: upsertExtraModelApiProfile(config.api方案列表, profile),
    };
}

export function saveAsNewExtraModelApiProfile(
    config: ExtraModelApiProfileFields,
    profile_name: string
): ExtraModelApiProfileFields {
    const target_name = profile_name.trim();
    if (!target_name) {
        throw new Error(tr('runtime.apiProfile.enterNewName'));
    }
    if (hasExtraModelApiProfile(config.api方案列表, target_name)) {
        throw new Error(
            tr('runtime.apiProfile.alreadyExists', {
                name: target_name,
            })
        );
    }
    return saveCurrentExtraModelApiProfile(config, target_name);
}
