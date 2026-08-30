import {
    CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
    CharacterSettingsOverride,
    CharacterSettingsOverridePath,
    CharacterSettingsOverrideValue,
    isCharacterSettingsOverrideEntryName,
    normalizeCharacterSettingsOverride,
    parseCharacterSettingsOverrideContent,
    recoverCharacterSettingsOverridePassthrough,
    serializeCharacterSettingsOverride,
} from '@/function/character_override/schema';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { controlledStoppableEventOn } from '@/util';
import { klona } from 'klona';

type RawWorldbookEntry = SillyTavern.FlattenedWorldInfoEntry & Record<string, unknown>;

// 世界书事件提供的是 ST 原始格式；它只用于读取和冲突检测，保存统一走 Slash-runner 接口。
type RawWorldbookData = {
    entries: Record<string, RawWorldbookEntry>;
};

type SaveResult =
    | {
          status: 'saved';
          data: RawWorldbookData;
          entry_uid: number;
          content: string;
      }
    | {
          status: 'discarded';
          data: RawWorldbookData;
      };

const REGEX_SAVE_DEBOUNCE_MS = 350;

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getCharacterName(): string {
    try {
        return String(SillyTavern.getCharacterCardFields()?.name ?? '');
    } catch {
        return '';
    }
}

function getSortedRawEntries(data: RawWorldbookData): RawWorldbookEntry[] {
    return _(data.entries).values().sortBy('displayIndex').value();
}

// 配置条目必须关闭，避免其中的 JSON 被当作普通世界书内容注入提示词。
function getMatchingRawEntries(data: RawWorldbookData): RawWorldbookEntry[] {
    return getSortedRawEntries(data).filter(
        entry => entry.disable === true && isCharacterSettingsOverrideEntryName(entry.comment)
    );
}

async function loadRawWorldbook(worldbook_name: string): Promise<RawWorldbookData> {
    const loaded = (await SillyTavern.loadWorldInfo(worldbook_name)) as unknown;
    if (!_.isPlainObject(loaded) || !_.isPlainObject(_.get(loaded, 'entries'))) {
        throw new Error(
            tr('runtime.characterOverride.worldbookReadFailed', { worldbook: worldbook_name })
        );
    }
    return klona(loaded) as RawWorldbookData;
}

function getMatchingWorldbookEntries(worldbook: WorldbookEntry[]): WorldbookEntry[] {
    return worldbook.filter(
        entry => entry.enabled === false && isCharacterSettingsOverrideEntryName(entry.name)
    );
}

function getFreeUid(worldbook: WorldbookEntry[]): number {
    const used_uids = worldbook.map(entry => entry.uid);
    // 沿用 SillyTavern 新建世界书条目的编号方式，不复用中间因删除产生的空洞。
    return (_.max(used_uids) ?? -1) + 1;
}

function makeWorldbookConfigEntry(uid: number, content: string): WorldbookEntry {
    return {
        uid,
        name: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
        enabled: false,
        strategy: {
            type: 'selective',
            keys: [],
            keys_secondary: { logic: 'and_any', keys: [] },
            scan_depth: 'same_as_global',
        },
        position: {
            type: 'after_character_definition',
            role: 'system',
            depth: 4,
            order: 100,
        },
        content,
        probability: 100,
        recursion: {
            prevent_incoming: false,
            prevent_outgoing: false,
            delay_until: null,
        },
        effect: {
            sticky: null,
            cooldown: null,
            delay: null,
        },
    };
}

function findRawEntryRecord(
    data: RawWorldbookData,
    uid: number
): [string, RawWorldbookEntry] | undefined {
    return Object.entries(data.entries).find(([, entry]) => Number(entry.uid) === uid);
}

async function confirmConflict(worldbook_name: string): Promise<boolean> {
    const result = await SillyTavern.callGenericPopup(
        tr('runtime.characterOverride.conflictPrompt', {
            worldbook: _.escape(worldbook_name),
            entry: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
        }),
        SillyTavern.POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: tr('runtime.characterOverride.overwriteButton'),
            cancelButton: tr('runtime.characterOverride.loadLatestButton'),
        }
    );
    return result === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
}

// 每个聊天对应一个控制器，负责加载角色配置、同步界面状态并串行保存修改。
class CharacterSettingsOverrideController {
    private worldbook_name: string | null = null;
    private entry_uid: number | null = null;
    private expected_content: string | null = null;
    private draft: CharacterSettingsOverride = {};
    private is_valid = true;
    private revision = 0;
    private has_pending_save = false;
    private is_saving = false;
    private save_timer: ReturnType<typeof setTimeout> | undefined;
    private save_loop: Promise<void> | undefined;
    private stop_event: (() => void) | undefined;
    private stopped = false;
    private duplicate_warning_signature = '';
    private saving_revision: number | undefined;
    private worldbook_update_revision = 0;

