// Full card data remains synchronous at the legacy API boundary. Merely opening
// a conversation or bootstrapping its scripts does not invoke this reader.
function createTavernResourceReader(options) {
    const cache = new Map(), pending = new Map();
    function url(access) {
        const target = new URL('/api/dsh-tavern/session-resource', document.baseURI);
        target.searchParams.set('cap', access.token);
        return target.href;
    }
    function accept(access, result) {
        if (!result || result.kind !== access.kind || result.revision !== access.revision || !Object.prototype.hasOwnProperty.call(result, 'value')) throw new Error('人物卡资源版本不匹配，请刷新会话');
        cache.set(access.token, result.value);
        while (cache.size > 4) cache.delete(cache.keys().next().value);
        return result.value;
    }
    function read(access) {
        if (cache.has(access.token)) return cache.get(access.token);
        if (options && options.request) return accept(access, options.request(access));
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url(access), false);
        xhr.send();
        if (xhr.status !== 200) throw new Error('人物卡资源读取失败，请刷新会话后重试');
        return accept(access, JSON.parse(xhr.responseText));
    }
    async function readAsync(access) {
        if (cache.has(access.token)) return cache.get(access.token);
        if (pending.has(access.token)) return pending.get(access.token);
        const task = Promise.resolve().then(async function () {
            if (options && options.requestAsync) return accept(access, await options.requestAsync(access));
            const response = await fetch(url(access));
            if (!response.ok) throw new Error('世界书读取失败，请刷新会话后重试');
            return accept(access, await response.json());
        }).finally(function () { pending.delete(access.token); });
        pending.set(access.token, task);
        return task;
    }
    return { read: read, readAsync: readAsync };
}
