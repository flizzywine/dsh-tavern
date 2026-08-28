import { useIntervalFn } from '@vueuse/core';
import _ from 'lodash';
import { extractGalleryCardsFromContent, preloadGalleryCardImages, preloadGalleryImage, } from './gallery-cards';
import { ALL_KNOWN_REGIONS, inferLayerFromTrack } from '../region-utils';
import { DEFAULT_CHARACTER_LIB, Schema } from '../schema';
// ============================================================================
// 踏月寻仙 - 状态管理 (State Management)
// 使用 Pinia 管理 MVU 变量的响应式读取
// ============================================================================
export const useDataStore = defineStore('data', errorCatched(() => {
    const LAST_VALID_STAT_DATA_KEY = '__踏月寻仙_last_valid_stat_data';
    const LAST_VALID_STAT_DATA_MESSAGE_ID_KEY = '__踏月寻仙_last_valid_stat_data_message_id';
    const FALLBACK_TRANSIENT_RESET_FLOOR_GAP = 8;
    const POLL_INTERVAL_MS = 4000;
    const STORE_DEBUG_LOG = false;
    const VISUAL_CARDS_TAG_REGEX = /<visual_cards>\s*([\s\S]*?)\s*<\/visual_cards>/;
    const debugLog = (...args) => {
        if (!STORE_DEBUG_LOG)
            return;
        console.info(...args);
    };
    const hashString = (input) => {
        let hash = 5381;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
        }
        return (hash >>> 0).toString(36);
    };
    const getVisualCardsCacheKey = (sourceMessageId, content) => {
        const visualCardsContent = content.match(VISUAL_CARDS_TAG_REGEX)?.[1]?.trim() ?? content;
        return `${String(sourceMessageId)}_${visualCardsContent.length}_${hashString(visualCardsContent)}`;
    };
    const isBuiltinCompanionName = (name) => _.has(DEFAULT_CHARACTER_LIB, name);
    const createCharacterLibraryEntryFromCompanion = (name) => {
        const companion = rawData.value?.红颜?.[name];
        return {
            级: Number(companion?.等级 ?? 1) || 1,
            根: String(companion?.灵根 ?? '未知').trim() || '未知',
            质: String(companion?.体质 ?? '未知').trim() || '未知',
            龄: String(companion?.已活岁月 ? `已活${companion.已活岁月}年` : '未知').trim() || '未知',
            属: '自定义角色',
            法: String(companion?.功法 ?? '无').trim() || '无',
            器: String(companion?.本命兵器 ?? '无').trim() || '无',
            通: Object.keys(companion?.神通列表 ?? {}),
            自定义立绘: {
                正面: '',
                背面: '',
            },
        };
    };
    const getCustomPortraitOverrides = () => {
        const companionLib = rawData.value?.红颜角色库 ?? {};
        const overrides = {};
        Object.entries(companionLib).forEach(([name, entry]) => {
            if (isBuiltinCompanionName(name))
                return;
            const front = String(entry?.自定义立绘?.正面 ?? '').trim();
            const back = String(entry?.自定义立绘?.背面 ?? '').trim();
            if (!front && !back)
                return;
            overrides[name] = {
                ...(front ? { front } : {}),
                ...(back ? { back } : {}),
            };
        });
        return overrides;
    };
    // 每个楼层的前端界面读取自己楼层的变量，互不干扰
    // 新楼层会有自己的 iframe 实例，通过 getCurrentMessageId() 获取自己的楼层号
    const message_id = getCurrentMessageId();
    const currentMessageIdNumber = typeof message_id === 'number' ? message_id : Number.NaN;
    const getChatMessagesSafe = (target = message_id) => {
        try {
            const messages = getChatMessages(target);
            return Array.isArray(messages) ? messages : [];
        }
        catch {
            return [];
        }
    };
    const getMessageContentById = (targetMessageId) => {
        const messages = getChatMessagesSafe(targetMessageId);
        return String(messages?.[0]?.message || '');
    };
    const getMessageVariablesSafe = (targetMessageId = message_id) => {
        try {
            if (typeof Mvu !== 'undefined' && typeof Mvu.getMvuData === 'function') {
                const mvuVariables = Mvu.getMvuData({ type: 'message', message_id: targetMessageId });
                if (mvuVariables && typeof mvuVariables === 'object') {
                    return mvuVariables;
                }
            }
        }
        catch {
            // 回退到 getVariables
        }
        try {
            return getVariables({ type: 'message', message_id: targetMessageId });
        }
        catch {
            return {};
        }
    };
    // 从 MVU 变量中获取 stat_data
    const rawData = ref(null);
    const lastValidData = ref(null);
    const defaultProtagonistState = Schema.parse({}).本尊;
    const clearResolvedTribulationPresentation = (tribulationState) => {
        let changed = false;
        const defaultTribulationState = defaultProtagonistState.渡劫状态;
        const transientKeys = ['劫种', '劫难等级', '当前阶段', '总阶段数', '劫难描述', '触发原因'];
        const syncTransientField = (key) => {
            if (!_.isEqual(tribulationState[key], defaultTribulationState[key])) {
                tribulationState[key] = _.cloneDeep(defaultTribulationState[key]);
                changed = true;
            }
        };
        transientKeys.forEach(key => {
            syncTransientField(key);
        });
        return changed;
    };
    const getLastValidMessageId = () => {
        try {
            const chatVariables = getVariables({ type: 'chat' });
            const value = _.get(chatVariables, LAST_VALID_STAT_DATA_MESSAGE_ID_KEY, null);
            return typeof value === 'number' && Number.isFinite(value) ? value : null;
        }
        catch {
            return null;
        }
    };
    const getSnapshotFloorGap = () => {
        if (!Number.isFinite(currentMessageIdNumber))
            return null;
        const lastValidMessageId = getLastValidMessageId();
        if (lastValidMessageId === null)
            return null;
        return Math.max(0, currentMessageIdNumber - lastValidMessageId);
    };
    const resetTransientCombatAndTribulationState = (data) => {
        const next = _.cloneDeep(data);
        next.本尊.战斗状态 = _.cloneDeep(defaultProtagonistState.战斗状态);
        next.本尊.当前敌人 = {};
        next.本尊.渡劫状态 = _.cloneDeep(defaultProtagonistState.渡劫状态);
        return next;
    };
    const getCurrentMessageContent = () => {
        try {
            return getMessageContentById(message_id);
        }
        catch {
            return '';
        }
    };
    // 叙事兜底纠偏：当 AI 漏写关键 patch 时，按文本强语义纠正战斗/渡劫临时状态
    const reconcileTransientStateFromNarrative = (data, content) => {
        if (!content)
            return data;
        const text = content.replace(/\s+/g, '');
        let changed = false;
        const next = _.cloneDeep(data);
        const hasAny = (...patterns) => patterns.some(pattern => pattern.test(text));
        const battleEnded = hasAny(/战斗(结束|已毕|落幕|平息)/, /脱战/, /罢斗/, /停手/, /收剑/);
        const tribulationEnded = hasAny(/渡劫(结束|已过|已毕|落幕|完成|终了)/, /劫云(散去|退去|消散)/, /渡劫(成功|失败)/);
        const tribulationSuccess = /渡劫成功/.test(text);
        const tribulationFailed = /渡劫失败/.test(text);
        if (battleEnded) {
            if (next.本尊.战斗状态.正在战斗) {
                next.本尊.战斗状态.正在战斗 = false;
                changed = true;
            }
            if (next.本尊.战斗状态.阶段 !== '余波') {
                next.本尊.战斗状态.阶段 = '余波';
                changed = true;
            }
            if (Object.keys(next.本尊.当前敌人 ?? {}).length > 0) {
                next.本尊.当前敌人 = {};
                changed = true;
            }
        }
        if (tribulationEnded) {
            if (next.本尊.渡劫状态.正在渡劫) {
                next.本尊.渡劫状态.正在渡劫 = false;
                changed = true;
            }
            if (tribulationSuccess && next.本尊.渡劫状态.上次渡劫结果 !== '成功') {
                next.本尊.渡劫状态.上次渡劫结果 = '成功';
                changed = true;
            }
            if (tribulationFailed && next.本尊.渡劫状态.上次渡劫结果 !== '失败') {
                next.本尊.渡劫状态.上次渡劫结果 = '失败';
                changed = true;
            }
            if (clearResolvedTribulationPresentation(next.本尊.渡劫状态)) {
                changed = true;
            }
        }
        return changed ? next : data;
    };
    // 行踪一致性修复：AI 偶发仅更新当前区域，遗漏所属层级时，使用地点库/世界地图/上一帧兜底。
    const normalizeTrackConsistency = (data, previous) => {
        const currentRegionRaw = String(data?.本尊?.行踪?.当前区域 || '').trim();
        const layerRaw = String(data?.本尊?.行踪?.所属层级 || '').trim();
        const environmentDesc = String(data?.本尊?.行踪?.环境描述 || '').trim();
        const prevLayer = String(previous?.本尊?.行踪?.所属层级 || '').trim();
        const inferredLayer = inferLayerFromTrack(currentRegionRaw, layerRaw, environmentDesc, data?.地点库, data?.世界地图, prevLayer);
        let changed = false;
        const next = _.cloneDeep(data);
        if (inferredLayer && inferredLayer !== layerRaw) {
            next.本尊.行踪.所属层级 = inferredLayer;
            changed = true;
        }
        // 如果当前区域被 AI 退化成“地层/神州/北冥”等粗粒度词，优先沿用上一帧具体地点，避免 UI 闪回粗粒度。
        const isCoarseCurrent = ALL_KNOWN_REGIONS.includes(currentRegionRaw);
        const prevRegion = String(previous?.本尊?.行踪?.当前区域 || '').trim();
        if (isCoarseCurrent && prevRegion && !ALL_KNOWN_REGIONS.includes(prevRegion)) {
            next.本尊.行踪.当前区域 = prevRegion;
            changed = true;
        }
        return changed ? next : data;
    };
    // 图鉴卡片数据
    const galleryCards = ref([]);
    // 防止同一条消息被手动重复解析，导致增量指令被二次执行
    let isManualParseRunning = false;
    const manualParsedContentKeys = new Set();
    // 卡片缓存 - 避免重复解析
    const cardCache = new Map();
    const galleryImageChangeTokens = new Map();
    // 将可用数据保存为“最后一次有效快照”（聊天级），用于手动解析/楼层被隐藏时兜底
    const saveLastValidSnapshot = (data, sourceMessageId) => {
        const snapshot = _.cloneDeep(data);
        lastValidData.value = snapshot;
        try {
            const chatVariables = getVariables({ type: 'chat' });
            _.set(chatVariables, LAST_VALID_STAT_DATA_KEY, _.cloneDeep(snapshot));
            if (typeof sourceMessageId === 'number' && Number.isFinite(sourceMessageId)) {
                _.set(chatVariables, LAST_VALID_STAT_DATA_MESSAGE_ID_KEY, sourceMessageId);
            }
            replaceVariables(chatVariables, { type: 'chat' });
        }
        catch (e) {
            console.warn('[踏月寻仙] 保存最后有效快照失败', e);
        }
    };
    // 从聊天变量读取“最后一次有效快照”
    const loadLastValidSnapshot = () => {
        if (lastValidData.value) {
            return _.cloneDeep(lastValidData.value);
        }
        try {
            const chatVariables = getVariables({ type: 'chat' });
            const snapshot = _.get(chatVariables, LAST_VALID_STAT_DATA_KEY, null);
            if (!snapshot || typeof snapshot !== 'object') {
                return null;
            }
            const parsed = _.cloneDeep(Schema.parse(snapshot));
            lastValidData.value = parsed;
            return _.cloneDeep(parsed);
        }
        catch (e) {
            console.warn('[踏月寻仙] 读取最后有效快照失败', e);
            return null;
        }
    };
    let isCanonicalStatDataSyncing = false;
    const parseCanonicalStatData = (statData) => {
        try {
            return _.cloneDeep(Schema.parse(statData));
        }
        catch (e) {
            console.warn('[踏月寻仙] stat_data 规范化解析失败', e);
            return null;
        }
    };
    const syncCanonicalStatDataToCurrentFloor = async (sourceStatData, canonicalData) => {
        if (isCanonicalStatDataSyncing)
            return;
        try {
            isCanonicalStatDataSyncing = true;
            const sourceSnapshot = _.cloneDeep(sourceStatData);
            await waitGlobalInitialized('Mvu');
            const currentVariables = Mvu.getMvuData({ type: 'message', message_id });
            const currentStatData = _.get(currentVariables, 'stat_data', null);
            if (!_.isEqual(currentStatData, sourceSnapshot)) {
                debugLog('[踏月寻仙] 当前楼层变量已变化，跳过过期的规范化写回');
                return;
            }
            if (_.isEqual(currentStatData, canonicalData)) {
                return;
            }
            _.set(currentVariables, 'stat_data', _.cloneDeep(canonicalData));
            await Mvu.replaceMvuData(currentVariables, { type: 'message', message_id });
            debugLog('[踏月寻仙] 已自动将旧版修炼变量升级并写回当前楼层');
        }
        catch (e) {
            console.warn('[踏月寻仙] 自动写回规范化 stat_data 失败', e);
        }
        finally {
            isCanonicalStatDataSyncing = false;
        }
    };
    // 安全解析 stat_data：解析失败返回 null，不触发“回初始值”
    const tryParseStatData = (statData, messageContent = '') => {
        try {
            const previousData = rawData.value ?? lastValidData.value ?? loadLastValidSnapshot();
            const canonical = parseCanonicalStatData(statData);
            if (!canonical) {
                return null;
            }
            const parsed = normalizeTrackConsistency(canonical, previousData);
            return _.cloneDeep(reconcileTransientStateFromNarrative(parsed, messageContent));
        }
        catch (e) {
            console.warn('[踏月寻仙] stat_data 解析失败，保持现有/快照数据', e);
            return null;
        }
    };
    // 初始化数据（带重试机制）
    const initData = (retryCount = 0) => {
        try {
            const variables = getMessageVariablesSafe(message_id);
            const statData = _.get(variables, 'stat_data', null);
            const hasStatData = !!statData && typeof statData === 'object' && Object.keys(statData).length > 0;
            const messageContent = getCurrentMessageContent();
            if (hasStatData) {
                const parsed = tryParseStatData(statData, messageContent);
                if (parsed) {
                    rawData.value = parsed;
                    saveLastValidSnapshot(parsed, currentMessageIdNumber);
                }
                const canonical = parseCanonicalStatData(statData);
                if (canonical && !_.isEqual(statData, canonical)) {
                    void syncCanonicalStatDataToCurrentFloor(statData, canonical);
                }
            }
            // 解析失败或压根没有 stat_data 时，不回初始值，优先沿用稳定快照
            if (!rawData.value) {
                const stableData = loadLastValidSnapshot() ?? tryInheritFromPreviousFloor();
                if (stableData) {
                    const floorGap = getSnapshotFloorGap();
                    if (floorGap !== null && floorGap >= FALLBACK_TRANSIENT_RESET_FLOOR_GAP) {
                        rawData.value = resetTransientCombatAndTribulationState(stableData);
                        console.warn(`[踏月寻仙] 当前楼层缺少有效变量且快照已跨 ${floorGap} 楼，已自动清理战斗/渡劫临时状态防止卡死`);
                    }
                    else {
                        rawData.value = stableData;
                        debugLog('[踏月寻仙] 当前楼层变量缺失/异常，已使用稳定快照显示');
                    }
                }
            }
            // 当前没有可用数据时，继续重试；重试耗尽后执行手动解析
            if (!rawData.value) {
                if (retryCount < 5) {
                    debugLog(`[踏月寻仙] 当前楼层暂无可用变量，200ms后第${retryCount + 1}次重试`);
                    setTimeout(() => {
                        initData(retryCount + 1);
                    }, 200);
                    return;
                }
                console.warn('[踏月寻仙] 当前楼层暂无可用变量，重试耗尽后尝试手动解析');
                tryManualParseMvuMessage();
                return;
            }
            debugLog('[踏月寻仙] 成功加载变量数据', {
                等级: rawData.value?.本尊.等级,
                灵根: rawData.value?.本尊.灵根,
                体质: rawData.value?.本尊.体质,
                功法: rawData.value?.本尊.功法,
                任务列表数量: Object.keys(rawData.value?.任务列表 ?? {}).length,
                任务列表: rawData.value?.任务列表,
            });
            // 解析当前楼层消息中的 visual_cards
            parseCurrentMessageCards();
        }
        catch (e) {
            // Schema.parse 失败或其他错误
            console.error('[踏月寻仙] 初始化数据失败', e);
            if (retryCount < 5) {
                // 数据还没准备好，重试（减少重试次数到5次，固定延迟200ms，总计最多等待1秒）
                debugLog(`[踏月寻仙] 数据未就绪，200ms后第${retryCount + 1}次重试`);
                setTimeout(() => {
                    initData(retryCount + 1);
                }, 200); // 固定延迟200ms
            }
            else {
                console.warn('[踏月寻仙] 重试次数已用完，尝试手动触发MVU解析');
                // 尝试手动触发MVU解析当前消息
                tryManualParseMvuMessage();
            }
        }
    };
    // 手动触发MVU解析当前消息（用于初始楼层）
    const tryManualParseMvuMessage = async () => {
        if (isManualParseRunning) {
            debugLog('[踏月寻仙] 手动解析已在进行中，跳过重复触发');
            return;
        }
        try {
            isManualParseRunning = true;
            // 检查MVU是否已初始化
            await waitGlobalInitialized('Mvu');
            // 获取当前楼层的消息内容
            const messages = getChatMessages(message_id);
            if (messages.length === 0) {
                console.warn('[踏月寻仙] 无法获取当前消息内容');
                fallbackToInheritOrDefault();
                return;
            }
            const content = messages[0].message || '';
            debugLog('[踏月寻仙] 尝试手动触发MVU解析，消息长度:', content.length);
            // 获取当前的MVU数据（可能为空）
            const currentMvuData = _.cloneDeep(Mvu.getMvuData({ type: 'message', message_id }) ?? {});
            // 如果当前楼层缺 stat_data，则把稳定快照作为解析基底，避免“无更新即回初始值”
            const currentStatData = _.get(currentMvuData, 'stat_data', null);
            const currentHasStatData = !!currentStatData && typeof currentStatData === 'object' && Object.keys(currentStatData).length > 0;
            // 当前楼层已经有变量时，不再手动重跑 parseMessage，避免重复执行增量命令（如修为+N）
            if (currentHasStatData) {
                const parsed = tryParseStatData(currentStatData, content);
                if (parsed) {
                    rawData.value = parsed;
                    saveLastValidSnapshot(parsed, currentMessageIdNumber);
                    parseCurrentMessageCards();
                }
                else {
                    fallbackToInheritOrDefault();
                }
                return;
            }
            const manualParseKey = `${String(message_id)}::${content.length}::${content.slice(0, 200)}`;
            if (manualParsedContentKeys.has(manualParseKey)) {
                console.warn('[踏月寻仙] 检测到同一消息重复手动解析，已跳过以避免变量叠加');
                return;
            }
            manualParsedContentKeys.add(manualParseKey);
            if (!currentHasStatData) {
                const stableData = rawData.value ?? loadLastValidSnapshot() ?? tryInheritFromPreviousFloor();
                if (stableData) {
                    _.set(currentMvuData, 'stat_data', _.cloneDeep(stableData));
                    debugLog('[踏月寻仙] 手动解析使用稳定快照作为基底');
                }
            }
            // 手动解析消息中的MVU指令
            const newMvuData = await Mvu.parseMessage(content, currentMvuData);
            // 将解析结果写回当前楼层
            await Mvu.replaceMvuData(newMvuData, { type: 'message', message_id });
            debugLog('[踏月寻仙] MVU手动解析完成，重新加载数据');
            // 延迟后重新加载数据
            setTimeout(() => {
                const variables = getMessageVariablesSafe(message_id);
                const statData = _.get(variables, 'stat_data', null);
                const messageContent = getCurrentMessageContent();
                if (statData && Object.keys(statData).length > 0) {
                    const parsed = tryParseStatData(statData, messageContent);
                    if (parsed) {
                        rawData.value = parsed;
                        saveLastValidSnapshot(parsed, currentMessageIdNumber);
                        debugLog('[踏月寻仙] ✅ 手动解析后成功加载数据');
                    }
                    // toastr.success('已成功初始化状态数据', '踏月寻仙'); // 用户反馈太烦了
                    parseCurrentMessageCards();
                }
                else {
                    console.warn('[踏月寻仙] 手动解析后仍无数据，使用备用方案');
                    fallbackToInheritOrDefault();
                }
            }, 500);
        }
        catch (e) {
            console.error('[踏月寻仙] 手动触发MVU解析失败', e);
            fallbackToInheritOrDefault();
        }
        finally {
            isManualParseRunning = false;
        }
    };
    // 备用方案：继承或使用默认值（仅用于显示，不保存）
    const fallbackToInheritOrDefault = () => {
        console.warn('[踏月寻仙] 启用备用方案');
        // 优先使用最后有效快照，其次尝试从上一楼层继承
        const inheritedData = loadLastValidSnapshot() ?? tryInheritFromPreviousFloor();
        if (inheritedData) {
            // 成功继承数据，仅用于显示，不保存到当前楼层
            const floorGap = getSnapshotFloorGap();
            if (floorGap !== null && floorGap >= FALLBACK_TRANSIENT_RESET_FLOOR_GAP) {
                rawData.value = resetTransientCombatAndTribulationState(inheritedData);
                console.warn(`[踏月寻仙] 备用方案跨楼层快照过旧（${floorGap} 楼），已自动清理战斗/渡劫临时状态`);
            }
            else {
                rawData.value = inheritedData;
                debugLog('[踏月寻仙] 使用稳定快照/上一楼层数据用于显示（不保存）');
            }
        }
        else {
            // 无法继承，使用默认值
            console.warn('[踏月寻仙] 无法继承数据，使用默认值');
            rawData.value = Schema.parse({});
        }
        // 解析当前楼层消息中的 visual_cards
        parseCurrentMessageCards();
    };
    // 尝试从上一楼层继承数据
    const tryInheritFromPreviousFloor = () => {
        try {
            // 从当前楼层往前查找最近的有效数据
            // 获取所有聊天消息（从第0楼到最后一楼）
            const chatMessages = getChatMessages('0-{{lastMessageId}}');
            const currentIndex = chatMessages.findIndex(msg => msg.message_id === message_id);
            if (currentIndex === -1) {
                console.warn('[踏月寻仙] 无法找到当前楼层索引');
                return null;
            }
            // 从当前楼层往前遍历，查找最近的有效 stat_data
            for (let i = currentIndex - 1; i >= 0; i--) {
                const prevMessageId = chatMessages[i].message_id;
                const prevVariables = getMessageVariablesSafe(prevMessageId);
                const prevStatData = _.get(prevVariables, 'stat_data', null);
                if (prevStatData && Object.keys(prevStatData).length > 0) {
                    // 找到有效数据，解析并返回
                    const parsedData = tryParseStatData(prevStatData);
                    if (parsedData) {
                        saveLastValidSnapshot(parsedData, prevMessageId);
                        debugLog(`[踏月寻仙] 从第 ${prevMessageId} 楼继承数据`, {
                            任务列表keys: Object.keys(parsedData.任务列表 || {}),
                        });
                        return parsedData;
                    }
                }
            }
            console.warn('[踏月寻仙] 前面的楼层都没有有效数据');
            return null;
        }
        catch (e) {
            console.error('[踏月寻仙] 继承数据时出错', e);
            return null;
        }
    };
    // 解析当前楼层消息中的 visual_cards
    const parseCurrentMessageCards = (targetMessageId = message_id) => {
        try {
            const content = getMessageContentById(targetMessageId);
            if (content) {
                // 检查缓存
                const cacheKey = getVisualCardsCacheKey(targetMessageId, content);
                if (cardCache.has(cacheKey)) {
                    galleryCards.value = cardCache.get(cacheKey);
                    debugLog('[图鉴] 使用缓存的角色卡片');
                    return;
                }
                const cards = extractGalleryCardsFromContent(content, getCustomPortraitOverrides());
                if (cards.length > 0) {
                    galleryCards.value = cards;
                    // 缓存结果
                    cardCache.set(cacheKey, cards);
                    // 预加载图片
                    preloadGalleryCardImages(cards);
                    debugLog('[图鉴] 解析到角色卡片', cards.length, '张');
                }
                else {
                    galleryCards.value = [];
                }
            }
            else {
                galleryCards.value = [];
            }
        }
        catch (e) {
            console.error('[图鉴] 解析消息卡片失败', e);
            toastr.warning(`解析角色卡片失败: ${e instanceof Error ? e.message : '未知错误'}`, '图鉴');
        }
    };
    // 翻转卡片
    const toggleCardFlip = (index) => {
        if (galleryCards.value[index]) {
            galleryCards.value[index].isFlipped = !galleryCards.value[index].isFlipped;
        }
    };
    const changeGalleryCardImage = async (index, direction) => {
        const card = galleryCards.value[index];
        if (!card)
            return;
        const side = card.isFlipped ? 'back' : 'front';
        const candidates = side === 'front' ? card.frontCandidates : card.backCandidates;
        if (candidates.length <= 1)
            return;
        const currentImage = side === 'front' ? card.front : card.back;
        const currentIndex = Math.max(0, candidates.indexOf(currentImage));
        const nextIndex = direction === 'random'
            ? (currentIndex + 1 + Math.floor(Math.random() * (candidates.length - 1))) % candidates.length
            : (currentIndex + direction + candidates.length) % candidates.length;
        const nextImage = candidates[nextIndex];
        const requestKey = `${index}:${side}`;
        const requestToken = (galleryImageChangeTokens.get(requestKey) ?? 0) + 1;
        galleryImageChangeTokens.set(requestKey, requestToken);
        await preloadGalleryImage(nextImage);
        if (galleryImageChangeTokens.get(requestKey) !== requestToken || galleryCards.value[index] !== card)
            return;
        if (side === 'front') {
            card.front = nextImage;
        }
        else {
            card.back = nextImage;
        }
        const preloadIndexes = [
            (nextIndex - 1 + candidates.length) % candidates.length,
            (nextIndex + 1) % candidates.length,
        ];
        preloadIndexes.forEach(candidateIndex => {
            void preloadGalleryImage(candidates[candidateIndex]);
        });
    };
    // 等待MVU框架初始化后再加载数据
    waitGlobalInitialized('Mvu')
        .then(() => {
        debugLog('[踏月寻仙] MVU 框架已初始化，开始加载数据');
        // 立即开始初始化，不再额外延迟
        initData();
    })
        .catch(() => {
        console.warn('[踏月寻仙] MVU 框架未加载，直接初始化');
        initData();
    });
    // 防抖定时器 - 避免短时间内重复加载
    let updateDebounceTimer = null;
    const debouncedInitData = (delay = 200) => {
        if (updateDebounceTimer) {
            clearTimeout(updateDebounceTimer);
        }
        updateDebounceTimer = setTimeout(() => {
            initData();
            updateDebounceTimer = null;
        }, delay);
    };
    // 监听消息更新事件，实时刷新数据
    // 监听本楼层的消息更新事件
    eventOn(tavern_events.MESSAGE_UPDATED, (id) => {
        if (id === message_id) {
            debugLog('[踏月寻仙] 检测到本楼层消息更新，防抖延迟200ms后重新加载');
            debouncedInitData(200);
        }
    });
    // 监听本楼层的消息删除事件（重新roll时会触发）
    eventOn(tavern_events.MESSAGE_DELETED, (id) => {
        if (id === message_id) {
            debugLog('[踏月寻仙] 检测到本楼层消息删除（可能是重新roll），清空数据');
            rawData.value = null;
            galleryCards.value = [];
        }
    });
    // 监听本楼层的消息接收事件
    eventOn(tavern_events.MESSAGE_RECEIVED, (id) => {
        if (id === message_id) {
            debugLog('[踏月寻仙] 检测到本楼层消息接收，防抖延迟300ms后重新加载');
            debouncedInitData(300);
        }
    });
    // 监听 MVU 变量更新事件
    // 🔧 修复：VARIABLE_UPDATE_ENDED 只有 2 个参数 (new_variables, old_variables)，
    // 没有第 3 个 variable_option 参数来判断是哪个楼层更新了。
    // 因此改为：事件触发时重新读取当前楼层的变量，比较是否有变化。
    waitGlobalInitialized('Mvu')
        .then(() => {
        debugLog('[踏月寻仙] 开始监听 MVU 变量更新事件');
        eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => {
            try {
                // 重新读取当前楼层的变量（而非使用事件参数，因为事件参数不带楼层信息）
                const variables = getMessageVariablesSafe(message_id);
                const statData = _.get(variables, 'stat_data', null);
                const messageContent = getCurrentMessageContent();
                if (statData && Object.keys(statData).length > 0) {
                    try {
                        const parsedData = tryParseStatData(statData, messageContent);
                        // 只在数据实际变化时才更新，避免无意义的重渲染
                        if (parsedData && !_.isEqual(rawData.value, parsedData)) {
                            debugLog('[踏月寻仙] MVU 变量更新 → 当前楼层数据已变化，更新显示');
                            rawData.value = _.cloneDeep(parsedData);
                            saveLastValidSnapshot(parsedData, currentMessageIdNumber);
                        }
                    }
                    catch (parseError) {
                        console.error('[踏月寻仙] Schema 解析失败', parseError);
                    }
                }
                parseCurrentMessageCards();
            }
            catch (e) {
                console.error('[踏月寻仙] 处理 MVU 变量更新失败', e);
            }
        });
    })
        .catch(e => {
        console.warn('[踏月寻仙] MVU 框架未加载，将仅显示静态数据', e);
    });
    // 🔧 新增：轮询检查数据变化（作为事件监听的兜底机制）
    // 与 defineMvuDataStore 保持一致，每 2 秒检查一次变量是否已更新
    // 解决 MVU 解析完成时机晚于初始加载、事件丢失等极端情况
    useIntervalFn(() => {
        try {
            const variables = getMessageVariablesSafe(message_id);
            const statData = _.get(variables, 'stat_data', null);
            const messageContent = getCurrentMessageContent();
            if (statData && Object.keys(statData).length > 0) {
                const parsedData = tryParseStatData(statData, messageContent);
                if (parsedData && !_.isEqual(rawData.value, parsedData)) {
                    debugLog('[踏月寻仙] 轮询检测到当前楼层数据变化，更新显示');
                    rawData.value = _.cloneDeep(parsedData);
                    saveLastValidSnapshot(parsedData, currentMessageIdNumber);
                }
            }
            parseCurrentMessageCards();
        }
        catch {
            // 静默忽略轮询错误
        }
    }, POLL_INTERVAL_MS);
    // 计算属性：安全获取各部分数据
    const 世界时钟 = computed(() => rawData.value?.世界时钟 ?? {
        纪元: '末法时代',
        年份: 1,
        月份: 1,
        日期: 1,
        时辰: '子时',
    });
    const 世界地图 = computed(() => rawData.value?.世界地图 ?? {});
    const 世界图志 = computed(() => rawData.value?.世界图志 ?? {});
    const 本尊 = computed(() => rawData.value?.本尊 ?? Schema.parse({}).本尊);
    const 红颜 = computed(() => {
        const companions = rawData.value?.红颜 ?? {};
        const companionLib = rawData.value?.红颜角色库 ?? {};
        const allowedNames = Object.keys(companionLib).length > 0
            ? new Set(Object.keys(companionLib))
            : new Set(Object.keys(DEFAULT_CHARACTER_LIB));
        return Object.fromEntries(Object.entries(companions).filter(([name]) => allowedNames.has(name)));
    });
    const 红颜角色库 = computed(() => rawData.value?.红颜角色库 ?? DEFAULT_CHARACTER_LIB);
    const NPC图鉴 = computed(() => rawData.value?.NPC图鉴 ?? {});
    const 任务列表 = computed(() => rawData.value?.任务列表 ?? {});
    const 声望系统 = computed(() => rawData.value?.声望系统 ?? {});
    const 地点库 = computed(() => rawData.value?.地点库 ?? {});
    // 行动提示系统
    const 可参与机遇 = computed(() => rawData.value?.$可参与机遇 ?? []);
    const 当前处境 = computed(() => rawData.value?.当前处境 ?? '');
    // 行动数量提示（用于底部按钮显示）
    const 可选行动数 = computed(() => 可参与机遇.value.length);
    // 系统设置
    const 系统设置 = computed(() => rawData.value?._系统设置 ?? {
        启用行动提示: true,
        修炼系统版本: 3,
        变量结构版本: 4,
        _临时状态手动覆盖签名: '',
    });
    const 启用行动提示 = computed(() => 系统设置.value.启用行动提示);
    // 切换行动提示开关
    const toggleActionPrompt = async () => {
        try {
            const currentVal = 启用行动提示.value;
            const newVal = !currentVal;
            // 更新本地状态
            if (rawData.value) {
                if (!rawData.value._系统设置) {
                    rawData.value._系统设置 = {
                        启用行动提示: newVal,
                        修炼系统版本: 3,
                        变量结构版本: 4,
                        _临时状态手动覆盖签名: '',
                    };
                }
                else {
                    rawData.value._系统设置.启用行动提示 = newVal;
                    rawData.value._系统设置.修炼系统版本 = Number(rawData.value._系统设置.修炼系统版本 ?? 3) || 3;
                    rawData.value._系统设置.变量结构版本 = 4;
                    rawData.value._系统设置._临时状态手动覆盖签名 = rawData.value._系统设置._临时状态手动覆盖签名 ?? '';
                }
            }
            // 更新 MVU 变量
            await waitGlobalInitialized('Mvu');
            const variables = Mvu.getMvuData({ type: 'message', message_id });
            _.set(variables, 'stat_data._系统设置.启用行动提示', newVal);
            _.set(variables, 'stat_data._系统设置.修炼系统版本', Number(_.get(variables, 'stat_data._系统设置.修炼系统版本', 3)) || 3);
            _.set(variables, 'stat_data._系统设置.变量结构版本', 4);
            await Mvu.replaceMvuData(variables, { type: 'message', message_id });
            toastr.success(`已${newVal ? '开启' : '关闭'}行动提示生成`, '系统设置');
        }
        catch (e) {
            console.error('[踏月寻仙] 切换行动提示开关失败', e);
            toastr.error('切换失败', '系统设置');
        }
    };
    // 难度系统
    const 难度系统 = computed(() => rawData.value?.难度系统);
    const 难度感应 = computed(() => 难度系统.value?.天道感应 || '平稳');
    const 难度警告 = computed(() => 难度系统.value?.环境高压警告 || '天道运转如常，万物循理。');
    const 难度系数 = computed(() => {
        const factor = 难度系统.value?._难度系统内部数据?.难度结算快照?.本回合最终系数;
        if (typeof factor === 'number' && !isNaN(factor) && isFinite(factor)) {
            return factor;
        }
        return 1.0;
    });
    const 难度档位 = computed(() => {
        const factor = 难度系数.value;
        if (factor <= 0.9)
            return '低压';
        if (factor <= 1.08)
            return '常态';
        if (factor <= 1.2)
            return '高压';
        return '极压';
    });
    const lastDifficultyFactor = ref(null);
    const 难度趋势 = ref('flat');
    watch(难度系数, newVal => {
        if (lastDifficultyFactor.value === null) {
            难度趋势.value = 'flat';
        }
        else {
            const delta = newVal - lastDifficultyFactor.value;
            if (delta > 0.015) {
                难度趋势.value = 'up';
            }
            else if (delta < -0.015) {
                难度趋势.value = 'down';
            }
            else {
                难度趋势.value = 'flat';
            }
        }
        lastDifficultyFactor.value = newVal;
    }, { immediate: true });
    // 是否有数据
    const hasData = computed(() => rawData.value !== null);
    // 是否有图鉴卡片
    const hasGalleryCards = computed(() => galleryCards.value.length > 0);
    const updateCustomCompanionPortrait = async (name, side, url) => {
        const normalizedName = String(name).trim();
        const normalizedUrl = String(url).trim();
        if (!normalizedName || !normalizedUrl) {
            toastr.warning('立绘数据为空，未保存', '自定义立绘');
            return false;
        }
        if (isBuiltinCompanionName(normalizedName)) {
            toastr.warning('预设红颜不支持自定义上传立绘', '自定义立绘');
            return false;
        }
        if (!rawData.value) {
            toastr.warning('当前数据尚未就绪，请稍后再试', '自定义立绘');
            return false;
        }
        try {
            const nextData = _.cloneDeep(rawData.value);
            if (!nextData.红颜角色库[normalizedName]) {
                nextData.红颜角色库[normalizedName] = createCharacterLibraryEntryFromCompanion(normalizedName);
            }
            nextData.红颜角色库[normalizedName].自定义立绘 = {
                正面: String(nextData.红颜角色库[normalizedName].自定义立绘?.正面 ?? ''),
                背面: String(nextData.红颜角色库[normalizedName].自定义立绘?.背面 ?? ''),
            };
            nextData.红颜角色库[normalizedName].自定义立绘[side] = normalizedUrl;
            await waitGlobalInitialized('Mvu');
            const variables = _.cloneDeep(Mvu.getMvuData({ type: 'message', message_id }) ?? {});
            _.set(variables, 'stat_data', nextData);
            await Mvu.replaceMvuData(variables, { type: 'message', message_id });
            rawData.value = nextData;
            saveLastValidSnapshot(nextData, currentMessageIdNumber);
            cardCache.clear();
            parseCurrentMessageCards();
            return true;
        }
        catch (e) {
            console.error('[踏月寻仙] 保存自定义立绘失败', e);
            toastr.error('保存自定义立绘失败', '自定义立绘');
            return false;
        }
    };
    const clearCustomCompanionPortrait = async (name, side) => {
        const normalizedName = String(name).trim();
        if (!normalizedName) {
            return false;
        }
        if (isBuiltinCompanionName(normalizedName)) {
            toastr.warning('预设红颜不支持自定义立绘操作', '自定义立绘');
            return false;
        }
        if (!rawData.value?.红颜角色库?.[normalizedName]) {
            return false;
        }
        try {
            const nextData = _.cloneDeep(rawData.value);
            const portraitConfig = nextData.红颜角色库[normalizedName].自定义立绘 ?? { 正面: '', 背面: '' };
            portraitConfig[side] = '';
            nextData.红颜角色库[normalizedName].自定义立绘 = portraitConfig;
            await waitGlobalInitialized('Mvu');
            const variables = _.cloneDeep(Mvu.getMvuData({ type: 'message', message_id }) ?? {});
            _.set(variables, 'stat_data', nextData);
            await Mvu.replaceMvuData(variables, { type: 'message', message_id });
            rawData.value = nextData;
            saveLastValidSnapshot(nextData, currentMessageIdNumber);
            cardCache.clear();
            parseCurrentMessageCards();
            return true;
        }
        catch (e) {
            console.error('[踏月寻仙] 清除自定义立绘失败', e);
            toastr.error('清除自定义立绘失败', '自定义立绘');
            return false;
        }
    };
    return {
        rawData,
        世界时钟,
        世界地图,
        世界图志,
        地点库,
        本尊,
        红颜角色库,
        红颜,
        NPC图鉴,
        任务列表,
        声望系统,
        hasData,
        refresh: initData,
        // 图鉴相关
        galleryCards,
        hasGalleryCards,
        toggleCardFlip,
        changeGalleryCardImage,
        parseCurrentMessageCards,
        // 行动提示系统
        可参与机遇,
        当前处境,
        可选行动数,
        启用行动提示,
        toggleActionPrompt,
        // 难度系统
        难度感应,
        难度警告,
        难度系数,
        难度档位,
        难度趋势,
        isBuiltinCompanionName,
        updateCustomCompanionPortrait,
        clearCustomCompanionPortrait,
        // 调试与强制刷新
        forceRefresh: tryManualParseMvuMessage,
    };
}));