    private isCurrent(): boolean {
        return active_controller === this;
    }

    private mirrorState(values: Partial<ReturnType<typeof useDataStore>['character_settings']>) {
        // 旧聊天的异步任务可能较晚结束，禁止它覆盖当前聊天的 Pinia 状态。
        if (this.isCurrent()) {
            Object.assign(useDataStore().character_settings, values);
        }
    }

    async init(): Promise<void> {
        const store = useDataStore();
        store.resetCharacterSettings();
        store.character_settings.character_name = getCharacterName();

        try {
            this.worldbook_name = getCharWorldbookNames('current').primary;
        } catch (error) {
            this.worldbook_name = null;
            console.error(tr('runtime.characterOverride.bindingReadFailedLog'), error);
        }

        if (!this.worldbook_name) {
            this.mirrorState({
                status: 'unbound',
                worldbook_name: null,
                is_valid: true,
                draft: {},
            });
            return;
        }

        this.mirrorState({
            status: 'loading',
            worldbook_name: this.worldbook_name,
        });

        // 先监听再读取，避免初始化期间发生的世界书更新被较旧的读取结果覆盖。
        this.stop_event = controlledStoppableEventOn(
            tavern_events.WORLDINFO_UPDATED,
            (name, data) => this.handleWorldinfoUpdated(name, data)
        );

        try {
            await this.reload();
        } catch (error) {
            const message = getErrorMessage(error);
            console.error(tr('runtime.characterOverride.readFailedLog'), error);
            toastr.error(
                tr('runtime.common.errorCause', { cause: _.escape(message) }),
                tr('runtime.characterOverride.readFailedTitle'),
                { timeOut: 5000 }
            );
            this.mirrorState({
                status: 'error',
                worldbook_name: this.worldbook_name,
                is_valid: false,
                draft: {},
            });
        }

        if (this.stopped || !this.isCurrent()) {
            return;
        }
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.stop_event?.();
        this.stop_event = undefined;
        if (this.save_timer !== undefined) {
            clearTimeout(this.save_timer);
            this.save_timer = undefined;
        }

        // 等待当前保存以及它因更新版本而衍生出的后续保存；失败时再额外尝试一次，
        // 尽量避免切换聊天恰好发生在临时保存错误后而丢失草稿。
        for (let attempt = 0; attempt < 2; attempt++) {
            this.startSaveLoop();
            await this.waitForSaveLoops();
            if (!this.has_pending_save) {
                return;
            }
        }

        console.error(
            tr('runtime.characterOverride.stopWithUnsavedChangesLog', {
                worldbook: this.worldbook_name ?? '',
            })
        );
    }

    private async reload() {
        if (!this.worldbook_name) {
            return;
        }
        const update_revision = this.worldbook_update_revision;
        const data = await loadRawWorldbook(this.worldbook_name);
        if (update_revision !== this.worldbook_update_revision || this.stopped) {
            return;
        }
        await this.applyWorldbookData(data);
    }

    private async handleWorldinfoUpdated(name: string, data: unknown) {
        // 本地存在草稿或正在保存时，以冲突检查流程为准，不直接用外部事件覆盖编辑内容。
        if (
            name !== this.worldbook_name ||
            this.stopped ||
            this.has_pending_save ||
            this.is_saving
        ) {
            return;
        }

        const update_revision = ++this.worldbook_update_revision;
        try {
            const worldbook_data =
                _.isPlainObject(data) && _.isPlainObject(_.get(data, 'entries'))
                    ? (klona(data) as RawWorldbookData)
                    : await loadRawWorldbook(name);
            if (
                update_revision !== this.worldbook_update_revision ||
                this.stopped ||
                this.has_pending_save ||
                this.is_saving
            ) {
                return;
            }
            await this.applyWorldbookData(worldbook_data);
        } catch (error) {
            if (
                update_revision !== this.worldbook_update_revision ||
                this.stopped ||
                this.has_pending_save ||
                this.is_saving
            ) {
                return;
            }
            this.is_valid = false;
            this.draft = {};
            this.revision++;
            this.mirrorState({
                status: 'error',
                draft: {},
                is_valid: false,
                revision: this.revision,
            });
            console.error(tr('runtime.characterOverride.reloadFailedLog'), error);
            toastr.error(
                tr('runtime.common.errorCause', {
                    cause: _.escape(getErrorMessage(error)),
                }),
                tr('runtime.characterOverride.reloadFailedTitle'),
                {
                    timeOut: 5000,
                }
            );
        }
    }

