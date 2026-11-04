// Serialized into both execution environments. Native operations keep their host
// transaction boundaries; unsupported library management uses a scoped local
// compatibility library, rather than pretending to mutate native DSH resources.
function installTavernHelperCompatibilityApi({ window: w, context, request, installPromptApi }) {
    if (w.__dshTavernHelperCompatibility) return w.__dshTavernHelperCompatibility.refresh();
    const copy = value => {
        if (value === undefined) return undefined;
        try { return w.structuredClone ? w.structuredClone(value) : JSON.parse(JSON.stringify(value)); }
        catch (_) { return JSON.parse(JSON.stringify(value)); }
    };
    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const list = value => Array.isArray(value) ? value : [];
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const state = () => context?.() || {};
    const api = w.TavernHelper || (w.TavernHelper = {});
    const modes = Object.create(null), exported = new Set(Object.keys(api));
    const storageKey = () => 'dsh-tavern-helper-library:' + String(state().chatId || state().character?.path || state().characterName || 'preview');
    const stores = new Map();
    function library() {
        const key = storageKey();
        if (!stores.has(key)) {
            let saved;
            try { saved = JSON.parse(w.localStorage?.getItem(key) || '{}'); } catch (_) {}
            const store = Object.assign(Object.create(null), object(saved));
            for (const name of ['books', 'characters', 'personas', 'presets', 'bindings', 'variables', 'scripts', 'audio', 'files', 'regexes']) {
                store[name] = Object.assign(Object.create(null), object(store[name]));
            }
            stores.set(key, store);
        }
        return stores.get(key);
    }
    function save() {
        try { w.localStorage?.setItem(storageKey(), JSON.stringify(library())); } catch (_) { /* Memory fallback also works in storage-disabled frames. */ }
    }
    function expose(name, fn, mode = 'local', replace = false) {
        const previous = w[name];
        if (typeof previous === 'function' && !replace) { modes[name] = 'native'; }
        else {
            Object.defineProperty(w, name, { configurable: true, enumerable: true, writable: true, value: fn });
            modes[name] = mode;
        }
        Object.defineProperty(api, name, { configurable: true, enumerable: true, get: () => w[name], set: value => { w[name] = value; } });
        exported.add(name);
    }
    function constant(name, value) {
        if (w[name] === undefined) Object.defineProperty(w, name, { configurable: true, writable: true, value });
        Object.defineProperty(api, name, { configurable: true, enumerable: true, get: () => w[name], set: next => { w[name] = next; } });
        exported.add(name);
    }
    function update(current, updater, write) {
        const next = typeof updater === 'function' ? updater(copy(current)) : current;
        const finish = value => write(value === undefined ? current : value);
        return next && typeof next.then === 'function' ? next.then(finish) : finish(next);
    }
    function response(value, status = 200) {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        if (typeof w.Response === 'function') return new w.Response(text, { status, headers: { 'Content-Type': 'application/json' } });
        return { ok: status >= 200 && status < 300, status, text: async () => text,
            json: async () => JSON.parse(text), clone: () => response(value, status) };
    }
    function warn(name) {
        if (modes[name] !== 'unsupported') w.console?.warn?.('[TavernHelper] ' + name + ': 当前宿主使用兼容返回值');
        modes[name] = 'unsupported';
    }
    const uuid = () => w.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
    });

    // The current merged book keeps using the native versioned read/write path.
    // Additional named books and bindings are kept in the compatibility library.
    const nativeBooks = Object.fromEntries(['getWorldbook', 'getWorldbookNames', 'updateWorldbookWith', 'replaceWorldbook', 'getCharWorldbookNames', 'createWorldbookEntries', 'deleteWorldbookEntries'].map(name => [name, w[name]]));
    const nativeLegacy = Object.fromEntries(['getLorebookEntries', 'setLorebookEntries', 'createLorebookEntries', 'deleteLorebookEntries'].map(name => [name, w[name]]));
    const nativeBookName = () => state().worldbook?.name || null;
    const bookKey = name => String(name === 'current' ? nativeBookName() || 'current' : name || nativeBookName() || 'current');
    const isNativeBook = name => nativeBookName() ? bookKey(name) === nativeBookName() : !own(library().books, bookKey(name));
    const normalizeEntries = entries => {
        const seen = new Set();
        return list(entries).map((entry, index) => {
            let uid = entry?.uid;
            if (uid === undefined || seen.has(String(uid))) { uid = index; while (seen.has(String(uid))) uid++; }
            seen.add(String(uid));
            return { ...copy(entry), uid, name: entry?.name || '', enabled: entry?.enabled !== false, content: entry?.content || '', probability: entry?.probability ?? 100,
                strategy: { type: 'selective', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global', ...copy(entry?.strategy) },
                position: { type: 'after_character_definition', role: 'system', depth: 0, order: 100, ...copy(entry?.position) },
                recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null, ...copy(entry?.recursion) },
                effect: { sticky: null, cooldown: null, delay: null, ...copy(entry?.effect) } };
        });
    };
    expose('getWorldbookNames', () => [...new Set([...(nativeBooks.getWorldbookNames?.() || []), ...Object.keys(library().books)])], 'hybrid', true);
    expose('getWorldbook', async name => {
        if (isNativeBook(name) && nativeBooks.getWorldbook) return nativeBooks.getWorldbook(nativeBookName() || name);
        return copy(library().books[bookKey(name)] || []);
    }, 'hybrid', true);
    expose('replaceWorldbook', async (name, entries) => {
        if (isNativeBook(name) && nativeBooks.replaceWorldbook) return nativeBooks.replaceWorldbook(nativeBookName() || name, entries);
        if (isNativeBook(name) && nativeBooks.updateWorldbookWith) return nativeBooks.updateWorldbookWith(nativeBookName() || name, () => entries);
        library().books[bookKey(name)] = normalizeEntries(entries); save();
    }, 'hybrid', true);
    expose('updateWorldbookWith', async (name, updater) => {
        if (isNativeBook(name) && nativeBooks.updateWorldbookWith) return nativeBooks.updateWorldbookWith(nativeBookName() || name, updater);
        return await update(await w.getWorldbook(name), updater, async next => { await w.replaceWorldbook(name, next); return await w.getWorldbook(name); });
    }, 'hybrid', true);
    expose('createWorldbook', async (name, entries = []) => {
        if (w.getWorldbookNames().includes(bookKey(name))) return false;
        library().books[bookKey(name)] = normalizeEntries(entries); save(); return true;
    });
    expose('createOrReplaceWorldbook', async (name, entries = []) => {
        if (!w.getWorldbookNames().includes(bookKey(name))) return w.createWorldbook(name, entries);
        await w.replaceWorldbook(name, entries); return true;
    });
    expose('deleteWorldbook', async name => {
        const key = bookKey(name), books = library().books;
        if (!own(books, key)) return false;
        delete books[key];
        const bindings = library().bindings;
        for (const binding of Object.values(bindings)) {
            if (binding && typeof binding === 'object') {
                if (binding.primary === key) binding.primary = null;
                if (binding.additional) binding.additional = binding.additional.filter(value => value !== key);
            }
        }
        if (bindings.chat === key) bindings.chat = null;
        bindings.global = list(bindings.global).filter(value => value !== key); save(); return true;
    });
    // Native entry operations delegate through the wrapped versioned updater.
    expose('createWorldbookEntries', async (name, additions) => {
        if (isNativeBook(name) && nativeBooks.createWorldbookEntries) return nativeBooks.createWorldbookEntries(name, additions);
        let added = [];
        const worldbook = await w.updateWorldbookWith(name, current => {
            const max = current.reduce((n, e) => Math.max(n, Number(e.uid) || 0), -1);
            added = normalizeEntries(list(additions).map((e, i) => ({ ...e, uid: max + i + 1 })));
            return current.concat(added);
        });
        return { worldbook, new_entries: worldbook.filter(e => added.some(a => String(a.uid) === String(e.uid))) };
    }, 'hybrid', true);
    expose('deleteWorldbookEntries', async (name, predicate) => {
        if (isNativeBook(name) && nativeBooks.deleteWorldbookEntries) return nativeBooks.deleteWorldbookEntries(name, predicate);
        let deleted = [];
        const worldbook = await w.updateWorldbookWith(name, current => {
            deleted = current.filter(e => typeof predicate === 'function' && predicate(copy(e)));
            return current.filter(e => !deleted.includes(e));
        });
        return { worldbook, deleted_entries: deleted };
    }, 'hybrid', true);
    const charBindingKey = name => 'character:' + String(!name || name === 'current' ? state().characterName || 'current' : name);
    expose('getCharWorldbookNames', name => copy(library().bindings[charBindingKey(name)] || nativeBooks.getCharWorldbookNames?.(name) || { primary: nativeBookName(), additional: [] }), 'hybrid', true);
    expose('rebindCharWorldbooks', async (name, binding) => { library().bindings[charBindingKey(name)] = { primary: null, additional: [], ...copy(binding) }; save(); });
    expose('getGlobalWorldbookNames', () => copy(library().bindings.global || []), 'local', true);
    expose('rebindGlobalWorldbooks', async names => { library().bindings.global = copy(list(names)); save(); });
    expose('getChatWorldbookName', () => library().bindings.chat || null, 'local', true);
    expose('rebindChatWorldbook', async (_chat, name) => { library().bindings.chat = name == null ? null : String(name); save(); });
    expose('getOrCreateChatWorldbook', async (_chat, name) => {
        if (w.getChatWorldbookName('current')) return w.getChatWorldbookName('current');
        const selected = name || 'Chat ' + uuid(); await w.createWorldbook(selected); await w.rebindChatWorldbook('current', selected); return selected;
    });

    const legacy = e => ({ uid: e.uid, comment: e.name, content: e.content, enabled: e.enabled,
        type: e.strategy?.type || 'selective', keys: copy(e.strategy?.keys || []), filters: copy(e.strategy?.keys_secondary?.keys || []),
        logic: e.strategy?.keys_secondary?.logic || 'and_any', scan_depth: e.strategy?.scan_depth ?? 'same_as_global',
        position: e.position?.type === 'at_depth' ? 'at_depth_as_' + (e.position.role || 'system') : e.position?.type || 'after_character_definition',
        depth: e.position?.depth ?? null, order: e.position?.order ?? 100, probability: e.probability ?? 100,
        exclude_recursion: e.recursion?.prevent_incoming || false, prevent_recursion: e.recursion?.prevent_outgoing || false,
        sticky: e.effect?.sticky ?? null, cooldown: e.effect?.cooldown ?? null, delay: e.effect?.delay ?? null, ...copy(e.extra) });
    function modern(e, previous = {}) {
        const atDepth = /^at_depth_as_(system|assistant|user)$/.exec(e.position || '');
        return { ...previous, uid: e.uid ?? previous.uid, name: e.comment ?? previous.name ?? '', content: e.content ?? previous.content ?? '', enabled: e.enabled ?? previous.enabled ?? true,
            probability: e.probability ?? previous.probability ?? 100,
            strategy: { ...previous.strategy, type: e.type ?? previous.strategy?.type ?? 'selective', keys: e.keys ?? previous.strategy?.keys ?? [],
                keys_secondary: { logic: e.logic ?? previous.strategy?.keys_secondary?.logic ?? 'and_any', keys: e.filters ?? previous.strategy?.keys_secondary?.keys ?? [] }, scan_depth: e.scan_depth ?? previous.strategy?.scan_depth ?? 'same_as_global' },
            position: { ...previous.position, type: atDepth ? 'at_depth' : e.position ?? previous.position?.type ?? 'after_character_definition', role: atDepth?.[1] || previous.position?.role || 'system', depth: e.depth ?? previous.position?.depth ?? 0, order: e.order ?? previous.position?.order ?? 100 },
            recursion: { ...previous.recursion, prevent_incoming: e.exclude_recursion ?? previous.recursion?.prevent_incoming ?? false, prevent_outgoing: e.prevent_recursion ?? previous.recursion?.prevent_outgoing ?? false },
            effect: { sticky: e.sticky ?? previous.effect?.sticky ?? null, cooldown: e.cooldown ?? previous.effect?.cooldown ?? null, delay: e.delay ?? previous.effect?.delay ?? null }, extra: { ...previous.extra, ...copy(e) } };
    }
    expose('getLorebooks', () => w.getWorldbookNames(), 'hybrid', true);
    expose('createLorebook', name => w.createWorldbook(name));
    expose('deleteLorebook', name => w.deleteWorldbook(name));
    expose('getCharLorebooks', (option = {}) => w.getCharWorldbookNames(option.name || 'current'), 'hybrid', true);
    expose('getCurrentCharPrimaryLorebook', () => w.getCharWorldbookNames('current').primary, 'hybrid', true);
    expose('setCurrentCharLorebooks', binding => w.rebindCharWorldbooks('current', { ...w.getCharWorldbookNames('current'), ...binding }));
    expose('getChatLorebook', () => w.getChatWorldbookName('current'));
    expose('setChatLorebook', name => w.rebindChatWorldbook('current', name));
    expose('getOrCreateChatLorebook', name => w.getOrCreateChatWorldbook('current', name));
    expose('getLorebookSettings', () => ({ scan_depth: 2, context_percentage: 25, budget_cap: 0, min_activations: 0, max_depth: 0, max_recursion_steps: 0,
        insertion_strategy: 'evenly', include_names: false, recursive: false, case_sensitive: false, match_whole_words: false, use_group_scoring: false, overflow_alert: false,
        ...copy(library().lorebookSettings), selected_global_lorebooks: w.getGlobalWorldbookNames() }), 'local', true);
    expose('setLorebookSettings', settings => {
        library().lorebookSettings = { ...w.getLorebookSettings(), ...copy(settings) };
        if (settings?.selected_global_lorebooks) library().bindings.global = copy(settings.selected_global_lorebooks); save();
    }, 'local', true);
    expose('getLorebookEntries', async name => isNativeBook(name) && nativeLegacy.getLorebookEntries ? nativeLegacy.getLorebookEntries(name) : (await w.getWorldbook(name)).map(legacy), 'hybrid', true);
    expose('replaceLorebookEntries', (name, entries) => w.replaceWorldbook(name, list(entries).map(e => modern(e))));
    expose('updateLorebookEntriesWith', async (name, updater) => {
        await w.updateWorldbookWith(name, current => update(current.map(legacy), updater, next => list(next).map(e => modern(e, current.find(old => old.uid === e.uid)))));
        return w.getLorebookEntries(name);
    });
    expose('updatelorebookEntriesWith', (...args) => w.updateLorebookEntriesWith(...args));
    expose('setLorebookEntries', async (name, patches) => {
        if (isNativeBook(name) && nativeLegacy.setLorebookEntries) return nativeLegacy.setLorebookEntries(name, patches);
        await w.updateWorldbookWith(name, current => current.map(e => {
            const patch = list(patches).find(p => p.uid === e.uid); return patch ? modern(patch, e) : e;
        })); return w.getLorebookEntries(name);
    }, 'hybrid', true);
    expose('createLorebookEntries', async (name, entries) => {
        if (isNativeBook(name) && nativeLegacy.createLorebookEntries) return nativeLegacy.createLorebookEntries(name, entries);
        const result = await w.createWorldbookEntries(name, list(entries).map(e => modern(e)));
        return { entries: result.worldbook.map(legacy), new_uids: result.new_entries.map(e => e.uid) };
    }, 'hybrid', true);
    expose('deleteLorebookEntries', async (name, uids) => {
        if (isNativeBook(name) && nativeLegacy.deleteLorebookEntries) return nativeLegacy.deleteLorebookEntries(name, uids);
        const result = await w.deleteWorldbookEntries(name, e => list(uids).includes(e.uid));
        return { entries: result.worldbook.map(legacy), delete_occurred: result.deleted_entries.length > 0 };
    }, 'hybrid', true);

    const defaults = {
        settings: { max_context: 32768, max_completion_tokens: 4096, reply_count: 1, should_stream: false, temperature: 1, frequency_penalty: 0, presence_penalty: 0, top_p: 1, repetition_penalty: 1, min_p: 0, top_k: 0, top_a: 0, seed: -1, squash_system_messages: false, reasoning_effort: 'auto', request_thoughts: false, request_images: false, enable_function_calling: false, enable_web_search: false, allow_sending_images: 'disabled', allow_sending_videos: false, character_name_prefix: 'none', wrap_user_messages_in_quotes: false },
        prompts: [], prompts_unused: [], extensions: {}
    };
    const presetKey = name => !name || name === 'in_use' ? library().loadedPreset || state().presetName || 'DSH' : String(name);
    const preset = value => ({ ...copy(defaults), ...copy(value), settings: { ...defaults.settings, ...copy(value?.settings) }, extensions: { ...copy(value?.extensions) } });
    constant('default_preset', copy(defaults));
    constant('builtin_prompt_default_order', ['world_info_before', 'persona_description', 'char_description', 'char_personality', 'scenario', 'world_info_after', 'dialogue_examples', 'chat_history', 'user_input']);
    expose('getPresetNames', () => [...new Set([presetKey('in_use'), ...Object.keys(library().presets)])]);
    expose('getLoadedPresetName', () => presetKey('in_use'));
    expose('getPreset', name => preset(library().presets[presetKey(name)] || state().preset));
    expose('loadPreset', name => { if (!w.getPresetNames().includes(name)) return false; library().loadedPreset = name; save(); return true; });
    expose('createPreset', async (name, value) => { if (w.getPresetNames().includes(name)) return false; library().presets[name] = preset(value); save(); return true; });
    expose('createOrReplacePreset', async (name, value) => { library().presets[presetKey(name)] = preset(value); save(); return true; });
    expose('replacePreset', async (name, value) => { await w.createOrReplacePreset(name, value); });
    expose('setPreset', async (name, value) => { const previous = w.getPreset(name); await w.replacePreset(name, { ...previous, ...value, settings: { ...previous.settings, ...value?.settings } }); return w.getPreset(name); });
    expose('updatePresetWith', (name, updater) => update(w.getPreset(name), updater, async next => { await w.replacePreset(name, next); return w.getPreset(name); }));
    expose('deletePreset', async name => { const exists = own(library().presets, name); delete library().presets[name]; if (library().loadedPreset === name) delete library().loadedPreset; save(); return exists; });
    expose('renamePreset', async (name, next) => { if (!own(library().presets, name) || w.getPresetNames().includes(next)) return false; library().presets[next] = library().presets[name]; delete library().presets[name]; if (library().loadedPreset === name) library().loadedPreset = next; save(); return true; });
    const systemPromptIds = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'];
    const placeholders = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'];
    expose('isPresetNormalPrompt', p => !!p && !systemPromptIds.includes(p.id) && !placeholders.includes(p.id));
    expose('isPresetSystemPrompt', p => systemPromptIds.includes(p?.id));
    expose('isPresetPlaceholderPrompt', p => placeholders.includes(p?.id));

    const nativeCharData = w.getCharData;
    const nativeCharacter = () => {
        const raw = nativeCharData?.('current') || state().character || {};
        return raw.data || raw;
    };
    const currentCharacterName = () => state().characterName || nativeCharacter().name || null;
    const currentCharacterId = () => state().character?.avatar || (currentCharacterName() ? currentCharacterName() + '.png' : null);
    const characterKey = name => !name || name === 'current' ? currentCharacterName() || 'current' : String(name);
    function characterRecord(name) {
        const key = characterKey(name), store = library().characters;
        const stored = store[key] || Object.values(store).find(c => c.avatar === key || c.name === key);
        const raw = stored || (key === currentCharacterName() || key === currentCharacterId() ? nativeCharacter() : {});
        return { avatar: raw.avatar || key.replace(/\.png$/, '') + '.png', version: raw.version || raw.character_version || '', creator: raw.creator || '', creator_notes: raw.creator_notes || '', worldbook: raw.worldbook ?? raw.character_book?.name ?? nativeBookName(), description: raw.description || '', first_messages: raw.first_messages || [raw.first_mes || '', ...list(raw.alternate_greetings)],
            extensions: { ...copy(raw.extensions), tavern_helper: { scripts: [], variables: {}, ...copy(raw.extensions?.tavern_helper) } }, ...copy(raw) };
    }
    expose('getCharacterNames', () => [...new Set([currentCharacterName(), ...Object.keys(library().characters)].filter(Boolean))]);
    expose('getCharacterIds', () => w.getCharacterNames().map(name => characterRecord(name).avatar));
    expose('getCurrentCharacterId', currentCharacterId);
    expose('getCharacter', async name => copy(characterRecord(name)));
    expose('createCharacter', async (name, value) => { if (w.getCharacterNames().includes(name) || w.getCharacterIds().includes(name)) return false; library().characters[name] = { ...characterRecord(name), ...copy(value) }; save(); return true; });
    expose('createOrReplaceCharacter', async (name, value) => { library().characters[characterKey(name)] = { ...characterRecord(name), ...copy(value) }; save(); return true; });
    expose('replaceCharacter', async (name, value) => { await w.createOrReplaceCharacter(name, value); });
    expose('updateCharacterWith', async (name, updater) => update(await w.getCharacter(name), updater, async next => { await w.replaceCharacter(name, next); return w.getCharacter(name); }));
    expose('deleteCharacter', async name => { const key = characterKey(name), exists = own(library().characters, key); delete library().characters[key]; save(); return exists; });
    expose('getCharData', name => {
        const key = characterKey(name);
        if (!w.getCharacterNames().includes(key) && !w.getCharacterIds().includes(key)) return null;
        const raw = characterRecord(name); return { ...copy(raw), name: raw.name || key.replace(/\.png$/, ''), data: copy(raw) };
    }, 'hybrid', true);
    expose('getCharAvatarPath', name => w.getCharData(name)?.avatar || null);
    expose('getChatHistoryBrief', async () => state().chatId ? [{ file_name: state().chatId, chat_items: state().messages?.length || 0 }] : []);
    expose('getChatHistoryDetail', async () => ({ chat: copy(state().messages || []) }));
    class RawCharacter {
        constructor(data) { this.data = copy(data || {}); }
        static find({ name = 'current' } = {}) { return w.getCharData(name); }
        static findIndex(name) { return w.getCharacterNames().indexOf(name); }
        static async getChatsFromFiles() { return w.getChatHistoryDetail(); }
        getCardData() { return copy(this.data); }
        getAvatarId() { return this.data.avatar || ''; }
        getRegexScripts() { return copy(this.data.data?.extensions?.regex_scripts || this.data.extensions?.regex_scripts || []); }
        getCharacterBook() { return copy(this.data.data?.character_book || this.data.character_book || null); }
        getWorldName() { return this.getCharacterBook()?.name || ''; }
    }
    constant('RawCharacter', RawCharacter);

    const personaKey = name => !name || name === 'current' ? state().playerName || '你' : String(name);
    const personaRecord = name => ({ avatar_id: personaKey(name) + '.png', avatar: personaKey(name) + '.png', name: personaKey(name), title: '', description: '', position: 0, depth: 2, role: 0, lorebook: '', connections: [], is_default: false, ...copy(library().personas[personaKey(name)]) });
    expose('getPersonaNames', () => [...new Set([personaKey('current'), ...Object.keys(library().personas)])]);
    expose('getPersonaIds', () => w.getPersonaNames().map(name => personaRecord(name).avatar_id));
    expose('getCurrentPersonaName', () => personaKey('current'));
    expose('getCurrentPersonaId', () => personaRecord('current').avatar_id);
    expose('getPersona', name => copy(Object.values(library().personas).find(p => p.avatar_id === name) || personaRecord(name)));
    expose('getPersonaAvatarPath', name => w.getPersona(name).avatar || null);
    expose('createPersona', async (name, value) => { if (w.getPersonaNames().includes(name)) return false; library().personas[name] = { ...personaRecord(name), ...copy(value) }; save(); return true; });
    expose('createOrReplacePersona', async (name, value) => { library().personas[personaKey(name)] = { ...personaRecord(name), ...copy(value) }; save(); return true; });
    expose('replacePersona', async (name, value) => { await w.createOrReplacePersona(w.getPersona(name).name, value); });
    expose('updatePersonaWith', (name, updater) => update(w.getPersona(name), updater, async next => { await w.replacePersona(name, next); return w.getPersona(next.name); }));
    expose('deletePersona', async name => { const key = w.getPersona(name).name, exists = own(library().personas, key); delete library().personas[key]; save(); return exists; });

    // Extend variable scopes without sending unknown scopes into the host writer.
    const variableMethods = ['getVariables', 'replaceVariables', 'updateVariablesWith', 'insertOrAssignVariables', 'insertVariables', 'deleteVariable'];
    const nativeVariables = Object.fromEntries(variableMethods.map(name => [name, w[name]]));
    const localScope = option => ['preset', 'extension'].includes(option?.type);
    const scopeKey = option => option.type + ':' + (option.type === 'preset' ? presetKey('in_use') : option.extension_id || 'default');
    const schemas = new Map();
    for (const name of variableMethods) expose(name, function (...args) {
        const option = name === 'getVariables' ? args[0] : args[1];
        if (!localScope(option)) return nativeVariables[name]?.apply(w, args);
        const key = scopeKey(option), current = copy(library().variables[key] || {});
        const write = next => { library().variables[key] = copy(object(next)); save(); return copy(library().variables[key]); };
        if (name === 'getVariables') return current;
        if (name === 'replaceVariables') return write(args[0]);
        if (name === 'updateVariablesWith') return update(current, args[0], write);
        if (name === 'insertOrAssignVariables') return write(w._?.merge ? w._.merge(current, copy(args[0])) : { ...current, ...copy(args[0]) });
        if (name === 'insertVariables') return write({ ...copy(args[0]), ...current });
        const path = String(args[0]).split('.'); let target = current;
        for (const part of path.slice(0, -1)) { if (!target?.[part] || typeof target[part] !== 'object') return { variables: current, delete_occurred: true }; target = target[part]; }
        const deleted = delete target[path.at(-1)]; return { variables: write(current), delete_occurred: deleted };
    }, 'hybrid', true);
    expose('registerVariableSchema', (schema, option) => { schemas.set(JSON.stringify(option || {}), schema); });

    const nativeRegexes = { get: w.getTavernRegexes, replace: w.replaceTavernRegexes, update: w.updateTavernRegexesWith };
    const regexKey = option => (option?.type || option?.scope || 'global') + ':' + (option?.name || 'current');
    expose('getTavernRegexes', option => {
        const local = library().regexes[regexKey(option)];
        return copy(local || nativeRegexes.get?.(option) || []);
    }, 'hybrid', true);
    expose('replaceTavernRegexes', async (regexes, option = {}) => {
        if (nativeRegexes.replace && (!option.type || option.type === 'global') && (!option.scope || ['all', 'global'].includes(option.scope))) {
            await nativeRegexes.replace(regexes, option);
            delete library().regexes[regexKey(option)]; save(); return;
        }
        const type = option.type || option.scope || 'global';
        library().regexes[regexKey(option)] = copy(list(regexes));
        const groups = state().regexScripts || (state().regexScripts = {});
        groups[type] = list(regexes).map(r => ({ ...copy(r), name: r.script_name || '', findRegex: r.find_regex || '', replaceString: r.replace_string || '',
            trimStrings: r.trim_strings || [], placement: [r.source?.user_input && 1, r.source?.ai_output && 2, r.source?.slash_command && 3, r.source?.world_info && 5, r.source?.reasoning && 6].filter(Boolean),
            markdownOnly: r.destination?.display === true, promptOnly: r.destination?.prompt === true, minDepth: r.min_depth, maxDepth: r.max_depth }));
        save();
    }, 'hybrid', true);
    expose('updateTavernRegexesWith', (updater, option) => update(w.getTavernRegexes(option), updater, async next => { await w.replaceTavernRegexes(next, option); return w.getTavernRegexes(option); }), 'hybrid', true);
    expose('importRawTavernRegex', (filename, content) => {
        try {
            const raw = JSON.parse(String(content)); if (!raw?.findRegex) return false;
            const current = w.getTavernRegexes({ type: 'global' });
            current.push({ id: uuid(), script_name: String(filename), enabled: raw.disabled !== true, find_regex: raw.findRegex, replace_string: raw.replaceString || '', trim_strings: raw.trimStrings || [],
                source: { user_input: list(raw.placement).includes(1), ai_output: list(raw.placement).includes(2) }, destination: { display: !!raw.markdownOnly, prompt: !!raw.promptOnly }, run_on_edit: !!raw.runOnEdit, min_depth: raw.minDepth ?? null, max_depth: raw.maxDepth ?? null });
            // This legacy API is synchronous; changes are visible immediately and
            // the missing native writer falls back to the local registry.
            void w.replaceTavernRegexes(current, { type: 'global' }); return true;
        } catch (_) { return false; }
    });

    // Audio uses real browser media elements; rejected autoplay is a normal state.
    const players = new Map();
    const audioState = type => library().audio[type] || (library().audio[type] = { list: [], settings: { enabled: true, mode: 'repeat_one', muted: false, volume: 100 }, current: { src: '', title: '', playing: false, progress: 0 } });
    const normalizeAudio = audio => ({ title: String(audio?.title || audio?.url || ''), url: String(audio?.url || '') });
    expose('getAudioList', type => copy(audioState(type).list));
    expose('replaceAudioList', (type, values) => { audioState(type).list = list(values).map(normalizeAudio); save(); });
    expose('appendAudioList', (type, values) => { w.replaceAudioList(type, w.getAudioList(type).concat(list(values))); });
    expose('getAudioSettings', type => copy(audioState(type).settings));
    expose('setAudioSettings', (type, settings) => {
        Object.assign(audioState(type).settings, copy(settings));
        const player = players.get(type); if (player) { player.muted = !!audioState(type).settings.muted; player.volume = Math.max(0, Math.min(1, Number(audioState(type).settings.volume) / 100)); player.loop = audioState(type).settings.mode === 'repeat_one'; if (!audioState(type).settings.enabled) w.pauseAudio(type); } save();
    });
    expose('playAudio', (type, audio) => {
        const item = normalizeAudio(audio), s = audioState(type); s.current = { src: item.url, title: item.title, playing: false, progress: 0 };
        if (!s.settings.enabled || typeof w.Audio !== 'function') return;
        let player = players.get(type); if (!player) { player = new w.Audio(); players.set(type, player); }
        player.pause(); player.src = item.url; w.setAudioSettings(type, s.settings);
        const result = player.play(); if (result?.then) result.then(() => { s.current.playing = true; }, () => { s.current.playing = false; });
    });
    expose('pauseAudio', type => { players.get(type)?.pause(); audioState(type).current.playing = false; });
    expose('getCurrentAudio', type => {
        const player = players.get(type), current = audioState(type).current;
        return { ...copy(current), ...(player ? { playing: !player.paused, progress: Number.isFinite(player.duration) && player.duration > 0 ? player.currentTime / player.duration * 100 : 0 } : {}) };
    });
    w.addEventListener?.('pagehide', () => { for (const player of players.values()) player.pause(); }, { once: true });

    const scriptType = option => option?.type || 'character';
    expose('getScriptTrees', option => copy(library().scripts[scriptType(option)] || (scriptType(option) === 'character' ? nativeCharacter().extensions?.tavern_helper?.scripts : []) || []));
    expose('replaceScriptTrees', (trees, option) => { library().scripts[scriptType(option)] = copy(list(trees)); save(); });
    expose('updateScriptTreesWith', (updater, option) => update(w.getScriptTrees(option), updater, next => { w.replaceScriptTrees(next, option); return w.getScriptTrees(option); }));
    expose('getScriptId', () => String(state().scriptId || 'message-' + (w.getCurrentMessageId?.() ?? 0)));
    expose('getScriptName', () => w.getScriptId());
    expose('getScriptInfo', () => library().scriptInfo || '');
    expose('replaceScriptInfo', value => { library().scriptInfo = String(value || ''); save(); });
    expose('getScriptButtons', () => copy(library().scriptButtons || []));
    expose('replaceScriptButtons', buttons => { library().scriptButtons = copy(list(buttons)); save(); });
    expose('updateScriptButtonsWith', updater => update(w.getScriptButtons(), updater, next => { w.replaceScriptButtons(next); return w.getScriptButtons(); }));
    expose('appendInexistentScriptButtons', buttons => { const current = w.getScriptButtons(); w.replaceScriptButtons(current.concat(list(buttons).filter(b => !current.some(c => c.name === b.name)))); });
    expose('getButtonEvent', name => 'dsh-compat-button:' + w.getScriptId() + ':' + name);
    expose('getAllEnabledScriptButtons', () => ({ [w.getScriptId()]: w.getScriptButtons().filter(b => b.visible).map(b => ({ button_name: b.name, button_id: w.getButtonEvent(b.name) })) }));
    expose('eventOnButton', (name, handler) => w.eventOn?.(w.getButtonEvent(name), handler));
    expose('reloadIframe', () => { w.location?.reload?.(); });
    // Destructive native history rewrites have no equivalent transaction yet.
    for (const name of ['deleteChatMessages', 'rotateChatMessages']) expose(name, async () => { warn(name); });
    if (typeof w.injectPrompts !== 'function') installPromptApi({ window: w, request, copy });
    expose('injectPrompts', w.injectPrompts);
    expose('uninjectPrompts', w.uninjectPrompts);
    const macros = new Map();
    expose('registerMacroLike', (regex, replacer) => { macros.set(String(regex), { regex, replacer }); return { unregister: () => macros.delete(String(regex)) }; });
    expose('unregisterMacroLike', regex => { macros.delete(String(regex)); });
    const substitute = w.substitudeMacros;
    if (substitute) expose('substitudeMacros', (...args) => {
        let text = substitute.apply(w, args);
        for (const entry of macros.values()) text = text.replace(entry.regex, (...match) => entry.replacer(args[1] || {}, ...match));
        return text;
    }, 'hybrid', true);

    expose('getProxyPresetNames', () => []);
    expose('getModelList', async config => {
        if (typeof w.fetch !== 'function' || !config?.apiurl) return [];
        try {
            const url = new URL(String(config.apiurl), w.location?.href); url.pathname = url.pathname.replace(/\/(chat\/completions|models)\/?$/, '').replace(/\/$/, '') + '/models';
            const result = await w.fetch(url.href, { headers: config.key ? { Authorization: 'Bearer ' + config.key } : {} });
            if (!result.ok) return []; const data = await result.json(); return list(data.data || data.models).map(m => String(m.id || m.name || m));
        } catch (_) { return []; }
    });
    expose('isAdmin', () => false);
    expose('getTavernHelperExtensionId', () => 'dsh-tavern-helper');
    expose('getExtensionType', id => id === w.getTavernHelperExtensionId() ? 'system' : null);
    expose('isInstalledExtension', id => w.getExtensionType(id) !== null);
    expose('getExtensionInstallationInfo', async () => null);
    expose('getExtensionStatus', id => w.getExtensionInstallationInfo(id));
    for (const name of ['installExtension', 'uninstallExtension', 'reinstallExtension', 'updateExtension']) expose(name, async () => { warn(name); return response({ success: false, error: 'DSH extensions are managed by the host' }, 501); });
    expose('getTavernVersion', () => String(state().hostVersion || '0.0.0'));
    expose('getTavernHelperVersion', () => '4.8.19');
    expose('uploadTavernFile', async (name, base64) => { const url = String(base64).startsWith('data:') ? String(base64) : 'data:application/octet-stream;base64,' + String(base64); library().files[name] = url; save(); return url; });
    expose('getTavernFile', async name => {
        const url = library().files[name];
        if (!url) return response({ error: 'File not found' }, 404);
        if (typeof w.fetch === 'function') { try { return await w.fetch(url); } catch (_) {} }
        return response({ url });
    });
    expose('deleteTavernFile', async name => { const exists = own(library().files, name); delete library().files[name]; save(); return exists; });
    async function parseImport(content) { try { return JSON.parse(typeof content?.text === 'function' ? await content.text() : String(content)); } catch (_) { return null; } }
    expose('importRawPreset', async (name, content) => { const data = await parseImport(content); return data ? w.createOrReplacePreset(name, data) : false; });
    expose('importRawWorldbook', async (name, content) => {
        const data = await parseImport(content); if (!data) return response({ success: false }, 400);
        const entries = Array.isArray(data) ? data : Object.values(data.entries || {});
        await w.createOrReplaceWorldbook(name, entries.map(e => e.strategy ? e : modern({ ...e, comment: e.comment || e.name, type: e.constant ? 'constant' : 'selective' })));
        return response({ success: true });
    });
    expose('importRawCharacter', async (name, content) => { const data = await parseImport(content); if (!data) return response({ success: false }, 400); await w.createOrReplaceCharacter(name, data.data || data); return response({ success: true }); });
    expose('importRawChat', async () => { warn('importRawChat'); return response({ success: false, error: 'Native chat import requires the host importer' }, 501); });

    constant('builtin', {
        addOneMessage: () => { warn('builtin.addOneMessage'); }, copyText: text => { const promise = w.navigator?.clipboard?.writeText(String(text)); promise?.catch?.(() => {}); },
        duringGenerating: () => !!state().generating, getImageTokenCost: async () => 0, getVideoTokenCost: async () => 0,
        parseRegexFromString: value => { try { const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(value); return m ? new RegExp(m[1], m[2]) : new RegExp(value); } catch (_) { return null; } },
        promptManager: { messages: [], getPromptCollection: () => ({ collection: w.getPreset('in_use').prompts }) },
        reloadAndRenderChatWithoutEvents: async () => { await w.refreshOneMessage?.(w.getCurrentMessageId?.() ?? 0); }, reloadChatWithoutEvents: async () => {},
        reloadEditor() {}, reloadEditorDebounced() {}, renderMarkdown: text => w.marked?.parse?.(String(text)) || String(text), renderPromptManager() {}, renderPromptManagerDebounced() {},
        saveSettings: async () => { save(); }, uuidv4: uuid
    });
    // Fill event names absent from the native host without changing its existing dispatch strings.
    w.tavern_events = Object.assign({"APP_READY":"app_ready","EXTRAS_CONNECTED":"extras_connected","MESSAGE_SWIPED":"message_swiped","MESSAGE_SENT":"message_sent","MESSAGE_RECEIVED":"message_received","MESSAGE_EDITED":"message_edited","MESSAGE_DELETED":"message_deleted","MESSAGE_UPDATED":"message_updated","MESSAGE_FILE_EMBEDDED":"message_file_embedded","MESSAGE_REASONING_EDITED":"message_reasoning_edited","MESSAGE_REASONING_DELETED":"message_reasoning_deleted","MESSAGE_SWIPE_DELETED":"message_swipe_deleted","MORE_MESSAGES_LOADED":"more_messages_loaded","IMPERSONATE_READY":"impersonate_ready","CHAT_CHANGED":"chat_id_changed","GENERATION_AFTER_COMMANDS":"GENERATION_AFTER_COMMANDS","GENERATION_STARTED":"generation_started","GENERATION_STOPPED":"generation_stopped","GENERATION_ENDED":"generation_ended","SD_PROMPT_PROCESSING":"sd_prompt_processing","EXTENSIONS_FIRST_LOAD":"extensions_first_load","EXTENSION_SETTINGS_LOADED":"extension_settings_loaded","SETTINGS_LOADED":"settings_loaded","SETTINGS_UPDATED":"settings_updated","MOVABLE_PANELS_RESET":"movable_panels_reset","SETTINGS_LOADED_BEFORE":"settings_loaded_before","SETTINGS_LOADED_AFTER":"settings_loaded_after","CHATCOMPLETION_SOURCE_CHANGED":"chatcompletion_source_changed","CHATCOMPLETION_MODEL_CHANGED":"chatcompletion_model_changed","OAI_PRESET_CHANGED_BEFORE":"oai_preset_changed_before","OAI_PRESET_CHANGED_AFTER":"oai_preset_changed_after","OAI_PRESET_EXPORT_READY":"oai_preset_export_ready","OAI_PRESET_IMPORT_READY":"oai_preset_import_ready","WORLDINFO_SETTINGS_UPDATED":"worldinfo_settings_updated","WORLDINFO_UPDATED":"worldinfo_updated","CHARACTER_EDITOR_OPENED":"character_editor_opened","CHARACTER_EDITED":"character_edited","CHARACTER_PAGE_LOADED":"character_page_loaded","USER_MESSAGE_RENDERED":"user_message_rendered","CHARACTER_MESSAGE_RENDERED":"character_message_rendered","FORCE_SET_BACKGROUND":"force_set_background","CHAT_DELETED":"chat_deleted","CHAT_CREATED":"chat_created","GENERATE_BEFORE_COMBINE_PROMPTS":"generate_before_combine_prompts","GENERATE_AFTER_COMBINE_PROMPTS":"generate_after_combine_prompts","GENERATE_AFTER_DATA":"generate_after_data","WORLD_INFO_ACTIVATED":"world_info_activated","TEXT_COMPLETION_SETTINGS_READY":"text_completion_settings_ready","CHAT_COMPLETION_SETTINGS_READY":"chat_completion_settings_ready","CHAT_COMPLETION_PROMPT_READY":"chat_completion_prompt_ready","CHARACTER_FIRST_MESSAGE_SELECTED":"character_first_message_selected","CHARACTER_DELETED":"characterDeleted","CHARACTER_DUPLICATED":"character_duplicated","CHARACTER_RENAMED":"character_renamed","CHARACTER_RENAMED_IN_PAST_CHAT":"character_renamed_in_past_chat","SMOOTH_STREAM_TOKEN_RECEIVED":"stream_token_received","STREAM_TOKEN_RECEIVED":"stream_token_received","STREAM_REASONING_DONE":"stream_reasoning_done","FILE_ATTACHMENT_DELETED":"file_attachment_deleted","WORLDINFO_FORCE_ACTIVATE":"worldinfo_force_activate","OPEN_CHARACTER_LIBRARY":"open_character_library","ONLINE_STATUS_CHANGED":"online_status_changed","IMAGE_SWIPED":"image_swiped","CONNECTION_PROFILE_LOADED":"connection_profile_loaded","CONNECTION_PROFILE_CREATED":"connection_profile_created","CONNECTION_PROFILE_DELETED":"connection_profile_deleted","CONNECTION_PROFILE_UPDATED":"connection_profile_updated","TOOL_CALLS_PERFORMED":"tool_calls_performed","TOOL_CALLS_RENDERED":"tool_calls_rendered","CHARACTER_MANAGEMENT_DROPDOWN":"charManagementDropdown","SECRET_WRITTEN":"secret_written","SECRET_DELETED":"secret_deleted","SECRET_ROTATED":"secret_rotated","SECRET_EDITED":"secret_edited","PRESET_CHANGED":"preset_changed","PRESET_DELETED":"preset_deleted","PRESET_RENAMED":"preset_renamed","PRESET_RENAMED_BEFORE":"preset_renamed_before","MAIN_API_CHANGED":"main_api_changed","WORLDINFO_ENTRIES_LOADED":"worldinfo_entries_loaded","WORLDINFO_SCAN_DONE":"worldinfo_scan_done","MEDIA_ATTACHMENT_DELETED":"media_attachment_deleted","state":"none","direction":"left"}, w.tavern_events || {});
    constant('tavern_events', w.tavern_events);
    // Expose explicit status, never a catch-all Proxy claiming arbitrary APIs.
    const bookWrappers = Object.fromEntries(['getWorldbook', 'updateWorldbookWith', 'getCharWorldbookNames', 'getGlobalWorldbookNames', 'getChatWorldbookName'].map(name => [name, w[name]]));
    function refresh() {
        // Opening bridges replace their namespace and specialize reads to a draft.
        // Keep that draft transport underneath the same compatibility library.
        for (const [name, wrapper] of Object.entries(bookWrappers)) {
            if (w[name] !== wrapper) { nativeBooks[name] = w[name]; w[name] = wrapper; }
        }
        const namespace = w.TavernHelper || (w.TavernHelper = {});
        for (const name of exported) Object.defineProperty(namespace, name, { configurable: true, enumerable: true,
            get: () => w[name], set: value => { w[name] = value; } });
    }
    Object.defineProperty(w, '__dshTavernHelperCompatibility', { configurable: true, value: { modes, save, refresh } });
}