    private getMatchingEntries(data: RawWorldbookData): RawWorldbookEntry[] {
        const matches = getMatchingRawEntries(data);
        const signature = matches.length > 1 ? matches.map(entry => entry.uid).join(',') : '';
        if (signature !== '' && signature !== this.duplicate_warning_signature) {
            toastr.warning(
                tr('runtime.characterOverride.duplicateEntries', {
                    worldbook: _.escape(this.worldbook_name ?? ''),
                    count: matches.length,
                    entry: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
                }),
                tr('runtime.characterOverride.duplicateEntriesTitle'),
                { timeOut: 5000 }
            );
        }
        this.duplicate_warning_signature = signature;
        return matches;
    }

    private async applyWorldbookData(data: RawWorldbookData) {
        if (!_.isPlainObject(data.entries)) {
            throw new Error(
                tr('runtime.characterOverride.invalidWorldbookData', {
                    worldbook: this.worldbook_name ?? '',
                })
            );
        }

        const matches = this.getMatchingEntries(data);
        const entry = matches[0];

        this.entry_uid = entry ? Number(entry.uid) : null;
        this.expected_content = entry?.content ?? null;
        this.revision++;
        this.is_valid = true;
        this.draft = {};

        if (entry) {
            try {
                this.draft = parseCharacterSettingsOverrideContent(entry.content);
            } catch (error) {
                this.is_valid = false;
                try {
                    // 已知字段损坏时仍保留扩展字段，用户修正后保存不会误删第三方配置。
                    this.draft = recoverCharacterSettingsOverridePassthrough(entry.content);
                } catch {
                    this.draft = {};
                }
                console.error(
                    tr('runtime.characterOverride.invalidConfigurationLog', {
                        worldbook: this.worldbook_name ?? '',
                        entry: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
                    }),
                    error
                );
                toastr.error(
                    tr('runtime.characterOverride.invalidConfiguration', {
                        worldbook: _.escape(this.worldbook_name ?? ''),
                        cause: _.escape(getErrorMessage(error)),
                    }),
                    tr('runtime.characterOverride.invalidConfigurationTitle'),
                    { timeOut: 7000 }
                );
            }
        }

        this.mirrorState({
            status: 'ready',
            worldbook_name: this.worldbook_name,
            entry_uid: this.entry_uid,
            expected_content: this.expected_content,
            draft: klona(this.draft),
            is_valid: this.is_valid,
            revision: this.revision,
            has_pending_save: this.has_pending_save,
            is_saving: this.is_saving,
        });
    }

    patch(path: CharacterSettingsOverridePath, value: CharacterSettingsOverrideValue) {
        if (this.stopped || !this.worldbook_name || !this.isCurrent()) {
            return;
        }

        const next = klona(this.draft);
        const [root, child] = path.split('.') as [keyof CharacterSettingsOverride, string?];
        const should_delete =
            value === undefined ||
            (typeof value === 'string' &&
                (path.endsWith('白名单正则') || path.endsWith('黑名单正则')) &&
                value.trim() === '');

        if (!child) {
            if (should_delete) {
                delete next[root];
            } else {
                _.set(next, root, value);
            }
        } else {
            let parent = next[root];
            if (!_.isPlainObject(parent)) {
                parent = {};
                _.set(next, root, parent);
            }
            if (should_delete) {
                delete (parent as Record<string, unknown>)[child];
            } else {
                (parent as Record<string, unknown>)[child] = value;
            }
            if (Object.keys(parent as object).length === 0) {
                delete next[root];
            }
        }

        this.draft = normalizeCharacterSettingsOverride(next);
        this.is_valid = true;
        this.revision++;
        this.has_pending_save = true;
        this.mirrorState({
            draft: klona(this.draft),
            is_valid: true,
            revision: this.revision,
            has_pending_save: true,
        });

        if (path.endsWith('白名单正则') || path.endsWith('黑名单正则')) {
            // 正则输入框会连续触发更新，短暂防抖可避免每次击键都写入世界书。
            if (this.save_timer !== undefined) {
                clearTimeout(this.save_timer);
            }
            this.save_timer = setTimeout(() => {
                this.save_timer = undefined;
                this.startSaveLoop();
            }, REGEX_SAVE_DEBOUNCE_MS);
        } else {
            if (this.save_timer !== undefined) {
                clearTimeout(this.save_timer);
                this.save_timer = undefined;
            }
            this.startSaveLoop();
        }
    }

    async flush(): Promise<void> {
        if (this.save_timer !== undefined) {
            clearTimeout(this.save_timer);
            this.save_timer = undefined;
        }
        this.startSaveLoop();
        await this.waitForSaveLoops();
    }

    private async waitForSaveLoops(): Promise<void> {
        while (this.save_loop) {
            await this.save_loop;
        }
    }

    private startSaveLoop() {
        if (this.save_loop || !this.has_pending_save || !this.worldbook_name) {
            return;
        }
        let failed_revision: number | undefined;
        this.save_loop = this.runSaveLoop()
            .catch(error => {
                failed_revision = this.saving_revision;
                this.has_pending_save = true;
                this.mirrorState({ has_pending_save: true });
                console.error(tr('runtime.characterOverride.saveFailedLog'), error);
                toastr.error(
                    tr('runtime.common.errorCause', {
                        cause: _.escape(getErrorMessage(error)),
                    }),
                    tr('runtime.characterOverride.saveFailedTitle'),
                    {
                        timeOut: 7000,
                    }
                );
            })
            .finally(() => {
                this.is_saving = false;
                this.save_loop = undefined;
                this.mirrorState({ is_saving: false });
                if (
                    this.has_pending_save &&
                    this.save_timer === undefined &&
                    (failed_revision === undefined || this.revision > failed_revision)
                ) {
                    // 保存期间出现的新修订需要继续保存；同一修订失败则留待显式重试，避免死循环。
                    this.startSaveLoop();
                }
            });
    }

    private async runSaveLoop() {
        while (this.has_pending_save && this.worldbook_name && this.save_timer === undefined) {
            // 每轮固定保存一个草稿快照，新修改通过 revision 留给下一轮处理。
            this.has_pending_save = false;
            const revision = this.revision;
            this.saving_revision = revision;
            const draft = klona(this.draft);
            this.is_saving = true;
            this.mirrorState({
                has_pending_save: false,
                is_saving: true,
            });

            const result = await this.saveSnapshot(draft);
            this.is_saving = false;

            if (result.status === 'discarded') {
                this.has_pending_save = false;
                await this.applyWorldbookData(result.data);
                return;
            }

            this.entry_uid = result.entry_uid;
            this.expected_content = result.content;
            this.mirrorState({
                entry_uid: result.entry_uid,
                expected_content: result.content,
                is_saving: false,
            });

            if (this.revision === revision && !this.has_pending_save) {
                await this.applyWorldbookData(result.data);
            }
        }
    }

    private async saveSnapshot(draft: CharacterSettingsOverride): Promise<SaveResult> {
        const worldbook_name = this.worldbook_name!;
        const content = serializeCharacterSettingsOverride(draft);
        const data = await loadRawWorldbook(worldbook_name);
        const matches = this.getMatchingEntries(data);

        const expected_record =
            this.entry_uid === null ? undefined : findRawEntryRecord(data, this.entry_uid);
        const has_conflict =
            this.entry_uid === null
                ? matches.length > 0
                : expected_record === undefined ||
                  expected_record[1].content !== this.expected_content;

        // 以首次读取的 UID 和正文做乐观并发检查，避免静默覆盖其他编辑来源。
        if (has_conflict) {
            if (!(await confirmConflict(worldbook_name))) {
                return {
                    status: 'discarded',
                    data: await loadRawWorldbook(worldbook_name),
                };
            }
        }

        let entry_uid = -1;
        // Slash-runner 会重新读取最新世界书，并交由 ST 完成格式转换、保存事件及编辑器刷新。
        // 因此即使确认弹框期间其他条目发生变化，也只会定点修改配置条目，不会回滚整本数据。
        await updateWorldbookWith(
            worldbook_name,
            worldbook => {
                const current_matches = getMatchingWorldbookEntries(worldbook);
                const target_entry =
                    (this.entry_uid === null
                        ? undefined
                        : worldbook.find(entry => entry.uid === this.entry_uid)) ??
                    current_matches[0];

                if (target_entry) {
                    entry_uid = target_entry.uid;
                    Object.assign(target_entry, {
                        name: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
                        content,
                        enabled: false,
                    });
                } else {
                    entry_uid = getFreeUid(worldbook);
                    worldbook.push(makeWorldbookConfigEntry(entry_uid, content));
                }
                return worldbook;
            },
            { render: 'immediate' }
        );

        const saved_data = await loadRawWorldbook(worldbook_name);
        return {
            status: 'saved',
            data: saved_data,
            entry_uid,
            content,
        };
    }
}

let active_controller: CharacterSettingsOverrideController | undefined;

export async function initCharacterSettingsOverride(): Promise<() => Promise<void>> {
    const controller = new CharacterSettingsOverrideController();
    active_controller = controller;
    await controller.init();
    return async () => {
        if (active_controller === controller) {
            active_controller = undefined;
        }
        await controller.stop();
    };
}

export function setCharacterSettingsOverride(
    path: CharacterSettingsOverridePath,
    value: CharacterSettingsOverrideValue
) {
    active_controller?.patch(path, value);
}

export async function flushCharacterSettingsOverrideSave(): Promise<void> {
    await active_controller?.flush();
}
